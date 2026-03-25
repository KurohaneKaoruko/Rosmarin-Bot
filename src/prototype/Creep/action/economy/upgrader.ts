import { createBoostedRole, createWorkLayerRole } from '@/framework/ai/creepRole';
import { writeMoveWorkTileCandidates } from '@/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';

/**
 * 主房升级工在「升级态」下的行为：
 * - 回到 home 房间；
 * - 清理与采集目标相关的缓存；
 * - 持续升级控制器，空仓时切回取能态。
 *
 * @param creep 当前执行的 creep。
 * @returns 工作层状态机事件。
 */
const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
    if (creep.store.getUsedCapacity() === 0) {
        creep.say('🔄');
        return WORK_EVENTS.TO_SOURCE;
    }

    creep.runControllerUpgrade();
    if (creep.store.getUsedCapacity() === 0) {
        creep.say('🔄');
        return WORK_EVENTS.TO_SOURCE;
    }
    syncUpgraderMoveWork(creep);
    return WORK_EVENTS.STAY;
};

/**
 * 主房升级工在「取能态」下的行为：
 * - 回到 home 房间；
 * - 从控制器周边能源体系补能；
 * - 满仓后立即切回升级态并可当 tick 开始升级。
 *
 * @param creep 当前执行的 creep。
 * @returns 工作层状态机事件。
 */
const onSource = (creep: Creep): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
    if (creep.store.getFreeCapacity() === 0) {
        creep.say('⚡');
        creep.runControllerUpgrade();
        return WORK_EVENTS.TO_TARGET;
    }

    const fullAfterTake = creep.acquireEnergy({ pickup: false });
    if (fullAfterTake) {
        if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
        creep.say('⚡');
        creep.runControllerUpgrade();
        return WORK_EVENTS.TO_TARGET;
    }
    return WORK_EVENTS.STAY;
};

export const syncUpgraderMoveWork = (creep: Creep) => {
    if (
        creep.room.controller?.my &&
        creep.memory.working &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
        writeMoveWorkTileCandidates(creep, [{ pos: creep.room.controller.pos, range: 3 }]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

/**
 * 主房升级角色入口。
 *
 * @remarks
 * 使用 WorkLayer 统一驱动「取能 -> 升级」循环，
 * 并在 prepare 阶段执行升级加速 boost。
 */
const upgraderWork = createWorkLayerRole({
    onSource,
    onTarget
});

const Upgrader = createBoostedRole({
    boost: (creep) => creep.room.level == 8 ? null : { [WORK]: ['XGH2O', 'GH2O', 'GH'] },
    run: upgraderWork.run
});

export default Upgrader;
