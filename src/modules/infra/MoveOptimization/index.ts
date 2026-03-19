// @ts-nocheck

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
import { createPathingModule } from './pathing';
import { installDontPullMePolicies, updateDontPullMeForMoveTo, wrapProtoMethod } from './dontPullMe';
import { createIntentSolverModule } from './intentSolver';
import { createBetterMoveGlobalApi, createMoveRuntimeControlModule } from './controls';

/*
creep对穿+跨房间寻路+寻路缓存 
应用此模块会导致creep.moveTo可选参数中这些项失效：
reusePath、serializeMemory、noPathFinding、ignore、avoid、serialize
*/

// ============================================================================
// 1) 模块配置与运行时开关
// ============================================================================
// 初始化参数
let config = {
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

function validateMoveToArgTypes(ops) {
    if (!ops || typeof ops !== 'object') {
        return false;
    }
    if (ops.range !== undefined && typeof ops.range !== 'number') {
        return false;
    }
    if (ops.bypassRange !== undefined && typeof ops.bypassRange !== 'number') {
        return false;
    }
    if (ops.avoidRooms !== undefined && !(ops.avoidRooms instanceof Set)) {
        return false;
    }
    if (ops.avoidExits !== undefined && !isValidAvoidExitsMap(ops.avoidExits)) {
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
/** @type {{id:string, roomName:string, taskQueue:{path:MyPath, idx:number, roomName:string, createdTick?:number, expireTick?:number, pathVersion?:number}[], taskHead?:number, lastIssuedTick?:number}[]} */
let observers = [];  // 如果想用ob寻路，把ob的id放这里
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
} = createAvoidSyncModule({
    observers,
    avoidRooms,
    syncedBypassRooms,
    markAvoidRoomsChanged,
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
/** @type {{ [time: number]:{path:MyPath, idx:number, roomName:string, pathVersion?:number, expireTick?:number}[] }} */
let obTimer = Object.create(null);   // observer async results keyed by due tick
let obTimerDueQueue = createDueTickQueue();
let obTick = Game.time;

// 4.2 路径缓存与反向索引
/** @type {Paths} */
let globalPathCache = Object.create(null);     // 缓存path
let globalPathCacheByVariant = Object.create(null); // startKey -> variantKey -> combinedY -> path[]
let globalPathCacheBucketCount = 0; // startKey bucket 数量（globalPathCache 的一级 key 数），用于估算全表遍历规模
let globalPathCachePathCount = 0; // 当前缓存路径总数，空时可快速退出清理逻辑
let pathCacheInsertQueue = [];
let pathCacheInsertHead = 0;
let roomSameRoomPathRefs = Object.create(null); // roomName -> { pathVersion: path }，仅记录同房路径
let roomSameRoomPathCount = Object.create(null); // roomName -> 同房路径条数
let roomStartKeyRefs = Object.create(null); // roomName -> { startKey: refCount }，同房路径的起点引用计数
let roomStartKeyCount = Object.create(null); // roomName -> startKey 数量，用于比较“按房间索引遍历”与“全表遍历”成本
let endKeyStartKeyRefs = Object.create(null); // endKey -> { startKey: refCount }，用于从终点范围反向定位可能的 startKey 桶
let roomEndKeyRefs = Object.create(null); // roomName -> { endKey: refCount }，同房路径的终点引用计数
let roomEndKeyCount = Object.create(null); // roomName -> endKey 数量，用于评估 endKey 索引遍历成本
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
let autoClearTick = Game.time;  // 用于避免重复清理缓存

const cache = {
    globalPathCache,
    globalPathCacheByVariant,
    roomSameRoomPathRefs,
    pathCacheTimer,
    creepPathCache,
    creepMoveCache,
    costMatrixCache,
    costMatrixRevision,
    costMatrixCacheTimer
};

// squad 寻路派生矩阵缓存：仅缓存“当前 tick”的结果，避免跨 tick 的陈旧数据
let squadDerivedMatCacheTick = -1;
let squadDerivedMatCache = Object.create(null);

// 4.3 常量映射 / 原型引用 / 统计项
const obstacles = buildObstacleMap();
const isObstacleStructure = (room, pos, ignoreStructures) =>
    rawIsObstacleStructure(room, pos, ignoreStructures, obstacles);


const originMove = Creep.prototype.$move || Creep.prototype.move;
const originMoveTo = Creep.prototype.$moveTo || Creep.prototype.moveTo;
const originPull = Creep.prototype.$pull || Creep.prototype.pull;
const originCancelOrder = Creep.prototype.$cancelOrder || Creep.prototype.cancelOrder;
const powerCreepProto = typeof PowerCreep !== 'undefined' ? PowerCreep.prototype : undefined;
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
        buf = room.getTerrain().getRawBuffer();
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

function getPowerCreepMoveMethod(): Function | undefined {
    if (!powerCreepProto) return undefined;
    const pcMove = powerCreepProto.$move || originPowerMove || powerCreepProto.move;
    if (pcMove === betterMove) return originMove;
    return pcMove || originMove;
}

function getPowerCreepMoveToMethod(): Function | undefined {
    if (!powerCreepProto) return undefined;
    const pcMoveTo = powerCreepProto.$moveTo || originPowerMoveTo || powerCreepProto.moveTo;
    if (pcMoveTo === betterMoveTo) return originMoveTo;
    return pcMoveTo || originMoveTo;
}

function getPowerCreepCancelOrderMethod(): Function | undefined {
    if (!powerCreepProto) return undefined;
    const pcCancel = powerCreepProto.$cancelOrder || powerCreepProto.cancelOrder;
    if (pcCancel === betterCancelOrder) return originCancelOrder;
    return pcCancel || originCancelOrder;
}

// 确保 PowerCreep 使用原生移动（热重载时可能遗留被包裹的 move/moveTo）。
function restorePowerCreepNativeMethods() {
    if (!powerCreepProto) return;
    const baseMove = getPowerCreepMoveMethod();
    const baseMoveTo = getPowerCreepMoveToMethod();
    const baseCancel = getPowerCreepCancelOrderMethod();
    if (baseMove) {
        powerCreepProto.$move = baseMove as any;
        powerCreepProto.move = baseMove as any;
    }
    if (baseMoveTo) {
        powerCreepProto.$moveTo = baseMoveTo as any;
        powerCreepProto.moveTo = baseMoveTo as any;
    }
    if (baseCancel) {
        powerCreepProto.$cancelOrder = baseCancel as any;
        powerCreepProto.cancelOrder = baseCancel as any;
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
const rerouteSquad = new Set();
const checkedTiles = new Map();
let squadIdx = 1;
let creepIdx = 1;

// ============================================================================
// 5) 基础工具函数（坐标、房间名、几何关系等）
// ============================================================================

// 房间名解析缓存迁移到 geometry.ts，主文件只保留 cache 对外透传。
cache.roomNameParseCache = geometryCaches.roomNameParseCache;
cache.shardRoomNameParseCache = geometryCaches.shardRoomNameParseCache;

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

function createObserverTask(path, idx, roomName) {
    const task = { path, idx, roomName };
    if (config.enableObserverQueueRefine) {
        task.createdTick = Game.time;
        task.expireTick = Game.time + getObserverTaskTTL();
        task.pathVersion = ensurePathVersion(path);
    }
    return task;
}

function isObserverTaskExpired(task) {
    return !!(task && task.expireTick && Game.time > task.expireTick);
}

function isObserverTaskStale(task) {
    if (!task || !task.path || !task.path.posArray || !task.path.posArray.length || typeof task.path.posArray[0] !== 'object') {
        return true;
    }
    if (task.pathVersion && task.path._bmVersion && task.pathVersion !== task.path._bmVersion) {
        return true;
    }
    return false;
}

// 6.1 Observer 队列操作（FIFO + head 指针，避免 shift 的 O(n) 搬移）
function getObserverQueueSize(obData) {
    const queue = obData.taskQueue || [];
    if (!config.enableObserverQueueRefine) {
        return queue.length;
    }
    const head = obData.taskHead | 0;
    const size = queue.length - head;
    return size > 0 ? size : 0;
}

function peekObserverTask(obData) {
    const queue = obData.taskQueue;
    if (!queue || !queue.length) return undefined;
    if (!config.enableObserverQueueRefine) {
        return queue[queue.length - 1];
    }
    const head = obData.taskHead | 0;
    return queue[head];
}

function compactObserverQueue(obData) {
    if (!config.enableObserverQueueRefine) return;
    const queue = obData.taskQueue;
    const head = obData.taskHead | 0;
    if (!queue || !head) return;
    if (head >= 64 || head * 2 >= queue.length) {
        queue.splice(0, head);
        obData.taskHead = 0;
    }
}

function dropObserverTask(obData) {
    const queue = obData.taskQueue;
    if (!queue || !queue.length) return;
    if (config.enableObserverQueueRefine) {
        obData.taskHead = (obData.taskHead | 0) + 1;
        compactObserverQueue(obData);
        return;
    }
    queue.pop();
}

function estimateObserverReadyTick(obData) {
    const queueLen = getObserverQueueSize(obData);
    if (!config.enableObserverQueueRefine) return queueLen;
    const lastIssuedTick = obData.lastIssuedTick | 0;
    const nextTick = lastIssuedTick >= Game.time ? (lastIssuedTick + 1) : Game.time;
    return nextTick + queueLen;
}

function addObTask(path, idx) {
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
    let incomplete = false;
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
// 普通 creep 的 route / path 搜索主流程已迁入 `pathing.ts`。
// 这些临时变量仍保留给 squad/flee 等共享 PathFinder 逻辑复用。
let bypassRoomName, bypassCostMat, userCostCallback, costMat;
let findPathIgnoreCondition;
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

// `findPathIgnoreCondition` 仍保留在 index，用于 squad / moveTo 复用同一判定条件。
// ----------------------------------------------------------------------------
// 10) 路径缓存：写入、删除、索引维护与检索
// ----------------------------------------------------------------------------
function compactPathCacheInsertQueue() {
    if (pathCacheInsertHead > 1024 && pathCacheInsertHead * 2 >= pathCacheInsertQueue.length) {
        pathCacheInsertQueue = pathCacheInsertQueue.slice(pathCacheInsertHead);
        pathCacheInsertHead = 0;
    }
}

function pushPathCacheInsertToken(token) {
    pathCacheInsertQueue.push(token);
    const maxEntries = config.pathCacheMaxEntries | 0;
    const maxQueueSize = maxEntries > 0 ? Math.max(maxEntries * 2, 1024) : 4096;
    const activeSize = pathCacheInsertQueue.length - pathCacheInsertHead;
    if (activeSize > maxQueueSize) {
        pathCacheInsertHead += activeSize - maxQueueSize;
    }
    compactPathCacheInsertQueue();
}

function resolvePathCacheInsertToken(token) {
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
function showVisual(creep, toPos, posArray, startIdx, idxStep, visualStyle) {
    tempArray.length = 0;
    tempArray.push(creep.pos);
    let thisRoomName = creep.room.name;
    _.defaults(visualStyle, defaultVisualizePathStyle);
    for (let i = startIdx; i in posArray && posArray[i].roomName == thisRoomName; i += idxStep) {
        tempArray.push(posArray[i]);
    }
    if (toPos.roomName == thisRoomName) {
        tempArray.push(toPos);
    }
    creep.room.visual.poly(tempArray, visualStyle);
}

/**
 *  按缓存路径移动
 * @param {Creep} creep
 * @param {PolyStyle} visualStyle
 * @param {RoomPosition} toPos
 */
function moveOneStep(creep, ops, toPos) {
    let creepCache = creepPathCache[creep.name];
    const visualStyle = ops.visualizePathStyle;
    if (visualStyle) {
        showVisual(creep, toPos, creepCache.path.posArray, creepCache.idx, 1, visualStyle);
    }
    if (creep.fatigue) {
        return ERR_TIRED;
    }
    creepCache.idx++;
    creepMoveCache[creep.name] = Game.time;
    if (isCpuStatsEnabled()) {
        runtimeMetrics.testNormal++;
        let t = Game.cpu.getUsed() - startTime;
        if (t > 0.2) {
            runtimeMetrics.normalLogicalCost += t - 0.2;
        } else {
            runtimeMetrics.normalLogicalCost += t;
        }
    }
    const pos = creepCache.path.posArray[creepCache.idx];
    return registerMoveIntent(creep, formalizeIntentMovePos(pos), ops.priority);
}

/**
 *
 * @param {Creep} creep
 * @param {{
        path: MyPath,
        dst: RoomPosition,
        idx: number
    }} pathCache
 * @param {PolyStyle} visualStyle
 * @param {RoomPosition} toPos
 * @param {boolean} ignoreCreeps
 */
function computeStartIndex(creepPos, posArray) {
    let idx = 0;
    while (idx < posArray.length && isNear(creepPos, posArray[idx])) {
        idx += 1;
    }
    return idx - 1;
}

function startRoute(creep, pathCache, ops, toPos, ignoreCreeps) {
    let posArray = pathCache.path.posArray;
    const visualStyle = ops.visualizePathStyle;

    let idx = computeStartIndex(creep.pos, posArray);
    if (idx < 0) {
        idx = 0;
    }
    pathCache.idx = idx;

    if (visualStyle) {
        showVisual(creep, toPos, posArray, idx, 1, visualStyle);
    }
    creepMoveCache[creep.name] = Game.time;

    let nextStep = posArray[idx];
    return registerMoveIntent(creep, formalizeIntentMovePos(nextStep), ops.priority);
}

/**
 *  将用在Creep.prototype.move中
 * @param {RoomPosition} pos
 * @param {DirectionConstant} target
 */
function direction2Pos(pos, target) {
    if (typeof target != "number") {
        // target 不是方向常数
        return undefined;
    }

    const direction = +target;  // 如果是string则由此运算转换成number
    let tarpos = {
        x: pos.x,
        y: pos.y,
    }
    if (direction !== 7 && direction !== 3) {
        if (direction > 7 || direction < 3) {
            --tarpos.y
        } else {
            ++tarpos.y
        }
    }
    if (direction !== 1 && direction !== 5) {
        if (direction < 5) {
            ++tarpos.x
        } else {
            --tarpos.x
        }
    }
    if (tarpos.x < 0 || tarpos.y > 49 || tarpos.x > 49 || tarpos.y < 0) {
        return undefined;
    } else {
        return new RoomPosition(tarpos.x, tarpos.y, pos.roomName);
    }
}

/**
 * moveTo 同 tick 去重使用的参数签名
 * @param {Creep} creep
 * @param {IArguments | any[]} args
 * @returns {string}
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

// BetterMove 每 tick 的 observer/route/portal 维护已迁入 `pathing.ts`。

function checkSquadRoom(room, path, startIdx) {
    if (!(room.name in costMatrixCache)) {
        generateCostMatrix(room);
    }
    const thisRoomName = room.name;
    let costMat = getSquadCostMatrixForRoom(thisRoomName, !!path.ignoreStructures);
    let posArray = path.posArray;
    let i;
    for (i = startIdx; i + 1 in posArray && posArray[i].roomName == thisRoomName; i++) {
        if (costMat.get(posArray[i].x, posArray[i].y) == unWalkableCCost) {
            return false;
        }
    }
    return true;
}

function squadTemporalRoomCallback(roomName) {
    if (isRoomAvoided(roomName)) {
        return false;
    }
    if (roomName == bypassRoomName) {
        costMat = bypassCostMat;
    } else {
        costMat = getSquadCostMatrixForRoom(roomName, findPathIgnoreCondition);
    }
    if (userCostCallback) {
        const roomCache = costMatrixCache[roomName];
        let resultCostMat = userCostCallback(roomName, roomCache ? costMat.clone() : new PathFinder.CostMatrix);
        if (resultCostMat instanceof PathFinder.CostMatrix) {
            costMat = resultCostMat;
        }
    }
    return costMat;
}

function createSquadPathFinderOpts(ops, roomCallback) {
    const pathFinderOpts = {
        maxRooms: typeof ops.maxRooms === 'number' ? ops.maxRooms : 10,
        maxCost: typeof ops.maxCost === 'number' ? ops.maxCost : 1000,
        heuristicWeight: typeof ops.heuristicWeight === 'number' ? ops.heuristicWeight : 1.2,
        roomCallback
    };
    if (typeof ops.maxOps === 'number') {
        pathFinderOpts.maxOps = ops.maxOps;
    }
    return pathFinderOpts;
}

function findSquadTemporalPath(leader, toPos, ops, key, severe, squadNames) {
    bypassRoomName = leader.room.name;
    if (!(bypassRoomName in costMatrixCache) && bypassRoomName in Game.rooms) {
        generateCostMatrix(Game.rooms[bypassRoomName], leader.pos);
    }
    userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;
    findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;
    const nearbyCreeps = leader.pos.findInRange(FIND_CREEPS, 5);
    bypassCostMat = getSquadCostMatrixForRoom(bypassRoomName, findPathIgnoreCondition).clone();
    if (severe) {
        for (let c of nearbyCreeps) {
            if (!squadNames.has(c.name)) {
                bypassCostMat.set(c.pos.x, c.pos.y, 10);
                bypassCostMat.set(c.pos.x + 1, c.pos.y, bypassCostMat.get(c.pos.x + 1, c.pos.y) === unWalkableCCost ? unWalkableCCost : 10);
                bypassCostMat.set(c.pos.x, c.pos.y + 1, bypassCostMat.get(c.pos.x, c.pos.y + 1) === unWalkableCCost ? unWalkableCCost : 10);
                bypassCostMat.set(c.pos.x + 1, c.pos.y + 1, bypassCostMat.get(c.pos.x + 1, c.pos.y + 1) === unWalkableCCost ? unWalkableCCost : 10);
            }
        }
    } else {
        for (let c of nearbyCreeps) {
            if (creepToSquad.has(c.name) && !rerouteSquad.has(c.name)) {
                bypassCostMat.set(c.pos.x, c.pos.y, unWalkableCCost);
                bypassCostMat.set(c.pos.x + 1, c.pos.y, unWalkableCCost);
                bypassCostMat.set(c.pos.x, c.pos.y + 1, unWalkableCCost);
                bypassCostMat.set(c.pos.x + 1, c.pos.y + 1, bypassCostMat.get(c.pos.x + 1, c.pos.y + 1) === unWalkableCCost ? unWalkableCCost : 5);
                leader.room.visual.circle(c.pos, { radius: 0.5, fill: 'red', opacity: 0.1 });
            }
        }
    }
    const pathFinderOpts = createSquadPathFinderOpts(ops, squadTemporalRoomCallback);
    const creepCache = creepPathCache[key];
    const range = typeof ops.range === 'number' ? ops.range : 0;
    let result = withScopedAvoids(ops, () => PathFinder.search(leader.pos, { pos: toPos, range }, pathFinderOpts));
    if (result.incomplete && result.path.length <= 1) {
        return false;
    }
    result = result.path;
    creepCache.path = {
        end: formalize(result[result.length - 1]),
        posArray: result,
        ignoreStructures: findPathIgnoreCondition
    };
    return true;
}

function squadRoomCallback(roomName) {
    if (isRoomAvoided(roomName)) {
        return false;
    }
    costMat = getSquadCostMatrixForRoom(roomName, findPathIgnoreCondition);
    if (userCostCallback) {
        const roomCache = costMatrixCache[roomName];
        let resultCostMat = userCostCallback(roomName, roomCache ? costMat.clone() : new PathFinder.CostMatrix);
        if (resultCostMat instanceof PathFinder.CostMatrix) {
            costMat = resultCostMat;
        }
    }
    return costMat;
}

function findSquadPath(fromPos, toPos, ops) {
    ensureAvoidRoomsUpToDate();
    if (!(fromPos.roomName in costMatrixCache) && fromPos.roomName in Game.rooms) {
        generateCostMatrix(Game.rooms[fromPos.roomName], fromPos);
    }

    findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;
    userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;
    const pathFinderOpts = createSquadPathFinderOpts(ops, squadRoomCallback);
    return withScopedAvoids(ops, () => PathFinder.search(fromPos, { pos: toPos, range: ops.range }, pathFinderOpts));
}

function isSquadNextStepBlocked(leaderNextPos, ignoreCondition) {
    if (!ignoreCondition || !(leaderNextPos.roomName in costMatrixCache)) {
        return false;
    }
    return getSquadCostMatrixForRoom(leaderNextPos.roomName, true).get(leaderNextPos.x, leaderNextPos.y) === unWalkableCCost;
}

function handleAutoPullForSquad(pathCache, squad, targets, someOneTired) {
    if (!someOneTired) {
        return OK;
    }
    for (let i = 0; i < squad.length; i++) {
        const creep = squad[i];
        if (!creep.fatigue) {
            continue;
        }
        const targetPos = formalizeIntentPos(targets[i]);
        for (let j = 0; j < squad.length; j++) {
            const helper = squad[j];
            const helperPos = formalizeIntentPos(helper.pos);
            if (helperPos.x !== targetPos.x || helperPos.y !== targetPos.y) {
                continue;
            }
            if (helper.name === creep.name) {
                break;
            }
            if (helper.fatigue) {
                pathCache.idx--;
                squadMove(squad);
                return ERR_TIRED;
            }
            helper.pull(creep);
            break;
        }
    }
    return OK;
}

function moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, visualStyle, toPos, someOneTired) {
    if (visualStyle) {
        showVisual(leader, toPos, creepCache.path.posArray, creepCache.idx, 1, visualStyle);
    }

    const posArray = creepCache.path.posArray;
    creepCache.idx++;
    const leaderNextPos = posArray[creepCache.idx];
    const formalPos = formalizeIntentPos(leaderNextPos);
    const targets = [];
    for (let i = 0; i < squad.length; i++) {
        let xdiff = creepPosArray[i].x - leaderPos.x;
        if (xdiff === -2) {
            if (leader.pos.x === 1) {
                if (formalPos.x > leaderPos.x) {
                    squadMove(squad);
                    return OK;
                }
            } else if (leaderNextPos.x === 49 && leader.pos.x === 0) {
                xdiff = -1;
            }
        }
        let ydiff = creepPosArray[i].y - leaderPos.y;
        if (ydiff === -2) {
            if (leader.pos.y === 1) {
                if (formalPos.y > leaderPos.y) {
                    squadMove(squad);
                    return OK;
                }
            } else if (leaderNextPos.y === 49 && leader.pos.y === 0) {
                ydiff = -1;
            }
        }

        const px = formalPos.x + xdiff;
        const py = formalPos.y + ydiff;
        targets.push(tile2Pos(packIntentTile({ x: px, y: py })));
    }
    if (isSquadNextStepBlocked(leaderNextPos, !!creepCache.path.ignoreStructures)) {
        creepCache.idx--;
        squadMove(squad);
        return ERR_FULL;
    }
    const pullCode = handleAutoPullForSquad(creepCache, squad, targets, someOneTired);
    if (pullCode !== OK) {
        return pullCode;
    }
    squadMove(squad, targets);
    return OK;
}

function moveOneStepReverse(creep, visualStyle, toPos) {    // deprecated
    let creepCache = creepPathCache[creep.name];
    if (visualStyle) {
        showVisual(creep, toPos, creepCache.path.posArray, creepCache.idx, -1, visualStyle);
    }
    if (creep.fatigue) {
        return ERR_TIRED;
    }
    creepMoveCache[creep.name] = Game.time;
    const targetPos = direction2Pos(creep.pos, creepCache.path.directionArray[creepCache.idx--]);
    if (targetPos) return registerMoveIntent(creep, formalizeIntentPos(targetPos));
}

function startSquadRoute(squad, leader, creepPosArray, leaderPos, pathCache, visualStyle, toPos, someOneTired) {
    const posArray = pathCache.path.posArray;

    let idx = 0;
    while (idx in posArray && isNear(leader.pos, posArray[idx])) {
        idx += 1;
    }
    idx -= 1;
    pathCache.idx = idx;

    if (visualStyle) {
        showVisual(leader, toPos, posArray, idx, 1, visualStyle);
    }
    creepMoveCache[leader.name] = Game.time;

    const leaderNextPos = posArray[idx];
    const formalPos = formalizeIntentPos(leaderNextPos);
    const targets = [];
    for (let i = 0; i < squad.length; i++) {
        let xdiff = creepPosArray[i].x - leaderPos.x;
        if (xdiff === -2) {
            if (leader.pos.x === 1) {
                if (formalPos.x > leaderPos.x) {
                    squadMove(squad);
                    return OK;
                }
            } else if (leaderNextPos.x === 49 && leader.pos.x === 0) {
                xdiff = -1;
            }
        }
        let ydiff = creepPosArray[i].y - leaderPos.y;
        if (ydiff === -2) {
            if (leader.pos.y === 1) {
                if (formalPos.y > leaderPos.y) {
                    squadMove(squad);
                    return OK;
                }
            } else if (leaderNextPos.y === 49 && leader.pos.y === 0) {
                ydiff = -1;
            }
        }

        const px = formalPos.x + xdiff;
        const py = formalPos.y + ydiff;
        targets.push(tile2Pos(packIntentTile({ x: px, y: py })));
    }
    if (isSquadNextStepBlocked(leaderNextPos, !!pathCache.path.ignoreStructures)) {
        pathCache.idx--;
        squadMove(squad);
        return ERR_FULL;
    }
    const pullCode = handleAutoPullForSquad(pathCache, squad, targets, someOneTired);
    if (pullCode !== OK) {
        return pullCode;
    }
    squadMove(squad, targets);
    return OK;
}

// ----------------------------------------------------------------------------
// 12) 原型包装入口：统计、去重、每 tick 维护
// ----------------------------------------------------------------------------
/**
 * @param {Function} fn
 */
const intentSolver = createIntentSolverModule({
    getOriginCancelOrderMethod,
    getOriginMoveMethod,
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
} = createCleanupModule({
    creepPathCache,
    pathCacheTimer,
    pathCacheTimerDueQueue,
    costMatrixCacheTimer,
    costMatrixCacheTimerDueQueue,
    costMatrixCache,
    costMatrixRevision,
    sameRoomEdgeCostMatCache,
    avoidRooms,
    getPathClearDelay() {
        return pathClearDelay;
    },
    deletePath,
    drainDueTickQueue,
    markAvoidRoomsChanged,
});

// ============================================================================
// 14) moveTo / move / flee 等核心流程
// ============================================================================

const defaultVisualizePathStyle = { fill: 'transparent', stroke: '#fff', lineStyle: 'dashed', strokeWidth: .15, opacity: .1 };

/**
 * 解析 moveTo 参数
 * @param {Creep} creep
 * @param {number | RoomObject} firstArg
 * @param {number | MoveToOpts} secondArg
 * @param {MoveToOpts} opts
 * @returns {{ toPos: RoomPosition, ops: MoveToOpts }}
 */
function resolveMoveToArgs(creep, firstArg, secondArg, opts) {
    if (typeof firstArg == 'object') {
        return {
            toPos: firstArg.pos || firstArg,
            ops: secondArg || {}
        };
    }
    return {
        toPos: { x: firstArg, y: secondArg, roomName: creep.room.name },
        ops: opts || {}
    };
}

/**
 * moveTo 参数默认值归一化
 * @param {MoveToOpts} ops
 * @returns {MoveToOpts}
 */
function normalizeMoveToOpts(ops) {
    ops.bypassHostileCreeps = ops.bypassHostileCreeps === undefined || ops.bypassHostileCreeps;    // 设置默认值为true
    ops.ignoreCreeps = ops.ignoreCreeps === undefined || ops.ignoreCreeps;
    if (typeof ops.bypassRange !== 'number') {
        ops.bypassRange = 5;
    }
    return ops;
}

/**
 * 初始化或清空 creep 路径缓存对象
 * @param {Creep} creep
 * @returns {CreepPaths['1']}
 */
function getOrInitCreepCache(creep) {
    let creepCache = creepPathCache[creep.name];
    if (!creepCache) {
        creepCache = {
            dst: { x: NaN, y: NaN },
            path: undefined,
            idx: 0,
            avoidSignature: ''
        };
        creepPathCache[creep.name] = creepCache;
    } else {
        creepCache.path = undefined;
    }
    return creepCache;
}

/**
 * 处理缓存 miss 后的“查缓存/寻路/写缓存/起步”完整流程
 * @param {Creep} creep
 * @param {RoomPosition} toPos
 * @param {MoveToOpts} ops
 * @param {CreepPaths['1']} creepCache
 * @returns {ScreepsReturnCode}
 */
function resolvePathAndStartRoute(creep, toPos, ops, creepCache) {
    if (typeof ops.range != 'number') {
        return ERR_INVALID_ARGS
    }

    const ttl = creep.ticksToLive;
    if (typeof ttl === 'number') {
        if (typeof ops.maxRooms === 'number') {
            const roomsBudget = Math.ceil(ttl / 50) + 2;
            const maxRoomsByTTL = Math.max(1, Math.min(64, roomsBudget));
            if (ops.maxRooms > maxRoomsByTTL) {
                ops.maxRooms = maxRoomsByTTL;
            }
            if (creep.pos.roomName !== toPos.roomName) {
                const needRooms = Game.map.getRoomLinearDistance(creep.pos.roomName, toPos.roomName, false) + 1;
                if (needRooms > ops.maxRooms) return ERR_NO_PATH;
            }
        }

        const a = formalize(creep.pos);
        const b = formalize(toPos);
        if (typeof a.x === 'number' && typeof a.y === 'number' && typeof b.x === 'number' && typeof b.y === 'number') {
            const dx = Math.abs(a.x - b.x);
            const dy = Math.abs(a.y - b.y);
            const lb = Math.max(dx, dy) - (ops.range || 0);
            if (lb > ttl) return ERR_NO_PATH;
        }
    }

    const fromFormalPos = formalize(creep.pos);
    const toFormalPos = formalize(toPos);
    const useScopedAvoids = !!(creepCache.avoidSignature && creepCache.avoidSignature.length);
    const found = useScopedAvoids ? false : (
        creep.pos.roomName == toPos.roomName ?
            findShortPathInCache(fromFormalPos, toFormalPos, creep.pos, toPos.roomName, creepCache, ops) :
            findLongPathInCache(fromFormalPos, toFormalPos, toPos.roomName, creepCache, ops)
    );
    if (found) {
        //creep.say('cached');
        //console.log(creep, creep.pos, 'hit');
        if (isCpuStatsEnabled()) runtimeMetrics.testCacheHits++;
    } else {  // 没找到缓存路
        if (isCpuStatsEnabled()) runtimeMetrics.testCacheMiss++;

        if (autoClearTick < Game.time) {  // 自动清理
            autoClearTick = Game.time;
            clearUnused();
        }

        let result = findPath(creep.pos, toPos, ops);
        if (!result.path.length || (result.incomplete && result.path.length == 1)) {     // 一步也动不了了
            //creep.say('no path')
            return ERR_NO_PATH;
        }
        result = result.path;
        result.unshift(creep.pos);

        //creep.say('start new');
        let newPath = {
            start: formalize(result[0]),
            end: formalize(result[result.length - 1]),
            posArray: result,
            ignoreRoads: !!ops.ignoreRoads,
            ignoreStructures: !!ops.ignoreDestructibleStructures,
            ignoreSwamps: !!ops.ignoreSwamps
        }
        ensurePathVersion(newPath);
        generateDirectionArray(newPath);
        if (!useScopedAvoids) {
            addPathIntoCache(newPath);
        }
        //console.log(creep, creep.pos, 'miss');
        creepCache.path = newPath;
    }

    if (typeof ttl === 'number') {
        const steps = (creepCache.path?.posArray?.length || 0) - 1;
        if (steps > ttl) {
            creepCache.path = undefined;
            creepCache.dst = undefined;
            return ERR_NO_PATH;
        }
    }

    creepCache.dst = toPos;
    setPathTimer(creepCache);

    if (isCpuStatsEnabled()) {
        found ? runtimeMetrics.cacheHitCost += Game.cpu.getUsed() - startCacheSearch : runtimeMetrics.cacheMissCost += Game.cpu.getUsed() - startCacheSearch;
    }

    return startRoute(creep, creepCache, ops, toPos, ops.ignoreCreeps);
}

// 14.1 临时绕路重试节流：同一堵点签名下按退避间隔触发 PathFinder
function getTemporalBypassRetryMinTicks() {
    return getPositiveConfigNumber(config.temporalBypassRetryMinTicks, 2);
}

function getTemporalBypassRetryMaxTicks() {
    const minTicks = getTemporalBypassRetryMinTicks();
    return Math.max(minTicks, getPositiveConfigNumber(config.temporalBypassRetryMaxTicks, 6));
}

function packRoomPos(pos) {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return -1;
    return ((pos.x & 63) << 6) | (pos.y & 63);
}

function buildTemporalBypassSignature(path, idx, curStep, toPos, ops) {
    const pathVersion = ensurePathVersion(path);
    const curPack = packRoomPos(curStep);
    const targetPack = packRoomPos(toPos);
    const range = typeof ops.range === 'number' ? ops.range : 1;
    const bypassRange = typeof ops.bypassRange === 'number' ? ops.bypassRange : 5;
    return `${pathVersion}|${idx}|${curStep.roomName}|${curPack}|${toPos.roomName}|${targetPack}|${range}|${bypassRange}|${ops.ignoreDestructibleStructures ? 1 : 0}`;
}

function shouldAttemptTemporalBypass(creepCache, signature) {
    if (!config.enableTemporalBypassRefine) {
        return true;
    }
    let state = creepCache._bmTemporalBypass;
    if (!state || state.signature !== signature) {
        creepCache._bmTemporalBypass = {
            signature,
            lastAttemptTick: -1,
            nextRetryTick: Game.time,
            failCount: 0
        };
        return true;
    }
    if (state.lastAttemptTick === Game.time) {
        return false;
    }
    return Game.time >= (state.nextRetryTick | 0);
}

function recordTemporalBypassResult(creepCache, signature, success) {
    if (!config.enableTemporalBypassRefine) {
        return;
    }
    let state = creepCache._bmTemporalBypass;
    if (!state || state.signature !== signature) {
        state = creepCache._bmTemporalBypass = {
            signature,
            lastAttemptTick: Game.time,
            nextRetryTick: Game.time + 1,
            failCount: 0
        };
    }
    state.lastAttemptTick = Game.time;
    if (success) {
        state.failCount = 0;
        state.nextRetryTick = Game.time + 1;
        return;
    }
    const nextFailCount = (state.failCount | 0) + 1;
    state.failCount = nextFailCount;
    const minTicks = getTemporalBypassRetryMinTicks();
    const maxTicks = getTemporalBypassRetryMaxTicks();
    const backoff = Math.min(maxTicks, minTicks + nextFailCount - 1);
    state.nextRetryTick = Game.time + backoff;
}

function moveTowardCachedStep(creep, curStep, ops, toPos, posArray, idx) {
    if (ops.visualizePathStyle) {
        showVisual(creep, toPos, posArray, idx, 1, ops.visualizePathStyle);
    }
    creepMoveCache[creep.name] = Game.time;
    return registerMoveIntent(creep, formalizeIntentMovePos(curStep), ops.priority);
}

/**
 *  尝试复用 creep 级路径缓存并推进一步
 *  @description 命中时会负责处理：正常前进/跨房检查/堵路对穿或绕路/偏离一格修正
 *  @param {Creep} creep
 *  @param {RoomPosition} toPos
 *  @param {MoveToOpts} ops
 *  @param {CreepPaths['1']} creepCache
 *  @returns {ScreepsReturnCode | null} 返回 null 表示需要重新寻路
 */
function tryMoveWithCreepCache(creep, toPos, ops, creepCache) {
    const path = creepCache.path;
    const idx = creepCache.idx;

    if (!path || !path.posArray || idx >= path.posArray.length || path.ignoreStructures != !!ops.ignoreDestructibleStructures) {
        return null;
    }

    const posArray = path.posArray;
    if (!(isEqual(toPos, creepCache.dst) || inRange(posArray[posArray.length - 1], toPos, ops.range))) {
        return null;
    }

    const curStep = posArray[idx];
    const nextStep = posArray[idx + 1];

    if (isEqual(creep.pos, curStep)) {    // 正常
        if (idx < posArray.length - 1) {
            return moveOneStep(creep, ops, toPos);
        }
        return null;
    }

    if (idx + 2 in posArray && isEqual(creep.pos, nextStep)) {  // 跨房了
        creepCache.idx++;
        if (!path.directionArray[idx + 2]) {  // 第一次见到该房则检查房间
            if (checkRoom(creep.room, path, creepCache.idx)) {   // 传creep所在位置的idx
                return moveOneStep(creep, ops, toPos);  // 路径正确，继续走
            }   // else 检查中发现房间里有建筑挡路，重新寻路
            deletePath(path);
            return null;
        }
        return moveOneStep(creep, ops, toPos);  // 路径正确，继续走
    }

    if (isNear(creep.pos, curStep)) {  // 堵路了
        if (Game.time - creepMoveCache[creep.name] >= 5) {
            if (isObstacleStructure(creep.room, curStep, ops.ignoreDestructibleStructures)) {
                delete costMatrixCache[creep.pos.roomName];
                delete costMatrixRevision[creep.pos.roomName];
                delete sameRoomEdgeCostMatCache[creep.pos.roomName];
                deletePath(path);
                return null;
            }
            if (findTemporalPath(creep, toPos, ops)) {
                if (isCpuStatsEnabled()) runtimeMetrics.testBypass++;
                return startRoute(creep, creepCache, ops, toPos);
            }
            creepMoveCache[creep.name] = Game.time;
            if (ops.visualizePathStyle) {
                showVisual(creep, toPos, posArray, idx, 1, ops.visualizePathStyle);
            }
            return registerMoveIntent(creep, formalizeIntentMovePos(curStep), ops.priority);
        }
        if (ops.visualizePathStyle) {
            showVisual(creep, toPos, posArray, idx, 1, ops.visualizePathStyle);
        }
        return registerMoveIntent(creep, formalizeIntentMovePos(curStep), ops.priority);
    }

    if (idx - 1 >= 0 && isNear(creep.pos, posArray[idx - 1])) {  // 因为堵路而被自动传送反向跨房了
        if (ops.visualizePathStyle) {
            showVisual(creep, toPos, posArray, idx, 1, ops.visualizePathStyle);
        }
        return registerMoveIntent(creep, formalizeIntentMovePos(posArray[idx - 1]), ops.priority);
    }

    return null; // 彻底偏离，重新寻路
}
/**
 *  把moveTo重写一遍
 * @param {Creep} this
 * @param {number | RoomObject} firstArg
 * @param {number | MoveToOpts} secondArg
 * @param {MoveToOpts} opts
 */
function betterMoveTo(firstArg, secondArg, opts) {
    if (powerCreepProto && this instanceof PowerCreep) {
        const pcMoveTo = getPowerCreepMoveToMethod();
        if (pcMoveTo) return pcMoveTo.apply(this, arguments);
        return originMoveTo.apply(this, arguments);
    }
    if (!this.my) {
        return ERR_NOT_OWNER;
    }

    if (this.spawning) {
        return ERR_BUSY;
    }


    // moveTo 调用临时变量（局部声明，避免跨调用串值）
    const args = resolveMoveToArgs(this, firstArg, secondArg, opts);
    let toPos = args.toPos;
    const rawOps = args.ops === undefined ? {} : args.ops;
    if (!validateMoveToArgTypes(rawOps)) {
        return ERR_INVALID_ARGS;
    }
    const ops = normalizeMoveToOpts(rawOps);
    const scopedAvoidSignature = getScopedAvoidSignature(ops);
    findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;

    const parsedTarget = parseShardRoomName(toPos.roomName);
    if (parsedTarget.shard && parsedTarget.shard === Game.shard.name) {
        // 同 shard 调用允许携带 shard 前缀：自动剥离，避免后续 parseRoomName/PathFinder 失败
        toPos = { x: toPos.x, y: toPos.y, roomName: parsedTarget.room };
    } else if (parsedTarget.shard && parsedTarget.shard !== Game.shard.name) {
        // 跨 shard 寻路：本 shard 只负责把 creep 送到通往目标 shard 的 portal
        scanPortals(false);
        let portal = pickPortalToShard(this.pos.roomName, parsedTarget.shard, parsedTarget.room);
        if (!portal) {
            scanPortals(true);
            portal = pickPortalToShard(this.pos.roomName, parsedTarget.shard, parsedTarget.room);
        }
        if (!portal) {
            const mem = this.memory._bmPortalSearch;

            let step = 0;
            let roomName = '';
            let until = 0;
            if (mem && mem.shard === parsedTarget.shard && typeof mem.until === 'number' && mem.until > Game.time && typeof mem.step === 'number') {
                step = mem.step;
                roomName = mem.roomName || '';
                until = mem.until;
                if (roomName && this.pos.roomName === roomName) {
                    step = step + 1;
                    roomName = '';
                }
            }
            if (!roomName) {
                const parse = (rn) => {
                    const m = /^([WE])(\d+)([NS])(\d+)$/.exec(rn);
                    if (!m) return null;
                    const hx = m[1];
                    const vx = m[3];
                    const xNum = Number(m[2]);
                    const yNum = Number(m[4]);
                    const x = hx === 'E' ? xNum : -xNum - 1;
                    const y = vx === 'S' ? yNum : -yNum - 1;
                    return { x, y };
                };
                const format = (x, y) => {
                    const hx = x >= 0 ? 'E' : 'W';
                    const vx = y >= 0 ? 'S' : 'N';
                    const xNum = x >= 0 ? x : -x - 1;
                    const yNum = y >= 0 ? y : -y - 1;
                    return `${hx}${xNum}${vx}${yNum}`;
                };

                const cur = parse(this.pos.roomName);
                if (!cur) return ERR_NO_PATH;

                const nearMul10 = (v) => {
                    const a = Math.floor(v / 10) * 10;
                    const b = Math.ceil(v / 10) * 10;
                    return a === b ? [a] : [a, b];
                };
                const xs = nearMul10(cur.x);
                const ys = nearMul10(cur.y);

                let baseX = xs[0];
                let baseY = ys[0];
                let best = Infinity;
                for (const x of xs) {
                    for (const y of ys) {
                        const d = Math.max(Math.abs(x - cur.x), Math.abs(y - cur.y));
                        if (d < best) {
                            best = d;
                            baseX = x;
                            baseY = y;
                        }
                    }
                }

                const radius = 10 * (Math.floor(step / 8) + 1);
                const dxs = [-radius, 0, radius];
                const dys = [-radius, 0, radius];
                const candidates = [];
                const seen = Object.create(null);
                for (const dx of dxs) {
                    for (const dy of dys) {
                        const rn = format(baseX + dx, baseY + dy);
                        if (rn === this.pos.roomName) continue;
                        if (seen[rn]) continue;
                        seen[rn] = 1;
                        const d = Game.map.getRoomLinearDistance(this.pos.roomName, rn, true);
                        candidates.push({ rn, d });
                    }
                }
                candidates.sort((a, b) => a.d - b.d);
                if (!candidates.length) return ERR_NO_PATH;

                roomName = candidates[0].rn;
            }
            until = Game.time + 100;
            this.memory._bmPortalSearch = { shard: parsedTarget.shard, roomName, step, until };
            if (Game.time % 25 === 0) this.say('PORTAL?');
            toPos = { x: 25, y: 25, roomName };
            if (ops.maxRooms === undefined) ops.maxRooms = 32;
            if (ops.range === undefined) ops.range = 20;
        }
        if (portal) {
            // portal 必须“踩上去”才会触发传送，因此强制 range=0，并允许 portal 格可走
            ops.range = 0;
            ops._bmAllowPortal = true;
            toPos = { x: portal.x, y: portal.y, roomName: portal.roomName };
        }
    }

    registerRoomBounceGuard(this, toPos.roomName);
    applySameRoomDetourCooldown(this, toPos, ops);

    if (config.autoVisual && !ops.visualizePathStyle) {
        // 自动绘制路径：调用方未传 visualizePathStyle 时注入默认样式
        ops.visualizePathStyle = {};
    }
    const moveToRange = ops.range === undefined ? 1 : ops.range;
    if (typeof toPos.x != "number" || typeof toPos.y != "number") {   // 房名无效或目的坐标不是数字，不合法
        //this.say('no tar');
        return ERR_INVALID_TARGET;
    } else if (inRange(this.pos, toPos, moveToRange)) {   // 已到达
        if (isEqual(toPos, this.pos) || ops.range) {  // 已到达
            return OK;
        } // else 走一步
        creepMoveCache[this.name] = Game.time;      // 用于防止自己移动后被误对穿
        if (isCpuStatsEnabled()) {
            runtimeMetrics.testNormal++;
            let t = Game.cpu.getUsed() - startTime;
            runtimeMetrics.normalLogicalCost += t > 0.2 ? t - 0.2 : t;
        }
        return registerMoveIntent(this, formalizeIntentPos(toPos), ops.priority);
    }
    if (ops.range === undefined) ops.range = 1;

    if (!hasActiveBodypart(this.body, MOVE)) {
        return ERR_NO_BODYPART;
    }

    if (this.fatigue) {
        if (!ops.visualizePathStyle) {    // 不用画路又走不动，直接return
            return ERR_TIRED;
        } // else 要画路，画完再return
    }


    let creepCache = creepPathCache[this.name];
    if (creepCache && (creepCache.avoidSignature || '') === scopedAvoidSignature) {  // 有缓存
        const code = tryMoveWithCreepCache(this, toPos, ops, creepCache);
        if (code !== null) {
            return code;
        }
    } // else 需要重新寻路，先找缓存路，找不到就寻路

    creepCache = getOrInitCreepCache(this);
    creepCache.avoidSignature = scopedAvoidSignature;
    return resolvePathAndStartRoute(this, toPos, ops, creepCache);
}

/**
 *
 * @param {DirectionConstant | Creep} target
 */
function betterMove(target) {
    if (powerCreepProto && this instanceof PowerCreep) {
        const pcMove = getPowerCreepMoveMethod();
        if (pcMove) return pcMove.call(this, target);
        return originMove.call(this, target);
    }
    if (!this.my) {
        return ERR_NOT_OWNER;
    }
    if (this.spawning) {
        return ERR_BUSY;
    }


    if (target && ((target instanceof Creep) || (powerCreepProto && target instanceof PowerCreep))) {
        if (!target.pos.isNearTo(this.pos)) {
            return ERR_NOT_IN_RANGE;
        }
        registerMoveIntent(this, formalizeIntentPos(target.pos));
        return OK;
    }

    if (this.fatigue > 0) {
        return ERR_TIRED;
    }
    if (!hasActiveBodypart(this.body, MOVE)) {
        return ERR_NO_BODYPART;
    }
    let direction = +target;
    if (!direction || direction < 1 || direction > 8) {
        return ERR_INVALID_ARGS;
    }
    const nextPos = direction2Pos(this.pos, direction);
    if (!nextPos) {
        return originMove.call(this, direction);
    }
    if (nextPos && Game.rooms[nextPos.roomName].getTerrain().get(nextPos.x, nextPos.y) !== TERRAIN_MASK_WALL) {
        registerMoveIntent(this, formalizeIntentPos(nextPos));
    }
    return OK;
}

function betterPull(target) {
    const ret = originPull.call(this, target);
    if (ret === OK) {
        registerSquad(this, target);
    }
    return ret;
}

function squadMove(squad, target) {
    if (squad.length <= 1 || squad.length > 9 || (target && target.length !== squad.length)) {
        return ERR_INVALID_ARGS;
    }
    if (target) {
        const firstPos = target[0].pos || target[0];
        const firstFormalPos = formalizeIntentPos(firstPos);
        if (firstPos.x === 0) {
            firstFormalPos.x--;
        } else if (firstPos.x === 49) {
            firstFormalPos.x++;
        } else if (firstPos.y === 0) {
            firstFormalPos.y--;
        } else if (firstPos.y === 49) {
            firstFormalPos.y++;
        }
        registerMoveIntent(squad[0], firstFormalPos);
        for (let i = squad.length; --i;) {
            const pos = target[i].pos || target[i];
            const formalPos = formalizeIntentPos(pos);
            if (pos.x === 0) {
                formalPos.x--;
            } else if (pos.x === 49) {
                formalPos.x++;
            } else if (pos.y === 0) {
                formalPos.y--;
            } else if (pos.y === 49) {
                formalPos.y++;
            }
            registerMoveIntent(squad[i], formalPos);
            registerSquad(squad[0], squad[i]);
        }
    } else {
        registerMoveIntent(squad[0], 0);
        for (let i = squad.length; --i;) {
            registerMoveIntent(squad[i], 0);
            registerSquad(squad[0], squad[i]);
        }
    }
}

function squadMoveTo(squad, firstArg, secondArg, opts) {
    let qx = 0;
    let qy = 0;
    let px;
    let py;
    let leader;
    let creepPosArray = [];
    let toPos;
    let moveOpts;
    if (squad.length !== 4) {
        return ERR_INVALID_ARGS;
    }
    if (typeof firstArg == 'object') {
        toPos = firstArg.pos || firstArg;
        moveOpts = secondArg === undefined ? {} : secondArg;
    } else {
        moveOpts = opts === undefined ? {} : opts;
    }
    if (!moveOpts || typeof moveOpts !== 'object') {
        return ERR_INVALID_ARGS;
    }
    moveOpts.enableAutoPull = moveOpts.enableAutoPull === undefined || moveOpts.enableAutoPull;
    let someOneTired = false;
    for (const creep of squad) {
        if (creep.my) {
            if (creep.spawning) {
                return ERR_BUSY;
            }
            if (creep.fatigue) {
                if (!moveOpts.enableAutoPull) {
                    squadMove(squad);
                    return ERR_TIRED;
                }
                someOneTired = true;
            }
            const pos = formalizeIntentPos(creep.pos);
            if (pos.x > qx || pos.y > qy) {
                qx = pos.x;
                qy = pos.y;
                px = creep.pos.x;
                py = creep.pos.y;
                leader = creep;
            }
            creepPosArray.push(pos);
        } else {
            return ERR_NOT_OWNER;
        }
    }
    let crossRoom = leader.pos.x === 0 || leader.pos.x === 49 || leader.pos.y === 0 || leader.pos.y === 49;
    for (const pos of creepPosArray) {
        if (pos.x > qx || pos.y > qy) {
            return ERR_NOT_IN_RANGE;
        } else if (qx - pos.x > 1 || qy - pos.y > 1) {
            if ((qx - pos.x === 2 && (px === 0 || px === 1) && qy - pos.y <= 1) || (qy - pos.y === 2 && (py === 0 || py === 1) && qx - pos.x <= 1)) {
                leader.say('跨房');
                crossRoom = true;
                continue;
            }
            return ERR_NOT_IN_RANGE;
        }
    }

    if (typeof firstArg != 'object') {
        toPos = { x: firstArg, y: secondArg, roomName: leader.room.name };
    }
    if (leader.pos.getRangeTo(toPos) === 0) {
        squadMove(squad);
        return OK;
    }
    findPathIgnoreCondition = !!moveOpts.ignoreDestructibleStructures;

    const leaderPos = { x: qx, y: qy, roomName: leader.room.name };
    const key = leader.name + '_quad';
    let creepCache = creepPathCache[key];
    if (creepCache) {
        if (isEqual(toPos, creepCache.dst)) {
            const path = creepCache.path;
            const idx = creepCache.idx;
            if (path && idx < path.posArray.length - 1 && path.ignoreStructures === findPathIgnoreCondition) {
                const posArray = path.posArray;
                if (crossRoom) {
                    if (idx + 2 < posArray.length && isNear(leader.pos, posArray[idx + 2])) {
                        creepCache.idx++;
                    }
                    if (leader.room.name in costMatrixCache || checkSquadRoom(leader.room, path, creepCache.idx)) {
                        creepMoveCache[leader.name] = Game.time;
                        return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, moveOpts.visualizePathStyle, toPos, someOneTired);
                    }
                } else if (isEqual(leader.pos, posArray[idx])) {
                    creepMoveCache[leader.name] = Game.time;
                    return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, moveOpts.visualizePathStyle, toPos, someOneTired);
                } else if (isNear(leader.pos, posArray[idx])) {
                    if (checkSquadTarget(creepPosArray, leaderPos, posArray[idx])) {
                        if (findSquadTemporalPath(leader, toPos, moveOpts, key)) {
                            leader.say('绕路');
                            for (const creep of squad) {
                                rerouteSquad.add(creep.name);
                            }
                            return startSquadRoute(squad, leader, creepPosArray, leaderPos, creepCache, moveOpts.visualizePathStyle, toPos, someOneTired);
                        }
                        leader.say('没路了');
                        squadMove(squad);
                        return ERR_NO_PATH;
                    } else if (isObstacleStructure(leader.room, posArray[idx], true)) {
                        leader.say('绕建筑');
                        delete costMatrixCache[leader.pos.roomName];
                    } else if (leader.name in creepMoveCache && creepMoveCache[leader.name] <= Game.time - 4) {
                        if (findSquadTemporalPath(leader, toPos, moveOpts, key, true, new Set(squad.map(c => c.name)))) {
                            leader.say('严重绕路');
                            for (const creep of squad) {
                                rerouteSquad.add(creep.name);
                            }
                            return startSquadRoute(squad, leader, creepPosArray, leaderPos, creepCache, moveOpts.visualizePathStyle, toPos, someOneTired);
                        }
                        leader.say('没路了');
                        squadMove(squad);
                        return ERR_NO_PATH;
                    } else {
                        leader.say(`${Game.time - creepMoveCache[leader.name]}`);
                        creepCache.idx--;
                        return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, moveOpts.visualizePathStyle, toPos, someOneTired);
                    }
                }
            }
        }
    } else {
        creepCache = {
            dst: { x: NaN, y: NaN },
            path: undefined,
            idx: 0
        };
        creepPathCache[key] = creepCache;
    }

    let result = findSquadPath(leader.pos, toPos, moveOpts);
    if (!result.path.length || (result.incomplete && result.path.length == 1)) {
        creepCache.path = undefined;
        squadMove(squad);
        return ERR_NO_PATH;
    }
    result = result.path;
    result.unshift(leader.pos);
    let newPath = {
        end: formalize(result[result.length - 1]),
        posArray: result,
        ignoreStructures: findPathIgnoreCondition
    };
    creepCache.path = newPath;
    creepCache.dst = toPos;
    return startSquadRoute(squad, leader, creepPosArray, leaderPos, creepCache, moveOpts.visualizePathStyle, toPos, someOneTired);
}

/**
 * @param {FindConstant} type
 * @param {FindPathOpts & FilterOptions<FIND_STRUCTURES> & { algorithm?: string }} opts
 */
function betterFindClosestByPath(type, opts) {
    if (!opts) {
        opts = {};
    }
    if (opts.ignoreCreeps === undefined) {
        opts = Object.assign({ ignoreCreeps: true }, opts);
    }
    return originFindClosestByPath.call(this, type, opts);
}

function getMemberPosSignature(memberPos) {
    if (!memberPos.length) {
        return '';
    }
    return memberPos.map((p) => `${p.x},${p.y}`).sort().join('|');
}

function getSquadDerivedMatCacheForThisTick() {
    if (typeof Game == 'undefined') {
        return null;
    }
    if (squadDerivedMatCacheTick !== Game.time) {
        squadDerivedMatCacheTick = Game.time;
        squadDerivedMatCache = Object.create(null);
    }
    return squadDerivedMatCache;
}

/**
 *  opts: memberPos:relativePos[], avoidTowersHigherThan:number, avoidObstaclesHigherThan:number
 * @param {RoomPosition | RoomObject} toPos
 * @param {*} opts
 */
function findSquadPathTo(toPos, opts) {
    ensureAvoidRoomsUpToDate();
    // 允许直接传 RoomObject，和原轮子 1.0.0 的对外接口保持一致。
    // 这里先统一解包成 RoomPosition，避免后续 PathFinder / costCallback
    // 分支在不同调用形态下出现行为分叉。
    const targetPos = toPos && toPos.pos ? toPos.pos : toPos;
    if (!targetPos || typeof targetPos.x != 'number' || typeof targetPos.y != 'number') {
        return [];
    }
    opts = opts || {};

    const range = typeof opts.range == 'number' ? opts.range : 1;
    const ignoreCondition = !!opts.ignoreDestructibleStructures;
    const memberPos = Array.isArray(opts.memberPos) ? opts.memberPos : [];
    const memberPosSignature = getMemberPosSignature(memberPos);

    const userCallback = typeof opts.costCallback == 'function' ? opts.costCallback : undefined;
    const derivedMatCache = userCallback ? Object.create(null) : (getSquadDerivedMatCacheForThisTick() || Object.create(null));

    const roomCallback = (roomName) => {
        if (isRoomAvoided(roomName)) {
            return false;
        }
        let base = roomName in costMatrixCache ? costMatrixCache[roomName][ignoreCondition] : emptyCostMatrix;
        if (userCallback) {
            let resultCostMat = userCallback(roomName, roomName in costMatrixCache ? base.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                base = resultCostMat;
            }
        }
        if (!memberPos.length) {
            return base;
        }
        const cacheKey = `${roomName}|${ignoreCondition ? 1 : 0}|${memberPosSignature}`;
        if (derivedMatCache[cacheKey]) {
            return derivedMatCache[cacheKey];
        }
        let derived = new PathFinder.CostMatrix;
        for (let y = 0; y < 50; y++) {
            for (let x = 0; x < 50; x++) {
                let blocked = false;
                for (let i = memberPos.length; i--;) {
                    const rel = memberPos[i];
                    const rx = x + rel.x;
                    const ry = y + rel.y;
                    if (rx < 0 || ry < 0 || rx > 49 || ry > 49 || base.get(rx, ry) == unWalkableCCost) {
                        blocked = true;
                        break;
                    }
                }
                if (blocked) {
                    derived.set(x, y, unWalkableCCost);
                } else {
                    const v = base.get(x, y);
                    if (v) {
                        derived.set(x, y, v);
                    }
                }
            }
        }
        derivedMatCache[cacheKey] = derived;
        return derived;
    };

    const PathFinderOpts = createPathFinderBaseOpts(opts);
    applyMoveToTerrainCosts(PathFinderOpts, opts);
    PathFinderOpts.roomCallback = roomCallback;
    PathFinderOpts.maxOps = opts.maxOps;

    return withScopedAvoids(opts, () => PathFinder.search(this, { pos: targetPos, range }, PathFinderOpts).path);
}

function flee(targets, opts) {
    ensureAvoidRoomsUpToDate();
    opts = opts || {};
    const range = typeof opts.range == 'number' ? opts.range : 5;
    const ignoreCondition = !!opts.ignoreDestructibleStructures;
    const userCallback = typeof opts.costCallback == 'function' ? opts.costCallback : undefined;

    if (!Array.isArray(targets) || !targets.length) {
        return ERR_INVALID_ARGS;
    }
    const goals = [];
    for (let i = targets.length; i--;) {
        const t = targets[i];
        if (!t) continue;
        if (t.pos && typeof t.pos.x == 'number') {
            goals.push({ pos: t.pos, range: typeof t.range == 'number' ? t.range : range });
        } else if (typeof t.x == 'number' && typeof t.y == 'number' && t.roomName) {
            goals.push({ pos: t, range });
        }
    }
    if (!goals.length) {
        return ERR_INVALID_ARGS;
    }

    const roomCallback = (roomName) => {
        if (isRoomAvoided(roomName)) {
            return false;
        }
        let base = roomName in costMatrixCache ? costMatrixCache[roomName][ignoreCondition] : emptyCostMatrix;
        if (userCallback) {
            let resultCostMat = userCallback(roomName, roomName in costMatrixCache ? base.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                base = resultCostMat;
            }
        }
        return base;
    };

    const PathFinderOpts = createPathFinderBaseOpts(opts);
    applyMoveToTerrainCosts(PathFinderOpts, opts);
    PathFinderOpts.roomCallback = roomCallback;
    PathFinderOpts.maxOps = opts.maxOps;
    PathFinderOpts.flee = true;

    const result = withScopedAvoids(opts, () => PathFinder.search(this.pos, goals, PathFinderOpts).path);
    if (!result.length) {
        return ERR_NO_PATH;
    }
    if (this.fatigue) {
        return ERR_TIRED;
    }
    creepMoveCache[this.name] = Game.time;
    return originMove.call(this, getDirection(this.pos, result[0]));
}

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

const pathingModule = createPathingModule({
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
    runtimeMetrics,
    routeCacheState,
    temporalAvoidState,
    observerState,
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
    setPathTimer,
    runMoveOptTickMaintenance,
} = pathingModule;

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


function bmGetAvoidRoomsMap() {
    return avoidRooms;
}

function bmGetAvoidExitsMap() {
    return avoidExits;
}

function bmAddAvoidRooms(roomName) {
    if (parseRoomName(roomName)) {
        if (!(roomName in avoidRooms)) {
            avoidRooms[roomName] = 1;
            markAvoidRoomsChanged();
        }
        return OK;
    } else {
        return ERR_INVALID_ARGS;
    }
}

function bmDeleteAvoidRooms(roomName) {
    if (parseRoomName(roomName) && avoidRooms[roomName]) {
        delete avoidRooms[roomName];
        markAvoidRoomsChanged();
        return OK;
    } else {
        return ERR_INVALID_ARGS;
    }
}

function bmClearAvoidExits(fromRoomName) {
    if (fromRoomName === undefined) {
        let changed = false;
        for (let key in avoidExits) {
            delete avoidExits[key];
            changed = true;
        }
        if (changed) {
            markAvoidExitsChanged();
        }
        return OK;
    }

    if (!parseRoomName(fromRoomName)) {
        return ERR_INVALID_ARGS;
    }
    if (!(fromRoomName in avoidExits)) {
        return ERR_NOT_FOUND;
    }
    delete avoidExits[fromRoomName];
    markAvoidExitsChanged();
    return OK;
}

function bmAddAvoidExits(fromRoomName, toRoomName) {
    if (!parseRoomName(fromRoomName) || !parseRoomName(toRoomName)) {
        return ERR_INVALID_ARGS;
    }
    avoidExits[fromRoomName]
        ? avoidExits[fromRoomName][toRoomName] = 1
        : avoidExits[fromRoomName] = { [toRoomName]: 1 };
    markAvoidExitsChanged();
    return OK;
}

function bmDeleteAvoidExits(fromRoomName, toRoomName) {
    if (!parseRoomName(fromRoomName) || !parseRoomName(toRoomName)) {
        return ERR_INVALID_ARGS;
    }
    if (fromRoomName in avoidExits && toRoomName in avoidExits[fromRoomName]) {
        delete avoidExits[fromRoomName][toRoomName];
    }
    markAvoidExitsChanged();
    return OK;
}

/**
 * clear runtime caches/state for hot-reload recovery
 * @param {{ clearAvoidRooms?: boolean, clearAvoidExits?: boolean, clearPortals?: boolean, rediscoverObservers?: boolean, resetStats?: boolean }} opts
 */
function bmClear(opts) {
    const options = (opts && typeof opts === 'object') ? opts : {};
    const clearAvoidRooms = !!options.clearAvoidRooms;
    const clearAvoidExitsFlag = !!options.clearAvoidExits;
    const clearPortals = !!options.clearPortals;
    const rediscoverObservers = options.rediscoverObservers !== false;
    const resetStats = options.resetStats !== false;

    clearObjectKeys(globalPathCache);
    clearObjectKeys(globalPathCacheByVariant);
    globalPathCacheBucketCount = 0;
    globalPathCachePathCount = 0;
    pathCacheInsertQueue.length = 0;
    pathCacheInsertHead = 0;
    clearObjectKeys(roomSameRoomPathRefs);
    clearObjectKeys(roomSameRoomPathCount);
    clearObjectKeys(roomStartKeyRefs);
    clearObjectKeys(roomStartKeyCount);
    clearObjectKeys(endKeyStartKeyRefs);
    clearObjectKeys(roomEndKeyRefs);
    clearObjectKeys(roomEndKeyCount);
    clearObjectKeys(pathCacheTimer);
    clearDueTickQueue(pathCacheTimerDueQueue);
    clearObjectKeys(creepPathCache);
    clearObjectKeys(creepMoveCache);
    clearObjectKeys(costMatrixCache);
    clearObjectKeys(costMatrixRevision);
    clearObjectKeys(costMatrixCacheTimer);
    clearDueTickQueue(costMatrixCacheTimerDueQueue);
    clearRouteCacheEntries();
    clearObjectKeys(routeCacheKeysByDueTick);
    clearDueTickQueue(routeCacheDueQueue);
    routeCacheTrackedTtl = -1;
    clearObjectKeys(bypassRouteCacheKeysByTick);
    clearDueTickQueue(bypassRouteCacheDueQueue);
    clearObjectKeys(bypassCostMatReuseCache);
    clearObjectKeys(temporalAvoidExitCache);
    temporalAvoidExitCacheTick = -1;
    temporalAvoidFrom = temporalAvoidTo = '';
    bounceAvoidFrom = bounceAvoidTo = '';
    bounceAvoidUntil = 0;
    clearObjectKeys(geometryCaches.roomNameParseCache);
    clearObjectKeys(geometryCaches.shardRoomNameParseCache);
    geometryCaches.tileToPosCache.clear();
    squadDerivedMatCacheTick = -1;
    clearObjectKeys(squadDerivedMatCache);
    resetMoveIntentState();
    // 清空缓存时同步把意图求解器恢复到默认检查器，避免热重载后残留自定义状态。
    setCheckTile(undefined);

    observers.length = 0;
    clearObjectKeys(obTimer);
    clearDueTickQueue(obTimerDueQueue);
    autoDiscoverObserverTick = -1;
    obTick = Game.time;
    if (rediscoverObservers) {
        ensureObserversUpToDate();
    }

    if (clearAvoidRooms) {
        clearObjectKeys(avoidRooms);
        clearObjectKeys(syncedBypassRooms);
        avoidRoomsMemoryInitialized = false;
        avoidRoomsMemorySignature = '';
        avoidRoomsSyncTick = -1;
        markAvoidRoomsChanged();
    }

    if (clearAvoidExitsFlag) {
        clearObjectKeys(avoidExits);
        markAvoidExitsChanged();
    }

    if (clearPortals) {
        global._bmPortals = { v: 1, list: [], updated: Game.time };
        resetPortalScanState();
    }

    if (resetStats) {
        resetMoveOptStats();
    }

    return OK;
}

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
