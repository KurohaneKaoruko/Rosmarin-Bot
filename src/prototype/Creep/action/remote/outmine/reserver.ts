import { outSignConstant } from "@/constant/NameConstant";
import { runWorkLayer } from '@/core/ai/adapters';
import { WORK_EVENTS, WorkEvent } from '@/core/ai/workMachine';

/**
 * 外矿预定签名策略：
 * - `true` 时允许覆盖非我方签名或空签名；
 * - `false` 时仅在未签名情况下写入。
 */
const OUTMINE_SIGN_OVERWRITE = true;

/**
 * reserver 在目标态的行为：
 * - 抵达目标房间；
 * - 预定控制器或攻击他人预定；
 * - 写入外矿签名。
 *
 * @param creep 当前 reserver creep。
 * @returns 工作层状态事件。
 */
const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

    const controller = creep.room.controller;
    if (!controller) return WORK_EVENTS.STAY;

    if (creep.pos.inRangeTo(controller, 1)) {
        if (controller.reservation &&
            controller.reservation.username != creep.owner.username) {
            creep.attackController(controller);
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

/**
 * reserver 的 source 态为占位态，固定切回目标态。
 *
 * @returns 永远返回 `TO_TARGET`。
 */
const onSource = (): WorkEvent => {
    return WORK_EVENTS.TO_TARGET;
};

/**
 * 外矿 reserver 角色入口。
 */
const reserverRole = {
    /**
     * 执行 reserver 的 WorkLayer 状态机。
     *
     * @param creep 当前 creep。
     */
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource: () => onSource(),
            onTarget,
        });
    }
};

export default reserverRole;
