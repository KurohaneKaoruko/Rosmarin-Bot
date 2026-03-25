import { runWorkLayer } from '@/framework/ai/adapters';
import { writeMoveWorkTileCandidates } from '@/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

const BUILD_PRIORITY = [STRUCTURE_CONTAINER, STRUCTURE_ROAD] as StructureConstant[];
const ENERGY_DROP_MIN = 20;
const ENERGY_CONTAINER_MIN = 50;
const REPAIR_RATIO = 0.8;
const SOURCE_FETCH_START_RANGE = 3;
const SOURCE_WORK_PREFER_RANGE = 6;
const SOURCE_KEEPER_RANGE = 5;

const OUT_BUILD_SWITCH = {
    TO_TARGET: (creep: Creep) => creep.store.getFreeCapacity() === 0,
    TO_SOURCE: (creep: Creep) => creep.store.getUsedCapacity() === 0
} as const;

type OutBuildIndexedRoom = Room & {
    source?: Source[];
};

const inTargetRoom = (creep: Creep): boolean =>
    creep.room.name === creep.memory.targetRoom && !creep.pos.isRoomEdge();

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

const getAssignedSource = (creep: Creep): Source | null => {
    const boundSourceId = creep.memory.targetSourceId as Id<Source> | undefined;
    if (boundSourceId) {
        const boundSource = Game.getObjectById(boundSourceId) as Source | null;
        if (boundSource && boundSource.pos?.roomName === creep.memory.targetRoom) return boundSource;
        if (inTargetRoom(creep)) delete creep.memory.targetSourceId;
    }

    if (!inTargetRoom(creep)) return null;
    const sources = getRoomSources(creep.room);
    if (sources.length <= 0) return null;

    const source = creep.pos.findClosestByRange(sources) || pickClosestByRange(creep.pos, sources);
    if (source) creep.memory.targetSourceId = source.id;
    return source || null;
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

const pickPreferredTarget = <T extends { pos: RoomPosition; structureType?: StructureConstant }>(
    creep: Creep,
    source: Source | null,
    targets: T[],
): T | null => {
    if (targets.length <= 0) return null;

    const scopedTargets = source
        ? targets.filter((target) => source.pos.getRangeTo(target) <= SOURCE_WORK_PREFER_RANGE)
        : [];
    const candidates = scopedTargets.length > 0 ? scopedTargets : targets;

    let best: T | null = null;
    let bestTypePriority = Infinity;
    let bestSourceRange = Infinity;
    let bestCreepRange = Infinity;

    for (const target of candidates) {
        const typePriority = getBuildTypePriority(target.structureType);
        const sourceRange = source ? source.pos.getRangeTo(target) : 0;
        const creepRange = creep.pos.getRangeTo(target);
        if (
            typePriority < bestTypePriority ||
            (typePriority === bestTypePriority && sourceRange < bestSourceRange) ||
            (typePriority === bestTypePriority && sourceRange === bestSourceRange && creepRange < bestCreepRange)
        ) {
            best = target;
            bestTypePriority = typePriority;
            bestSourceRange = sourceRange;
            bestCreepRange = creepRange;
        }
    }

    return best;
};

const getOutBuildTargetCache = (creep: Creep): Record<string, any> => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    return (cache.target && typeof cache.target === 'object' ? cache.target : (cache.target = {})) as Record<string, any>;
};

const findBuildTarget = (creep: Creep, source: Source | null): ConstructionSite | null => {
    const cache = getOutBuildTargetCache(creep);
    if (cache.targetId) {
        const cached = Game.getObjectById(cache.targetId as Id<ConstructionSite>) as ConstructionSite | null;
        if (cached && cached.my && (cached.structureType === STRUCTURE_ROAD || cached.structureType === STRUCTURE_CONTAINER)) {
            return cached;
        }
        delete cache.targetId;
    }

    const sites = creep.room.find(FIND_CONSTRUCTION_SITES, {
        filter: (site) =>
            site.my && (site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER)
    });
    const target = pickPreferredTarget(creep, source, sites);
    if (target) cache.targetId = target.id;
    return target;
};

const findRepairTarget = (creep: Creep, source: Source | null): Structure | null => {
    const cache = getOutBuildTargetCache(creep);
    if (cache.repairId) {
        const cached = Game.getObjectById(cache.repairId as Id<Structure>) as Structure | null;
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
    const target = pickPreferredTarget(creep, source, targets);
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

    const buildTarget = findBuildTarget(creep, source);
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

    const repairTarget = findRepairTarget(creep, source);
    if (repairTarget) {
        syncOutBuildMoveWork(creep);
        const result = creep.repair(repairTarget);
        if (result === ERR_NOT_IN_RANGE) {
            moveToLocalTarget(creep, repairTarget, 3);
        }
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
    const cache = (ensureMemoryCache(creep.memory).target as Record<string, any> | undefined) || {};
    const candidates = [];

    if (cache.targetId) {
        const target = Game.getObjectById(cache.targetId as Id<ConstructionSite>) as ConstructionSite | null;
        if (target) candidates.push({ pos: target.pos, range: 3 });
    }

    if (cache.repairId) {
        const target = Game.getObjectById(cache.repairId as Id<Structure>) as Structure | null;
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
