import { RoleLevelData } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getRoomData } from '@/modules/utils/memory';
import { getDowngradedLogisticsCountByHomeRoom, hasSoonDeadCreepByHomeRoomRole } from '@/modules/utils/creepTickIndex';

const REPAIR_MIN_ENERGY = THRESHOLDS.ENERGY.WALL_MIN * 2;
const TRANSPORT_MIN = THRESHOLDS.TRANSPORT.MIN_AMOUNT;
const TRANSPORT_HIGH = THRESHOLDS.TRANSPORT.HIGH_AMOUNT;
const WORKER_MIN_SPAWN_ENERGY =
    BODYPART_COST[WORK] +
    BODYPART_COST[CARRY] +
    BODYPART_COST[MOVE] * 2;
const HARVESTER_MAX_WORK_PER_SOURCE = 8;
const WORKER_BUILD_REFERENCE_WORK = 3;

export const SPAWN_MANAGED_ROLES = [
    'harvester',
    'upgrader',
    'transport',
    'manager',
    'carrier',
    'worker',
    'mineral',
    'universal',
    'up-upgrade',
    'up-repair',
] as const;

export type SpawnManagedRole = typeof SPAWN_MANAGED_ROLES[number];

export interface SpawnCheckContext {
    room: Room;
    energyState: string;
    roomMode: string;
    highLikeMode: boolean;
    earlyRush: boolean;
    totalEnergy: number;
    storedEnergy: number;
    shouldRecover: boolean;
    creepNum: Record<string, number>;
    spawnMissionNum: Record<string, number>;
    downgradedCountByRole: Record<string, number>;
}

type SpawnRoleCheck = (context: SpawnCheckContext, current: number) => boolean;

const getEnergyState = (room: Room) => {
    return (room.memory as any).energyState || (room as any).updateEnergyState?.(false) || 'NORMAL';
};

const getTotalEnergy = (room: Room) => {
    return (room as any).getEnergyProfile?.().totalEnergy ?? (room as any)[RESOURCE_ENERGY] ?? 0;
};

const getStoredEnergy = (room: Room) => {
    return (room.storage?.store[RESOURCE_ENERGY] || 0) +
        (room.terminal?.store[RESOURCE_ENERGY] || 0);
};

const getRoomMode = (room: Room) => {
    return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
};

const isHighLikeMode = (mode: string) => mode === 'high' || mode === 'rush';

const hasControllerEnergyBuffer = (room: Room) => {
    if (!room.controller) return false;
    const hasLink = room.link?.some(link => link.pos.inRangeTo(room.controller!.pos, 2));
    if (hasLink) return true;
    return !!room.container?.some(container => container.pos.inRangeTo(room.controller!.pos, 3));
};

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

export const shouldDelayUpgraderForPrimaryBuild = (room: Room) => {
    const state = getEnergyState(room);
    const lowPhase = room.level <= 6 || state === 'LOW' || state === 'CRITICAL';
    if (!lowPhase) return false;
    return hasIncompletePrimaryStructures(room);
};

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

const getStorageDrivenUpgraderTarget = (room: Room, baseNum: number) => {
    if (!room.storage || room.level >= 8) return baseNum;
    const storageEnergy = room.storage.store[RESOURCE_ENERGY] || 0;
    const offset = Math.max(0, room.level - 3.5) * 10000;
    const linearNeed = Math.floor(Math.max(0, storageEnergy - offset) / 100000);
    if (linearNeed <= 0) return baseNum;
    return Math.max(baseNum, Math.min(baseNum + 2, linearNeed));
};

export const getDowngradeUniversalTarget = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my) return 0;
    const ttd = controller.ticksToDowngrade || 0;
    if (ttd < THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TTD) {
        return THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TARGET;
    }
    return 0;
};

export const getDowngradeUniversalSpawnMissing = (room: Room, current: number) => {
    return Math.max(0, getDowngradeUniversalTarget(room) - current);
};

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

const getQueuedLogisticsCount = (context: SpawnCheckContext) => {
    return (context.creepNum['transport'] || 0) +
        (context.creepNum['manager'] || 0) +
        (context.spawnMissionNum['transport'] || 0) +
        (context.spawnMissionNum['manager'] || 0);
};

const shouldSpawnHarvester: SpawnRoleCheck = (context, current) => {
    const { room, highLikeMode } = context;
    if (room.memory.defend) return false;

    let target = getHarvesterTargetBySource(room);
    if (target <= 0) return false;

    if (highLikeMode && hasSoonDeadCreepByHomeRoomRole(room.name, 'harvester', 10)) {
        target += 1;
    }
    return current < target;
};

const shouldSpawnUpgrader: SpawnRoleCheck = (context, current) => {
    const { room, roomMode, highLikeMode, earlyRush, energyState, totalEnergy } = context;
    const lv = room.level;
    const baseNum = RoleLevelData['upgrader'][lv]['num'];
    const highBaseTarget = Math.min(baseNum * 2 + 1, 10);
    const rushBaseTarget = Math.min(baseNum * 3, 12);
    let target = highLikeMode
        ? (roomMode === 'rush' ? rushBaseTarget : highBaseTarget)
        : baseNum;

    if (room.memory.defend) return false;
    if (getDowngradeUniversalTarget(room) > 0) return false;
    if (shouldDelayUpgraderForPrimaryBuild(room)) return false;

    const ttd = room.controller?.ticksToDowngrade || 0;
    const slotCap = Math.max(1, getControllerUpgradeSlots(room));
    target = Math.max(target, getStorageDrivenUpgraderTarget(room, baseNum));
    target = Math.min(target, slotCap);

    if (earlyRush) {
        if (lv <= 2) target = Math.max(target, 6);
        else if (lv === 3) target = Math.max(target, 7);
        else target = Math.max(target, 6);

        if (getCoreConstructionSiteCount(room) > 0) {
            target = Math.max(2, target - 1);
        }

        target = Math.min(target, slotCap);
        if (energyState === 'CRITICAL' && room.energyAvailable < THRESHOLDS.SPAWN.MIN_ENERGY && current >= 2) {
            return false;
        }
        return current < target;
    }

    if (highLikeMode) {
        if (energyState === 'CRITICAL' && ttd > 2000) return false;
        if (energyState === 'LOW' && ttd > 10000 && current >= 1) return false;

        const minEnergy = lv >= 8 ? 120e3 : lv >= 6 ? 60e3 : lv >= 5 ? 30e3 : 10e3;
        if (totalEnergy < minEnergy && ttd > 3000) return false;

        if (!hasControllerEnergyBuffer(room) && lv >= 6) {
            target = Math.min(target, baseNum + 1);
        }

        if (getQueuedLogisticsCount(context) === 0 && lv >= 5) {
            target = Math.min(target, baseNum + 1);
        }

        return current < target;
    }

    if (lv === 8 && ttd > 100000 && (room as any)[RESOURCE_ENERGY] < 300e3) return false;
    if (lv >= 5 && ttd > 10000 && (room as any)[RESOURCE_ENERGY] < 50e3) return false;
    return current < target;
};

const shouldSpawnTransport: SpawnRoleCheck = (context, current) => {
    const { room, highLikeMode, energyState, storedEnergy } = context;
    let target = RoleLevelData['transport'][room.level]['num'];

    if (highLikeMode && energyState !== 'LOW' && energyState !== 'CRITICAL') {
        if (storedEnergy >= TRANSPORT_HIGH) target += 1;
        if (storedEnergy >= TRANSPORT_HIGH * 3 && hasControllerEnergyBuffer(room)) target += 1;
        target = Math.min(target, 3);
    }
    if (current >= target) return false;

    if (energyState === 'LOW' || energyState === 'CRITICAL') {
        return !!(room.storage || room.terminal || (room.container && room.container.length > 0));
    }
    if (storedEnergy < TRANSPORT_MIN) return false;
    return !!(room.storage || room.terminal);
};

const shouldSpawnManager: SpawnRoleCheck = (context, current) => {
    const { room } = context;
    const target = RoleLevelData['manager'][room.level]['num'];
    if (target === 0) return false;

    const center = room.getCenter();
    const storage = room.storage;
    const terminal = room.terminal;
    const link = room.link?.find(l => l.pos.inRangeTo(center, 1));
    return current < target && !!storage && !!(terminal || link);
};

const shouldSpawnCarrier: SpawnRoleCheck = (context, current) => {
    const { room } = context;
    const target = RoleLevelData['carrier'][room.level]['num'];
    if (target > 0) return current < target;
    if (current >= 1) return false;
    if (room.mineral?.mineralAmount > 0) return true;
    if (room.container?.some(c => c.store.getUsedCapacity() > 1000)) return true;
    return false;
};

const shouldSpawnWorker: SpawnRoleCheck = (context, current) => {
    const { room, energyState, totalEnergy, highLikeMode, earlyRush } = context;
    if (Memory['warmode']) return false;

    const cap = room.energyCapacityAvailable || 0;
    const workerSpawnEnergyMin = Math.max(THRESHOLDS.SPAWN.MIN_ENERGY, WORKER_MIN_SPAWN_ENERGY);
    const hasBuildMission = room.checkMissionInPool('build');
    const siteCount = getMyConstructionSites(room).length;
    const coreSiteCount = getCoreConstructionSiteCount(room);
    const needBuilder = hasBuildMission || siteCount > 0;
    const minWorkerTarget = scaleWorkerConstructionTarget(room, 1, room.level <= 2 ? 3 : 2);

    if (needBuilder && current < minWorkerTarget) {
        if (room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap) {
            return true;
        }
    }

    if (needBuilder) {
        if (earlyRush) {
            let rushTarget = 5;
            if (energyState === 'CRITICAL') rushTarget = 1;
            if (energyState === 'LOW') rushTarget = Math.min(rushTarget, room.level <= 2 ? 2 : 3);
            rushTarget = scaleWorkerConstructionTarget(room, rushTarget, room.level <= 2 ? 6 : 5);
            if (current < rushTarget &&
                (room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap)) {
                return true;
            }
        }

        if (highLikeMode) {
            let highTarget = room.level <= 2 ? 2 : 3;
            if (siteCount >= 6 || coreSiteCount >= 2) highTarget += 1;
            if (siteCount >= 12 || coreSiteCount >= 5) highTarget += 1;
            highTarget = Math.min(highTarget, room.level <= 2 ? 3 : 4);
            if (energyState === 'CRITICAL') highTarget = 1;
            if (energyState === 'LOW') highTarget = Math.min(highTarget, room.level <= 2 ? 2 : 3);
            highTarget = scaleWorkerConstructionTarget(room, highTarget, room.level <= 2 ? 5 : 4);
            if (current < highTarget &&
                (room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap)) {
                return true;
            }
        }

        const normalBuildTarget = scaleWorkerConstructionTarget(room, 2, room.level <= 2 ? 4 : 3);
        if ((energyState === 'SURPLUS' || energyState === 'NORMAL') && siteCount >= 6 && current < normalBuildTarget) {
            return true;
        }
        const surplusBuildTarget = scaleWorkerConstructionTarget(room, 3, room.level <= 2 ? 5 : 4);
        if (energyState === 'SURPLUS' && siteCount >= 16 && current < surplusBuildTarget) {
            return true;
        }
        const lowBuildTarget = Math.min(minWorkerTarget, room.level <= 2 ? 2 : 1);
        if (energyState === 'LOW' && current < lowBuildTarget && totalEnergy >= Math.max(THRESHOLDS.SPAWN.BODY_REDUCTION_THRESHOLD, cap * 2)) {
            return true;
        }
    }

    if (current >= 1 || (room as any)[RESOURCE_ENERGY] < REPAIR_MIN_ENERGY) return false;

    if (room.level < 8 || Game.flags[`${room.name}/REPAIR`]) {
        if (room.getWallMission(null as any)) return true;
    }
    if (!room.tower || room.tower.length === 0) {
        return room.getMissionNumInPool('repair') >= 20;
    }
    return false;
};

const shouldSpawnMineral: SpawnRoleCheck = (context, current) => {
    const { room } = context;
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
        const isSourceContainer = sources.some(s => s && c.pos.isNearTo(s.pos));
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
    return current < 1;
};

const shouldSpawnUniversal: SpawnRoleCheck = (context, current) => {
    const { room, highLikeMode, roomMode } = context;
    let target = getDowngradeUniversalTarget(room);
    if (room.level >= 3) return current < target;
    if (room.container && room.container.length > 0) return current < target;

    target = Math.max(target, 2);
    if (highLikeMode) target = 3;
    if (roomMode === 'rush') target = 5;
    return current < target;
};

const shouldSpawnUpUpgrade: SpawnRoleCheck = (context, current) => {
    const { room } = context;
    if (room.level === 8) return false;
    if (shouldDelayUpgraderForPrimaryBuild(room)) return false;
    if (getDowngradeUniversalTarget(room) > 0) return false;

    const flag = room.find(FIND_FLAGS).find(f => f.name.startsWith(`${room.name}/UP-UPGRADE/`));
    if (!flag) return false;
    const match = flag.name.match(/UP-UPGRADE\/(\d+)/);
    const target = match ? parseInt(match[1]) : 0;
    if (target < 1) return false;
    if (room.level >= 4 && (room as any)[RESOURCE_ENERGY] < TRANSPORT_HIGH) return false;
    return current < target;
};

const shouldSpawnUpRepair: SpawnRoleCheck = (context, current) => {
    const { room } = context;
    const flag = room.find(FIND_FLAGS).find(f => f.name.startsWith(`${room.name}/UP-REPAIR/`));
    if (!flag) return false;
    const match = flag.name.match(/UP-REPAIR\/(\d+)/);
    const target = match ? parseInt(match[1]) : 0;
    if (target < 1) return false;
    if (room.level < 7) return false;
    if ((room as any)[RESOURCE_ENERGY] < TRANSPORT_HIGH) return false;
    return current < target;
};

const roleSpawnChecks: Record<SpawnManagedRole, SpawnRoleCheck> = {
    'harvester': shouldSpawnHarvester,
    'upgrader': shouldSpawnUpgrader,
    'transport': shouldSpawnTransport,
    'manager': shouldSpawnManager,
    'carrier': shouldSpawnCarrier,
    'worker': shouldSpawnWorker,
    'mineral': shouldSpawnMineral,
    'universal': shouldSpawnUniversal,
    'up-upgrade': shouldSpawnUpUpgrade,
    'up-repair': shouldSpawnUpRepair,
};

export const createSpawnCheckContext = (
    room: Room,
    creepNum: Record<string, number> = room.getCreepNum() || {},
    spawnMissionNum: Record<string, number> = room.getSpawnMissionNum() || {},
): SpawnCheckContext => {
    const energyState = getEnergyState(room);
    const roomMode = getRoomMode(room);
    const shouldRecover = energyState === 'NORMAL' || energyState === 'SURPLUS';

    return {
        room,
        energyState,
        roomMode,
        highLikeMode: isHighLikeMode(roomMode),
        earlyRush: roomMode === 'rush',
        totalEnergy: getTotalEnergy(room),
        storedEnergy: getStoredEnergy(room),
        shouldRecover,
        creepNum,
        spawnMissionNum,
        downgradedCountByRole: shouldRecover
            ? getDowngradedLogisticsCountByHomeRoom(room.name)
            : {},
    };
};

export const getAdjustedSpawnRoleCurrent = (context: SpawnCheckContext, role: string) => {
    const current = (context.creepNum[role] || 0) + (context.spawnMissionNum[role] || 0);
    if (!context.shouldRecover) return current;
    return Math.max(0, current - (context.downgradedCountByRole[role] || 0));
};

export const shouldSpawnRole = (
    role: SpawnManagedRole,
    context: SpawnCheckContext,
    current: number,
) => {
    return roleSpawnChecks[role](context, current);
};
