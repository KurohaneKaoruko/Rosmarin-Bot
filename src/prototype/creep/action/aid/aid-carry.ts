function withdraw(creep: Creep) {
    if(!creep.memory['resource']) creep.memory['resource'] = RESOURCE_ENERGY;

    const drop = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 5, {
        filter: (i) => i.resourceType === creep.memory['resource']
    })[0]
    if (drop) {
        if (creep.pickup(drop) === ERR_NOT_IN_RANGE) {
            creep.moveTo(drop);
        }
        return;
    }

    const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 5, {
        filter: (i) => i.store.getUsedCapacity() > 0 && (i.store.getUsedCapacity(creep.memory['resource']))
    })[0]
    if (tombstone) {
        if (creep.withdraw(tombstone, creep.memory['resource']) === ERR_NOT_IN_RANGE) {
            creep.moveTo(tombstone);
        }
        return;
    }

    if (creep.room.name != creep.memory.sourceRoom) {
        creep.moveToRoom(creep.memory.sourceRoom);
        return;
    }

    const res = creep.memory['resource'];

    const target = [creep.room.storage, creep.room.terminal].filter((i) => {
        return i && i.store[res] > 0 && (creep.room.my || 
            i.pos.lookFor(LOOK_STRUCTURES).every((i) => i.structureType !== STRUCTURE_RAMPART));
    })[0];

    if (target) creep.goWithdraw(target, res);

    return;
}

function transfer(creep: Creep) {
    if (creep.room.name != creep.memory.targetRoom) {
        creep.moveToRoom(creep.memory.targetRoom);
        return;
    }

    const res = creep.memory['resource'] || RESOURCE_ENERGY;

    
    let targets = [creep.room.storage, creep.room.terminal].filter((i) => i && i.store.getFreeCapacity(res) > 0) as any;
    let target = creep.pos.findClosestByRange(targets) as any;
    if (!target) {
        targets = [...creep.room.container].filter((i) => i && i.store.getFreeCapacity(res) > 0);
        target = creep.pos.findClosestByRange(targets);
    }

    if (target) {
        creep.goTransfer(target, Object.keys(creep.store)[0] as ResourceConstant);
    } else {
        creep.drop(res);
    }
    
}



const AidCarryFunction = {
    prepare: function (creep: Creep) {
        if (creep.memory['boostmap']) {
            let result = creep.Boost(creep.memory['boostmap']);
            if (result === OK) return true;
            else return false;
        } else {
            let result = creep.goBoost(['XKH2O', 'KH2O', 'KH']);
            return result;
        }
        
    },

    source: function (creep: Creep) {
        if(!creep.memory.ready) return false;
        if (creep.store.getFreeCapacity() === 0) {
            transfer(creep);
            return true;
        } else withdraw(creep);
        return false;
    },
    target: function (creep: Creep) {
        if(!creep.memory.ready) return false;
        if (creep.store.getUsedCapacity() === 0) {
            withdraw(creep);
            return true;
        } else transfer(creep);
        return false;
    }
};

export default AidCarryFunction;