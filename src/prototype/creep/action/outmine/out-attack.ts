const outAttack = {
    run: function (creep: Creep) {
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }
    
        let hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (c) => c.owner.username == 'Source Keeper'
        });
        if (hostileCreeps.length > 0) {
            let target = creep.pos.findClosestByRange(hostileCreeps);
            if (!creep.pos.isNearTo(target)) {
                creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
            } else if (target.body.every((part) => part.type !== ATTACK)) {
                creep.attack(target);
                creep.moveTo(target)
                return;
            }
            if (creep.hits < creep.hitsMax) creep.heal(creep);
            return;
        }
    
        let myCreeps = creep.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.hits < c.hitsMax && c.id !== creep.id &&
                c.memory.role != 'out-carry' && c.memory.role != 'out-car'
        });
        if (myCreeps.length > 0) {
            let target = creep.pos.findClosestByRange(myCreeps);
            if (creep.pos.inRangeTo(target, 1)) {
                creep.heal(target);
            } else {
                if (creep.hits < creep.hitsMax) creep.heal(creep);
                creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
            return;
        }
    
        let lairs = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_KEEPER_LAIR;
            }
        });
        if (lairs.length > 0) {
            let target = lairs.reduce((l, r) => l.ticksToSpawn < r.ticksToSpawn ? l : r);
            if (!creep.pos.isNearTo(target)) {
                creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
            if (creep.hits < creep.hitsMax) creep.heal(creep);
            return;
        }
        
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        return;
    }
}

export default outAttack;