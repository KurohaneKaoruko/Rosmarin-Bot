# 参考 Bot 借鉴计划

> 状态： 与  深扫完成； 深扫进行中（完成后补 §C）。
> 已落地项见 §A；其余按优先级排入重构计划（refactor/bot-optimization 分支）。

## A. 已落地

| 借鉴项 | 来源 | 提交 |
|---|---|---|
| 低级房常备全能 UNIV（NORMAL 态防停机） |  strategy_lowLevel | 407c3ef |
| 外矿搬运接力（记忆交换） |  remoteRoles | cb65008 |

## B. 待借鉴候选（按优先级）

### Tier 1 —— 直击痛点（停机 / CPU / 断档），小-中工作量

| # | 设计 | 来源 | 核心机制 | 落地点 | 工作量 |
|---|---|---|---|---|---|
| B1 | CPU 桶闭环调控外矿开关 |  bucketManager.js:12-88 | 积分控制器调 remoteThreshold（error+Ki 积分+turbo，300t 冷却），value/weight 门控外矿，virtualCpu 预记账未来 CPU | src/infra/bucketGovernor.ts + qos.ts + outMine.ts | 小-中 |
| B2 | energyLevel 统一能量度量 + funnel |  roomUtils.js:1134 + funnelManager.js | 低于 RCL 标准储量 0-100 比例度量；请求按 emergency>goalType 排序，excessAmount 预算制防抽干 | src/shared/roomResource.ts + FunnelModule | 小-中 |
| B3 | Gtime 房间相位错峰 |  global/init.ts:138 | 每房随机相位偏移，同频任务摊到不同刻度，消除多房同 tick CPU 尖峰 | main.ts tickStart + 各 % N 判断改相位基准 | 小 |
| B4 | spawnInAdvance 无缝补员 |  mission/base/base.ts:551 | spawnTime=body×3+offset，扫描绑定爬 TTL 提前下单，新爬出生即领任务 | mission/updaters + spawnControl，外矿域优先 | 小-中 |
| B5 | CPU 观测三件套 |  cpuLogger/callStack/stat | collectCost 包装 + cpu_list 采样（Memory 开关，生产零开销）+ callStack 调用树 profiler | createApp 生命周期 + Memory.Systemswitch 开关组 | 小 |

### Tier 2 —— 战斗/防御/孵化强化

| # | 设计 | 来源 | 核心机制 | 落地点 | 工作量 |
|---|---|---|---|---|---|
| B6 | 统一伤害模型 + 塔伤查找表 |  squad/prototype.ts + BoostConstant.ts | possible*Damage 系列（mass 10:4:1、boost、残血折算、HealHold 滑窗）+ 距离下标查找表 | src/prototype/Creep + towerControl | 小 |
| B7 | 分块防御 |  manageDefense.js | 多源 Dijkstra 流场归属敌军 + rampart 聚类 chunk + DPS 缺口征调 ≤3 防御者 + 塔期望伤害 ≥100 才开火 | towerControl → defenseUtils | 中-大 |
| B8 | 孵化优先级堆 + spawnUsage EMA |  Room_prototype/spawnManager | MinHeap 优先级队列（taskType×1e5+task×100+role）、能量不足停 tick、spawnUsage<0.9 扩外矿 | spawnMission 产出请求 + spawnControl 队列 | 中 |
| B9 | 小队编排管线 + 残队自动合并 |  squad.ts + formation.ts | 旗帜承载状态 + tickEnd 单循环管线；combineSquad 把补员问题转重组问题 | features/Team | 大（可先落合并，中） |

### Tier 3 —— 中长期体系

| # | 设计 | 来源 | 核心机制 | 工作量 |
|---|---|---|---|---|
| B10 | 锁仓式全局资源调度 |  dispatch/resource.ts | 锁仓=max(各用途保留量)，调度只动 surplus，杜绝应急库存被抽干；市场兜底分流 | 中 |
| B11 | 意图式交通仲裁 |  screeps-traffic-manager | move 登记意图、tick 末按房 DFS 链式推挤仲裁、静态工束缚 | 中 |
| B12 | 堆上物流市场 |  manageLogistics.js | 带抢占贪心匹配（优先级高或更近才抢）、useRate 沿途消耗补偿 | 中-大 |
| B13 | 双层情报系统 |  intelManager/userIntelManager | creep 战力指纹聚合（无视野可用）+ infomy 记仇 EMA + 破墙成本 | 中 |
| B14 | 布局执行模型 |  PlanConstant/ecosphere | level 标记蓝图 + RCL 升级瞬间增量放工地 + structMap 字符串存档 + war 态关键建筑守卫自动 safemode | 小-中 |
| B15 | 双表孵化体系 |  SpawnConstant.ts | RoleData/RoleLevelData 表驱动（ability 元组+level+must+adaption+upbodypart） | 中 |

### 不借鉴

-  rawMemory 服务（内容薄，仅状态码握手协议思路可留档）
-  creepNameManager（娱乐命名池）
-  memhack（需 Game.time 连续性自校验，缓行）
-  userIntel timer 系统 / boost model 搜索（过度工程化）

## C.  深扫结果

（待子代理报告后补充）

## 推荐落地顺序

1. **B1+B2+D(待 )**：CPU 前馈 + 能量度量——与已落地的 UNIV 常备组成完整防停机体系
2. **B3+B5**：错峰 + 观测（小工作量，立刻改善可诊断性）
3. **B4**：外矿无缝补员
4. **B6→B7/B8**：战斗强化线
5. **B10-B15**：按需排入长期计划
