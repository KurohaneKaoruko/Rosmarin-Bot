# Creep 行动架构重构设计

## 1. 目标

- **目标**：重构 `creep` 行动逻辑的代码组织方式，让职责边界清晰、角色逻辑高内聚、共享能力低耦合。
- **验收标准**：
  - 角色执行入口唯一且稳定。
  - 简单角色保持直观顺序逻辑，不被迫接入重型抽象。
  - 通用能力只保留少量高复用、低语义耦合的辅助层。
  - 复杂角色允许局部使用状态机 / 行为树，但不外溢成全局框架依赖。
  - 后续迁移可以按角色族分批进行，每一步都可回退。
- **范围内**：
  - `src/prototype/Creep/**`
  - `src/core/ai/**`
  - `src/constant/CreepConstant.ts`
  - 与 creep 行为直接耦合的共享模块
- **范围外**：
  - 房间调度、孵化策略、跨 shard 战略本身
  - Team 模块独立接管的小队行为
  - 本阶段不直接改行为细节，只做架构设计与迁移规划

## 2. 设计约束

- **P0**：高内聚、低耦合。
- **P0**：避免过度抽象，优先小而薄的通用层。
- **P0**：运行时开销可控，不引入额外注册中心、解释器或 DSL。
- **P1**：简单角色用简单代码，复杂角色才用复杂模型。
- **P1**：保留现有 `RoleData.executor -> roleRegistry -> handler.run` 主链路，不做无收益的大搬家。
- **P2**：目录和命名尽量贴近现有代码，降低迁移成本。

## 3. 当前事实

### 3.1 已确认事实

1. **统一入口已经存在**（证据 A）  
   `CreepRunner -> creep.exec() -> RoleData.executor -> roleRegistry -> handler.run`
   - `src/core/runner/CreepRunner.ts`
   - `src/prototype/Creep/execute.ts`
   - `src/prototype/Creep/action/index.ts`

2. **当前同时存在三套行为模型**（证据 A）
   - 顺序式 imperative：`economy/harvester.ts`、`economy/universal.ts`
   - 轻量 source/target 流转：`runWorkLayer(...)`
   - 局部状态机 / 行为树：`economy/miner.ts`、`combat/aio.ts`

3. **抽象层已经出现重复和失配**（证据 A）
   - `RoleHandler` 定义了 `prepare?: (creep) => boolean`
   - 但统一执行入口当前只调用 `handler.run(this)`，没有调用 `prepare`
   - 这会让 `worker`、`aio`、`double-attack` 等角色里声明的 `prepare` 语义失效

4. **状态字段未完全收口**（证据 A）
   - 角色同时混用 `memory.working`、`memory.state`、`memory.action`、`memory.fsm`
   - 角色私有缓存散落在 `memory` 顶层和 `memory.cache.*`

5. **已有共享能力基础可复用**（证据 A）
   - 原型方法已经提供移动、取能、建造、战斗、缓存等基础动作
   - 当前真正混乱的点，主要在“角色编排层”，不是底层动作 API 缺失

### 3.2 当前判断

- **判断 1**：主要问题不是“没有框架”，而是“入口统一了，但角色编排约定没有统一”。（证据 B）
- **判断 2**：如果继续抽象成全局状态机框架或统一行为树，会放大复杂度，不符合当前目标。 （证据 B）
- **判断 3**：更合适的方向是“保留统一分发，按角色复杂度分层治理”。（证据 B）

## 4. 当前痛点

### 4.1 角色文件职责过重

单个角色文件往往同时承担：

- 状态切换
- 目标选择
- 业务规则
- 移动候选发布
- cache 读写
- 例外处理

结果是“能跑，但不好拆”，高耦合集中在角色文件内部。

### 4.2 共性流程重复实现

多个经济 / 外矿 / 运输角色都在重复这些流程：

- 满载 / 空载切换
- home / target 房间切换
- 发布工作位候选
- 目标失效清理
- 取能 / 交付的兜底顺序

这些逻辑重复出现，但复用方式不统一。

### 4.3 抽象层级不稳定

当前代码里同时存在：

- 直接顺序逻辑
- 轻量 flow 包装
- 多层状态机
- 行为树

问题不在于它们同时存在，而在于**没有明确“什么场景该用哪一种”**。

### 4.4 内存语义边界不清

角色私有状态和公共状态没有明确边界，导致：

- 迁移时难判断字段是否可删
- 通用 helper 容易读取到角色私有字段
- 同一语义在不同角色中落到不同字段

## 5. 目标架构

## 5.1 核心原则

1. **保留一个统一入口，不再新增第二分发中心**
2. **按复杂度选择最小模型**
3. **共享层只抽“动作骨架”，不抽“业务策略”**
4. **角色私有状态收口到角色私有 cache**
5. **目录围绕职责组织，不围绕抽象花样组织**

## 5.2 目标分层

### A. Runtime 层

职责：只负责执行链，不承载业务决策。

建议内容：

- 角色查找与分发
- 通用预处理
- 通用错误抑制
- 可选的 `prepare -> run` 包装

**边界**：Runtime 不关心“怎么采、怎么打、怎么修”。

### B. Role 层

职责：每个角色只表达自己的业务编排。

建议要求：

- 一个角色文件只维护一个角色的业务流程
- 角色内部最多组合少量 family helper
- 不跨角色直接读写对方状态

### C. Family Helper 层

职责：承接“同类角色的共性骨架”，但不做全局通用框架。

只建议保留 3 类：

1. **flow helper**
   - 适合 source / target 双相角色
   - 只处理切换骨架，不处理具体业务

2. **combat helper**
   - 只放共用目标筛选、威胁判定、基础机动
   - 不强制统一所有战斗角色结构

3. **target/cache helper**
   - 只放目标缓存、失效清理、候选选择等通用能力

**不建议**再新增：

- 全局角色 DSL
- 通用行为脚本解释器
- 强制所有角色接入 layered FSM
- 把所有动作声明式配置化

### D. Primitive 层

职责：保留现有原型动作能力。

包括：

- move / flee / moveToRoom
- acquire / withdraw / transfer / build / repair / upgrade
- source/container/link/controller 等场景动作

这一层已经足够厚，不应继续上浮业务语义。

## 5.3 角色复杂度分级

这是本次设计的关键裁决。

### L1：顺序角色

特征：

- 规则稳定
- 状态很少
- 流程短
- 性能敏感

适用方式：

- 直接 imperative
- 最多使用少量 shared helper

候选角色：

- `harvester`
- `universal`
- `carrier`
- `manager`

### L2：双相流转角色

特征：

- 存在明确 collect / deliver 或 source / target 两相
- 切换条件清楚
- 状态数少

适用方式：

- 使用轻量 `flow helper`
- 不必引入完整 FSM

候选角色：

- `worker`
- `upgrader`
- `transporter`
- `logistic`
- `aid-carry`
- `out-harvest`
- `deposit-transfer`

### L3：多阶段复杂角色

特征：

- 有多个并行子状态
- 依赖复杂战场或任务上下文
- 需要可显式表达迁移

适用方式：

- 局部状态机或行为树
- 仅限角色内部使用

候选角色：

- `miner`
- `aid-build`
- `aio`
- 双人作战角色

**裁决**：  
不追求“所有角色统一一种模型”，而是让复杂度和模型一一对应。  
这是高内聚、低耦合且避免过度工程化的最优解。（证据 B）

## 6. 目录建议

本次不建议大规模移动目录，只做小步重组。

### 6.1 建议结构

```text
src/prototype/Creep/
  runtime/
    dispatch.ts
    registry.ts
    runner.ts
  role/
    economy/
    remote/
    support/
    combat/
    expansion/
  family/
    flow/
    combat/
  shared/
    cache/
    target/
    movement/
```

### 6.2 与现状的关系

- `action/` 可以逐步迁到 `role/`
- `execute.ts` 与 `action/index.ts` 先保留，再逐步瘦身
- `function/` 里的原型动作能力继续保留，不做大拆分

## 7. 统一接口设计

## 7.1 RoleHandler 契约

建议统一为：

```ts
type RoleHandler = {
    prepare?: (creep: Creep) => boolean;
    run: (creep: Creep) => void;
};
```

但需要明确语义：

- `prepare`：处理 boost、绑定、前置校验；返回 `true` 才进入 `run`
- `run`：只处理业务主流程

### 7.2 Runtime 包装建议

统一执行入口调整为：

1. 取 handler
2. 初始化通用 cache
3. 若存在 `prepare`：
   - `prepare === false`：本 tick 结束
   - `prepare === true`：继续进入 `run`
4. 执行 `run`

这能把当前“声明了 prepare 但入口不调用”的结构性问题先修正掉。

## 7.3 内存约定

公共状态建议只保留：

- `role`
- `home / homeRoom / sourceRoom / targetRoom`
- `working`
- `fsm`
- `cache`

建议约束：

- 通用目标缓存继续放 `cache.target` / `cache.source`
- 角色私有状态统一放 `cache.role`
- 禁止新增没有命名空间的临时顶层字段

示意：

```ts
memory.cache = {
  source: {},
  target: {},
  role: {
    duty: 'build',
    repairId: 'xxx',
  }
}
```

这样可以减少角色之间的隐式耦合。

## 8. 允许的抽象与禁止事项

## 8.1 允许

- 小型 family helper
- 角色内部局部状态机
- 角色内部局部行为树
- 低成本目标缓存包装
- 可预测的顺序 helper

## 8.2 禁止

- 为统一而统一
- 所有角色强制接入同一框架
- 把行为改造成配置表驱动
- 为未来想象场景预埋过多扩展点
- 多层包装后只剩“读不出业务”的代码

## 9. 分阶段迁移计划

## 阶段 0：冻结契约

目标：

- 确认 `RoleData.executor`
- 确认 handler 接口
- 确认内存字段约定

产物：

- 本文档
- 角色复杂度分级表

验收：

- 后续迁移不再新增新的角色模型

## 阶段 1：先修执行入口

改动：

- 把 `prepare` 接入统一执行入口
- Runtime 层只保留分发和包装

收益：

- 先修结构性失配
- 不触碰角色业务逻辑

风险：

- 某些角色的 `prepare` 语义可能和当前默认行为不一致

回退：

- 可单独回退 Runtime 包装，不影响角色文件

## 阶段 2：收口目录与命名

改动：

- 建立 `runtime / role / family / shared` 目录
- 先迁移新文件入口，不强制一次性移动全部旧文件

收益：

- 明确边界
- 后续拆角色时落点稳定

风险：

- import 路径变更较多

回退：

- 目录迁移按批次提交，每批可独立回滚

## 阶段 3：优先治理 L2 双相角色

改动：

- 抽出轻量 `flow helper`
- 迁移 `worker / upgrader / transporter / logistic / out-harvest` 等

收益：

- 这部分重复最多，收益最高
- 抽象层也最容易控制在“薄 helper”

风险：

- 如果 helper 设计过宽，会反向造成耦合

控制手段：

- helper 只接收 `onSource/onTarget`
- helper 不接业务字段，不接任务系统，不接目标选择策略

## 阶段 4：整理复杂角色

改动：

- `miner`、`aid-build`、`aio` 等保留局部复杂模型
- 只把共用 target/cache/move 能力抽出去

收益：

- 保留复杂角色的表达力
- 避免把战斗逻辑强行压扁

风险：

- 复杂角色可能继续膨胀

控制手段：

- 每个复杂角色内部再按“感知 / 决策 / 执行”三段分函数

## 阶段 5：统一 memory 语义并清理旧字段

改动：

- 清理顶层临时字段
- 角色私有状态迁入 `cache.role`
- 统一缓存失效规则

收益：

- 降低隐式耦合
- 降低迁移后的维护成本

风险：

- 旧字段兼容期内需要双读

回退：

- 保留兼容读路径，完成一批删一批

## 10. 验证策略

### 10.1 静态验证

- `pnpm typecheck`
- `pnpm test`
- 关键角色 import 无循环依赖

### 10.2 行为回归

至少覆盖：

- `harvester`
- `worker`
- `upgrader`
- `transporter`
- `out-harvest`
- `aio`

重点看：

- boost 前置是否正常
- `working` 切换是否稳定
- 目标失效后是否能恢复
- 跨房切换是否不抖动
- moveWork 候选是否仍正确发布

### 10.3 性能回归

- 不引入新的全量扫描
- 不把顺序角色改成每 tick 构建大型状态对象
- helper 不做反射式分发

## 11. 非目标

本轮不做：

- 全角色统一状态机
- 行为配置热更新
- 通用任务脚本系统
- ECS 化
- “一次重构到位”的大迁移

## 12. 建议实施顺序

1. 修 `prepare` 执行链
2. 建 runtime / role / family / shared 骨架
3. 迁移 L2 双相角色
4. 整理复杂角色
5. 收口 memory 语义
6. 删除兼容层

## 13. 最终裁决

### 方案选择

- **采用**：统一入口 + 按复杂度分层建模 + 小型 family helper
- **不采用**：全局统一 FSM / 全局统一 BT / 配置表驱动角色系统

### 裁决理由

- 更符合现有代码现状，迁移成本低（证据 B）
- 能解决重复与失配问题，同时不引入新一轮框架复杂度（证据 B）
- 与“高内聚、低耦合、简洁高性能、避免过度工程化”的目标一致（证据 A）

## 14. 下一步动作

- **P0**：按本文先做执行入口重构，接通 `prepare`
- **P1**：抽出 `flow helper`，优先迁移 `worker / transporter / out-harvest`
- **P1**：定义 `cache.role` 约定并开始增量迁移
- **P2**：对复杂角色做局部拆分，不强求统一模型
