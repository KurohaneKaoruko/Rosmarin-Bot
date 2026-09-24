import {TeamSpawner, TeamController} from "@/modules/features/Team";

/**
 * 小队系统运行时模块。
 *
 * @remarks
 * - `start` 负责小队单位孵化；
 * - `tick` 负责小队行为控制。
 */
const TeamModule = {
    /**
     * tick 开始阶段：处理小队生成。
     */
    start: function () {
        TeamSpawner.run();
    },

    /**
     * tick 主循环阶段：执行小队控制器。
     */
    tick: function () {
        TeamController.run();
    },
};

export { TeamModule };
