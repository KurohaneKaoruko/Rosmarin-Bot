/**
 * Screeps Memory 接口定义
 * 
 * Memory 是 Screeps 游戏中的持久化存储对象，在每个 tick 结束时自动序列化保存。
 * 本文件定义了游戏中使用的所有 Memory 结构。
 * 
 * @see https://docs.screeps.com/global-objects.html#Memory-object
 */

// ============================================================
// 全局 Memory 接口
// ============================================================

/**
 * 核弹打击相关 Memory
 * @description 用于记录核弹落点时间，避免同一房间重复发射
 */
interface NukeMemory {
    /**
     * 目标房间核弹落点时间（Game.time）
     * @description key 为目标房间名，value 为预计落点 tick
     */
    landTime: { [targetRoomName: string]: number };

    requests?: NukeRequest[];
}

type NukerDataMemory = NukeMemory;

interface NukeRequest {
    id: string;
    roomName: string;
    x: number;
    y: number;
    amount: number;
    rooms?: string[];
    createdTick: number;
    ttl: number;
    flagName?: string;
    lastError?: number;
    lastErrorTick?: number;
}

interface BotMemory {
    MissionPools: { [roomName: string]: MissionPoolMemory };
    RoomData: { [roomName: string]: RoomControlMemory };
    StructData: { [roomName: string]: StructControlMemory };
    LayoutData: { [roomName: string]: LayoutMemory };
    OutMineData: { [roomName: string]: OutMineMemory };
    AutoData: AutoDataMemory;
    ResourceManage: { [roomName: string]: ResourceManageMemory };
    TeamData: Record<string, any>;
    TeamSpawnQueue: Record<string, any>;
    NukerData: NukerDataMemory;
}

interface Memory {
    // ========================================================
    // 系统数据 - System Data
    // ========================================================

    /**
     * 上次初始化时间
     * @description 记录上次游戏初始化完成的时间，用于判断是否需要重新初始化
     */
    lastinit: number;
    
    /**
     * 统计数据
     * @description 用于存储游戏运行的各种统计信息，如 CPU 使用、GCL 进度等
     */
    stats: StatsMemory;

    /**
     * 白名单
     * @description 存储友好玩家的用户名列表，白名单中的玩家不会被攻击
     * @example
     * ```typescript
     * Memory['whitelist'] = ['player1', 'player2'];
     * if (Memory['whitelist'].includes(creep.owner.username)) {
     *     // 友方单位，不攻击
     * }
     * ```
     */
    whitelist: string[];

    /**
     * 战争模式开关
     * @description 开启后会暂停部分非战斗功能以节省 CPU
     * - 暂停 Lab 合成
     * - 暂停 Factory 生产
     * - 暂停 PowerSpawn 处理
     * - 暂停外矿采集
     * - 暂停自动建筑
     */
    warmode: boolean;

    /**
     * Bot数据
     * @description 存储改bot运行时的数据，包括任务队列、资源管理等
     */
    RosmarinBot: BotMemory;
}

/**
 * 房间能量状态
 * @description 用于恢复期/日常期的策略切换（孵化体型、任务优先级等）
 */
type EnergyState = 'CRITICAL' | 'LOW' | 'NORMAL' | 'SURPLUS';

interface RoomMemory {
    /**
     * 房间能量状态（由房间逻辑更新）
     * @description 实际实现会做间隔刷新（避免频繁统计），恢复期会更频繁
     */
    energyState?: EnergyState;
    /**
     * 能量状态最近一次更新时间（Game.time）
     */
    energyStateTick?: number;
    /**
     * 建议保留的最低能量储备（用于保证关键孵化/回填链路）
     */
    energyReserve?: number;
}

// ============================================================
// 房间控制配置 - Room Control Memory
// ============================================================

/**
 * 房间控制配置
 * @description 单个房间的基本控制参数
 */
interface RoomControlMemory {
    /**
     * 运行模式
     * @description 控制房间的运行状态
     * - 'main': 正常运行模式
     * - 'low': 低功耗模式，减少 CPU 消耗
     * - 'stop': 停止模式，暂停大部分功能
     */
    mode: 'main' | 'low' | 'stop';

    /**
     * 布局类型
     * @description 房间使用的建筑布局方案名称
     */
    layout: string;

    /**
     * 布局中心坐标
     * @description 布局的中心点位置，用于计算建筑相对位置
     */
    center: {
        x: number;
        y: number;
    };

    /**
     * 控制器签名
     * @description 自定义的控制器签名文本
     */
    sign?: string;

    /**
     * 自动建筑开关
     * @description 是否启用自动建造功能
     * @default false
     */
    autobuild?: boolean;

    /**
     * Power 采集开关
     * @description 是否启用过道 PowerBank 采集
     * @default false
     */
    outminePower?: boolean;

    /**
     * Deposit 采集开关
     * @description 是否启用过道 Deposit 采集
     * @default false
     */
    outmineDeposit?: boolean;
}

// ============================================================
// 建筑控制配置 - Structure Control Memory
// ============================================================

/**
 * 建筑控制配置
 * @description 单个房间的建筑运行参数
 */
interface StructControlMemory {
    // --------------------------------------------------------
    // PowerSpawn 配置
    // --------------------------------------------------------

    /**
     * PowerSpawn 开关
     * @description 是否启用 PowerSpawn 处理 Power
     */
    powerSpawn?: boolean;

    /**
     * PowerSpawn 模式
     * @description 控制自动化是否允许改写 powerSpawn 开关
     * - 'auto': 由自动化模块根据阈值决定开关
     * - 'manual': 手动开关
     */
    powerSpawnMode?: 'auto' | 'manual';

    // --------------------------------------------------------
    // Factory 配置
    // --------------------------------------------------------

    /**
     * Factory 开关
     * @description 是否启用 Factory 生产
     */
    factory?: boolean;

    /**
     * Factory 等级
     * @description 工厂的生产等级 (0-5)，决定可生产的商品类型
     */
    factoryLevel?: number;

    /**
     * 当前生产任务
     * @description 正在生产的商品类型
     */
    factoryProduct?: ResourceConstant;

    /**
     * 生产任务限额
     * @description 生产数量上限，达到后停止生产
     */
    factoryAmount?: number;

    // --------------------------------------------------------
    // Lab 配置
    // --------------------------------------------------------

    /**
     * Lab 开关
     * @description 是否启用 Lab 合成
     */
    lab?: boolean;

    /**
     * 合成任务限额
     * @description 合成数量上限，达到后停止合成
     */
    labAmount?: number;

    /**
     * 底物 A 类型
     * @description Lab 合成反应的第一种底物
     */
    labAtype?: ResourceConstant;

    /**
     * 底物 B 类型
     * @description Lab 合成反应的第二种底物
     */
    labBtype?: ResourceConstant;

    /**
     * 底物 Lab A 的坐标（压缩）
     * @description 存放底物 A 的 Lab 坐标，使用 compress(x,y) 压缩后的 number
     */
    labA?: number | Id<StructureLab>;

    /**
     * 底物 Lab B 的坐标（压缩）
     * @description 存放底物 B 的 Lab 坐标，使用 compress(x,y) 压缩后的 number
     */
    labB?: number | Id<StructureLab>;

    boostLabs?: {
        [labId: string]: {
            mineral: ResourceConstant;
            mode: 'task' | 'fixed';
        };
    };

    /**
     * 城墙/Rampart 耐久度阈值
     * @description 修复城墙时的目标耐久度比例 (0-1)
     * @default 0.9
     */
    ram_threshold?: number;
}

// ============================================================
// 布局数据 - Layout Memory
// ============================================================

/**
 * 布局数据
 * @description 存储房间的建筑位置信息，用于自动建造
 */
interface LayoutMemory {
    /**
     * 建筑位置映射
     * @description key 为建筑类型，value 为压缩后的坐标数组
     * @example
     * ```typescript
     * {
     *     'spawn': [2525, 2627],      // spawn 的位置
     *     'extension': [2324, 2425],  // extension 的位置
     *     'road': [2223, 2324, 2425]  // road 的位置
     * }
     * ```
     */
    [structureType: string]: number[];
}

// ============================================================
// 外矿数据 - Out Mine Memory
// ============================================================

/**
 * 外矿数据
 * @description 存储房间的外矿采集配置
 */
interface OutMineMemory {
    /**
     * 能量外矿房间列表
     * @description 需要采集能量的外矿房间名称数组
     */
    energy?: string[];

    /**
     * 中央九房列表
     * @description 需要采集的中央九房（带 Source Keeper）房间名称数组
     */
    centerRoom?: string[];

    /**
     * 过道监控列表
     * @description 需要监控 PowerBank 和 Deposit 的过道房间名称数组
     */
    highway?: string[];

    /**
     * 外矿道路数据 (新格式)
     * @description 按房间分组存储道路位置，减少冗余
     */
    RoadData?: OutMineRoadMemory;

    /**
     * 道路数据版本
     * @description 用于判断是否需要迁移数据格式
     */
    RoadVersion?: number;
}

/**
 * 外矿道路内存格式 (新格式)
 * @description 按目标位置分组存储道路坐标
 */
interface OutMineRoadMemory {
    /**
     * 路线数据
     * @description key 为目标房间名，value 为该房间内各目标的路线信息
     */
    routes: {
        [targetRoom: string]: OutMineRoadRouteGroup;
    };

    /**
     * 最后更新时间
     * @description 用于判断数据是否过期
     */
    lastUpdate?: number;
}

/**
 * 目标房间的路线组
 * @description 存储到单个目标房间内所有目标的道路信息
 */
interface OutMineRoadRouteGroup {
    /**
     * 各目标的独立路径
     * @description key 为目标位置 "x:y"，value 为该目标的路径
     */
    paths: {
        [targetPos: string]: OutMineRoadPath;
    };

    /**
     * 创建时间
     */
    createdAt: number;

    /**
     * 路线状态
     */
    status?: 'active' | 'pending' | 'damaged';

    /**
     * 最后检查时间
     */
    lastCheck?: number;
}

/**
 * 单个目标的道路路径
 * @description 存储从主房间到单个目标的完整路径（保持顺序）
 */
interface OutMineRoadPath {
    /**
     * 路径坐标（按顺序存储）
     * @description 每个元素为 [roomName, compressedCoord]，保持路径顺序
     */
    path: Array<[string, number]>;

    /**
     * 路径长度
     */
    length: number;
}

/**
 * 外矿道路缓存（全局）
 * @description 存储在 global 对象中的缓存数据
 */
interface OutMineRoadCache {
    /**
     * CostMatrix 缓存
     * @description key 为房间名
     */
    costMatrix: {
        [roomName: string]: {
            /** 缓存的 CostMatrix */
            matrix: CostMatrix;
            /** 创建时间 (Game.time) */
            createdAt: number;
            /** 过期时间 (ticks) */
            ttl: number;
        };
    };

    /**
     * 路径计算结果缓存
     * @description 临时缓存，用于同一 tick 内复用
     */
    pathCache?: {
        [key: string]: RoomPosition[];  // key: `${homeRoom}-${targetRoom}`
    };

    /**
     * 修复队列
     * @description 需要修复的道路位置
     */
    repairQueue?: {
        [homeRoom: string]: Array<{
            pos: RoomPosition;
            priority: number;
        }>;
    };
}

// ============================================================
// 自动化数据 - Auto Data Memory
// ============================================================

/**
 * 自动化任务数据
 * @description 存储各种自动化任务的配置
 */
interface AutoDataMemory {
    /**
     * 自动交易配置
     * @description 每个房间的自动市场交易任务列表
     */
    AutoMarketData: {
        [roomName: string]: AutoMarketTask[];
    };

    /**
     * 自动 Lab 合成配置
     * @description 每个房间的自动合成任务，key 为产物类型，value 为数量限制
     * @example
     * ```typescript
     * {
     *     'W1N1': {
     *         'XUH2O': 30000,  // 自动合成 XUH2O，上限 30000
     *         'XGHO2': 20000   // 自动合成 XGHO2，上限 20000
     *     }
     * }
     * ```
     */
    AutoLabData: {
        [roomName: string]: {
            [product: string]: number;
        };
    };

    /**
     * 自动 Factory 生产配置
     * @description 每个房间的自动生产任务，key 为产物类型，value 为数量限制
     */
    AutoFactoryData: {
        [roomName: string]: {
            [product: string]: number;
        };
    };

    /**
     * 自动 PowerSpawn 配置
     * @description 每个房间的 PowerSpawn 自动处理配置
     */
    AutoPowerData: {
        [roomName: string]: {
            /** 能量阈值，低于此值停止处理 */
            energy?: number;
            /** Power 阈值，低于此值停止处理 */
            power?: number;
        };
    };
}

/**
 * 自动交易任务
 * @description 单个自动交易任务的配置
 */
interface AutoMarketTask {
    /**
     * 资源类型
     */
    resourceType: ResourceConstant;

    /**
     * 交易数量
     */
    amount: number;

    /**
     * 订单类型
     * - 'buy': 创建买单
     * - 'sell': 创建卖单
     * - 'dealbuy': 自动成交买单
     * - 'dealsell': 自动成交卖单
     */
    orderType: 'buy' | 'sell' | 'dealbuy' | 'dealsell';

    /**
     * 价格
     * @description 创建订单时的价格，或成交时的价格上限/下限
     */
    price?: number;
}

// ============================================================
// 资源管理配置 - Resource Manage Memory
// ============================================================

/**
 * 资源管理配置
 * @description 单个房间的资源供需阈值配置
 */
interface ResourceManageMemory {
    /**
     * 资源供需阈值
     * @description key 为资源类型，value 为 [需求阈值, 供应阈值]
     * - 需求阈值: 低于此值时从其他房间请求资源
     * - 供应阈值: 高于此值时向其他房间提供资源
     * @example
     * ```typescript
     * {
     *     'energy': [100000, 500000],  // 能量低于10万请求，高于50万供应
     *     'XUH2O': [3000, 10000]       // XUH2O 低于3000请求，高于10000供应
     * }
     * ```
     */
    [resourceType: string]: [number, number];
}

// ============================================================
// 任务池 - Mission Pool Memory
// ============================================================

/**
 * 任务池
 * @description 存储房间的各类任务队列
 */
interface MissionPoolMemory {
    /**
     * 任务列表
     * @description key 为任务类型，value 为任务数组
     */
    [missionType: string]: Task[];
}

// ============================================================
// 统计数据 - Stats Memory
// ============================================================

/**
 * 统计数据
 * @description 游戏运行的各种统计信息
 */
interface StatsMemory {
    /**
     * 上一次GPLGCL统计的时间戳
     */
    GCLGPLprevTimestamp?: number;
    /**
     * 上一次房间升级统计时间戳
     */
    RoomPrevTimestamp?: number;
    
    /**
     * GCL 进度百分比
     */
    gcl?: number;

    /**
     * GCL 等级
     */
    gclLevel?: number;

    /**
     * GCL 进度
     */
    gclProgress?: number;

    /**
     * GCL 升级所需进度
     */
    gclProgressTotal?: number;

    /**
     * GCL 升级所需tick数
     */
    gclUpTick?: number;
    /**
     * GCL 升级所需时间
     */
    gclUpTime?: number;

    /**
     * GPL 进度百分比
     */
    gpl?: number;
    /**
     * GPL 等级
     */
    gplLevel?: number;
    /**
     * GPL 进度
     */
    gplProgress?: number;

    /**
     * GPL 升级所需进度
     */
    gplProgressTotal?: number;
    /**
     * GPL 升级所需tick数
     */
    gplUpTick?: number;
    /**
     * GPL 升级所需时间
     */
    gplUpTime?: number;

    /**
     * CPU 使用量
     */
    cpu?: number;

    /**
     * CPU Bucket
     */
    bucket?: number;

    /**
     * CPU 平均值统计累加器
     * @description total 为窗口内 CPU 累计使用量，count 为采样 tick 数
     */
    cpuUsed?: {
        total: number;
        count: number;
    };

    /**
     * CPU 平均使用量
     * @description 基于 cpuUsed 的统计窗口计算（CPU 点数 / tick）
     */
    AvgCpuUsed?: number;

    /**
     * 房间 RCL 等级
     * @description key 为房间名
     */
    rclLevel?: Record<string, number>;

    /**
     * 房间 RCL 升级进度百分比
     * @description key 为房间名，范围 0-100（RCL8 为 0）
     */
    rclProgress?: Record<string, number>;

    /**
     * 房间 RCL 预计升级剩余时间
     * @description key 为房间名，单位秒
     */
    rclUpTime?: Record<string, number>;
    /**
     * RCL 升级所需tick数
     */
    rclUpTick?: Record<string, number>;

    /**
     * 房间上次记录的 RCL 进度值
     * @description key 为房间名，用于计算本周期 progress 增量
     */
    lastRclProgress?: Record<string, number>;

    /**
     * 上一次房间升级统计时间戳
     * @deprecated 历史遗留字段，请使用 RoomPrevTimestamp
     */
    lastUpgradeTimestamp?: number;

    /**
     * 房间能量储备
     * @description storage + terminal 的总能量，key 为房间名
     */
    energy?: Record<string, number>;

    /**
     * 上一次统计周期的房间能量储备快照
     * @description key 为房间名
     */
    energyHistory?: Record<string, number>;

    /**
     * 房间能量储备增量
     * @description energy - energyHistory，key 为房间名
     */
    energyRise?: Record<string, number>;

    /**
     * 房间能量容量
     * @description room.energyCapacityAvailable，key 为房间名
     */
    SpawnEnergy?: Record<string, number>;

    /**
     * 当前市场 credits
     */
    credit?: number;

    /**
     * 统计周期内 credits 变动量
     */
    creditChanges?: number;

    /**
     * 上一次统计周期记录的 credits
     */
    lastCredit?: number;

    /**
     * 能量前十求购均价
     */
    energyAveragePrice?: number;

    /**
     * 能量前十出售均价
     */
    energyAverageSellPrice?: number;

    /**
     * 各角色 creep 数量统计
     * @description key 为 role
     */
    creeps?: Record<string, number>;

    /**
     * creep 总数
     */
    creepCount?: number;
}
