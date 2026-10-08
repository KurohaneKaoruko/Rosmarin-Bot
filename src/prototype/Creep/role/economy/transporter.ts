import { MISSION_POOLS } from '@/constant/MissionConstant';
import { runWorkLayer } from '@/prototype/Creep/family/flow/workLayer';
import { WORK_EVENTS, WorkEvent } from '@/prototype/Creep/family/flow/workLayer';

const TRANSPORT_SOURCE_MOVE_OPTS: MoveToOpts = {
    visualizePathStyle: { stroke: '#ffaa00' },
    maxRooms: 1,
    range: 1,
};

const TRANSPORT_TARGET_MOVE_OPTS: MoveToOpts = {
    visualizePathStyle: { stroke: '#ffffff' },
    maxRooms: 1,
    range: 1,
};

const moveToTransportTarget = (creep: Creep, target: RoomObject, options: MoveToOpts) => {
    creep.moveTo(target, options);
};

const isStoreStructure = (target: Structure | null): target is AnyStoreStructure => {
    return !!target && 'store' in target;
};

const clearTransportMission = (creep: Creep, mission: Task | null | undefined) => {
    if (mission) {
        creep.room.deleteMissionFromPool(MISSION_POOLS.transport, mission.id);
    }
    delete creep.getRoleCache().mission;
};

const runFallback = (creep: Creep) => {
    if (creep.store.getUsedCapacity() === 0) return;

    const resource = Object.keys(creep.store)[0] as ResourceConstant | undefined;
    if (!resource) return;

    const target = creep.findBestStoreTarget(resource);
    if (!target) {
        creep.drop(resource);
        return;
    }

    creep.goTransfer(target, resource);
};

const flushForeignResources = (creep: Creep, keepResource: ResourceConstant): boolean => {
    if (creep.store.getUsedCapacity() === 0) return false;

    for (const resource of Object.keys(creep.store) as ResourceConstant[]) {
        if (resource === keepResource || (creep.store[resource] || 0) <= 0) continue;

        const target = creep.findBestStoreTarget(resource);
        if (target) {
            creep.goTransfer(target, resource);
        } else {
            creep.drop(resource);
        }
        return true;
    }

    return false;
};

const getTransportMissionContext = (creep: Creep) => {
    const mission = creep.getRoleCache().mission;
    if (!mission) return null;

    const data = mission.data as TransportTask;
    const source = Game.getObjectById(data.source);
    const target = Game.getObjectById(data.target);

    return {
        mission,
        source: isStoreStructure(source) ? source : null,
        target: isStoreStructure(target) ? target : null,
        resourceType: data.resourceType,
        amount: data.amount,
    };
};

const onSource = (creep: Creep): WorkEvent => {
    if (creep.ticksToLive <= 20) {
        if (creep.store.getUsedCapacity() > 0) return WORK_EVENTS.TO_TARGET;
        runFallback(creep);
        return WORK_EVENTS.STAY;
    }

    if (!creep.getRoleCache().mission) {
        creep.getRoleCache().mission = creep.room.getTransportMission(creep);
        if (!creep.getRoleCache().mission) {
            delete creep.getRoleCache().mission;
            return WORK_EVENTS.STAY;
        }
    }

    const context = getTransportMissionContext(creep);
    if (!context) return WORK_EVENTS.STAY;

    const { mission, source, target, resourceType, amount } = context;
    if (!target || target.store.getFreeCapacity(resourceType) === 0) {
        clearTransportMission(creep, mission);
        return WORK_EVENTS.STAY;
    }
    if (!source || creep.store[resourceType] + source.store[resourceType] < amount) {
        clearTransportMission(creep, mission);
        return WORK_EVENTS.STAY;
    }

    if (flushForeignResources(creep, resourceType)) return WORK_EVENTS.STAY;

    if (creep.store[resourceType] >= amount || creep.store.getFreeCapacity(resourceType) === 0) {
        return WORK_EVENTS.TO_TARGET;
    }

    if (!creep.pos.isNearTo(source)) {
        moveToTransportTarget(creep, source, TRANSPORT_SOURCE_MOVE_OPTS);
        return WORK_EVENTS.STAY;
    }

    const freeCapacity = creep.store.getFreeCapacity(resourceType);
    const result = creep.withdraw(source, resourceType);
    if (result !== OK) return WORK_EVENTS.STAY;

    if (source.store[resourceType] >= freeCapacity ||
        creep.store[resourceType] >= amount ||
        creep.store.getFreeCapacity(resourceType) === 0) {
        return WORK_EVENTS.TO_TARGET;
    }

    return WORK_EVENTS.STAY;
};

const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.getRoleCache().mission) {
        if (creep.store.getUsedCapacity() === 0) return WORK_EVENTS.TO_SOURCE;
        runFallback(creep);
        return WORK_EVENTS.STAY;
    }

    const context = getTransportMissionContext(creep);
    if (!context) {
        if (creep.store.getUsedCapacity() === 0) return WORK_EVENTS.TO_SOURCE;
        runFallback(creep);
        return WORK_EVENTS.STAY;
    }

    const { mission, target, resourceType, amount } = context;
    if (!target || target.store.getFreeCapacity(resourceType) === 0) {
        clearTransportMission(creep, mission);
        if ((creep.store[resourceType] || 0) > 0) {
            runFallback(creep);
            return WORK_EVENTS.STAY;
        }
        return WORK_EVENTS.TO_SOURCE;
    }

    if (creep.store.getUsedCapacity() === 0) {
        delete creep.getRoleCache().mission;
        return WORK_EVENTS.TO_SOURCE;
    }

    if (!creep.pos.isNearTo(target)) {
        moveToTransportTarget(creep, target, TRANSPORT_TARGET_MOVE_OPTS);
        return WORK_EVENTS.STAY;
    }

    const transferAmount = Math.min(
        amount,
        creep.store[resourceType] || 0,
        target.store.getFreeCapacity(resourceType)
    );

    if (transferAmount <= 0) {
        clearTransportMission(creep, mission);
        runFallback(creep);
        return creep.store.getUsedCapacity() === 0 ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
    }

    const result = creep.transfer(target, resourceType, transferAmount);
    if (result === OK) {
        creep.room.submitTransportMission(mission.id, transferAmount);

        if (creep.store.getUsedCapacity() === 0) {
            delete creep.getRoleCache().mission;
            return WORK_EVENTS.TO_SOURCE;
        }

        creep.getRoleCache().mission = creep.room.getTransportMission(creep);
        if (!creep.getRoleCache().mission) {
            delete creep.getRoleCache().mission;
        }
        return WORK_EVENTS.STAY;
    }

    if (result === ERR_FULL || result === ERR_INVALID_TARGET || result === ERR_INVALID_ARGS) {
        clearTransportMission(creep, mission);
        runFallback(creep);
    }

    return creep.store.getUsedCapacity() === 0 ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
};

const transporterRole = {
    run: (creep) => {
        runWorkLayer(creep, { onSource, onTarget }, { reenter: true });
    }
};

export default transporterRole;
