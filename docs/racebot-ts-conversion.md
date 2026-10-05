# racebot JS→TS 转换映射表（批次 12 战役文档）

> 现状（2026-10-05 盘点）：110 个 .js 全部平铺于 `src/branch/race/racebot/`，4.3 万行，
> 1136 处 require、105 处 module.exports、0 处 ESM export；`??` 109 处（可由 TS 降级编译）、
> 无 `?.`、无类字段。当前 tsconfig include 不含 .js——转换后全部纳入 tsc 检查。
>
> 转换原则（对齐任务 12.x）：**语义逐行 1:1，零行为变化**；仅做类型标注与导出边界规范化；
> 每批以 race 服（21035）部署 + 控制台观察为验收。

## 转换规则（codemod 可机械化 + 人工兜底）

| CJS 形态 | TS/ESM 形态 | 说明 |
|---|---|---|
| `module.exports = { a, b }` | `const api = { a, b };` + `export default api;` | 命名导出细化留待后续 pass |
| `module.exports = class X` / `= fn` | `export default X` / `export default fn` | |
| `const x = require('./y')` | `import x from './y'` | 配合默认导出；esModuleInterop ✓ |
| `const { a, b } = require('./y')` | `import y from './y'; const { a, b } = y;` | 两步，保序 |
| 函数体内的 `require('./y')`（懒加载） | **保留 require() 不动** | 循环依赖的 CJS 惰性加载语义，禁止提升为 import |
| 顶层 `require` 且模块存在相互引用（环边） | 暂缓提升，保留 require | 环边清单在每批转换时实测标注 |

### 🔴 导出形态必须与消费者同批转换（2026-10-05 事故）

上表只讲「这个模块怎么改」，漏了「谁在用」——**只改模块不改消费者 = 直接打断运行**：

- 打包器对 `require()` 打到一个 ESM 模块会编译成 `__toCommonJS(ns)` → 消费者拿到的是
  `{ __esModule: true, default: 值 }`，于是 `config.test` 变 undefined、整个 bot 在模块顶层抛错
  （`TypeError: Cannot read properties of undefined (reading 'profiler')`，race 分支 21035 实测）。
- 反过来 **ESM 默认导入 CJS 模块是安全的**（`__toESM` 会把 module.exports 当 default），
  所以「CJS 模块 + import 消费者」能跑，「ESM 模块 + require 消费者」不能跑。

因此每批转换前先做**消费者普查**，再决定方向：

```bash
# 该模块还有多少个 require 消费者？>0 就先别改导出形态
grep -rc "require(\"\./<模块名>\")" src/ | grep -v ":0"
```

- 有 require 消费者 → 本批**不要**动它的导出形态（或连同全部消费者一起改）。
- 只有 ESM 消费者 → 可以转 `export default`。
- 顺带：`.ts` 里用 `module.exports = X` 保持 CJS 在**类型侧**是无解的
  （`export =` 报 TS1203：target 为 ESM 时禁用；`export default` + `module.exports` 并存会被打包器判为 ESM）。
  所以「纯 JS 内容 + 有 require 消费者」的模块，**保留 `.js` 扩展名**是唯一零副作用的形态。

### 🔴 `as any` 标注会制造 ASI 断链（同批事故）

给语句加类型标注时若把行首变成 `(`，上一行的调用会被续接成调用链：

```diff
  Logger.info(LOG_CAT.SYSTEM, null, "Global resetted")
- Memory.globalReset = Game.time          // 原文：ASI 正常断句
+ (Memory as any).globalReset = Game.time // 变成 Logger.info(...)(Memory).globalReset = ...
```

运行时报 `Logger$2.info(...) is not a function`，且只在「Global resetted」那一个分支出现。
修法：行首补 `;`（仓库既有先例 `;(globalThis as any).Memory = memory`）。
自查：`node attempt/scan-cjs-esm-interop.mjs`（两类坑一起扫）。

## 域 → 批次映射

| 批 | 域 | 文件（大小） | 备注 |
|---|---|---|---|
| 12.A | 入口/框架/杂项 | main(4K) config(8K) dataStorage(4K) memhack(1K) emojis(2K) profiler(1K) screeps-profiler(16K) screeps-logger(20K) screeps-get-object-status(7K) tryRun(0K) test(0K) test_scoutMap(3K) | 首批：建立域目录骨架与转换范式。**2026-10-05 部分回滚，见下节** |
| 12.B | 基础工具 | utils(15K) coordUtils(12K) utf15(9K) util_algorithm(8K) util_algorithm_mincut(7K) util_dijkstra(11K) util_min_heap(2K) util_queue(1K) UnionFind(4K) ExtendedCostMatrix(1K) mapUtils(18K) pathUtils(32K) | 纯算法层，依赖最少 |
| 12.C | 常量/全局方法 | constant(18K) globalMethods(16K) emojis 并入 | 全局挂载面清点 |
| 12.D | Room/孵化编排 | roomManager(35K) roomAnalyzer(10K) spawnManager(7K) spawnUtils(54K) manageHub(11K) manageBuild(9K) manageBoost(9K) mangeLab(9K) manageFactory(5K) manageMinerals(9K) manageResources(5K) manageUpgrade(10K) manageCourier(6K) manageLogistics(23K) bucketManager(2K) | 孵化/设施核心 |
| 12.E | 防御/侦察 | manageDefense(27K) manageDefenseNuke(10K) manageScout(29K) manageAbandon(2K) intelManager(9K) userIntelManager(15K) intelUtils(18K) | |
| 12.F | 经济/帝国 | empireUtils(7K) expansionManager(13K) funnelManager(11K) marketManager(19K) marketUtils(0K) resourceUtils(8K) scoreManager(11K) diplomacy(3K) simpleAllies(21K) dataCleaner(6K) segmentManager(2K) statistics(16K) statisticsUtils(1K) powerCreepManager(10K) | |
| 12.G | 战斗/编队 | combatManager(8K) combatUtils(40K) duoUtils(16K) quadUtils(80K) formationUtils(10K) | 最大单文件 quadUtils 80KB |
| 12.H | Mission 域（25 文件） | missionManager(4K) missionUtils(10K) missionMethods(15K) mission-primitive-actions(5K) + mission{Claim,CleanUp,DefenseRemote,DeliverEnergy,Dig,Digger,Duo,Harass,JumpClaim,LesserStrongholdAssault,Loot,Mineral,Occupy,PowerBank,PowerBankDuo,PutScore,Quad,QuadOccupy,Scout,Siege(55K),Squad,SuppressRoom,SuppressTotal,TotalWar,Unclaim} | 数量多但单文件中等 |
| 12.I | 外矿域 | remoteRoles(34K) remoteUtils(27K) creepRoles(44K) creepUtils(39K) roomUtils(40K) creepActions(5K) | 角色执行器集中区 |
| 12.J | 原型挂载 + 收尾 | Creep_prototype Room_prototype Structure_prototype + 域目录规范化（平面→域目录移动）+ 环边清单复核 | |

## 验证协议（每批）

1. `npx tsc --noEmit` 零错误（racebot 纳入 tsc 检查范围后）。
2. `VARIANT=race` 构建 + `node scripts/smoke-init.mjs dist/main.js`（race bundle 冷启动）。
3. race 服（21035）部署 + `scripts/verify-server.mjs` 控制台观察 ≥75s：零 error、Game.time 推进。
4. 与上一批部署的控制台行为对比（孵化/移动日志节拍一致）。

## 回滚记录（2026-10-05）

12.A 的导出形态转换**只做了模块、没做消费者**，导致 race 分支一上线即在模块顶层抛错
（`Cannot read properties of undefined (reading 'profiler')`，`main:1826`）。处理：

| 文件 | 现状 | 依据 |
|---|---|---|
| `config.js` `dataStorage.js` `emojis.js` `tryRun.js` | **回滚为 `.js`（与 `attempt/racebot-js-baseline/` 逐字节一致）** | 分别有 85 / 30 / 36 / 30 个 `require()` 消费者；内容纯 JS，留在 `.js` 是唯一零副作用形态 |
| `memhack.ts` `test.ts` `profiler.ts` | 保持 `.ts` + `export default` | 仅 `main.ts` 以默认导入使用（ESM 消费 ESM，安全）；0 个 require 消费者 |
| `screeps-get-object-status.ts` | 保持 `.ts` + `export default`；改 `missionPowerBank.js` 的 1 处 `require` 为默认导入 | 含 `as any` 标注必须留在 `.ts`；消费者只有 1 个 |

同期修掉的第二处 12.A 事故：`memhack.ts` 的 `(Memory as any).globalReset` ASI 断链（见上节）。
另：`scripts/smoke-init.mjs` 此前缺 `COMMODITIES` / `Game.notify` / `RoomVisual.{export,import}` /
`Game.cpu.getHeapStatistics` 桩，race bundle 从未真正跑通冷启动——补齐后 race 冒烟 4 项全绿。

## 已知风险

- **循环导入 TDZ**：CJS 惰性 require 的环边提升为 ESM import 后初始化顺序改变 → 每批部署冒烟捕捉；环边一律保留 require()。
- **默认导出下的循环互访**：默认导入的对象在环内可能尚未初始化 → 同上，环边不转换。
- **`??` 降级**：TS 3.7+ 可降级至 ES2017 target，构建产物行为一致。
- **行为等价基线**：转换前先做一次基线部署快照（控制台节拍 + 房间状态），逐批对照。
