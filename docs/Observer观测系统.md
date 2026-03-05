# Observer 观测系统

## 基本信息
- 功能定位：统一管理房间 Observer 的观测请求与回调执行，支撑 highway 扫描等异步业务。
- 设计模式：队列调度（每房请求队列）、回调延迟执行（next tick callback）、去重合并（同目标房请求合并）。
- 运行节奏：`ObserveCallbackTick()` 在房间执行前段；`ObserveWork()` 在房间执行尾段。
- 数据边界：队列与回调缓存为运行时内存（`observerQueueByRoom/observerCallbackQueue`），不落 `Memory`。

## 核心流程
1. 业务调用 `observeRoom(target, callback?)` 入队。
2. 同房间同目标会合并 callback，不重复发起 observe。
3. `ObserveWork()` 每 tick 只执行一个请求（防止同 tick 重复 observe）。
4. observe 成功后，把 callback 注册到 `Game.time + 1` 执行。
5. `ObserveCallbackTick()` 在下一 tick 触发 callback，异常会捕获并记录日志。

## 与外矿扫描的协作
- `MineMission.UpdateHighwayScan()` 通过 `observeRoom(..., handler)` 注入扫描任务。
- 扫描逻辑与 observer 调度解耦：业务只关心“观察成功后处理房间”。

## 关键设计细节
- 无 observer 时快速返回 `false`，调用方可直接降级。
- 回调队列是全局共享，但执行时按 tick 与房间上下文触发。
- 提供 `getObserveQueueStatus()` 与 `clearObserveQueue()` 便于调试和应急。

## 当前实现边界
- 每 tick 单请求，吞吐受限但稳定；大规模侦查需要更多 observer 房间分摊。
- 队列是非持久化的，重置后会丢失未执行请求。
