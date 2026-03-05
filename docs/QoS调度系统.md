# QoS 调度系统

## 基本信息
- 功能定位：在 CPU bucket 波动下提供统一降级门禁，保障核心逻辑可持续运行。
- 设计模式：分级降级（`normal/constrained/emergency`）、策略守卫（`shouldRun`）、全局服务挂载（`global.qos`）。
- 运行节奏：`createApp` 每 tick 先执行 `global.qos.updateQoS()`，各模块按需调用 `shouldRun(...)`。
- 数据边界：运行态在 `global.QoS`，观测态同步到 `Memory.stats.qos`。

## 等级定义
- `normal`：bucket >= 5000，默认全速策略。
- `constrained`：2000 <= bucket < 5000，建议重逻辑降频。
- `emergency`：bucket < 2000，仅保留关键路径，防止雪崩。

## 对外 API（`global.qos`）
- `updateQoS()`：计算并刷新当前 QoS 状态。
- `getQoS()`：获取当前状态。
- `shouldRun({ every, minBucket, allowLevels, levelAtLeast })`：统一执行门禁。
- `isTickAligned(mod, offset?, tick?)`：周期对齐辅助函数。

## 典型用法
1. 低频重任务：`shouldRun({ every: 5, allowLevels: ['normal','constrained'] })`
2. 高耗任务：`shouldRun({ minBucket: 2000, levelAtLeast: 'constrained' })`
3. 常规任务：不加门禁或只做 `every` 对齐。

## 设计要点
- 只在 `main.ts` 引入挂载：其他模块通过 `global.qos` 调用，避免直接依赖 `infra`。
- 门禁规则可组合：时间、资源、等级三类约束并行判断。
- 与统计模块对齐：`Memory.stats.qos` 方便控制台/HUD直接观测。

## 当前实现边界
- 当前等级阈值是静态常量，未引入动态学习或历史趋势预测。
- QoS 仅负责“是否执行”，不负责任务优先级重排。
