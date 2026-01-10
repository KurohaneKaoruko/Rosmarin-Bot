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

interface Memory {
    // ========================================================
    // 系统数据 - System Data
    // ========================================================

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

    // ========================================================
    // 房间控制数据 - Room Control Data
    // ========================================================

    /**
     * 房间控制数据
     * @description 存储每个房间的基本控制配置
     */
    RoomControlData: {
        [roomName: string]: RoomControlMemory;
    };

    /**
     * 建筑控制数据
     * @description 存储每个房间的建筑运行配置，如 Lab、Factory、PowerSpawn 等
     */
    StructControlData: {
        [roomName: string]: StructControlMemory;
    };

    /**
     * 布局数据
     * @description 存储每个房间的建筑布局信息，用于自动建造
     */
    LayoutData: {
        [roomName: string]: LayoutMemory;
    };

    // ========================================================
    // 外矿数据 - Out Mine Data
    // ========================================================

    /**
     * 外矿数据
     * @description 存储每个房间的外矿配置，包括能量矿、中央九房、过道采集等
     */
    OutMineData: {
        [roomName: string]: OutMineMemory;
    };

    // ========================================================
    // 自动化数据 - Auto Data
    // ========================================================

    /**
     * 自动化任务数据
     * @description 存储各种自动化任务的配置
     */
    AutoData: AutoDataMemory;

    // ========================================================
    // 资源管理 - Resource Management
    // ========================================================

    /**
     * 资源管理配置
     * @description 存储每个房间的资源供需阈值，用于跨房间资源调度
     */
    ResourceManage: {
        [roomName: string]: ResourceManageMemory;
    };

    // ========================================================
    // 任务池 - Mission Pools
    // ========================================================

    /**
     * 任务池
     * @description 存储每个房间的任务队列
     */
    MissionPools: {
        [roomName: string]: MissionPoolMemory;
    };
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
     * 底物 Lab A 的 ID
     * @description 存放底物 A 的 Lab 建筑 ID
     */
    labA?: Id<StructureLab>;

    /**
     * 底物 Lab B 的 ID
     * @description 存放底物 B 的 Lab 建筑 ID
     */
    labB?: Id<StructureLab>;

    /**
     * Boost 任务登记
     * @description 动态分配的 boost 任务，key 为 Lab ID
     */
    boostRes?: {
        [labId: string]: {
            /** boost 使用的矿物类型 */
            mineral: ResourceConstant;
            /** 需要的矿物数量 */
            amount: number;
        };
    };

    /**
     * Boost Lab 固定配置
     * @description 固定分配给特定矿物的 Lab，key 为 Lab ID，value 为矿物类型
     * @example
     * ```typescript
     * boostTypes: {
     *     '5f1234567890abcdef': 'XUH2O',  // 该 Lab 固定用于 XUH2O boost
     *     '5f0987654321fedcba': 'XGHO2'   // 该 Lab 固定用于 XGHO2 boost
     * }
     * ```
     */
    boostTypes?: {
        [labId: string]: ResourceConstant;
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
     * 外矿道路数据 (旧格式，兼容用)
     * @deprecated 请使用新格式 RoadData
     * @description 存储到各外矿房间的道路位置
     */
    Road?: {
        [targetRoom: string]: Array<[string, number]>;  // [roomName, compressedXY]
    };

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
 * 单条外矿道路路线（旧格式，保留用于兼容）
 * @deprecated 请使用 OutMineRoadRouteGroup
 */
interface OutMineRoadRoute {
    /**
     * 道路坐标（按房间分组）
     * @description key 为房间名，value 为该房间内的压缩坐标数组
     * @example { "W1N1": [2525, 2526, 2527], "W1N2": [4925, 4924] }
     */
    positions: {
        [roomName: string]: number[];  // 压缩坐标 x*100+y
    };

    /**
     * 路线总长度
     * @description 道路总格子数
     */
    length: number;

    /**
     * 创建时间
     * @description Game.time
     */
    createdAt: number;

    /**
     * 最后检查时间
     * @description 用于道路维护
     */
    lastCheck?: number;

    /**
     * 路线状态
     * @description 'active' 正常, 'pending' 待建造, 'damaged' 需修复
     */
    status?: 'active' | 'pending' | 'damaged';
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
     * GCL 等级
     */
    gcl?: number;

    /**
     * GCL 进度
     */
    gclProgress?: number;

    /**
     * GCL 升级所需进度
     */
    gclProgressTotal?: number;

    /**
     * GPL 等级
     */
    gpl?: number;

    /**
     * GPL 进度
     */
    gplProgress?: number;

    /**
     * GPL 升级所需进度
     */
    gplProgressTotal?: number;

    /**
     * CPU 使用量
     */
    cpu?: number;

    /**
     * CPU Bucket
     */
    bucket?: number;

    /**
     * 信用点数
     */
    credits?: number;

    /**
     * 房间统计数据
     */
    rooms?: {
        [roomName: string]: RoomStatsMemory;
    };

    /**
     * 其他自定义统计数据
     */
    [key: string]: any;
}

/**
 * 房间统计数据
 */
interface RoomStatsMemory {
    /**
     * 控制器等级
     */
    level?: number;

    /**
     * 控制器进度
     */
    progress?: number;

    /**
     * 控制器升级所需进度
     */
    progressTotal?: number;

    /**
     * 能量存储量
     */
    energy?: number;

    /**
     * 其他自定义统计数据
     */
    [key: string]: any;
}



// ============================================================
// 全局类型声明 - Global Type Declarations
// ============================================================

/**
 * 扩展 NodeJS.Global 接口
 * @description 声明全局变量类型
 */
declare namespace NodeJS {
    interface Global {
        /**
         * 外矿道路缓存 (旧格式，兼容用)
         * @deprecated 请使用 OutMineRoadCache
         */
        OutMineRoadPathFinderCosts?: {
            [roomName: string]: CostMatrix;
        };

        /**
         * 外矿道路缓存 (新格式)
         * @description 包含 CostMatrix 缓存、路径缓存、修复队列等
         */
        OutMineRoadCache?: OutMineRoadCache;
    }
}

/**
 * 道路配置类型
 * @description ROAD_CONFIG 常量的类型定义
 */
interface RoadConfigType {
    // 路径计算配置
    ROAD_COST: number;
    PLAIN_COST: number;
    SWAMP_COST: number;
    MAX_OPS: number;
    
    // 缓存配置
    COST_MATRIX_TTL: number;
    PATH_CACHE_TTL: number;
    
    // 建造配置
    BUILD_INTERVAL: number;
    MAX_SITES_PER_ROUTE: number;
    ENERGY_ROAD_MIN_LEVEL: number;
    CENTER_ROAD_MIN_LEVEL: number;
    
    // 维护配置
    HEALTH_CHECK_INTERVAL: number;
    REPAIR_THRESHOLD: number;
    CRITICAL_THRESHOLD: number;
    
    // CPU 保护配置
    CPU_THRESHOLD: number;
    MAX_PATHS_PER_TICK: number;
    
    // 数据格式版本
    DATA_VERSION: number;
}
