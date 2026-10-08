import { WORK_EVENTS, WorkEvent } from '@/prototype/Creep/family/flow/workLayer';
import { runWorkLayer } from '@/prototype/Creep/family/flow/workLayer';

function withdraw(creep: Creep) {
    if(!creep.memory['resource']) creep.memory['resource'] = RESOURCE_ENERGY;

    if (creep.collectDroppedResource(creep.memory['resource'], 0, 5)) {
        return;
    }

    if (creep.collectFromTombstone(creep.memory['resource'])) {
        return;
    }

    if (!creep.moveToSourceRoom()) {
        return;
    }

    const res = creep.memory['resource'];
    const jumpMode = !!creep.memory.jumpMode;

    let target = creep.pos.findClosestByRange([creep.room.storage, creep.room.terminal].filter((i) => {
        return i && i.store[res] > 0 && (creep.room.my || 
            i.pos.lookFor(LOOK_STRUCTURES).every((i) => i.structureType !== STRUCTURE_RAMPART));
    })) as AnyStoreStructure | null;

    if (!target) {
        const containers = [...creep.room.container].filter((i) => i && (i.store[res] || 0) > 0);
        target = creep.pos.findClosestByRange(containers) as AnyStoreStructure | null;
    }

    if (!target && jumpMode && res === RESOURCE_ENERGY) {
        const energyStructs = creep.room.find(FIND_MY_STRUCTURES, {
            filter: (s) =>
                (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                (s.store?.[RESOURCE_ENERGY] || 0) > 0
        }) as AnyStoreStructure[];
        target = creep.pos.findClosestByRange(energyStructs) as AnyStoreStructure | null;
    }

    if (target) creep.goWithdraw(target, res);

    return;
}

function transfer(creep: Creep) {
    if (!creep.moveToTargetRoom()) {
        return;
    }

    const res = creep.memory['resource'] || RESOURCE_ENERGY;

    
    let target: AnyStoreStructure | null = null;
    const jumpMode = !!creep.memory.jumpMode;

    if (jumpMode) {
        const containerTargets = [...creep.room.container].filter((i) => i && i.store.getFreeCapacity(res) > 0);
        target = creep.pos.findClosestByRange(containerTargets) as any;
    }

    if (!target) {
        let targets = [creep.room.storage, creep.room.terminal].filter((i) => i && i.store.getFreeCapacity(res) > 0) as any;
        target = creep.pos.findClosestByRange(targets) as any;
        if (!target) {
            targets = [...creep.room.container].filter((i) => i && i.store.getFreeCapacity(res) > 0);
            target = creep.pos.findClosestByRange(targets) as any;
        }
    }

    if (target) {
        creep.goTransfer(target, Object.keys(creep.store)[0] as ResourceConstant);
    } else {
        creep.drop(res);
    }
    
}

const onSource = (creep: Creep): WorkEvent => {
    if (creep.store.getFreeCapacity() === 0) {
        transfer(creep);
        return WORK_EVENTS.TO_TARGET;
    }
    withdraw(creep);
    return WORK_EVENTS.STAY;
};

const onTarget = (creep: Creep): WorkEvent => {
    if (creep.store.getUsedCapacity() === 0) {
        withdraw(creep);
        return WORK_EVENTS.TO_SOURCE;
    }
    transfer(creep);
    return WORK_EVENTS.STAY;
};

const AidCarryFunction = {
    prepare: (creep) => {
        return creep.ensureBoosted(creep.memory['boostmap']);
    },
    run: (creep) => {
        runWorkLayer(creep, { onSource, onTarget }, { reenter: true });
    }
};

export default AidCarryFunction;
