import { runWorkLayer } from '@/framework/ai/adapters';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';

const BUILD_PRIORITY = [STRUCTURE_CONTAINER, STRUCTURE_ROAD] as StructureConstant[];
const ENERGY_DROP_MIN = 20;
const ENERGY_CONTAINER_MIN = 50;
const REPAIR_RATIO = 0.8;

// 迁移条件集中声明：满能 -> 切建造，空能 -> 回采集
const OUT_BUILD_SWITCH = {
    TO_TARGET: (creep: Creep) => creep.store.getFreeCapacity() === 0,
    TO_SOURCE: (creep: Creep) => creep.store.getUsedCapacity() === 0
} as const;

const inTargetRoom = (creep: Creep): boolean =>
    creep.room.name === creep.memory.targetRoom && !creep.pos.isRoomEdge();

const moveToTargetRoom = (creep: Creep): void => {
    creep.memory.dontPullMe = false;
    creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
};

const isRoadPos = (pos: RoomPosition): boolean => {
    const structures = pos.lookFor(LOOK_STRUCTURES) as Structure[];
    return structures.some((s) => s.structureType === STRUCTURE_ROAD);
};

// 让出道路，避免外矿建造/采集占道
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

            // 优先离开道路，其次就近。
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

// 选择建造目标（仅道路/容器）
const findBuildTarget = (creep: Creep): ConstructionSite | null => {
    const cache = (creep.memory.cacheTarget ||= {}) as any;
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
    if (sites.length <= 0) return null;

    let target: ConstructionSite | null = null;
    for (const type of BUILD_PRIORITY) {
        const typed = sites.filter((s) => s.structureType === type);
        if (typed.length <= 0) continue;
        target = creep.pos.findClosestByRange(typed);
        if (target) break;
    }
    if (!target) target = creep.pos.findClosestByRange(sites);
    if (target) cache.targetId = target.id;
    return target;
};

// 选择维修目标（道路/容器）
const findRepairTarget = (creep: Creep): Structure | null => {
    const cache = (creep.memory.cacheTarget ||= {}) as any;
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
        filter: (s) =>
            (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_CONTAINER) &&
            s.hits < s.hitsMax * REPAIR_RATIO
    });
    if (targets.length <= 0) return null;

    const target = creep.pos.findClosestByRange(targets);
    if (target) cache.repairId = target.id;
    return target;
};

// 优先回收掉落能量，减少抢矿点
const tryWithdrawEnergy = (creep: Creep): boolean => {
    if (creep.collectDroppedResource(RESOURCE_ENERGY, ENERGY_DROP_MIN)) return true;
    if (creep.collectFromTombstone(RESOURCE_ENERGY, ENERGY_DROP_MIN)) return true;
    if (creep.collectFromRuin(RESOURCE_ENERGY)) return true;
    if (creep.collectFromContainer(ENERGY_CONTAINER_MIN, RESOURCE_ENERGY, false)) return true;
    return false;
};

// 采集阶段
const runHarvestPhase = (creep: Creep): boolean => {
    if (!inTargetRoom(creep)) {
        moveToTargetRoom(creep);
        return false;
    }
    creep.memory.dontPullMe = false;

    if (tryWithdrawEnergy(creep)) return OUT_BUILD_SWITCH.TO_TARGET(creep);

    const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE) || creep.pos.findClosestByRange(FIND_SOURCES);
    if (source) {
        const result = creep.harvest(source);
        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 1,
                plainCost: 2,
                swampCost: 10
            });
        }
    }

    // 没有可拿资源时让路，避免外矿道路拥堵。
    stepAsideFromRoad(creep);
    return OUT_BUILD_SWITCH.TO_TARGET(creep);
};

// 建造/维修阶段
const runBuildPhase = (creep: Creep): boolean => {
    if (!inTargetRoom(creep)) {
        moveToTargetRoom(creep);
        return false;
    }
    creep.memory.dontPullMe = false;

    if (creep.store.getFreeCapacity() > 0) {
        creep.collectDroppedResource(RESOURCE_ENERGY, ENERGY_DROP_MIN, 3);
    }

    const buildTarget = findBuildTarget(creep);
    if (buildTarget) {
        const result = creep.build(buildTarget);
        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(buildTarget, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 3,
                plainCost: 2,
                swampCost: 10
            });
        }
        return OUT_BUILD_SWITCH.TO_SOURCE(creep);
    }

    const repairTarget = findRepairTarget(creep);
    if (repairTarget) {
        const result = creep.repair(repairTarget);
        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(repairTarget, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 3,
                plainCost: 2,
                swampCost: 10
            });
        }
        return OUT_BUILD_SWITCH.TO_SOURCE(creep);
    }

    // 没有工地时把能量回灌，避免满能量长期占道。
    const nearContainer = creep.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s: Structure) =>
            s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > 0
    })[0] as StructureContainer | undefined;
    if (nearContainer && creep.store[RESOURCE_ENERGY] > 0) {
        creep.transfer(nearContainer, RESOURCE_ENERGY);
        return OUT_BUILD_SWITCH.TO_SOURCE(creep);
    }

    const nearCarrier = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (c: Creep) =>
            (c.memory.role === 'out-carry' || c.memory.role === 'out-car') &&
            c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    })[0];
    if (nearCarrier && creep.store[RESOURCE_ENERGY] > 0) {
        creep.transfer(nearCarrier, RESOURCE_ENERGY);
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

const outBuild = {
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource: ({ creep }) => onSource(creep),
            onTarget: ({ creep }) => onTarget(creep)
        });
    }
};

export default outBuild;
