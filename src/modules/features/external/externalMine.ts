import { EXTERNAL_ROAD_CONFIG } from '@/constant/config';
import { getActiveRemoteThreshold } from '@/infra/bucketGovernor';
import { RoleData } from '@/constant/CreepConstant';
import { RoadBuilder, RoadMemory, RoadVisual } from '@/modules/features/external/externalRoad';
import { HighwayMineVisual } from '@/shared/highwayMineVisual';
import { getCreepByTargetRoom } from '@/shared/creepTickIndex';
import { getOutMineData, getRoomData } from '@/shared/memory';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

// 目标房间列表的类型：普通外矿（能量）与中心房（SK/中心区）外矿。
type OutMineTargetListKey = 'energy' | 'centerRoom';

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

// 外矿运行的状态工具：QoS、房间模式、节流、以及视觉渲染。
class ExternalMineState {
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
    private static readonly LOW_STATE_HIGH_MODE_ENERGY_TARGET_LIMIT = 2;
    private static readonly LOW_STATE_DEFAULT_ENERGY_TARGET_LIMIT = 1;
    private static readonly CRITICAL_STATE_ENERGY_TARGET_LIMIT = 1;
    private static readonly LOW_MODE_MAX_REMOTE_BUDGET = 140;
    private static readonly LOW_STATE_REMOTE_BUDGET_MULTIPLIER = 0.7;
    private static readonly CRITICAL_STATE_REMOTE_BUDGET_MULTIPLIER = 0.4;
    private static readonly SURPLUS_STATE_REMOTE_BUDGET_MULTIPLIER = 1.1;
    private static readonly REMOTE_QUEUE_ROLE_SET = new Set([
        'scout',
        'reserver',
        'out-harvest',
        'out-carry',
        'out-car',
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
        return mode === 'high' || mode === 'rush';
    }

    private static getEnergyState(room: Room): ExternalMineEnergyState {
        return room.getEnergyState?.() || room.updateEnergyState?.(false) || room.memory.energyState || 'UNKNOWN';
    }

    private static getTargetPriorityDistance(sourceRoom: Room, targetRoomName: string): number {
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

        type KnapsackEntry = {
            value: number;
            totalWeight: number;
            energyCount: number;
            rooms: string[];
        };

        const budget = Math.max(0, Math.floor(policy.remoteBudget));
        const table: Array<KnapsackEntry | null> = Array.from({ length: budget + 1 }, () => null);
        table[0] = { value: 0, totalWeight: 0, energyCount: 0, rooms: [] };

        const betterThan = (candidate: KnapsackEntry, current: KnapsackEntry | null): boolean => {
            if (!current) return true;
            if (candidate.value > current.value + 0.0001) return true;
            if (current.value > candidate.value + 0.0001) return false;
            if (candidate.totalWeight < current.totalWeight) return true;
            if (candidate.totalWeight > current.totalWeight) return false;
            if (candidate.rooms.length > current.rooms.length) return true;
            if (candidate.rooms.length < current.rooms.length) return false;
            return candidate.rooms.join(',') < current.rooms.join(',');
        };

        for (const stat of allowedStats) {
            const requiredWeight = Math.max(1, Math.ceil(stat.weight));
            if (requiredWeight > budget) continue;
            for (let currentBudget = budget; currentBudget >= requiredWeight; currentBudget -= 1) {
                const previous = table[currentBudget - requiredWeight];
                if (!previous) continue;
                const nextEnergyCount = previous.energyCount + (stat.kind === 'energy' ? 1 : 0);
                if (Number.isFinite(policy.energyTargetLimit) && nextEnergyCount > policy.energyTargetLimit) continue;
                const candidate: KnapsackEntry = {
                    value: previous.value + stat.value,
                    totalWeight: previous.totalWeight + requiredWeight,
                    energyCount: nextEnergyCount,
                    rooms: [...previous.rooms, stat.roomName],
                };
                if (betterThan(candidate, table[currentBudget])) {
                    table[currentBudget] = candidate;
                }
            }
        }

        let best = table.find((entry) => !!entry) || null;
        for (const entry of table) {
            if (entry && betterThan(entry, best)) best = entry;
        }

        const selectedSet = new Set(best?.rooms || []);
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

    private static getTargetPolicy(sourceRoom: Room): ExternalMineTargetPolicy {
        const mode = this.getRoomMode(sourceRoom);
        const energyState = this.getEnergyState(sourceRoom);
        const spawnUsageCapacity = this.getSpawnUsageCapacity(sourceRoom);
        const localSpawnReserve = this.getLocalSpawnReserve(sourceRoom);
        let remoteBudget = Math.max(0, spawnUsageCapacity - localSpawnReserve);

        if (energyState === 'LOW') {
            remoteBudget = Math.floor(remoteBudget * this.LOW_STATE_REMOTE_BUDGET_MULTIPLIER);
        } else if (energyState === 'CRITICAL') {
            remoteBudget = Math.floor(remoteBudget * this.CRITICAL_STATE_REMOTE_BUDGET_MULTIPLIER);
        } else if (energyState === 'SURPLUS') {
            remoteBudget = Math.floor(remoteBudget * this.SURPLUS_STATE_REMOTE_BUDGET_MULTIPLIER);
        }

        if (mode === 'low') {
            remoteBudget = Math.min(remoteBudget, this.LOW_MODE_MAX_REMOTE_BUDGET);
        }

        let energyTargetLimit = this.DEFAULT_ENERGY_TARGET_LIMIT;
        if (mode === 'low') {
            energyTargetLimit = this.LOW_MODE_ENERGY_TARGET_LIMIT;
        }

        if (energyState === 'LOW') {
            const lowStateLimit = this.isHighLikeMode(mode)
                ? this.LOW_STATE_HIGH_MODE_ENERGY_TARGET_LIMIT
                : this.LOW_STATE_DEFAULT_ENERGY_TARGET_LIMIT;
            energyTargetLimit = Math.min(energyTargetLimit, lowStateLimit);
        }

        if (energyState === 'CRITICAL') {
            energyTargetLimit = Math.min(energyTargetLimit, this.CRITICAL_STATE_ENERGY_TARGET_LIMIT);
        }

        return {
            mode,
            energyState,
            remoteBudget,
            energyTargetLimit,
            allowCenterRoom: energyState !== 'LOW' && energyState !== 'CRITICAL',
        };
    }

    // 兼容多处存储路径读取房间模式（更高优先级的配置优先）。
    static getRoomMode(room: Room): string {
        const roomData = getRoomData(room.name);
        const legacyRoomMemory = room.memory as LegacyRoomModeMemory;
        return roomData?.mode || legacyRoomMemory.mode || 'main';
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

    // 同一个源房的 energy / centerRoom 旧桶数据可能串味；
    // 这里统一按“房名是否属于 center room”重新分类，避免同一目标被两条分支重复处理。
    static getManagedTargets(sourceRoom: Room, key: OutMineTargetListKey): string[] {
        const data = getOutMineData(sourceRoom.name);
        const mergedTargets = [
            ...this.getTargetList(data, 'energy'),
            ...this.getTargetList(data, 'centerRoom'),
        ];
        if (mergedTargets.length <= 0) return [];

        const uniqueTargets = [...new Set(mergedTargets)];
        const policy = this.getTargetPolicy(sourceRoom);
        const stats = uniqueTargets.map((roomName) => this.estimateTargetSelectionStat(sourceRoom, roomName));
        const selectedTargets = this.selectTargetStats(sourceRoom, stats, policy);
        return selectedTargets[key];
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
    static tryBuildRoad(
        sourceRoom: Room,
        targetRoom: Room,
        minLevel: number,
        canRunSecondaryAction: boolean
    ): void {
        RoadBuilder.ensureContainerSites(sourceRoom, targetRoom);
        if (!canRunSecondaryAction) return;
        if (sourceRoom.level < minLevel) return;
        if (Game.time % EXTERNAL_ROAD_CONFIG.BUILD_INTERVAL !== 0) return;
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
    OUT_CARRY_ROLE_SET: new Set(['out-carry', 'out-car']),
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

const getExternalMineEffectiveEnergyPerTick = (sourceRoom: Room, targetRoom: Room, source: Source): number => {
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
            energyPerTick *= 0.5;
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
    ): ExternalMineSourceStat {
        const sourceKey = getOutmineSourceKey(source);
        const distance = getExternalMineSourceDistance(sourceRoom, targetRoom, source);
        const energyPerTick = getExternalMineEffectiveEnergyPerTick(sourceRoom, targetRoom, source);
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

    static getRoomSourceStats(sourceRoom: Room, targetRoom: Room, excludeCreepName?: string): ExternalMineSourceStat[] {
        return getExternalMineTargetSources(targetRoom)
            .map((source) => this.getSourceStats(sourceRoom, targetRoom, source, excludeCreepName))
            .filter((stat) => stat.energyPerTick > 0 && stat.distance > 0);
    }

    static buildCarryPlan(
        sourceRoom: Room,
        targetRoom: Room,
        allowWorkCarry: boolean,
        carryCapacity: number,
    ): ExternalMineCarryPlan {
        const sources = this.getRoomSourceStats(sourceRoom, targetRoom);
        const sourceCount = sources.length;
        const baseTargetNum = allowWorkCarry
            ? sourceCount
            : Math.max(sourceCount + 1, Math.ceil(sourceCount * 2));

        let requiredCarryCapacity = 0;
        let backlogExtraCount = 0;
        for (const stat of sources) {
            const effectiveEnergyPerTick = Math.max(0, stat.energyPerTick - EXTERNAL_MINE_ANALYSIS.SOURCE_CONTAINER_REPAIR_LOSS);
            requiredCarryCapacity += 2 * stat.distance * effectiveEnergyPerTick;

            if (stat.availableEnergy >= EXTERNAL_MINE_ANALYSIS.SEVERE_BACKLOG_THRESHOLD) backlogExtraCount += 2;
            else if (stat.availableEnergy >= EXTERNAL_MINE_ANALYSIS.BACKLOG_THRESHOLD) backlogExtraCount += 1;
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
        const dynamicNum = throughputNeed + EXTERNAL_MINE_CARRY_TARGET_CONFIG.dynamicTargetBuffer;

        const cappedMax = Math.max(
            EXTERNAL_MINE_CARRY_TARGET_CONFIG.minTargetNum,
            sourceNum * EXTERNAL_MINE_CARRY_TARGET_CONFIG.maxTargetNumPerSource
        );
        return Math.min(cappedMax, Math.max(baseNum, dynamicNum));
    }
}

// 外矿相关的刷怪决策与刷怪队列维护。
class ExternalMineSpawner {
    // 各角色任务优先级，统一从角色配置读取。
    private static readonly PRIORITY = {
        reserver: RoleData['reserver'].level,
        harvest: RoleData['out-harvest'].level,
        carry: RoleData['out-carry'].level,
        scout: RoleData['scout'].level,
        build: RoleData['out-build'].level,
        mineral: RoleData['out-mineral'].level,
    } as const;

    // 用于统一修正 spawn 任务优先级的映射（兼容别名）。
    private static readonly ROLE_PRIORITY_BY_ROLE: Record<string, number> = {
        scout: this.PRIORITY.scout,
        reserver: this.PRIORITY.reserver,
        'out-harvest': this.PRIORITY.harvest,
        'out-car': this.PRIORITY.carry,
        'out-carry': this.PRIORITY.carry,
        'out-build': this.PRIORITY.build,
        'out-mineral': this.PRIORITY.mineral,
    };

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

    // 判断 creep 记录的 sourceRoom 是否与期望源房一致。
    private static isSameSourceRoom(creepSourceRoom: string | undefined, sourceRoomName: string): boolean {
        if (!creepSourceRoom) return false;
        return creepSourceRoom === sourceRoomName;
    }

    // 目标房中是否已有“来自本源房”的外矿采集者（用于运输前置）。
    private static hasActiveOutHarvesterByTargetName(sourceRoom: Room, targetRoomName: string): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoomName);
        const activeHarvesters = (creepByTargetRoom['out-harvest'] || [])
            .filter((c: any) =>
                c &&
                this.isSameSourceRoom(c.sourceRoom, sourceRoom.name) &&
                !c.spawning &&
                (c.ticksToLive == null || c.ticksToLive > 0)
            ).length;
        return activeHarvesters > 0;
    }

    // 清理指定目标房的 out-carry/out-car 刷怪任务，返回移除数量。
    private static clearTargetOutCarrySpawnMissions(sourceRoom: Room, targetRoomName: string): number {
        const tasks = sourceRoom.getAllMissionFromPool('spawn') || [];
        let removed = 0;
        for (const task of tasks) {
            const memory = this.getSpawnTaskMemory(task);
            const role = memory?.role;
            if (role !== 'out-carry' && role !== 'out-car') continue;
            if (memory?.targetRoom !== targetRoomName) continue;
            const taskSourceRoom = memory.sourceRoom;
            if (taskSourceRoom && taskSourceRoom !== sourceRoom.name) continue;
            sourceRoom.deleteMissionFromPool?.('spawn', task.id);
            removed++;
        }
        return removed;
    }

    // 目标房是否已有采集者（本源房视角）。
    private static hasActiveOutHarvester(sourceRoom: Room, targetRoom: Room): boolean {
        return this.hasActiveOutHarvesterByTargetName(sourceRoom, targetRoom.name);
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

    // 外矿矿物采集（需要 RCL6+ 且单房仅 1 个）。
    static mineral(sourceRoom: Room, targetRoom: Room): boolean {
        if (sourceRoom.level < 6) return false;
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerMiners = (creepByTargetRoom['out-mineral'] || []).length;
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-mineral', targetRoom.name);
        if (outerMiners + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('OMR', [], this.PRIORITY.mineral, 'out-mineral', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
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
    static harvester(sourceRoom: Room, targetRoom: Room, sourceNum: number, upbody?: boolean): boolean {
        const slotCap = ExternalMineMath.getOutHarvesterSlotCap(targetRoom);
        const targetNum = ExternalMineMath.calcOutHarvesterTargetNum(sourceRoom, sourceNum, upbody, slotCap);
        if (targetNum <= 0) return false;

        // 多母房共享同一个 targetRoom 时，OH 数量只按 targetRoom 全局控制，
        // 不再按 sourceRoom 各自算一遍，避免多个源房叠加超孵化。
        const globalActive = this.getActiveRoleNumByTarget('out-harvest', targetRoom.name);
        const globalQueued = this.getQueuedSpawnRoleNumByTargetGlobal('out-harvest', targetRoom.name);
        const globalSpawning = this.getSpawningRoleNumByTargetGlobal('out-harvest', targetRoom.name);
        if (globalActive + globalQueued + globalSpawning >= targetNum) return false;
        if (slotCap > 0) {
            if (globalActive + globalQueued + globalSpawning >= slotCap) return false;
        }

        const memory = ExternalMineState.createMemory(sourceRoom.name, targetRoom.name);
        if (upbody) {
            sourceRoom.SpawnMissionAdd('OH', [[WORK, 16], [CARRY, 6], [MOVE, 8]], this.PRIORITY.harvest, 'out-harvest', memory);
        } else {
            sourceRoom.SpawnMissionAdd('OH', [], this.PRIORITY.harvest, 'out-harvest', memory);
        }
        return true;
    }

    // 外矿运输者：现在只孵化 out-carry；旧 out-car 仅作为存量运力统计。
    static carry(sourceRoom: Room, targetRoom: Room, num: number): boolean {
        if (!this.hasActiveOutHarvester(sourceRoom, targetRoom)) {
            this.clearTargetOutCarrySpawnMissions(sourceRoom, targetRoom.name);
            return false;
        }

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerCarry = (creepByTargetRoom['out-carry'] || [])
            .filter((c: any) => c.sourceRoom === sourceRoom.name).length;
        const outerCar = (creepByTargetRoom['out-car'] || [])
            .filter((c: any) => c.sourceRoom === sourceRoom.name).length;

        const spawnCarryNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-carry', targetRoom.name);
        const modeCarryBody = ExternalMineMath.getModeLimitedBodyConfig(sourceRoom, 'out-carry');

        const totalCarry = outerCarry + spawnCarryNum + outerCar;
        if (totalCarry < num) {
            sourceRoom.SpawnMissionAdd('OC', modeCarryBody || [], this.PRIORITY.carry, 'out-carry', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        return false;
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

        sourceRoom.SpawnMissionAdd('', '', this.PRIORITY.reserver, 'reserver', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
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

    private static getBuilderWorkTargets(targetRoom: Room, repairOnly = false): Array<{ pos: RoomPosition; structureType: StructureConstant }> {
        const repairTargets = this.getBuilderRepairTargets(targetRoom);
        if (repairOnly) return repairTargets;
        return [...this.getBuilderConstructionTargets(targetRoom), ...repairTargets];
    }

    private static getBuilderTargetDistance(source: Source, target: { pos: RoomPosition }): number {
        if (source.pos && typeof source.pos.getRangeTo === 'function') {
            return source.pos.getRangeTo(target);
        }
        const sourcePos = source.pos;
        const targetPos = target.pos;
        return Math.max(
            Math.abs((sourcePos?.x || 0) - (targetPos?.x || 0)),
            Math.abs((sourcePos?.y || 0) - (targetPos?.y || 0))
        );
    }

    private static getAssignedBuilderCount(sourceRoom: Room, targetRoomName: string, sourceId: Id<Source>): number {
        let count = 0;

        for (const creep of Object.values(Game.creeps || {})) {
            if (!creep?.my || creep.spawning) continue;
            if (creep.memory?.role !== 'out-build') continue;
            if (creep.memory.sourceRoom !== sourceRoom.name) continue;
            if (creep.memory.targetRoom !== targetRoomName) continue;
            if (creep.memory.targetSourceId !== sourceId) continue;
            count++;
        }

        const tasks = sourceRoom.getAllMissionFromPool('spawn') || [];
        for (const task of tasks) {
            const memory = this.getSpawnTaskMemory(task);
            if (!memory?.role || memory.role !== 'out-build') continue;
            if (memory.sourceRoom !== sourceRoom.name) continue;
            if (memory.targetRoom !== targetRoomName) continue;
            if (memory.targetSourceId !== sourceId) continue;
            count++;
        }

        return count;
    }

    private static getBuilderTargetSourceId(
        sourceRoom: Room,
        targetRoom: Room,
        repairOnly = false,
    ): Id<Source> | undefined {
        const sources = getExternalMineTargetSources(targetRoom);
        if (sources.length <= 0) return undefined;

        const workTargets = this.getBuilderWorkTargets(targetRoom, repairOnly);
        if (workTargets.length <= 0) return sources[0]?.id;

        let bestSource: Source | null = null;
        let bestBuilderCount = Infinity;
        let bestNearbyWorkScore = -1;
        let bestDistance = Infinity;

        for (const source of sources) {
            const builderCount = this.getAssignedBuilderCount(sourceRoom, targetRoom.name, source.id);
            let nearbyWorkScore = 0;
            let nearestDistance = Infinity;

            for (const target of workTargets) {
                const distance = this.getBuilderTargetDistance(source, target);
                nearestDistance = Math.min(nearestDistance, distance);
                if (distance > 5) continue;
                nearbyWorkScore += target.structureType === STRUCTURE_CONTAINER ? 2 : 1;
            }

            const hasBetterLocalCoverage = nearbyWorkScore > bestNearbyWorkScore;
            const hasSameCoverageButFewerBuilders =
                nearbyWorkScore === bestNearbyWorkScore && builderCount < bestBuilderCount;
            const hasSameCoverageAndBuilderCountButCloser =
                nearbyWorkScore === bestNearbyWorkScore &&
                builderCount === bestBuilderCount &&
                nearestDistance < bestDistance;

            if (!bestSource || hasBetterLocalCoverage || hasSameCoverageButFewerBuilders || hasSameCoverageAndBuilderCountButCloser) {
                bestSource = source;
                bestBuilderCount = builderCount;
                bestNearbyWorkScore = nearbyWorkScore;
                bestDistance = nearestDistance;
            }
        }

        return bestSource?.id;
    }

    // 外矿建造者：道路/容器存在施工或维修需求时派遣。
    static builder(sourceRoom: Room, targetRoom: Room): boolean {
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
            targetSourceId?: Id<Source>;
        };
        if (repairOnly) memory.outBuildMode = 'repair';
        const targetSourceId = this.getBuilderTargetSourceId(sourceRoom, targetRoom, repairOnly);
        if (targetSourceId) memory.targetSourceId = targetSourceId;

        sourceRoom.SpawnMissionAdd('OB', '', this.PRIORITY.build, 'out-build', memory);
        return true;
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

    // 常规外矿：能量采集、运输、防守、预定与建造。
    static runEnergy(room: Room, timing: ExternalMineTiming): void {
        const runState = ExternalMineState.getRunState(timing);
        if (!runState) return;

        const targetRooms = ExternalMineState.getManagedTargets(room, 'energy');
        if (targetRooms.length <= 0) return;

        for (const roomName of targetRooms) {
            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) {
                if (runState.canRunSecondaryAction) {
                    ExternalMineSpawner.scout(room, roomName);
                }
                continue;
            }

            ExternalMineState.tryBuildRoad(room, targetRoom, EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL, runState.canRunSecondaryAction);

            const sourceNum = targetRoom.source?.length || targetRoom.find(FIND_SOURCES).length || 0;
            if (sourceNum === 0) continue;

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

            ExternalMineSpawner.harvester(room, targetRoom, sourceNum);

            const carryCapacity = ExternalMineMath.getOutCarryCapacity(room);
            const carryNum = ExternalMineMath.calcEnergyOutCarryTarget(room, targetRoom, sourceNum, false, carryCapacity);
            ExternalMineSpawner.carry(room, targetRoom, carryNum);

            ExternalMineSpawner.builder(room, targetRoom);
        }
    }

    // 中心房外矿：包含 SK/中心房的高强度采集与矿物采集逻辑。
    static runCenter(room: Room, timing: ExternalMineTiming): void {
        const runState = ExternalMineState.getRunState(timing);
        if (!runState) return;

        const targetRooms = ExternalMineState.getManagedTargets(room, 'centerRoom');
        if (targetRooms.length <= 0) return;

        for (const roomName of targetRooms) {
            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) {
                if (runState.canRunSecondaryAction) {
                    ExternalMineSpawner.scout(room, roomName);
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
            ExternalMineSpawner.harvester(room, targetRoom, sourceNum, true);

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
