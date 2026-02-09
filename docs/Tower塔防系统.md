# Tower（塔防）系统功能文档

---

## 概述

塔防系统是房间主动防御的核心模块，负责 Tower 的攻击、治疗和修复操作。系统根据房间能量状态和防御需求动态调整策略。

---

## 核心概念

### 1. Tower 能量管理

根据房间能量状态决定 Tower 操作优先级：

| 能量状态 | 能量范围 | 策略 |
|---------|---------|------|
| `CRITICAL` | < 300 | 只攻击，暂停修复/治疗 |
| `LOW` | 300-500 | 攻击优先，少量修复/治疗 |
| `NORMAL` | 500-800 | 攻击 + 修复 + 治疗 |
| `SURPLUS` | > 800 | 大量修复，保持建筑健康 |

### 2. Tower 攻击目标优先级

| 优先级 | 目标类型 | 说明 |
|--------|---------|------|
| 1 | 敌对 PowerCreep | 最高威胁 |
| 2 | 敌对 boosted 近战 | 高威胁 |
| 3 | 敌对 boosted 远程/治疗 | 高威胁 |
| 4 | 敌对普通近战 | 中威胁 |
| 5 | 敌对普通远程/治疗 | 中威胁 |
| 6 | Source Keeper | NPC 威胁 |
| 7 | Invader Core | NPC 威胁 |

### 3. Tower 治疗优先级

| 优先级 | 治疗对象 | 依据 |
|--------|---------|------|
| 1 | 携带攻击部件的受伤单位 | 战力优先 |
| 2 | 携带远程攻击的受伤单位 | 战力优先 |
| 3 | boosted 受伤单位 | 战力优先 |
| 4 | 普通受伤单位 | 次要 |

---

## 数据结构

### Tower 任务数据

```typescript
interface TowerTask {
    type: 'attack' | 'heal' | 'repair';
    target: Id<Creep | Id<Structure> | null;
    priority: number;
}
```

### Tower 缓存数据

```typescript
interface TowerCache {
    towerTargets: Record<roomName, Id<Creep>[]>;
    towerAttackNPC: Record<roomName, Id<Creep>[]>;
    towerHealTargets: Record<roomName, Id<Creep>[]>;
    towerRepairTarget: Record<roomName, Id<Structure>>;
}
```

---

## Tower 工作流程

### 1. 主循环

```typescript
const TowerWork = () => {
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER
    });

    if (!towers.length) return;

    // 1. 获取能量状态
    const energyLevel = getEnergyLevel();

    // 2. 攻击（始终执行）
    TowerAttackEnemy(towers, energyLevel);

    // 3. 治疗（能量充足时）
    if (energyLevel >= LOW) {
        TowerHeal(towers, energyLevel);
    }

    // 4. 修复（能量充足时）
    if (energyLevel >= NORMAL) {
        TowerRepair(towers, energyLevel);
    }
};
```

### 2. 攻击逻辑

```typescript
const TowerAttackEnemy = (towers: StructureTower[], energyLevel: EnergyLevel) => {
    const state = getDefenseState();
    let target: Creep | Structure | null = null;

    // 防御状态优先
    if (state.defend && state.defenseMode === 'breached') {
        // 防御被突破：优先近战敌人
        target = findClosestEnemy(towers, 'melee');
    } else {
        // 正常防御：选择最优目标
        target = selectBestTarget(towers);
    }

    // NPC 威胁
    if (!target) {
        target = findNPC(towers);
    }

    // 集火攻击
    for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] < TOWER_MIN_ENERGY) continue;

        const result = tower.attack(target);
        if (result === OK) {
            // 可视化攻击
            room.visual.line(tower.pos, target.pos, {
                color: '#ff0000',
                width: 0.3
            });
        }
    }
};
```

### 3. 目标选择算法

```typescript
const selectBestTarget = (towers: StructureTower[]): Creep | null => {
    const enemies = room.find(FIND_HOSTILE_CREEPS);
    const powerEnemies = room.find(FIND_HOSTILE_POWER_CREEPS);

    let bestTarget: Creep | null = null;
    let bestScore = -Infinity;

    for (const enemy of [...enemies, ...powerEnemies]) {
        const score = calculateTargetScore(enemy, towers);
        if (score > bestScore) {
            bestScore = score;
            bestTarget = enemy;
        }
    }

    return bestTarget;
};

const calculateTargetScore = (target: Creep, towers: StructureTower[]): number => {
    let score = 0;

    // 1. 距离得分（越近越好）
    const closestTower = getClosestTower(target, towers);
    const distance = target.pos.getRangeTo(closestTower.pos);
    score -= distance * 10;

    // 2. TTK 得分（越快杀越好）
    const ttk = calculateTowerTTK(target, towers);
    score -= ttk * 5;

    // 3. 威胁等级得分
    score -= getThreatLevel(target) * 20;

    // 4. boosted 得分
    if (isBoosted(target)) score -= 50;

    // 5. PowerCreep 得分
    if (target instanceof PowerCreep) score -= 100;

    // 6. 攻击部件得分
    const hasAttack = target.body.some(p => p.type === ATTACK);
    score -= hasAttack ? 30 : 10;

    const hasRangedAttack = target.body.some(p => p.type === RANGED_ATTACK);
    score -= hasRangedAttack ? 20 : 5;

    return score;
};
```

### 4. 治疗逻辑

```typescript
const TowerHeal = (towers: StructureTower[], energyLevel: EnergyLevel) => {
    const allies = room.find(FIND_MY_CREEPS, {
        filter: c => c.hits < c.hitsMax
    });

    // 能量低时只治疗战力单位
    if (energyLevel === LOW) {
        allies.sort((a, b) => {
            return getCombatPower(b) - getCombatPower(a);
        });
    }

    for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] < TOWER_MIN_ENERGY) continue;

        const target = allies[0];
        if (!target) continue;

        const result = tower.heal(target);
        if (result === OK) {
            room.visual.line(tower.pos, target.pos, {
                color: '#00ff00',
                width: 0.3
            });
        }
    }
};
```

### 5. 修复逻辑

```typescript
const TowerRepair = (towers: StructureTower[], energyLevel: EnergyLevel) => {
    // 根据能量状态调整修复阈值
    const repairThreshold = energyLevel === 'SURPLUS' ? 0.8 : 0.95;

    const damaged = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.hits / s.hitsMax < repairThreshold
    });

    // 按重要性排序
    damaged.sort((a, b) => {
        return getRepairImportance(b) - getRepairImportance(a);
    });

    // 能量充足时批量修复
    const repairCount = energyLevel === 'SURPLUS' ? 3 : 1;

    for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] < TOWER_MIN_ENERGY) continue;

        for (let i = 0; i < repairCount && i < damaged.length; i++) {
            const target = damaged[i];
            const result = tower.repair(target);

            if (result === OK) {
                room.visual.line(tower.pos, target.pos, {
                    color: '#ffff00',
                    width: 0.3
                });
            }
        }
    }
};
```

---

## Tower 伤害计算

### 1. 伤害衰减

Tower 伤害随距离衰减：

```typescript
const TOWER_FALLOFF = [
    50,  // range 0
    41,  // range 1
    30,  // range 2
    20,  // range 3
    10,  // range 4
    5,   // range 5+
];
```

### 2. Rampart 保护

Rampart 减少 Tower 伤害：

```typescript
const applyRampartProtection = (damage: number, target: Creep): number => {
    const rampart = target.pos.lookFor(LOOK_STRUCTURES)[0] as StructureRampart;

    if (!rampart) return damage;

    const protection = 1 - (rampart.hits / RAMPART_HITS_MAX);
    return damage * Math.max(0.5, protection);
};
```

### 3. Power 效果

PWR_OPERATE_TOWER 提升 Tower 伤害：

```typescript
const getTowerPower = (tower: StructureTower): number => {
    const basePower = TOWER_POWER_ATTACK;  // 150

    // 检查 PWR_OPERATE_TOWER 效果
    const hasPower = tower.effects?.some(e => e.effect === PWR_OPERATE_TOWER);
    if (!hasPower) return basePower;

    return basePower * 2;  // 2 倍伤害
};
```

---

## 关键配置参数

```typescript
// 能量阈值
const TOWER_ENERGY_LEVELS = {
    CRITICAL: 300,
    LOW: 500,
    NORMAL: 800,
    SURPLUS: 1000
};

// Tower 最小能量
const TOWER_MIN_ENERGY = 10;

// Rampart 最大生命值
const RAMPART_HITS_MAX = 3000000;

// Tower 基础伤害
const TOWER_POWER_ATTACK = 150;
```

---

## 关键文件路径

### 核心实现
- `towerControl.ts` - Tower 控制主逻辑

### 相关系统
- `roomDefense.ts` - 房间防御协调
- `baseFunction.ts` - 能量状态获取

---

## 优缺点分析

### 优点

1. **动态调整**：根据能量状态动态调整操作优先级
2. **智能目标选择**：考虑 TTK、距离、威胁等级等多因素
3. **集火攻击**：所有 Tower 攻击同一目标，快速击杀
4. **分层治疗**：优先治疗战力单位，提高防御效率
5. **分级修复**：按建筑重要性排序，优先修复关键设施
6. **可视化**：攻击、治疗、修复都有可视化反馈

### 缺点

1. **能量消耗高**：频繁攻击和治疗消耗大量能量
2. **射程限制**：最大射程 50，覆盖有限
3. **伤害衰减**：远距离伤害大幅降低
4. **冷却时间**：有 10 tick 冷却
5. **静态防御**：固定位置，可能被绕过
6. **依赖能量**：能量不足时防御能力大幅下降

---

## 使用示例

### 1. 查看 Tower 状态

```typescript
const towers = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER
});

for (const tower of towers) {
    console.log(`Tower at ${tower.pos}:`);
    console.log(`  Energy: ${tower.store[RESOURCE_ENERGY]}`);
    console.log(`  Effects: ${tower.effects?.map(e => e.effect).join(', ') || 'none'}`);
}
```

### 2. 获取能量状态

```typescript
const energy = room.energyAvailable;
const storage = room.storage?.store[RESOURCE_ENERGY] || 0;
const terminal = room.terminal?.store[RESOURCE_ENERGY] || 0;

const total = energy + storage + terminal;

let energyLevel: EnergyLevel;
if (total < 300) energyLevel = 'CRITICAL';
else if (total < 500) energyLevel = 'LOW';
else if (total < 800) energyLevel = 'NORMAL';
else energyLevel = 'SURPLUS';

console.log(`Energy level: ${energyLevel} (${total})`);
```

### 3. 手动触发 Tower 攻击

```typescript
const towers = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER
});

const enemy = room.find(FIND_HOSTILE_CREEPS)[0];
if (enemy && towers.length > 0) {
    towers[0].attack(enemy);
}
```

---

## 注意事项

1. **能量预留**：确保有足够的能量应对突发攻击
2. **Rampart 保护**：保护 Rampart 生命值，确保防御可靠
3. **Power 效果**：PWR_OPERATE_TOWER 可以显著提升伤害
4. **冷却管理**：注意 Tower 10 tick 冷却时间
5. **协同防御**：Tower 与防御兵协同作战，效果最佳
6. **能量回收**：维修优先级低，确保有足够能量用于攻击/治疗
