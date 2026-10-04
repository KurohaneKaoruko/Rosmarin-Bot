# Tasks

> 方向修订（用户决定，2026-10-03）：放弃「在既有系统上打补丁」的路线，改为**整建制移植**一套自包含的 rush 经济核心（孵化决策/体型生成/能量物流/升级预算/建造编排），RCL1-6 单房冲级路径整体走新模块；既有系统上的全部 rush 补丁下线。函数级移植清单与逐项校验表见 `.other/rush-port-plan.md`（内部工作文档）。
> 以下任务取代原 1-5 组任务清单；已完成并保留的部分：分段监控（组1）、容器唯一 cc 修复、分段双档表。
> 方向修订（用户决定，2026-10-04）：**只取参考的升级效率**——creep 命名（本地 GenCreepName）、代码架构、自动布局（本地 autoBuild）全部保持本地不变。据此：basePlan 移植范围改为锚点适配器（startCoord/source 容器锚点/controller link 位，供 sourceInfos 与取能锚点）；CONTROLLER_STRUCTURES 分层与建造 MinHeap 不再移植（工地放置归 autoBuild）；rush 孵化的 creep 名走本地命名。

## 1. 移植骨架

- [x] 1.1 新建 `src/modules/rush/` 模块骨架（constants/spawnUtils/spawnManager/manageSource/manageUpgrade/manageBuild/manageLogistics/manageConstruction/basePlan/manageDefense/roomController/creepUtils），仅类型与空实现，验证 `pnpm build` 通过
- [x] 1.2 移植常量与优先级枚举（任务类型优先级数值表、建造优先级数组、区间降频表、bucket 闸门表），验证与参考口径逐值一致（对照表勾选）
- [x] 1.3 接线 `roomController.run(room)` 到 RoomExecute：rush 房间经济段走移植主循环，非 rush 房间零影响，验证构建通过 + 空实现不抛错（本地私服冒烟）

## 2. 孵化链路移植

- [x] 2.1 移植 requestCreep/优先级公式/MinHeap 消费循环（含 spawnUsage EMA 与「房型造不出的请求直接丢弃」规则），验证 vitest 桩测试覆盖优先级排序与丢弃分支
- [x] 2.2 移植体型生成四件套（miner/hauler/upgrader/builder 参数化规则，冲级期 upgrader carryRatio=1），验证 vitest 桩测试覆盖各容量档位输出与参考口径一致
- [x] 2.3 移植矿工/搬运编成公式（maxHarvestPower、maxCarryPower=2×距离×速率、haulerRatio<minerRatio 补位）与净收入口径，验证 vitest 桩测试覆盖编成边界
- [x] 2.4 移植升级预算公式（收入×反馈系数、容量/几何上限、urgent 切档、缺口半身位门）与 upgradeArea 站位打包，验证 vitest 桩测试覆盖加码/减码/切档三场景
- [x] 2.5 移植 building/upgradeNeeded/emergency 三态门控与 builder/repairer 转职，验证 vitest 桩测试覆盖三态切换
- [x] 2.6 移植 spawn 消费循环整体（队列弹出、能量等待/丢弃、EBU 空闲率统计），本地冒烟验证孵化节奏正常

## 3. 物流链路移植

- [x] 3.1 移植送货优先级表 + matchHaulers 匹配（高优者赢/同级近者赢/容量回滚），验证 vitest 桩测试覆盖争夺与回滚
- [x] 3.2 移植 relay 接力（颗粒、对穿换向、TTL 保护、往复防抖、pull 搭车），验证 vitest 桩测试覆盖换向与防抖
- [x] 3.3 移植溢流沉淀（空闲搬运工反馈信号 + 控制器容器位 drop + upgrader 取能顺序），验证 vitest 桩测试覆盖有/无消费者两分支
- [x] 3.4 移植 controller 容器生命周期（RCL2 起尝试放置、RCL6 换 link 时销毁、唯一 cc），验证 vitest 桩测试覆盖放置/销毁/幂等
- [ ] 3.5 移植 distributor/porter（storage 后的中心配送），本地冒烟验证 storage 建成后启用

## 4. 建造与编排移植

- [x] 4.1 移植 basePlan 锚点适配与 source 链引导（原「CONTROLLER_STRUCTURES 分层 + 建造 MinHeap」按用户决定不移植：布局与工地放置保持本地 autoBuild，basePlan 仅作锚点适配器），验证 vitest 桩测试覆盖锚点推导与 source 链流程
- [ ] 4.2 移植 controller 容器建造检查节奏（1<rcl<5 每次建造检查尝试）与建筑复查周期（500t/降级触发），验证与 3.4 的唯一 cc 协同
- [ ] 4.3 移植 rclRecord 秒表接入分段监控（替换判废表数据源为 Thresholds.RUSH 双档），验证面板与落盘字段一致

## 5. 下线与回归

- [ ] 5.1 按 `.other/rush-port-plan.md` 下线清单删除被替换的 rush 补丁（rushBody/roomWorkforce rush 分支/spawnRules rush 分支/spawnMission rush 块/energyLogistics/carrier 闸门），验证 `pnpm build` 无残留引用
- [ ] 5.2 非 rush 模式（low/main/high/mini）回归抽查：孵化、物流、升级路径零变化，验证既有用例与新桩测试全绿
- [ ] 5.3 私服完整 attempt：五段达成/合格线对照（lv2 500/1k、lv3 3k/5k、lv4 10k、lv5 20k、lv6 40k），逐段归因快照归档
- [ ] 5.4 未达标段迭代：按归因快照调整移植参数并重跑，直至达标或记录差距与原因
