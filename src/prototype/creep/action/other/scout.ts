const Scout = {
    target: function(creep: Creep) {
        if (creep.room.name !== creep.memory.targetRoom) {
            creep.moveToRoom(creep.memory.targetRoom, { plainCost: 1, swampCost: 1 });
            return false;
        }

        const controller = creep.room.controller;
        if (!controller) return false;
        if (creep.memory['sign'] != undefined && creep.memory['sign'] !== controller.sign?.text) {
            if (creep.pos.isNearTo(controller)) {
                creep.signController(creep.room.controller, creep.memory['sign']);
            } else {
                creep.moveTo(controller);
            }
        } else {
            creep.moveTo(new RoomPosition(25, 25, creep.room.name), { plainCost: 1, swampCost: 1 });
        }
        
        return false;
    },
    source: function() {
        return true;
    }
}

export default Scout;