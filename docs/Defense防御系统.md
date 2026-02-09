# 防御系统（Defense）功能文档

---

## 概述

防御系统是保护房间安全的核心模块，包括主动防御检测、安全模式激活、Tower 分层防御、防御兵孵化等功能。

---

## 核心概念

### 1. 防御状态（Defense State）

房间防御状态定义了房间的安全级别：

| 状态 | 说明 | 行为 |
|------|------|------|
| `breached` | 防御被突破 | 立即孵化防御兵，Tower 优先攻击 |
| `hold` | 持有防线 | Tower 正常防御，按优先级攻击 |
| `observe` | 观察模式 | 只观察不行动（用于低威胁） |
| `avoid` | 避让模式 | 撤离危险区域 |

### 2. 威胁等级（Threat Level）

根据敌对单位计算威胁等级：

| 威胁等级 | 说明 | 响应 |
|---------|------|------|
| 低 | 无敌对单位 | 不孵化防御兵 |
| 中 | 少量非 boosted 敌对 | 孵化单体防御 |
| 高 | 大量敌对或有 boosted 单位 | 孵化双人小队 |
| 极高 | High Boost 治疗团 + Ruin 出现 | 立即激活安全模式 |

---

## 数据结构

### 防御状态结构

```typescript
interface DefenseState {
    defend: boolean;           // 是否处于防御状态
    defendUntil: number;       // 防御持续到何时（tick）
    breached: boolean;         // 防御是否被突破
    defenseRamparts: {        // 防御 rampart 位置缓存
        tick: number;         // 缓存时间
        melee: Id<StructureRampart>[];   // 近战 rampart
        ranged: Id<StructureRampart>[];  // 远程 rampart
        minHits: number;     // 最低生命值
    };
    defenseMode: 'breached' | 'hold' | 'observe';
}
```

### 防御兵配置

```typescript
const RoleData = {
    'defend-attack': {
        bodypart: [[ATTACK, 40], [MOVE, 10]],
        boostmap: {
            attack: RESOURCE_ATANIUM_HYDRIDE,  // XUH2O
        },
        cost: 300,
        level: 2
    },
    'defend-ranged': {
        bodypart: [[RANGED_ATTACK, 40], [MOVE, 10]],
        boostmap: {
            rangedAttack: RESOURCE_KEANIUM_HYDRIDE,  // XKHO2
        },
        cost: 300,
        level: 2
    },
    'defend-2attack': {
        bodypart: [[ATTACK, 8], [TOUGH, 12], [ATTACK, 20], [MOVE, 10]],
        boostmap: {
            attack: RESOURCE_ATANIUM_HYDRIDE,  // XUH2O
            tough: RESOURCE_GHODIUM_HYDRIDE,  // XGHO2
        },
        cost: 600,
        level: 3
    },
    'defend-2heal': {
        bodypart: [[TOUGH, 12], [HEAL, 28], [MOVE, 10]],
        boostmap: {
            heal: RESOURCE_LEMERGIUM_HYDRIDE,  // XLHO2
            tough: RESOURCE_GHODIUM_HYDRIDE,  // XGHO2
        },
        cost: 600,
        level: 3
    }
};
```

---

## 主动防御检测

### 1. 敌对单位检测

```typescript
const roomDefense = () => {
    const enemies = room.find(FIND_HOSTILE_CREEPS);
    const powerEnemies = room.find(FIND_HOSTILE_POWER_CREEPS);

    // 计算威胁等级
    const threatLevel = calculateThreatLevel(enemies, powerEnemies);

    // 检查是否需要安全模式
    if (threatLevel >= CRITICAL && hasRuin) {
        activateSafeMode();
    }

    // 更新防御状态
    updateDefenseState(threatLevel);
};
```

### 2. 威胁等级计算

```typescript
const calculateThreatLevel = (enemies: Creep[], powerEnemies: PowerCreep[]): number => {
    let threat = 0;

    // 普通敌对单位
    for (const enemy of enemies) {
        const isBoosted = enemy.body.some(p => p.boost);
        const hasHeal = enemy.body.some(p => p.type === HEAL);

        if (hasHeal && isBoosted) {
            threat += 10;  // Boosted 治疗团
        } else if (hasHeal) {
            threat += 5;   // 治疗单位
        } else if (isBoosted) {
            threat += 3;   // Boosted 单位
        } else {
            threat += 1;   // 普通单位
        }
    }

    // Power Creep
    for (const pc of powerEnemies) {
        threat += 5;  // Power Creep 高威胁
    }

    return threat;
};
```

### 3. 安全模式激活条件

```typescript
const hasRuin = () => {
    return room.find(FIND_RUINS).length > 0;
};

const shouldActivateSafeMode = () => {
    const state = getDefenseState();
    if (state.defendUntil > Game.time) return false;  // 冷却中

    // 高强度 boost 治疗团 + Ruin
    const boostedHealers = enemies.filter(e =>
        e.body.some(p => p.type === HEAL && p.boost)
    ).length;

    return boostedHealers >= 3 && hasRuin();
};
```

---

## Tower 分层防御

### 1. Tower 攻击逻辑

```typescript
const towerWork = () => {
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER
    });

    if (!towers.length) return;

    // 选择攻击目标
    const target = selectTowerTarget();

    // 集火攻击
    for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] < TOWER_MIN_ENERGY) continue;

        const result = tower.attack(target);
        if (result === OK) {
            visualEffect(tower.pos, target.pos, '#ff0000');
        }
    }
};
```

### 2. 目标选择策略

```typescript
const selectTowerTarget = () => {
    let bestTarget: Creep | Structure | null = null;
    let bestTTK = Infinity;

    // 优先敌对单位
    const enemies = room.find(FIND_HOSTILE_CREEPS);
    const powerEnemies = room.find(FIND_HOSTILE_POWER_CREEPS);

    // 计算每个目标的 TTK（Time To Kill）
    for (const enemy of [...enemies, ...powerEnemies]) {
        const ttk = calculateTowerTTK(enemy, towers);
        if (ttk < bestTTK) {
            bestTTK = ttk;
            bestTarget = enemy;
        }
    }

    // 没有 Creep 目标则攻击 NPC
    if (!bestTarget) {
        const invaders = room.find(FIND_HOSTILE_STRUCTURES);
        bestTarget = invaders[0];
    }

    return bestTarget;
};
```

### 3. TTK 计算

```typescript
const calculateTowerTTK = (target: Creep, towers: StructureTower[]): number => {
    let totalDamage = 0;
    let effectiveDamage = 0;

    for (const tower of towers) {
        const distance = tower.pos.getRangeTo(target.pos);
        const decay = TOWER_FALLOFF[distance] || 1;
        const damage = TOWER_POWER_ATTACK * decay;

        // Rampart 保护
        if (target.pos.inRangeToRampart()) {
            const rampart = target.pos.lookFor(LOOK_STRUCTURES)[0] as StructureRampart;
            damage *= (1 - rampart.hits / RAMPART_HITS_MAX);
        }

        // Boost 效果
        const boosted = tower.effects?.some(e => e.effect === PWR_OPERATE_TOWER);
        damage *= boosted ? BOOST_MULTIPLIER : 1;

        effectiveDamage += damage;
    }

    // 治疗单位考虑
    const healPower = calculateHealPower(target);
    const netDamage = Math.max(1, effectiveDamage - healPower);

    return Math.ceil(target.hits / netDamage);
};
```

### 4. Tower 治疗逻辑

```typescript
const towerHeal = () => {
    const allies = room.find(FIND_MY_CREEPS, {
        filter: c => c.hits < c.hitsMax
    });

    // 优先治疗战力单位
    allies.sort((a, b) => {
        const combatPowerA = getCombatPower(a);
        const combatPowerB = getCombatPower(b);
        return combatPowerB - combatPowerA;
    });

    for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] < TOWER_MIN_ENERGY) continue;

        // 治疗最受伤的单位
        const target = allies[0];
        if (!target) continue;

        const result = tower.heal(target);
        if (result === OK) {
            visualEffect(tower.pos, target.pos, '#00ff00');
        }
    }
};
```

### 5. Tower 修复逻辑

```typescript
const towerRepair = () => {
    // 根据房间能量状态动态调整修复频率
    const energyLevel = getEnergyLevel();
    const repairThreshold = energyLevel === 'SURPLUS' ? 0.8 : 0.9;

    const damaged = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.hits / s.hitsMax < repairThreshold
    });

    // 按重要性排序：rampart > spawn > extension > 其他
    damaged.sort((a, b) => {
        const importanceA = getRepairImportance(a);
        const importanceB = getRepairImportance(b);
        return importanceB - importanceA;
    });

    for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] < TOWER_MIN_ENERGY) continue;

        const target = damaged[0];
        if (!target) continue;

        const result = tower.repair(target);
        if (result === OK) {
            visualEffect(tower.pos, target.pos, '#ffff00');
        }
    }
};
```

---

## 防御兵孵化

### 1. 威胁响应孵化

```typescript
const spawnDefense = () => {
    const state = getDefenseState();
    const threatLevel = state.threatLevel;

    let role: string;
    let count: number;

    // 根据威胁等级选择防御兵
    if (threatLevel < MEDIUM) {
        return;  // 低威胁，不孵化
    } else if (threatLevel < HIGH) {
        // 中等威胁：单体防御
        role = state.hasBoosted ? 'defend-2attack' : 'defend-attack';
        count = 1;
    } else if (threatLevel >= HIGH && hasBoost) {
        // 高威胁且 Boost 充足：双人小队
        room.SpawnMissionAdd('defend-2attack', count);
        room.SpawnMissionAdd('defend-2heal', count);
        return;
    } else {
        // 高威胁：单体防御
        role = state.hasRanged ? 'defend-ranged' : 'defend-attack';
        count = 2;
    }

    // 下发孵化任务
    room.SpawnMissionAdd(role, count);
};
```

### 2. 防御兵类型

| 角色 | 说明 | 适用场景 | Boost 要求 |
|------|------|----------|-----------|
| `defend-attack` | 单体近战攻击 | 中等威胁 | XUH2O |
| `defend-ranged` | 单体远程攻击 | 中等威胁 | XKHO2 |
| `defend-2attack` | 双人高攻击 | 高威胁 | XUH2O + XGHO2 |
| `defend-2heal` | 双人高治疗 | 高威胁 | XLHO2 + XGHO2 |

### 3. 防御兵执行

**defend-attack**（近战攻击）：
```typescript
const DefendAttack = {
    run: function(creep: Creep) {
        const target = findBestEnemy(creep);

        if (target && creep.pos.isNearTo(target)) {
            creep.attack(target);
        } else {
            creep.moveTo(target.pos);
        }
    }
};
```

**defend-ranged**（远程攻击）：
```typescript
const DefendRanged = {
    run: function(creep: Creep) {
        const target = findBestEnemy(creep);

        if (target && creep.pos.inRangeTo(target, 3)) {
            creep.rangedAttack(target);
            // 多目标攻击
            if (getEnemyCountInRange(creep, 3) >= 3) {
                creep.rangedMassAttack();
            }
        } else {
            creep.moveTo(target.pos);
        }
    }
};
```

---

## 防御 CostMatrix

### 1. 安全区计算

```typescript
const generateDefenseMatrix = () => {
    const matrix = new PathFinder.CostMatrix();
    const ramparts = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_RAMPART
    });

    // 标记 Rampart 为不可通行
    for (const rampart of ramparts) {
        matrix.set(rampart.pos.x, rampart.pos.y, 255);
    }

    // 缓存 Rampart 位置
    updateDefenseRamparts(ramparts);

    return matrix;
};
```

### 2. 危险区计算

```typescript
const generateDangerMatrix = () => {
    const matrix = new PathFinder.CostMatrix();
    const enemies = room.find(FIND_HOSTILE_CREEPS);

    // 根据敌对单位的攻击范围标记危险区
    for (const enemy of enemies) {
        const range = getAttackRange(enemy);
        const positions = getPositionsInRange(enemy.pos, range);

        for (const pos of positions) {
            const currentCost = matrix.get(pos.x, pos.y);
            matrix.set(pos.x, pos.y, Math.min(currentCost + 10, 255));
        }
    }

    return matrix;
};
```

---

## 关键文件路径

### 核心实现
- `roomDefense.ts` - 主动防御主逻辑
- `towerControl.ts` - Tower 攻击、治疗、修复逻辑

### 防御兵执行
- `defend/defend-attack.ts` - 近战攻击
- `defend/defend-ranged.ts` - 远程攻击
- `defend/defend-2attack.ts` - 双人攻击小队
- `defend/defend-2heal.ts` - 双人治疗小队

### 角色配置
- `constant/CreepConstant.ts` - 防御兵配置

---

## 优缺点分析

### 优点

1. **分层防御**：Tower 攻击、治疗、修复分层处理，高效利用能量
2. **智能目标选择**：根据 TTK 计算最佳攻击目标
3. **动态响应**：根据威胁等级动态调整防御强度
4. **安全模式**：Ruins + Boost 治疗团自动激活，保护关键设施
5. **双人小队**：高威胁情况下协同作战，提高战斗力

### 缺点

1. **能量消耗高**：Tower 频繁攻击和治疗消耗大量能量
2. **响应延迟**：防御兵孵化有延迟，无法立即响应
3. **Boost 依赖**：高威胁场景依赖 Boost 资源
4. **静态防御**：Rampart 防御位置固定，可能被针对性绕过
5. **成本高昂**：双人小队孵化成本高（600+ 能量）

---

## 使用示例

### 1. 手动激活安全模式

```bash
# 在控制台执行（如果需要手动控制）
# 通常由系统自动触发，但可以手动设置防御状态
```

### 2. 调整防御响应

```typescript
// 在代码中修改威胁阈值
const THREAT_LEVELS = {
    LOW: 5,
    MEDIUM: 15,
    HIGH: 30,
    CRITICAL: 50
};
```

### 3. 查看 Tower 状态

```typescript
const towers = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER
});

for (const tower of towers) {
    console.log(`Tower at ${tower.pos}: ${tower.store[RESOURCE_ENERGY]} energy`);
}
```

---

## 注意事项

1. **能量管理**：确保有足够的能量支持 Tower 持续作战
2. **Rampart 保护**：确保 Rampart 有足够的生命值
3. **Boost 储备**：高威胁场景需要提前准备 Boost 资源
4. **防御兵数量**：根据房间等级和威胁情况合理设置
5. **Observer 支持**：在危险区域部署 Observer 提前预警
