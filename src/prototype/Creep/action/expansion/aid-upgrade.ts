import { createBoostedRole, createWorkLayerRole } from '@/framework/ai/creepRole';
import { writeMoveWorkTileCandidates } from '@/shared/moveWork';
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
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

    creep.runControllerUpgrade();
    if (creep.store.getUsedCapacity() === 0) {
        creep.say('🔄');
        return WORK_EVENTS.TO_SOURCE;
    }
    syncAidUpgradeMoveWork(creep);
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

export const syncAidUpgradeMoveWork = (creep: Creep) => {
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
 * AID 升级角色入口。
 *
 * @remarks
 * 该角色使用统一 WorkLayer 双态模型：
 * - `onSource` 负责补能；
 * - `onTarget` 负责升级。
 */
const aidUpgradeWork = createWorkLayerRole({
    onSource,
    onTarget
});

const aid_upgrade = createBoostedRole({
    boost: (creep) => creep.memory['boostmap'] || { [WORK]: ['XGH2O', 'GH2O', 'GH'] },
    run: aidUpgradeWork.run
});

export default aid_upgrade;
