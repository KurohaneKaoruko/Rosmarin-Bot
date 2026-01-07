const outInvader = {
    run: function(creep: any) {
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }

        const invaderCores = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType === STRUCTURE_INVADER_CORE
        });

        let targets = invaderCores;
        if (targets.length === 0) {
            const hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: (c: Creep) => !Memory['whitelist']?.includes(c.owner.username) && (
                    c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0
                )});
            targets = hostileCreeps;
        }
        
        if (targets.length > 0) {
            var target = creep.pos.findClosestByRange(targets);
            if (creep.pos.inRangeTo(target, 1)) {
                creep.attack(target)
            }
            else {
                creep.moveTo(target);
            }
            return;
        }

        if (targets.length === 0) {
            creep.memory['suicideCount'] = (creep.memory['suicideCount']||0) + 1;
            if (creep.memory['suicideCount'] >= 10) creep.suicide();
        }

        return;
    }
}

export default outInvader;