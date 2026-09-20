/**
 * Team 模块入口。
 *
 * @remarks
 * - TeamSpawner：负责从旗帜/指令生成队伍与孵化任务（生成端）\n
 * - TeamController：负责驱动队伍与队员的运行逻辑（执行端）
 */
import TeamSpawner from "./runtime/TeamSpawner";
import TeamController from "./runtime/TeamController";

export { TeamSpawner, TeamController }
