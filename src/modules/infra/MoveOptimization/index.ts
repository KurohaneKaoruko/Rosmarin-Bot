import {
    buildPathVariantKey,
    buildPathVariantKeyFromPath,
    buildPathVariantKeyFromQuery,
    formalize,
    formalizeIntentMovePos,
    formalizeIntentPos,
    geometryCaches,
    getAdjacents,
    getClosestExitPos,
    getDirection,
    hasActiveBodypart,
    inRange,
    isEqual,
    isHighWay,
    isNear,
    isNearExitDirection,
    isSameOps,
    packIntentTile,
    parseRoomName,
    parseShardRoomName,
    tile2Pos,
} from './geometry';
import { buildObstacleMap, isClosedRampart, isObstacleStructure as rawIsObstacleStructure } from './obstacles';
import { clearObjectKeys, createCleanupModule } from './cleanup';
import { createPortalModule } from './portals';
import { createAvoidSyncModule } from './avoidSync';
import { PathingModuleApi, PathingService } from './pathing';
import { MovementModuleApi, MovementService } from './movement';
import { installDontPullMePolicies, updateDontPullMeForMoveTo, wrapProtoMethod } from './dontPullMe';
import { createIntentSolverModule } from './intentSolver';
import { createBetterMoveGlobalApi, createMoveRuntimeControlModule } from './controls';
import { RoadMemory } from '@/modules/feature/externalRoad';
import { decompress } from '@/modules/utils/compress';
import type {
    BetterMoveConfig,
    BetterMoveEndKeyPathRefCounts,
    BetterMoveObserverRuntime,
    BetterMoveObserverTask,
    BetterMovePath,
    BetterMovePathCache,
    BetterMovePathInsertToken,
    BetterMovePathVariantCache,
    BetterMoveRoomCounterMap,
    BetterMoveRoomPathRefCounts,
    BetterMoveSameRoomPathRefs,
} from './types';

/*
creep对穿+跨房间寻路+寻路缓存 
应用此模块会导致creep.moveTo可选参数中这些项失效：
reusePath、serializeMemory、noPathFinding、ignore、avoid、serialize
*/

// ============================================================================
// 1) 模块配置与运行时开关
// ============================================================================
// 初始化参数
let config: BetterMoveConfig = {
    changeMove: true,   // 为creep.move增加对穿能力
    changeMoveTo: true, // 为 creep.moveTo 提供统一跨房寻路入口
    changeFindClostestByPath: true,     // 轻度修改findClosestByPath，使得默认按照ignoreCreeps寻找最短
    autoVisual: false,  // 自动绘制路径
    enableCpuStats: false, // enable internal CPU statistics
    enableCacheStats: false, // enable route/path cache runtime statistics
    enableFlee: true,   // 是否启用 flee
    enableSquadPath: true, // 是否启用 findSquadPathTo
    enableRouteCache: true, // 是否启用寻路缓存
    routeCacheTTL: 200,     // 寻路缓存过期时间，设为undefined表示不清除缓存
    routeCacheMaxEntries: 4000, // 非 bypass route cache 的最大条目数，达到上限后停止新增键
    routeCacheMaxNewPerTick: 200, // 每 tick 最多写入多少个新的非 bypass route cache 键
    enableBypassCostMatReuse: true,  // 是否启用绕过房间的costMatrix缓存
    enableSameRoomDetourCooldown: true, // 同房目标发生“绕房又回房”后短暂收敛到 maxRooms=1，避免反复进出房间
    sameRoomDetourCooldownTTL: 15, // 冷却 tick 数（只影响未显式传 maxRooms 的调用）
    enableRoomBounceGuardV2: true, // 跨房 A->B->A 抖动抑制
    roomBounceWindow: 20, // 识别 bounce 的时间窗口
    roomBounceTTL: 100, // 识别到 bounce 后封禁该跨房方向的时长
    enableSameRoomDetourCooldownV2: true, // 同房目标绕出再回时，临时收敛 maxRooms
    sameRoomDetourBounceWindow: 20, // 识别“绕出再回”的时间窗口
    enableSameRoomEdgePenalty: true, // 同房寻路时提高房间边缘代价，避免无意义出图绕路
    sameRoomEdgePenaltyCost: 20, // 同房寻路边缘惩罚代价（必须小于 255）
    enableTemporalBypassRefine: true, // 堵路时临时绕路策略开关
    temporalAvoidExitCheckTTL: 1, // 临时出口可达性检测缓存时长（tick）
    temporalBypassRetryMinTicks: 2, // 临时绕路失败后的最小重试间隔
    temporalBypassRetryMaxTicks: 6, // 临时绕路失败后的最大重试间隔（线性退避上限）
    pathCacheMaxEntries: 12000, // 全局路径缓存上限，超过后按插入顺序增量淘汰
    pathCacheTrimBatch: 64, // 单次写入后最多淘汰多少条，避免抖动
    enableObserverQueueRefine: true, // Observer 任务队列策略开关
    observerTaskTTL: 12 // Observer 任务过期时长（tick）
}
// 运行时参数 
let pathClearDelay = 3000;  // 清理相应时间内都未被再次使用的路径，同时清理死亡creep的缓存，设为undefined表示不清除缓存
let hostileCostMatrixClearDelay = 500; // 自动清理相应时间前创建的其他玩家房间的costMatrix
let coreLayoutRange = 3; // 核心布局半径，在离storage这个范围内频繁检查对穿（减少堵路的等待
let cacheStatsEnabled = false;
let avoidRooms: Record<string, 1> = {}; // 永不踏入这些房间
let syncedBypassRooms: Record<string, 1> = Object.create(null);
let avoidRoomsVersion = 0;
let avoidRoomsSyncTick = -1;
let avoidRoomsMemorySignature = '';
let avoidRoomsMemoryInitialized = false;
function markAvoidRoomsChanged() {
    avoidRoomsVersion = (avoidRoomsVersion + 1) | 0;
}
let avoidExits = Object.create(null);   // directional room-exit bans: never step from fromRoom to toRoom
let avoidExitsVersion = 0;
function markAvoidExitsChanged() {
    avoidExitsVersion = (avoidExitsVersion + 1) | 0;
}
let currentAvoidRooms = null;
let currentAvoidExits = null;

function isValidAvoidExitsMap(candidate) {
    if (!(candidate instanceof Map)) {
        return false;
    }
    for (const blockedRooms of candidate.values()) {
        if (!(blockedRooms instanceof Set)) {
            return false;
        }
    }
    return true;
}

function hasNonEmptyAvoidExits(candidate) {
    if (!(candidate instanceof Map)) {
        return false;
    }
    for (const blockedRooms of candidate.values()) {
        if (blockedRooms && blockedRooms.size) {
            return true;
        }
    }
    return false;
}

function hasScopedAvoids(ops) {
    return !!(
        ops &&
        (
            (ops.avoidRooms instanceof Set && ops.avoidRooms.size > 0) ||
            hasNonEmptyAvoidExits(ops.avoidExits)
        )
    );
}

function validateMoveToArgTypes(ops: MoveToOpts | object | null | undefined): ops is MoveToOpts {
    if (!ops || typeof ops !== 'object') {
        return false;
    }
    const candidate = ops as MoveToOpts;
    if (candidate.range !== undefined && typeof candidate.range !== 'number') {
        return false;
    }
    if (candidate.bypassRange !== undefined && typeof candidate.bypassRange !== 'number') {
        return false;
    }
    if (candidate.avoidRooms !== undefined && !(candidate.avoidRooms instanceof Set)) {
        return false;
    }
    if (candidate.avoidExits !== undefined && !isValidAvoidExitsMap(candidate.avoidExits)) {
        return false;
    }
    return true;
}

function getScopedAvoidSignature(ops) {
    if (!hasScopedAvoids(ops)) {
        return '';
    }
    const roomSignature = ops.avoidRooms instanceof Set && ops.avoidRooms.size
        ? Array.from(ops.avoidRooms).sort().join(',')
        : '';
    let exitSignature = '';
    if (hasNonEmptyAvoidExits(ops.avoidExits)) {
        exitSignature = Array.from(ops.avoidExits.entries())
            .map(([fromRoomName, blockedRooms]) => `${fromRoomName}>${Array.from(blockedRooms).sort().join(',')}`)
            .sort()
            .join(';');
    }
    return `${roomSignature}|${exitSignature}`;
}

function isRoomAvoided(roomName) {
    if (currentAvoidRooms instanceof Set) {
        return currentAvoidRooms.has(roomName);
    }
    return roomName in avoidRooms;
}

function isExitAvoided(fromRoomName, toRoomName) {
    if (!fromRoomName || !toRoomName) {
        return false;
    }
    if (currentAvoidExits instanceof Map) {
        const blockedRooms = currentAvoidExits.get(fromRoomName);
        return !!(blockedRooms && blockedRooms.has(toRoomName));
    }
    return !!(avoidExits[fromRoomName] && avoidExits[fromRoomName][toRoomName]);
}

function withScopedAvoids(ops, fn) {
    const previousAvoidRooms = currentAvoidRooms;
    const previousAvoidExits = currentAvoidExits;
    currentAvoidRooms = ops?.avoidRooms instanceof Set && ops.avoidRooms.size ? ops.avoidRooms : null;
    currentAvoidExits = hasNonEmptyAvoidExits(ops?.avoidExits) ? ops.avoidExits : null;
    try {
        return fn();
    } finally {
        currentAvoidRooms = previousAvoidRooms;
        currentAvoidExits = previousAvoidExits;
    }
}

function getCurrentAvoidScopeSignature() {
    if (!(currentAvoidRooms instanceof Set) && !(currentAvoidExits instanceof Map)) {
        return '';
    }
    return getScopedAvoidSignature({
        avoidRooms: currentAvoidRooms,
        avoidExits: currentAvoidExits
    });
}
let observers: BetterMoveObserverRuntime[] = [];  // 如果想用ob寻路，把ob的id放这里
let autoDiscoverObserverTick = -1;

let pathVersionCounter = 0;
function ensurePathVersion(path) {
    if (!path || typeof path !== 'object') return 0;
    const current = path._bmVersion | 0;
    if (current > 0) return current;
    pathVersionCounter = ((pathVersionCounter + 1) | 0) || 1;
    path._bmVersion = pathVersionCounter;
    return path._bmVersion;
}

// ============================================================================
// 2) Portal 注册表与跨 shard 入口选择
// ============================================================================
const { getPortalRegistry, scanPortals, pickPortalToShard, resetPortalScanState } = createPortalModule();

// ============================================================================
// 3) 按需懒刷新：avoidRooms / observers（同 tick 去重）
// ============================================================================
export const {
    syncAvoidRooms,
    ensureAvoidRoomsUpToDate,
    autoDiscoverObservers,
    bmGetAvoidRoomsMap,
    bmGetAvoidExitsMap,
    bmAddAvoidRooms,
    bmDeleteAvoidRooms,
    bmClearAvoidExits,
    bmAddAvoidExits,
    bmDeleteAvoidExits,
} = createAvoidSyncModule({
    observers,
    avoidRooms,
    avoidExits,
    syncedBypassRooms,
    parseRoomName,
    markAvoidRoomsChanged,
    markAvoidExitsChanged,
    getAvoidRoomsSyncTick() {
        return avoidRoomsSyncTick;
    },
    setAvoidRoomsSyncTick(value) {
        avoidRoomsSyncTick = value;
    },
    getAvoidRoomsMemorySignature() {
        return avoidRoomsMemorySignature;
    },
    setAvoidRoomsMemorySignature(value) {
        avoidRoomsMemorySignature = value;
    },
    getAvoidRoomsMemoryInitialized() {
        return avoidRoomsMemoryInitialized;
    },
    setAvoidRoomsMemoryInitialized(value) {
        avoidRoomsMemoryInitialized = value;
    },
});

function ensureObserversUpToDate() {
    if (autoDiscoverObserverTick === Game.time) {
        return;
    }
    autoDiscoverObserverTick = Game.time;
    autoDiscoverObservers();
}

// ============================================================================
// 4) 全局缓存与运行时状态
// ============================================================================
// 4.1 Observer 异步任务结果缓存
let obTimer: Record<number, BetterMoveObserverTask[]> = Object.create(null);   // observer async results keyed by due tick
let obTimerDueQueue = createDueTickQueue();
let obTick = Game.time;

// 4.2 路径缓存与反向索引
/** @type {Paths} */
let globalPathCache: BetterMovePathCache = Object.create(null);     // 缓存path
let globalPathCacheByVariant: BetterMovePathVariantCache = Object.create(null); // startKey -> variantKey -> combinedY -> path[]
let globalPathCacheBucketCount = 0; // startKey bucket 数量（globalPathCache 的一级 key 数），用于估算全表遍历规模
let globalPathCachePathCount = 0; // 当前缓存路径总数，空时可快速退出清理逻辑
let pathCacheInsertQueue: BetterMovePathInsertToken[] = [];
let pathCacheInsertHead = 0;
let roomSameRoomPathRefs: BetterMoveSameRoomPathRefs = Object.create(null); // roomName -> { pathVersion: path }，仅记录同房路径
let roomSameRoomPathCount: BetterMoveRoomCounterMap = Object.create(null); // roomName -> 同房路径条数
let roomStartKeyRefs: BetterMoveRoomPathRefCounts = Object.create(null); // roomName -> { startKey: refCount }，同房路径的起点引用计数
let roomStartKeyCount: BetterMoveRoomCounterMap = Object.create(null); // roomName -> startKey 数量，用于比较“按房间索引遍历”与“全表遍历”成本
let endKeyStartKeyRefs: BetterMoveEndKeyPathRefCounts = Object.create(null); // endKey -> { startKey: refCount }，用于从终点范围反向定位可能的 startKey 桶
let roomEndKeyRefs: BetterMoveRoomPathRefCounts = Object.create(null); // roomName -> { endKey: refCount }，同房路径的终点引用计数
let roomEndKeyCount: BetterMoveRoomCounterMap = Object.create(null); // roomName -> endKey 数量，用于评估 endKey 索引遍历成本
/** @type {MoveTimer} */
let pathCacheTimer = Object.create(null); // 用于记录path被使用的时间，清理长期未被使用的path
let pathCacheTimerDueQueue = createDueTickQueue();
/** @type {CreepPaths} */
let creepPathCache = Object.create(null);    // 缓存每个creep使用path的情况
let creepMoveCache = Object.create(null);    // 缓存每个creep最后一次移动的tick
let emptyCostMatrix = new PathFinder.CostMatrix;
/** @type {CMs} */
let costMatrixCache = Object.create(null);    // true存ignoreDestructibleStructures==true的，false同理
let costMatrixRevision = Object.create(null);
let sameRoomEdgeCostMatCache = Object.create(null); // 同房寻路边缘惩罚矩阵缓存
/** @type {{ [time: number]:{roomName:string, avoids:string[]}[] }} */
let costMatrixCacheTimer = Object.create(null); // 用于记录costMatrix的创建时间，清理过期costMatrix
let costMatrixCacheTimerDueQueue = createDueTickQueue();

type MoveOptRuntimeCache = {
    globalPathCache: typeof globalPathCache;
    globalPathCacheByVariant: typeof globalPathCacheByVariant;
    roomSameRoomPathRefs: typeof roomSameRoomPathRefs;
    pathCacheTimer: typeof pathCacheTimer;
    creepPathCache: typeof creepPathCache;
    creepMoveCache: typeof creepMoveCache;
    costMatrixCache: typeof costMatrixCache;
    costMatrixRevision: typeof costMatrixRevision;
    costMatrixCacheTimer: typeof costMatrixCacheTimer;
    roomNameParseCache: typeof geometryCaches.roomNameParseCache;
    shardRoomNameParseCache: typeof geometryCaches.shardRoomNameParseCache;
};

const cache: MoveOptRuntimeCache = {
    globalPathCache,
    globalPathCacheByVariant,
    roomSameRoomPathRefs,
    pathCacheTimer,
    creepPathCache,
    creepMoveCache,
    costMatrixCache,
    costMatrixRevision,
    costMatrixCacheTimer,
    roomNameParseCache: geometryCaches.roomNameParseCache,
    shardRoomNameParseCache: geometryCaches.shardRoomNameParseCache,
};

// squad 寻路派生矩阵缓存：仅缓存“当前 tick”的结果，避免跨 tick 的陈旧数据
let squadDerivedMatCacheTick = -1;
let squadDerivedMatCache = Object.create(null);

// 4.3 常量映射 / 原型引用 / 统计项
const obstacles = buildObstacleMap();
const isObstacleStructure = (room, pos, ignoreStructures) =>
    rawIsObstacleStructure(room, pos, ignoreStructures, obstacles);


const creepProto = Creep.prototype as typeof Creep.prototype & {
    $move?: typeof Creep.prototype.move;
    $moveTo?: typeof Creep.prototype.moveTo;
    $pull?: typeof Creep.prototype.pull;
    $cancelOrder?: typeof Creep.prototype.cancelOrder;
};
const originMove = creepProto.$move || creepProto.move;
const originMoveTo = creepProto.$moveTo || creepProto.moveTo;
const originPull = creepProto.$pull || creepProto.pull;
const originCancelOrder = creepProto.$cancelOrder || creepProto.cancelOrder;
type MoveMethod = typeof Creep.prototype.move;
type MoveToMethod = typeof Creep.prototype.moveTo;
type CancelOrderMethod = typeof PowerCreep.prototype.cancelOrder;
const powerCreepProto = typeof PowerCreep !== 'undefined' ? PowerCreep.prototype as typeof PowerCreep.prototype & {
    $move?: MoveMethod;
    $moveTo?: MoveToMethod;
    $cancelOrder?: CancelOrderMethod;
} : undefined;
const originPowerMove = powerCreepProto ? (powerCreepProto.$move || powerCreepProto.move) : undefined;
const originPowerMoveTo = powerCreepProto ? (powerCreepProto.$moveTo || powerCreepProto.moveTo) : undefined;
const originFindClosestByPath = RoomPosition.prototype.findClosestByPath;

// per-tick 缓存：房间地形缓冲与己方单位位置索引，降低频繁查找开销
let terrainCacheTick = -1;
const terrainCache = Object.create(null);

function resetTerrainCacheIfNeeded() {
    if (terrainCacheTick === Game.time) return;
    terrainCacheTick = Game.time;
    clearObjectKeys(terrainCache);
}

function getRoomTerrainBuffer(roomName) {
    resetTerrainCacheIfNeeded();
    let buf = terrainCache[roomName];
    if (!buf) {
        const room = Game.rooms[roomName];
        if (!room) return null;
        buf = (room.getTerrain() as RoomTerrain & { getRawBuffer(): Uint8Array }).getRawBuffer();
        terrainCache[roomName] = buf;
    }
    return buf;
}

let creepIndexTick = -1;
const myCreepIndex = new Map();
const myPowerCreepIndex = new Map();

function ensureMyCreepIndex() {
    if (creepIndexTick === Game.time) return;
    creepIndexTick = Game.time;
    myCreepIndex.clear();
    myPowerCreepIndex.clear();
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if (!creep || !creep.my) continue;
        const formal = formalizeIntentPos(creep.pos);
        if (typeof formal.x !== 'number' || typeof formal.y !== 'number') continue;
        myCreepIndex.set(packIntentTile(formal), name);
    }
    if (typeof PowerCreep !== 'undefined') {
        for (const name in Game.powerCreeps) {
            const pc = Game.powerCreeps[name];
            if (!pc || !pc.my || !pc.pos) continue;
            const formal = formalizeIntentPos(pc.pos);
            if (typeof formal.x !== 'number' || typeof formal.y !== 'number') continue;
            myPowerCreepIndex.set(packIntentTile(formal), name);
        }
    }
}

function getOriginMoveMethod(unit) {
    return originMove;
}

function getOriginCancelOrderMethod(unit) {
    return originCancelOrder;
}

function getPowerCreepMoveMethod(): MoveMethod | undefined {
    if (!powerCreepProto) return undefined;
    const pcMove = powerCreepProto.$move || originPowerMove || powerCreepProto.move;
    if (pcMove === betterMove) return originMove;
    return pcMove || originMove;
}

function getPowerCreepMoveToMethod(): MoveToMethod | undefined {
    if (!powerCreepProto) return undefined;
    const pcMoveTo = powerCreepProto.$moveTo || originPowerMoveTo || powerCreepProto.moveTo;
    if (pcMoveTo === betterMoveTo) return originMoveTo;
    return pcMoveTo || originMoveTo;
}

function getPowerCreepCancelOrderMethod(): CancelOrderMethod | undefined {
    if (!powerCreepProto) return undefined;
    const pcCancel = powerCreepProto.$cancelOrder || powerCreepProto.cancelOrder;
    if (pcCancel === betterCancelOrder) return originCancelOrder as CancelOrderMethod;
    return (pcCancel || originCancelOrder) as CancelOrderMethod;
}

// 确保 PowerCreep 使用原生移动（热重载时可能遗留被包裹的 move/moveTo）。
function restorePowerCreepNativeMethods() {
    if (!powerCreepProto) return;
    const baseMove = getPowerCreepMoveMethod();
    const baseMoveTo = getPowerCreepMoveToMethod();
    const baseCancel = getPowerCreepCancelOrderMethod();
    if (baseMove) {
        powerCreepProto.$move = baseMove;
        powerCreepProto.move = baseMove;
    }
    if (baseMoveTo) {
        powerCreepProto.$moveTo = baseMoveTo;
        powerCreepProto.moveTo = baseMoveTo;
    }
    if (baseCancel) {
        powerCreepProto.$cancelOrder = baseCancel;
        powerCreepProto.cancelOrder = baseCancel;
    }
}

// 统计变量
let startTime;
let endTime;
let startCacheSearch;
let analyzeCPU = { // 统计相关函数总耗时
    move: { sum: 0, calls: 0 },
    moveTo: { sum: 0, calls: 0 },
    findClosestByPath: { sum: 0, calls: 0 },
    endTickResolve: { sum: 0, calls: 0, moveCount: 0 }
};
const runtimeMetrics = {
    pathCounter: 0,
    testCacheHits: 0,
    testCacheMiss: 0,
    testNormal: 0,
    testNearStorageCheck: 0,
    testNearStorageSwap: 0,
    testTrySwap: 0,
    testBypass: 0,
    normalLogicalCost: 0,
    cacheHitCost: 0,
    cacheMissCost: 0,
};
let unWalkableCCost = 255;
const activeMoveScore = 32;
const highMoveScore = activeMoveScore << 1;
const ultraMoveScore = activeMoveScore << 2;
const passiveMoveScore = -4;
const overlapMoveScore = -4;
const badMoveScore = -32;
const activeYieldScore = 1;
const IntentTiles = new Uint32Array(Math.max(Object.keys(Game.rooms).length * 64, 4096));
const Priorities = new Uint8Array(IntentTiles.length);
const cachedMoveIntents = new Map();
const creepToSquad = new Map();
const squadToCreeps = new Map();
const squadNextTile = new Set();
const rerouteSquad = new Set<string>();
const checkedTiles = new Map();
let squadIdx = 1;
let creepIdx = 1;

// ============================================================================
// 5) 基础工具函数（坐标、房间名、几何关系等）
// ============================================================================

// 基础几何/障碍判定已拆到 `geometry.ts` / `obstacles.ts`，主文件只保留消费逻辑。

// ----------------------------------------------------------------------------
// 6) Observer 任务流：登记 -> observeRoom -> 下 tick 校验路径
// ----------------------------------------------------------------------------
/**
 *  登记ob需求
 * @param {MyPath} path
 * @param {number} idx
 */
function getObserverTaskTTL() {
    const ttl = config.observerTaskTTL | 0;
    return ttl > 0 ? ttl : 12;
}

function createObserverTask(path: BetterMovePath, idx: number, roomName: string): BetterMoveObserverTask {
    const task: BetterMoveObserverTask = { path, idx, roomName };
    if (config.enableObserverQueueRefine) {
        task.createdTick = Game.time;
        task.expireTick = Game.time + getObserverTaskTTL();
        task.pathVersion = ensurePathVersion(path);
    }
    return task;
}

function isObserverTaskExpired(task: BetterMoveObserverTask | undefined) {
    return !!(task && task.expireTick && Game.time > task.expireTick);
}

function isObserverTaskStale(task: BetterMoveObserverTask | undefined) {
    if (!task || !task.path || !task.path.posArray || !task.path.posArray.length || typeof task.path.posArray[0] !== 'object') {
        return true;
    }
    if (task.pathVersion && task.path._bmVersion && task.pathVersion !== task.path._bmVersion) {
        return true;
    }
    return false;
}

// 6.1 Observer 队列操作（FIFO + head 指针，避免 shift 的 O(n) 搬移）
function getObserverQueueSize(obData: BetterMoveObserverRuntime) {
    const queue = obData.taskQueue || [];
    if (!config.enableObserverQueueRefine) {
        return queue.length;
    }
    const head = obData.taskHead | 0;
    const size = queue.length - head;
    return size > 0 ? size : 0;
}

function peekObserverTask(obData: BetterMoveObserverRuntime) {
    const queue = obData.taskQueue;
    if (!queue || !queue.length) return undefined;
    if (!config.enableObserverQueueRefine) {
        return queue[queue.length - 1];
    }
    const head = obData.taskHead | 0;
    return queue[head];
}

function compactObserverQueue(obData: BetterMoveObserverRuntime) {
    if (!config.enableObserverQueueRefine) return;
    const queue = obData.taskQueue;
    const head = obData.taskHead | 0;
    if (!queue || !head) return;
    if (head >= 64 || head * 2 >= queue.length) {
        queue.splice(0, head);
        obData.taskHead = 0;
    }
}

function dropObserverTask(obData: BetterMoveObserverRuntime) {
    const queue = obData.taskQueue;
    if (!queue || !queue.length) return;
    if (config.enableObserverQueueRefine) {
        obData.taskHead = (obData.taskHead | 0) + 1;
        compactObserverQueue(obData);
        return;
    }
    queue.pop();
}

function estimateObserverReadyTick(obData: BetterMoveObserverRuntime) {
    const queueLen = getObserverQueueSize(obData);
    if (!config.enableObserverQueueRefine) return queueLen;
    const lastIssuedTick = obData.lastIssuedTick | 0;
    const nextTick = lastIssuedTick >= Game.time ? (lastIssuedTick + 1) : Game.time;
    return nextTick + queueLen;
}

function addObTask(path: BetterMovePath, idx: number) {
    if (!path || !path.posArray || !(idx in path.posArray)) return;
    ensureObserversUpToDate();
    if (!observers.length) return;
    const pos = path.posArray[idx];
    if (!pos || typeof pos !== 'object') return;
    let roomName = pos.roomName;
    //console.log('准备ob ' + roomName);
    // 同一路径同一 idx 在短时间内只登记一次，防止队列膨胀（失败时允许后续重试）
    const obDedup = path._bmObDedup || (path._bmObDedup = Object.create(null));
    const last = obDedup[idx];
    if (last && Game.time - last < 5) return;
    obDedup[idx] = Game.time;
    const task = createObserverTask(path, idx, roomName);
    let best = null;
    let bestDist = Infinity;
    let bestReadyTick = Infinity;
    let bestQueueLen = Infinity;
    for (let obData of observers) {
        const dist = Game.map.getRoomLinearDistance(obData.roomName, roomName);
        if (dist > 10) continue;
        const readyTick = estimateObserverReadyTick(obData);
        const qlen = getObserverQueueSize(obData);
        if (dist < bestDist || (dist === bestDist && (readyTick < bestReadyTick || (readyTick === bestReadyTick && qlen < bestQueueLen)))) {
            best = obData;
            bestDist = dist;
            bestReadyTick = readyTick;
            bestQueueLen = qlen;
        }
    }
    if (best) {
        best.taskQueue.push(task);
    }
}

// observer 调度与结果处理已迁入 `pathing.ts`。

// ----------------------------------------------------------------------------
// 7) CostMatrix 构建与房间可行走性校验
// ----------------------------------------------------------------------------
function raiseCostWhenLower(costMat, x, y, nextCost) {
    const oldCost = costMat.get(x, y);
    if (oldCost == unWalkableCCost || oldCost >= nextCost) {
        return;
    }
    costMat.set(x, y, nextCost);
}

function applyRoomEdgePenalty(costMat, edgeCost) {
    if (!costMat || edgeCost <= 1 || edgeCost >= unWalkableCCost) {
        return;
    }

    for (let x = 0; x < 50; x++) {
        raiseCostWhenLower(costMat, x, 0, edgeCost);
        raiseCostWhenLower(costMat, x, 49, edgeCost);
    }
    for (let y = 1; y < 49; y++) {
        raiseCostWhenLower(costMat, 0, y, edgeCost);
        raiseCostWhenLower(costMat, 49, y, edgeCost);
    }
}

/**
 * 为“已规划但尚未建成”的外矿道路施加轻度路径偏好。
 *
 * @remarks
 * 这里不把规划道路直接当成真实 road（cost=1）使用，而是只做“当前地形代价 - 1”：
 * - plain: 2 -> 1
 * - swamp: 10 -> 9
 * - 已有更低代价（例如真实 road=1）时保持不变
 *
 * 这样能让 `out-carry` 更倾向沿既定外矿路线行走，但不会把未建 road 的 swamp
 * 误判成“和真实 road 一样便宜”，避免寻路过度偏向未落地的沼泽路线。
 *
 * @param room 当前房间。
 * @param noStructureCostMat 忽略可破坏建筑的 costMatrix。
 * @param structureCostMat 考虑可破坏建筑的 costMatrix。
 */
function applyPlannedExternalRoadPreference(room, noStructureCostMat, structureCostMat) {
    const plannedRoads = RoadMemory.getPlannedRoadsInRoom(room.name);
    if (!plannedRoads.length) return;

    const terrain = room.getTerrain();
    const applyPreference = (costMat, x, y) => {
        const oldCost = costMat.get(x, y);
        if (oldCost == unWalkableCCost) return;

        const terrainType = terrain.get(x, y);
        if (terrainType == TERRAIN_MASK_WALL) return;

        const terrainBaseCost = terrainType == TERRAIN_MASK_SWAMP ? 10 : 2;
        const nextCost = oldCost > 0
            ? Math.max(1, oldCost - 1)
            : Math.max(1, terrainBaseCost - 1);

        if (oldCost == 0 || nextCost < oldCost) {
            costMat.set(x, y, nextCost);
        }
    };

    for (let i = plannedRoads.length; i--;) {
        const [x, y] = decompress(plannedRoads[i]);
        applyPreference(noStructureCostMat, x, y);
        applyPreference(structureCostMat, x, y);
    }
}

function getSameRoomEdgeCostMatrix(roomName, ignoreCondition) {
    const roomMats = costMatrixCache[roomName];
    if (!roomMats) {
        return emptyCostMatrix;
    }

    const revision = costMatrixRevision[roomName] | 0;
    let roomCache = sameRoomEdgeCostMatCache[roomName];
    if (!roomCache || roomCache.revision !== revision) {
        roomCache = sameRoomEdgeCostMatCache[roomName] = {
            revision,
            true: null,
            false: null
        };
    }

    const cacheKey = ignoreCondition ? 'true' : 'false';
    if (roomCache[cacheKey]) {
        return roomCache[cacheKey];
    }

    const edgeCostMat = roomMats[ignoreCondition].clone();
    const edgePenaltyCost = getPositiveConfigNumber(config.sameRoomEdgePenaltyCost, 20);
    applyRoomEdgePenalty(edgeCostMat, edgePenaltyCost);
    roomCache[cacheKey] = edgeCostMat;
    return edgeCostMat;
}

function buildIntentEdgeArray(room) {
    const terrain = getRoomTerrainBuffer(room.name) || room.getTerrain().getRawBuffer();
    const edgeArray = new Uint16Array(2500 << 3);
    const edgeIdx = new Uint8Array(2500);
    let u;
    let v;
    let w;

    for (u = 0; u < 50; u++) {
        if (terrain[u] & TERRAIN_MASK_WALL) {
            continue;
        }
        v = u - 1;
        if (v >= 0 && !(terrain[v] & TERRAIN_MASK_WALL)) {
            edgeArray[(u << 3) + edgeIdx[u]++] = v;
            edgeArray[(v << 3) + edgeIdx[v]++] = u;
        }
    }

    for (let y = 1, idx = 50; y < 50; y++, idx += 50) {
        if (terrain[idx] & TERRAIN_MASK_WALL) {
            continue;
        }
        v = idx - 50;
        if (!(terrain[v] & TERRAIN_MASK_WALL)) {
            edgeArray[(idx << 3) + edgeIdx[idx]++] = v;
            edgeArray[(v << 3) + edgeIdx[v]++] = idx;
        }
    }

    for (let y = 1, y50 = 50; y <= 49; y++, y50 += 50) {
        for (let x = 1, idx = y50 + 1; x <= 49; x++, idx++) {
            if (terrain[idx] & TERRAIN_MASK_WALL) {
                continue;
            }
            u = idx - 1;
            v = idx - 50;
            w = idx - 51;
            const uTerrain = terrain[u];
            const vTerrain = terrain[v];
            const wTerrain = terrain[w];
            if (!(uTerrain & TERRAIN_MASK_WALL)) {
                edgeArray[(idx << 3) + edgeIdx[idx]++] = u;
                edgeArray[(u << 3) + edgeIdx[u]++] = idx;
                if (!(vTerrain & TERRAIN_MASK_WALL)) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = v;
                    edgeArray[(v << 3) + edgeIdx[v]++] = idx;
                    edgeArray[(v << 3) + edgeIdx[v]++] = u;
                    edgeArray[(u << 3) + edgeIdx[u]++] = v;
                }
            } else if (!(vTerrain & TERRAIN_MASK_WALL)) {
                edgeArray[(idx << 3) + edgeIdx[idx]++] = v;
                edgeArray[(v << 3) + edgeIdx[v]++] = idx;
            }
            if (!(wTerrain & TERRAIN_MASK_WALL)) {
                edgeArray[(idx << 3) + edgeIdx[idx]++] = w;
                edgeArray[(w << 3) + edgeIdx[w]++] = idx;
            }
        }
    }

    return edgeArray;
}

function initialMap(terrain) {
    const squareMap = new Uint8Array(2500);
    const squadCostMatrix = new PathFinder.CostMatrix;
    const edgeArray = new Uint16Array(2500 << 3);
    const edgeIdx = new Uint8Array(2500);

    for (let u = 0; u < 50; u++) {
        if (terrain[u] & TERRAIN_MASK_WALL) {
            squareMap[u] = 0;
        } else {
            squareMap[u] = 1;
            const v = u - 1;
            if (squareMap[v] === 0) {
                squadCostMatrix.set(u, 0, unWalkableCCost);
            } else {
                edgeArray[(u << 3) + edgeIdx[u]++] = v;
                edgeArray[(v << 3) + edgeIdx[v]++] = u;
            }
        }
    }
    for (let y = 1, u = 50; y < 50; y++, u += 50) {
        if (terrain[u] & TERRAIN_MASK_WALL) {
            squareMap[u] = 0;
        } else {
            squareMap[u] = 1;
            const v = u - 50;
            if (squareMap[v] === 0) {
                squadCostMatrix.set(0, y, unWalkableCCost);
            } else {
                edgeArray[(u << 3) + edgeIdx[u]++] = v;
                edgeArray[(v << 3) + edgeIdx[v]++] = u;
            }
        }
    }
    return { squareMap, squadCostMatrix, edgeArray, edgeIdx };
}

function getSquadCostMatrix(room, costMatrix) {
    const terrain = getRoomTerrainBuffer(room.name) || room.getTerrain().getRawBuffer();
    const { squareMap, squadCostMatrix, edgeArray, edgeIdx } = initialMap(terrain);
    let current, u, v, w;

    for (let y = 1, y50 = 50; y <= 49; y++, y50 += 50) {
        for (let x = 1, idx = y50 + 1; x <= 49; x++, idx++) {
            const curTerrain = terrain[idx];
            if (curTerrain & TERRAIN_MASK_WALL) {
                squareMap[idx] = 0;

                u = idx - 1;
                v = idx - 50;
                if (squareMap[u] && squareMap[v]) {
                    edgeArray[(v << 3) + edgeIdx[v]++] = u;
                    edgeArray[(u << 3) + edgeIdx[u]++] = v;
                }
            } else if (costMatrix.get(x, y) == unWalkableCCost) {
                squareMap[idx] = 0;
                squadCostMatrix.set(x, y, unWalkableCCost);

                u = idx - 1;
                v = idx - 50;
                w = idx - 51;
                if (!(terrain[u] & TERRAIN_MASK_WALL)) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = u;
                    edgeArray[(u << 3) + edgeIdx[u]++] = idx;
                    if (!(terrain[v] & TERRAIN_MASK_WALL)) {
                        edgeArray[(idx << 3) + edgeIdx[idx]++] = v;
                        edgeArray[(v << 3) + edgeIdx[v]++] = idx;

                        edgeArray[(v << 3) + edgeIdx[v]++] = u;
                        edgeArray[(u << 3) + edgeIdx[u]++] = v;
                    }
                } else if (!(terrain[v] & TERRAIN_MASK_WALL)) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = v;
                    edgeArray[(v << 3) + edgeIdx[v]++] = idx;
                }
                if (!(terrain[w] & TERRAIN_MASK_WALL)) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = w;
                    edgeArray[(w << 3) + edgeIdx[w]++] = idx;
                }
            } else {
                u = idx - 1;
                v = idx - 50;
                w = idx - 51;
                const uTerrain = terrain[u];
                const vTerrain = terrain[v];
                const wTerrain = terrain[w];
                if (!(uTerrain & TERRAIN_MASK_WALL)) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = u;
                    edgeArray[(u << 3) + edgeIdx[u]++] = idx;
                    if (!(vTerrain & TERRAIN_MASK_WALL)) {
                        edgeArray[(idx << 3) + edgeIdx[idx]++] = v;
                        edgeArray[(v << 3) + edgeIdx[v]++] = idx;

                        edgeArray[(v << 3) + edgeIdx[v]++] = u;
                        edgeArray[(u << 3) + edgeIdx[u]++] = v;
                    }
                } else if (!(vTerrain & TERRAIN_MASK_WALL)) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = v;
                    edgeArray[(v << 3) + edgeIdx[v]++] = idx;
                }
                if (!(wTerrain & TERRAIN_MASK_WALL)) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = w;
                    edgeArray[(w << 3) + edgeIdx[w]++] = idx;
                }

                current = squareMap[w];
                if (current > squareMap[u]) {
                    current = squareMap[u];
                }
                if (current > squareMap[v]) {
                    current = squareMap[v];
                }
                current = current + 1;
                squareMap[idx] = current;
                if (current >= 2) {
                    if ((curTerrain & TERRAIN_MASK_SWAMP && costMatrix.get(x, y) !== 1) ||
                        (uTerrain & TERRAIN_MASK_SWAMP && costMatrix.get(x - 1, y) !== 1) ||
                        (vTerrain & TERRAIN_MASK_SWAMP && costMatrix.get(x, y - 1) !== 1) ||
                        (wTerrain & TERRAIN_MASK_SWAMP && costMatrix.get(x - 1, y - 1) !== 1)) {
                        squadCostMatrix.set(x, y, 5);
                    }
                } else {
                    squadCostMatrix.set(x, y, unWalkableCCost);
                }
            }
        }
    }
    return { squadCostMatrix, edgeArray, squareMap };
}

function applySquadRoomEdgeCosts(squareMap, squadCostMatrix) {
    for (let i = 1, j = 50; i < 49; i++, j += 50) {
        if (squareMap[i]) {
            squadCostMatrix.set(i, 0, 5);
            squadCostMatrix.set(i, 1, 5);
        }
        if (squareMap[i + 2450]) {
            squadCostMatrix.set(i, 49, 5);
        }
        if (squareMap[j]) {
            squadCostMatrix.set(0, i, 5);
            squadCostMatrix.set(1, i, 5);
        }
        if (squareMap[j + 49]) {
            squadCostMatrix.set(49, i, 5);
        }
    }
}

/**
 *  为房间保存costMatrix，ignoreDestructibleStructures这个参数的两种情况各需要一个costMatrix
 *  设置costMatrix缓存的过期时间
 * @param {Room} room
 * @param {RoomPosition} pos
 */
function generateCostMatrix(room, pos) {
    let noStructureCostMat = new PathFinder.CostMatrix; // 不考虑可破坏的建筑，但是要考虑墙上资源点和无敌的3种建筑，可能还有其他不能走的？
    let structureCostMat = new PathFinder.CostMatrix;   // 在noStructrue的基础上加上所有不可行走的建筑
    let totalStructures = room.find(FIND_STRUCTURES);
    
    // 分别遍历各类对象并写入 costMatrix
    let sources = room.find(FIND_SOURCES);
    for (let i = sources.length; i--;) {
        noStructureCostMat.set(sources[i].pos.x, sources[i].pos.y, unWalkableCCost);
    }
    let minerals = room.find(FIND_MINERALS);
    for (let i = minerals.length; i--;) {
        noStructureCostMat.set(minerals[i].pos.x, minerals[i].pos.y, unWalkableCCost);
    }
    let deposits = room.find(FIND_DEPOSITS);
    for (let i = deposits.length; i--;) {
        noStructureCostMat.set(deposits[i].pos.x, deposits[i].pos.y, unWalkableCCost);
    }

    let x, y, noviceWall, deployingCore, centralPortal;
    let clearDelay = Infinity;
    const roomName = room.name;

    if (room.controller && (room.controller.my || room.controller.safeMode)) {  // 自己的工地不能踩
        let sites = room.find(FIND_CONSTRUCTION_SITES);
        for (let i = sites.length; i--;) {
            let consSite = sites[i];
            if (obstacles[consSite.structureType]) {
                x = consSite.pos.x; y = consSite.pos.y;
                noStructureCostMat.set(x, y, unWalkableCCost);
                structureCostMat.set(x, y, unWalkableCCost);
            }
        }
    }
    
    for (let i = totalStructures.length; i--;) {
        let s = totalStructures[i];
        x = s.pos.x; y = s.pos.y;
        
        switch (s.structureType) {
            case STRUCTURE_INVADER_CORE:
                if (s.ticksToDeploy) {
                    deployingCore = true;
                    clearDelay = clearDelay > s.ticksToDeploy ? s.ticksToDeploy : clearDelay;
                    noStructureCostMat.set(x, y, unWalkableCCost);
                }
                structureCostMat.set(x, y, unWalkableCCost);
                break;
            case STRUCTURE_PORTAL:
                if (!isHighWay(roomName)) {
                    centralPortal = true;
                    clearDelay = clearDelay > s.ticksToDecay ? s.ticksToDecay : clearDelay;
                }
                structureCostMat.set(x, y, unWalkableCCost);
                noStructureCostMat.set(x, y, unWalkableCCost);
                break;
            case STRUCTURE_WALL:
                if (!s.hits) {
                    noviceWall = true;
                    noStructureCostMat.set(x, y, unWalkableCCost);
                }
                structureCostMat.set(x, y, unWalkableCCost);
                break;
            case STRUCTURE_ROAD:
                if (noStructureCostMat.get(x, y) == 0) {  // 不是在3种无敌建筑或墙中资源上
                    noStructureCostMat.set(x, y, 1);
                    if (structureCostMat.get(x, y) == 0) {     // 不是在不可行走的建筑上
                        structureCostMat.set(x, y, 1);
                    }
                }
                break;
            case STRUCTURE_RAMPART:
                if (!s.my && !s.isPublic) {
                    structureCostMat.set(x, y, unWalkableCCost);
                }
                break;
            default:
                if (obstacles[s.structureType]) {
                    structureCostMat.set(x, y, unWalkableCCost);
                }
                break;
        }
    }

    // 外矿规划中的“待建道路”只施加轻度偏好，帮助 out-carry 更稳定地贴着既定路线走。
    applyPlannedExternalRoadPreference(room, noStructureCostMat, structureCostMat);

    const defaultSquadUsesStructures = !!(room.controller && room.controller.my);
    const defaultSquadData = getSquadCostMatrix(
        room,
        defaultSquadUsesStructures ? structureCostMat : noStructureCostMat
    );
    const squadFalseData = defaultSquadUsesStructures ? defaultSquadData : getSquadCostMatrix(room, structureCostMat);
    const squadTrueData = defaultSquadUsesStructures ? getSquadCostMatrix(room, noStructureCostMat) : defaultSquadData;
    const edgeArray = defaultSquadData.edgeArray;

    for (let i = 1, j = 50; i < 49; i++, j += 50) {
        if (defaultSquadData.squareMap[i]) {
            noStructureCostMat.set(i, 0, 5);
            structureCostMat.set(i, 0, 5);
        }
        if (defaultSquadData.squareMap[i + 2450]) {
            noStructureCostMat.set(i, 49, 5);
            structureCostMat.set(i, 49, 5);
        }
        if (defaultSquadData.squareMap[j]) {
            noStructureCostMat.set(0, i, 5);
            structureCostMat.set(0, i, 5);
        }
        if (defaultSquadData.squareMap[j + 49]) {
            noStructureCostMat.set(49, i, 5);
            structureCostMat.set(49, i, 5);
        }
    }
    applySquadRoomEdgeCosts(squadFalseData.squareMap, squadFalseData.squadCostMatrix);
    applySquadRoomEdgeCosts(squadTrueData.squareMap, squadTrueData.squadCostMatrix);

    costMatrixCache[roomName] = {
        roomName: roomName,
        my: room.controller && room.controller.my,
        true: noStructureCostMat,
        false: structureCostMat,
        squad: defaultSquadData.squadCostMatrix,
        squadFalse: squadFalseData.squadCostMatrix,
        squadTrue: squadTrueData.squadCostMatrix,
        edgeArray
    };
    costMatrixRevision[roomName] = ((costMatrixRevision[roomName] | 0) + 1) | 0;
    delete sameRoomEdgeCostMatCache[roomName];

    let avoids = [];
    let avoidChanged = false;
    if (room.controller && room.controller.owner && !room.controller.my && hostileCostMatrixClearDelay) {  // 他人房间，删除costMat才能更新被拆的建筑位置
        const hostileDueTick = Game.time + hostileCostMatrixClearDelay;
        if (!(hostileDueTick in costMatrixCacheTimer)) {
            costMatrixCacheTimer[hostileDueTick] = [];
            enqueueDueTick(costMatrixCacheTimerDueQueue, hostileDueTick);
        }
        costMatrixCacheTimer[hostileDueTick].push({
            roomName: roomName,
            avoids: avoids
        });   // 记录清理时间
    } else if (noviceWall || deployingCore || centralPortal) { // 如果遇到可能消失的挡路建筑，这3种情况下clearDelay才可能被赋值为非Infinity
        if (noviceWall) {    // 如果看见新手墙
            let neighbors = Game.map.describeExits(roomName);
            for (let direction in neighbors) {
                let status = Game.map.getRoomStatus(neighbors[direction]);
                if (status.status == 'closed') {
                    if (!(neighbors[direction] in avoidRooms)) {
                        avoidRooms[neighbors[direction]] = 1;
                        avoidChanged = true;
                    }
                } else if (status.status != 'normal' && status.timestamp != null) {
                    let estimateTickToChange = (status.timestamp - new Date().getTime()) / 10000; // 10s per tick
                    clearDelay = clearDelay > estimateTickToChange ? Math.ceil(estimateTickToChange) : clearDelay;
                }
            }
            if (pos) {  // 如果知道自己的pos
                for (let direction in neighbors) {
                    if (!(neighbors[direction] in avoidRooms)) {
                        let exits = room.find(+direction);
                        if (PathFinder.search(pos, exits, { maxRooms: 1, roomCallback: () => noStructureCostMat }).incomplete) {    // 此路不通
                            avoidRooms[neighbors[direction]] = 1;
                            avoids.push(neighbors[direction]);
                            avoidChanged = true;
                        }
                    }
                }
            }
        }
        //console.log(roomName + ' costMat 设置清理 ' + clearDelay);
        const clearDueTick = Game.time + clearDelay;
        if (!(clearDueTick in costMatrixCacheTimer)) {
            costMatrixCacheTimer[clearDueTick] = [];
            enqueueDueTick(costMatrixCacheTimerDueQueue, clearDueTick);
        }
        costMatrixCacheTimer[clearDueTick].push({
            roomName: roomName,
            avoids: avoids  // 因新手墙导致的avoidRooms需要更新
        });   // 记录清理时间
    }
    if (avoidChanged) {
        markAvoidRoomsChanged();
    }
    //console.log('生成costMat ' + roomName);

}

/**
 *  把路径上有视野的位置的正向移动方向拿到，只有在找新路时调用，找新路时会把有视野房间都缓存进costMatrixCache
 * @param {MyPath} path
 */
function generateDirectionArray(path) {
    let posArray = path.posArray
    let directionArray = new Array(posArray.length);
    let incomplete: false | number = false;
    for (let idx = 1; idx in posArray; idx++) {
        if (posArray[idx - 1].roomName in costMatrixCache) {    // 有costMat，是准确路径，否则需要在有视野时checkRoom()
            directionArray[idx] = getDirection(posArray[idx - 1], posArray[idx]);
        } else if (!incomplete) {   // 记录第一个缺失准确路径的位置
            incomplete = idx;
        }
    }
    if (incomplete) {
        addObTask(path, incomplete); // 这格没有direction
    }
    path.directionArray = directionArray;
}

/**
 *  第一次拿到该room视野，startIdx是新房中唯一有direction的位置
 * @param {Room} room
 * @param {MyPath} path
 * @param {number} startIdx
 */
function checkRoom(room, path, startIdx) {
    if (!(room.name in costMatrixCache)) {
        generateCostMatrix(room, path.posArray[startIdx]);
    }
    let thisRoomName = room.name
    /** @type {CostMatrix} */
    let costMat = costMatrixCache[thisRoomName][path.ignoreStructures];
    let posArray = path.posArray;
    let directionArray = path.directionArray;
    let i;
    for (i = startIdx; i + 1 in posArray && posArray[i].roomName == thisRoomName; i++) {
        if (costMat.get(posArray[i].x, posArray[i].y) == unWalkableCCost) {   // 路上有东西挡路
            return false;
        }
        directionArray[i + 1] = getDirection(posArray[i], posArray[i + 1]);
    }
    if (i + 1 in posArray) {
        while (i + 1 in posArray) {
            if (!directionArray[i + 1]) {
                addObTask(path, i + 1);     // 这格没有direction
                break;
            }
            i += 1;
        }
    }
    return true;
}

/**
 *  尝试对穿，有2种不可穿情况
 * @param {Creep} creep
 * @param {RoomPosition} pos
 * @param {boolean} bypassHostileCreeps
 */
function trySwap(creep, pos, bypassHostileCreeps) {     // ERR_NOT_FOUND开销0.00063，否则开销0.0066
    let obstacleCreeps = creep.room.lookForAt(LOOK_CREEPS, pos).concat(creep.room.lookForAt(LOOK_POWER_CREEPS, pos));
    if (obstacleCreeps.length) {
        for (let i = 0; i < obstacleCreeps.length; i++) {
            const c = obstacleCreeps[i];
            if (c.my) {
                return OK;
            } else if (bypassHostileCreeps && (!c.room.controller || !c.room.controller.my || !c.room.controller.safeMode)) {  // 第二种不可穿情况：希望绕过敌对creep
                return ERR_INVALID_TARGET;
            }
        }
        if (isCpuStatsEnabled()) runtimeMetrics.testTrySwap++;
        return OK;    // 或者全部操作成功
    }
    return ERR_NOT_FOUND // 没有creep
}

// ----------------------------------------------------------------------------
// 8) 跨房路由：route cache、临时避让与 bounce 防抖
// ----------------------------------------------------------------------------
let temporalAvoidFrom, temporalAvoidTo;
let bounceAvoidFrom, bounceAvoidTo, bounceAvoidUntil;
let temporalAvoidExitCacheTick = -1;
let temporalAvoidExitCache = Object.create(null);

function getPositiveConfigNumber(value, fallback) {
    const n = value | 0;
    return n > 0 ? n : fallback;
}

function isCpuStatsEnabled() {
    return !!config.enableCpuStats;
}

function isCacheStatsEnabled() {
    return cacheStatsEnabled;
}

function createDueTickQueue() {
    return { heap: [], marks: Object.create(null) };
}

function pushMinHeap(heap, value) {
    heap.push(value);
    let idx = heap.length - 1;
    while (idx > 0) {
        const parent = (idx - 1) >> 1;
        if (heap[parent] <= value) break;
        heap[idx] = heap[parent];
        idx = parent;
    }
    heap[idx] = value;
}

function popMinHeap(heap) {
    const last = heap.pop();
    if (last === undefined) return undefined;
    if (!heap.length) return last;
    const min = heap[0];
    let idx = 0;
    while (true) {
        const left = idx * 2 + 1;
        if (left >= heap.length) break;
        const right = left + 1;
        let child = left;
        if (right < heap.length && heap[right] < heap[left]) child = right;
        if (heap[child] >= last) break;
        heap[idx] = heap[child];
        idx = child;
    }
    heap[idx] = last;
    return min;
}

function enqueueDueTick(queue, tick) {
    const dueTick = tick | 0;
    if (dueTick < 0 || queue.marks[dueTick]) return;
    queue.marks[dueTick] = 1;
    pushMinHeap(queue.heap, dueTick);
}

function drainDueTickQueue(queue, now, visit) {
    const dueLimit = now | 0;
    while (queue.heap.length) {
        const next = queue.heap[0];
        if (next > dueLimit) break;
        const tick = popMinHeap(queue.heap);
        if (tick === undefined) break;
        delete queue.marks[tick];
        visit(tick);
    }
}

function clearDueTickQueue(queue) {
    queue.heap.length = 0;
    queue.marks = Object.create(null);
}


function registerRoomBounceGuard(creep, targetRoomName) {
    if (!config.enableRoomBounceGuardV2) {
        bounceAvoidFrom = bounceAvoidTo = '';
        bounceAvoidUntil = 0;
        return;
    }
    if (!creep || !creep.memory) return;

    if (!bounceAvoidUntil || Game.time > bounceAvoidUntil) {
        bounceAvoidFrom = bounceAvoidTo = '';
        bounceAvoidUntil = 0;
    }

    let mem = creep.memory._bmRoomBounce;
    if (!mem) {
        mem = creep.memory._bmRoomBounce = {
            lastRoom: creep.pos.roomName,
            prevRoom: '',
            prev2Room: '',
            lastSwitch: Game.time,
            prevSwitch: Game.time,
            blockUntil: 0,
            blockFrom: '',
            blockTo: ''
        };
    }

    const bounceWindow = getPositiveConfigNumber(config.roomBounceWindow, 20);
    const bounceTTL = getPositiveConfigNumber(config.roomBounceTTL, 100);

    if (mem.blockFrom && mem.blockTo && mem.blockUntil && mem.blockUntil >= Game.time) {
        bounceAvoidFrom = mem.blockFrom;
        bounceAvoidTo = mem.blockTo;
        bounceAvoidUntil = mem.blockUntil;
    }

    const current = creep.pos.roomName;
    if (mem.lastRoom !== current) {
        mem.prev2Room = mem.prevRoom;
        mem.prevRoom = mem.lastRoom;
        mem.lastRoom = current;
        mem.prevSwitch = mem.lastSwitch || Game.time;
        mem.lastSwitch = Game.time;

        const bounced = mem.prev2Room && mem.prev2Room === current && (Game.time - mem.prevSwitch) <= bounceWindow;
        if (bounced && targetRoomName && targetRoomName !== mem.prevRoom) {
            mem.blockFrom = current;
            mem.blockTo = mem.prevRoom;
            mem.blockUntil = Game.time + bounceTTL;
            bounceAvoidFrom = mem.blockFrom;
            bounceAvoidTo = mem.blockTo;
            bounceAvoidUntil = mem.blockUntil;
        }
    }
}

function applySameRoomDetourCooldown(creep, toPos, ops) {
    if (!config.enableSameRoomDetourCooldown || !config.enableSameRoomDetourCooldownV2) {
        return;
    }

    const bounceWindow = getPositiveConfigNumber(config.sameRoomDetourBounceWindow, 20);
    const cooldownTTL = getPositiveConfigNumber(config.sameRoomDetourCooldownTTL, 15);

    let detour = creep.memory._bmSameRoomDetour;
    if (!detour) {
        detour = creep.memory._bmSameRoomDetour = { lastRoom: creep.pos.roomName, lastTick: Game.time, leftTick: 0, targetRoom: toPos.roomName };
    } else if (detour.targetRoom !== toPos.roomName) {
        // 目标房变化后重置“绕出再回”检测，避免跨目标串扰
        detour.leftTick = 0;
        detour.targetRoom = toPos.roomName;
    }

    if (detour.lastRoom !== creep.pos.roomName) {
        if (detour.lastRoom === toPos.roomName && creep.pos.roomName !== toPos.roomName) {
            detour.leftTick = Game.time;
        }
        if (creep.pos.roomName === toPos.roomName && detour.lastRoom !== toPos.roomName && detour.leftTick && (Game.time - detour.leftTick) <= bounceWindow) {
            creep.memory._bmDetourCooldownUntil = Game.time + cooldownTTL;
        }
        detour.lastRoom = creep.pos.roomName;
        detour.lastTick = Game.time;
    }

    if (toPos.roomName === creep.pos.roomName && ops.maxRooms === undefined && creep.memory._bmDetourCooldownUntil && Game.time < creep.memory._bmDetourCooldownUntil) {
        ops.maxRooms = 1;
    }
}

let routeCache = Object.create(null);
let routeCacheKeysByDueTick = Object.create(null);
let routeCacheDueQueue = createDueTickQueue();
let routeCacheTrackedTtl = -1;
let routeCacheEntryCount = 0;
let routeCacheNonBypassEntryCount = 0;
let routeCacheWriteTick = -1;
let routeCacheWriteCount = 0;
let routeCacheMaintainTick = -1;
let routeCacheLookupCount = 0;
let routeCacheHitCount = 0;
let routeCacheWriteStoreCount = 0;
let routeCacheSkipByBudgetCount = 0;
let routeCacheSkipByCapacityCount = 0;
let routeCacheEvictBypassCount = 0;
let routeCacheEvictTTLCount = 0;
let pathCacheInsertCount = 0;
let pathCacheTrimRunCount = 0;
let pathCacheTrimScanCount = 0;
let pathCacheTrimDeleteCount = 0;
let bypassRouteCacheKeysByTick = Object.create(null);
let bypassRouteCacheDueQueue = createDueTickQueue();

// 路由缓存与跨房 route 主流程已迁入 `pathing.ts`。

// ----------------------------------------------------------------------------
// 9) PathFinder 组装：临时 costMatrix、roomCallback 与通用参数
// ----------------------------------------------------------------------------
// 普通 creep 与 squad/flee 的 PathFinder 搜索主流程都已迁入 `pathing.ts` / `movement.ts`。
// 这里只保留仍由入口直接复用的共享缓存容器。
let bypassCostMatReuseCache = Object.create(null);

function createPathFinderBaseOpts(ops) {
    return {
        maxRooms: ops.maxRooms,
        maxCost: ops.maxCost,
        heuristicWeight: ops.heuristicWeight || 1.2
    };
}

function getSquadCostMatrixForRoom(roomName, ignoreCondition) {
    if (!(roomName in costMatrixCache)) {
        return emptyCostMatrix;
    }
    const roomMats = costMatrixCache[roomName];
    if (ignoreCondition) {
        return roomMats.squadTrue || roomMats.squad || emptyCostMatrix;
    }
    return roomMats.squadFalse || roomMats.squad || emptyCostMatrix;
}

function applyMoveToTerrainCosts(PathFinderOpts, ops) {
    if (ops.ignoreSwamps) {
        PathFinderOpts.plainCost = ops.plainCost;
        PathFinderOpts.swampCost = ops.swampCost || 1;
    } else if (ops.ignoreRoads) {
        PathFinderOpts.plainCost = ops.plainCost;
        PathFinderOpts.swampCost = ops.swampCost || 5;
    } else {
        PathFinderOpts.plainCost = ops.plainCost || 2;
        PathFinderOpts.swampCost = ops.swampCost || 10;
    }
}

// ----------------------------------------------------------------------------
// 10) 路径缓存：写入、删除、索引维护与检索
// ----------------------------------------------------------------------------
function compactPathCacheInsertQueue() {
    if (pathCacheInsertHead > 1024 && pathCacheInsertHead * 2 >= pathCacheInsertQueue.length) {
        pathCacheInsertQueue = pathCacheInsertQueue.slice(pathCacheInsertHead);
        pathCacheInsertHead = 0;
    }
}

function pushPathCacheInsertToken(token: BetterMovePathInsertToken) {
    pathCacheInsertQueue.push(token);
    const maxEntries = config.pathCacheMaxEntries | 0;
    const maxQueueSize = maxEntries > 0 ? Math.max(maxEntries * 2, 1024) : 4096;
    const activeSize = pathCacheInsertQueue.length - pathCacheInsertHead;
    if (activeSize > maxQueueSize) {
        pathCacheInsertHead += activeSize - maxQueueSize;
    }
    compactPathCacheInsertQueue();
}

function resolvePathCacheInsertToken(token: BetterMovePathInsertToken) {
    if (!token) return null;
    const xBucket = globalPathCache[token.startKey];
    if (!xBucket) return null;
    const pathArray = xBucket[token.endKey];
    if (!pathArray || !pathArray.length) return null;
    for (let i = pathArray.length; i--;) {
        const path = pathArray[i];
        if ((path._bmVersion | 0) === token.version) {
            return path;
        }
    }
    return null;
}

function trimGlobalPathCacheByLimit() {
    const statsEnabled = isCacheStatsEnabled();
    const maxEntries = config.pathCacheMaxEntries | 0;
    if (maxEntries <= 0 || globalPathCachePathCount <= maxEntries) return;
    if (statsEnabled) {
        pathCacheTrimRunCount++;
    }

    const trimBatch = getPositiveConfigNumber(config.pathCacheTrimBatch, 64);
    const scanLimit = trimBatch * 4;
    let scanCount = 0;
    let trimCount = 0;
    while (
        globalPathCachePathCount > maxEntries &&
        pathCacheInsertHead < pathCacheInsertQueue.length &&
        scanCount < scanLimit &&
        trimCount < trimBatch
    ) {
        if (statsEnabled) {
            pathCacheTrimScanCount++;
        }
        scanCount++;
        const token = pathCacheInsertQueue[pathCacheInsertHead++];
        const candidate = resolvePathCacheInsertToken(token);
        if (!candidate) continue;
        deletePath(candidate);
        if (statsEnabled) {
            pathCacheTrimDeleteCount++;
        }
        trimCount++;
    }
    compactPathCacheInsertQueue();
}

/**
 * @param {MyPath} newPath
 */
function addPathIntoCache(newPath) {
    ensurePathVersion(newPath);
    if (isCacheStatsEnabled()) {
        pathCacheInsertCount++;
    }
    // combinedX: 起点坐标打包 (x << 16 | y)，作为一级索引 Key，唯一对应世界坐标的一个点
    const combinedX = (newPath.start.x << 16) | (newPath.start.y & 0xFFFF);
    // combinedY: 终点坐标的曼哈顿和 (x + y)，作为二级索引 Key，用于范围搜索
    const combinedY = newPath.end.x + newPath.end.y;
    if (!(combinedX in globalPathCache)) {
        globalPathCache[combinedX] = {
            [combinedY]: []  // 数组里放不同ops的及其他start、end与此对称的
        };
        globalPathCacheBucketCount++;
    } else if (!(combinedY in globalPathCache[combinedX])) {
        globalPathCache[combinedX][combinedY] = []      // 数组里放不同ops的及其他start、end与此对称的
    }
    globalPathCache[combinedX][combinedY].push(newPath);
    globalPathCachePathCount++;

    const pathEndRoomName = newPath.posArray && newPath.posArray.length ? (newPath.posArray[newPath.posArray.length - 1].roomName || "") : "";
    const variantKey = buildPathVariantKey(newPath.ignoreRoads, newPath.ignoreSwamps, newPath.ignoreStructures, pathEndRoomName);
    newPath._bmVariantKey = variantKey;
    let variantBuckets = globalPathCacheByVariant[combinedX];
    if (!variantBuckets) {
        variantBuckets = globalPathCacheByVariant[combinedX] = Object.create(null);
    }
    let variantYBuckets = variantBuckets[variantKey];
    if (!variantYBuckets) {
        variantYBuckets = variantBuckets[variantKey] = Object.create(null);
    }
    if (!(combinedY in variantYBuckets)) {
        variantYBuckets[combinedY] = [];
    }
    variantYBuckets[combinedY].push(newPath);

    // 维护全局 endKey -> startKey 反向索引，用于 bmDeletePathInRoom 的 useEndIndex 策略
    // 该索引包含所有房间的路径，因此在查询时需要配合 startKey 范围检查进行过滤
    let endRefs = endKeyStartKeyRefs[combinedY];
    if (!endRefs) {
        // 首次出现该 endKey：初始化 endKey -> startKey 的引用计数
        endRefs = endKeyStartKeyRefs[combinedY] = Object.create(null);
    }
    // 记录 endKey 与 startKey 的引用次数（可能有多条路径共享）
    endRefs[combinedX] = (endRefs[combinedX] || 0) + 1;

    let posArray = newPath.posArray;
    if (posArray && posArray.length) {
        const startRoomName = posArray[0].roomName;
        const endRoomName = posArray[posArray.length - 1].roomName;
        if (startRoomName && startRoomName == endRoomName) {
            // 只记录“起点和终点同房”的路径：bmDeletePathInRoom 只会清理这种路径
            let roomRefs = roomStartKeyRefs[startRoomName];
            if (!roomRefs) {
                // 首次遇到该房间时初始化索引与引用计数字典
                roomRefs = roomStartKeyRefs[startRoomName] = Object.create(null);
                roomStartKeyCount[startRoomName] = 0;
            }
            if (!roomRefs[combinedX]) {
                // 首次出现该 startKey：计数加一，供删除时快速遍历
                roomStartKeyCount[startRoomName]++;
                roomRefs[combinedX] = 0;
            }
            // 记录该 startKey 在该房间内被多少路径引用
            roomRefs[combinedX]++;

            let roomEndRefs = roomEndKeyRefs[startRoomName];
            if (!roomEndRefs) {
                // 首次遇到该房间时初始化 endKey 相关索引
                roomEndRefs = roomEndKeyRefs[startRoomName] = Object.create(null);
                roomEndKeyCount[startRoomName] = 0;
            }
            if (!roomEndRefs[combinedY]) {
                // 首次出现该 endKey：累加数量
                roomEndKeyCount[startRoomName]++;
                roomEndRefs[combinedY] = 0;
            }
            // 记录该 endKey 在该房间内被多少路径引用
            roomEndRefs[combinedY]++;

            const pathVersion = newPath._bmVersion | 0;
            if (pathVersion > 0) {
                let sameRoomRefs = roomSameRoomPathRefs[startRoomName];
                if (!sameRoomRefs) {
                    sameRoomRefs = roomSameRoomPathRefs[startRoomName] = Object.create(null);
                    roomSameRoomPathCount[startRoomName] = 0;
                }
                if (!(pathVersion in sameRoomRefs)) {
                    roomSameRoomPathCount[startRoomName] = (roomSameRoomPathCount[startRoomName] | 0) + 1;
                }
                sameRoomRefs[pathVersion] = newPath;
            }
        }
    }

    pushPathCacheInsertToken({
        startKey: combinedX,
        endKey: combinedY,
        version: newPath._bmVersion | 0
    });
    trimGlobalPathCacheByLimit();
}

function invalidate() {
    return 0;
}

/**
 * @param {MyPath} path
 */
function deletePath(path) {
    if (path.start) {     // 有start属性的不是临时路
        const startKey = (path.start.x << 16) | (path.start.y & 0xFFFF);
        const endKey = path.end.x + path.end.y;
        const xBucket = globalPathCache[startKey];
        if (!xBucket) {
            return;
        }
        const pathArray = xBucket[endKey];
        if (!pathArray) {
            return;
        }
        const idx = pathArray.indexOf(path);
        if (idx === -1) {
            return;
        }
        pathArray.splice(idx, 1);
        globalPathCachePathCount--;

        const variantKey = path._bmVariantKey || buildPathVariantKeyFromPath(path);
        const variantBuckets = globalPathCacheByVariant[startKey];
        if (variantBuckets && variantKey && variantBuckets[variantKey]) {
            const variantYBuckets = variantBuckets[variantKey];
            const variantPathArray = variantYBuckets[endKey];
            if (variantPathArray) {
                const variantIdx = variantPathArray.indexOf(path);
                if (variantIdx !== -1) {
                    variantPathArray.splice(variantIdx, 1);
                }
                if (!variantPathArray.length) {
                    delete variantYBuckets[endKey];
                    let hasVariantY = false;
                    for (let k in variantYBuckets) { hasVariantY = true; break; }
                    if (!hasVariantY) {
                        delete variantBuckets[variantKey];
                        let hasVariant = false;
                        for (let k in variantBuckets) { hasVariant = true; break; }
                        if (!hasVariant) {
                            delete globalPathCacheByVariant[startKey];
                        }
                    }
                }
            }
        }

        let endRefs = endKeyStartKeyRefs[endKey];
        if (endRefs && endRefs[startKey]) {
            let nextEndRef = endRefs[startKey] - 1;
            if (nextEndRef <= 0) {
                // 该 endKey 下此 startKey 已无引用，移出索引并在空时清理 endKey 级别映射
                delete endRefs[startKey];
                let hasEndKey = false;
                for (let k in endRefs) {
                    hasEndKey = true;
                    break;
                }
                if (!hasEndKey) {
                    delete endKeyStartKeyRefs[endKey];
                }
            } else {
                // 仍有路径引用该组合，仅减少计数
                endRefs[startKey] = nextEndRef;
            }
        }

        let posArray = path.posArray;
        if (posArray && posArray.length) {
            const startRoomName = posArray[0].roomName;
            const endRoomName = posArray[posArray.length - 1].roomName;
            if (startRoomName && startRoomName == endRoomName) {
                // 同房路径：同步维护 roomStartKey 索引与引用计数
                let roomRefs = roomStartKeyRefs[startRoomName];
                if (roomRefs && roomRefs[startKey]) {
                    let nextRef = roomRefs[startKey] - 1;
                    if (nextRef <= 0) {
                        // 当前 startKey 在该房间已无路径引用，移出索引并更新数量
                        delete roomRefs[startKey];
                        if (roomStartKeyCount[startRoomName]) {
                            roomStartKeyCount[startRoomName]--;
                        }
                    } else {
                        // 仍有路径引用该 startKey，仅减引用计数
                        roomRefs[startKey] = nextRef;
                    }
                }

                let roomEndRefs = roomEndKeyRefs[startRoomName];
                if (roomEndRefs && roomEndRefs[endKey]) {
                    let nextEndCount = roomEndRefs[endKey] - 1;
                    if (nextEndCount <= 0) {
                        // 该房间下此 endKey 已无引用，移出索引并更新计数
                        delete roomEndRefs[endKey];
                        if (roomEndKeyCount[startRoomName]) {
                            roomEndKeyCount[startRoomName]--;
                        }
                    } else {
                        // 仍有路径引用该 endKey，仅减少计数
                        roomEndRefs[endKey] = nextEndCount;
                    }
                }

                const version = path._bmVersion | 0;
                const sameRoomRefs = roomSameRoomPathRefs[startRoomName];
                if (sameRoomRefs && version > 0 && sameRoomRefs[version] === path) {
                    delete sameRoomRefs[version];
                    const nextSameRoomCount = (roomSameRoomPathCount[startRoomName] | 0) - 1;
                    if (nextSameRoomCount > 0) {
                        roomSameRoomPathCount[startRoomName] = nextSameRoomCount;
                    } else {
                        delete roomSameRoomPathCount[startRoomName];
                        delete roomSameRoomPathRefs[startRoomName];
                    }
                }
            }
        }

        if (pathArray.length === 0) {
            // 该 endKey 下已无路径，清理二级桶；若一级桶为空则清理并更新计数
            delete xBucket[endKey];
            let hasBucketKey = false;
            for (let k in xBucket) {
                hasBucketKey = true;
                break;
            }
            if (!hasBucketKey) {
                delete globalPathCache[startKey];
                globalPathCacheBucketCount--;
            }
        }
        path._bmDeletedTick = Game.time;
        path.posArray.length = 0;
    }
}

/**
 * 查找缓存路径（同房/跨房共用）
 * @param {RoomPosition} formalFromPos
 * @param {RoomPosition} formalToPos
 * @param {RoomPosition | undefined} fromPos
 * @param {CreepPaths} creepCache
 * @param {MoveToOpts} ops
 * @param {boolean} requireSecondStepCheck
 */
// 缓存路径查询与使用计时已迁入 `pathing.ts`。
// ----------------------------------------------------------------------------
// 11) 移动执行与路径可视化
// ----------------------------------------------------------------------------
/**@type {RoomPosition[]} */
let tempArray = [];
/**
 *
 * @param {Creep} creep
 * @param {RoomPosition} toPos
 * @param {RoomPosition[]} posArray
 * @param {number} startIdx
 * @param {number} idxStep
 * @param {PolyStyle} visualStyle
 */
// movement 执行层的可视化/单步推进/squad 路线推进 helper 已迁入 `movement.ts`。

// ----------------------------------------------------------------------------
// 12) 原型包装入口：统计、去重、每 tick 维护
// ----------------------------------------------------------------------------
/**
 * @param {(...args: Array<object | string | number | boolean | null | undefined>) => object | string | number | boolean | null | undefined} fn
 */
const intentSolver = createIntentSolverModule({
    getOriginCancelOrderMethod,
    getOriginMoveMethod,
    hasActiveBodypart,
    powerCreepProto,
    isCpuStatsEnabled,
    analyzeCPU,
    ensureMyCreepIndex,
    getMyCreepIndex() {
        return myCreepIndex;
    },
    getMyPowerCreepIndex() {
        return myPowerCreepIndex;
    },
    getRoomTerrainBuffer,
    costMatrixCache,
    generateCostMatrix,
    unWalkableCCost,
});
const {
    registerMoveIntent,
    registerSquad,
    checkSquadTarget,
    betterCancelOrder,
    setCheckTile,
    preTickBetterMove,
    resetMoveIntentState,
    endTickResolve,
} = intentSolver;

/**
 * `moveTo` 同 tick 去重用的轻量参数签名。
 * 这里只复用最稳定的目标点/关键范围参数，避免热路径上做深比较。
 */
function buildMoveToDedupKey(creep, args) {
    const arg0 = args[0];
    let key = '';
    if (typeof arg0 === 'object' && arg0) {
        const p = arg0.pos || arg0;
        const roomName = p.roomName || p.room?.name || creep.pos.roomName;
        key = `${roomName}|${p.x}|${p.y}`;
        const opts = args[1];
        if (opts && typeof opts === 'object') key += `|r${opts.range ?? ''}|mr${opts.maxRooms ?? ''}`;
        return key;
    }
    key = `${creep.pos.roomName}|${args[0]}|${args[1]}`;
    const opts = args[2];
    if (opts && typeof opts === 'object') key += `|r${opts.range ?? ''}|mr${opts.maxRooms ?? ''}`;
    return key;
}

function wrapFn(fn, name) {
    return function () {
        if (name === 'moveTo') {
            const last = this && this._bmMoveToDedup;
            if (last && last.tick === Game.time) {
                const key = buildMoveToDedupKey(this, arguments);
                if (key && last.key === key) return last.ret;
            }
        }
        const statsEnabled = isCpuStatsEnabled();
        if (statsEnabled) {
            startTime = Game.cpu.getUsed();
        }
        runMoveOptTickMaintenance();
        let code = fn.apply(this, arguments);
        if (statsEnabled) {
            endTime = Game.cpu.getUsed();
            if (endTime - startTime >= 0.2) {
                const bucket = analyzeCPU[name] || (analyzeCPU[name] = { sum: 0, calls: 0 });
                bucket.sum += endTime - startTime;
                bucket.calls++;
            }
        }
        if (name === 'moveTo') {
            const key = buildMoveToDedupKey(this, arguments);
            this._bmMoveToDedup = { tick: Game.time, key, ret: code };
        }
        return code;
    }
}

// ----------------------------------------------------------------------------
// 13) 缓存清理：过期路径 / 过期 costMatrix / 临时避让回收
// ----------------------------------------------------------------------------
const {
    clearUnused,
    bmClear,
} = createCleanupModule({
    globalPathCache,
    globalPathCacheByVariant,
    roomSameRoomPathRefs,
    roomSameRoomPathCount,
    roomStartKeyRefs,
    roomStartKeyCount,
    endKeyStartKeyRefs,
    roomEndKeyRefs,
    roomEndKeyCount,
    creepPathCache,
    creepMoveCache,
    pathCacheTimer,
    pathCacheTimerDueQueue,
    pathCacheInsertQueue,
    costMatrixCacheTimer,
    costMatrixCacheTimerDueQueue,
    costMatrixCache,
    costMatrixRevision,
    sameRoomEdgeCostMatCache,
    avoidRooms,
    avoidExits,
    syncedBypassRooms,
    observers,
    obTimer,
    obTimerDueQueue,
    routeCacheKeysByDueTick,
    routeCacheDueQueue,
    bypassRouteCacheKeysByTick,
    bypassRouteCacheDueQueue,
    bypassCostMatReuseCache,
    temporalAvoidExitCache,
    geometryCaches,
    getPathClearDelay() {
        return pathClearDelay;
    },
    setGlobalPathCacheBucketCount(value) {
        globalPathCacheBucketCount = value;
    },
    setGlobalPathCachePathCount(value) {
        globalPathCachePathCount = value;
    },
    setPathCacheInsertHead(value) {
        pathCacheInsertHead = value;
    },
    setRouteCacheTrackedTtl(value) {
        routeCacheTrackedTtl = value;
    },
    setTemporalAvoidExitCacheTick(value) {
        temporalAvoidExitCacheTick = value;
    },
    setTemporalAvoidRooms(from, to) {
        temporalAvoidFrom = from;
        temporalAvoidTo = to;
    },
    setBounceAvoidState(from, to, until) {
        bounceAvoidFrom = from;
        bounceAvoidTo = to;
        bounceAvoidUntil = until;
    },
    setSquadDerivedState(tick, cache) {
        squadDerivedMatCacheTick = tick;
        squadDerivedMatCache = cache;
    },
    setAutoDiscoverObserverTick(value) {
        autoDiscoverObserverTick = value;
    },
    setObTick(value) {
        obTick = value;
    },
    setAvoidRoomsMemoryInitialized(value) {
        avoidRoomsMemoryInitialized = value;
    },
    setAvoidRoomsMemorySignature(value) {
        avoidRoomsMemorySignature = value;
    },
    setAvoidRoomsSyncTick(value) {
        avoidRoomsSyncTick = value;
    },
    deletePath,
    drainDueTickQueue,
    clearDueTickQueue,
    markAvoidRoomsChanged,
    markAvoidExitsChanged,
    clearRouteCacheEntries() {
        return clearRouteCacheEntries();
    },
    resetPortalScanState,
    ensureObserversUpToDate,
    resetMoveOptStats() {
        return resetMoveOptStats();
    },
    resetMoveIntentState,
    setCheckTile,
});

// ============================================================================
// 14) moveTo / move / flee 等核心流程
// ============================================================================

const defaultVisualizePathStyle: PolyStyle = { fill: 'transparent', stroke: '#fff', lineStyle: 'dashed', strokeWidth: .15, opacity: .1 };

/**
 * 解析 moveTo 参数
 * @param {Creep} creep
 * @param {number | RoomObject} firstArg
 * @param {number | MoveToOpts} secondArg
 * @param {MoveToOpts} opts
 * @returns {{ toPos: RoomPosition, ops: MoveToOpts }}
 */
// moveTo / move / squadMoveTo 执行主流程已迁入 `movement.ts`。

/**
 *  按缓存路径移动
 * @param {Creep} creep
 * @param {PolyStyle} visualStyle
 * @param {RoomPosition} toPos
 */
// ============================================================================
// 15) 初始化与对外 API（global.BetterMove）
// ============================================================================
// observers / avoidRooms 在调用相关能力时刷新，并在同 tick 去重。

function resetCacheRuntimeStats() {
    routeCacheLookupCount = 0;
    routeCacheHitCount = 0;
    routeCacheWriteStoreCount = 0;
    routeCacheSkipByBudgetCount = 0;
    routeCacheSkipByCapacityCount = 0;
    routeCacheEvictBypassCount = 0;
    routeCacheEvictTTLCount = 0;
    pathCacheInsertCount = 0;
    pathCacheTrimRunCount = 0;
    pathCacheTrimScanCount = 0;
    pathCacheTrimDeleteCount = 0;
}

const routeCacheState = {
    routeCache,
    routeCacheKeysByDueTick,
    routeCacheDueQueue,
    bypassRouteCacheKeysByTick,
    bypassRouteCacheDueQueue,
    get trackedTtl() {
        return routeCacheTrackedTtl;
    },
    set trackedTtl(value) {
        routeCacheTrackedTtl = value;
    },
    get entryCount() {
        return routeCacheEntryCount;
    },
    set entryCount(value) {
        routeCacheEntryCount = value;
    },
    get nonBypassEntryCount() {
        return routeCacheNonBypassEntryCount;
    },
    set nonBypassEntryCount(value) {
        routeCacheNonBypassEntryCount = value;
    },
    get writeTick() {
        return routeCacheWriteTick;
    },
    set writeTick(value) {
        routeCacheWriteTick = value;
    },
    get writeCount() {
        return routeCacheWriteCount;
    },
    set writeCount(value) {
        routeCacheWriteCount = value;
    },
    get maintainTick() {
        return routeCacheMaintainTick;
    },
    set maintainTick(value) {
        routeCacheMaintainTick = value;
    },
    get lookupCount() {
        return routeCacheLookupCount;
    },
    set lookupCount(value) {
        routeCacheLookupCount = value;
    },
    get hitCount() {
        return routeCacheHitCount;
    },
    set hitCount(value) {
        routeCacheHitCount = value;
    },
    get writeStoreCount() {
        return routeCacheWriteStoreCount;
    },
    set writeStoreCount(value) {
        routeCacheWriteStoreCount = value;
    },
    get skipByBudgetCount() {
        return routeCacheSkipByBudgetCount;
    },
    set skipByBudgetCount(value) {
        routeCacheSkipByBudgetCount = value;
    },
    get skipByCapacityCount() {
        return routeCacheSkipByCapacityCount;
    },
    set skipByCapacityCount(value) {
        routeCacheSkipByCapacityCount = value;
    },
    get evictBypassCount() {
        return routeCacheEvictBypassCount;
    },
    set evictBypassCount(value) {
        routeCacheEvictBypassCount = value;
    },
    get evictTTLCount() {
        return routeCacheEvictTTLCount;
    },
    set evictTTLCount(value) {
        routeCacheEvictTTLCount = value;
    },
};

const temporalAvoidState = {
    get from() {
        return temporalAvoidFrom || '';
    },
    set from(value) {
        temporalAvoidFrom = value;
    },
    get to() {
        return temporalAvoidTo || '';
    },
    set to(value) {
        temporalAvoidTo = value;
    },
    get bounceFrom() {
        return bounceAvoidFrom || '';
    },
    get bounceTo() {
        return bounceAvoidTo || '';
    },
    get bounceUntil() {
        return bounceAvoidUntil || 0;
    },
    get cacheTick() {
        return temporalAvoidExitCacheTick;
    },
    set cacheTick(value) {
        temporalAvoidExitCacheTick = value;
    },
    get cache() {
        return temporalAvoidExitCache;
    },
    set cache(value) {
        temporalAvoidExitCache = value;
    },
};

const observerState = {
    observers,
    obTimer,
    obTimerDueQueue,
    get obTick() {
        return obTick;
    },
    set obTick(value) {
        obTick = value;
    },
};

const squadDerivedState = {
    get tick() {
        return squadDerivedMatCacheTick;
    },
    set tick(value) {
        squadDerivedMatCacheTick = value;
    },
    get cache() {
        return squadDerivedMatCache;
    },
    set cache(value) {
        squadDerivedMatCache = value;
    },
};

// PathingService 负责封装 route/path/squad/flee/observer 这组强状态相关能力。
const pathingModule: PathingModuleApi = new PathingService({
    config,
    setPathClearDelay(value) {
        pathClearDelay = value;
    },
    setHostileCostMatrixClearDelay(value) {
        hostileCostMatrixClearDelay = value;
    },
    parseRoomName,
    parseShardRoomName,
    ensureAvoidRoomsUpToDate,
    hasScopedAvoids,
    withScopedAvoids,
    isRoomAvoided,
    isExitAvoided,
    isHighWay,
    getCurrentAvoidScopeSignature,
    getPositiveConfigNumber,
    isNearExitDirection,
    createPathFinderBaseOpts,
    applyMoveToTerrainCosts,
    applyRoomEdgePenalty,
    getSameRoomEdgeCostMatrix,
    getSquadCostMatrixForRoom,
    generateCostMatrix,
    ensurePathVersion,
    generateDirectionArray,
    buildPathVariantKeyFromQuery,
    formalize,
    isSameOps,
    isNear,
    inRange,
    deletePath,
    emptyCostMatrix,
    unWalkableCCost,
    globalPathCache,
    globalPathCacheByVariant,
    getGlobalPathCachePathCount() {
        return globalPathCachePathCount;
    },
    getGlobalPathCacheBucketCount() {
        return globalPathCacheBucketCount;
    },
    roomSameRoomPathRefs,
    roomStartKeyCount,
    roomEndKeyCount,
    roomStartKeyRefs,
    endKeyStartKeyRefs,
    roomEndKeyRefs,
    costMatrixCache,
    costMatrixRevision,
    sameRoomEdgeCostMatCache,
    pathCacheInsertQueue,
    pathCacheTimer,
    pathCacheTimerDueQueue,
    creepPathCache,
    creepMoveCache,
    runtimeMetrics,
    routeCacheState,
    temporalAvoidState,
    observerState,
    squadDerivedState,
    creepToSquad,
    rerouteSquad,
    bypassCostMatReuseCache,
    getPathCacheInsertHead() {
        return pathCacheInsertHead;
    },
    getPathClearDelay() {
        return pathClearDelay;
    },
    isCacheStatsEnabled,
    isCpuStatsEnabled,
    setStartCacheSearch(value) {
        startCacheSearch = value;
    },
    getAvoidRoomsVersion() {
        return avoidRoomsVersion;
    },
    getAvoidExitsVersion() {
        return avoidExitsVersion;
    },
    enqueueDueTick,
    drainDueTickQueue,
    clearObjectKeys,
    clearDueTickQueue,
    getObserverQueueSize,
    peekObserverTask,
    dropObserverTask,
    isObserverTaskExpired,
    isObserverTaskStale,
    checkRoom,
    scanPortals,
    originMove,
    getDirection,
    getRouteCacheStats() {
        return {
            lookups: routeCacheLookupCount,
            hits: routeCacheHitCount,
            writes: routeCacheWriteStoreCount,
            skipByBudget: routeCacheSkipByBudgetCount,
            skipByCapacity: routeCacheSkipByCapacityCount,
            evictBypass: routeCacheEvictBypassCount,
            evictTTL: routeCacheEvictTTLCount,
            size: routeCacheEntryCount,
            nonBypassSize: routeCacheNonBypassEntryCount,
        };
    },
    getPathCacheStats() {
        return {
            inserts: pathCacheInsertCount,
            trimRuns: pathCacheTrimRunCount,
            trimScans: pathCacheTrimScanCount,
            trimDeletes: pathCacheTrimDeleteCount,
        };
    },
    resetCacheRuntimeStats,
});
const {
    bmSetPathClearDelay,
    bmSetHostileCostMatrixClearDelay,
    bmDeleteCostMatrix,
    bmGetCacheStats,
    bmDeltePath,
    bmDeletePath,
    bmDeletePathInRoom,
    clearRouteCacheEntries,
    ensureRouteCacheMaintenance,
    findTemporalPath,
    findPath,
    findShortPathInCache,
    findLongPathInCache,
    findSquadTemporalPath,
    findSquadPath,
    findSquadPathTo,
    flee,
    setPathTimer,
    runMoveOptTickMaintenance,
} = pathingModule;

const movementModule: MovementModuleApi = new MovementService({
    config,
    powerCreepProto,
    originMoveTo,
    originMove,
    originPull,
    originFindClosestByPath,
    getPowerCreepMoveToMethod,
    getPowerCreepMoveMethod,
    parseShardRoomName,
    scanPortals,
    pickPortalToShard,
    registerRoomBounceGuard,
    applySameRoomDetourCooldown,
    validateMoveToArgTypes,
    getScopedAvoidSignature,
    formalizeIntentPos,
    formalizeIntentMovePos,
    hasActiveBodypart,
    getPositiveConfigNumber,
    formalize,
    inRange,
    isEqual,
    isNear,
    isCpuStatsEnabled,
    runtimeMetrics,
    checkRoom,
    deletePath,
    clearUnused,
    findPath,
    findTemporalPath,
    findShortPathInCache,
    findLongPathInCache,
    findSquadTemporalPath,
    findSquadPath,
    setPathTimer,
    ensurePathVersion,
    generateDirectionArray,
    addPathIntoCache,
    isObstacleStructure,
    registerMoveIntent,
    registerSquad,
    checkSquadTarget,
    creepPathCache,
    creepMoveCache,
    costMatrixCache,
    costMatrixRevision,
    sameRoomEdgeCostMatCache,
    rerouteSquad,
    tempArray,
    defaultVisualizePathStyle,
    generateCostMatrix,
    getSquadCostMatrixForRoom,
    unWalkableCCost,
    tile2Pos,
    packIntentTile,
    getStartCacheSearch() {
        return startCacheSearch;
    },
    getStartTime() {
        return startTime;
    },
});
const {
    betterMoveTo,
    betterMove,
    betterPull,
    squadMove,
    squadMoveTo,
    betterFindClosestByPath,
} = movementModule;

const runtimeControl = createMoveRuntimeControlModule({
    config,
    analyzeCPU,
    runtimeMetrics,
    getCacheStats: bmGetCacheStats,
    isCpuStatsEnabled,
    resetCacheRuntimeStats,
    applyConfig,
    originMoveTo,
    wrapFn,
    updateDontPullMeForMoveTo,
    wrapProtoMethod,
    betterMoveTo,
    betterMove,
    betterPull,
    betterFindClosestByPath,
    findSquadPathTo,
    flee,
    restorePowerCreepNativeMethods,
});
const {
    bmPrint,
    bmSetChangeMoveTo,
    bmSetChangeMove,
    bmSetChangeFindClostestByPath,
    bmSetEnableSquadPath,
    bmSetEnableFlee,
    bmGetConfig,
    bmSetConfig,
    resetMoveOptStats,
    bmResetCacheStats,
} = runtimeControl;

function applyConfig() {
    cacheStatsEnabled = !!config.enableCacheStats;
    bmSetChangeMove(!!config.changeMove);
    bmSetChangeMoveTo(!!config.changeMoveTo);
    bmSetChangeFindClostestByPath(!!config.changeFindClostestByPath);
    bmSetEnableFlee(!!config.enableFlee);
    bmSetEnableSquadPath(!!config.enableSquadPath);
}

applyConfig();


// 15.2 对外挂载：提供调参、缓存管理与调试能力
global.BetterMove = createBetterMoveGlobalApi({
    bmSetChangeMove,
    creepPathCache,
    preTickBetterMove,
    squadMove,
    squadMoveTo,
    bmSetChangeMoveTo,
    setCheckTile,
    bmSetChangeFindClostestByPath,
    bmSetPathClearDelay,
    bmSetHostileCostMatrixClearDelay,
    bmDeleteCostMatrix,
    bmDeletePath,
    bmDeltePath,
    bmGetAvoidRoomsMap,
    bmGetAvoidExitsMap,
    bmAddAvoidRooms,
    bmDeleteAvoidRooms,
    bmClearAvoidExits,
    getClosestExitPos,
    bmSetEnableSquadPath,
    bmSetEnableFlee,
    bmGetConfig,
    bmSetConfig,
    bmGetCacheStats,
    bmResetCacheStats,
    bmDeletePathInRoom,
    bmAddAvoidExits,
    bmDeleteAvoidExits,
    scanPortals,
    getPortalRegistry,
    endTickResolve,
    bmPrint,
    bmClear,
});

// ============================================================================
// 16) 行为增强：dontPullMe 相关包装
// ============================================================================
installDontPullMePolicies({
    CreepPrototype: Creep.prototype,
    betterCancelOrder,
    restorePowerCreepNativeMethods,
});
