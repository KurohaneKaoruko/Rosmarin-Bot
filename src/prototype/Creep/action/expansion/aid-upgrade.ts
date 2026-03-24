import { runWorkLayer } from '@/framework/ai/adapters';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';

/**
 * AID 升级角色在「目标态」下的行为：
 * 1. 先确保 creep 已完成初始化并进入目标房间；
 * 2. 对控制器执行升级；
 * 3. 能量耗尽后切换回取能态。
 *
 * @param creep 当前执行的 creep。
 * @returns 工作层状态机事件。
 */
const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.memory.ready) return WORK_EVENTS.STAY;
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

    creep.runControllerUpgrade();
    if (creep.store.getUsedCapacity() === 0) {
        creep.say('🔄');
        return WORK_EVENTS.TO_SOURCE;
    }
    return WORK_EVENTS.STAY;
};

/**
 * AID 升级角色在「取能态」下的行为：
 * 1. 保证 creep 已就绪并在目标房间；
 * 2. 按优先级从 link/container/其他兜底来源取能；
 * 3. 满仓后切换回升级态。
 *
 * @param creep 当前执行的 creep。
 * @returns 工作层状态机事件。
 */
const onSource = (creep: Creep): WorkEvent => {
    if (!creep.memory.ready) return WORK_EVENTS.STAY;
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

    creep.withdrawControllerEnergy({
        linkRange: 2,
        containerRange: 2,
        fallbackToTakeEnergy: true,
    });

    if (creep.store.getFreeCapacity() === 0) {
        creep.say('⚡');
        return WORK_EVENTS.TO_TARGET;
    }
    return WORK_EVENTS.STAY;
};

/**
 * AID 升级角色入口。
 *
 * @remarks
 * 该角色使用统一 WorkLayer 双态模型：
 * - `onSource` 负责补能；
 * - `onTarget` 负责升级。
 */
const aid_upgrade = {
    /**
     * 出生后执行 boost 准备流程。
     *
     * @param creep 当前 creep。
     * @returns `true` 表示可进入 run 流程。
     */
    prepare: function (creep: Creep) {
        if (creep.memory['boostmap']) {
            return creep.goBoost(creep.memory['boostmap']) === OK;
        }
        return creep.goBoost({ [WORK]: ['XGH2O', 'GH2O', 'GH'] }) === OK;
    },

    /**
     * 执行 AID 升级工作层状态机。
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

export default aid_upgrade;
