import { RoleData, RoleLevelData } from '@/constant/CreepConstant';
import { decompressBodyConfig } from '@/modules/utils/compress';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getRoomData } from '@/modules/utils/memory';
import { getDowngradedLogisticsCountByAssignedRoom, hasSoonDeadCreepByAssignedRoomRole } from '@/modules/utils/creepTickIndex';

// 维修相关
const REPAIR_MIN_ENERGY = THRESHOLDS.ENERGY.WALL_MIN * 2;
// 搬运任务生成阈值
const TRANSPORT_MIN = THRESHOLDS.TRANSPORT.MIN_AMOUNT;
const TRANSPORT_HIGH = THRESHOLDS.TRANSPORT.HIGH_AMOUNT;
// Worker 允许孵化的最低能量
const WORKER_MIN_SPAWN_ENERGY = BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE] * 2;
// 单矿最大采集 work 上限
const HARVESTER_MAX_WORK_PER_SOURCE = 8;
// builder 目标数的参考 work 基线
const WORKER_BUILD_REFERENCE_WORK = 3;

// 优先使用缓存的能量状态，避免重复计算
const getEnergyState = (room: Room) => {
    return (room.memory as any).energyState || (room as any).updateEnergyState?.(false) || 'NORMAL';
};

// 以 room.getEnergyProfile 为准，否则退化为 room[RESOURCE_ENERGY] 统计
const getTotalEnergy = (room: Room) => {
    return (room as any).getEnergyProfile?.().totalEnergy ?? (room as any)[RESOURCE_ENERGY] ?? 0;
};

// storage/terminal 的能量用于判断运输体系是否成立
const getStoredEnergy = (room: Room) => {
    return (room.storage?.store[RESOURCE_ENERGY] || 0) +
        (room.terminal?.store[RESOURCE_ENERGY] || 0);
};

// 房间模式（main/high/rush/low/stop）
const getRoomMode = (room: Room) => {
    return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
};

const isHighLikeMode = (mode: string) => mode === 'high' || mode === 'rush';

// 判断 controller 附近是否具备稳定的能量缓存（link/container）
const hasControllerEnergyBuffer = (room: Room) => {
    if (!room.controller) return false;
    const hasLink = room.link?.some(link => link.pos.inRangeTo(room.controller!.pos, 2));
    if (hasLink) return true;
    return !!room.container?.some(container => container.pos.inRangeTo(room.controller!.pos, 3));
};

// 仅统计自己的工地，避免被他人干扰孵化逻辑
export const getMyConstructionSites = (room: Room) => {
    const cachedSites = (room as any).constructionSite as ConstructionSite[] | undefined;
    const sites = (cachedSites && cachedSites.length > 0)
        ? cachedSites
        : room.find(FIND_CONSTRUCTION_SITES);
    return sites.filter((site) => site && (site as any).my);
};

const countMyConstructionSitesByType = (room: Room, structureType: StructureConstant) => {
    let count = 0;
    for (const site of getMyConstructionSites(room)) {
        if (site.structureType === structureType) count++;
    }
    return count;
};

// 核心建筑未齐全时，升级器会被延迟以优先补齐基础设施
const hasIncompletePrimaryStructures = (room: Room) => {
    const level = room.level;
    const spawnCount = (room.spawn?.length || 0) + countMyConstructionSitesByType(room, STRUCTURE_SPAWN);
    const extensionCount = (room.extension?.length || 0) + countMyConstructionSitesByType(room, STRUCTURE_EXTENSION);
    if (spawnCount < (CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][level] || 0)) return true;
    if (extensionCount < (CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][level] || 0)) return true;
    if (level >= 3) {
        const towerCount = (room.tower?.length || 0) + countMyConstructionSitesByType(room, STRUCTURE_TOWER);
        if (towerCount < (CONTROLLER_STRUCTURES[STRUCTURE_TOWER][level] || 0)) return true;
    }
    if (level >= 4) {
        const storageCount = (room.storage ? 1 : 0) + countMyConstructionSitesByType(room, STRUCTURE_STORAGE);
        if (storageCount < 1) return true;
    }
    if (level >= 6) {
        const terminalCount = (room.terminal ? 1 : 0) + countMyConstructionSitesByType(room, STRUCTURE_TERMINAL);
        if (terminalCount < 1) return true;
    }
    return false;
};

// 低能量阶段且核心建筑未齐时，推迟 upgrader 生成
export const shouldDelayUpgraderForPrimaryBuild = (room: Room) => {
    const state = getEnergyState(room);
    const lowPhase = room.level <= 6 || state === 'LOW' || state === 'CRITICAL';
    if (!lowPhase) return false;
    return hasIncompletePrimaryStructures(room);
};

// 将已入队但应该被推迟的升级类任务清理掉，避免卡队列
export const pruneDelayedUpgraderSpawnMissions = (room: Room) => {
    if (!shouldDelayUpgraderForPrimaryBuild(room)) return 0;
    const tasks = ((room as any).getAllMissionFromPool?.('spawn') || []) as Task[];
    let removed = 0;
    for (const task of tasks) {
        const role = (task as any)?.data?.memory?.role;
        if (role !== 'upgrader' && role !== 'up-upgrade') continue;
        (room as any).deleteMissionFromPool?.('spawn', task.id);
        removed += 1;
    }
    return removed;
};

// 估算 controller 周围可站位，作为 upgrader 上限
const getControllerUpgradeSlots = (room: Room) => {
    const cached = (room as any)._controllerUpgradeSlots;
    if (typeof cached === 'number') return cached;
    const controller = room.controller;
    if (!controller) return 0;

    const terrain = room.getTerrain();
    const cx = controller.pos.x;
    const cy = controller.pos.y;
    let slots = 0;

    for (let x = Math.max(0, cx - 3); x <= Math.min(49, cx + 3); x++) {
        for (let y = Math.max(0, cy - 3); y <= Math.min(49, cy + 3); y++) {
            const pos = new RoomPosition(x, y, room.name);
            if (pos.getRangeTo(controller) > 3) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

            const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
            const blocked = structures.some((s: any) =>
                s.structureType !== STRUCTURE_ROAD &&
                s.structureType !== STRUCTURE_CONTAINER &&
                !(s.structureType === STRUCTURE_RAMPART && s.my)
            );
            if (blocked) continue;
            slots++;
        }
    }

    (room as any)._controllerUpgradeSlots = slots;
    return slots;
};

// storage 能量越多，允许略微提升 upgrader 数量
const getStorageDrivenUpgraderTarget = (room: Room, baseNum: number) => {
    if (!room.storage || room.level >= 8) return baseNum;
    const storageEnergy = room.storage.store[RESOURCE_ENERGY] || 0;
    const offset = Math.max(0, room.level - 3.5) * 10000;
    const linearNeed = Math.floor(Math.max(0, storageEnergy - offset) / 100000);
    if (linearNeed <= 0) return baseNum;
    return Math.max(baseNum, Math.min(baseNum + 2, linearNeed));
};

// 控制器降级风险时，强制补 UNIV 作为兜底维修/升级
export const getDowngradeUniversalTarget = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my) return 0;
    const ttd = controller.ticksToDowngrade || 0;
    if (ttd < THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TTD) {
        return THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TARGET;
    }
    return 0;
};

// 计算降级兜底还缺多少 UNIV
export const getDowngradeUniversalSpawnMissing = (room: Room, current: number) => {
    return Math.max(0, getDowngradeUniversalTarget(room) - current);
};

// 仅统计核心建筑工地，避免小规模工地影响判断
const getCoreConstructionSiteCount = (room: Room) => {
    let count = 0;
    for (const site of getMyConstructionSites(room)) {
        if (site.structureType === STRUCTURE_SPAWN ||
            site.structureType === STRUCTURE_EXTENSION ||
            site.structureType === STRUCTURE_TOWER ||
            site.structureType === STRUCTURE_CONTAINER) {
            count++;
        }
    }
    return count;
};

// 统计 source 周围可站位，用于估算 harvester 数量上限
const getWalkableSourceSlots = (room: Room, source: Source): number => {
    const terrain = room.getTerrain();
    let slots = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = source.pos.x + dx;
            const y = source.pos.y + dy;
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

            const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
            const blocked = structures.some((s: any) =>
                s.structureType !== STRUCTURE_ROAD &&
                s.structureType !== STRUCTURE_CONTAINER &&
                !(s.structureType === STRUCTURE_RAMPART && s.my)
            );
            if (blocked) continue;
            slots++;
        }
    }
    return slots;
};

const getWorkPartCount = (body: BodyPartConstant[]) => {
    let work = 0;
    for (const part of body) {
        if (part === WORK) work++;
    }
    return work;
};

// 根据 worker 体型估算其 work 能力，用于动态缩放 builder 数量
const getGeneratedWorkerWorkPartCount = (room: Room) => {
    const cached = (room as any)._generatedWorkerWorkPartCount;
    if (typeof cached === 'number') return cached;

    const workerBodyConfig = room.GetRoleBodys('worker');
    const workerBody = room.GenerateBodys(workerBodyConfig, 'worker');
    const workParts = Math.max(1, getWorkPartCount(workerBody));
    (room as any)._generatedWorkerWorkPartCount = workParts;
    return workParts;
};

const scaleWorkerConstructionTarget = (room: Room, baseTarget: number, maxTarget: number) => {
    const workPerWorker = getGeneratedWorkerWorkPartCount(room);
    const scaledTarget = Math.ceil(baseTarget * WORKER_BUILD_REFERENCE_WORK / workPerWorker);
    return Math.max(baseTarget, Math.min(maxTarget, scaledTarget));
};

// 低 RCL 允许多采集位，高 RCL 默认一矿一采
const getHarvesterTargetBySource = (room: Room): number => {
    let target = 0;
    const lowRcl = room.level <= 3;
    const harvesterBody = room.GenerateBodys(room.GetRoleBodys('harvester'), 'harvester');
    const workPerHarvester = Math.max(1, getWorkPartCount(harvesterBody));
    const maxByWorkCap = Math.max(1, Math.floor(HARVESTER_MAX_WORK_PER_SOURCE / workPerHarvester));
    for (const source of room.source || []) {
        const slots = getWalkableSourceSlots(room, source);
        if (slots <= 0) continue;
        const bySlot = lowRcl ? slots : 1;
        target += Math.min(bySlot, maxByWorkCap);
    }
    return target;
};

// 每个角色一个检查函数，保持结构清晰
export const RoleSpawnCheck: Record<string, (room: Room, current: number) => boolean> = {
    'harvester': (room: Room, current: number) => {
        if (room.memory.defend) return false;
        let num = getHarvesterTargetBySource(room);
        if (num <= 0) return false;
        if (isHighLikeMode(getRoomMode(room))) {
            // high/rush 下，提前补一个临近到期的 harvester
            const shouldPreSpawn = hasSoonDeadCreepByAssignedRoomRole(room.name, 'harvester', 10);
            if (shouldPreSpawn) num += 1;
        }
        return current < num;
    },
    'upgrader': (room: Room, current: number) => {
        const lv = room.level;
        const mode = getRoomMode(room);
        const highMode = isHighLikeMode(mode);
        const earlyRush = mode === 'rush';
        const baseNum = RoleLevelData['upgrader'][lv]['num'];
        const highBaseTarget = Math.min(baseNum * 2 + 1, 10);
        const rushBaseTarget = Math.min(baseNum * 3, 12);
        let num = highMode ? (mode === 'rush' ? rushBaseTarget : highBaseTarget) : baseNum;
        if (room.memory.defend) return false;
        if (getDowngradeUniversalTarget(room) > 0) return false;
        if (shouldDelayUpgraderForPrimaryBuild(room)) return false;
        const state = getEnergyState(room);
        const ttd = room.controller?.ticksToDowngrade || 0;
        const slotCap = Math.max(1, getControllerUpgradeSlots(room));

        num = Math.max(num, getStorageDrivenUpgraderTarget(room, baseNum));
        num = Math.min(num, slotCap);

        if (earlyRush) {
            if (lv <= 2) num = Math.max(num, 6);
            else if (lv === 3) num = Math.max(num, 7);
            else num = Math.max(num, 6);

            const coreSiteCount = getCoreConstructionSiteCount(room);
            if (coreSiteCount > 0) {
                num = Math.max(2, num - 1);
            }

            num = Math.min(num, slotCap);
            if (state === 'CRITICAL' && room.energyAvailable < THRESHOLDS.SPAWN.MIN_ENERGY && current >= 2) {
                return false;
            }
            return current < num;
        }

        if (highMode) {
            if (state === 'CRITICAL' && ttd > 2000) return false;
            if (state === 'LOW' && ttd > 10000 && current >= 1) return false;

            const minEnergy = lv >= 8 ? 120e3 : lv >= 6 ? 60e3 : lv >= 5 ? 30e3 : 10e3;
            if (getTotalEnergy(room) < minEnergy && ttd > 3000) return false;

            if (!hasControllerEnergyBuffer(room) && lv >= 6) {
                num = Math.min(num, baseNum + 1);
            }

            const creepNum = room.getCreepNum() || {};
            const spawnMissionNum = room.getSpawnMissionNum() || {};
            const logisticsNum =
                (creepNum['transport'] || 0) +
                (creepNum['manager'] || 0) +
                (spawnMissionNum['transport'] || 0) +
                (spawnMissionNum['manager'] || 0);
            if (logisticsNum === 0 && lv >= 5) {
                num = Math.min(num, baseNum + 1);
            }

            return current < num;
        }
        if (lv == 8 && ttd > 100000 && room[RESOURCE_ENERGY] < 300e3) return false;
        if (lv >= 5 && ttd > 10000 && room[RESOURCE_ENERGY] < 50e3) return false;
        return current < num;
    },
    'transport': (room: Room, current: number) => {
        const state = getEnergyState(room);
        const highMode = isHighLikeMode(getRoomMode(room));
        const storedEnergy = getStoredEnergy(room);
        const hasStorageLike = !!room.storage || !!room.terminal;
        let num = RoleLevelData['transport'][room.level]['num'];

        // transport 当前仍依赖 storage / terminal 体系与 transport mission 调度，
        // 因此在只有 container 的恢复期不能提前孵化，否则只会空转占位。
        if (!hasStorageLike) return false;

        if (highMode && state !== 'LOW' && state !== 'CRITICAL') {
            if (storedEnergy >= TRANSPORT_HIGH) num += 1;
            if (storedEnergy >= TRANSPORT_HIGH * 3 && hasControllerEnergyBuffer(room)) num += 1;
            num = Math.min(num, 3);
        }
        if (current >= num) return false;
        if (state === 'LOW' || state === 'CRITICAL') return true;
        if (storedEnergy < TRANSPORT_MIN) return false;
        return hasStorageLike;
    },
    'manager': (room: Room, current: number) => {
        const num = RoleLevelData['manager'][room.level]['num'];
        if (num == 0) return false;
        const center = room.getCenter();
        const storage = room.storage;
        const terminal = room.terminal;
        const link = room.link?.find(l => l.pos.inRangeTo(center, 1));
        return current < num && !!storage && !!(terminal || link);
    },
    'carrier': (room: Room, current: number) => {
        const num = RoleLevelData['carrier'][room.level]['num'];
        if (num > 0) return current < num;
        if (current >= 1) return false;

        // 无仓且急需补能时，至少保留 1 个 carrier
        if (!room.storage && !room.terminal) {
            const creepNum = room.getCreepNum() || {};
            const hasHarvester = (creepNum['harvester'] || 0) > 0;
            if (hasHarvester && room.CheckSpawnAndTower()) return true;
        }

        if (room.mineral?.mineralAmount > 0) return true;
        if (room.container?.some((c) => c.store.getUsedCapacity() > 1000)) return true;
        return false;
    },
    'worker': (room: Room, current: number) => {
        if (Memory['warmode']) return false;

        const state = getEnergyState(room);
        const cap = room.energyCapacityAvailable || 0;
        const totalEnergy = getTotalEnergy(room);
        const mode = getRoomMode(room);
        const highMode = isHighLikeMode(mode);
        const earlyRush = mode === 'rush';
        const workerSpawnEnergyMin = Math.max(THRESHOLDS.SPAWN.MIN_ENERGY, WORKER_MIN_SPAWN_ENERGY);

        const hasBuildMission = room.checkMissionInPool('build');
        const siteCount = getMyConstructionSites(room).length;
        const coreSiteCount = getCoreConstructionSiteCount(room);
        const hasConstruction = siteCount > 0;
        const needBuilder = hasBuildMission || hasConstruction;
        const minWorkerTarget = scaleWorkerConstructionTarget(room, 1, room.level <= 2 ? 3 : 2);

        // 1. 只要有建造需求，就先保证至少 1 个 worker
        if (needBuilder && current < minWorkerTarget) {
            if (room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap) {
                return true;
            }
        }

        // 2. 有建造需求时，根据工地规模和模式扩容 worker 数量
        if (needBuilder) {
            if (earlyRush) {
                let rushTarget = 5;
                if (state === 'CRITICAL') rushTarget = 1;
                if (state === 'LOW') rushTarget = Math.min(rushTarget, room.level <= 2 ? 2 : 3);
                rushTarget = scaleWorkerConstructionTarget(room, rushTarget, room.level <= 2 ? 6 : 5);
                if (current < rushTarget &&
                    (room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap)) {
                    return true;
                }
            }

            if (highMode) {
                let highTarget = room.level <= 2 ? 2 : 3;
                if (siteCount >= 6 || coreSiteCount >= 2) highTarget += 1;
                if (siteCount >= 12 || coreSiteCount >= 5) highTarget += 1;
                highTarget = Math.min(highTarget, room.level <= 2 ? 3 : 4);
                if (state === 'CRITICAL') highTarget = 1;
                if (state === 'LOW') highTarget = Math.min(highTarget, room.level <= 2 ? 2 : 3);
                highTarget = scaleWorkerConstructionTarget(room, highTarget, room.level <= 2 ? 5 : 4);
                if (current < highTarget &&
                    (room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap)) {
                    return true;
                }
            }

            const normalBuildTarget = scaleWorkerConstructionTarget(room, 2, room.level <= 2 ? 4 : 3);
            if ((state === 'SURPLUS' || state === 'NORMAL') && siteCount >= 6 && current < normalBuildTarget) {
                return true;
            }
            const surplusBuildTarget = scaleWorkerConstructionTarget(room, 3, room.level <= 2 ? 5 : 4);
            if (state === 'SURPLUS' && siteCount >= 16 && current < surplusBuildTarget) {
                return true;
            }
            const lowBuildTarget = Math.min(minWorkerTarget, room.level <= 2 ? 2 : 1);
            if (state === 'LOW' && current < lowBuildTarget && totalEnergy >= Math.max(THRESHOLDS.SPAWN.BODY_REDUCTION_THRESHOLD, cap * 2)) {
                return true;
            }
        }

        // 3. 没有建造需求时，走刷墙逻辑
        if (!needBuilder) {
            if (current >= 1 || room[RESOURCE_ENERGY] < REPAIR_MIN_ENERGY) return false;

            if (room.level < 8 || Game.flags[`${room.name}/REPAIR`]) {
                if (room.getWallMission(null as any)) return true;
            }
            if (!room.tower || room.tower.length === 0) {
                return room.getMissionNumInPool('repair') >= 20;
            }
        }

        return false;
    },
    'mineral': (room: Room, current: number) => {
        const lv = room.level;
        if (lv < 6) return false;
        if (room.memory.defend) return false;
        if (!room.storage) return false;
        if (!room.extractor) return false;
        if (room.mineral.mineralAmount <= 0) return false;
        const mineralPos = room.mineral.pos;
        const sources = room.source || room.find(FIND_SOURCES);
        const hasMineralContainer = room.container?.some((c) => {
            if (!c.pos.isNearTo(mineralPos)) return false;
            const isSourceContainer = sources.some((s) => s && c.pos.isNearTo(s.pos));
            const isControllerContainer = !!room.controller && c.pos.inRangeTo(room.controller.pos, 1);
            return !isSourceContainer && !isControllerContainer;
        });
        if (!hasMineralContainer) return false;
        const store = room.storage.store;
        if (store.getUsedCapacity() > store.getCapacity() * 0.95) return false;
        if (store[room.mineral.mineralType] > 1e6) return false;
        const extMaxEnergyCapacity =
            CONTROLLER_STRUCTURES['spawn'][lv] * 300 +
            CONTROLLER_STRUCTURES['extension'][lv] * EXTENSION_ENERGY_CAPACITY[lv];
        if (room.energyCapacityAvailable < extMaxEnergyCapacity) return false;
        return current < 1 && lv >= 6;
    },
    'universal': (room: Room, current: number) => {
        const lv = room.level;
        const state = getEnergyState(room);
        const isLowEnergy = state === 'LOW' || state === 'CRITICAL';
        const creepNum = room.getCreepNum() || {};
        const transportNum =
            (creepNum['carrier'] || 0) +
            (creepNum['transport'] || 0) +
            (creepNum['manager'] || 0) +
            (creepNum['logistic'] || 0);
        const harvestNum =
            (creepNum['harvester'] || 0) +
            (creepNum['out-harvest'] || 0);

        const getRoleMinEnergy = (role: string) => {
            const config = (RoleLevelData as any)[role]?.[lv]?.bodypart;
            if (!config) return Infinity;
            const body = room.GenerateBodys(config, role);
            return room.CalculateEnergy(body);
        };
        const minHarvesterEnergy = getRoleMinEnergy('harvester');
        const minCarrierEnergy = getRoleMinEnergy('carrier');
        const minTransportEnergy = getRoleMinEnergy('transport');
        const minManagerEnergy = getRoleMinEnergy('manager');
        const hasStorageLike = !!room.storage || !!room.terminal;
        const minLogisticEnergy = hasStorageLike
            ? Math.min(minTransportEnergy, minManagerEnergy)
            : minCarrierEnergy;
        const energyAvailable = room.energyAvailable || 0;
        const needHarvestRescue = harvestNum === 0 && energyAvailable < minHarvesterEnergy;
        const needTransportRescue = transportNum === 0 && energyAvailable < minLogisticEnergy;

        // 1) 控制器降级兜底：仅在低等级且低能量时用 UNIV，常态靠 upgrader
        let target = 0;
        if (lv <= 4 && isLowEnergy) {
            target = getDowngradeUniversalTarget(room);
        }

        // 2) 低能量救援：采集/搬运其中一方为 0 且当前能量不足以孵化该角色时补 UNIV
        if (isLowEnergy && room.CheckSpawnAndTower() && (needHarvestRescue || needTransportRescue)) {
            let emergencyTarget = lv <= 2 ? 3 : lv <= 4 ? 2 : 1;
            if (state === 'CRITICAL') emergencyTarget += 1;
            if (transportNum === 0) emergencyTarget += 1;
            target = Math.max(target, emergencyTarget);
        }

        // 3) 仅在 high/rush 模式下，早期或无物流基建时补 UNIV
        const hasContainer = !!room.container && room.container.length > 0;
        const mode = getRoomMode(room);
        if (isHighLikeMode(mode) && (lv < 3 || (!hasContainer && !hasStorageLike))) {
            target = Math.max(target, 2);
            if (mode === 'rush') target = Math.max(target, 5);
        }
        return current < target;
    },
};

export type SpawnCheckContext = {
    room: Room;
    creepNum: Record<string, number>;
    spawnMissionNum: Record<string, number>;
    shouldRecover: boolean;
    downgradedCount: Record<string, number>;
};

// 统一构造孵化检查上下文：
// 把“当前数量 + 已入队数量 + 降级物流扣减”集中在这里，避免各处重复拼装。
export const createSpawnCheckContext = (
    room: Room,
    creepNum: Record<string, number>,
    spawnMissionNum: Record<string, number>,
): SpawnCheckContext => {
    const state = getEnergyState(room);
    const shouldRecover = state === 'NORMAL' || state === 'SURPLUS';
    return {
        room,
        creepNum,
        spawnMissionNum,
        shouldRecover,
        downgradedCount: shouldRecover ? getDowngradedLogisticsCountByAssignedRoom(room.name) : {},
    };
};

// 获取某个角色经过“恢复期物流扣减”后的有效当前数量。
export const getAdjustedSpawnRoleCurrent = (context: SpawnCheckContext, role: string): number => {
    const current = (context.creepNum[role] || 0) + (context.spawnMissionNum[role] || 0);
    if (!context.shouldRecover) return current;
    return Math.max(0, current - (context.downgradedCount[role] || 0));
};

// 统一角色孵化判定入口：
// 默认使用上下文中的当前数量，也允许外部显式传入 current 做单点判断。
export const shouldSpawnRole = (
    role: string,
    context: SpawnCheckContext,
    current = getAdjustedSpawnRoleCurrent(context, role),
): boolean => {
    if (role === 'universal') {
        return getDowngradeUniversalSpawnMissing(context.room, current) > 0 || RoleSpawnCheck[role]?.(context.room, current) === true;
    }

    const checker = RoleSpawnCheck[role];
    if (!checker) return false;
    return checker(context.room, current);
};

/**
 * 房间孵化任务模块（spawn）
 * @description
 * - 根据房间状态与 RoleSpawnCheck 规则动态生成孵化任务
 * - 提供 SpawnMissionAdd 将孵化任务写入任务池，并失效 SpawnMissionNum 缓存
 */
export default class SpawnMission extends Room {
    /**
     * spawn 更新入口
     * @description 按角色规则检查缺口并生成对应孵化任务
     * @returns true 表示已执行检查，false 表示不满足条件（例如无 spawn）
     */
    UpdateSpawnMission(offset = 0) {
        void offset;
        if (!this.spawn || this.spawn.length === 0) return false;
        pruneDelayedUpgraderSpawnMissions(this);

        const creepNum = this.getCreepNum();
        const spawnMissionNum = this.getSpawnMissionNum();
        const context = createSpawnCheckContext(this, creepNum, spawnMissionNum);

        for (const role in RoleSpawnCheck) {
            const adjusted = getAdjustedSpawnRoleCurrent(context, role);
            if (role === 'universal') {
                const rescueMissing = getDowngradeUniversalSpawnMissing(this, adjusted);
                if (rescueMissing > 0) {
                    for (let i = 0; i < rescueMissing; i++) {
                        this.SpawnMissionAdd(
                            RoleData[role].code,
                            '',
                            RoleData[role].level,
                            role,
                            { home: this.name } as CreepMemory
                        );
                    }
                    continue;
                }
            }
            if (shouldSpawnRole(role, context, adjusted)) {
                this.SpawnMissionAdd(
                    RoleData[role].code,
                    '',
                    RoleData[role].level,
                    role,
                    { home: this.name } as CreepMemory
                );
            }
        }

        return true;
    }

    /**
     * 添加孵化任务（spawn）
     * @param name - 孵化任务标识（常用 RoleData[role].code）
     * @param body - 身体配置（数组或压缩字符串）
     * @param level - 任务优先级；<0 时使用默认等级
     * @param role - creep 角色
     * @param memory - creep memory（会克隆并写入 role）
     * @param upbody - 是否启用升级 body（可选）
     * @returns OK 表示入队成功，-1 表示失败
     */
    SpawnMissionAdd(name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, role: string, memory?: CreepMemory, upbody?: boolean) {
        if (!RoleData[role]) {
            console.log(`role ${role} 不存在`);
            return -1;
        }

        if (!memory) memory = {} as CreepMemory;
        else memory = { ...(memory as any) } as CreepMemory;
        memory.role = role;

        if (level < 0) level = RoleData[role].level;
        let bodypart: BodyPartConstant[];
        let energy = 0;
        if (typeof body === 'string') {
            bodypart = this.GenerateBodys(decompressBodyConfig(body), role);
            energy = this.CalculateEnergy(bodypart);
        } else {
            bodypart = this.GenerateBodys(body, role);
            energy = this.CalculateEnergy(bodypart);
        }

        if (energy > this.energyCapacityAvailable) return -1;

        if (upbody === undefined) {
            this.addMissionToPool('spawn', 'spawn', level, { name, body, memory, energy });
        } else {
            this.addMissionToPool('spawn', 'spawn', level, { name, body, memory, energy, upbody: !!upbody });
        }
        return OK;
    }
}
