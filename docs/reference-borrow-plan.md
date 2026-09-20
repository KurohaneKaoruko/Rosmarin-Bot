# 参考 Bot 借鉴计划

> 状态：三份深扫报告全部完成。已落地项见 §A；待借鉴按 Tier 排序（Tier 0 最优先）。
> 分支：refactor/bot-optimization，每项独立提交可回退。

## A. 已落地

| 借鉴项 | 来源 | 提交 |
|---|---|---|
| 低级房常备全能 UNIV（NORMAL 态防停机） |  strategy_lowLevel | 407c3ef |
| 外矿搬运接力（记忆交换） |  remoteRoles | cb65008 |

## Tier 0 —— ✅ 已全部落地（2026-09，提交 f383bcf / 4fe6b6f / fbaeae9 / 3482f2e）

| # | 设计 | 来源 | 核心机制 | 落地点 | 工作量 |
|---|---|---|---|---|---|
| T0-1 | **全调用点错误隔离聚合器** |  helper_error.js:3-36 +  tryRun.js | 每个 creep/房间/策略调用点单独 catch，错误收集不上抛；tick 末一次性重抛（首次 throw 保可见，连续 10 次静默防刷屏）。**RosmarinBot 的 errorMapper 只包最外层——一个毒 creep 的异常会中止整 tick 后续所有房间与 creep 的执行，这正是偶发停机最典型的成因**。 的 tryRun（22 行）同样逐模块隔离+同 tick 去重日志，双重印证该模式 | createApp.ts 的 runRunner 循环体 try/catch 收集，exec 末尾交 errorMapper 输出（保留 sourcemap）；可加连续 N tick 报错自动回收毒 creep | 小 |
| T0-2 | **RawMemory 序列化节流** |  main.js:384 | 每 127 tick 才 `RawMemory.set(JSON.stringify(Memory))`，跳过引擎每 tick 默认序列化（Memory 上 MB 时省 1~3+ CPU/tick）。建议用 30 缩短丢失窗口（有跨 shard/扩张关键状态），关键写入点可强制提前序列化 | createApp.ts run() 末尾一行 | 小 |
| T0-3 | **房间哈希错峰调度** |  prototype_room.js:50 + manager_rooms.js:41 /  init.ts:138 | 周期闸门从 `Game.time % N`（固定 offset）改为 `(Game.time + roomHash) % N`——所有房间不再同一 tick 集中跑 spawnMission/transportMission，削平周期性 CPU 尖峰 | mission/index.ts MissionUpdate 的 offset 加房间相位 | 小 |
| T0-4 | **CPU 观测三件套** |  cpuLogger/callStack/stat +  调用栈分析器.js | collectCost 包装 + cpu_list 采样（Memory 开关，生产零开销）+ 按完整调用路径的剖析器（pure 自耗时排名/hard API 计次/HTML 报告） | src/infra/cpuProfiler.ts + Memory.stats.profiler 开关 | 小-中 |

## Tier 1 —— 经济健壮性 ✅ 已全部落地（T1-1 b8fe337 / T1-2 0b0f978 / T1-3 6ddfadf / T1-4 8963fc7 / T1-5 36c18fe；T1-6 由现有 score 计算与 T1-3 门控覆盖）

| # | 设计 | 来源 | 核心机制 | 落地点 | 工作量 |
|---|---|---|---|---|---|
| T1-1 | **挖矿位无缝换班计时** |  station_sources.js:4-36,496-510 | 每 source 实测 {spawnTime, pathTime} 自校准；respawn 条件=`Game.time-spawnTime > 1500`，新爬到场即无缝接班（替代 TTL 阈值式补位）；carrier 的 CARRY 数按实测 pathTime 配 | spawnRules harvester 补位 + harvester.ts 首次到场校准 + out-harvest/out-carry | 中 |
| T1-2 | **运力忙碌率反馈自调** |  strategy_highLevel.js:220-234 | 采样 carrier 忙碌率均值，>85% 在编运力即补员（封顶 7、保底 1）——一个常量替换整张静态配比表，人口自动收敛到刚好不积压 | spawnRules carrier/transporter 目标计算 | 小 |
| T1-3 | **CPU 桶闭环调控外矿开关** |  bucketManager.js:12-88 + manageSource.js:114-150 | 积分控制器调 remoteThreshold（error=桶-目标，Ki 积分+turbo，300t 冷却）；value/weight 门控外矿开/关；**virtualCpu 预记账**（开矿=渐增、关矿=1500t 线性回落，决策用 cpuAvg+virtualCpu 避免开了再超）；**tightCpu 联动体型**（有矿被挂起 → 矿工/升级者 body +5，用更少 creep 干同样的活） | src/infra/bucketGovernor.ts + qos.ts + outMine.ts + spawnMission body 生成 | 小-中 |
| T1-6 | **外矿 value/weight 记分 + 0/1 背包选取** |  remoteUtils.js:49-280 + manageSource.js:760-900 | value=净收益（reserver/keeperKiller 成本摊销、未修路扣 container 衰减）；weight=孵化占用+能量预算；按性价比降序装入背包（容量=剩余孵化能力）选 activeSources 子集；执行侧 maxCarryPower=2×distance×产出 推 hauler 需求，TTL>体型×3+distance+10 才计入运力，每房每 tick 至多一个 spawn 请求 | outMine.ts 评估层 + mineMission.ts 请求数量 | 中 |
| T1-4 | **energyLevel 统一能量度量 + funnel** |  roomUtils.js:1134 + funnelManager.js | 低于 RCL 标准储量 0-100 比例度量；请求按 emergency 排序 + excessAmount 预算制防抽干——直击低级房孵化死亡螺旋 | src/shared/roomResource.ts + FunnelModule | 小-中 |
| T1-5 | **spawnInAdvance 无缝补员** |  mission/base/base.ts:551-574 | spawnTime=body×3+offset，扫描绑定爬 TTL 提前下单并预写任务 ID，新爬出生即领任务（offset 可按路途长度动态化） | mission/updaters + spawnControl，外矿域优先 | 小-中 |

## Tier 2 —— 战斗/防御/孵化强化

| # | 设计 | 来源 | 核心机制 | 落地点 | 工作量 |
|---|---|---|---|---|---|
| T2-1 | 统一伤害模型 + 塔伤查找表 |  squad/prototype.ts:231-341 + BoostConstant.ts:49-61 | possible*Damage 系列（mass 10:4:1、boost、残血折算、HealHold 滑窗算破盾伤害）+ 距离下标查找表热路径零分支 | src/prototype/Creep + towerControl | 小 |
| T2-2 | 分块防御 |  manageDefense.js:691-982 | 多源 Dijkstra 流场归属敌军 + rampart 聚类 chunk + DPS 缺口征调 ≤3 防御者 + 塔期望伤害 ≥100 才开火 | towerControl → defenseUtils | 中-大 |
| T2-3 | 孵化优先级堆 + spawnUsage EMA |  Room_prototype.js:21 + spawnManager.js:91-111 | MinHeap 优先级队列、能量不足停 tick、spawnUsage<0.9 扩外矿、防撞名 | spawnMission 产出 + spawnControl 队列 | 中 |
| T2-4 | 同 tick 批量孵化簿记 |  station_hive.js:103-142 | per-tick 能量余量/usedSpawn/failed 簿记，跨房增援与本房民用同 tick 竞争时高优先级先扣预留 | spawnControl.ts | 小-中 |
| T2-5 | 小队管线 + 残队自动合并 |  squad.ts:120-188 + formation.ts | 旗帜承载状态 + tickEnd 单循环管线；combineSquad 把补员问题转重组问题（1:1→1:3→2人→纯奶） | features/Team | 大（先落合并：中） |

## Tier 3 —— 中长期体系

| # | 设计 | 来源 | 核心机制 | 工作量 |
|---|---|---|---|---|
| T3-1 | 锁仓式全局资源调度 |  dispatch/resource.ts:226-352 | 锁仓=max(各用途保留量)（T3 8000/矿 15000/lab 绑定/合成原料/工厂组件/卖单），调度只动 surplus；四重防重复 | 中 |
| T3-2 | 意图式交通仲裁 |  screeps-traffic-manager.js:34-129 | move 登记意图、tick 末按房 DFS 链式推挤仲裁（+1 进意图格/−1 挤走想留者）、静态工束缚 | 中 |
| T3-3 | 堆上物流市场 |  manageLogistics.js:590-653 | 带抢占贪心匹配（优先级高或更近才抢）、useRate 沿途消耗补偿、目标粘性 | 中-大 |
| T3-4 | 双层情报系统 |  intelManager.js + userIntelManager.js:321-466 | creep 战力指纹（10 项 stats+TTL 过期）聚合成房间级敌军战力（无视野可用）+ infamy 记仇 EMA + 破墙成本 | 中 |
| T3-5 | 布局执行模型 |  PlanConstant.ts:42-197 + ecosphere.ts:278-300 | level 标记蓝图 + RCL 升级瞬间增量放工地 + structMap 字符串存档 + war 态六类建筑守卫自动 safemode | 小-中 |
| T3-6 | 双表孵化体系 |  SpawnConstant.ts:28-346 | RoleData/RoleLevelData 表驱动（ability 元组+level+must+adaption 自适应降型+upbodypart） | 中 |
| T3-7 | 市场水位调价 + 帝国库存双门槛 |  strategy_market.js:190-232,396-399 | 买单按库存水位爬价（记忆价起步、avg×5 上限）+ 全帝国汇总双门槛 + 每 tick 单次成交 | 小-中 |

### 不借鉴

- ：超级移动优化/极致建筑缓存（RosmarinBot 已有增强版移植）、war_damageCal（塔控已更强）、manager_planner（已有 63Planner 移植）、station_defense 核弹墙维修加权（workMission 已有）
- ：rawMemory 服务（薄，仅状态码握手协议思路留档）、creepNameManager（娱乐）、damageCalc.ts（以 cache.ts 距离场为准）
- ：memhack（需连续性自校验，缓行）、userIntel timer 系统、boost model 搜索（过度工程化）
-  接力机制 / 低级房 UNIV / 在途能量核算（已落地）

### 小亮点（按需取用）

- ：isDownGrade 降级容量修正（防反复生成超预算体型卡死）、认领数量账本（派单去重布尔→数量账本）、checkSafeMode 务实开火条件、Terminal 单发锁、WAKE_TASK 控制台重试队列
- ：dataCleaner Memory 瘦身（TTL+LRU 双淘汰+外矿源剥离动态键，可移植到 roomTickCache/structureCache 清理）、mission temp/heap 双存储（避免 Memory 存 Creep 引用，MissionPools 可参考）、breach 检测（敌 flood-fill 可达 spawn → 重建矩阵 + safemode 决策）

## 推荐落地顺序

1. **Tier 0 全部**（T0-1 错误隔离是偶发停机最可能根因，T0-2/3/4 合计 <1 天）
2. **Tier 1 全部**（与已落地的 UNIV 常备组成完整防停机体系）
3. **B按 B1+B2 → B3 → B4 → B5 顺序**
4. **Tier 2 → Tier 3** 按需排入

---

## 附： 深扫小亮点（未进 Top8，按需取用）

- isDownGrade 降级容量修正：RCL 跌级后孵化容量按 isActive 的 spawn/extension 实算，防反复生成超预算体型卡死（prototype_room.js:58-87）
- 认领数量账本：`room.used[id] += CARRY*50` 把派单去重从布尔升级为数量账本，适合 transportMission 多来源派单（station_tower.js:3-8,99-104）
- checkSafeMode：带 ≥5 增幅 HEAL 的敌爬 + 建筑残骸才开安全模式，条件务实（station_defense.js:121-134）
- Terminal 每 tick 单发锁：`$send` 包装防多系统同 tick 竞争（prototype_store.js:72-78）
- WAKE_TASK 控制台重试队列：`{tryTime, sleep, task}` 异步运维任务（main.js:119-129）
