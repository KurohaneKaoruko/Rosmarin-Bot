import { runWorkLayer } from '@/framework/ai/adapters';
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
    if (!creep.memory.ready) return WORK_EVENTS.STAY;
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
    if (!creep.memory.ready) return WORK_EVENTS.STAY;
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
    if (creep.store.getFreeCapacity() === 0) {
        creep.say('⚡');
        creep.runControllerUpgrade();
        return WORK_EVENTS.TO_TARGET;
    }

    const fullAfterTake = creep.withdrawControllerEnergy({
        linkRange: 2,
        containerRange: 3,
        fallbackToTakeEnergy: true,
    });
    if (fullAfterTake) {
        if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
        creep.say('⚡');
        creep.runControllerUpgrade();
        return WORK_EVENTS.TO_TARGET;
    }
    return WORK_EVENTS.STAY;
};

/**
 * 主房升级角色入口。
 *
 * @remarks
 * 使用 WorkLayer 统一驱动「取能 -> 升级」循环，
 * 并在 prepare 阶段执行升级加速 boost。
 */
const Upgrader = {
    /**
     * 升级工准备阶段：
     * - RCL8 不再强制 boost；
     * - 其余等级尝试按优先级执行 WORK boost。
     *
     * @param creep 当前 creep。
     * @returns `true` 表示准备完成。
     */
    prepare: function (creep: Creep) {
        if (creep.room.level == 8) return true;
        return creep.goBoost({ [WORK]: ['XGH2O', 'GH2O', 'GH'] }) === OK;
    },

    /**
     * 执行升级工工作层状态机。
     *
     * @param creep 当前 creep。
     */
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource: ({ creep }) => onSource(creep),
            onTarget: ({ creep }) => onTarget(creep),
        });
    },
};

export default Upgrader;
