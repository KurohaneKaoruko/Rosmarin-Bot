import { ROLES } from '@/constant/CreepConstant';
import { runWorkLayer } from '@/prototype/Creep/family/flow/workLayer';
import { writeMoveWorkTileCandidates } from '@/modules/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/prototype/Creep/family/flow/workLayer';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';
import { isArrivedInRoom } from '@/prototype/Creep/shared/movement';

const BUILD_PRIORITY = [STRUCTURE_CONTAINER, STRUCTURE_ROAD] as StructureConstant[];
const ENERGY_DROP_MIN = 20;
const ENERGY_CONTAINER_MIN = 50;
const REPAIR_RATIO = 0.8;
const SOURCE_FETCH_START_RANGE = 3;
const SOURCE_KEEPER_RANGE = 5;

const OUT_BUILD_SWITCH = {
    TO_TARGET: (creep: Creep) => creep.store.getFreeCapacity() === 0,
    TO_SOURCE: (creep: Creep) => creep.store.getUsedCapacity() === 0
} as const;

type OutBuildIndexedRoom = Room & {
    source?: Source[];
};

const inTargetRoom = (creep: Creep): boolean =>
    isArrivedInRoom(creep, creep.memory.targetRoom);

const moveToTargetRoom = (creep: Creep): void => {
    creep.memory.dontPullMe = false;
    creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
};

const moveToSourceRoom = (creep: Creep): void => {
    creep.memory.dontPullMe = false;
    creep.moveToRoom(creep.memory.sourceRoom, { plainCost: 2, swampCost: 10 });
};

const isRepairOnlyMode = (creep: Creep): boolean => creep.memory.outBuildMode === 'repair';

const isRoadPos = (pos: RoomPosition): boolean => {
    const structures = pos.lookFor(LOOK_STRUCTURES) as Structure[];
    return structures.some((s) => s.structureType === STRUCTURE_ROAD);
};

const stepAsideFromRoad = (creep: Creep): boolean => {
    if (creep.fatigue > 0) return false;
    if (!isRoadPos(creep.pos)) return false;

    const terrain = creep.room.getTerrain();
    let bestPos: RoomPosition | null = null;
    let bestScore = Infinity;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = creep.pos.x + dx;
            const y = creep.pos.y + dy;
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

            const pos = new RoomPosition(x, y, creep.room.name);
            if ((pos.lookFor(LOOK_CREEPS) as Creep[]).length > 0) continue;
            if ((pos.lookFor(LOOK_POWER_CREEPS) as PowerCreep[]).length > 0) continue;

            const score = (isRoadPos(pos) ? 100 : 0) + creep.pos.getRangeTo(pos);
            if (score < bestScore) {
                bestScore = score;
                bestPos = pos;
            }
        }
    }

    if (!bestPos) return false;
    creep.memory.dontPullMe = false;
    creep.move(creep.pos.getDirectionTo(bestPos));
    return true;
};

const getBuildTypePriority = (structureType: StructureConstant | undefined): number => {
    if (!structureType) return BUILD_PRIORITY.length;
    const index = BUILD_PRIORITY.indexOf(structureType);
    return index >= 0 ? index : BUILD_PRIORITY.length;
};

const getRoomSources = (room: Room): Source[] => {
    const indexedRoom = room as OutBuildIndexedRoom;
    if (Array.isArray(indexedRoom.source) && indexedRoom.source.length > 0) return indexedRoom.source;
    try {
        return (room.find(FIND_SOURCES) || []) as Source[];
    }
    catch {
        return [];
    }
};

const pickClosestByRange = <T extends { pos: RoomPosition }>(origin: RoomPosition, targets: T[]): T | null => {
    let best: T | null = null;
    let bestRange = Infinity;
    for (const target of targets) {
        const range = origin.getRangeTo(target);
        if (range < bestRange) {
            bestRange = range;
            best = target;
        }
    }
    return best;
};

// 取能源选择——**不绑定**：每相位动态计算，绝不写回 memory。
// 绑定会让「A 源采满 → 横穿到 B 建房 → 回 A 再采」反复横跨两个 source；
// 动态口径是：有缓存工作目标就取离工作最近的源（采建同侧小循环），
// 没有就取离自己最近的源。工作区换到哪，下一轮补给就跟到哪。
const getAssignedSource = (creep: Creep): Source | null => {
    if (!inTargetRoom(creep)) return null;
    const sources = getRoomSources(creep.room);
    if (sources.length <= 0) return null;

    const cache = getOutBuildTargetCache(creep);
    for (const key of ['targetId', 'repairId'] as const) {
        const id = cache[key] as Id<ConstructionSite | Structure> | undefined;
        const obj = id ? Game.getObjectById(id) : null;
        if (obj && (obj as { pos?: RoomPosition }).pos) {
            const source = pickClosestByRange((obj as { pos: RoomPosition }).pos, sources);
            if (source) return source;
        }
    }

    return pickClosestByRange(creep.pos, sources);
};

const getBestBy = <T>(items: T[], scorer: (item: T) => number): T | null => {
    let best: T | null = null;
    let bestScore = -Infinity;
    for (const item of items) {
        const score = scorer(item);
        if (score > bestScore) {
            bestScore = score;
            best = item;
        }
    }
    return best;
};

const moveToLocalTarget = (creep: Creep, target: { pos: RoomPosition }, range: number): void => {
    creep.moveTo(target, {
        visualizePathStyle: { stroke: '#ffaa00' },
        maxRooms: 1,
        range,
        plainCost: 2,
        swampCost: 10
    });
};

const tryPickupNearbyEnergy = (creep: Creep, source: Source): boolean => {
    const dropped = source.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
        filter: (resource: Resource) =>
            resource.resourceType === RESOURCE_ENERGY &&
            resource.amount >= ENERGY_DROP_MIN
    }) as Resource[];
    const target = getBestBy(dropped, (resource) => resource.amount);
    if (!target) return false;

    if (!creep.pos.inRangeTo(target, 1)) {
        moveToLocalTarget(creep, target, 1);
        return true;
    }
    creep.pickup(target);
    return true;
};

const tryWithdrawNearbyStore = (
    creep: Creep,
    source: Source,
    lookType: FindConstant,
    energyReader: (target: Tombstone | Ruin) => number,
): boolean => {
    const targets = source.pos.findInRange(lookType, 1, {
        filter: (target: Tombstone | Ruin) => energyReader(target) > 0
    }) as (Tombstone | Ruin)[];
    const target = getBestBy(targets, energyReader);
    if (!target) return false;

    if (!creep.pos.inRangeTo(target, 1)) {
        moveToLocalTarget(creep, target, 1);
        return true;
    }
    creep.withdraw(target, RESOURCE_ENERGY);
    return true;
};

const tryWithdrawNearbyContainer = (creep: Creep, source: Source): boolean => {
    const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (structure: Structure) =>
            structure.structureType === STRUCTURE_CONTAINER &&
            (structure as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) >= ENERGY_CONTAINER_MIN
    }) as StructureContainer[];
    const target = getBestBy(containers, (container) => container.store.getUsedCapacity(RESOURCE_ENERGY));
    if (!target) return false;

    if (!creep.pos.inRangeTo(target, 1)) {
        moveToLocalTarget(creep, target, 1);
        return true;
    }
    creep.withdraw(target, RESOURCE_ENERGY);
    return true;
};

const tryWithdrawEnergyNearSource = (creep: Creep, source: Source | null): boolean => {
    if (!source || source.pos.roomName !== creep.room.name) return false;
    if (tryPickupNearbyEnergy(creep, source)) return true;
    if (tryWithdrawNearbyStore(creep, source, FIND_TOMBSTONES, (target) => target.store.getUsedCapacity(RESOURCE_ENERGY))) return true;
    if (tryWithdrawNearbyStore(creep, source, FIND_RUINS, (target) => target.store.getUsedCapacity(RESOURCE_ENERGY))) return true;
    if (tryWithdrawNearbyContainer(creep, source)) return true;
    return false;
};

const getSourceKeeper = (creep: Creep, source: Source | null): Creep | null => {
    if (!source || source.pos.roomName !== creep.room.name) return null;
    try {
        const keepers = creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (hostile) => hostile.owner.username === 'Source Keeper'
        }) as Creep[];
        return keepers.find((keeper) =>
            source.pos.inRangeTo(keeper.pos, SOURCE_KEEPER_RANGE) &&
            (creep.pos.inRangeTo(keeper.pos, 4) || creep.pos.inRangeTo(source.pos, SOURCE_KEEPER_RANGE))
        ) || null;
    }
    catch {
        return null;
    }
};

const avoidKeeper = (creep: Creep, source: Source | null): boolean => {
    const keeper = getSourceKeeper(creep, source);
    if (!keeper) return false;

    const safeAnchor = new RoomPosition(25, 25, creep.room.name);
    moveToLocalTarget(creep, { pos: safeAnchor }, 12);
    return true;
};

// 工作目标选择：类型优先（container 先于 road，容器是采集链前置），
// 其次离自己最近——随着「就近干活 → 就近补给」自然形成局部小循环，
// 工作区挪到哪个源旁边，补给就跟着挪过去，不再有跨源绑定。
const pickPreferredTarget = <T extends { pos: RoomPosition; structureType?: StructureConstant }>(
    creep: Creep,
    targets: T[],
): T | null => {
    if (targets.length <= 0) return null;

    let best: T | null = null;
    let bestTypePriority = Infinity;
    let bestCreepRange = Infinity;

    for (const target of targets) {
        const typePriority = getBuildTypePriority(target.structureType);
        const creepRange = creep.pos.getRangeTo(target);
        if (
            typePriority < bestTypePriority ||
            (typePriority === bestTypePriority && creepRange < bestCreepRange)
        ) {
            best = target;
            bestTypePriority = typePriority;
            bestCreepRange = creepRange;
        }
    }

    return best;
};

const getOutBuildTargetCache = (creep: Creep): Record<string, any> =>
    ensureMemoryCache(creep.memory).role as Record<string, any>;

const findBuildTarget = (creep: Creep): ConstructionSite | null => {
    const cache = getOutBuildTargetCache(creep);
    if (cache.targetId) {
        const cached = Game.getObjectById(cache.targetId as Id<ConstructionSite>);
        if (cached && cached.my && (cached.structureType === STRUCTURE_ROAD || cached.structureType === STRUCTURE_CONTAINER)) {
            return cached;
        }
        delete cache.targetId;
    }

    const sites = creep.room.find(FIND_CONSTRUCTION_SITES, {
        filter: (site) =>
            site.my && (site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER)
    });
    const target = pickPreferredTarget(creep, sites);
    if (target) cache.targetId = target.id;
    return target;
};

const findRepairTarget = (creep: Creep): Structure | null => {
    const cache = getOutBuildTargetCache(creep);
    if (cache.repairId) {
        const cached = Game.getObjectById(cache.repairId as Id<Structure>);
        if (
            cached &&
            (cached.structureType === STRUCTURE_ROAD || cached.structureType === STRUCTURE_CONTAINER) &&
            cached.hits < cached.hitsMax * REPAIR_RATIO
        ) {
            return cached;
        }
        delete cache.repairId;
    }

    const targets = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) =>
            (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) &&
            structure.hits < structure.hitsMax * REPAIR_RATIO
    });
    const target = pickPreferredTarget(creep, targets);
    if (target) cache.repairId = target.id;
    return target;
};

const findBlockingObstacle = (target: { pos: RoomPosition }): Structure | null => {
    const structures = target.pos.lookFor(LOOK_STRUCTURES) as Structure[];
    return structures.find((structure) => {
        if ('my' in structure && structure.my) return false;
        if (typeof STRUCTURE_INVADER_CORE !== 'undefined' && structure.structureType === STRUCTURE_INVADER_CORE) return false;
        if (structure.structureType === STRUCTURE_RAMPART) {
            const rampart = structure as StructureRampart;
            return !rampart.my && !rampart.isPublic;
        }
        if (typeof OBSTACLE_OBJECT_TYPES === 'undefined') return false;
        return (OBSTACLE_OBJECT_TYPES as readonly StructureConstant[]).includes(structure.structureType);
    }) || null;
};

const findRepairableStructureUnderfoot = (creep: Creep): Structure | null => {
    const structures = creep.pos.lookFor(LOOK_STRUCTURES) as Structure[];
    return structures.find((structure) =>
        (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) &&
        structure.hits < structure.hitsMax
    ) || null;
};

const runHarvestPhase = (creep: Creep): boolean => {
    if (!inTargetRoom(creep)) {
        moveToTargetRoom(creep);
        return false;
    }
    creep.memory.dontPullMe = false;

    const source = getAssignedSource(creep);
    if (!source) {
        stepAsideFromRoad(creep);
        return false;
    }

    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) creep.memory.startFetch = false;
    if (avoidKeeper(creep, source)) return false;

    if (!creep.memory.startFetch && creep.pos.getRangeTo(source) > SOURCE_FETCH_START_RANGE) {
        moveToLocalTarget(creep, source, 1);
        return false;
    }

    creep.memory.startFetch = true;
    if (tryWithdrawEnergyNearSource(creep, source)) return OUT_BUILD_SWITCH.TO_TARGET(creep);

    const result = creep.harvest(source);
    if (result === ERR_NOT_IN_RANGE) {
        moveToLocalTarget(creep, source, 1);
    }
    if (result !== OK && result !== ERR_NOT_IN_RANGE) {
        stepAsideFromRoad(creep);
    }
    return OUT_BUILD_SWITCH.TO_TARGET(creep);
};

const runRepairPhase = (creep: Creep, source: Source | null): boolean => {
    if (!creep.memory.startWorking) {
        if (!source) {
            moveToTargetRoom(creep);
            return false;
        }
        if (!creep.pos.inRangeTo(source, 1)) {
            moveToLocalTarget(creep, source, 1);
            return false;
        }
        creep.memory.startWorking = true;
    }

    if (creep.room.name === creep.memory.sourceRoom) {
        creep.memory.startWorking = false;
        creep.memory.startFetch = false;
        return true;
    }

    const repairTarget = findRepairableStructureUnderfoot(creep);
    if (repairTarget) {
        creep.repair(repairTarget);
        return OUT_BUILD_SWITCH.TO_SOURCE(creep);
    }

    moveToSourceRoom(creep);
    return OUT_BUILD_SWITCH.TO_SOURCE(creep);
};

// 无工作时的采集协助卸载：source 容器有空位 > 相邻外矿搬运工顺手递 > 满载就地掉落。
// 让 out-build 在没有建造/维修工作时跟采集工一起产出，而不是塞满背包站桩。
const deliverAssistHarvest = (creep: Creep, source: Source): boolean => {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return false;

    // 1) 源旁容器有空位：就近交付
    const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s: Structure) =>
            s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > 0
    }) as StructureContainer[];
    if (containers.length > 0) {
        if (!creep.pos.inRangeTo(source, 1)) {
            moveToLocalTarget(creep, source, 1);
            return true;
        }
        const target = getBestBy(containers, (c) => c.store.getFreeCapacity(RESOURCE_ENERGY));
        if (target) creep.transfer(target as StructureContainer, RESOURCE_ENERGY);
        return true;
    }

    // 2) 相邻且有空位的外矿搬运工：顺手递（接力链直接消化）
    const carriers = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (c: Creep) =>
            c.memory.role === ROLES.carrier &&
            c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    }) as Creep[];
    if (carriers.length > 0) {
        creep.transfer(carriers[0], RESOURCE_ENERGY);
        return true;
    }

    // 3) 满载且无处可放：掉落（工作位/容器旁，搬运会收）
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) {
        creep.drop(RESOURCE_ENERGY);
        return true;
    }
    return false;
};

const runBuildPhase = (creep: Creep): boolean => {
    const repairOnlyMode = isRepairOnlyMode(creep);
    if (!inTargetRoom(creep)) {
        if (repairOnlyMode && creep.memory.startWorking) return runRepairPhase(creep, null);
        moveToTargetRoom(creep);
        return false;
    }
    creep.memory.dontPullMe = false;

    const source = getAssignedSource(creep);
    if (avoidKeeper(creep, source)) return false;
    if (repairOnlyMode) return runRepairPhase(creep, source);

    if (creep.store.getFreeCapacity() > 0) {
        creep.collectDroppedResource(RESOURCE_ENERGY, ENERGY_DROP_MIN, 3);
    }

    const buildTarget = findBuildTarget(creep);
    if (buildTarget) {
        syncOutBuildMoveWork(creep);
        const obstacle = findBlockingObstacle(buildTarget);
        if (obstacle) {
            if (!creep.pos.inRangeTo(obstacle, 1)) moveToLocalTarget(creep, obstacle, 1);
            else creep.dismantle(obstacle);
            return false;
        }

        const result = creep.build(buildTarget);
        if (result === ERR_NOT_IN_RANGE) {
            moveToLocalTarget(creep, buildTarget, 3);
        }
        return OUT_BUILD_SWITCH.TO_SOURCE(creep);
    }

    const repairTarget = findRepairTarget(creep);
    if (repairTarget) {
        syncOutBuildMoveWork(creep);
        const result = creep.repair(repairTarget);
        if (result === ERR_NOT_IN_RANGE) {
            moveToLocalTarget(creep, repairTarget, 3);
        }
        return OUT_BUILD_SWITCH.TO_SOURCE(creep);
    }

    // 没有建造/维修工作：跟采集工一起做采集——
    // 满载先卸（source 容器 / 外矿搬运工 / 掉落），其余时间回源相位继续采
    if (source && deliverAssistHarvest(creep, source)) {
        return OUT_BUILD_SWITCH.TO_SOURCE(creep);
    }

    stepAsideFromRoad(creep);
    return OUT_BUILD_SWITCH.TO_SOURCE(creep);
};

const onTarget = (creep: Creep): WorkEvent => {
    const shouldSwitch = runBuildPhase(creep);
    if (shouldSwitch) creep.say('SRC');
    return shouldSwitch ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    const shouldSwitch = runHarvestPhase(creep);
    if (shouldSwitch) creep.say('BLD');
    return shouldSwitch ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
};

export const syncOutBuildMoveWork = (creep: Creep) => {
    const cache = ensureMemoryCache(creep.memory).role as Record<string, any>;
    const candidates = [];

    if (cache.targetId) {
        const target = Game.getObjectById(cache.targetId as Id<ConstructionSite>);
        if (target) candidates.push({ pos: target.pos, range: 3 });
    }

    if (cache.repairId) {
        const target = Game.getObjectById(cache.repairId as Id<Structure>);
        if (target) candidates.push({ pos: target.pos, range: 3 });
    }

    writeMoveWorkTileCandidates(creep, candidates);
};

const outBuild = {
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource,
            onTarget
        });
    }
};

export default outBuild;
