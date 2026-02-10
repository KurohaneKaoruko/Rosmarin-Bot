import { outSignConstant } from "@/constant/NameConstant";

const OUTMINE_SIGN_OVERWRITE = true;

const Reserve = {
    target: function(creep: Creep) {
        if (!creep.moveToTargetRoom()) return false;

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

            let desired = creep.memory['outmineSign'];
            if (!desired) {
                const index = Math.floor(Math.random() * outSignConstant.length);
                desired = outSignConstant[index];
                creep.memory['outmineSign'] = desired;
            }

            if (OUTMINE_SIGN_OVERWRITE) {
                if (!controller.sign || controller.sign.username !== creep.owner.username) {
                    if (controller.sign?.text !== desired) creep.signController(controller, desired);
                }
            } else if (!controller.sign) {
                creep.signController(controller, desired);
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
