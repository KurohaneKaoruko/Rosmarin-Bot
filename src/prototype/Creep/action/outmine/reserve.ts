import { outSignConstant } from "@/constant/NameConstant";
import { runWorkLayer } from '@/framework/ai/adapters';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';

const OUTMINE_SIGN_OVERWRITE = true;

const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

        const controller = creep.room.controller;
        
        if(!controller) return WORK_EVENTS.STAY;
        if (creep.pos.inRangeTo(controller, 1)) {
            if (controller.reservation &&
                controller.reservation.username != creep.owner.username) {
                creep.attackController(controller)
            } else {
                const ticksToEnd = controller.reservation?.ticksToEnd || 0;
                if (ticksToEnd >= 4990) return WORK_EVENTS.STAY;
                creep.reserveController(controller);
            }

            let desired = creep.memory['outmineSign'];
            if (!desired) {
                const index = Math.floor(Math.random() * outSignConstant.length);
                desired = outSignConstant[index];
                creep.memory['outmineSign'] = desired;
            }

            if (OUTMINE_SIGN_OVERWRITE) {
                creep.signControllerIfNeeded(desired, {
                    overwrite: !controller.sign || controller.sign.username !== creep.owner.username
                });
            } else if (!controller.sign) {
                creep.signControllerIfNeeded(desired);
            }
        }
        else {
            creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
        return WORK_EVENTS.STAY;
};

const onSource = (): WorkEvent => {
    return WORK_EVENTS.TO_TARGET;
};

const Reserve = {
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource: ({ creep }) => onSource(),
            onTarget: ({ creep }) => onTarget(creep),
        });
    }
}

export default Reserve;
