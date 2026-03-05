# 跨 Shard 扩张

## 基本信息
- 功能定位：把“开分矿/开新房”的执行从单房间逻辑升级为跨 shard 可协同的计划系统。
- 设计模式：命令总线（`expand.set/pause/resume/remove`）、Saga 编排（home 与 target 分段协作）、最终一致性（`InterShardMemory` + ACK）。
- 运行节奏：`ExpandModule` 在 `start` 阶段执行；主控制器每 5 tick 运行一次。
- 数据边界：本地计划在 `Memory.RosmarinBot.Expand.plans`；跨 shard 同步在 `InterShardMemory` 的 `outbox/plans/status/expandCreepCounts`。

## 核心流程
1. 控制台通过 `expand.set(...)` 下发计划，写入跨 shard 命令队列（`pushInterShardCommand`）。
2. `ExpandController` 拉取命令（`pullIncomingCommands`），在 home shard 落地计划。
3. 系统按计划补齐角色（`claimer/aid-build/aid-carry/aid-upgrade`），通过 spawn 任务池下发。
4. 各 shard 周期发布计划摘要、执行状态、角色计数，形成全局视图。
5. 满足完成条件后自动收口：清理扩张相关 spawn 任务并发布 `done/removed` 状态。

## 完成与收口条件
- 目标房本 shard 可见，且 `controller.my === true`。
- 目标房已有 spawn，且无建设工地。
- 或远端 shard 已发布该计划 `status=done`。

## 关键设计细节
- 命令可靠性：命令带 `seq`，消费端记录 `cmdAcks`，发送端按远端 ACK 回收 outbox。
- 角色计数合并：本地 `creepTickIndex` + 远端 `expandCreepCounts` 合并，避免重复孵化。
- 任务清理隔离：按 `expandId` 定向清理 spawn 队列，不影响其它业务任务。
- 内存传递：`CreepMemoryTransfer` 在跨 shard 传送门附近写入/恢复 creep memory，并带 nonce ACK 去重。

## 对外接口
- `expand.set(home, target, desired)`：创建扩张计划。
- `expand.pause(id|target)`：暂停计划。
- `expand.resume(id|target)`：恢复计划。
- `expand.remove(id|target)`：终止计划并清理。
- `expand.list()`：查看全网计划状态。

## 当前实现边界
- 计划驱动角色固定为扩张四类，不覆盖战斗编队。
- 调度基于 tick 轮询，不是实时事件驱动。
- 状态一致性为“最终一致”，不是强一致。
