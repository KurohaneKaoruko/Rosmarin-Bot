# 跨 Shard 扩张与 Memory 传递

本文档描述一套“不依赖旗帜、支持跨 shard、支持 creep 过境后自动恢复 memory”的扩张/援建系统实现方案与约定。

## 背景与约束

### 1) shard 之间的运行与 Memory

- 每个 shard 的代码独立运行，`Memory` 也是独立的。
- 跨 shard 通讯必须通过 `InterShardMemory`（`getLocal/setLocal/getRemote`）。

### 2) inter-shard portal 与 creep memory

- creep 踩中 inter-shard portal 后会出现在目标 shard。
- 目标 shard 的 `Memory.creeps[name]` 不会自动带过去，因此需要额外做 memory 迁移与恢复。
- 如果目标 shard 已经存在同名 creep，新到达的 creep 会被立即销毁，因此必须保证跨 shard creep 名称全局唯一。

### 3) CPU 分配

- 目标 shard 必须分配 CPU 才能及时执行“恢复 memory / 继续任务”的逻辑；否则 creep 会在目标 shard 无 memory 的状态下空转直至死亡。

## 目标效果（需求映射）

### 场景 A：在 shardA 发布任务，起点 shardA，目标 shardB

1. 在 shardA 控制台发布扩张任务，指定从 `shardA/room1` 孵化 creep 去 `shardB/room2` 扩张。
2. home shard 自动孵化，并驱动 creep 自动前往 inter-shard portal 跨越 shard。
3. creep 过境后，自动把该 creep 的 memory 迁移到目标 shard 并恢复，然后 creep 在目标 shard 继续执行后续任务（占领/援建）。

### 场景 B：在 shard2 发布任务，但起点 shard 是 shard1

1. 在 shard2 控制台发布任务。
2. 系统自动将任务通过 `InterShardMemory` 投递给 shard1。
3. 任务的权威存储存在 **起点 shard1 的 Memory** 中，并由 shard1 自动孵化与驱动后续流程。

## 总体架构

### 组件

- Console API：`expand.set/list/pause/resume/remove`。
- InterShardMemory Bus：跨 shard 的命令投递、计划索引、状态回写、creep memory 传递邮箱。
- ExpandController（home shard 执行器）：处理命令、将计划落地到 home shard Memory、按缺口自动下发孵化任务。
- Creep Move/Portal：跨 shard 自动寻路到 portal（由移动系统/BetterMove 负责）。
- CreepMemory Transfer：在“即将过境”与“已到达目标 shard”两个时点，通过 ISM 完成 memory 迁移与恢复。

### 数据流（文字版）

1) 任意 shard：控制台 `expand.set(...)` → 写入 ISM 命令队列（toShard=homeShard）  
2) homeShard：ExpandController 拉取命令 → 写入 homeShard 的 `Memory.RosmarinBot.Expand`（权威计划表）→ 下发 SpawnMission  
3) homeShard：creep 接近 portal → 将 creep memory 快照写入 ISM 的 transfer mailbox（按 toShard 分桶）  
4) targetShard：TransferReceiver 拉取远端 mailbox → `Memory.creeps[name] = payload.memory` → creep 继续正常 role 行为  
5) homeShard/targetShard：按需要回写 ISM status（running/done）供任意 shard 查询

## ISM（InterShardMemory）数据结构约定

所有 shard 都维护一份 “local ISM JSON”，其他 shard 通过 `getRemote(shardName)` 读取。该 JSON 结构约定如下：

```ts
type ISMRoot = {
  v: 1
  seq: number
  outbox: Record<string, Array<{
    id: string
    seq: number
    time: number
    fromShard: string
    toShard: string
    type: 'expand.set'|'expand.pause'|'expand.resume'|'expand.remove'
    payload: any
  }>>
  cmdAcks: Record<string, number> // 本 shard 已处理到的远端 shard seq
  plans?: Record<string, {
    id: string
    homeShard: string
    homeRoom: string
    targetRoom: string // 允许 'shardX/W1N1'
    desired: { claimer: number; builder: number; carry: number; upgrader: number }
    status: 'running'|'paused'|'done'
    created: number
    updated: number
  }>
  status: Record<string, {
    shard: string
    time: number
    state: 'running'|'paused'|'done'
    note?: string
  }>
  creepTransfers?: Record<string, Record<string, {
    fromShard: string
    toShard: string
    name: string
    nonce: string
    ttl: number
    memory: any
  }>>
  transferAcks?: Record<string, Record<string, string>>
}
```

说明：
- `outbox[toShard]`：本 shard 发往某个 shard 的命令队列；用 `seq` 做递增序号。
- `cmdAcks[fromShard]`：本 shard 已处理到的“来自某个 shard 的最大 seq”，用于去重消费。
- `plans/status`：home shard 定期把本 shard 的计划摘要与状态发布到自己的 local ISM，供其他 shard 读取展示；权威计划仍在 homeShard 的 `Memory.RosmarinBot.Expand`。
- `creepTransfers[toShard][name]`：以目标 shard 为第一层 key，按 creep name 存 transfer 包。可扩展为同名多包（name+nonce）时改成数组/字典。
 - `transferAcks[fromShard][name]`：目标 shard 在恢复成功后回写 ack，供发送端读取并清理 transfer 包。

## 扩张计划（权威存储：home shard Memory）

home shard 的 `Memory.RosmarinBot.Expand` 作为权威计划表，建议结构：

```ts
type LocalExpandMemory = {
  v: 1
  plans: Record<string, {
    id: string
    homeShard: string
    homeRoom: string
    targetRoom: string
    desired: { claimer: number; builder: number; carry: number; upgrader: number }
    status: 'running'|'paused'|'done'
    created: number
    updated: number
    lastSpawnTick?: number
  }>
}
```

## 控制台 API（规范与兼容）

### set（推荐）

```js
expand.set(home, target, opts?)
```

参数格式：
- `home`：`shard/room` 或 `room`（省略 shard 时默认当前 shard）
- `target`：`shard/room` 或 `room`（省略 shard 时默认当前 shard）
- `opts`：可选，不填时使用默认（claimer=1,builder=1,carry=0,upgrader=0）

示例：
- `expand.set('shard1/W1N1','shard2/W9N9',{claimer:1,builder:2,carry:0})`
- `expand.set('W1N1','shard2/W9N9')`

### list/pause/resume/remove

- `expand.list()`
- `expand.pause(idOrTarget)`
- `expand.resume(idOrTarget)`
- `expand.remove(idOrTarget)`

## 跨 shard creep memory 传递（算法细节）

### 发送端（home shard）

触发条件（推荐策略）：
- creep 下一步将踏入 inter-shard portal（例如检测到 `RoomPosition` 上有 `STRUCTURE_PORTAL` 且 `portal.destination.shard` 存在）。

发送内容：
- `creep.name`（必须全局唯一）
- `nonce`（一次过境的唯一随机串）
- `toShard`
- `memory`（对 `creep.memory` 的 JSON 快照）
- `ttl`（过期 tick，避免邮箱无限膨胀）

发送位置：
- 写入 `InterShardMemory.setLocal(JSON.stringify(root))` 的 `creepTransfers[toShard][creep.name]`。

### 接收端（target shard）

接收流程：
1. 每 N tick（例如 1~3 tick）轮询 `InterShardMemory.getRemote(shardX)`，读取所有 shard 的 remote ISMRoot。
2. 检查 `remote.creepTransfers[thisShard]` 下是否存在条目与当前 `Game.creeps[name]` 匹配。
3. 若匹配且 `Memory.creeps[name]` 不存在，则执行：`Memory.creeps[name] = payload.memory`。
4. 写回 ack：在本 shard local ISM 里记录 `ack`（或写入 `status` note），供发送端后续清理。

### 清理策略

- 发送端每 tick 清理：`ttl < Game.time` 或已被 ack 的 transfer 包。
- 接收端也可在成功恢复后对该条目标记 ack。

## Creep 命名策略（必须）

跨 shard 的 creep 名必须全局唯一，建议：
- `EXP_{planId}_{fromShard}_{seq}`（长度要注意 Screeps 限制）
- 或使用更短的 base36/base16 编码缩短长度

## 常见问题与排障

- 目标 shard 没 CPU：`Memory.creeps` 恢复逻辑不运行 → creep 在目标 shard 没 memory。
- portal 不可达：移动系统无法找到跨 shard 路径 → creep 卡在路上；需要先探索/登记 portal。
- 同名冲突：到达即死 → 检查命名策略与目标 shard 已存在 creep 名。
