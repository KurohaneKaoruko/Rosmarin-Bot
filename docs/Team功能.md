# Team 功能文档

---

## 概述

Team 功能是一个多人协作战斗系统，用于管理多 Creep 协同作战。系统支持自动孵化、队形保持、战斗决策、跨房移动等高级功能。

---

## 核心概念

### 1. Team（队伍）

Team 是由多个 Creep 组成的战斗单位，具有统一的任务和目标。

**Team 状态：**
- `ready`：集结中，等待成员归队
- `attack`：进攻中，执行战斗任务
- `flee`：撤退中，脱离战斗
- `avoid`：避让中，绕过障碍或敌人
- `sleep`：休眠中，暂停行动

**队形类型：**
- `line`：线性队形，成员排成一行
- `quad`：方阵队形，成员排成矩阵

### 2. Creep 角色

Team 中的 Creep 按角色分类：

| 角色 | 说明 |
|------|------|
| `team-attack` | 近战攻击型 |
| `team-dismantle` | 拆迁型 |
| `team-ranged` | 远程攻击型 |
| `team-heal` | 治疗型 |

---

## 数据结构

### Memory 中的队伍数据

```typescript
interface TeamMemory {
    name: string;                                      // 队伍名称
    time: number;                                       // 创建时间
    status: 'ready' | 'attack' | 'flee' | 'avoid' | 'sleep';
    toward: '↑' | '←' | '→' | '↓';                 // 朝向
    formation: 'line' | 'quad';
    moveMode: string;
    homeRoom: string;                                   // 孵化房间
    targetRoom?: string;                                // 目标房间
    creeps: Id<Creep>[];                                // 成员ID数组
    num: number;                                        // 预期成员数量
    spawnFlag?: string;                                 // 孵化旗名称
    cache?: TeamCacheMemory;                             // 缓存数据
}
```

### 运行时 Team 实例

```typescript
interface Team {
    name: string;
    status: 'ready' | 'attack' | 'flee' | 'avoid' | 'sleep';
    toward: '↑' | '←' | '→' | '↓';
    formation: 'line' | 'quad' | string;
    moveMode: string;
    homeRoom: string;
    targetRoom: string;
    creeps: Creep[];
    cache: { [key: string]: any };
    flag: Flag;                                         // 指挥旗
    actionMode: 'normal' | 'rush' | 'press';           // 行动模式
    targetMode: 'default' | 'structure' | 'creep' | 'flag'; // 索敌模式
}
```

---

## 创建队伍

### 1. 通过旗帜创建

旗帜命名格式：`TEAM_配置_孵化房间_最大孵化数量_目标房间_孵化间隔`

示例：
- `TEAM_A28/4_E12N34_N1_T1000` - 在 E12N34 房间孵化 A28/4 配置的队伍，最多1个，间隔1000 tick

### 2. 配置文件

配置位置：`src/modules/feature/Team/config/TeamConfig.ts`

```typescript
// 角色配置示例
export const A28T12 = {
    role: 'team-attack',
    body: [MOVE, ATTACK, MOVE, ATTACK, MOVE, ATTACK],
    boost: {
        attack: RESOURCE_ATANIUM_HYDRIDE,  // XUH2O
    },
    cost: 300,
    level: 2,
};

// 队伍配置示例
export const TEAM_CONFIG = {
    'A28/4': [A28T12, A28T12, H28T12, H28T12],  // 4人攻击队
    'AH/2': [A25T15, H28T12],                   // 2人攻击+治疗
    'RH/4': [RH_A, RH_A, RH_B, RH_B],           // 4人远程队
};
```

---

## 孵化流程

### 1. 解析指令

`TeamSpawner.ts` 识别旗帜并解析配置：

```typescript
// 旗帜名称解析
const parts = flagName.split('_');
const configName = parts[1];      // 配置名称（如 "A28/4"）
const homeRoom = parts[2];        // 孵化房间
const maxNum = Number(parts[3]);  // 最大孵化数量
const targetRoom = parts[4];      // 目标房间
const interval = Number(parts[5]); // 孵化间隔
```

### 2. 创建队伍数据

```typescript
const teamMem = ensureTeamData(teamID);
Object.assign(teamMem, {
    name: teamID,
    status: 'ready',
    toward: '↑',
    formation: 'line',
    creeps: [],
    num: Team_Config.length,
    time: Game.time,
    homeRoom: room.name,
    targetRoom: flag.pos.roomName,
});
```

### 3. 创建指挥旗

自动在旗帜位置创建 `Team-{teamID}` 指挥旗，用于控制队伍行动。

### 4. 下发孵化任务

为每个角色创建 SpawnMission：

```typescript
for (const config of Team_Config) {
    room.SpawnMissionAdd(
        creepName,
        config.body,
        priority,
        config.role,
        { ...memory, teamID, boostmap: config.boost }
    );
}
```

---

## Creep 加入/离开 Team

### 1. 孵化阶段

Creep 孵化完成后，`TeamController.ts` 识别 team 角色并开始处理：

```typescript
if (role.startsWith('team')) {
    const teamID = creep.memory['teamID'];
    const team = getTeamData(teamID);
    if (!team) continue;
    // 处理 team Creep
}
```

### 2. Boost 阶段

如果配置了 boostmap，Creep 先去 Boost：

```typescript
if (!creep.memory.boosted) {
    if (creep.memory['boostmap']) {
        const result = creep.goBoost(creep.memory['boostmap'], { must: true });
        if (result === OK) {
            creep.memory.boosted = true;
            delete creep.memory['boostmap'];
        }
    } else {
        creep.memory.boosted = true;
    }
}
```

### 3. 归队阶段

Boost 完成后，Creep 正式加入队伍：

```typescript
if (!creep.memory['rejoin']) {
    const teamID = creep.memory['teamID'];
    const team = getTeamData(teamID);
    if (!team) continue;
    team.creeps.push(creep.id);  // 加入队伍
    creep.memory['rejoin'] = true;
}
```

### 4. 离开机制

- **死亡**：成员死亡自动从队伍中移除
- **超时**：队伍超时未集结自动解散
- **全员死亡**：队伍全部死亡时解散

---

## 执行流程

### Team.exec 执行顺序

```typescript
exec(): void {
    this.Update();   // 更新数据/绘制
    this.Attack();  // 选目标/火力/避让
    this.Move();    // 移动/集结/变阵
    this.Adjust();  // 朝向微调
    this.Save();    // 保存状态
}
```

### 1. Update（更新数据）

**位置：** `TeamClass.ts`

```typescript
Update(): void {
    // 更新 Creep 引用
    this.updateCreeps();

    // 战斗评估，决定队伍状态（attack/avoid/flee/sleep）
    this.evaluateBattle();

    // 队形保持检查
    this.checkFormation();

    // 绘制调试信息
    this.draw();
}
```

### 2. Attack（选目标/火力/避让）

**位置：** `TeamBattle.ts`

```typescript
Attack(): void {
    // 选择目标
    const targets = TeamBattle.chooseTargets(this);

    // 自动攻击
    for (const creep of this.creeps) {
        const target = TeamBattle.selectTarget(creep, targets);
        if (target) {
            creep.attack(target);
        }
    }

    // 添加避让对象
    TeamBattle.addAvoidObjs(this, targets);

    // 更新推进目标点
    this.updateAdvancePoint();
}
```

**目标选择逻辑：**

- 根据 `targetMode` 选择目标类型：
  - `default`：默认选择
  - `structure`：优先建筑
  - `creep`：优先 Creep
  - `flag`：优先旗帜

- 根据 `actionMode` 调整攻击策略：
  - `normal`：正常攻击
  - `rush`：强攻模式，不避让
  - `press`：压制模式，优先攻击

### 3. Move（移动/集结/变阵）

**位置：** `TeamAction.ts`

```typescript
Move(): void {
    // 队伍集结
    if (this.status === 'ready') {
        this.Gather();
    }
    // 线性队形移动
    else if (this.formation === 'line') {
        this.LinearMove();
    }
    // 方阵队形移动
    else {
        this.MatrixMove();
    }

    // 跨房移动处理
    this.handleCrossRoom();
}
```

**线性队形：**

```typescript
LinearMove(): void {
    // 根据 toward 确定队形方向
    // 每个成员移动到相对于队长的位置
    for (let i = 0; i < this.creeps.length; i++) {
        const offset = this.getLineOffset(i);
        const targetPos = getOffsetPos(this.leader.pos, offset);
        this.creeps[i].goTo(targetPos, { avoid: this.avoidObjs });
    }
}
```

**方阵队形：**

```typescript
MatrixMove(): void {
    // 2x2 矩阵保持
    // 四个成员保持固定相对位置
    const positions = this.getMatrixPositions();
    for (let i = 0; i < this.creeps.length; i++) {
        this.creeps[i].goTo(positions[i], { avoid: this.avoidObjs });
    }
}
```

### 4. Adjust（朝向微调）

```typescript
Adjust(): void {
    if (this.formation !== 'quad') return;

    // 矩阵队形的朝向调整
    this.adjustMatrixOrientation();

    // 四人成形矩阵的角位纠正
    this.correctCornerPositions();
}
```

### 5. Save（保存状态）

```typescript
Save(): void {
    // 将运行时状态写回 Memory
    const teamMem = getTeamData(this.name);
    teamMem.status = this.status;
    teamMem.toward = this.toward;
    teamMem.formation = this.formation;
    // ... 其他状态
}
```

---

## 行为模式控制

### 通过旗帜颜色控制

**主旗颜色**（决定索敌模式）：
- 默认（无色）：default
- 黄色：structure（优先打建筑）
- 绿色：creep（优先打 creep）
- 红色：flag（优先打旗）

**副旗颜色**（决定行动模式）：
- 默认（无色）：normal
- 紫色：rush（强攻模式）
- 蓝色：press（压制模式）

---

## 优缺点分析

### 优点

1. **自动化程度高**：从孵化、Boost、集结到战斗完全自动化
2. **队形保持**：支持多种队形，保持团队阵型
3. **灵活配置**：通过旗帜和配置文件轻松控制队伍行为
4. **智能决策**：自动评估战斗形势，选择进攻/撤退/避让
5. **跨房间协作**：支持多房间孵化和协同作战

### 缺点

1. **复杂度高**：系统复杂，理解和维护成本较高
2. **依赖 Boost**：需要大量 Boost 资源，成本高
3. **学习曲线陡峭**：新手难以快速上手
4. **性能开销**：多个 Team 同时运行时 CPU 开销较大

---

## 关键文件路径

### 核心类文件
- `TeamClass.ts` - 队伍实体类
- `TeamController.ts` - 队伍调度器
- `TeamSpawner.ts` - 队伍生成器

### AI 行为文件
- `TeamAction.ts` - 移动和队形控制
- `TeamBattle.ts` - 战斗决策和索敌

### 工具和配置文件
- `TeamUtils.ts` - 工具函数
- `TeamConfig.ts` - 配置表
- `Team.interface.ts` - 接口定义

### 模块入口
- `index.ts` - 模块导出
- `TeamModule.ts` - 运行时模块

---

## 使用示例

### 1. 创建简单的攻击队伍

```bash
# 在游戏中放置旗帜
TEAM_A28/4_E12N34_N1_T1000
```

这将创建一个 4 人攻击队，配置为 A28/4，从 E12N34 孵化，目标房间为 N1。

### 2. 修改队伍行为

```bash
# 移动指挥旗改变目标位置
# 修改旗帜颜色改变索敌模式/行动模式
```

### 3. 手动解散队伍

```bash
# 移除孵化旗
# 移除指挥旗（可选）
```

---

## 注意事项

1. **Boost 成本**：确保孵化房间有足够的 Boost 资源
2. **终端支持**：跨房间孵化需要终端支持
3. **能量保障**：确保孵化房间有足够的能量
4. **房间控制**：确保目标房间和途经房间的控制权
