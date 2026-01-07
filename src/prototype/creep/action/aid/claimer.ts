const claimer = {
    run: function(creep: Creep) {
        // 如果没有目标房间
        if (!creep.memory.targetRoom) {
            creep.say("🚨 无目标");
            return;
        }

        // 如果有治疗组件并且受伤，那么治疗
        if (creep.getActiveBodyparts(HEAL) > 0 && creep.hits < creep.hitsMax) {
            creep.heal(creep);
        }

        // 根据旗帜移动
        const name = creep.name.match(/_(\w+)/)?.[1];
        const moveflag = Game.flags[name + '-move'];
        if(moveflag) {
            if(creep.room.name !== moveflag.pos.roomName) {
                creep.memory.targetRoom = moveflag.pos.roomName;
            }
            creep.moveTo(moveflag.pos, {visualizePathStyle: {stroke: '#00ff00'}})
            return;
        }

        // 如果不在目标房间，向目标房间移动
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }
    
        const controller = creep.room.controller;

        if (!controller) return;

        if (controller.reservation &&
            controller.reservation.username != creep.owner.username) {
            if (creep.pos.isNearTo(controller)) {
                creep.attackController(controller);
            } else {
                creep.moveTo(controller, {
                    visualizePathStyle: { stroke: '#ffffff' },
                    range: 1,
                    maxRooms: 1
                });
            }
            return;
        }

        // 尝试占领控制器
        if (controller.my) return;

        if (creep.pos.isNearTo(controller)) {
            const result = creep.claimController(controller);
            if(creep.memory['sign']) creep.signController(controller, creep.memory['sign']);
            if(result !== OK) { creep.reserveController(controller); }
        }
        else {
            creep.moveTo(controller, {
                visualizePathStyle: { stroke: '#ffffff' },
                range: 1,
                maxRooms: 1
            });
        }
        
        return false;
    }
};

export default claimer;
