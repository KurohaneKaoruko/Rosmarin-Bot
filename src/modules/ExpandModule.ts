import { CreepMemoryTransfer, ExpandController } from '@/modules/features/Expand';

/**
 * 扩张系统运行时模块。
 *
 * @remarks
 * 在每 tick `start` 阶段执行：
 * 1. 跨阶段 creep 内存迁移；
 * 2. 扩张控制器主流程。
 */
const ExpandModule = {
    /**
     * 扩张模块主入口。
     */
    start: function () {
        CreepMemoryTransfer.run();
        ExpandController.run();
    },
};

export { ExpandModule };
