# AI 行为框架说明

本文档描述 `src/framework/ai` 目录下的行为框架约定，用于统一 creep 行为逻辑的实现与迁移。

## 多层状态机（Layered FSM）

框架位于 `src/framework/ai/stateMachine.ts`，提供可组合的 `StateMachine` 与 `LayeredStateMachine`。

约定：
- **状态/事件/迁移条件必须用常量声明**，禁止在逻辑中硬编码字符串。
- **迁移只通过显式事件触发**，避免 if/else 直接改写状态。
- **分层职责单一**：每层只负责一种行为类别（移动/采集/战斗/建造等）。

状态存储建议：
- 单层：可映射到 `creep.memory.action` 或 `creep.memory.working`。
- 多层：统一写入 `creep.memory.fsm.<layerId>`。

辅助工具：
- `src/framework/ai/adapters.ts` 提供 `createFsmStorage` / `createLayeredRunner`。
- `src/framework/ai/workMachine.ts` 声明 `WORK_EVENTS`，`adapters.ts` 的 `runWorkLayer` 是统一的 source/target 迁移入口（worker / out-carry 等经济角色均基于它实现）。

## 行为树（Behavior Tree）

框架位于 `src/framework/ai/behaviorTree.ts`。

节点返回码：
- `Success` / `Failure` / `Running`

动态子树热插拔：
- 通过 `BehaviorTreeRegistry` 注册与替换子树
- 使用 `hotSwap(registry, slot, fallback)` 在运行时替换子树实现

适用场景：
- 具有强响应性或复合条件的战斗/防御行为

## 策略模式（Strategy + DI）

框架位于 `src/framework/ai/strategy.ts`。

约定：
- 将“算法族”拆为多个 Strategy（即便只启用一条，也要具备可替换入口）
- 所有策略统一注册到 `StrategyContainer`，并通过 `runStrategy` 进行选择

适用场景：
- 线性流程、可配置/可替换逻辑（例如任务搬运、签名/占领等）
