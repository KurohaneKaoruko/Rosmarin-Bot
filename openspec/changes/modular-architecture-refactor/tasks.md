# Tasks

## 1. 实施前置与基线

- [x] 1.1 盘点并冻结前置（2026-10-05 反转）：`rush-progression-overhaul`、`team-formations-5-9`、`code-quality-refactor` 三项冻结暂存，剩余工作待重构后处置；从当前分支切出重构分支（`refactor/modular-architecture`，自 opt/room-upgrade-stability-v2 b912e5a）；`git status` 盘点未提交改动 18 处（Team/\*×8、branch mains×3、main.ts、console/help.ts、compat 迁移×4、FormationTables），涉及这些文件的批次动手前确认归属与授权
- [ ] 1.2 抓取重构前基线：三入口 `rolldown` 构建产物留档 ✓（2026-10-05 NO_UPLOAD 构建，attempt/baseline-20261005/{main,race,stronghold}.js；rolldown.config.js 新增 NO_UPLOAD=1 仅打包开关）；本地服部署当前产物 + `__wd` 快照存档——待本地服部署时机确认（会改动运行环境）

## 2. 架构守卫脚本

- [x] 2.1 新建 `scripts/check-architecture.mjs`（vitest 可调用）：import 分层方向检查（L0→L4 单向），输出当前违规红名单作为基线——基线 5 处（RoomRunner→console ×2、roomWorkforce→energyLogistics/rush、showProductionInfo→MissionPools）
- [x] 2.2 同脚本增加模块循环依赖检测（SCC），基线中须含 `roomWorkforce ↔ energyLogistics` 环——基线 3 组（另新发现 gameCapabilities↔roomMode；rush 内部环随 6.5 删除）
- [x] 2.3 同脚本增加角色字面量扫描（带显式豁免清单），基线记录全部命中点——基线 188 处（豁免：constant/、modules/rush/、racebot、`EXECUTORS['x']`/`ROLES['x']` 常量锚定访问）
- [x] 2.4 同脚本增加 import 副作用扫描（模块顶层对原型/全局/注册表赋值检测），基线记录 structureCache/BetterMove/qos/event/outMine/stronghold team 等命中点——基线 11 处（BetterMove×9、structureCache×2）
- [x] 2.5 验证：`node scripts/check-architecture.mjs` 可运行并输出四类基线报告（红名单落盘 scripts/architecture-baseline.json）；`npm test` 集成通过（116/116，含新 architecture-guard.test.ts）

## 3. 角色词表常量化

- [x] 3.1 `constant/CreepConstant.ts` 新增 `ROLES`/`EXECUTORS` 常量表（Object.freeze 派生自 RoleData 键与 executor 字段，词表单一来源仍是 RoleData，无字面量重复）；`tsc --noEmit` 通过
- [x] 3.2 `prototype/Creep/action/index.ts` 的 `roleRegistry` 全部 45 个索引键改用 `[EXECUTORS.x]` 计算键；`tsc --noEmit` 通过（缺失 handler 日志路径回归验证待 3.6 本地服冒烟一并做）
- [x] 3.3 替换散布字面量第一批（spawn 链）：`spawnRules.ts`（规则表键改 `[ROLES.x]` 计算键）、`spawnMission.ts`、`spawnControl.ts`（EMERGENCY_DOWNSIZE_ROLES、RUSH_BODY_ROLES、out- 前缀保留/reserver）、`roomWorkforce.ts`（harvester/upgrader 过滤）；容器推断处补 `Set<string>`/`ReadonlySet<string>` 标注（ROLES 值类型 RoleId 窄于 string）；tsc + 116 测试 + main 构建通过；守卫字面量 188→152
- [x] 3.4 替换散布字面量第二批（防御/外矿/统计/杂项）：45 文件约 150 处替换（比较/实参/记账表键/case 标签/对象键/数组元素/赋值位）；基线 188→0（豁免：Team 冻结文件 5 处、非词表标识 `defend2-attack`(squad 标签)/`claim`(任务代号) 2 处）；**顺手修真 bug（用户授权）：`baseFunction.ts` `case 'out-renged':` 历史拼写错误更正为 `case ROLES['out-ranged']:`**——该分支此前从未匹配，out-ranged 落 default 体型序；修复后走既定的 ranged 体型模板（用户确认属笔误非设计）；双包替换事故已清理（ROLES[ROLES[x]] 运行时等价，已归一）；`tsc` + 116 测试 + main 构建通过
- [x] 3.5 任务类型串收口：新建 `constant/MissionConstant.ts`（`MISSION_POOL_NAMES` + `MISSION_POOLS` 映射表，`satisfies` 与 ambient `MissionPoolName` 联合编译期互检，任务类型联合由 `Record<MissionTaskType,…>` 映射表键已受编译保护）；MissionPools/MissionSubmit 及 22 个提交方文件池名实参全量改引 `MISSION_POOLS.x`；三处 ambient 全局接口文件误改已即时恢复（mission.interface.ts git checkout），注释行审计零残留；`tsc` + 116 测试 + 三入口构建通过
- [x] 3.6 验证：角色字面量扫描转绿（0 命中；豁免：Team 冻结文件、`defend2-attack`/`claim` 非词表标识、`out-renged` 死 case）；`tsc --noEmit` 零错误；三入口 `NO_UPLOAD` 构建全部通过

## 4. 函数级拆分（吸收 code-quality-refactor 未完成批）

- [x] 4.1 `energyLogistics.ts`：`matchRoom` 两阶段提取命名函数 `splitRequestsByLine`/`matchDedicatedPhase`/`matchGeneralPhase`（含回流语义），`matchRequestsToSuppliers` 主循环保持原样；逐块 verbatim 搬移，else 分支语义经空 Set 等价保持（原 5.1）
- [x] 4.2 `energyLogistics.ts`：`buildFillRequests` 按来源拆分 `collectSpawnLineRequests`/`collectTowerRequests`/`collectControllerLineRequests`（cc+断供升级工同属专线），主函数只做汇总过滤（原 5.2）
- [x] 4.3 `spawnMission.ts`：`UpdateSpawnMission` 角色遍历循环体提取 `checkAndQueueRoleMission(role, context, adjusted)`——**当前代码已存在该提取**（缺口门 144-149 / 加急分层 150-158 / shouldSpawnRole 短路 125），原任务规划后文件已随提交演进到位，核对无遗漏即达标（原 3.1）
- [x] 4.4 `spawnMission.ts`：`pickSpawnMission` 开关收拢为 `PickSpawnMissionOptions` 参数对象——**当前代码已存在**（272-300 定义，349-352 组装；原描述第三个开关 `prune` 已被 `pruneDelayedUpgraderSpawnMissions` 机制取代，不再是选项）（原 3.2）
- [x] 4.5 `carrier.ts`：邻位灌注统一走 `fillAdjacentSpawnStructures`——重复实现 `checkAndFillNearbyExtensions` 已在先前提交中删除，现存单实现单调用点（62 定义/167 调用）（原 4.1）
- [ ] 4.6 验证：能量分配结果快照对比逐 tick 一致（原 5.3）；本地服连续 500t 孵化序列无缺孵/错序（原 3.3）；载能 carrier 顺路灌注节拍与基线一致（原 4.2）；`tsc --noEmit` + 三入口构建通过（覆盖原 2.4 的复验）

## 5. 诊断脚本公共层（吸收批）✅ 已由在途工作完成（2026-10-05 复核确认）

- [x] 5.1 新建 `scripts/lib/server-client.mjs`：连接/鉴权/gz+多层 JSON 解码/worker 路由重试穿透（原 6.1）
- [x] 5.2 `diag-mem.mjs`/`watch-stronghold.mjs` 改为薄调用方，各自保留目标与输出格式（原 6.2）
- [ ] 5.3 验证：两脚本对本地服与 47:8001 各读取一次成功（原 6.3）——随终验 deferred 服务器会话执行

## 6. 循环依赖解除

- [x] 6.1 `energyLogistics.ts` 迁至 `src/modules/shared/`（git mv 保历史），4 个消费方 import 路径更新，`tsc` + vitest 通过
- [x] 6.2 `roomWorkforce.ts` 定义 `FillRequestProvider` 类型与 `registerFillRequestProvider()`/`getRegisteredFillRequests()`（未注入安全缺省空数组），删除对 `buildFillRequests` 的直接 import（定编侧只用「请求判空」，实现由能量中枢提供）
- [x] 6.3 组合根接线：main/season/stronghold 三入口在 `configureServerCaps` 后 `registerFillRequestProvider(buildFillRequests)`（先于首次定编）。**注意**：三入口文件带其它在途未提交改动，提交本批时需与其协调（先提交在途工作或逐块暂存）
- [x] 6.4 `externalMine.ts` 对 `spawnRules.ts` 的回引消除：阶段门判定簇（HARVESTER_MAX_WORK_PER_SOURCE/getWalkableSourceSlots/getWorkPartCount/getBuiltRoomLevel/getHarvesterTargetBySource/isRoomProductionSecured/isRoomRemoteUnlocked）verbatim 迁至中性位置 `prototype/Room/function/productionGate.ts`，spawnRules/spawnMission/externalMine 三方改引
- [x] 6.5 删除 `src/modules/rush/`（rush-progression-overhaul 终态决策）：`getRoomNetIncome` 及其私有依赖（getMaxHarvestPower/computeSourceIncome/getSourceAnchor/getSourceNumOpen/getMinerBody/getBodyCost）verbatim 迁入 `roomWorkforce.ts`（source 路径距离缓存改模块级 Map，同进程生命周期语义；export 收敛为模块私有）；删除 rush 测试 8 文件 + helpers/rushStubs；守卫基线改善：分层违规 5→3（roomWorkforce→rush/→energyLogistics 两处消失）、循环 3→2（rush 内部环消失）；`tsc` + vitest 通过（原 6.5 中的三入口构建已验）
- [ ] 6.6 验证：循环依赖检测转绿 ✅（cycles 0；`gameCapabilities↔roomMode` 经核实为 type-only 边，守卫环检测修正为运行时图口径——类型边编译期擦除，分层检查仍计）；vitest 通过 ✅；本地服 `__wd` 与基线逐字段一致——随终验统一执行（与 1.2/4.6 同一 deferred 服务器会话）

## 7. Memory 分域拆解

- [x] 7.1 新建 `src/modules/shared/memory/`：`git mv memory.ts → memory/index.ts`（import 路径零变化），域模块落位：`root.ts`（BotMemory 根访问）/`roomMem.ts`（房间记忆通道）/`roots.ts`（散键收口 accessor）；旧 `memory.ts` 门面阶段跳过——索引文件即门面，46 处调用方零改动
- [x] 7.2 迁移房间配置域调用方（RoomData/LayoutData 消费点）至域 accessor；每域迁移后 `tsc --noEmit` + 三入口构建
- [x] 7.3 迁移设施配置与自动化域调用方（StructData/AutoData/ResourceManage 消费点）；构建通过
- [x] 7.4 迁移外矿/Team/任务池域调用方（OutMineData/TeamData/TeamSpawnQueue/MissionPools 消费点）；构建通过
- [x] 7.5 散键收口（**范围按用户要求扩大**：自建 memory 尽量收进 `Memory.RosmarinBot`，外部只留引擎通道）：`Room.memory` getter 覆盖 → `RosmarinBot.roomMem[roomName]`（per-room 自建字段全体自动归位，调用点零改动；引用搬移迁移 + get/set 双向兼容）；`stats`(58 处→`getStatsMemory()`)、`dd`、`lastinit`、`funnelCooldown`、`GenPixel`、`whitelist`、`warmode`、`mode` 全部收口；直访 `Memory.rooms` 的 10 处全部改走新通道；守卫新增第 [5] 项检查（自建根键/rooms 通道只允许 memory 管理域触达）→ **memoryViolations 0**
- [ ] 7.6 验证：`git grep` 确认旧入口零直调 ✅（守卫 [5] 项 0 违规）；本地服 `__wd` 与基线一致（持久化数据逐字段相同）——随终验 deferred 服务器会话执行（迁移为引用搬移，数据对象不变，预期一致）

## 8. Room 功能注册表与顶层模块清单（组合式：执行面注册表 + 能力方法薄门面）

- [x] 8.1 定义 `ROOM_FEATURES` 注册表（`prototype/Room/featureRegistry.ts`：id/phase('pre'\|'post' 以 QoS 门分界)/gate(含 interval 与 profile/mode 门)/run(room)），`execute.ts` 改为 pre/post 两段遍历；原 `this.XxxWork()` 调用顺序 18 项逐项映射，QoS 门位置逐字保留
- [x] 8.2 各 `*Control`/feature 注册表薄适配（run 引用现有门面方法，方法体不动）；**逻辑主体迁出说明**：按已批准的薄门面模型，Control 类本体即功能模块（门面承载），XxxWork 方法体迁出为可选增量，不阻塞本批
- [x] 8.3 能力方法薄门面第一批 → **已按用户反馈折回**（委托层判过度抽象）：逻辑回归类内，删除 missionPoolApi.ts：MissionPools 全部 16 个池操作方法 + `SpawnMissionAdd`/`deleteSpawnMissionsByRole`/`getSpawnMissionNum`/`getSpawnMissionTotalByRoles` 逻辑 verbatim 迁至 `missionPoolApi.ts`/`spawnMissionApi.ts` 模块函数（this→room 参数化），类方法全部一行委托；`sanitizeMissionPoolMemory` 保持原导出面；`tsc` + 测试 + 三入口构建通过
- [x] 8.4 能力方法薄门面第二批 → **已按用户反馈折回**（2026-10-05：委托层判过度抽象）：`GetRoleBodys/GenerateBodys/CalculateEnergy` 方法体回归 BaseFunction，删除 bodyApi.ts；`RoleSpawnCheck` 本就是模块导出，未动
- [x] 8.5 顶层模块清单化：`src/moduleList.ts`（官服 12 模块）+ `src/branch/{season,stronghold}/moduleList.ts`；三入口组合根 `for (const m of MODULE_MANIFEST) App.on(m)`；分支清单独立文件不破坏 stronghold 的 tree-shake
- [x] 8.6 守卫「禁止新增原型成员」规则：副作用扫描升级为白名单制（允许安装点：BetterMove/structureCache/roomMem 通道/控制台挂载/createApp 引擎互交；白名单外记 prototypeViolations）→ 当前 **0 违规**（原 11 处全部落在允许安装点）；守卫测试同步覆盖五类计数字段
- [ ] 8.7 验证：本地服房间功能执行次序与迁移前一致（防御/设施/自动化动作序列快照）；三入口构建通过；从注册表摘除一项后其余功能运行正常（可移除性抽查）

## 9. framework→console 倒置解除

- [x] 9.1 framework 定义 `RoomAutoStartProvider` 接口与注册函数（`framework/runner/roomAutoStart.ts`）；`RoomRunner.ts` 删除对 `console/function/room`、`console/function/layout` 的 import，改消费接口
- [x] 9.2 console 一侧（组合根 `console/index.ts` 扩展）包装现有自动开局实现并注册
- [ ] 9.3 验证：分层检查中 framework→console 违规清零 ✅（**守卫分层违规全部归零**：5→0，含顺手下沉 sanitize 到 shared 域清掉 showProductionInfo→MissionPools）；本地服新档自动开局流程实测——随终验 deferred 服务器会话执行

## 10. import 副作用收敛

- [x] 10.1 qos/event 显式挂载：移除两模块「加载即挂载」，`mountQoS()`/`ensureEventApi()` 改由 ConsoleExtension 显式调用（控制台人机入口保留 global.qos/event）；structureCache/BetterMove 保留 import 期安装（热路径原型补丁，属白名单安装点——与任务原案的显式化偏差已记录，守卫 [4] 白名单制兜底）
- [x] 10.2 outMine 收入提供方注册显式化：`registerOutMineIncomeProvider()` 由三入口组合根调用（原 import 期注册；三变体接线等价保持）；stronghold atkSpecProvider 本就经 `import './team'` 显式挂载，不属 import 期隐式注册
- [x] 10.4 Global 管理域（用户要求）：运行时 `global.qos`(21 处)/`global.log`(12)/`global.BetterMove`(2) 消费方全部改为属主模块 import（qos 模块新增 `export const qos`；BetterMove 新增 `export const betterMoveApi`）；`OutMineRoadCache`(11)/`Hostiles`/`DefenseCostMatrix`/`DefenseDangerCostMatrix`/`DefenseDangerOffsets` 收口为模块级常量；顺手修死代码：`WallRampartRepairMission` 清理块（全史核查无写入方，仅 workMission 死兜底，已移除）；守卫新增第 [6] 项 global 直访检查（放行 console 层/infra 安装点/createApp 引擎互交/DDModule 控制台挂载）→ **globalViolations 0**
- [ ] 10.3 验证：import 副作用扫描转绿 ✅（0 违规 + 10 安装点）；**冷启动初始化冒烟通过 ✅**（新增 `scripts/smoke-init.mjs`：vm 沙箱真实执行 bundle 全部模块初始化 + loop 空世界 5 tick + roomMem 通道 get/set——顺带抓出并修复 FunnelModule mem 语义错位与全局缓存迁移遗漏）；本地服部署 100t 冒烟与 `__wd` 对比——待 xxscreeps 启动问题解决（10-01 22:26 上游更新后 pathfinder 与 vendored node24 不兼容，DLOPEN 失败，见 13.3）

## 11. externalMine 拆分

- [x] 11.1 externalMine 目录化 + facade（范围修订 2026-10-05）：`git mv` 为 `externalMine/index.ts`，外部消费面（仅 2 处：feature/outMine 适配器 + out-carry）经原路径=即 facade 路径引用，零改动；**内部三域拆分（spawnPolicy/economy/visual）尝试后回滚**——State/Analysis/Spawner 与中段 helper 层相互递归耦合（State.estimateTargetSelectionStat ↔ 分析 helpers 双向引用），verbatim 拆分必产生模块循环，违背零行为红线；结论：保持单文件形态，功能独立性由「消费面窄 + 守卫边界 + 纯函数层（bodyApi/missionPoolApi 模式）后续渐进」保证（拆分前置条件：先在原文件内完成依赖解环，非本变更范围）
- [x] 11.2 验证：`tsc --noEmit` + 测试 + 三入口构建 + 冷启动冒烟通过 ✅（facade 路径不变，消费方零改动，词表/白名单/门状态在该文件重建后全量重放并经守卫复核 roleHits 0 / globalViolations 0）；服务器行为对照随 deferred 会话执行

## 12. branch/race JS→TS 规范化（零行为影响）

> 批次规划（2026-10-05 映射表细化，取代原 12.1–12.5 粗粒度）：12.A 入口/框架/杂项 → 12.B 基础工具 → 12.C 常量/全局方法 → 12.D Room/孵化编排 → 12.E 防御/侦察 → 12.F 经济/帝国 → 12.G 战斗/编队（quadUtils 80K） → 12.H Mission 域（25 文件） → 12.I 外矿/角色执行器 → 12.J 原型挂载收尾+域目录规范化。映射表与转换规则见 `docs/racebot-ts-conversion.md`；机械化转换器 `scripts/convert-racebot.mjs`。
> 基线快照提交：用户选择不提交（2026-10-05），改为仓库外备份 `attempt/racebot-js-baseline/`（110 文件全量副本）。
> 12.B 策略修订（2026-10-05 实测）：12 文件全量 .ts 转换产生约 230 处类型错误（min_heap 35/UnionFind 25/pathUtils 80/mapUtils 30…）——改用**声明先行**策略：先为各模块写 .d.ts 类型声明（消费方获得类型安全），.ts 实体转换按模块渐进；12.B 已回滚至 .js（tsc/local 构建全绿），错误分布存档于本行。
> 验证口径：每批 tsc + race 构建 + 冷启动冒烟（race bundle）+ race 服（21035）部署控制台观察。

- [x] 12.1 现状测绘 + 映射表 ✅（110 文件域→批次映射、转换规则表、循环导入风险与环边保留策略）；机械化转换器 `scripts/convert-racebot.mjs`（顶层 require 提升 / module.exports → export default / 无分号风格兼容 / 懒加载 require 保留）；目录重组工具 `scripts/fix-requires.mjs`（require 相对路径自动重算，1266 处）
- [x] 12.0 目录归域 ✅（2026-10-05）：110 文件按 13 域归入子目录（combat/core/creep/defense/economy/intel/mission/prototype/remote/room/strategy/utils/vendor + 根入口），require 1266 处自动修正；构建+冷启动+守卫全绿
- [x] 12.A 入口/框架/杂项批（12 文件）✅：main/config/dataStorage/memhack/emojis/profiler/tryRun/test*/screeps-get-object-status 转换完成；**race 服验证通道切换为主代码**：新入口分支 `src/branch/local/`（compat + @/main）+ rolldown `VARIANT` 覆盖 + 部署/诊断脚本（verify-server/probe-server）+ 冷启动冒烟通过（local 变体 = 共享树全量）
- [x] 12.A′ 配套设施 ✅：`racebot-memory.d.ts`（Memory 自建字段显式登记——索引签名会使 @types/screeps 合并静默失效，实测确认；字段随批次扩充）；screeps-profiler/screeps-logger 两个第三方文件暂缓转换（错误大户，低规范化收益，保持 .js）

## 12.B–12.J 段（待续）

## 13. 收尾验证

- [x] 13.1 `shared/memory.ts` 已 git mv 为 `memory/index.ts`（无独立门面文件需要删除）；全仓构建通过 ✅
- [ ] 13.2 架构守卫四项检查全绿（红名单清零、豁免清单定稿并入 `npm test`）
- [ ] 13.3 终验：`tsc --noEmit` 零错误；三入口构建通过；本地服连续 1000t 升级吞吐/孵化序列/防御动作与 1.2 基线一致；容器选址窗口化验证——本地服与要塞服均不再出现控制器旁容器群（原 8.3）；race 分支 attempt 对照零行为差异（12.5 结论复核）
- [ ] 13.4 分批提交：每批次独立可编译，conventional 风格中文提交信息，不含任何参考来源信息（提交须用户逐批授权）
