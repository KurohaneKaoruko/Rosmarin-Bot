const aclaimer = {
    run: function(creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }
    
        const controller = creep.room.controller;

        if (!controller || controller.level == 0) {
            creep.room.find(FIND_FLAGS, { filter: f => f.name.startsWith('ACLAIM/') }).forEach(f => f.remove())
            creep.suicide();
            return;
        }
    
        if ((controller.upgradeBlocked||0) > creep.ticksToLive) {
            creep.suicide();
            return;
        }
    
        if (creep.pos.isNearTo(controller)) {
            creep.memory.dontPullMe = true;
            const area = [ controller.pos.y-1, controller.pos.x-1,
                        controller.pos.y+1, controller.pos.x+1 ]
                        .map((xy) => Math.max(0, Math.min(xy, 49)))
            let creeps = creep.room.lookForAtArea(LOOK_CREEPS, area[0], area[1] , area[2], area[3], true)
                            .filter((c) => c.creep.my && c.creep.memory.role == 'aclaimer');
            if(creeps.length < creep.memory['num'] && creep.ticksToLive > 10) return;
            if (creep.ticksToLive <= 10) {
                creeps.forEach((c) => c.creep.attackController(controller));
            } else {
                creep.attackController(controller);
            }
        } else {
            creep.moveTo(controller, {range:1});
        }
    }
}

export default aclaimer