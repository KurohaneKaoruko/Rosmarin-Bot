/**
 * rush 经济核心常量（口径 1:1 对齐移植来源，调参需单独记录）。
 */

/** 任务类型枚举：数组顺序即默认优先级（越小越优先），孵化优先级公式的第一分量 */
export const TASK_TYPES = [
    'test',
    'logistics',
    'ownedSources',
    'defense',
    'preventDowngrade',
    'defenseRemote',
    'scout',
    'build',
    'defenseNuke',
    'repairRamparts',
    'occupy',
    'claim',
    'unclaim',
    'siege',
    'quad',
    'duo',
    'quadOccupy',
    'totalWar',
    'squad',
    'suppressRoom',
    'suppressTotal',
    'harass',
    'stronghold',
    'ownedMineral',
    'remoteMineral',
    'powerBankDuo',
    'powerBank',
    'putScore',
    'deliverEnergy',
    'loot',
    'scoreHunting',
    'dig',
    'digger',
    'cleanUp',
    'jumpClaim',
    'upgradePreference',
    'remoteSources',
    'upgrade',
] as const;

export type RushTaskType = typeof TASK_TYPES[number];

/** 任务类型 → 默认优先级（枚举序） */
export const TASK_PRIORITY: Record<string, number> = TASK_TYPES.reduce(
    (prev, curr, index) => { prev[curr] = index; return prev; },
    {} as Record<string, number>,
);

export const TASK_TYPE_SET = new Set<string>(TASK_TYPES);

/** 任务类型 → 角色短码表（冲级用子集；战斗/mission 角色待对应系统移植时补充） */
export const ROLES: Record<string, Record<string, string>> = {
    logistics: { distributor: 'd', porter: 'p', courier: 'c' },
    ownedSources: { miner: 'm', hauler: 'h' },
    defense: { defender: 'df', rampartRepairer: 'rr' },
    preventDowngrade: { upgrader: 'u' },
    scout: { scouter: 's' },
    build: { builder: 'b' },
    upgradePreference: { upgrader: 'u' },
    remoteSources: {
        keeperKiller: 'kk',
        coreAttacker: 'ca',
        miner: 'm',
        reserver: 'r',
        sourceRepairer: 'sr',
        sourceBuilder: 'sb',
        hauler: 'h',
    },
    upgrade: { upgrader: 'u' },
};

/** 建造优先级（数组顺序即优先级，越靠前越先建） */
export const BUILD_PRIORITY_ARRAY = [
    STRUCTURE_SPAWN,
    STRUCTURE_TOWER,
    STRUCTURE_TERMINAL,
    STRUCTURE_STORAGE,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_LINK,
    STRUCTURE_ROAD,
    STRUCTURE_RAMPART,
    STRUCTURE_EXTRACTOR,
    STRUCTURE_LAB,
    STRUCTURE_WALL,
    STRUCTURE_OBSERVER,
    STRUCTURE_FACTORY,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_NUKER,
] as const;

export const BUILD_PRIORITY: Record<string, number> = BUILD_PRIORITY_ARRAY.reduce(
    (prev, curr, index) => { prev[curr] = index; return prev; },
    {} as Record<string, number>,
);

/** CPU bucket 闸门（各功能启用门槛） */
export const BUCKET = {
    target: 8000,
    harass: 6000,
    autoAttack: 5000,
    shrinkRemote: 4000,
    scout: 3000,
    collectScore: 2000,
    labReaction: 2000,
    harvestSource: 1000,
};

/** 房间管理器 CPU 超预算熔断线 */
export const CPU_TERMINATE_ROOM_MANAGER = 450;

/** 移动默认参数 */
export const MOVEMENT_DEFAULTS = {
    avoidCreeps: false,
    avoidObstacleStructures: true,
    repathIfStuck: 5,
    reusePath: true,
    roadCost: 1,
    plainCost: 1,
    swampCost: 5,
    findRoute: true,
    maxRooms: 32,
    maxRouteLength: 16,
    maxOpsPerRoom: 5000,
    heuristicWeight: 1.2,
    notifyWhenFailed: true,
    avoidPortals: true,
    allowPortal: true,
};

/** 标准储量（energyLevel 分母口径） */
export const ENERGY_STANDARD: Record<number, number> = {
    1: 10000, 2: 10000, 3: 10000, 4: 20000, 5: 40000, 6: 80000, 7: 160000, 8: 320000,
};

/** 能量水平档位（energyLevel 百分比阈值） */
export const ENERGY_LEVEL = {
    emergency: 30,
    rampartLow: 40,
    emergencyHelp: 50,
    startFunnel: 90,
    upgrade: 100,
    workerFirst: 110,
    moreUpgraders: 120,
    militaryAction: 130,
    rampartHigh: 150,
    processPower: 200,
    receiveEnergy: 250,
    pushEnergy: 350,
};

export const RCL_TO_BUILD_RAMPART = 4;
export const RCL_TO_BUILD_LAB = 6;
export const REPAIR_THRESHOLD = 0.3;
export const MAX_BUILD_POWER = 40;
export const RAMPART_HITS: Record<number, number> = {
    1: 50000, 2: 50000, 3: 100000, 4: 200000, 5: 500000, 6: 1000000, 7: 1500000, 8: 3000000,
};

/** 外矿参数（RCL4 前由阶段门禁开，见 spawnRules） */
export const MAX_REMOTE_ROOM_DISTANCE = 3;
export const MAX_REMOTE_DISTANCE = 200;
export const RESERVATION_TICK_THRESHOLD = 2000;

/** 升级线切 link 供给的火力阈值 */
export const MAX_WORK_TO_PRIORITIZE_CONTROLLER_LINK = 50;
/** 殖民判定容量阈值 */
export const COLONIZED_ENERGY_CAPACITY_THRESHOLD = 550;
/** 建造检查周期（= creep 寿命） */
export const INTERVAL_CONSTRUCT = 1500;

/** 管理器返回码 */
export const RETURN = { COMPLETE: 0, ONGOING: -1, FAIL: -2 } as const;

/** 分段参考节奏（历史校准锚，仅用于移植逻辑的超时对照；冲级目标表见 Thresholds.RUSH） */
export const PACE_STANDARD: Record<number, number> = {
    2: 300, 3: 7000, 4: 18000, 5: 45000, 6: 90000, 7: 165000, 8: 400000,
};

/** 八向邻格向量（与游戏方向常量顺序一致） */
export const EIGHT_DELTA = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];
