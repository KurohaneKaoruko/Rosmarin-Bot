/**
 * MoveOptimization 模块类型定义
 */

// 路径位置信息
interface PathPosition {
    x: number;
    y: number;
    roomName: string;
}

// 路径方向数组
interface DirectionArray {
    [idx: number]: DirectionConstant | undefined;
}

// 完整路径结构
interface MyPath {
    start: { x: number; y: number };
    end: { x: number; y: number };
    posArray: RoomPosition[];
    directionArray?: DirectionArray;
    ignoreRoads: boolean;
    ignoreStructures: boolean;
    ignoreSwamps: boolean;
    lastTime?: number;
}

// 路径数组（按 endKey 组织）
interface PathArray {
    [combinedY: number]: MyPath[];
}

// 全局路径缓存（按 startKey -> endKey -> paths 组织）
interface GlobalPathCache {
    [combinedX: number]: PathArray;
}

// 房间起点索引
interface RoomStartRefs {
    [combinedX: number]: number;
}

// 房间终点索引
interface RoomEndRefs {
    [combinedY: number]: number;
}

// 路径计时器
interface MoveTimer {
    [tick: number]: MyPath[];
}

// Creep 路径缓存
interface CreepPathCache {
    path?: MyPath;
    idx?: number;
    dst?: RoomPosition;
}

// Creep 路径缓存字典
interface CreepPaths {
    [creepName: string]: CreepPathCache;
}

// CostMatrix 缓存项
interface CostMatrixItem {
    roomName: string;
    true: any;
    false: any;
}

// CostMatrix 缓存
interface CMs {
    [roomName: string]: CostMatrixItem;
}

// CostMatrix 版本号
interface CostMatrixRevision {
    [roomName: string]: number;
}

// 路径缓存计时器
interface CostMatrixCacheTimer {
    [tick: number]: Array<{
        roomName: string;
        avoids: string[];
    }>;
}

// 终点索引 - 起点索引引用
interface EndKeyStartKeyRefs {
    [endKey: number]: {
        [startKey: number]: number;
    };
}

// 房间终点索引引用
interface RoomEndKeyRefs {
    [roomName: string]: RoomEndRefs;
}

// 房间起点索引引用
interface RoomStartKeyRefs {
    [roomName: string]: RoomStartRefs;
}

// Observer 任务队列项
interface ObTaskQueueItem {
    path: MyPath;
    idx: number;
    roomName: string;
}

// Observer 数据
interface ObserverData {
    id: string;
    roomName: string;
    taskQueue: ObTaskQueueItem[];
}

// 绕过 CostMatrix 重用缓存项
interface BypassCostMatReuseEntry {
    tick: number;
    baseRev: number;
    mat: any;
    changedKeys: number[];
    oldCosts: number[];
}

// 绕过 CostMatrix 重用缓存
interface BypassCostMatReuseCache {
    [key: string]: BypassCostMatReuseEntry;
}

// Squad 派生矩阵缓存
interface SquadDerivedMatCache {
    [key: string]: any;
}

// 路由缓存项
interface RouteCacheEntry {
    tick: number;
    route: any;
}

// 路由缓存
interface RouteCache {
    [key: string]: RouteCacheEntry;
}

// 分析 CPU 统计
interface AnalyzeCPUStats {
    sum: number;
    calls: number;
}

// 分析 CPU
interface AnalyzeCPU {
    move: AnalyzeCPUStats;
    moveTo: AnalyzeCPUStats;
    findClosestByPath: AnalyzeCPUStats;
    [fn: string]: AnalyzeCPUStats;
}

// 导出类型（移除未使用的 Paths）
export type {
    MyPath,
    MoveTimer,
    CreepPaths,
    CMs,
    PathArray,
    GlobalPathCache,
    RoomStartRefs,
    RoomEndRefs,
    RoomStartKeyRefs,
    RoomEndKeyRefs,
    EndKeyStartKeyRefs,
    CostMatrixItem,
    CostMatrixRevision,
    CostMatrixCacheTimer,
    ObserverData,
    ObTaskQueueItem,
    BypassCostMatReuseCache,
    BypassCostMatReuseEntry,
    SquadDerivedMatCache,
    RouteCache,
    RouteCacheEntry,
    AnalyzeCPU,
    AnalyzeCPUStats
};
