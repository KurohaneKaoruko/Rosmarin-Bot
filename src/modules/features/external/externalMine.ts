import { EXTERNAL_ROAD_CONFIG } from '@/constant/config';

// 各外矿房最后已知源数（有视野时刷新）：无视野补采集工时按它补给，防外矿停摆
const lastKnownSourceNum = new Map<string, number>();
import { isRoomTickAligned } from '@/modules/shared/roomPhase';
import { getRoomMode, getRoomModeProfile, isHighLikeMode } from '@/modules/shared/roomMode';
import { getActiveRemoteThreshold } from '@/modules/infra/bucketGovernor';
import { RoleData, type RoleId } from '@/constant/CreepConstant';
import { decompressBodyConfig } from '@/modules/shared/compress';
import { RoadBuilder, RoadMemory, RoadVisual } from '@/modules/features/external/externalRoad';
import { buildHaulerBodyConfig, buildOutBuildBody, buildRemoteMinerBody } from '@/modules/shared/remoteBody';
import { HighwayMineVisual } from '@/modules/shared/highwayMineVisual';
import { getCreepByTargetRoom } from '@/modules/shared/creepTickIndex';
import { getOutMineData, getRoomData, readRecordedSourceSlotCounts, recordSourceSlotCounts } from '@/modules/shared/memory';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { isRoomProductionSecured } from '@/prototype/Room/mission/updaters/spawnRules';
import { isRaceCompat } from '@/modules/shared/gameCapabilities';
import {
    CarryRoomCandidateStat,
    countPendingEconomyMissions,
    countPendingMissions,
    OUT_CARRY_DYING_TTL,
    OUTMINE_CARRY_ROLE_SET,
    OUTMINE_HARVEST_ROLE_SET,
    pickBestCarryRoomName,
    shouldDropPlannedMission,
    sortOutMineSpawnTargets,
} from '@/modules/features/external/externalScheduler';

// 目标房间列表的类型：普通外矿（能量）与中心房（SK/中心区）外矿。
export type OutMineTargetListKey = 'energy' | 'centerRoom';

// 单次外矿运行的状态快照，用于控制节奏与副作用（造路/侦查等）。
type OutMineRunState = {
    qosLevel: string;
    canRunSecondaryAction: boolean;
};

type LegacyRoomModeMemory = RoomMemory & Partial<Pick<RoomControlMemory, 'mode'>>;
type ExternalMineEnergyState = NonNullable<RoomMemory['energyState']> | 'UNKNOWN';
type ExternalMineTargetPolicy = {
    mode: string;
    energyState: ExternalMineEnergyState;
    remoteBudget: number;
    energyTargetLimit: number;
    allowCenterRoom: boolean;
};
type ExternalMineTargetSelectionStat = {
    roomName: string;
    kind: OutMineTargetListKey;
    distance: number;
    sourceCount: number;
    value: number;
    weight: number;
    score: number;
};
type ExternalMineManagedTargetSelection = Record<OutMineTargetListKey, string[]>;

// 外矿逻辑的执行间隔设置（不同 QoS 下采用不同的 tick 间隔）。
export type ExternalMineTiming = {
    normalInterval: number;
    constrainedInterval: number;
};

// 扇区可达性：novice / respawn / closed 扇区的房间物理不可达，
// 混进外矿目标会让 creep 在扇区边界堆死、白占孵化预算
const isRoomReachable = (roomName: string): boolean => {
    try {
        const status = Game.map.getRoomStatus(roomName);
        return !status || status.status === 'normal';
    } catch {
        return true;
    }
};

// 外矿搬运数量估算常量
const EXTERNAL_MINE_CARRY_TARGET_CONFIG = {
    harvestPerSourceByLevel: [0, 2, 4, 6, 8, 8, 10, 20, 20] as const,
    fallbackCarryCapacityByLevel: [0, 100, 150, 200, 400, 1000, 1000, 1300, 1600] as const,
    routeBaseTicks: 20,
    routeTicksPerLinearDistance: 25,
    routeOverheadTicks: 8,
    minEffectiveCarryCapacity: 50,
    dynamicTargetBuffer: 1,
    minTargetNum: 6,
    maxTargetNumPerSource: 7,
    noWorkCarryBaseExtraPerSource: 1,
    noWorkCarryBaseMultiplier: 2,
} as const;

// 托管目标选择（背包 DP）的跨 tick 短 TTL 缓存：
// 输入（目标列表、房间模式、能量状态、spawn 预算）都以 tick 级缓慢变化，
// 而 DP 本身不便宜；10 tick 的选择滞后完全可接受，QoS 紧张时也不再反复重算。
const MANAGED_SELECTION_TTL_TICKS = 10;
type ManagedSelectionCacheEntry = {
    tick: number;
    selection: ExternalMineManagedTargetSelection;
};
const managedSelectionCache = new Map<string, ManagedSelectionCacheEntry>();

// 外矿运行的状态工具：QoS、房间模式、节流、以及视觉渲染。
export class ExternalMineState {
    private static readonly CENTER_ROOM_REGEX = /^[EW]\d*[456][NS]\d*[456]$/;
    private static readonly EXACT_CENTER_ROOM_REGEX = /^[EW]\d*[5][NS]\d*[5]$/;
    private static readonly DEFAULT_LOCAL_SOURCE_COUNT = 2;
    private static readonly SPAWN_USAGE_PER_SPAWN =
        (typeof CREEP_LIFE_TIME === 'number' && typeof CREEP_SPAWN_TIME === 'number')
            ? CREEP_LIFE_TIME / CREEP_SPAWN_TIME
            : 500;
    private static readonly LOCAL_SOURCE_BASE_WEIGHT = 42;
    private static readonly LOCAL_PORTER_WEIGHT_PER_SPAWN = 23;
    private static readonly LOCAL_CONTROLLER_WEIGHT = 18;
    private static readonly LOCAL_QUEUE_WEIGHT_PER_TASK = 18;
    private static readonly REMOTE_RESERVER_WEIGHT = 5;
    private static readonly REMOTE_RESERVER_VALUE_COST = 1.3;
    private static readonly KEEPER_REMOTE_WEIGHT = typeof MAX_CREEP_SIZE === 'number' ? MAX_CREEP_SIZE : 50;
    private static readonly KEEPER_REMOTE_VALUE_COST = 4.5;
    private static readonly DEFAULT_KEEPER_ATTACK_COST = 4270;
    private static readonly DEFAULT_ENERGY_TARGET_LIMIT = Number.POSITIVE_INFINITY;
    private static readonly LOW_MODE_ENERGY_TARGET_LIMIT = 1;
    private static readonly LOW_MODE_MAX_REMOTE_BUDGET = 140;
    private static readonly SURPLUS_STATE_REMOTE_BUDGET_MULTIPLIER = 1.1;
    private static readonly REMOTE_QUEUE_ROLE_SET = new Set([
        'scout',
        'reserver',
        'out-harvest',
        'out-carry',
        'out-build',
        'out-mineral',
        'out-attack',
        'out-ranged',
        'out-defend',
        'out-invader',
        'out-2attack',
        'out-2heal',
    ]);

    private static getTargetList(memory: OutMineMemory, key: OutMineTargetListKey): string[] {
        const list = memory[key];
        if (!Array.isArray(list) || list.length <= 0) return [];
        return list.filter((roomName): roomName is string => typeof roomName === 'string' && !!roomName);
    }

    // 从全局 QoS 中获取当前级别，缺失时默认 normal。
    static getQosLevel(): string {
        return global.qos.getQoS()?.level || 'normal';
    }

    static isCenterRoom(roomName: string): boolean {
        return this.CENTER_ROOM_REGEX.test(roomName);
    }

    static isExactCenterRoom(roomName: string): boolean {
        return this.EXACT_CENTER_ROOM_REGEX.test(roomName);
    }

    static isKeeperCenterRoom(roomName: string): boolean {
        return this.isCenterRoom(roomName) && !this.isExactCenterRoom(roomName);
    }

    private static isHighLikeMode(mode: string): boolean {
        return isHighLikeMode(mode);
    }

    static getEnergyState(room: Room): ExternalMineEnergyState {
        return room.getEnergyState?.() || room.updateEnergyState?.(false) || room.memory.energyState || 'UNKNOWN';
    }

    // 源房到目标房的线性距离（外矿派单用的「先近后远」主键）。
    static getTargetPriorityDistance(sourceRoom: Room, targetRoomName: string): number {
        if (typeof Game.map?.getRoomLinearDistance === 'function') {
            return Math.max(1, Game.map.getRoomLinearDistance(sourceRoom.name, targetRoomName, true));
        }
        return 1;
    }

    private static getTargetKind(targetRoomName: string): OutMineTargetListKey {
        return this.isCenterRoom(targetRoomName) ? 'centerRoom' : 'energy';
    }

    private static getSourceRoomLevel(sourceRoom: Room): number {
        return sourceRoom.getEffectiveRoomLevel?.() ?? sourceRoom.level ?? 1;
    }

    private static getBodyConfigCost(bodyConfig: ((BodyPartConstant | number)[])[] | undefined): number {
        if (!Array.isArray(bodyConfig) || bodyConfig.length <= 0) return 0;
        let total = 0;
        for (const part of bodyConfig) {
            if (!Array.isArray(part) || part.length < 2) continue;
            const type = part[0];
            const count = typeof part[1] === 'number' ? part[1] : 0;
            if (count <= 0) continue;
            switch (type) {
            case WORK:
                total += count * 100;
                break;
            case CARRY:
            case MOVE:
                total += count * 50;
                break;
            case ATTACK:
                total += count * 80;
                break;
            case RANGED_ATTACK:
                total += count * 150;
                break;
            case HEAL:
                total += count * 250;
                break;
            case CLAIM:
                total += count * 600;
                break;
            case TOUGH:
                total += count * 10;
                break;
            default:
                break;
            }
        }
        return total;
    }

    private static getKeeperRemoteAttackCost(sourceRoom: Room): number {
        const roleBody = sourceRoom.GetRoleBodys?.('out-attack');
        const roleBodyCost = this.getBodyConfigCost(roleBody);
        if (roleBodyCost > 0) return roleBodyCost;
        const fallbackBody = RoleData['out-attack']?.bodypart as ((BodyPartConstant | number)[])[] | undefined;
        const fallbackCost = this.getBodyConfigCost(fallbackBody);
        return fallbackCost > 0 ? fallbackCost : this.DEFAULT_KEEPER_ATTACK_COST;
    }

    private static canRunKeeperRemote(sourceRoom: Room): boolean {
        const requiredCost = this.getKeeperRemoteAttackCost(sourceRoom);
        return (sourceRoom.energyCapacityAvailable || 0) >= requiredCost;
    }

    private static getSpawnUsageCapacity(sourceRoom: Room): number {
        const spawnCount = Math.max(1, sourceRoom.spawn?.length || 0);
        return Math.floor(spawnCount * this.SPAWN_USAGE_PER_SPAWN);
    }

    private static getLocalSourceCount(sourceRoom: Room): number {
        const indexed = Array.isArray(sourceRoom.source) ? sourceRoom.source.length : 0;
        if (indexed > 0) return indexed;
        if (typeof sourceRoom.find === 'function') {
            try {
                const found = sourceRoom.find(FIND_SOURCES).length;
                if (found > 0) return found;
            }
            catch { }
        }
        return this.DEFAULT_LOCAL_SOURCE_COUNT;
    }

    private static getLocalSpawnQueuePressure(sourceRoom: Room): number {
        const tasks = sourceRoom.getAllMissionFromPool?.('spawn') || [];
        let localQueued = 0;
        for (const task of tasks) {
            const data = task?.data;
            const memory = (data && typeof data === 'object' && 'memory' in data)
                ? (data.memory as Partial<CreepMemory> | undefined)
                : undefined;
            const role = memory?.role;
            if (typeof role !== 'string' || !role) continue;
            if (this.REMOTE_QUEUE_ROLE_SET.has(role) && (!memory.sourceRoom || memory.sourceRoom === sourceRoom.name)) {
                continue;
            }
            localQueued++;
        }
        return localQueued * this.LOCAL_QUEUE_WEIGHT_PER_TASK;
    }

    private static getLocalSpawnReserve(sourceRoom: Room): number {
        const spawnCount = Math.max(1, sourceRoom.spawn?.length || 0);
        const localSourceCount = this.getLocalSourceCount(sourceRoom);
        let reserve =
            localSourceCount * this.LOCAL_SOURCE_BASE_WEIGHT +
            spawnCount * this.LOCAL_PORTER_WEIGHT_PER_SPAWN;
        if (this.getSourceRoomLevel(sourceRoom) <= 4) {
            reserve += this.LOCAL_CONTROLLER_WEIGHT;
        }
        reserve += this.getLocalSpawnQueuePressure(sourceRoom);
        return reserve;
    }

    private static canReserveRemote(sourceRoom: Room, kind: OutMineTargetListKey): boolean {
        return kind === 'energy' && this.getSourceRoomLevel(sourceRoom) >= 3;
    }

    private static isRemoteConstructed(sourceRoom: Room, targetRoom: Room | undefined, source: Source | undefined): boolean {
        const builtLevel = this.getSourceRoomLevel(sourceRoom);
        if (builtLevel >= 4) return true;
        if (!targetRoom || !source) return false;
        return !!getExternalMineNearbyContainer(targetRoom, source);
    }

    private static getSelectionEnergyPerTick(
        sourceRoom: Room,
        targetRoomName: string,
        kind: OutMineTargetListKey,
        targetRoom?: Room,
        source?: Source,
    ): number {
        const baseCapacity = typeof source?.energyCapacity === 'number' && source.energyCapacity > 0
            ? source.energyCapacity
            : EXTERNAL_MINE_ANALYSIS_DEFAULTS.sourceEnergyCapacity;
        let energyPerTick = baseCapacity / EXTERNAL_MINE_ANALYSIS_DEFAULTS.energyRegenTime;

        if (kind === 'centerRoom') return energyPerTick;

        const canReserve = this.canReserveRemote(sourceRoom, kind);
        if (!targetRoom?.controller) {
            return canReserve ? energyPerTick : energyPerTick * 0.5;
        }

        const myUserName = sourceRoom.controller?.owner?.username;
        if (!myUserName) return energyPerTick;
        if (targetRoom.controller.owner && targetRoom.controller.owner.username !== myUserName) return 0;
        if (targetRoom.controller.reservation && targetRoom.controller.reservation.username !== myUserName) {
            return canReserve ? energyPerTick : energyPerTick * 0.5;
        }
        if (targetRoom.controller.owner || (targetRoom.controller.reservation && targetRoom.controller.reservation.username === myUserName)) {
            return energyPerTick;
        }
        return canReserve ? energyPerTick : energyPerTick * 0.5;
    }

    private static estimateSourceSelectionStat(
        sourceRoom: Room,
        targetRoomName: string,
        kind: OutMineTargetListKey,
        targetRoom?: Room,
        source?: Source,
    ): { distance: number; value: number; weight: number } {
        const distance = targetRoom && source
            ? getExternalMineSourceDistance(sourceRoom, targetRoom, source)
            : (
                EXTERNAL_MINE_ANALYSIS.ROUTE_BASE_TICKS +
                this.getTargetPriorityDistance(sourceRoom, targetRoomName) * EXTERNAL_MINE_ANALYSIS.ROUTE_TICKS_PER_LINEAR_DISTANCE +
                EXTERNAL_MINE_ANALYSIS.ROUTE_LOCAL_APPROACH_TICKS
            );
        const energyPerTick = this.getSelectionEnergyPerTick(sourceRoom, targetRoomName, kind, targetRoom, source);
        if (energyPerTick <= 0) {
            return { distance, value: 0, weight: Number.POSITIVE_INFINITY };
        }

        const constructed = this.isRemoteConstructed(sourceRoom, targetRoom, source);
        const workParts = Math.max(1, Math.ceil(energyPerTick / EXTERNAL_MINE_ANALYSIS_DEFAULTS.harvestPower));
        const carryParts = 1;
        const moveParts = Math.max(1, constructed ? Math.ceil((workParts + carryParts) / 2) : (workParts + carryParts));
        const minerBodyLength = workParts + carryParts + moveParts;
        const minerBodyCost = workParts * 100 + (carryParts + moveParts) * 50;
        const creepLifeTime = typeof CREEP_LIFE_TIME === 'number' ? CREEP_LIFE_TIME : 1500;
        const remainingLife = Math.max(200, creepLifeTime - Math.min(distance, creepLifeTime - 100));
        const minerCost = minerBodyCost / remainingLife;
        const minerSpawnUsage = minerBodyLength * (creepLifeTime / remainingLife);
        const haulerCost = (distance * energyPerTick * 0.04 * (constructed ? 75 : 100)) / creepLifeTime;
        const haulerSpawnUsage = distance * energyPerTick * 0.04 * (constructed ? 1.5 : 2);
        const repairLoss = constructed ? EXTERNAL_MINE_ANALYSIS.SOURCE_CONTAINER_REPAIR_LOSS : 1;

        return {
            distance,
            value: Math.max(0.1, energyPerTick - minerCost - haulerCost - repairLoss),
            weight: Math.max(1, minerSpawnUsage + haulerSpawnUsage),
        };
    }

    static estimateTargetSelectionStat(sourceRoom: Room, targetRoomName: string): ExternalMineTargetSelectionStat {
        const targetRoom = Game.rooms[targetRoomName];
        const kind = this.getTargetKind(targetRoomName);
        const fallbackSourceCount = kind === 'centerRoom' ? 3 : 2;
        const sources = targetRoom ? getExternalMineTargetSources(targetRoom) : [];
        const sourceCount = Math.max(fallbackSourceCount, sources.length || 0);

        let value = 0;
        let weight = 0;
        let distanceSum = 0;

        if (sources.length > 0 && targetRoom) {
            for (const source of sources) {
                const sourceStat = this.estimateSourceSelectionStat(sourceRoom, targetRoomName, kind, targetRoom, source);
                distanceSum += sourceStat.distance;
                value += sourceStat.value;
                weight += sourceStat.weight;
            }
        } else {
            for (let index = 0; index < sourceCount; index += 1) {
                const sourceStat = this.estimateSourceSelectionStat(sourceRoom, targetRoomName, kind);
                distanceSum += sourceStat.distance;
                value += sourceStat.value;
                weight += sourceStat.weight;
            }
        }

        if (this.canReserveRemote(sourceRoom, kind)) {
            value -= this.REMOTE_RESERVER_VALUE_COST;
            weight += this.REMOTE_RESERVER_WEIGHT;
        }
        if (this.isKeeperCenterRoom(targetRoomName)) {
            value -= this.KEEPER_REMOTE_VALUE_COST;
            weight += this.KEEPER_REMOTE_WEIGHT;
        }

        const avgDistance = Math.max(1, distanceSum / Math.max(1, sourceCount));
        const safeValue = Math.max(0.1, value);
        const safeWeight = Math.max(1, weight);
        return {
            roomName: targetRoomName,
            kind,
            distance: avgDistance,
            sourceCount,
            value: safeValue,
            weight: safeWeight,
            score: safeValue / safeWeight,
        };
    }

    private static compareTargetStats(left: ExternalMineTargetSelectionStat, right: ExternalMineTargetSelectionStat): number {
        const scoreDiff = right.score - left.score;
        if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
        const valueDiff = right.value - left.value;
        if (Math.abs(valueDiff) > 0.0001) return valueDiff;
        const distanceDiff = left.distance - right.distance;
        if (Math.abs(distanceDiff) > 0.0001) return distanceDiff;
        return left.roomName.localeCompare(right.roomName);
    }

    private static selectTargetStats(
        sourceRoom: Room,
        stats: ExternalMineTargetSelectionStat[],
        policy: ExternalMineTargetPolicy,
    ): ExternalMineManagedTargetSelection {
        const allowedStats = stats
            .filter((stat) => {
                if (stat.kind !== 'centerRoom') return true;
                if (!policy.allowCenterRoom) return false;
                if (!this.isKeeperCenterRoom(stat.roomName)) return true;
                return this.canRunKeeperRemote(sourceRoom);
            })
            .sort((left, right) => this.compareTargetStats(left, right));
        if (allowedStats.length <= 0) {
            return { energy: [], centerRoom: [] };
        }

        // 链式记录选中集合：只在「确定替换」时新建一个节点，不再每步拷贝整个 rooms 数组；
        // join 仅在罕见的三重平局（价值/重量/数量全相同）时才物化字符串。
        // 此前 rush 模式 budget 可达 spawn 数 × 500，且每步都拷贝 rooms，
        // 单次 DP 就是「目标数 × 表宽 × 数组长度」的分配风暴，直接把 tick 烧穿。
        type KnapsackEntry = {
            value: number;
            totalWeight: number;
            energyCount: number;
            roomCount: number;
            prev: KnapsackEntry | null;
            roomName: string;
        };

        const budget = Math.max(0, Math.floor(policy.remoteBudget));
        // DP 宽度压到「全部买得起的总重」以内：超出部分永远不可达，结果不变、表长不白算。
        const requiredWeights = allowedStats.map((stat) => Math.max(1, Math.ceil(stat.weight)));
        // 注意：什么都不买得起时也不能在这里提前返回——旧实现的空 DP 会落到
        // 兜底分支补一个目标，语义必须保持一致。
        let affordableTotal = 0;
        for (const requiredWeight of requiredWeights) {
            if (requiredWeight <= budget) affordableTotal += requiredWeight;
        }
        const capacity = Math.min(budget, affordableTotal);

        const table: Array<KnapsackEntry | null> = new Array(capacity + 1).fill(null);
        table[0] = { value: 0, totalWeight: 0, energyCount: 0, roomCount: 0, prev: null, roomName: '' };

        const joinRooms = (entry: KnapsackEntry): string => {
            const names: string[] = [];
            for (let node: KnapsackEntry | null = entry; node && node.prev; node = node.prev) {
                names.push(node.roomName);
            }
            return names.reverse().join(',');
        };

        const betterThan = (candidate: KnapsackEntry, current: KnapsackEntry | null): boolean => {
            if (!current) return true;
            if (candidate.value > current.value + 0.0001) return true;
            if (current.value > candidate.value + 0.0001) return false;
            if (candidate.totalWeight < current.totalWeight) return true;
            if (candidate.totalWeight > current.totalWeight) return false;
            if (candidate.roomCount > current.roomCount) return true;
            if (candidate.roomCount < current.roomCount) return false;
            return joinRooms(candidate) < joinRooms(current);
        };

        const energyLimit = Number.isFinite(policy.energyTargetLimit)
            ? policy.energyTargetLimit
            : Number.POSITIVE_INFINITY;

        for (let index = 0; index < allowedStats.length; index += 1) {
            const stat = allowedStats[index];
            const requiredWeight = requiredWeights[index];
            if (requiredWeight > capacity) continue;
            const isEnergy = stat.kind === 'energy';
            for (let currentBudget = capacity; currentBudget >= requiredWeight; currentBudget -= 1) {
                const previous = table[currentBudget - requiredWeight];
                if (!previous) continue;
                const nextEnergyCount = previous.energyCount + (isEnergy ? 1 : 0);
                if (nextEnergyCount > energyLimit) continue;
                const candidateValue = previous.value + stat.value;
                const candidateWeight = previous.totalWeight + requiredWeight;
                const candidateRoomCount = previous.roomCount + 1;
                const incumbent = table[currentBudget];
                let replace: boolean;
                if (!incumbent) {
                    replace = true;
                } else if (candidateValue > incumbent.value + 0.0001) {
                    replace = true;
                } else if (incumbent.value > candidateValue + 0.0001) {
                    replace = false;
                } else if (candidateWeight !== incumbent.totalWeight) {
                    replace = candidateWeight < incumbent.totalWeight;
                } else if (candidateRoomCount !== incumbent.roomCount) {
                    replace = candidateRoomCount > incumbent.roomCount;
                } else {
                    replace = joinRooms({
                        value: candidateValue,
                        totalWeight: candidateWeight,
                        energyCount: nextEnergyCount,
                        roomCount: candidateRoomCount,
                        prev: previous,
                        roomName: stat.roomName,
                    }) < joinRooms(incumbent);
                }
                if (!replace) continue;
                table[currentBudget] = {
                    value: candidateValue,
                    totalWeight: candidateWeight,
                    energyCount: nextEnergyCount,
                    roomCount: candidateRoomCount,
                    prev: previous,
                    roomName: stat.roomName,
                };
            }
        }

        let best: KnapsackEntry | null = null;
        for (const entry of table) {
            if (entry && betterThan(entry, best)) best = entry;
        }

        const selectedSet = new Set<string>();
        for (let node = best; node && node.prev; node = node.prev) {
            selectedSet.add(node.roomName);
        }
        const selection: ExternalMineManagedTargetSelection = { energy: [], centerRoom: [] };
        for (const stat of allowedStats) {
            if (!selectedSet.has(stat.roomName)) continue;
            selection[stat.kind].push(stat.roomName);
        }

        if (selection.energy.length > 0 || selection.centerRoom.length > 0) {
            return selection;
        }

        const fallbackStats = [...allowedStats].sort((left, right) => {
            const valueDiff = right.value - left.value;
            if (Math.abs(valueDiff) > 0.0001) return valueDiff;
            const weightDiff = left.weight - right.weight;
            if (Math.abs(weightDiff) > 0.0001) return weightDiff;
            const distanceDiff = left.distance - right.distance;
            if (Math.abs(distanceDiff) > 0.0001) return distanceDiff;
            return left.roomName.localeCompare(right.roomName);
        });
        for (const stat of fallbackStats) {
            if (stat.kind === 'energy' && Number.isFinite(policy.energyTargetLimit) && selection.energy.length >= policy.energyTargetLimit) {
                continue;
            }
            selection[stat.kind].push(stat.roomName);
            break;
        }
        return selection;
    }

    // 外矿预算折扣已移除：外矿是摆脱能量短缺的收入投资，短缺期砍它只会加剧短缺（贫困陷阱）。
    // 能量平衡由预算公式本身表达——本地编制优先占满 spawn（getLocalSpawnReserve），
    // 能量紧张时本地队列变长、预算自动收窄；孵化端对 out-* 按当前能量缩水体（spawnControl），
    // 收入按比例下降但不断档。
    private static getTargetPolicy(sourceRoom: Room): ExternalMineTargetPolicy {
        const mode = this.getRoomMode(sourceRoom);
        const energyState = this.getEnergyState(sourceRoom);
        const spawnUsageCapacity = this.getSpawnUsageCapacity(sourceRoom);
        const localSpawnReserve = this.getLocalSpawnReserve(sourceRoom);
        let remoteBudget = Math.max(0, spawnUsageCapacity - localSpawnReserve);

        if (energyState === 'SURPLUS') {
            remoteBudget = Math.floor(remoteBudget * this.SURPLUS_STATE_REMOTE_BUDGET_MULTIPLIER);
        }

        if (mode === 'low') {
            remoteBudget = Math.min(remoteBudget, this.LOW_MODE_MAX_REMOTE_BUDGET);
        }

        // 能量目标房数量不随能量状态收缩（否则其他外矿房的 creep 死一只少一只、骤降断档）；
        // low 模式是用户显式低配，保留单房上限。
        let energyTargetLimit = this.DEFAULT_ENERGY_TARGET_LIMIT;
        if (mode === 'low') {
            energyTargetLimit = this.LOW_MODE_ENERGY_TARGET_LIMIT;
        }

        // rush：外矿就是主要收入源——预算保底、能量目标上限放开、不碰危险中心房
        // 中心房（SK）高耗高危，能量低/紧急时暂停是合理的省能量位置，保留该闸。
        let allowCenterRoom = energyState !== 'LOW' && energyState !== 'CRITICAL';
        if (mode === 'rush') {
            remoteBudget = Math.max(remoteBudget, spawnUsageCapacity);
            energyTargetLimit = Number.POSITIVE_INFINITY;
            allowCenterRoom = false;
        }

        return {
            mode,
            energyState,
            remoteBudget,
            energyTargetLimit,
            allowCenterRoom,
        };
    }

    // 兼容多处存储路径读取房间模式（统一走 roomMode 单一来源）。
    static getRoomMode(room: Room): string {
        return getRoomMode(room);
    }

    // 根据 QoS 与间隔判断本 tick 是否运行，返回运行状态快照。
    // emergency 时直接停机，constrained 时拉长间隔且限制副作用操作频率。
    static getRunState(timing: ExternalMineTiming): OutMineRunState | null {
        const qosLevel = this.getQosLevel();
        if (qosLevel === 'emergency') return null;

        const canRunSecondaryAction =
            qosLevel === 'normal' || global.qos.shouldRun({ every: 2, allowLevels: ['constrained'] });
        const interval = qosLevel === 'constrained' ? timing.constrainedInterval : timing.normalInterval;
        if (Game.time % interval !== 0) return null;

        return { qosLevel, canRunSecondaryAction };
    }

    // rush 自动扩图：把**上下左右四个正交相邻**房间自动加入能量外矿列表
    // （跳过 novice/respawn/closed 等不可达扇区；斜对角距离太远，不扩）。
    // 仅当列表**完全为空**时生效（首次引导语义：空 = 没配置，帮我自动来）；
    // 用户一旦手动管理过列表（非空），自动扩图彻底退出——否则手动 remove/add 会被
    // 下一轮扩图写回，表现为「莫名其妙自动乱加外矿」。上限 4 与触发条件对齐。
    static autoAddNearbyEnergyTargets(sourceRoomName: string, known: string[]): string[] {
        if (known.length > 0) return known;
        const match = sourceRoomName.match(/^([WE])(\d+)([NS])(\d+)$/);
        if (!match) return known;
        const px = match[1] === 'E' ? Number(match[2]) : -Number(match[2]) - 1;
        const py = match[3] === 'N' ? Number(match[4]) : -Number(match[4]) - 1;

        const Mem = getOutMineData(sourceRoomName);
        Mem.energy ??= [];
        // rush：八向候选全量注册——实际取舍交给选房 DP（value/weight 背包，
        // 预算内自动偏好近房），候选列表不做人工截断
        const rush = Game.rooms[sourceRoomName] && getRoomMode(Game.rooms[sourceRoomName]) === 'rush';
        const maxRemote = rush ? 8 : 4;
        const addedRooms: string[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (!rush && dx !== 0 && dy !== 0) continue; // 只允许上下左右四个正交方向，斜角太远不扩
                if (Mem.energy.length >= maxRemote) break;
                const x = px + dx;
                const y = py + dy;
                const roomName = `${x >= 0 ? 'E' + x : 'W' + (-x - 1)}${y >= 0 ? 'N' + y : 'S' + (-y - 1)}`;
                if (!isRoomReachable(roomName)) continue;
                if (Mem.energy.indexOf(roomName) === -1) {
                    Mem.energy.push(roomName);
                    known.push(roomName);
                    addedRooms.push(roomName);
                }
            }
        }
        if (addedRooms.length > 0) {
            console.log(`[自动扩图] ${sourceRoomName} 自动加入相邻外矿: ${addedRooms.join(', ')}`);
        }
        return known;
    }

    // 同一个源房的 energy / centerRoom 旧桶数据可能串味；
    // 这里统一按“房名是否属于 center room”重新分类，避免同一目标被两条分支重复处理。
    // 选择结果按「源房 → energy+centerRoom 一次算齐」做 TTL 缓存（两个 key 共享同一次 DP），
    // 返回副本，避免调用方（如 rush 自动扩图）就地 push 污染缓存。
    static getManagedTargets(sourceRoom: Room, key: OutMineTargetListKey): string[] {
        const cached = managedSelectionCache.get(sourceRoom.name);
        if (!cached || Game.time - cached.tick >= MANAGED_SELECTION_TTL_TICKS) {
            const selection = this.computeManagedTargets(sourceRoom);
            managedSelectionCache.set(sourceRoom.name, { tick: Game.time, selection });
            return selection[key].slice();
        }
        return cached.selection[key].slice();
    }

    private static computeManagedTargets(sourceRoom: Room): ExternalMineManagedTargetSelection {
        const data = getOutMineData(sourceRoom.name);
        const mergedTargets = [
            ...this.getTargetList(data, 'energy'),
            ...this.getTargetList(data, 'centerRoom'),
        ];
        if (mergedTargets.length <= 0) return { energy: [], centerRoom: [] };

        // 过滤不可达扇区：novice/respawn/closed 房间物理进不去，混进轮换会让 creep 在扇区边界堆死、白占孵化预算
        const uniqueTargets = [...new Set(mergedTargets)].filter(isRoomReachable);
        const policy = this.getTargetPolicy(sourceRoom);
        const stats = uniqueTargets.map((roomName) => this.estimateTargetSelectionStat(sourceRoom, roomName));
        return this.selectTargetStats(sourceRoom, stats, policy);
    }

    static createMemory(sourceRoomName: string, targetRoomName: string): CreepMemory {
        return { sourceRoom: sourceRoomName, targetRoom: targetRoomName } as CreepMemory;
    }

    static getTargetKeeperLairIds(targetRoom: Room): string[] {
        if (typeof STRUCTURE_KEEPER_LAIR === 'undefined') return [];
        let lairs: StructureKeeperLair[] = [];
        try {
            lairs = targetRoom.find(FIND_STRUCTURES, {
                filter: (structure) => structure.structureType === STRUCTURE_KEEPER_LAIR,
            }) as StructureKeeperLair[];
        }
        catch {
            lairs = [];
        }
        if (lairs.length <= 0) return [];

        const resources: { pos: RoomPosition }[] = [];
        for (const source of getExternalMineTargetSources(targetRoom)) {
            resources.push(source);
        }
        if (typeof FIND_MINERALS !== 'undefined') {
            try {
                const minerals = (targetRoom.find(FIND_MINERALS) || []) as Mineral[];
                resources.push(...minerals);
            }
            catch { }
        }
        if (resources.length <= 0) return lairs.map((lair) => lair.id);

        return lairs
            .filter((lair) => resources.some((resource) => {
                if (resource.pos && typeof resource.pos.inRangeTo === 'function') {
                    return resource.pos.inRangeTo(lair.pos, 5);
                }
                if (lair.pos && typeof lair.pos.getRangeTo === 'function') {
                    return lair.pos.getRangeTo(resource.pos) <= 5;
                }
                return false;
            }))
            .map((lair) => lair.id);
    }

    // 外矿基础设施建造入口。
    // container 只要目标房有视野就优先尝试落地，不再受 secondary action 节流影响；
    // road 仍按 secondary action、等级与 BUILD_INTERVAL 节流，避免把高成本寻路/铺路放大到每 tick。
    // rush 例外：道路是采集/搬运的 2 倍速引擎（平地 1 tick/格 → 路面 0.5），落地即铺、
    // 100 tick 一轮——等 RCL4 才铺路，整个前期远程运力都在平地上爬（race 实测 4 万 tick 零路网）。
    static tryBuildRoad(
        sourceRoom: Room,
        targetRoom: Room,
        minLevel: number,
        canRunSecondaryAction: boolean
    ): void {
        RoadBuilder.ensureControllerContainer(sourceRoom);
        RoadBuilder.ensureContainerSites(sourceRoom, targetRoom);
        if (!canRunSecondaryAction) return;
        const rush = getRoomMode(sourceRoom) === 'rush';
        // rush 也从 RCL3 起铺：RCL2 阶段收入未起量，8 房路网（~9k 能量/房）会把
        // 升级/孵化抽干；源容器与控制器容器在上方两行先建，不受此门限制
        if (sourceRoom.level < (rush ? 3 : minLevel)) return;
        // cc 是升级链唯一补给点：缺位/在建/残血期间路面一律让位（worker 建造力集中保 cc）
        const ctrl = sourceRoom.controller;
        if (ctrl) {
            const cc = (sourceRoom.container || []).find(c => c.pos.inRangeTo(ctrl.pos, 3));
            const ccSite = sourceRoom.find(FIND_MY_CONSTRUCTION_SITES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && s.pos.inRangeTo(ctrl.pos, 3),
            }).length > 0;
            if (!cc || ccSite || cc.hits < cc.hitsMax * 0.4) return;
        }
        if (Game.time % (rush ? 100 : EXTERNAL_ROAD_CONFIG.BUILD_INTERVAL) !== 0) return;
        RoadBuilder.createRoadSites(sourceRoom, targetRoom);
    }

    // 外矿相关的可视化输出。
    static runVisuals(): void {
        RoadVisual.run();
        HighwayMineVisual.run();
    }
}

type ExternalMineStoreLike = Partial<Record<string, number>> & {
    getUsedCapacity?: (resourceType?: ResourceConstant) => number | null;
    getFreeCapacity?: (resourceType?: ResourceConstant) => number | null;
    getCapacity?: (resourceType?: ResourceConstant) => number | null;
};

type ExternalMineIndexedRoom = Room & {
    source?: Source[];
    container?: StructureContainer[];
    __dropped?: Resource[];
};

type ExternalMineRoadMemoryLike = {
    getPath?: (sourceRoomName: string, targetRoomName: string, targetKey: string) => RoomPosition[] | undefined;
};

export type ExternalMineSourceStat = {
    source: Source;
    sourceId: Id<Source>;
    sourceKey: string;
    sourcePos: RoomPosition;
    targetRoomName: string;
    distance: number;
    energyPerTick: number;
    pendingEnergy: number;
    expectedEnergyDelta: number;
    harvestingPower: number;
    activeHarvesterCount: number;
    assignedCarryCapacity: number;
    availableEnergy: number;
    collectionRange: number;
    container: StructureContainer | null;
};

export type ExternalMineCarryPlan = {
    sources: ExternalMineSourceStat[];
    requiredCarryCapacity: number;
    backlogExtraCount: number;
    throughputTargetNum: number;
    targetCarryNum: number;
};

const EXTERNAL_MINE_ANALYSIS = {
    OUT_CARRY_ROLE_SET: new Set(['out-carry']),
    OUT_HARVEST_ROLE_SET: new Set(['out-harvest']),
    SOURCE_CONTAINER_REPAIR_LOSS:
        (typeof REPAIR_COST === 'number' && typeof CONTAINER_DECAY === 'number' && typeof CONTAINER_DECAY_TIME === 'number')
            ? (REPAIR_COST * CONTAINER_DECAY) / CONTAINER_DECAY_TIME
            : 0.1,
    ROUTE_BASE_TICKS: 20,
    ROUTE_TICKS_PER_LINEAR_DISTANCE: 25,
    ROUTE_LOCAL_APPROACH_TICKS: 8,
    BACKLOG_THRESHOLD: 2000,
    SEVERE_BACKLOG_THRESHOLD: 3000,
    CARRY_RETURN_TO_COLLECT_RATIO: 0.5,
} as const;

const EXTERNAL_MINE_ANALYSIS_DEFAULTS = {
    sourceEnergyCapacity: typeof SOURCE_ENERGY_CAPACITY === 'number' ? SOURCE_ENERGY_CAPACITY : 3000,
    energyRegenTime: typeof ENERGY_REGEN_TIME === 'number' ? ENERGY_REGEN_TIME : 300,
    harvestPower: typeof HARVEST_POWER === 'number' ? HARVEST_POWER : 2,
} as const;

const normalizeExternalMineCapacity = (value: number | null | undefined): number => {
    return typeof value === 'number' ? value : 0;
};

const getExternalMineStoreUsedCapacity = (store: ExternalMineStoreLike | undefined, resourceType?: ResourceConstant): number => {
    if (!store) return 0;
    if (typeof store.getUsedCapacity === 'function') return normalizeExternalMineCapacity(store.getUsedCapacity(resourceType));
    if (resourceType) return Number(store[resourceType] || 0);
    let total = 0;
    for (const value of Object.values(store)) {
        if (typeof value === 'number') total += value;
    }
    return total;
};

const getExternalMineStoreFreeCapacity = (store: ExternalMineStoreLike | undefined, resourceType?: ResourceConstant): number => {
    if (!store) return 0;
    if (typeof store.getFreeCapacity === 'function') return normalizeExternalMineCapacity(store.getFreeCapacity(resourceType));
    const capacity = getExternalMineStoreCapacity(store, resourceType);
    return Math.max(0, capacity - getExternalMineStoreUsedCapacity(store, resourceType));
};

const getExternalMineStoreCapacity = (store: ExternalMineStoreLike | undefined, resourceType?: ResourceConstant): number => {
    if (!store) return 0;
    if (typeof store.getCapacity === 'function') return normalizeExternalMineCapacity(store.getCapacity(resourceType));
    return getExternalMineStoreUsedCapacity(store, resourceType);
};

const getExternalMineCreepWorkParts = (creep: Pick<Creep, 'body' | 'getActiveBodyparts'>): number => {
    if (typeof creep.getActiveBodyparts === 'function') return creep.getActiveBodyparts(WORK);
    if (!Array.isArray(creep.body)) return 0;
    return creep.body.filter((part) => part.type === WORK && (part.hits == null || part.hits > 0)).length;
};

const getExternalMineVisibleCreeps = (room: Room): Creep[] => {
    const indexed = Object.values(Game.creeps || {}).filter((creep) => creep?.my && creep.room?.name === room.name) as Creep[];
    if (indexed.length > 0) return indexed;
    if (typeof room.find === 'function' && typeof FIND_MY_CREEPS !== 'undefined') {
        try {
            return (room.find(FIND_MY_CREEPS) || []) as Creep[];
        }
        catch {
            return [];
        }
    }
    return [];
};

const getExternalMineTargetSources = (room: Room): Source[] => {
    const indexedRoom = room as ExternalMineIndexedRoom;
    const indexed = Array.isArray(indexedRoom.source) ? indexedRoom.source : [];
    if (indexed.length > 0) return indexed;
    if (typeof room.find === 'function') {
        try {
            return (room.find(FIND_SOURCES) || []) as Source[];
        }
        catch {
            return [];
        }
    }
    return [];
};

export const getOutmineSourceKey = (source: Pick<Source, 'pos'> | RoomPosition): string => {
    const pos = 'pos' in source ? source.pos : source;
    return `${pos.x}:${pos.y}`;
};

const getExternalMineCollectionRange = (roomName: string): number => ExternalMineState.isCenterRoom(roomName) ? 5 : 1;

const getExternalMineNearbyContainer = (room: Room, source: Source): StructureContainer | null => {
    const indexedRoom = room as ExternalMineIndexedRoom;
    const indexed = Array.isArray(indexedRoom.container) ? indexedRoom.container : [];
    const fromIndex = indexed.find((container) => source.pos.inRangeTo(container.pos, 1));
    if (fromIndex) return fromIndex;

    if (typeof source.pos.findInRange === 'function' && typeof FIND_STRUCTURES !== 'undefined') {
        try {
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (structure: Structure) => structure.structureType === STRUCTURE_CONTAINER,
            }) as StructureContainer[];
            return containers[0] || null;
        }
        catch {
            return null;
        }
    }
    return null;
};

const getExternalMineDroppedEnergyAroundSource = (room: Room, source: Source, range: number): number => {
    const indexedRoom = room as ExternalMineIndexedRoom;
    let dropped: Resource[] = [];
    if (typeof source.pos.findInRange === 'function' && typeof FIND_DROPPED_RESOURCES !== 'undefined') {
        try {
            dropped = source.pos.findInRange(FIND_DROPPED_RESOURCES, range) as Resource[];
        }
        catch {
            dropped = [];
        }
    } else if (Array.isArray(indexedRoom.__dropped)) {
        dropped = indexedRoom.__dropped.filter((resource) => source.pos.inRangeTo(resource.pos, range));
    }

    let total = 0;
    for (const resource of dropped) {
        if (resource.resourceType !== RESOURCE_ENERGY) continue;
        total += resource.amount || 0;
    }
    return total;
};

const getExternalMineTombstoneEnergyAroundSource = (source: Source, range: number): number => {
    let tombstones: Tombstone[] = [];
    if (typeof source.pos.findInRange === 'function' && typeof FIND_TOMBSTONES !== 'undefined') {
        try {
            tombstones = source.pos.findInRange(FIND_TOMBSTONES, range) as Tombstone[];
        }
        catch {
            tombstones = [];
        }
    }

    let total = 0;
    for (const tombstone of tombstones) {
        total += getExternalMineStoreUsedCapacity(tombstone.store as ExternalMineStoreLike, RESOURCE_ENERGY);
    }
    return total;
};

const getExternalMineSourceDistance = (sourceRoom: Room, targetRoom: Room, source: Source): number => {
    const targetKey = getOutmineSourceKey(source);
    const plannedPath = (RoadMemory as ExternalMineRoadMemoryLike).getPath?.(sourceRoom.name, targetRoom.name, targetKey);
    if (Array.isArray(plannedPath) && plannedPath.length > 0) return plannedPath.length;

    const linearDistance = typeof Game.map?.getRoomLinearDistance === 'function'
        ? Math.max(1, Game.map.getRoomLinearDistance(sourceRoom.name, targetRoom.name, true))
        : 1;
    const targetCenter = new RoomPosition(25, 25, targetRoom.name);
    const localApproach = source.pos && typeof source.pos.getRangeTo === 'function'
        ? Math.max(0, source.pos.getRangeTo(targetCenter) - 1)
        : EXTERNAL_MINE_ANALYSIS.ROUTE_LOCAL_APPROACH_TICKS;

    return EXTERNAL_MINE_ANALYSIS.ROUTE_BASE_TICKS +
        linearDistance * EXTERNAL_MINE_ANALYSIS.ROUTE_TICKS_PER_LINEAR_DISTANCE +
        localApproach;
};

const getExternalMineEffectiveEnergyPerTick = (sourceRoom: Room, targetRoom: Room, source: Source, unreservedIncomeFactor = 0.5): number => {
    const baseCapacity = typeof source.energyCapacity === 'number' && source.energyCapacity > 0
        ? source.energyCapacity
        : EXTERNAL_MINE_ANALYSIS_DEFAULTS.sourceEnergyCapacity;
    let energyPerTick = baseCapacity / EXTERNAL_MINE_ANALYSIS_DEFAULTS.energyRegenTime;

    const targetController = targetRoom.controller;
    const myUserName = sourceRoom.controller?.owner?.username;
    if (!targetController || !myUserName) return energyPerTick;
    if (targetController.owner && targetController.owner.username !== myUserName) return 0;
    if (!targetController.owner) {
        const reservation = targetController.reservation;
        if (!reservation || reservation.username !== myUserName) {
            // 未预定产量口径由模式参数表给出：rush=1 满产规划，main=0.75 温和打折，low=0.5 保守
            energyPerTick *= unreservedIncomeFactor;
        }
    }
    return energyPerTick;
};

const getExternalMineSourceHarvestingStats = (targetRoom: Room, source: Source): { power: number; count: number } => {
    let power = 0;
    let count = 0;
    for (const creep of getExternalMineVisibleCreeps(targetRoom)) {
        if (!creep?.memory?.role || !EXTERNAL_MINE_ANALYSIS.OUT_HARVEST_ROLE_SET.has(creep.memory.role)) continue;
        const boundSourceId = creep.memory.targetSourceId as Id<Source> | undefined;
        const isBound = boundSourceId === source.id;
        const isStandingOnSource = creep.pos?.roomName === source.pos.roomName && creep.pos.inRangeTo(source.pos, 1);
        if (!isBound && !isStandingOnSource) continue;
        // 零 CARRY 的采集工 harvest 永远 ERR_FULL，不产生任何吞吐——
        // 不计入采集功率（否则收入估算出现「幻影收入」，升级定编被虚高）
        if (getExternalMineStoreCapacity(creep.store as ExternalMineStoreLike) <= 0) continue;
        power += getExternalMineCreepWorkParts(creep);
        count++;
    }
    return { power: power * EXTERNAL_MINE_ANALYSIS_DEFAULTS.harvestPower, count };
};

const getExternalMineSourcePendingEnergy = (room: Room, source: Source, container: StructureContainer | null, collectionRange: number): number => {
    let total = getExternalMineDroppedEnergyAroundSource(room, source, collectionRange);
    total += getExternalMineStoreUsedCapacity(container?.store as ExternalMineStoreLike | undefined, RESOURCE_ENERGY);
    if (collectionRange > 1) {
        total += getExternalMineTombstoneEnergyAroundSource(source, collectionRange);
    }
    return total;
};

const getExternalMineExpectedEnergyDelta = (source: Source, harvestingPower: number, distance: number): number => {
    if (harvestingPower <= 0) return 0;
    const energy = typeof source.energy === 'number' ? source.energy : 0;
    const regeneration = typeof source.ticksToRegeneration === 'number' && source.ticksToRegeneration > 0
        ? source.ticksToRegeneration
        : EXTERNAL_MINE_ANALYSIS_DEFAULTS.energyRegenTime;
    if (distance < regeneration) {
        return Math.min(energy, harvestingPower * distance);
    }
    return Math.min(energy, harvestingPower * regeneration) + harvestingPower * (distance - regeneration);
};

const getExternalMineOutCarryMode = (creep: Creep): 'collect' | 'deliver' | 'unknown' => {
    const cachedMode = creep.memory.cache?.outCarryMode;
    if (cachedMode === 'collect' || cachedMode === 'deliver') return cachedMode;
    return 'unknown';
};

const isExternalMineLikelyCollecting = (creep: Creep): boolean => {
    if (!creep || creep.spawning) return false;
    const used = getExternalMineStoreUsedCapacity(creep.store as ExternalMineStoreLike);
    const free = getExternalMineStoreFreeCapacity(creep.store as ExternalMineStoreLike);
    if (free <= 0) return false;

    const mode = getExternalMineOutCarryMode(creep);
    if (mode === 'deliver') {
        const cap = Math.max(1, getExternalMineStoreCapacity(creep.store as ExternalMineStoreLike));
        return used < Math.ceil(cap * EXTERNAL_MINE_ANALYSIS.CARRY_RETURN_TO_COLLECT_RATIO);
    }
    if (mode === 'collect') return true;
    if (creep.memory.targetRoom && creep.room?.name === creep.memory.targetRoom) return true;
    return used === 0;
};

const getExternalMineAssignedSourceKeyFromCarry = (creep: Creep): string | null => {
    const sourceCache = ensureMemoryCache(creep.memory).source as Record<string, any> | undefined;
    const assignedSourceKey = sourceCache?.assignedSourceKey;
    if (typeof assignedSourceKey === 'string' && assignedSourceKey) return assignedSourceKey;

    const assignedSourceId = sourceCache?.assignedSourceId as Id<Source> | undefined;
    if (!assignedSourceId) return null;
    const source = Game.getObjectById(assignedSourceId);
    if (!source) return null;
    return getOutmineSourceKey(source);
};

const getExternalMineAssignedCarryCapacity = (
    sourceRoomName: string,
    targetRoomName: string,
    sourceKey: string,
    excludeCreepName?: string,
): number => {
    let assigned = 0;
    for (const creep of Object.values(Game.creeps || {})) {
        if (!creep?.my || creep.spawning) continue;
        if (!creep.memory?.role || !EXTERNAL_MINE_ANALYSIS.OUT_CARRY_ROLE_SET.has(creep.memory.role)) continue;
        if (creep.name === excludeCreepName) continue;
        if (creep.memory.sourceRoom !== sourceRoomName) continue;
        if (creep.memory.targetRoom !== targetRoomName) continue;
        if (!isExternalMineLikelyCollecting(creep)) continue;
        if (getExternalMineAssignedSourceKeyFromCarry(creep) !== sourceKey) continue;
        assigned += getExternalMineStoreFreeCapacity(creep.store as ExternalMineStoreLike, RESOURCE_ENERGY);
    }
    return assigned;
};

export class ExternalMineAnalysis {
    static getSourceStats(
        sourceRoom: Room,
        targetRoom: Room,
        source: Source,
        excludeCreepName?: string,
        unreservedIncomeFactor = 0.5,
    ): ExternalMineSourceStat {
        const sourceKey = getOutmineSourceKey(source);
        const distance = getExternalMineSourceDistance(sourceRoom, targetRoom, source);
        const energyPerTick = getExternalMineEffectiveEnergyPerTick(sourceRoom, targetRoom, source, unreservedIncomeFactor);
        const collectionRange = getExternalMineCollectionRange(targetRoom.name);
        const container = getExternalMineNearbyContainer(targetRoom, source);
        const { power: harvestingPower, count: activeHarvesterCount } = getExternalMineSourceHarvestingStats(targetRoom, source);
        const pendingEnergy = getExternalMineSourcePendingEnergy(targetRoom, source, container, collectionRange);
        const expectedEnergyDelta = getExternalMineExpectedEnergyDelta(source, harvestingPower, distance);
        const assignedCarryCapacity = getExternalMineAssignedCarryCapacity(sourceRoom.name, targetRoom.name, sourceKey, excludeCreepName);
        const availableEnergy = pendingEnergy + expectedEnergyDelta - assignedCarryCapacity;

        return {
            source,
            sourceId: source.id,
            sourceKey,
            sourcePos: source.pos,
            targetRoomName: targetRoom.name,
            distance,
            energyPerTick,
            pendingEnergy,
            expectedEnergyDelta,
            harvestingPower,
            activeHarvesterCount,
            assignedCarryCapacity,
            availableEnergy,
            collectionRange,
            container,
        };
    }

    static getRoomSourceStats(sourceRoom: Room, targetRoom: Room, excludeCreepName?: string, unreservedIncomeFactor = 0.5): ExternalMineSourceStat[] {
        return getExternalMineTargetSources(targetRoom)
            .map((source) => this.getSourceStats(sourceRoom, targetRoom, source, excludeCreepName, unreservedIncomeFactor))
            .filter((stat) => stat.energyPerTick > 0 && stat.distance > 0);
    }

    static buildCarryPlan(
        sourceRoom: Room,
        targetRoom: Room,
        allowWorkCarry: boolean,
        carryCapacity: number,
    ): ExternalMineCarryPlan {
        // 运力口径按房间模式参数表取：
        // - remoteUnreservedIncomeFactor：未预定房间产量口径（rush=1 满产，main=0.75 温和打折）
        // - remoteCarryThroughputFactor：吞吐冗余（死亡率/绕路/沼泽损耗）
        // - remoteCarryBacklogScale：积压加编阈值缩放（越小越早加编）
        const carryProfile = getRoomModeProfile(sourceRoom);
        const sources = this.getRoomSourceStats(sourceRoom, targetRoom, undefined, carryProfile.remoteUnreservedIncomeFactor);
        const sourceCount = sources.length;
        const baseTargetNum = allowWorkCarry
            ? sourceCount
            : Math.max(sourceCount + 1, Math.ceil(sourceCount * 2));

        let requiredCarryCapacity = 0;
        let backlogExtraCount = 0;
        for (const stat of sources) {
            const effectiveEnergyPerTick = Math.max(0, stat.energyPerTick - EXTERNAL_MINE_ANALYSIS.SOURCE_CONTAINER_REPAIR_LOSS);
            requiredCarryCapacity += 2 * stat.distance * effectiveEnergyPerTick * carryProfile.remoteCarryThroughputFactor;

            if (stat.availableEnergy >= EXTERNAL_MINE_ANALYSIS.SEVERE_BACKLOG_THRESHOLD * carryProfile.remoteCarryBacklogScale) backlogExtraCount += 2;
            else if (stat.availableEnergy >= EXTERNAL_MINE_ANALYSIS.BACKLOG_THRESHOLD * carryProfile.remoteCarryBacklogScale) backlogExtraCount += 1;
        }

        const throughputTargetNum = carryCapacity > 0
            ? Math.ceil(requiredCarryCapacity / Math.max(50, carryCapacity))
            : 0;
        const targetCarryNum = Math.max(baseTargetNum, throughputTargetNum + backlogExtraCount);

        return {
            sources,
            requiredCarryCapacity,
            backlogExtraCount,
            throughputTargetNum,
            targetCarryNum,
        };
    }

    static pickBestCarrySource(creep: Creep): ExternalMineSourceStat | null {
        const sourceRoomName = creep.memory.sourceRoom;
        const targetRoomName = creep.memory.targetRoom;
        if (!sourceRoomName || !targetRoomName) return null;

        const sourceRoom = Game.rooms[sourceRoomName];
        const targetRoom = Game.rooms[targetRoomName];
        if (!sourceRoom || !targetRoom) return null;

        const stats = this.getRoomSourceStats(sourceRoom, targetRoom, creep.name);
        if (stats.length <= 0) return null;

        const currentSourceKey = getExternalMineAssignedSourceKeyFromCarry(creep);
        const carryNeed = Math.max(1, getExternalMineStoreFreeCapacity(creep.store as ExternalMineStoreLike, RESOURCE_ENERGY));
        let best: ExternalMineSourceStat | null = null;
        let bestScore = -Infinity;

        for (const stat of stats) {
            const availableEnergy = stat.availableEnergy;
            if (availableEnergy <= 0) continue;

            let score = Math.min(availableEnergy, carryNeed);
            score += Math.min(carryNeed, Math.max(0, availableEnergy - carryNeed)) * 0.1;

            if (creep.room?.name === stat.targetRoomName) {
                const localRange = creep.pos.getRangeTo(stat.sourcePos);
                score -= localRange * localRange * 0.5;
            }

            if (stat.sourceKey === currentSourceKey) {
                score += Math.max(20, carryNeed * 0.2);
            }

            if (score > bestScore) {
                bestScore = score;
                best = stat;
            }
        }

        if (best) return best;

        if (!currentSourceKey) return null;
        return stats.find((stat) => stat.sourceKey === currentSourceKey) || null;
    }

    // 每 tick 每源房缓存一次：各托管目标房的「可用积压」（已扣除在场搬运工预定量）。
    // 单次调度覆盖全部托管房，多个搬运工复用同一份结果，避免逐 creep 重算。
    static getManagedRoomBacklogMap(sourceRoom: Room): Record<string, number> {
        return getRoomTickCacheValue(sourceRoom, 'outmine_room_backlog', () => {
            const backlog: Record<string, number> = {};
            const roomNames = [
                ...ExternalMine.getManagedTargetRooms(sourceRoom, 'energy'),
                ...ExternalMine.getManagedTargetRooms(sourceRoom, 'centerRoom'),
            ];
            for (const roomName of roomNames) {
                const targetRoom = Game.rooms[roomName];
                if (!targetRoom) continue;
                let total = 0;
                for (const stat of this.getRoomSourceStats(sourceRoom, targetRoom)) {
                    total += Math.max(0, stat.availableEnergy);
                }
                backlog[roomName] = total;
            }
            return backlog;
        });
    }

    // 每 tick 每源房缓存一次：各目标房在册的搬运工数量（含在途与孵化中，不含濒死返程的）。
    // 这是搬运重平衡的主键（人数最少者优先），单次统计全房搬运工复用。
    private static getCarryCountByTargetRoom(sourceRoom: Room): Record<string, number> {
        return getRoomTickCacheValue(sourceRoom, 'outmine_carry_count', () => {
            const counts: Record<string, number> = {};
            for (const name in Game.creeps) {
                const creep = Game.creeps[name];
                const memory = creep?.memory as any;
                if (!memory) continue;
                if (memory.role !== 'out-carry') continue;
                if (memory.sourceRoom !== sourceRoom.name) continue;
                const targetRoom = memory.targetRoom;
                if (!targetRoom) continue;
                // 濒死返程的搬运工这趟交完就退休，不再计入在册
                if (typeof creep.ticksToLive === 'number' && creep.ticksToLive <= OUT_CARRY_DYING_TTL) continue;
                counts[targetRoom] = (counts[targetRoom] || 0) + 1;
            }
            return counts;
        });
    }

    // 每 tick 每源房缓存一次：有「在场产出采集工」的目标房集合。
    // 在场产出 = 本源房的 out-harvest 物理位于其目标房 + 有 WORK（能采）
    // + 有 CARRY（能装；零 CARRY 的废体型 harvest 永远 ERR_FULL，不算产出）。
    // 在途/孵化中的采集工不算——到场前没有产出。
    // 供搬运派送的「在场产出闸」与重平衡的候选过滤共用。
    static getOnSiteHarvesterRoomSet(sourceRoom: Room): Set<string> {
        return getRoomTickCacheValue(sourceRoom, 'outmine_onsite_harvester_rooms', () => {
            const rooms = new Set<string>();
            for (const name in Game.creeps) {
                const creep = Game.creeps[name];
                const memory = creep?.memory as any;
                if (!memory || memory.role !== 'out-harvest') continue;
                if (memory.sourceRoom !== sourceRoom.name) continue;
                if (creep.spawning) continue;
                const targetRoomName = memory.targetRoom;
                if (!targetRoomName || !creep.pos || creep.pos.roomName !== targetRoomName) continue;
                const hasWork = typeof creep.getActiveBodyparts === 'function' && creep.getActiveBodyparts(WORK) > 0;
                if (!hasWork) continue;
                // 不要求 store 容量：rush 定点矿工 [W5,M1] 无 CARRY（掉落由搬运收取），
                // 在场产出的判定只看「在目标房 + 有采集力」
                rooms.add(targetRoomName);
            }
            return rooms;
        });
    }

    /**
     * 为一个外矿搬运工挑「更值得跑」的目标房（搬运工动态选房）。
     *
     * @remarks
     * 负载均衡以「在册搬运数」为主键：优先派往人最少的托管房，让各外矿房的搬运工数量趋平；
     * 同人数时才比积压（这一趟能不能装满）与距离。选择时机由调用方约束在
     * 「一趟起点」（刚交付完、空仓在母房），上路后目标锁定，避免途中反复横跳。
     *
     * @param creep 当前外矿搬运 creep。
     * @param candidatesOverride 候选目标房（测试/外部注入用；不传则按当前目标房的类别取托管列表）。
     * @param backlogOverride 候选房可用积压（测试/外部注入用；不传则按 tick 缓存现算）。
     * @returns 建议的目标房名；维持现状或数据不足时返回 `null`。
     */
    static pickBestCarryTargetRoom(
        creep: Creep,
        candidatesOverride?: string[],
        backlogOverride?: Record<string, number>,
    ): string | null {
        const sourceRoomName = creep.memory.sourceRoom;
        const currentTarget = creep.memory.targetRoom;
        if (!sourceRoomName || !currentTarget) return null;

        const injected = !!(candidatesOverride && backlogOverride);
        const sourceRoom = Game.rooms[sourceRoomName];
        if (!sourceRoom && !injected) return null;

        // 只在同类目标房之间重平衡：能量外矿 ↔ 能量外矿、中心房 ↔ 中心房。
        // 混着换会把搬运工送进 SK 中心房（工位与威胁口径完全不同）。
        let candidates = candidatesOverride;
        if (!candidates) {
            const energyTargets = ExternalMine.getManagedTargetRooms(sourceRoom, 'energy');
            const centerTargets = ExternalMine.getManagedTargetRooms(sourceRoom, 'centerRoom');
            candidates = energyTargets.indexOf(currentTarget) !== -1
                ? energyTargets
                : (centerTargets.indexOf(currentTarget) !== -1 ? centerTargets : []);
        }
        // 注意：这里不再因「候选只有 1 个」提前返回——当前房若是死房（被产出闸过滤），
        // 唯一的有效候选就是逃逸目标。

        const backlog = backlogOverride || this.getManagedRoomBacklogMap(sourceRoom);
        const carryCount = sourceRoom ? this.getCarryCountByTargetRoom(sourceRoom) : {};
        const onSiteRooms = sourceRoom ? this.getOnSiteHarvesterRoomSet(sourceRoom) : new Set<string>();
        const carryNeed = Math.max(1, getExternalMineStoreFreeCapacity(creep.store as ExternalMineStoreLike, RESOURCE_ENERGY));

        const stats: CarryRoomCandidateStat[] = [];
        for (const roomName of candidates) {
            const hasBacklogEntry = roomName in backlog;
            const available = hasBacklogEntry ? Math.max(0, backlog[roomName]) : 0;
            // 有产出闸：有积压（能量在等着搬）或有在场采集工（正在产出），二者居一才进候选。
            // 无视野又无在场采集工、或有视野但零积压且无采集工的死房一律排除——
            // 负载均衡主项是人数趋平，死房 0 人反而最「吸引」，不排除会把搬运工均衡进空房空跑。
            if (available <= 0 && !onSiteRooms.has(roomName)) continue;
            stats.push({
                roomName,
                available,
                distance: Math.max(1, Game.map.getRoomLinearDistance(sourceRoomName, roomName, true)),
                creepInRoom: creep.room?.name === roomName,
                assigned: carryCount[roomName] || 0,
            });
        }

        return pickBestCarryRoomName(currentTarget, carryNeed, stats);
    }

    // 每 tick 每源房缓存：发往某目标房的在册搬运总载量（含孵化中，不含濒死返程）。
    // 供收入瓶颈口径计算「搬运比」使用。
    private static getAssignedCarryCapacityByTarget(sourceRoomName: string, targetRoomName: string): number {
        let capacity = 0;
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            const memory = creep?.memory as any;
            if (!memory) continue;
            if (memory.role !== 'out-carry') continue;
            if (memory.sourceRoom !== sourceRoomName) continue;
            if (memory.targetRoom !== targetRoomName) continue;
            // 濒死返程的搬运工这趟交完就退休，不再计入运力
            if (typeof creep.ticksToLive === 'number' && creep.ticksToLive <= OUT_CARRY_DYING_TTL) continue;
            capacity += getExternalMineStoreCapacity(creep.store as ExternalMineStoreLike);
        }
        return capacity;
    }

    /**
     * 本源房外矿的真实有效收入（每 tick 能量口径）。
     *
     * @remarks
     * 有效收入 = Σ 净收入 × min(采集比, 搬运比)——**瓶颈侧决定真实到账**：
     * 采集断档（minerRatio 低）或运力不足（carryRatio 低）时收入按短板折算，
     * 升级定编（income 驱动）随之收缩，不再孵出「喂不饱的升级工」去抢外矿能量。
     *
     * - 采集比 = 在场采集功率 ÷ 净收入功率（到场 WORK × 2 / Σept，clamp 0-1）；
     * - 搬运比 = 在册搬运总载量 ÷ 需求运力（2 × 距离 × 净收入 × 模式冗余系数）；
     * - 无视野的目标房退化为「在册采集工 × 5」估算（宁估不缺，不断档口径）。
     */
    static getRoomRemoteIncome(sourceRoom: Room): number {
        return getRoomTickCacheValue(sourceRoom, 'outmine_remote_income', () => {
            const profile = getRoomModeProfile(sourceRoom);
            let income = 0;
            const roomNames = [
                ...ExternalMine.getManagedTargetRooms(sourceRoom, 'energy'),
                ...ExternalMine.getManagedTargetRooms(sourceRoom, 'centerRoom'),
            ];
            for (const roomName of roomNames) {
                const targetRoom = Game.rooms[roomName];
                if (!targetRoom) {
                    // 无视野：按在册采集工估算（每工 5/tick），封顶按 scout 记录的源数
                    const recorded = ExternalMineMath.getRecordedSourceNum(roomName) ?? 2;
                    let harvesters = 0;
                    for (const creep of Object.values(Game.creeps || {})) {
                        if (!creep?.my) continue;
                        if (creep.memory?.role !== 'out-harvest') continue;
                        if (creep.memory.sourceRoom !== sourceRoom.name) continue;
                        if (creep.memory.targetRoom !== roomName) continue;
                        harvesters++;
                    }
                    income += Math.min(10 * recorded, harvesters * 5);
                    continue;
                }

                const stats = this.getRoomSourceStats(sourceRoom, targetRoom, undefined, profile.remoteUnreservedIncomeFactor);
                if (stats.length <= 0) continue;

                let netPerTickTotal = 0;
                let harvestPowerTotal = 0;
                let requiredCarryCapacity = 0;
                for (const stat of stats) {
                    const netPerTick = Math.max(0, stat.energyPerTick - EXTERNAL_MINE_ANALYSIS.SOURCE_CONTAINER_REPAIR_LOSS);
                    netPerTickTotal += netPerTick;
                    harvestPowerTotal += stat.harvestingPower;
                    requiredCarryCapacity += 2 * stat.distance * netPerTick * profile.remoteCarryThroughputFactor;
                }
                if (netPerTickTotal <= 0) continue;

                const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
                const minerRatio = clamp01(harvestPowerTotal / netPerTickTotal);
                const carryRatio = requiredCarryCapacity > 0
                    ? clamp01(this.getAssignedCarryCapacityByTarget(sourceRoom.name, roomName) / requiredCarryCapacity)
                    : 1;
                income += netPerTickTotal * Math.min(minerRatio, carryRatio);
            }
            return income;
        });
    }
}

// 外矿的数学/容量估算集中在此处，避免散落的魔数。
class ExternalMineMath {
    // 期望单源总 WORK 数量（用于估算采集人数）。
    private static readonly SOURCE_TARGET_WORK = 5;
    // 低等级阶段允许的单源外矿采集者上限（用于过渡补能）。
    private static readonly MAX_HARVESTERS_PER_SOURCE_LOW_LEVEL = 3;
    // 成熟房间（有效等级 >= 4）单源上限：严格 1 个采集者。
    private static readonly MAX_HARVESTERS_PER_SOURCE_STABLE = 1;
    // 允许占位在采集点旁的可通行结构类型。
    private static readonly WALKABLE_SOURCE_STRUCTURE_SET = new Set<StructureConstant>([
        STRUCTURE_CONTAINER,
        STRUCTURE_ROAD,
        STRUCTURE_RAMPART,
    ]);

    // 获取 high/rush 模式下的外矿小体型；具体体型配置直接复用 RoleLevelData.minipart。
    static getModeLimitedBodyConfig(
        sourceRoom: Room,
        role: string,
        upbody?: boolean
    ): ((BodyPartConstant | number)[])[] | null {
        if (upbody) return null;
        const mode = ExternalMineState.getRoomMode(sourceRoom);
        if (mode !== 'high' && mode !== 'rush') return null;
        const body = sourceRoom.GetRoleBodys(role, false, undefined, true);
        return Array.isArray(body) && body.length > 0 ? body : null;
    }

    // 判断外矿资源点旁某个坐标是否可站立（不在边界、非墙、结构阻塞）。
    private static isStandableOutmineSourcePos(room: Room, x: number, y: number): boolean {
        const terrain = room.getTerrain();
        if (x <= 0 || x >= 49 || y <= 0 || y >= 49) return false;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

        const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
        if (structures.some(structure => {
            if (structure.structureType === STRUCTURE_RAMPART) {
                const rampart = structure as StructureRampart;
                return !rampart.my && !rampart.isPublic;
            }
            return !this.WALKABLE_SOURCE_STRUCTURE_SET.has(structure.structureType);
        })) return false;

        const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y) as ConstructionSite[];
        if (sites.some(site => !this.WALKABLE_SOURCE_STRUCTURE_SET.has(site.structureType))) return false;

        return true;
    }

    // 计算并缓存某个 Source 周围可站立格数，用于采集者数量上限估计。
    private static getOutmineSourceStandableCount(room: Room, source: Source): number {
        if (!room.memory.sourcePosCount) room.memory.sourcePosCount = {};
        const cached = room.memory.sourcePosCount[source.id];
        if (typeof cached === 'number') return cached;

        const pos = source.pos;
        const walkable = [
            [pos.x - 1, pos.y],
            [pos.x + 1, pos.y],
            [pos.x, pos.y - 1],
            [pos.x, pos.y + 1],
            [pos.x - 1, pos.y - 1],
            [pos.x + 1, pos.y + 1],
            [pos.x - 1, pos.y + 1],
            [pos.x + 1, pos.y - 1]
        ].filter(([px, py]) => this.isStandableOutmineSourcePos(room, px, py)).length;

        room.memory.sourcePosCount[source.id] = walkable;
        return walkable;
    }

    // 获取目标房间内所有资源点的可站立格总数（作为全局采集上限）。
    static getOutHarvesterSlotCap(targetRoom: Room): number {
        const sources = (targetRoom.source || targetRoom.find(FIND_SOURCES) || []) as Source[];
        if (sources.length <= 0) return 0;

        let totalSlots = 0;
        for (const source of sources) {
            totalSlots += this.getOutmineSourceStandableCount(targetRoom, source);
        }
        return totalSlots;
    }

    // 无视野时的离线口径：scout 到访时记录的工位缓存（Memory.rooms[target].sourcePosCount）。
    // 从未记录过返回 null——此时不做工位上限，由调用方决定是否放弃孵化。
    static getRecordedOutHarvesterSlotCap(targetRoomName: string): number | null {
        const recorded = readRecordedSourceSlotCounts(targetRoomName);
        if (!recorded) return null;
        return recorded.reduce((a, b) => a + b, 0);
    }

    // 无视野时的离线口径：scout 记录的 source 数量；从未记录过返回 null。
    static getRecordedSourceNum(targetRoomName: string): number | null {
        const recorded = readRecordedSourceSlotCounts(targetRoomName);
        return recorded ? recorded.length : null;
    }

    // 计算外矿采集者的 WORK 数量，支持 upbody（固定高配）或读取配置。
    static getOutHarvesterWorkParts(sourceRoom: Room, upbody?: boolean): number {
        if (upbody) return 16;
        const body = sourceRoom.GetRoleBodys('out-harvest');
        if (!Array.isArray(body) || body.length === 0) return 1;

        let workParts = 0;
        for (const part of body as ((BodyPartConstant | number)[])[]) {
            if (!Array.isArray(part) || part.length < 2) continue;
            if (part[0] !== WORK) continue;
            if (typeof part[1] !== 'number') continue;
            workParts += part[1];
        }
        return Math.max(1, workParts);
    }

    // 根据体型配置估算 out-carry 的单体承载能力。
    static getOutCarryCapacity(sourceRoom: Room): number {
        // 接力车道（rush）：C4 微型件口径，定编按 200 容量/件折算——
        // 定编必须与实际孵出的体型一致，否则车队目标会被低估 4-6 倍
        if (getRoomMode(sourceRoom) === 'rush') return 200;
        const modeBody = this.getModeLimitedBodyConfig(sourceRoom, 'out-carry');
        const body = modeBody || sourceRoom.GetRoleBodys('out-carry');
        if (Array.isArray(body) && body.length > 0) {
            let carryParts = 0;
            for (const part of body as ((BodyPartConstant | number)[])[]) {
                if (!Array.isArray(part) || part.length < 2) continue;
                if (part[0] !== CARRY) continue;
                if (typeof part[1] !== 'number') continue;
                carryParts += part[1];
            }
            const capacity = carryParts * 50;
            if (capacity > 0) return capacity;
        }
        const lv = Math.max(1, Math.min(8, sourceRoom.level));
        return EXTERNAL_MINE_CARRY_TARGET_CONFIG.fallbackCarryCapacityByLevel[lv];
    }

    // 根据源数、WORK 能力与站位上限，估算采集者目标数量。
    static calcOutHarvesterTargetNum(sourceRoom: Room, sourceNum: number, upbody?: boolean, slotCap?: number): number {
        if (sourceNum <= 0) return 0;
        const workParts = this.getOutHarvesterWorkParts(sourceRoom, upbody);
        const perSource = Math.ceil(this.SOURCE_TARGET_WORK / workParts);
        const builtLevel = sourceRoom.getEffectiveRoomLevel?.() ?? sourceRoom.level;
        const maxPerSource = (builtLevel >= 4 || upbody)
            ? this.MAX_HARVESTERS_PER_SOURCE_STABLE
            : this.MAX_HARVESTERS_PER_SOURCE_LOW_LEVEL;
        const cappedPerSource = Math.min(maxPerSource, Math.max(1, perSource));
        const targetNum = sourceNum * cappedPerSource;
        if (typeof slotCap === 'number') return Math.max(0, Math.min(slotCap, targetNum));
        return targetNum;
    }

    // 根据距离与吞吐估算运输数量，考虑 RCL 运输能力、往返时间与产量。
    static calcEnergyOutCarryTarget(
        sourceRoom: Room,
        targetRoom: Room,
        sourceNum: number,
        allowWorkCarry: boolean,
        carryCapacityOverride?: number
    ): number {
        const carryCapacity = (carryCapacityOverride && carryCapacityOverride > 0)
            ? carryCapacityOverride
            : this.getOutCarryCapacity(sourceRoom);
        const carryPlan = ExternalMineAnalysis.buildCarryPlan(sourceRoom, targetRoom, allowWorkCarry, carryCapacity);
        if (carryPlan.sources.length > 0) return carryPlan.targetCarryNum;

        const lv = Math.max(1, Math.min(8, sourceRoom.level));
        const baseNum = allowWorkCarry
            ? sourceNum
            : Math.max(
                sourceNum + EXTERNAL_MINE_CARRY_TARGET_CONFIG.noWorkCarryBaseExtraPerSource,
                Math.ceil(sourceNum * EXTERNAL_MINE_CARRY_TARGET_CONFIG.noWorkCarryBaseMultiplier)
            );

        const linearDistance = Game.map.getRoomLinearDistance(sourceRoom.name, targetRoom.name, true);
        const oneWayTicks =
            EXTERNAL_MINE_CARRY_TARGET_CONFIG.routeBaseTicks +
            linearDistance * EXTERNAL_MINE_CARRY_TARGET_CONFIG.routeTicksPerLinearDistance;
        const roundTripTicks = oneWayTicks * 2 + EXTERNAL_MINE_CARRY_TARGET_CONFIG.routeOverheadTicks;

        const harvestPerSource = EXTERNAL_MINE_CARRY_TARGET_CONFIG.harvestPerSourceByLevel[lv];
        const estimatedIncomePerTick = harvestPerSource * sourceNum;
        const throughputNeed = Math.ceil((
            estimatedIncomePerTick * roundTripTicks
        ) / Math.max(EXTERNAL_MINE_CARRY_TARGET_CONFIG.minEffectiveCarryCapacity, carryCapacity));
        // 离线估算动态缓冲：高强度模式（rush/high/mini）+1（同参数表冗余思路，离线也不至于运力吃紧）
        const dynamicBuffer = EXTERNAL_MINE_CARRY_TARGET_CONFIG.dynamicTargetBuffer +
            (isHighLikeMode(ExternalMine.getRoomMode(sourceRoom)) ? 1 : 0);
        const dynamicNum = throughputNeed + dynamicBuffer;

        const cappedMax = Math.max(
            EXTERNAL_MINE_CARRY_TARGET_CONFIG.minTargetNum,
            sourceNum * EXTERNAL_MINE_CARRY_TARGET_CONFIG.maxTargetNumPerSource
        );
        return Math.min(cappedMax, Math.max(baseNum, dynamicNum));
    }
}

// 外矿相关的刷怪决策与刷怪队列维护。
export class ExternalMineSpawner {
    // 各角色任务优先级，统一从角色配置读取。
    // 注意：采集工/搬运工入队走专属流水线层级（采集 12 严格优先于搬运 13，见下），
    // 这里的 harvest/carry 只用于角色对齐与阅读参考，不再直接作为入队等级。
    private static readonly PRIORITY = {
        reserver: RoleData['reserver'].level,
        harvest: RoleData['out-harvest'].level,
        carry: RoleData['out-carry'].level,
        scout: RoleData['scout'].level,
        build: RoleData['out-build'].level,
        mineral: RoleData['out-mineral'].level,
    } as const;

    // 采集与搬运的孵化层级：采集(12) 严格优先于搬运(13)，两者都直接读角色配置
    // （CreepConstant 里 out-harvest.level / out-carry.level 是唯一事实源）。
    // 曾经同层排队（先采后运、谁缺谁先补），但搬运定编（3-4/房）远大于采集定编（1-2/房），
    // 同层先到先孵会让存量搬运任务排在采集补位前面——采集工全灭的房补不上人，
    // 而搬运闸又因为「有排队中的采集工」继续派搬运，形成循环饥饿
    // （线上实例：外矿房长期零采集工在岗、容器空转）。
    // 分层语义：任何缺采集的房先把采集补上（12 压过所有搬运）；
    // 有采集在岗的房不存在竞争中的采集任务，其搬运不会被别房的采集饿死。
    // 搬运的「在场产出闸」（carry）与之配套：没有在场采集工的房根本不派搬运。
    private static readonly OUTMINE_HARVEST_PIPELINE_LEVEL = RoleData['out-harvest'].level;
    private static readonly OUTMINE_CARRY_PIPELINE_LEVEL = RoleData['out-carry'].level;
    // rush 管线等级（对齐参考实现的孵化层序：分发/采集搬运 > 升级 > 建造）：
    // 收入链（矿工 OH + 搬运 OC）整体压在升级前面，升级压在建造前面。
    // 升级不饿死的保障不是层级，而是升级定编有界（=实测收入 + 底火）——
    // 收入链先满、升级池封顶，谁也饿不死谁（参考实现同款自洽）。
    // 旧口径（升级 7 > 搬运 8）的震荡根源：升级单常态缺编 → 永远插队搬运 →
    // 搬运饿死 → 收入掉 → 升级定编跟着掉 → 同步崩（attempt 19/20 实测 RCL4@25k）。
    private static readonly OUTMINE_RUSH_HARVEST_LEVEL = 4;
    private static readonly OUTMINE_RUSH_CARRY_LEVEL = 5;
    // 积压饥荒层：常态 L5 已在升级(7)/建造(9) 之上，饥荒不再额外升层（留位未来调）
    private static readonly OUTMINE_RUSH_CARRY_FAMINE_LEVEL = 5;

    // 换班接力优先级：目标房仍有在岗采集工、但 TTL 覆盖不足时的接替孵化等级。
    // 高于本地 worker(8)（换班爬绝不被建造/升级无限插队），低于内部保命线
    // （universal=0 / manager=1 / transporter=2 / harvester=3）——生命线优先，其次无缝接力。
    private static readonly OUTMINE_REPLACEMENT_LEVEL = 5;

    // 单个目标房在 spawn 池中允许挂的外矿任务上限（按角色分列）。
    // 外矿体型很大（RCL8 搬运工 48 格 ≈ 144 tick 孵化），单房一次把定编全塞进队列，
    // 就会独占总 spawn 数百 tick，其它外矿房一个 creep 都排不上；
    // 等终于轮到它们时又是一次性批量产出。上限 + 每 tick 补员 ⇒ 队列自然轮转。
    // - 采集工额度 = 单源定编（RCL≥4 每源 1 个，两源房正好 2），刚好排满不浪费；
    // - 搬运工额度是大头，压到 3 条，把它对 spawn 的占用摊到多个外矿房上。
    private static readonly OUTMINE_HARVEST_PENDING_CAP = 2;
    // rush 接力口径：OH 是收入源头，挂单额度大于搬运（先矿后车，同参考实现的矿车顺序）
    private static readonly OUTMINE_HARVEST_PENDING_CAP_RUSH = 2;
    private static readonly OUTMINE_CARRY_PENDING_CAP = 3;
    // rush 接力车道（C4 微型件）的搬运挂单额度
    private static readonly OUTMINE_CARRY_PENDING_CAP_RELAY = 3;

    // 触发“双人防御”模式的最低 RCL。
    private static readonly DOUBLE_DEFEND_MIN_LEVEL = 7;

    private static getSpawnTaskData(task: Task | null | undefined): SpawnTask | null {
        const data = task?.data;
        if (!data || typeof data !== 'object' || !('memory' in data)) return null;
        return data as SpawnTask;
    }

    private static getSpawnTaskMemory(task: Task | null | undefined): CreepMemory | null {
        return this.getSpawnTaskData(task)?.memory || null;
    }

    // 统计本源房 spawn 池里、发往某目标房、且角色落在给定集合内的任务数。
    static countPendingMissions(sourceRoom: Room, targetRoomName: string, roleSet: ReadonlySet<string>): number {
        const memories = (sourceRoom.getAllMissionFromPool?.('spawn') || [])
            .map((task) => this.getSpawnTaskMemory(task));
        return countPendingMissions(memories, sourceRoom.name, targetRoomName, roleSet);
    }

    // 统计本源房 spawn 池里、发往某目标房的外矿经济任务数（采集 + 搬运）。
    // 这是派单排序用的「挂单量」：挂单少的房先补员，避免单房独占总 spawn。
    static countPendingEconomyTasks(sourceRoom: Room, targetRoomName: string): number {
        const memories = (sourceRoom.getAllMissionFromPool?.('spawn') || [])
            .map((task) => this.getSpawnTaskMemory(task));
        return countPendingEconomyMissions(memories, sourceRoom.name, targetRoomName);
    }

    // 外矿补员派单顺序：先近后远 + 负载均衡（排序规则见 externalScheduler）。
    // 主键线性距离升序，次键该目标房已挂单数升序，末键房名。
    static orderTargetsForSpawn(sourceRoom: Room, targetRoomNames: string[]): string[] {
        return sortOutMineSpawnTargets(targetRoomNames.map((roomName) => ({
            roomName,
            distance: ExternalMineState.getTargetPriorityDistance(sourceRoom, roomName),
            pending: this.countPendingEconomyTasks(sourceRoom, roomName),
        })));
    }

    // 清空本源房 spawn 池里「上一轮」的外矿经济任务。
    // 每轮派单都会按当前需求 + 先近后远重新铺一遍队列，残留旧任务必须先作废，
    // 否则：① 旧任务永远占着队头，「先近后远」只作用于追加位置、实际顺序仍是旧顺序；
    // ② 旧任务把单房挂单额度占满，新任务永远排不进去，外矿补员被整体冻结。
    // （线上实测：165 条挂单里 77 条是早期 level=15 的遗留搬运任务，
    //   结果所有外矿房 0 个采集工、补员一条都排不进来。）
    static clearPlannedEconomyMissions(sourceRoom: Room): number {
        const tasks = sourceRoom.getAllMissionFromPool?.('spawn') || [];
        let removed = 0;
        for (const task of [...tasks]) {
            const memory = this.getSpawnTaskMemory(task);
            if (!shouldDropPlannedMission(memory, sourceRoom.name)) continue;
            sourceRoom.deleteMissionFromPool('spawn', task.id);
            removed++;
        }
        return removed;
    }

    // 采集工挂单是否已达上限。采集工定编小、又是搬运的前置，
    // 所以额度独立：搬运队列排满也不能挡住采集工补员（否则断档后要等一整个搬运周期）。
    static isHarvestAtPendingCap(sourceRoom: Room, targetRoomName: string): boolean {
        const cap = getRoomMode(sourceRoom) === 'rush'
            ? this.OUTMINE_HARVEST_PENDING_CAP_RUSH
            : this.OUTMINE_HARVEST_PENDING_CAP;
        return this.countPendingMissions(sourceRoom, targetRoomName, OUTMINE_HARVEST_ROLE_SET)
            >= cap;
    }

    // 搬运工挂单是否已达上限。搬运工体型最大（RCL8 48 格 ≈144 tick），是最需要限流的一方。
    static isCarryAtPendingCap(sourceRoom: Room, targetRoomName: string): boolean {
        // rush 接力车道用 C4 微型件（300 能量 15-20t 孵化），单房占 spawn 风险低，
        // 挂单额度放大让车道密度快速到位
        const cap = getRoomMode(sourceRoom) === 'rush'
            ? this.OUTMINE_CARRY_PENDING_CAP_RELAY
            : this.OUTMINE_CARRY_PENDING_CAP;
        return this.countPendingMissions(sourceRoom, targetRoomName, OUTMINE_CARRY_ROLE_SET)
            >= cap;
    }

    // 统计某房间针对某目标房间的排队刷怪数量（仅本房间任务池）。
    private static getQueuedSpawnRoleNumByTarget(sourceRoom: Room, role: string, targetRoomName: string): number {
        const tasks = sourceRoom.getAllMissionFromPool('spawn') || [];
        let count = 0;
        for (const task of tasks) {
            const memory = this.getSpawnTaskMemory(task);
            if (!memory?.role) continue;
            if (memory.role !== role) continue;
            if ((memory.targetRoom || '') !== targetRoomName) continue;
            const taskSourceRoom = memory.sourceRoom;
            if (taskSourceRoom && taskSourceRoom !== sourceRoom.name) continue;
            count++;
        }
        return count;
    }

    // 统计全局所有房间针对某目标房间的排队刷怪数量（可选按 sourceRoom 过滤）。
    private static getQueuedSpawnRoleNumByTargetGlobal(role: string, targetRoomName: string, sourceRoomName?: string): number {
        let count = 0;
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room) continue;
            const tasks = room.getAllMissionFromPool('spawn') || [];
            for (const task of tasks) {
                const memory = this.getSpawnTaskMemory(task);
                if (!memory?.role) continue;
                if (memory.role !== role) continue;
                if ((memory.targetRoom || '') !== targetRoomName) continue;
                if (sourceRoomName) {
                    const taskSourceRoom = memory.sourceRoom;
                    if (taskSourceRoom && taskSourceRoom !== sourceRoomName) continue;
                }
                count++;
            }
        }
        return count;
    }

    // 统计全局某角色在目标房间的存活数量。
    private static getActiveRoleNumByTarget(role: string, targetRoomName: string): number {
        let count = 0;
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            if (!creep || creep.memory?.role !== role) continue;
            if (creep.memory?.targetRoom !== targetRoomName) continue;
            count++;
        }
        return count;
    }

    // 统计“本 tick 已经开始孵化，但尚未进入 Game.creeps 活体索引”的数量。
    // Screeps 的状态结算按 tick 延后，spawn 成功后任务会先从队列移除；
    // 若此时不补上 spawning 中的单位，就会出现 1 tick 的统计空窗，从而重复补单。
    private static getSpawningRoleNumByTargetGlobal(role: string, targetRoomName: string, sourceRoomName?: string): number {
        let count = 0;
        for (const spawnName in Game.spawns) {
            const spawn = Game.spawns[spawnName];
            const spawning = spawn?.spawning;
            if (!spawning?.name) continue;
            // 下一 tick creep 已经进入 Game.creeps 时，由 active 统计接管，避免重复计数。
            if (Game.creeps[spawning.name]) continue;

            const memory = Memory.creeps?.[spawning.name] as CreepMemory | undefined;
            if (!memory?.role) continue;
            if (memory.role !== role) continue;
            if ((memory.targetRoom || '') !== targetRoomName) continue;
            if (sourceRoomName) {
                const taskSourceRoom = memory.sourceRoom;
                if (taskSourceRoom && taskSourceRoom !== sourceRoomName) continue;
            }
            count++;
        }
        return count;
    }

    // 统计某房间自身任务池里某角色排队数量（不关心 targetRoom）。
    private static getQueuedSpawnRoleNumBySource(sourceRoom: Room, role: string): number {
        const tasks = sourceRoom.getAllMissionFromPool('spawn') || [];
        let count = 0;
        for (const task of tasks) {
            const memory = this.getSpawnTaskMemory(task);
            if (!memory?.role) continue;
            if (memory.role !== role) continue;
            if (memory.sourceRoom !== sourceRoom.name) continue;
            count++;
        }
        return count;
    }

    // spawnInAdvance：TTL 不足以再跑一趟（路程 + 缓冲）的
    // 采集者不计入覆盖数——接替者在其死亡前就提前孵化，新爬到场时老爬刚好耗尽，外矿不断档。
    private static getEffectiveOutHarvesterNum(sourceRoom: Room, targetRoomName: string): number {
        const travelTicks = getRoomTickCacheValue(sourceRoom, `out_harvest_travel_${targetRoomName}`, () =>
            ExternalMineState.estimateTargetSelectionStat(sourceRoom, targetRoomName).distance
        );
        const minUsefulTtl = travelTicks + 15; // 路程 + 缓冲：跑不完一趟的爬不再计入覆盖
        let count = 0;
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            if (!creep || creep.memory?.role !== 'out-harvest') continue;
            if (creep.memory?.targetRoom !== targetRoomName) continue;
            if (!this.isSameSourceRoom(creep.memory?.sourceRoom, sourceRoom.name)) continue;
            if ((creep.ticksToLive ?? 0) <= minUsefulTtl) continue;
            count++;
        }
        return count;
    }

    // 目标房内「所有存活」采集工数（不限 TTL / 不限源房）。
    // 工位硬上限必须按在场身体数算：换班期快死的爬仍占着工位，
    // 若沿用 getEffectiveOutHarvesterNum 的换班排除口径，会把超额新爬顶进满员房间（No source 根源）。
    private static getAllLiveOutHarvesterNum(targetRoomName: string): number {
        let count = 0;
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            if (!creep || creep.memory?.role !== 'out-harvest') continue;
            if (creep.memory?.targetRoom !== targetRoomName) continue;
            count++;
        }
        return count;
    }

    private static isSameSourceRoom(creepSourceRoom: string | undefined, sourceRoomName: string): boolean {
        if (!creepSourceRoom) return false;
        return creepSourceRoom === sourceRoomName;
    }

    // 侦查：全局与本房均只允许 1 个 scout，以避免重复探路。
    static scout(sourceRoom: Room, targetRoomName: string): boolean {
        const globalActive = this.getActiveRoleNumByTarget('scout', targetRoomName);
        const globalQueued = this.getQueuedSpawnRoleNumByTargetGlobal('scout', targetRoomName);
        if (globalActive + globalQueued > 0) return false;

        const activeSourceScouts = Object.values(Game.creeps).filter((creep) =>
            creep &&
            creep.memory?.role === 'scout' &&
            creep.memory.sourceRoom === sourceRoom.name
        ).length;
        const queuedSourceScouts = this.getQueuedSpawnRoleNumBySource(sourceRoom, 'scout');
        if (activeSourceScouts + queuedSourceScouts > 0) return false;

        const creepByTargetRoom = getCreepByTargetRoom(targetRoomName);
        const scouts = (creepByTargetRoom['scout'] || [])
            .filter((c: any) => this.isSameSourceRoom(c?.sourceRoom, sourceRoom.name)).length;
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'scout', targetRoomName);
        if (scouts + spawnNum > 0) return false;

        sourceRoom.SpawnMissionAdd('OS', [], this.PRIORITY.scout, 'scout', ExternalMineState.createMemory(sourceRoom.name, targetRoomName));
        return true;
    }

    // 常规外矿攻击者（单目标房最多 1 个）。
    static attack(sourceRoom: Room, targetRoom: Room): boolean {
        const globalActive = this.getActiveRoleNumByTarget('out-attack', targetRoom.name);
        const globalQueued = this.getQueuedSpawnRoleNumByTargetGlobal('out-attack', targetRoom.name);
        const globalSpawning = this.getSpawningRoleNumByTargetGlobal('out-attack', targetRoom.name);
        if (globalActive + globalQueued + globalSpawning >= 1) return false;

        const memory = ExternalMineState.createMemory(sourceRoom.name, targetRoom.name) as CreepMemory & { keeperLairIds?: string[] };
        const keeperLairIds = ExternalMineState.getTargetKeeperLairIds(targetRoom);
        if (keeperLairIds.length > 0) memory.keeperLairIds = keeperLairIds;
        sourceRoom.SpawnMissionAdd('OA', [], -1, 'out-attack', memory);
        return true;
    }

    static hasKeeperAttackCoverage(targetRoomName: string): boolean {
        const active = this.getActiveRoleNumByTarget('out-attack', targetRoomName);
        const queued = this.getQueuedSpawnRoleNumByTargetGlobal('out-attack', targetRoomName);
        const spawning = this.getSpawningRoleNumByTargetGlobal('out-attack', targetRoomName);
        return active + queued + spawning > 0;
    }

    // 远程攻击者（单目标房最多 1 个）。
    static ranged(sourceRoom: Room, targetRoom: Room): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerRanged = (creepByTargetRoom['out-ranged'] || [])
            .filter((c: any) => c.ticksToLive > 300 || c.spawning);
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-ranged', targetRoom.name);
        if (outerRanged.length + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('OR', [], -1, 'out-ranged', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

    // ── 外矿孵化容量准入（参考实现同款数学）──
    // 单位 = 身体部件数：B 件爬孵化耗 3B tick，每 spawn 每 1500t 窗口产 500×N 部件，
    // 即维持一只 B 件爬恰好消耗 B 单位/窗口。本地在编 + 本地排队单先扣预算，
    // 外矿（在编+排队+新单）占用不得超过剩余量：本地缺编时准入自动收缩为零，
    // 主房成长后外矿规模自动放大——早期照常开张，但不再抽干主房孵化产能。

    /** 任务体型折算部件数（空体型 = 角色默认配置；压缩串 = 解码后求和） */
    static resolveMissionBodyParts(sourceRoom: Room, role: string, body: ((BodyPartConstant | number)[])[] | string): number {
        const sumPairs = (pairs: any): number => {
            if (!Array.isArray(pairs)) return 0;
            let sum = 0;
            for (const item of pairs) {
                sum += Array.isArray(item) ? (Number(item[1]) || 0) : 1;
            }
            return sum;
        };
        if (typeof body === 'string') {
            if (!body) {
                const flat = sourceRoom.GenerateBodys(sourceRoom.GetRoleBodys(role as RoleId), role as RoleId);
                return flat?.length ?? 0;
            }
            return sumPairs(decompressBodyConfig(body));
        }
        return sumPairs(body);
    }

    /** 外矿准入判定：剩余孵化容量 ≥ 新单部件数 */
    static hasRemoteSpawnBudget(sourceRoom: Room, newParts: number): boolean {
        return this.getRemoteSpawnLeftover(sourceRoom) >= newParts;
    }

    /** 剩余外矿孵化容量（已扣本地计划编成与在编外务；负数 = 本地缺口，外矿全停） */
    static getRemoteSpawnLeftover(sourceRoom: Room): number {
        const LIFE = typeof CREEP_LIFE_TIME === 'number' ? CREEP_LIFE_TIME : 1500;
        const SPAWN_TIME = typeof CREEP_SPAWN_TIME === 'number' ? CREEP_SPAWN_TIME : 3;
        const capacity = Math.max(1, (sourceRoom.spawn || []).length) * Math.floor(LIFE / SPAWN_TIME);
        let localDemand = 0;
        let remoteUsed = 0;
        for (const creep of Object.values(Game.creeps)) {
            const role = creep?.memory?.role || '';
            if (!role) continue;
            if (role.startsWith('out-') || role === 'reserver') remoteUsed += creep.body.length;
            else if (role !== 'harvester') localDemand += creep.body.length;
        }
        const tasks = (sourceRoom.getAllMissionFromPool?.('spawn') || []) as any[];
        for (const task of tasks) {
            const role = task?.data?.memory?.role as string | undefined;
            if (!role) continue;
            const parts = this.resolveMissionBodyParts(sourceRoom, role, task?.data?.body);
            if (role.startsWith('out-') || role === 'reserver') remoteUsed += parts;
            else localDemand += parts;
        }
        // 本地源计划编成带距离因子（参考实现 computeSourceSpawnUsage 口径）：
        // 矿工补员率×路途折损 + 搬运吞吐×距离——源越远本地占预算越高，
        // harvester 在编部分由计划编成代表，不重复计入。
        // pathTime 钳制 60：同房源不可能超出（早期堵路/寻路抖动的坏采样会
        // 把权重虚增到百位级，直接饿死整个外矿准入）
        const timing = (sourceRoom.memory as any).sourceTiming ?? {};
        const sources = (sourceRoom.source || []) as Source[];
        for (const source of sources) {
            const rawPathTime = timing[source.id]?.pathTime ?? 20;
            const pathTime = Math.min(60, Math.max(10, Number(rawPathTime) || 20));
            localDemand += 7 * (LIFE / Math.max(200, LIFE - pathTime)) + pathTime * 0.04 * 10 * 2;
        }
        return capacity - localDemand - remoteUsed;
    }

    /** 外矿经济单统一入口：过容量准入闸再落单（战争/防御/侦察单不走此闸） */
    static addEconomyMission(sourceRoom: Room, name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, role: string, memory: any): boolean {
        if (!this.hasRemoteSpawnBudget(sourceRoom, this.resolveMissionBodyParts(sourceRoom, role, body))) return false;
        return sourceRoom.SpawnMissionAdd(name, body, level, role, memory) === OK;
    }

    // 外矿矿物采集（需要 RCL6+ 且单房仅 1 个）。
    static mineral(sourceRoom: Room, targetRoom: Room): boolean {
        if (sourceRoom.level < 6) return false;
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerMiners = (creepByTargetRoom['out-mineral'] || []).length;
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-mineral', targetRoom.name);
        if (outerMiners + spawnNum >= 1) return false;

        return this.addEconomyMission(sourceRoom, 'OMR', [], this.PRIORITY.mineral, 'out-mineral', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
    }

    // 常规防守：根据敌人种类/数量派遣 out-defend 或 out-invader。
    static defend(sourceRoom: Room, targetRoom: Room, hostiles: Creep[]): boolean {
        const invaderCore = targetRoom.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType === STRUCTURE_INVADER_CORE
        });

        if (invaderCore.length === 0 && hostiles.length === 0) return false;

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerDefenders = (creepByTargetRoom['out-defend'] || []).length;
        const outerInvaders = (creepByTargetRoom['out-invader'] || []).length;

        if (hostiles.length > 0) {
            const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-defend', targetRoom.name);
            let maxNum = 1;
            if (sourceRoom.level < 4) maxNum = 3;
            else if (sourceRoom.level < 6) maxNum = 2;
            if (outerDefenders + spawnNum >= maxNum) return false;
            sourceRoom.SpawnMissionAdd('OD', [], -1, 'out-defend', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        if (invaderCore.length > 0) {
            const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-invader', targetRoom.name);
            let maxNum = 1;
            if (sourceRoom.level < 4) maxNum = 4;
            else if (sourceRoom.level < 6) maxNum = 3;
            else if (sourceRoom.level === 6) maxNum = 2;
            if (outerInvaders + spawnNum >= maxNum) return false;
            sourceRoom.SpawnMissionAdd('OI', [], -1, 'out-invader', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        return false;
    }

    // 高等级的“双人防守”编队（out-2attack + out-2heal）。
    static doubleDefend(sourceRoom: Room, targetRoom: Room, hostiles: Creep[]): boolean {
        if (hostiles.length === 0) return false;

        if (sourceRoom.level < this.DOUBLE_DEFEND_MIN_LEVEL) {
            sourceRoom.deleteSpawnMissionsByRole(['out-2attack', 'out-2heal']);
            return this.defend(sourceRoom, targetRoom, hostiles);
        }

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const out2Attack = (creepByTargetRoom['out-2attack'] || []).length || 0;
        const out2AttackSpawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-2attack', targetRoom.name);
        if (out2Attack + out2AttackSpawnNum >= 1) return false;
        const out2Heal = (creepByTargetRoom['out-2heal'] || []).length;
        const out2HealSpawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-2heal', targetRoom.name);
        if (out2Heal + out2HealSpawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('', [], -1, 'out-2attack', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        sourceRoom.SpawnMissionAdd('', [], -1, 'out-2heal', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

    // 外矿采集者：根据源数、站位上限与 body 配置决定目标数量。
    // targetRoom 可为 null（无视野）：此时优先用 scout 记录的工位数做离线口径；
    // 拿不到记录就退回「源数 × 每源编制」补给——绝不因视野丢失而停发采集工，
    // 否则外矿一次视野间隙（采集工死光 → 没视野 → 不再补位）就会整体停摆。
    static harvester(sourceRoom: Room, targetRoom: Room | null, targetRoomName: string, sourceNum: number, upbody?: boolean, slotCapOverride?: number): boolean {
        let slotCap: number | null;
        if (targetRoom) {
            slotCap = ExternalMineMath.getOutHarvesterSlotCap(targetRoom);
        } else if (typeof slotCapOverride === 'number') {
            slotCap = slotCapOverride;
        } else {
            slotCap = ExternalMineMath.getRecordedOutHarvesterSlotCap(targetRoomName);
        }
        const targetNum = ExternalMineMath.calcOutHarvesterTargetNum(sourceRoom, sourceNum, upbody, slotCap ?? undefined);
        if (targetNum <= 0) return false;

        // 采集工挂单上限：本房已排够采集任务就本轮不补，把 spawn 让给其它外矿房，
        // 否则一房会把定编一次性塞满队列、独占总 spawn。
        if (this.isHarvestAtPendingCap(sourceRoom, targetRoomName)) return false;

        // 多母房共享同一个 targetRoom 时，OH 数量只按 targetRoom 全局控制，
        // 不再按 sourceRoom 各自算一遍，避免多个源房叠加超孵化。
        // spawnInAdvance：快死的采集者不计入覆盖——接替者提前孵化，外矿不断档
        const globalEffective = this.getEffectiveOutHarvesterNum(sourceRoom, targetRoomName);
        const globalQueued = this.getQueuedSpawnRoleNumByTargetGlobal('out-harvest', targetRoomName);
        const globalSpawning = this.getSpawningRoleNumByTargetGlobal('out-harvest', targetRoomName);
        if (globalEffective + globalQueued + globalSpawning >= targetNum) return false;
        // 工位闸用「所有存活 + 排队 + 孵化中」：换班排除只服务于定编覆盖，不作用于工位上限
        if (slotCap !== null && slotCap > 0) {
            const globalAllLive = this.getAllLiveOutHarvesterNum(targetRoomName);
            if (globalAllLive + globalQueued + globalSpawning >= slotCap) return false;
        }

        const memory = ExternalMineState.createMemory(sourceRoom.name, targetRoomName);
        // 换班接力：目标房还有本源房的采集工在岗、但 TTL 覆盖已不足——
        // 接替孵化必须抢在本地 worker 之前，否则排队时间让老爬先死，采集断档、
        // 搬运工集体闲置（无缝接力的核心）。
        const isReplacement = this.getAllLiveOutHarvesterNum(targetRoomName) > 0;
        const rushPipelineLevel = getRoomMode(sourceRoom) === 'rush'
            ? this.OUTMINE_RUSH_HARVEST_LEVEL
            : this.OUTMINE_HARVEST_PIPELINE_LEVEL;
        // rush 换班也让位升级（L9）：换班单 E700 比升级体型 E750 便宜，若留在 L5
        // 会把 extension 永远压在 700 以下，升级工饿死（单 spawn 优先级霸权）。
        // 代价：换班延迟到升级池清空的窗口，采集短暂断档后恢复。
        const replaceLevel = isReplacement
            ? (getRoomMode(sourceRoom) === 'rush' ? this.OUTMINE_RUSH_CARRY_LEVEL : this.OUTMINE_REPLACEMENT_LEVEL)
            : rushPipelineLevel;
        if (upbody) {
            return this.addEconomyMission(sourceRoom, 'OH', [[WORK, 16], [CARRY, 6], [MOVE, 8]], replaceLevel, 'out-harvest', memory);
        } else {
            // 体型按当前预算最大化（WORK 优先补到 5、move 保持 0.5 机动比、
            // 自带 1 CARRY 自补）——LOW/CRITICAL 时预算取当前可用能量（
            // 饥荒期也要出得起小体型，[W2,M1,C1] 仍有 4/tick 产出），否则全款体型
            // 在贫困房永远攒不齐，外矿会集体老死断供（死亡螺旋）；
            // 每轮派单都按当时预算重新生成，能量回升自动出满配 5W。
            // rush 例外：缩水体是「低效循环」——小体型运/采同一吞吐要更多只、
            // 孵化排队更久、房间更穷；rush 的升级抽水不该让收入引擎降级。
            const energyState = ExternalMineState.getEnergyState(sourceRoom);
            const rushMode = getRoomMode(sourceRoom) === 'rush';
            const energyBudget = (!rushMode && (energyState === 'LOW' || energyState === 'CRITICAL'))
                ? Math.max(300, sourceRoom.energyAvailable)
                : sourceRoom.energyCapacityAvailable;
            // rush 不带自携 CARRY（[W5,M1,C1]=600 > 550，装箱成 [W4,C1,M2] →
            // perSource=ceil(5/4)=2 超编挖）：掉落由外矿车队收取，
            // 550 恰好 [W5,M1] 满效 10e/t，每源 1 只定编
            const body = buildRemoteMinerBody(energyBudget, 5, !rushMode);
            return this.addEconomyMission(sourceRoom, 'OH', body, replaceLevel, 'out-harvest', memory);
        }
    }

    // 外矿运输者：只孵 out-carry（旧 out-car 角色已退役删除）。
    static carry(sourceRoom: Room, targetRoom: Room, num: number): boolean {
        // 决策轨迹：拒绝原因进环形缓冲，诊断采样读取（定位搬运断供）
        const trace = (reason: string): false => {
            const g = global as any;
            const buf = g.__carryTrace ?? (g.__carryTrace = []);
            buf.push({ t: Game.time, room: targetRoom.name, why: reason });
            if (buf.length > 12) buf.shift();
            return false;
        };
        // 在场产出闸：目标房必须有「正在产出」的采集工（在场且有采集能力）才派搬运。
        // 在途/排队的采集工不算——到场前没有产出，先派搬运只会空跑一趟。
        // 采集工断档期：排队中的搬运任务由每轮重铺自然清空（clearPlannedEconomyMissions），
        // 在场存量搬运工照常把容器余量搬完，采集工到场后下一轮即恢复派送。
        if (!ExternalMineAnalysis.getOnSiteHarvesterRoomSet(sourceRoom).has(targetRoom.name)) {
            return trace('no-on-site-harvester');
        }

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerCarry = (creepByTargetRoom['out-carry'] || [])
            .filter((c: any) => c.sourceRoom === sourceRoom.name).length;

        const spawnCarryNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-carry', targetRoom.name);
        // 体型按当前预算最大化 CARRY（走路段 [C,C,M] 整组扩展）——LOW/CRITICAL 时
        // 预算取当前可用能量（同采集工口径：贫困房也要出得起小搬运，能量回升
        // 每轮派单自动升回满配）。rush 例外：抽水造成的 LOW 不降级收入引擎，
        // 否则小体型搬运 → 同吞吐要更多只 → 队列更堵 → 更穷的螺旋。
        // 接力定尺（对齐参考实现 RELAY_HAULER_CARRY_SIZE=4）：rush（lv<7 恒接力）
        // 用微型件 [C4,M2]=200 容量——接力链靠相向交接让货物单 tick 前进两格，
        // 单位密度 > 单件容量；lv≥7 直运大件（maxCarry 16，来回整坑）。
        // 体型按当前可用能量出（参考实现 haulerEnergyCapacity=room.energyAvailable），
        // LOW/CRITICAL 时小件保底、能量回升自动升回满配（rush 抽水造成的 LOW 不降级）。
        const energyState = ExternalMineState.getEnergyState(sourceRoom);
        const carryRush = getRoomMode(sourceRoom) === 'rush';
        const energyBudget = carryRush
            ? Math.max(150, sourceRoom.energyAvailable)
            : (energyState === 'LOW' || energyState === 'CRITICAL')
                ? Math.max(150, sourceRoom.energyAvailable)
                : sourceRoom.energyCapacityAvailable;
        const carryBody = buildHaulerBodyConfig(energyBudget, { forRoad: true, maxCarry: carryRush ? 4 : 16 });

        const totalCarry = outerCarry + spawnCarryNum;
        // 车队上限：接力链按吞吐定编（num 自适应），绝对上限只防病态堆积
        const fleetCap = 24;
        if (totalCarry < Math.min(num, fleetCap)) {
            // 搬运工挂单上限：体型最大（RCL8 48 格 ≈144 tick），不设限就会一房独占 spawn。
            if (this.isCarryAtPendingCap(sourceRoom, targetRoom.name)) return trace('pending-cap');
            const carryLevel = getRoomMode(sourceRoom) === 'rush'
            ? (this.isCarryFamine(sourceRoom, targetRoom.name)
                ? this.OUTMINE_RUSH_CARRY_FAMINE_LEVEL
                : this.OUTMINE_RUSH_CARRY_LEVEL)
            : this.OUTMINE_CARRY_PIPELINE_LEVEL;
            const admitted = this.addEconomyMission(sourceRoom, 'OC', carryBody, carryLevel, 'out-carry', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return admitted ? true : trace('budget');
        }

        return trace(`satisfied(${totalCarry}>=${Math.min(num, fleetCap)})`);
    }

    // 外矿积压是否处于严重饥荒：可用积压（扣除在场搬运预定）过严重线。
    // 饥荒期 OC 升层重建、建造派单让位——能量优先回流收入管线。
    private static isCarryFamine(sourceRoom: Room, targetRoomName: string): boolean {
        const backlog = ExternalMineAnalysis.getManagedRoomBacklogMap(sourceRoom)[targetRoomName] ?? 0;
        return backlog >= EXTERNAL_MINE_ANALYSIS.SEVERE_BACKLOG_THRESHOLD
            * getRoomModeProfile(sourceRoom).remoteCarryBacklogScale;
    }

    // 外矿预定：仅在目标未被占领、且自家预定不足时派遣。
    static reserver(sourceRoom: Room, targetRoom: Room): boolean {
        if (!targetRoom.controller || targetRoom.controller.my) return false;
        if (sourceRoom.controller.level < 3) return false;

        if (targetRoom.controller.reservation &&
            targetRoom.controller.reservation.username === sourceRoom.controller.owner.username &&
            targetRoom.controller.reservation.ticksToEnd > 1000) return false;

        const outerReservers = this.getActiveRoleNumByTarget('reserver', targetRoom.name);
        const spawnNum = this.getQueuedSpawnRoleNumByTargetGlobal('reserver', targetRoom.name);
        if (outerReservers + spawnNum >= 1) return false;

        // rush 预定提级（L6，升级之前）：reservation 决定 source 容量（有预定 3000/无 1500，
        // 砍半），是外矿收入的倍增器——垫底 L11 会在孵化繁忙期永久饿死
        const reserveLevel = getRoomMode(sourceRoom) === 'rush' ? 6 : this.PRIORITY.reserver;
        return this.addEconomyMission(sourceRoom, '', '', reserveLevel, 'reserver', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
    }

    private static getBuilderConstructionTargets(targetRoom: Room): ConstructionSite[] {
        return targetRoom.find(FIND_CONSTRUCTION_SITES, {
            filter: (site) => site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER
        }) as ConstructionSite[];
    }

    private static getBuilderRepairTargets(targetRoom: Room): Structure[] {
        return targetRoom.find(FIND_STRUCTURES, {
            filter: (structure) =>
                (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) &&
                structure.hits < structure.hitsMax * 0.8
        }) as Structure[];
    }

    private static getBuilderWorkCount(targetRoom: Room): number {
        return this.getBuilderConstructionTargets(targetRoom).length + this.getBuilderRepairTargets(targetRoom).length;
    }

    // 外矿建造者：道路/容器存在施工或维修需求时派遣。
    // 不分配 targetSourceId——运行时按「离当前工作目标最近的源」动态取能
    // （见 out-build.ts 的 getAssignedSource），采建同侧、不跨源绑定。
    static builder(sourceRoom: Room, targetRoom: Room): boolean {
        // 运力饥荒让位：外矿积压过严重线时暂停建造派单，spawn 周期让给 OC 重建
        //（路网/容器再投资在积压消化后自然恢复——builder 按工地存在性自限）
        if (this.isCarryFamine(sourceRoom, targetRoom.name)) return false;
        const constructionTargets = this.getBuilderConstructionTargets(targetRoom);
        const repairTargets = this.getBuilderRepairTargets(targetRoom);
        const workCount = constructionTargets.length + repairTargets.length;
        if (workCount === 0) return false;
        const repairOnly = constructionTargets.length === 0 && repairTargets.length > 0;

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerBuilder = (creepByTargetRoom['out-build'] || []).length;
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-build', targetRoom.name);

        let num = 1;
        if (!repairOnly && workCount > 10) num = 2;
        if (outerBuilder + spawnNum >= num) return false;

        const memory = ExternalMineState.createMemory(sourceRoom.name, targetRoom.name) as CreepMemory & {
            outBuildMode?: 'repair';
        };
        if (repairOnly) memory.outBuildMode = 'repair';

        // rush 下 out-build 提到 9（与搬运同层、插队层内）：远程道路/容器是运力引擎，
        // L12 在「等待高优先级能量」语义下永远轮不到（升级池常驻有任务）。
        // 任务本身按工地存在性自限（没工地不下单），提级不会造成空转孵化。
        const buildLevel = getRoomMode(sourceRoom) === 'rush' ? 9 : this.PRIORITY.build;
        // 显式体型：out-build 无 RoleLevelData 分级表，空 body 会被孵化端按 Infinity
        // 成本跳过（结构性无法孵化）。rush 不缩水——建造力就是运力引擎本身。
        const energyState = ExternalMineState.getEnergyState(sourceRoom);
        const buildRush = getRoomMode(sourceRoom) === 'rush';
        const buildBudget = (!buildRush && (energyState === 'LOW' || energyState === 'CRITICAL'))
            ? Math.max(300, sourceRoom.energyAvailable)
            : sourceRoom.energyCapacityAvailable;
        return this.addEconomyMission(sourceRoom, 'OB', buildOutBuildBody(buildBudget), buildLevel, 'out-build', memory);
    }
}

// 外矿入口类：调度能量外矿与中心房外矿的整体流程。
export class ExternalMine {
    // 每个 tick 的准备阶段：防守与战争态短路、清理无效任务、修正优先级。
    static prepareRoom(room: Room): string | null {
        if (room.memory.defend) return null;
        if (Memory['warmode']) return null;

        const qosLevel = ExternalMineState.getQosLevel();
        if (qosLevel === 'emergency') return null;
        return qosLevel;
    }

    // 外矿相关可视化。
    static runVisuals(): void {
        ExternalMineState.runVisuals();
    }

    // 对外暴露房间模式读取接口（兼容旧调用）。
    static getRoomMode(room: Room): string {
        return ExternalMineState.getRoomMode(room);
    }

    // 对外暴露：本源房当前托管的目标房列表（供跨房搬运重平衡复用同一份选择结果）。
    // 背包选择本身不便宜，按 tick 缓存，避免每个搬运工每 tick 重算一次。
    static getManagedTargetRooms(room: Room, key: OutMineTargetListKey): string[] {
        return getRoomTickCacheValue(room, `outmine_managed_targets_${key}`, () =>
            ExternalMineState.getManagedTargets(room, key));
    }

    // 常规外矿：能量采集、运输、防守、预定与建造。
    // 采集/搬运不设容量门槛（小体型自带 CARRY 也能有效产出，
    // 废体型与队列淹没已由「不缩水 + 采集优先级 12>13 + 在场产出闸」根治）；
    // 建造侧的门槛由 EXTERNAL_ROAD_CONFIG 的 RCL 限制承担。
    // 不设能量状态硬门（参考实现同口径）：外矿规模由孵化容量准入预算统一约束
    //（本地计划编成含距离因子先扣，外矿占剩余量）——状态门会连搬运工一起拦死，
    // 收入管道断流反而把 CRITICAL 固化成贫困循环（实测 2.9 万能量搁置外房、家里饿死）。
    static runEnergy(room: Room, timing: ExternalMineTiming): void {
        const runState = ExternalMineState.getRunState(timing);
        if (!runState) return;
        // 控制器容器保活不受任何闸门限制：饥荒期恰恰是升级链最依赖容器的时刻
        //（参考实现每 tick 无条件放工地，不吃能量状态门）
        RoadBuilder.ensureControllerContainer(room);
        // 开局序列（参考实现观察口径）：先矿工满编、产出稳住，之后才解锁外矿扩张。
        // 硬闸清池：光挡新单不够——池内残留的 out-*/reserver 挂单仍会抢占 spawn 槽
        if (isRaceCompat() && !isRoomProductionSecured(room)) {
            const pool = (room.getAllMissionFromPool?.('spawn') || []) as any[];
            for (const task of pool) {
                const role = task?.data?.memory?.role as string | undefined;
                if (role && (role.startsWith('out-') || role === 'reserver')) {
                    room.deleteMissionFromPool?.('spawn', task.id);
                }
            }
            return;
        }

        let targetRooms = ExternalMine.getManagedTargetRooms(room, 'energy');

        // rush 自动扩图：目标不足时自动把一圈相邻房间加入列表（幂等），上限 4 个
        if (ExternalMine.getRoomMode(room) === 'rush' && targetRooms.length < 4
            && runState.canRunSecondaryAction && isRoomTickAligned(room.name, 100, 7)) {
            targetRooms = ExternalMineState.autoAddNearbyEnergyTargets(room.name, targetRooms);
        }

        if (targetRooms.length <= 0) return;

        // 目标房容量背包（参考实现 getActiveSources 口径）：按 value/weight 降序准入，
        // 预算装不下的房本轮挂起——把产能集火到最优房的容器/路/接力链上养熟，
        // 而不是摊薄到一串半成品管线（每房都缺搬运、缺容器、接力密度不足）。
        // 300t 滞回：预算逐 tick 波动会让准入名单横跳，基建（路/容器）需要连续投入
        if (targetRooms.length > 1) {
            const memAny = room.memory as any;
            const cached = memAny.remoteKept as { tick: number; rooms: string[] } | undefined;
            if (!cached || !cached.rooms?.length || Game.time - cached.tick > 300) {
                const scored = targetRooms.map((name) => ({ name, stat: ExternalMineState.estimateTargetSelectionStat(room, name) }))
                    .sort((a, b) => (b.stat.value / b.stat.weight) - (a.stat.value / a.stat.weight));
                let budget = ExternalMineSpawner.getRemoteSpawnLeftover(room);
                const kept: string[] = [];
                for (const entry of scored) {
                    if (kept.length === 0 || entry.stat.weight <= budget) {
                        kept.push(entry.name);
                        budget -= entry.stat.weight;
                    }
                }
                memAny.remoteKept = { tick: Game.time, rooms: kept };
            }
            const keptNames = (cached?.rooms ?? []).filter((n: string) => targetRooms.includes(n));
            if (keptNames.length > 0) targetRooms = keptNames;
        }

        // 不可达扇区清理：绑定到 novice/respawn/closed 房间的外矿 creep 永远到不了岗，
        // 会一直堆在扇区边界（表现为「完全不派出」）——直接回收，孵化侧也不再往这些房间派
        for (const creep of Object.values(Game.creeps)) {
            if (!creep?.my || !creep.memory?.targetRoom) continue;
            const role = String(creep.memory.role || '');
            if (!role.startsWith('out-') && role !== 'reserver') continue;
            if (isRoomReachable(creep.memory.targetRoom)) continue;
            creep.suicide();
        }

        // 补员派单顺序：先近后远 + 挂单少的先派（见 orderTargetsForSpawn）。
        // 配合每房挂单上限，单房无法占满 spawn，队列在多个外矿房之间轮转。
        // 注意：外矿侦查/离线补员也走这个顺序，保证近房先建立视野与工位记录。
        const orderedTargets = ExternalMineSpawner.orderTargetsForSpawn(room, targetRooms);

        // rush 渐进扩图（外矿建设并发受限、先近后远）：活跃外矿数随 RCL 增长
        // （RCL3→4 房、RCL4→5……上限 8）。
        // 一次全开 8 房时，道路工地 + 16 只编制的补员需求（全是 L9）会形成永久任务流，
        // 把主房采集/升级挤死（race 实测：人口崩到 20、控制器容器断粮）。
        // 未激活房间保留在注册表里，RCL 提升后自动扩容。
        const maxActiveTargets = ExternalMine.getRoomMode(room) === 'rush'
            ? Math.min(orderedTargets.length, Math.max(4, room.level + 1))
            : orderedTargets.length;
        const activeTargets = orderedTargets.slice(0, maxActiveTargets);

        // 队列 = 本轮需求：先作废上一轮的外矿经济挂单，再按上面的顺序重新铺。
        // 不做这一步，「先近后远」只会作用于队尾，队头永远是历史遗留顺序（线上即如此）。
        ExternalMineSpawner.clearPlannedEconomyMissions(room);

        for (const roomName of activeTargets) {
            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) {
                if (runState.canRunSecondaryAction) {
                    ExternalMineSpawner.scout(room, roomName);
                }

                // 无视野也必须补采集工：否则采集工死光 → 视野丢失 → 永远不再补位，外矿整体停摆。
                // 用 scout 到访时记下的源数/工位数做离线口径（Memory.rooms 持久，重启不丢）；
                // 从未被记录过就退回「进程内最后已知源数，缺省 2」，宁可按估算补也不断档。
                const recordedSlots = readRecordedSourceSlotCounts(roomName);
                if (recordedSlots && recordedSlots.length > 0) {
                    const offlineSlotCap = recordedSlots.reduce((a, b) => a + b, 0);
                    ExternalMineSpawner.harvester(room, null, roomName, recordedSlots.length, undefined, offlineSlotCap);
                } else {
                    ExternalMineSpawner.harvester(room, null, roomName, lastKnownSourceNum.get(roomName) ?? 2);
                }
                continue;
            }

            // 有视野：顺手刷新工位记录（道路/容器落成会改变可站位数），保持离线口径新鲜
            if (!targetRoom.memory.sourcePosCount) recordSourceSlotCounts(targetRoom);

            ExternalMineState.tryBuildRoad(room, targetRoom, EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL, runState.canRunSecondaryAction);

            const sourceNum = targetRoom.source?.length || targetRoom.find(FIND_SOURCES).length || 0;
            if (sourceNum === 0) continue;
            lastKnownSourceNum.set(roomName, sourceNum);

            // CPU 桶闭环（Tier 1-3）：桶紧张时按性价比挂起低分外矿
            const activeThreshold = getActiveRemoteThreshold();
            if (activeThreshold > 0 && room.level >= 4) {
                const stat = ExternalMineState.estimateTargetSelectionStat(room, roomName);
                if (stat.score < activeThreshold) continue;
            }

            const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
                filter: (c) => (
                    (c.owner.username === 'Invader' ||
                    c.owner.username === 'Source Keeper' ||
                    c.getActiveBodyparts(ATTACK) > 0 ||
                    c.getActiveBodyparts(RANGED_ATTACK) > 0) &&
                    !c.isWhiteList()
                )
            });

            const hasPlayerThreat = hostiles.some(c => {
                if (c.owner.username === 'Invader') return false;
                if (c.owner.username === 'Source Keeper') return false;
                return true;
            });

            if (hasPlayerThreat) {
                ExternalMineSpawner.doubleDefend(room, targetRoom, hostiles);
            } else {
                ExternalMineSpawner.defend(room, targetRoom, hostiles);
            }

            if (hostiles.length > 0) continue;

            const controller = targetRoom.controller;
            const myUserName = room.controller.owner.username;
            if (controller?.owner && controller.owner.username !== myUserName) continue;

            // 预定是外矿经济主链，不应被 secondary-action 节流掉。
            if (room.level >= 3) {
                ExternalMineSpawner.reserver(room, targetRoom);
            }

            if (controller.reservation &&
                controller.reservation.username !== myUserName) continue;

            ExternalMineSpawner.harvester(room, targetRoom, roomName, sourceNum);

            const carryCapacity = ExternalMineMath.getOutCarryCapacity(room);
            const carryNum = ExternalMineMath.calcEnergyOutCarryTarget(room, targetRoom, sourceNum, false, carryCapacity);
            ExternalMineSpawner.carry(room, targetRoom, carryNum);

            ExternalMineSpawner.builder(room, targetRoom);
        }
    }

    // 中心房外矿：包含 SK/中心房的高强度采集与矿物采集逻辑。
    // 无能量状态硬门（同 runEnergy：外矿规模由孵化容量准入预算统一约束）。
    static runCenter(room: Room, timing: ExternalMineTiming): void {
        const runState = ExternalMineState.getRunState(timing);
        if (!runState) return;

        const targetRooms = ExternalMine.getManagedTargetRooms(room, 'centerRoom');
        if (targetRooms.length <= 0) return;

        // 同 runEnergy：先近后远 + 挂单少的先派，避免单房独占总 spawn。
        const orderedTargets = ExternalMineSpawner.orderTargetsForSpawn(room, targetRooms);

        // 同 runEnergy：先作废上一轮外矿经济挂单，队列 = 本轮需求（先近后远）。
        ExternalMineSpawner.clearPlannedEconomyMissions(room);

        for (const roomName of orderedTargets) {
            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) {
                if (runState.canRunSecondaryAction) {
                    ExternalMineSpawner.scout(room, roomName);
                }

                // 无视野：用 scout 记录的源数/工位数做离线 OH 孵化检查（upbody 固定高配）
                const recordedSlots = readRecordedSourceSlotCounts(roomName);
                if (recordedSlots && recordedSlots.length > 0) {
                    const offlineSlotCap = recordedSlots.reduce((a, b) => a + b, 0);
                    ExternalMineSpawner.harvester(room, null, roomName, recordedSlots.length, true, offlineSlotCap);
                }
                continue;
            }

            ExternalMineState.tryBuildRoad(room, targetRoom, EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL, runState.canRunSecondaryAction);

            const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
                filter: (creep) => !Memory['whitelist']?.includes(creep.owner.username)
            });
            const dangerousHostiles = hostiles.filter((creep) =>
                creep.owner.username !== 'Source Keeper' &&
                (creep.getActiveBodyparts(ATTACK) > 0 || creep.getActiveBodyparts(RANGED_ATTACK) > 0)
            );

            if (dangerousHostiles.length > 0) {
                ExternalMineSpawner.doubleDefend(room, targetRoom, dangerousHostiles);
                continue;
            }

            if (ExternalMineState.isKeeperCenterRoom(roomName)) {
                const hasKeeperCoverage = ExternalMineSpawner.hasKeeperAttackCoverage(targetRoom.name);
                ExternalMineSpawner.attack(room, targetRoom);
                if (!hasKeeperCoverage) continue;
            }

            const sourceNum = targetRoom.source?.length || targetRoom.find(FIND_SOURCES).length || 0;
            if (sourceNum <= 0) continue;

            // CPU 桶闭环（Tier 1-3）：桶紧张时按性价比挂起低分中心房外矿
            const activeThresholdCenter = getActiveRemoteThreshold();
            if (activeThresholdCenter > 0 && room.level >= 4) {
                const stat = ExternalMineState.estimateTargetSelectionStat(room, roomName);
                if (stat.score < activeThresholdCenter) continue;
            }
            ExternalMineSpawner.harvester(room, targetRoom, roomName, sourceNum, true);

            const mineral = targetRoom[FIND_MINERALS] || targetRoom.find(FIND_MINERALS)[0];
            if (mineral && mineral.mineralAmount > 0) {
                ExternalMineSpawner.mineral(room, targetRoom);
            }

            const carryCapacity = ExternalMineMath.getOutCarryCapacity(room);
            const carryNum = ExternalMineMath.calcEnergyOutCarryTarget(room, targetRoom, sourceNum, false, carryCapacity);
            ExternalMineSpawner.carry(room, targetRoom, carryNum);

            ExternalMineSpawner.builder(room, targetRoom);
        }
    }
}
