import {outSignConstant} from "@/constant/SignConstant";

const Reserve = {
    target: function(creep: Creep) {
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return false;
        }

        const controller = creep.room.controller;
        
        if(!controller) return;
        if (creep.pos.inRangeTo(controller, 1)) {
            if (controller.reservation &&
                controller.reservation.username != creep.owner.username) {
                creep.attackController(controller)
            } else {
                const ticksToEnd = controller.reservation?.ticksToEnd || 0;
                if (ticksToEnd >= 4990) return false;
                creep.reserveController(controller);
            }

            if (!controller.sign || controller.sign.username != creep.owner.username) {
                const index = Math.floor(Math.random() * outSignConstant.length);
                creep.signController(controller, outSignConstant[index]);
            }
        }
        else {
            creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
        return false;
    },
    source: function(creep: Creep) {
        return true;
    }
}

export default Reserve;