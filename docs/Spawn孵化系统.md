# 孵化系统（Spawn）功能文档

---

## 概述

孵化系统是管理 Creep 孵化的核心模块，负责从任务池获取孵化任务、配置体型、执行孵化逻辑。

---

## 核心概念

### 1. 孵化任务（Spawn Task）

孵化任务描述了要孵化的 Creep 及其配置：

```typescript
interface SpawnTask {
    name: string;              // Creep 名称
    body: ((BodyPartConstant | number)[])[];  // 身体配置
    memory: CreepMemory;    // Creep 内存
    energy: number;          // 所需能量
    upbody?: boolean;        // 是否有升级身体（upgraded body）
}
```

### 2. 身体配置格式

支持两种格式：

**压缩格式**：字符串表示，如 `'w5c1m3'`
- `w` = WORK
- `c` = CARRY
- `m` = MOVE
- `a` = ATTACK
- `r` = RANGED_ATTACK
- `h` = HEAL
- `t` = TOUGH

**数组格式**：`[[WORK, 5], [CARRY, 1], [MOVE, 3]]`

### 3. 能量状态

房间能量状态决定孵化策略：

| 状态 | 能量范围 | 孵化策略 |
|------|---------|----------|
| `CRITICAL` | < 10000 | 使用当前能量孵化缩小体型 |
| `LOW` | 10000-20000 | 使用当前能量孵化缩小体型 |
| `NORMAL` | 20000-50000 | 使用完整体型 |
| `SURPLUS` | > 50000 | 使用完整体型 |

---

## 数据结构

### 孵化任务数据

```typescript
interface SpawnMissionData {
    name: string;
    body: ((BodyPartConstant | number)[])[] | string;
    memory: CreepMemory;
    energy: number;
    upbody?: boolean;
    level: number;  // 任务优先级
}
```

### Creep 内存结构

```typescript
interface CreepMemory {
    role: string;        // 角色类型
    homeRoom: string;    // 家房间
    targetRoom?: string;  // 目标房间（用于外矿/战斗）
    mission?: any;      // 当前任务
    boosted?: boolean;    // 是否已 Boost
    downgraded?: boolean; // 是否被降级孵化
}
```

---

## 孵化流程

### 1. 获取孵化任务

```typescript
const getSpawnTask = (room: Room): SpawnTask | null => {
    const spawn = room.spawn;
    if (!spawn || spawn.spawning) return null;

    // 从任务池获取孵化任务
    const task = room.getSpawnMission();
    if (!task) return null;

    // 检查能量是否足够
    if (task.energy > room.energyAvailable) {
        // 能量不足，尝试降级孵化
        return getDowngradedTask(task, room.energyAvailable);
    }

    return task;
};
```

### 2. 能量状态适配

```typescript
const getDowngradedTask = (task: SpawnTask, availableEnergy: number): SpawnTask | null => {
    const bodyStr = typeof task.body === 'string' ? task.body : '';
    const bodyParts = parseBody(bodyStr);

    // 计算实际能量消耗
    const energyCost = calculateBodyCost(bodyParts);

    if (energyCost <= availableEnergy) {
        return task;  // 能量足够，返回原任务
    }

    // 降级：减少身体部件
    const downgradedBody = reduceBody(bodyParts);
    const downgradedCost = calculateBodyCost(downgradedBody);

    if (downgradedCost <= availableEnergy) {
        return {
            ...task,
            body: downgradedBody,
            energy: downgradedCost,
            downgraded: true
        };
    }

    return null;  // 仍不足能量
};
```

### 3. 执行孵化

```typescript
const executeSpawn = (room: Room): number => {
    const spawn = room.spawn;
    if (!spawn || spawn.spawning) return ERR_BUSY;

    const task = getSpawnTask(room);
    if (!task) return ERR_NOT_FOUND;

    // 解析身体配置
    const body = parseBody(task.body);

    // 执行孵化
    const result = spawn.spawnCreep(
        body,
        task.name,
        { memory: task.memory }
    );

    if (result === OK) {
        console.log(`Spawning ${task.name} with ${body.length} parts`);
    } else if (result === ERR_NOT_ENOUGH_ENERGY) {
        console.log(`Not enough energy for ${task.name}`);
        room.deleteMissionFromPool('spawn', task.id);
    }

    return result;
};
```

### 4. 孵化可视化

```typescript
const visualizeSpawn = (room: Room) => {
    const spawn = room.spawn;
    if (!spawn) return;

    // 显示孵化进度
    if (spawn.spawning) {
        const progress = spawn.spawning.remainingTime / CREEP_SPAWN_TIME[spawn.spawning.name] * 100;

        room.visual.text(
            `${Math.floor(progress)}%`,
            spawn.pos,
            { align: 'center', fontSize: 8, color: '#00ff00' }
        );
    }

    // 显示能量状态
    const energyColor = getEnergyStateColor(room.energyAvailable);
    room.visual.rect(spawn.pos, 1, 1, {
        fill: `rgba(${energyColor}, 0.3)`,
        stroke: energyColor
    });
};
```

---

## 角色配置

### 角色类型定义

所有角色配置在 `constant/CreepConstant.ts` 中：

| 角色 | 说明 | 体型示例 | Boost |
|------|------|----------|-------|
| `harvester` | 能量采集 | w5c1m3 | 无 |
| `miner` | 矿物采集 | w15m3 | XUHO2 |
| `carry` | 搬运 | c6m6 | 无 |
| `upgrader` | 升级 | w5m4 | 无 |
| `builder` | 建造 | w10m4 | 无 |
| `repairer` | 维修 | w5m4 | 无 |
| `transport` | 运输 | c10m10 | 无 |
| `claimer` | 占领 | m5c1 | 无 |
| `defend-attack` | 防御 | a40m10 | XUH2O |
| `defend-ranged` | 防御 | r40m10 | XKHO2 |
| `out-harvest` | 外矿采集 | w5c1m3 | 无 |
| `reserver` | 预定 | c1m6 | 无 |

### 角色优先级

| 优先级 | 角色类型 | 说明 |
|--------|----------|------|
| 0-2 | spawn、repair、boost | 最高优先级 |
| 1-3 | defend-* | 高优先级 |
| 3-6 | transport、manage | 中等优先级 |
| 5-8 | builder、upgrader | 较低优先级 |
| 6-9 | out-*、mine | 低优先级 |

---

## 关键文件路径

### 核心实现
- `spawnControl.ts` - 孵化控制主逻辑

### 角色配置
- `constant/CreepConstant.ts` - 所有角色定义和配置

### 任务更新
- `spawnMission.ts` - 孵化任务更新

---

## 优缺点分析

### 优点

1. **任务驱动**：从任务池获取任务，支持动态调整
2. **能量适配**：根据房间能量状态自动降级/恢复体型
3. **紧急孵化**：能量不足时自动孵化 universal 通用机
4. **可视化**：实时显示孵化进度和能量状态
5. **灵活配置**：支持压缩和数组两种体型格式

### 缺点

1. **降级问题**：降级后的 Creep 性能下降
2. **孵化延迟**：任务更新间隔（10 tick）可能导致孵化空窗
3. **名称冲突**：可能存在 Creep 名称冲突
4. **能量浪费**：降级孵化可能导致能量浪费
5. **同步问题**：任务池和孵化状态可能不同步

---

## 使用示例

### 1. 手动添加孵化任务

```typescript
// 在房间中添加孵化任务
room.SpawnMissionAdd(
    'harvester-001',  // Creep 名称
    'w5c1m3',         // 体型
    1,                // 优先级
    'harvester',       // 角色
    { homeRoom: room.name, targetId: source.id }
);
```

### 2. 查看孵化状态

```typescript
const spawn = room.spawn;
if (spawn.spawning) {
    console.log(`Spawning: ${spawn.spawning.name}`);
    console.log(`Progress: ${(1 - spawn.spawning.remainingTime / CREEP_LIFE_TIME[spawn.spawning.name]) * 100).toFixed(1)}%`);
}
```

### 3. 获取孵化能量需求

```typescript
const task = room.getSpawnMission();
if (task) {
    const body = parseBody(task.body);
    const energyCost = BODYPART_COST.reduce((sum, part) => {
        return sum + BODYPART_COST[part] || 0;
    }, 0);

    console.log(`Energy needed: ${energyCost}`);
}
```

---

## 注意事项

1. **能量预留**：确保有足够能量孵化关键角色（防御、维修）
2. **名称唯一**：确保 Creep 名称唯一，避免冲突
3. **孵化冷却**：Spawn 有 3 tick 冷却时间
4. **体型优化**：合理配置身体比例，提高 Creep 效率
5. **能量监控**：监控房间能量状态，避免能量枯竭
