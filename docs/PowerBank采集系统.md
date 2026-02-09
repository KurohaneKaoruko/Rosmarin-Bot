# PowerBank/Power采集系统功能文档

---

## 概述

PowerBank 采集系统管理 PowerBank 的发现、攻击和资源采集。系统使用双人小队+远程支援的策略，确保高效清理 PowerBank 并获取 Power 资源。

---

## 核心概念

### 1. PowerBank 规则

- **出现条件**：随机出现，生命值 5000000
- **衰减时间**：每 tick 减少 5000-10000 生命值
- **距离范围**：最多在 1 个房间外
- **资源奖励**：击毁后掉落 Power 资源

### 2. PowerBank 任务类型

| 角色 | 说明 | Boost |
|------|------|-------|
| `power-attack` | 近战攻击 | XUH2O（攻击部位）+ XGHO2（tough） |
| `power-heal` | 高速治疗 | XLHO2（治疗部位）+ XGHO2（tough） |
| `power-ranged` | 远程支援 | XKHO2（远程部位）+ XZHO2（tough） |
| `power-carry` | 资源搬运 | 无 |

### 3. 队伍配置

标准队伍配置：

| 角色 | 数量 | Boost | 职责 |
|------|------|-------|------|
| power-attack | 1 | XUH2O + XGHO2 | 近战攻击 |
| power-heal | 1 | XLHO2 + XGHO2 | 高速治疗 |
| power-ranged | 1-3 | XKHO2 + XZHO2 | 远程火力支援 |
| power-carry | 2-5 | 无 | 资源搬运 |

---

## 数据结构

### PowerBank 任务数据

```typescript
interface PowerMineTask {
    targetRoom: string;   // PowerBank 所在房间
    creep: number;        // 队伍数量
    max: number;          // 最大孵化数
    boostLevel: 0|1|2;  // 强化等级
    prNum: number;       // Ranged 数量
    prMax: number;       // Ranged 最大孵化数
}
```

### Power 内存

```typescript
interface PowerMemory {
    targetRoom: string;
    homeRoom: string;
    partnerId?: Id<Creep>;  // 绑定搭档
    boosted: boolean;
    boostmap?: Record<BodyPartConstant, string>;
}
```

---

## PowerBank 扫描

### 1. 扫描逻辑

```typescript
const scanPowerBanks = () => {
    const powerBanks: { roomName: string; hits: number }[] = [];

    // 扫描所有房间（包括未控制的房间）
    for (const roomName of Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room) continue;

        const structures = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_POWER_BANK
        });

        for (const pb of structures) {
            powerBanks.push({
                roomName: room.name,
                hits: pb.hits
            });
        }
    }

    return powerBanks;
};
```

### 2. PowerBank 价值评估

```typescript
const evaluatePowerBank = (roomName: string, hits: number): { value: number; priority: number } => {
    const value = Math.floor(hits / 500);  // Power 数量

    // 距离因子
    const distance = getDistanceToBase(roomName);
    const distanceFactor = 1 - (distance / 5);  // 距离越近价值越高

    // 生命值因子（越早越好）
    const decayRate = estimateDecayRate(roomName);
    const timeLeft = hits / decayRate;
    const timeFactor = 1 - (timeLeft / 10000);  // 剩余时间越短价值越高

    const priority = value * distanceFactor * timeFactor;

    return { value, priority };
};
```

---

## 队伍管理

### 1. 任务下发

```typescript
const updatePowerMineTasks = () => {
    const powerBanks = scanPowerBanks();

    // 按 priority 排序
    powerBanks.sort((a, b) => {
        const evalA = evaluatePowerBank(a.roomName, a.hits);
        const evalB = evaluatePowerBank(b.roomName, b.hits);
        return evalB.priority - evalA.priority;
    });

    // 下发任务
    for (const pb of powerBanks) {
        const task = {
            targetRoom: pb.roomName,
            creep: 2,  // 默认 1 attack + 1 heal
            max: 4,
            boostLevel: 2,
            prNum: 1,
            prMax: 3
        };

        spawnPowerTeam(task);
    }
};
```

### 2. 队伍孵化

```typescript
const spawnPowerTeam = (task: PowerMineTask) => {
    const homeRoom = Game.rooms[task.homeRoom];

    // 孵化 power-attack
    homeRoom.SpawnMissionAdd('power-attack', {
        name: `power-attack-${task.targetRoom}-${Game.time}`,
        body: powerAttackBody,
        level: 1,
        memory: {
            role: 'power-attack',
            targetRoom: task.targetRoom,
            homeRoom: homeRoom.name,
            boostmap: POWER_ATTACK_BOOST
        }
    });

    // 孵化 power-heal
    homeRoom.SpawnMissionAdd('power-heal', {
        name: `power-heal-${task.targetRoom}-${Game.time}`,
        body: powerHealBody,
        level: 1,
        memory: {
            role: 'power-heal',
            targetRoom: task.targetRoom,
            homeRoom: homeRoom.name,
            partnerId: attackCreepId,  // 绑定到 attack
            boostmap: POWER_HEAL_BOOST
        }
    });

    // 孵化 power-ranged
    for (let i = 0; i < task.prNum; i++) {
        homeRoom.SpawnMissionAdd('power-ranged', {
            name: `power-ranged-${task.targetRoom}-${Game.time}-${i}`,
            body: powerRangedBody,
            level: 2,
            memory: {
                role: 'power-ranged',
                targetRoom: task.targetRoom,
                homeRoom: homeRoom.name,
                boostmap: POWER_RANGED_BOOST
            }
        });
    }
};
```

---

## 角色执行

### 1. power-attack（近战攻击）

```typescript
const PowerAttack = {
    run: function(creep: Creep) {
        const room = Game.rooms[creep.memory.targetRoom];
        if (!room) {
            // 房间已消失，回家
            creep.moveTo(creep.memory.homeRoom);
            return;
        }

        // 检查 Boost
        if (!creep.memory.boosted && creep.memory.boostmap) {
            const result = creep.goBoost(creep.memory.boostmap, { must: true });
            if (result === OK) {
                creep.memory.boosted = true;
                return;
            }
        }

        // 寻找搭档
        const partner = Game.getObjectById(creep.memory.partnerId) as Creep;
        if (!partner) {
            // 搭档死亡，等待新生成
            creep.moveTo(creep.memory.homeRoom);
            return;
        }

        // 寻找 PowerBank
        const powerBank = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_POWER_BANK
        })[0];

        if (!powerBank) {
            creep.moveTo(creep.memory.homeRoom);
            return;
        }

        // 攻击
        if (creep.pos.inRangeTo(powerBank, 1)) {
            creep.attack(powerBank);
        } else {
            creep.moveTo(powerBank.pos, { range: 1 });
        }
    }
};
```

### 2. power-heal（高速治疗）

```typescript
const PowerHeal = {
    run: function(creep: Creep) {
        const room = Game.rooms[creep.memory.targetRoom];
        if (!room) {
            creep.moveTo(creep.memory.homeRoom);
            return;
        }

        // 检查 Boost
        if (!creep.memory.boosted && creep.memory.boostmap) {
            const result = creep.goBoost(creep.memory.boostmap, { must: true });
            if (result === OK) {
                creep.memory.boosted = true;
                return;
            }
        }

        // 寻找搭档
        const partner = Game.getObjectById(creep.memory.partnerId) as Creep;
        if (!partner) {
            creep.moveTo(creep.memory.homeRoom);
            return;
        }

        // 治疗搭档
        if (creep.pos.inRangeTo(partner, 3)) {
            const result = creep.heal(partner);
            if (result === OK) {
                // 可视化治疗
                room.visual.line(creep.pos, partner.pos, {
                    color: '#00ff00',
                    width: 0.2
                });
            }
        } else {
            // 跟随搭档
            creep.moveTo(partner.pos, { range: 1 });
        }

        // 跟离时治疗其他受伤单位
        const injured = room.find(FIND_MY_CREEPS, {
            filter: c => c.hits < c.hitsMax && c.pos.getRangeTo(creep) < 5
        });

        for (const ally of injured) {
            if (creep.pos.inRangeTo(ally, 3)) {
                creep.heal(ally);
            }
        }
    }
};
```

### 3. power-ranged（远程支援）

```typescript
const PowerRanged = {
    run: function(creep: Creep) {
        const room = Game.rooms[creep.memory.targetRoom];
        if (!room) {
            creep.moveTo(creep.memory.homeRoom);
            return;
        }

        // 检查 Boost
        if (!creep.memory.boosted && creep.memory.boostmap) {
            const result = creep.goBoost(creep.memory.boostmap, { must: true });
            if (result === OK) {
                creep.memory.boosted = true;
                return;
            }
        }

        // 寻找 PowerBank
        const powerBank = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_POWER_BANK
        })[0];

        if (!powerBank) {
            creep.moveTo(creep.memory.homeRoom);
            return;
        }

        // 远程攻击
        if (creep.pos.inRangeTo(powerBank, 3)) {
            const result = creep.rangedAttack(powerBank);
            if (result === OK) {
                room.visual.line(creep.pos, powerBank.pos, {
                    color: '#ff0000',
                    width: 0.2
                });
            }
        } else {
            creep.moveTo(powerBank.pos, { range: 3 });
        }

        // 范围攻击（多个目标）
        const enemies = room.find(FIND_HOSTILE_CREEPS, {
            filter: e => e.pos.inRangeTo(creep, 3)
        });

        if (enemies.length >= 2) {
            const result = creep.rangedMassAttack();
            if (result === OK) {
                // 可视化范围攻击
                room.visual.circle(creep.pos, 3, {
                    fill: 'rgba(255, 0, 0, 0.2)',
                    radius: 3
                });
            }
        }
    }
};
```

### 4. power-carry（资源搬运）

```typescript
const PowerCarry = {
    run: function(creep: Creep) {
        const room = Game.rooms[creep.memory.targetRoom];
        if (!room) {
            creep.moveTo(creep.memory.homeRoom);
            return;
        }

        // 检查是否有 Power 资源
        const power = room.find(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_POWER
        })[0];

        if (!power) {
            // 等待 PowerBank 击毁
            creep.moveTo(creep.memory.homeRoom);
            return;
        }

        // 捡起 Power
        if (creep.pos.isNearTo(power)) {
            creep.pickup(power);
        } else {
            creep.moveTo(power.pos);
        }

        // 送回 storage
        const homeRoom = Game.rooms[creep.memory.homeRoom];
        const storage = homeRoom?.storage;

        if (creep.store[RESOURCE_POWER] > 0 && storage) {
            if (creep.pos.isNearTo(storage)) {
                creep.transfer(storage, RESOURCE_POWER);
            } else {
                creep.moveTo(storage.pos);
            }
        }
    }
};
```

---

## PowerSpawn 管理

### 1. 自动转换配置

```typescript
const AutoPowerData = {
    energy: 50000,  // 能量阈值
    power: 1000      // Power 阈值
};
```

### 2. 自动转换逻辑

```typescript
const AutoPower = () => {
    const powerSpawn = room.powerSpawn;
    if (!powerSpawn) return;

    const energy = room.energyAvailable;
    const power = room.powerAvailable || 0;

    // 检查是否满足阈值
    if (energy >= AutoPowerData.energy && power >= AutoPowerData.power) {
        // 开启自动转换
        StructData.powerSpawn = true;
        StructData.powerSpawnMode = 'auto';
    } else {
        // 关闭自动转换
        StructData.powerSpawn = false;
        StructData.powerSpawnMode = 'manual';
    }
};
```

---

## 关键配置参数

### PowerBank 配置

```typescript
const POWER_BOOST = {
    attack: {
        attack: RESOURCE_UTANIUM_HYDRIDE,  // XUH2O
        tough: RESOURCE_GHODIUM_HYDRIDE  // XGHO2
    },
    heal: {
        heal: RESOURCE_LEMERGIUM_HYDRIDE,  // XLHO2
        tough: RESOURCE_GHODIUM_HYDRIDE  // XGHO2
    },
    ranged: {
        rangedAttack: RESOURCE_KEANIUM_HYDRIDE,  // XKHO2
        tough: RESOURCE_ZYNTHIUM_HYDRIDE  // XZHO2
    }
};
```

### 角色配置

```typescript
const RoleData = {
    'power-attack': {
        bodypart: [[ATTACK, 8], [TOUGH, 12], [ATTACK, 20], [MOVE, 10]],
        boostmap: POWER_BOOST.attack,
        cost: 600,
        level: 3
    },
    'power-heal': {
        bodypart: [[TOUGH, 12], [HEAL, 28], [MOVE, 10]],
        boostmap: POWER_BOOST.heal,
        cost: 600,
        level: 3
    },
    'power-ranged': {
        bodypart: [[RANGED_ATTACK, 13], [TOUGH, 12], [MOVE, 25]],
        boostmap: POWER_BOOST.ranged,
        cost: 500,
        level: 2
    },
    'power-carry': {
        bodypart: [[CARRY, 25], [MOVE, 25]],
        cost: 300,
        level: 1
    }
};
```

---

## 关键文件路径

### 核心实现
- `autoPowerSpawn.ts` - PowerSpawn 自动控制

### 角色执行
- `collect/power-attack.ts` - Power 攻击
- `collect/power-heal.ts` - Power 治疗
- `collect/power-ranged.ts` - Power 远程
- `collect/power-carry.ts` - Power 搬运

### PowerSpawn 控制
- `powerSpawnControl.ts` - PowerSpawn 管理

---

## 优缺点分析

### 优点

1. **双人协同**：attack + heal 绑定，高效作战
2. **远程支援**：power-ranged 提供额外火力
3. **Boost 优化**：使用 T3 Boost，提高战斗力
4. **自动扫描**：持续扫描 PowerBank 出现
5. **智能评估**：考虑距离、衰减时间等因素
6. **资源回收**：自动回收 Power 资源

### 缺点

1. **成本高昂**：Boost 消耗大量资源
2. **Creep 损失**：高难度 PowerBank 可能损失 Creep
3. **响应延迟**：从发现到攻击有延迟
4. **竞争激烈**：多个玩家竞争同一 PowerBank
5. **Power 衰减**：不及时清理会损失资源
6. **路网依赖**：需要快速到达目标房间

---

## 使用示例

### 1. 查看扫描结果

```typescript
const powerBanks = scanPowerBanks();
console.log('Power Banks:');

for (const pb of powerBanks) {
    const eval = evaluatePowerBank(pb.roomName, pb.hits);
    console.log(`  ${pb.roomName}`);
    console.log(`    Hits: ${pb.hits}`);
    console.log(`    Power: ~${eval.value}`);
    console.log(`    Priority: ${eval.priority.toFixed(2)}`);
}
```

### 2. 手动添加采集任务

```typescript
// 手动指定 PowerBank 房间
const task = {
    targetRoom: 'E12N34',
    creep: 2,
    max: 4,
    boostLevel: 2,
    prNum: 1,
    prMax: 3
};

spawnPowerTeam(task);
```

### 3. 查看 PowerSpawn 状态

```typescript
const powerSpawn = room.powerSpawn;
if (powerSpawn) {
    console.log(`PowerSpawn status:`);
    console.log(`  Energy: ${powerSpawn.store[RESOURCE_ENERGY]}`);
    console.log(`  Power: ${powerSpawn.store[RESOURCE_POWER]}`);
    console.log(`  Cooldown: ${powerSpawn.cooldown}`);
}
```

---

## 注意事项

1. **Boost 储备**：提前准备足够的 Boost 资源
2. **房间可视化**：使用 Observer 或旗帜标记 PowerBank
3. **路网规划**：确保能快速到达目标房间
4. **竞争监控**：监控其他玩家的 PowerBank 攻击
5. **Creep 补充**：PowerBank 攻击中持续补充队伍
6. **Power 使用**：合理使用 Power 资源（提升等级、购买商品）
