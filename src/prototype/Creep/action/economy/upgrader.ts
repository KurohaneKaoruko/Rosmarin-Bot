import { writeMoveWorkTileCandidates } from '@/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { runWorkLayer } from '@/framework/ai/adapters';
import { canRushUpgrade, getRoomMode, getWorkerUpgradeSlot } from '@/shared/roomWorkforce';
import upUpgradeFunction from '@/prototype/Creep/action/support/up-upgrade';

/**
 * 专人升级工（`upgrader`）。
 *
 * @remarks
 * 分工由**房间模式**决定，编制在 `shared/roomWorkforce.getUpgraderTarget`：
 * - `low` / `main`：0 —— 常规升级由 `worker` 兼任（worker 的升级侧定编 + 运行时职责切分）；
 * - `high`：单独配人，并把 `worker` 升级侧的 work 扣掉，让 worker 把人口留给建造/刷墙；
 * - `rush`：走**冲级策略**——boost 前置（XGH2O）、控制器缓冲取能（link/container/terminal/storage）、
 *   满级或寿命将尽时退役并先卸 boost 回收矿物。
 *
 * 「冲级条件是否成立」是**自动判定**的：见 `roomWorkforce.canRushUpgrade`——
 * 需要控制器旁有 storage/terminal，且它们旁边有可站格位（同时满足「贴着仓库」和「在控制器 3 格内」）。
 * 条件不成立时本角色**不冲级**，退回普通升级行为，编制侧同时把数量缩小
 * （`rush` → 2、`high` → 1、`low`/`main` → 0）。
 *
 * 冲级分支**直接复用** `action/support/up-upgrade` 那份实现，不另写一套：
 * 那条路径（连同 `UP-UPGRADE` / `AID-UUP` 旗帜入口）保持原样可用，
 * 既是「手动开冲级」的开关，也是这边出问题时的参照与回退手段。
 */

const isRushing = (creep: Creep): boolean => {
    if (!creep.room.controller?.my) return false;
    return getRoomMode(creep.room) === 'rush' && canRushUpgrade(creep.room);
};

/**
 * 升级期间的移动工位候选。
 *
 * @remarks
 * 优先用专属工位（`range 0`）——和 worker 的专职升级走同一张名册，
 * 由堵车解算器把每人保护在自己的格子里；抢不到格位时退回控制器 3 格内。
 * 冲级模式下这张名册的格位池就是冲级工位（控制器旁仓库旁边），
 * 所以冲级工也自动站在取能点旁边。
 */
export const syncUpgraderMoveWork = (creep: Creep) => {
    if (
        creep.room.controller?.my &&
        creep.memory.working &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
        const slot = getWorkerUpgradeSlot(creep.room, creep.name);
        writeMoveWorkTileCandidates(creep, [
            slot ? { pos: slot, range: 0 } : { pos: creep.room.controller.pos, range: 3 },
        ]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

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

const UpgraderFunction = {
    run(creep: Creep) {
        // 跨房增援（AID-UUP）：目标房不在当前所在时先赶路；到位后按目标房状态干活
        if ((creep.memory as any).targetRoom && creep.memory.targetRoom !== creep.room.name) {
            if (!creep.moveToTargetRoom()) return;
        }
        // 冲级模式下先把上一位留下的移动工位清掉，再交给冲级实现自己登记
        if (isRushing(creep)) {
            writeMoveWorkTileCandidates(creep, []);
            upUpgradeFunction.run(creep);
            return;
        }
        runWorkLayer(creep, { onSource, onTarget });
    },
};

export default UpgraderFunction;
