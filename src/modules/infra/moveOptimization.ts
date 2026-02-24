// @ts-nocheck

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
    changeMoveTo: true, // 全面优化creep.moveTo，跨房移动也可以一个moveTo解决问题
    changeFindClostestByPath: true,     // 轻度修改findClosestByPath，使得默认按照ignoreCreeps寻找最短
    autoVisual: false,  // 自动绘制路径
    enableCpuStats: false, // enable internal CPU statistics
    enableCacheStats: false, // enable route/path cache runtime statistics
    enableFlee: true,   // 是否启用 flee
    enableSquadPath: true, // 是否启用 findSquadPathTo
    enableRouteCache: true, // 是否启用寻路缓存
    routeCacheTTL: 200,     // 寻路缓存过期时间，设为undefined表示不清除缓存
    routeCacheGCInterval: 20, // legacy compatibility option (no-op after due-queue GC)
    routeCacheMaxEntries: 4000, // 非 bypass route cache 的最大条目数，超过后不再写入新键
    routeCacheMaxNewPerTick: 200, // 每 tick 最多写入多少个新的非 bypass route cache 键
    enableBypassCostMatReuse: true,  // 是否启用绕过房间的costMatrix缓存
    enableSameRoomDetourCooldown: true, // 同房目标发生“绕房又回房”后短暂收敛到 maxRooms=1，避免反复进出房间
    sameRoomDetourCooldownTTL: 15, // 冷却 tick 数（只影响未显式传 maxRooms 的调用）
    enableRoomBounceGuardV2: true, // 跨房 A->B->A 抖动抑制
    roomBounceWindow: 20, // 识别 bounce 的时间窗口
    roomBounceTTL: 100, // 识别到 bounce 后封禁该跨房方向的时长
    enableSameRoomDetourCooldownV2: true, // 同房目标绕出再回时，临时收敛 maxRooms
    sameRoomDetourBounceWindow: 20, // 识别“绕出再回”的时间窗口
    enableTemporalBypassRefine: true, // 堵路临时绕路的策略优化
    temporalAvoidExitCheckTTL: 1, // 临时出口可达性检测缓存时长（tick）
    temporalBypassRetryMinTicks: 2, // 临时绕路失败后的最小重试间隔
    temporalBypassRetryMaxTicks: 6, // 临时绕路失败后的最大重试间隔（线性退避上限）
    pathCacheMaxEntries: 12000, // 全局路径缓存上限，超过后按插入顺序增量淘汰
    pathCacheTrimBatch: 64, // 单次写入后最多淘汰多少条，避免抖动
    enableObserverQueueRefine: true, // Observer 任务队列优化
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
let portalScanTick = -1;
let portalPruneTick = -1;
const PORTAL_SCAN_INTERVAL = 20;
const PORTAL_ENTRY_TTL = 50000;

function getPortalRegistry() {
    if (!global._bmPortals || typeof global._bmPortals !== 'object') {
        global._bmPortals = { v: 1, list: [], updated: 0 };
    }
    if (!global._bmPortals.list || !Array.isArray(global._bmPortals.list)) {
        global._bmPortals.list = [];
    }
    return global._bmPortals;
}

function scanPortals(force) {
    if (!force) {
        if (portalScanTick !== -1 && (Game.time - portalScanTick) < PORTAL_SCAN_INTERVAL) return;
    }
    portalScanTick = Game.time;

    const reg = getPortalRegistry();
    const list = reg.list;
    const indexById = Object.create(null);
    for (let i = list.length; i--;) {
        const it = list[i];
        if (it && it.id) indexById[it.id] = it;
    }

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room) continue;
        const portals = room.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_PORTAL });
        if (!portals || !portals.length) continue;

        for (let i = portals.length; i--;) {
            const portal = portals[i];
            const id = portal.id;
            const dest = portal.destination;
            if (!dest) continue;

            let destShard = Game.shard && Game.shard.name ? Game.shard.name : '';
            let destRoom = '';
            let destX = 25;
            let destY = 25;

            if (typeof dest.shard === 'string') destShard = dest.shard;
            if (typeof dest.room === 'string') destRoom = dest.room;
            else if (typeof dest.roomName === 'string') destRoom = dest.roomName;
            if (typeof dest.x === 'number') destX = dest.x;
            if (typeof dest.y === 'number') destY = dest.y;

            if (!destRoom) continue;

            let entry = indexById[id];
            if (!entry) {
                entry = indexById[id] = {
                    id,
                    roomName: portal.pos.roomName,
                    x: portal.pos.x,
                    y: portal.pos.y,
                    destShard,
                    destRoom,
                    destX,
                    destY,
                    lastSeen: Game.time
                };
                list.push(entry);
            } else {
                entry.roomName = portal.pos.roomName;
                entry.x = portal.pos.x;
                entry.y = portal.pos.y;
                entry.destShard = destShard;
                entry.destRoom = destRoom;
                entry.destX = destX;
                entry.destY = destY;
                entry.lastSeen = Game.time;
            }
        }
    }

    reg.updated = Game.time;

    if (portalPruneTick === -1 || (Game.time - portalPruneTick) >= 1000) {
        portalPruneTick = Game.time;
        // 清理长期未见的 portal 记录，避免 global 膨胀
        for (let i = list.length; i--;) {
            const it = list[i];
            if (!it || !it.lastSeen || (Game.time - it.lastSeen) > PORTAL_ENTRY_TTL) {
                list.splice(i, 1);
            }
        }
    }
}

function pickPortalToShard(fromRoomName, targetShard, targetRoomName) {
    const reg = getPortalRegistry();
    const list = reg.list;
    if (!list || !list.length) return null;

    let best = null;
    let bestCost = Infinity;
    for (let i = list.length; i--;) {
        const p = list[i];
        if (!p || !p.destShard || p.destShard !== targetShard) continue;
        if (!p.roomName || !p.destRoom) continue;

        const a = Game.map.getRoomLinearDistance(fromRoomName, p.roomName);
        const b = Game.map.getRoomLinearDistance(p.destRoom, targetRoomName);
        const cost = a + b * 1.2;
        if (cost < bestCost) {
            bestCost = cost;
            best = p;
        }
    }
    return best;
}

/**
 * 同步avoidRooms从传入的数组
 * @param bypassRooms - 房间名数组
 */
export function syncAvoidRooms(bypassRooms: string[]): void {
    const nextBypassRooms: Record<string, 1> = Object.create(null);
    if (Array.isArray(bypassRooms)) {
        for (const roomName of bypassRooms) {
            if (typeof roomName !== 'string' || !roomName) continue;
            nextBypassRooms[roomName] = 1;
        }
    }

    let changed = false;

    // 仅删除“曾由 bypassRooms 同步进来且现在不需要了”的房间，避免误删运行时临时避让。
    for (const roomName in syncedBypassRooms) {
        if (!(roomName in nextBypassRooms)) {
            delete syncedBypassRooms[roomName];
            delete avoidRooms[roomName];
            changed = true;
        }
    }

    for (const roomName in nextBypassRooms) {
        syncedBypassRooms[roomName] = 1;
        if (!(roomName in avoidRooms)) {
            avoidRooms[roomName] = 1;
            changed = true;
        }
    }

    if (changed) {
        markAvoidRoomsChanged();
    }
}

// ============================================================================
// 3) 按需懒刷新：avoidRooms / observers（同 tick 去重）
// ============================================================================
function normalizeBypassRooms(rawBypassRooms) {
    if (!Array.isArray(rawBypassRooms) || !rawBypassRooms.length) {
        return [];
    }

    const dedup = Object.create(null);
    const normalized = [];
    for (let i = 0; i < rawBypassRooms.length; i++) {
        const roomName = rawBypassRooms[i];
        if (typeof roomName !== 'string' || !roomName || dedup[roomName]) continue;
        dedup[roomName] = 1;
        normalized.push(roomName);
    }
    normalized.sort();
    return normalized;
}

function isBypassRoomsStateConsistent(bypassRooms) {
    let syncedCount = 0;
    for (const roomName in syncedBypassRooms) {
        syncedCount++;
        if (!(roomName in avoidRooms)) {
            return false;
        }
    }
    if (syncedCount !== bypassRooms.length) {
        return false;
    }
    for (let i = 0; i < bypassRooms.length; i++) {
        const roomName = bypassRooms[i];
        if (!(roomName in syncedBypassRooms) || !(roomName in avoidRooms)) {
            return false;
        }
    }
    return true;
}

function ensureAvoidRoomsUpToDate() {
    if (avoidRoomsSyncTick === Game.time) {
        return;
    }
    avoidRoomsSyncTick = Game.time;

    const bypassRooms = normalizeBypassRooms(Memory['bypassRooms']);
    const nextSignature = bypassRooms.join('|');
    let needSync = !avoidRoomsMemoryInitialized || nextSignature !== avoidRoomsMemorySignature;
    if (!needSync && !isBypassRoomsStateConsistent(bypassRooms)) {
        needSync = true;
    }
    if (!needSync) {
        return;
    }

    avoidRoomsMemoryInitialized = true;
    avoidRoomsMemorySignature = nextSignature;
    syncAvoidRooms(bypassRooms);
}

/**
 * 自动发现并注册所有拥有的Observer结构
 */
export function autoDiscoverObservers(): void {
    const newObservers: { id: string; roomName: string; taskQueue: any[]; taskHead?: number }[] = [];

    for (const id in Game.structures) {
        const structure = Game.structures[id];
        if (structure.structureType === STRUCTURE_OBSERVER && structure.my) {
            const observer = structure as StructureObserver;
            // Check if this observer is already registered
            const existing = observers.find(ob => ob.id === id);
            if (existing) {
                if (typeof existing.taskHead !== 'number') {
                    existing.taskHead = 0;
                }
                newObservers.push(existing);
            } else {
                // Add new observer
                newObservers.push({ id, roomName: observer.room.name, taskQueue: [], taskHead: 0 });
            }
        }
    }

    // Replace observers array with auto-discovered ones
    observers.length = 0;
    for (const obs of newObservers) {
        observers.push(obs);
    }
}

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
const obstacles = Object.create(null);
for (let i = OBSTACLE_OBJECT_TYPES.length; i--;){
    obstacles[OBSTACLE_OBJECT_TYPES[i]] = 1;
}


const originMove = Creep.prototype.move;
const originMoveTo = Creep.prototype.moveTo;
const originFindClosestByPath = RoomPosition.prototype.findClosestByPath;

// 统计变量
let startTime;
let endTime;
let startCacheSearch;
let analyzeCPU = { // 统计相关函数总耗时
    move: { sum: 0, calls: 0 },
    moveTo: { sum: 0, calls: 0 },
    findClosestByPath: { sum: 0, calls: 0 }
};
let pathCounter = 0;
let testCacheHits = 0;
let testCacheMiss = 0;
let testNormal = 0;
let testNearStorageCheck = 0;
let testNearStorageSwap = 0;
let testTrySwap = 0;
let testBypass = 0;
let normalLogicalCost = 0;
let cacheHitCost = 0;
let cacheMissCost = 0;
let unWalkableCCost = 255;

// ============================================================================
// 5) 基础工具函数（坐标、房间名、几何关系等）
// ============================================================================

/**
 * 房间名解析缓存
 * @description moveOpt 内部会频繁对 roomName 做正则解析，这里做轻量缓存减少重复计算
 */
let roomNameParseCache = Object.create(null);
let shardRoomNameParseCache = Object.create(null);
cache.roomNameParseCache = roomNameParseCache;
cache.shardRoomNameParseCache = shardRoomNameParseCache;

/**
 * 解析房间名
 * @param {string} roomName
 * @returns {{ ew:'W'|'E', ewNum:number, ns:'N'|'S', nsNum:number, baseX:number, baseY:number } | null}
 */
function parseRoomName(roomName: string): { ew: 'W' | 'E'; ewNum: number; ns: 'N' | 'S'; nsNum: number; baseX: number; baseY: number; } | null {
    const cached = roomNameParseCache[roomName];
    if (cached !== undefined) return cached;
    const len = roomName.length;
    if (len < 4) {
        roomNameParseCache[roomName] = null;
        return null;
    }

    const ewCode = roomName.charCodeAt(0);
    if (ewCode !== 69 && ewCode !== 87) {
        roomNameParseCache[roomName] = null;
        return null;
    }

    let i = 1;
    let ewNum = 0;
    const ewStart = i;
    while (i < len) {
        const code = roomName.charCodeAt(i);
        if (code === 78 || code === 83) break;
        const digit = code - 48;
        if (digit < 0 || digit > 9) {
            roomNameParseCache[roomName] = null;
            return null;
        }
        ewNum = ewNum * 10 + digit;
        i++;
    }
    if (i === ewStart || i >= len) {
        roomNameParseCache[roomName] = null;
        return null;
    }

    const nsCode = roomName.charCodeAt(i);
    if (nsCode !== 78 && nsCode !== 83) {
        roomNameParseCache[roomName] = null;
        return null;
    }
    i++;
    if (i >= len) {
        roomNameParseCache[roomName] = null;
        return null;
    }

    let nsNum = 0;
    const nsStart = i;
    while (i < len) {
        const digit = roomName.charCodeAt(i) - 48;
        if (digit < 0 || digit > 9) {
            roomNameParseCache[roomName] = null;
            return null;
        }
        nsNum = nsNum * 10 + digit;
        i++;
    }
    if (i === nsStart) {
        roomNameParseCache[roomName] = null;
        return null;
    }

    let parsed = {
        ew: /** @type {'W'|'E'} */(ewCode === 87 ? 'W' : 'E'),
        ewNum,
        ns: /** @type {'N'|'S'} */(nsCode === 83 ? 'S' : 'N'),
        nsNum,
        baseX: (ewCode === 87 ? -ewNum : ewNum + 1) * 50,
        baseY: (nsCode === 83 ? nsNum + 1 : -nsNum) * 50
    };
    roomNameParseCache[roomName] = parsed;
    return parsed;
}
/**
 *  统一到大地图坐标，平均单次开销0.00005
 * @param {RoomPosition} pos
 */
function formalize(pos) {
    let parsed = parseRoomName(pos.roomName);
    if (parsed) {
        return { // 如果这里出现类型错误，那么意味着房间名字不是正确格式但通过了parse，小概率事件
            x: parsed.baseX + pos.x,
            y: parsed.baseY + pos.y
        }
    } // else 房间名字不是正确格式
    return {}
}

function getAdjacents(pos) {
    let posArray = [];
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            posArray.push({
                x: pos.x + i,
                y: pos.y + j
            })
        }
    }
    return posArray;
}

/**
 * 解析带 shard 前缀的房间名（约定格式：shardX/W1N1）
 * @param {string} roomName
 * @returns {{ shard: string | null, room: string }}
 */
function parseShardRoomName(roomName) {
    if (typeof roomName !== 'string') return { shard: null, room: roomName };
    const cached = shardRoomNameParseCache[roomName];
    if (cached !== undefined) return cached;
    const idx = roomName.indexOf('/');
    if (idx === -1) {
        const parsed = { shard: null, room: roomName };
        shardRoomNameParseCache[roomName] = parsed;
        return parsed;
    }
    const shard = roomName.slice(0, idx);
    const room = roomName.slice(idx + 1);
    const parsed = { shard: shard || null, room };
    shardRoomNameParseCache[roomName] = parsed;
    return parsed;
}

/**
 *  阉割版isEqualTo，提速
 * @param {RoomPosition} pos1
 * @param {RoomPosition} pos2
 */
function isEqual(pos1, pos2) {
    return pos1.x == pos2.x && pos1.y == pos2.y && pos1.roomName == pos2.roomName;
}

/**
 *  兼容房间边界
 *  参数具有x和y属性就行
 * @param {RoomPosition} pos1
 * @param {RoomPosition} pos2
 */
function isNear(pos1, pos2) {
    if (pos1.roomName == pos2.roomName) {    // undefined == undefined 也成立
        return -1 <= pos1.x - pos2.x && pos1.x - pos2.x <= 1 && -1 <= pos1.y - pos2.y && pos1.y - pos2.y <= 1;
    } else if (pos1.roomName && pos2.roomName) {    // 是完整的RoomPosition
        if (pos1.x + pos2.x != 49 && pos1.y + pos2.y != 49) return false;    // 肯定不是两个边界点, 0.00003 cpu
        // start
        let parsed1 = parseRoomName(pos1.roomName);
        let parsed2 = parseRoomName(pos2.roomName);
        if (parsed1 && parsed2) {
            // 统一到大地图坐标
            let formalizedEW = (parsed1.baseX + pos1.x) - (parsed2.baseX + pos2.x);
            let formalizedNS = (parsed1.baseY + pos1.y) - (parsed2.baseY + pos2.y);
            return -1 <= formalizedEW && formalizedEW <= 1 && -1 <= formalizedNS && formalizedNS <= 1;
        }
        // end - start = 0.00077 cpu
    }
    return false
}

/**
 * @param {RoomPosition} pos1
 * @param {RoomPosition} pos2
 */
function inRange(pos1, pos2, range) {
    if (pos1.roomName == pos2.roomName) {
        return -range <= pos1.x - pos2.x && pos1.x - pos2.x <= range && -range <= pos1.y - pos2.y && pos1.y - pos2.y <= range;
    }
    if (!pos1.roomName || !pos2.roomName) {
        return false;
    }
    let parsed1 = parseRoomName(pos1.roomName);
    let parsed2 = parseRoomName(pos2.roomName);
    if (!parsed1 || !parsed2) {
        return false;
    }
    let formalizedEW = (parsed1.baseX + pos1.x) - (parsed2.baseX + pos2.x);
    let formalizedNS = (parsed1.baseY + pos1.y) - (parsed2.baseY + pos2.y);
    return -range <= formalizedEW && formalizedEW <= range && -range <= formalizedNS && formalizedNS <= range;
}

function getClosestExitPos(fromPos, toRoomName) {
    if (!fromPos || !toRoomName) {
        return null;
    }
    const room = Game.rooms[fromPos.roomName];
    if (!room) {
        return null;
    }
    const exitDir = room.findExitTo(toRoomName);
    if (typeof exitDir !== 'number') {
        return null;
    }
    const exits = room.find(exitDir);
    if (!exits || !exits.length) {
        return null;
    }
    return fromPos.findClosestByRange(exits);
}

/**
 *  fromPos和toPos是pathFinder寻出的路径上的，只可能是同房相邻点或者跨房边界点
 * @param {RoomPosition} fromPos
 * @param {RoomPosition} toPos
 */
function getDirection(fromPos, toPos) {
    if (fromPos.roomName == toPos.roomName) {
        if (toPos.x > fromPos.x) {    // 下一步在右边
            if (toPos.y > fromPos.y) {    // 下一步在下面
                return BOTTOM_RIGHT;
            } else if (toPos.y == fromPos.y) { // 下一步在正右
                return RIGHT;
            }
            return TOP_RIGHT;   // 下一步在上面
        } else if (toPos.x == fromPos.x) { // 横向相等
            if (toPos.y > fromPos.y) {    // 下一步在下面
                return BOTTOM;
            } else if (toPos.y < fromPos.y) {
                return TOP;
            }
        } else {  // 下一步在左边
            if (toPos.y > fromPos.y) {    // 下一步在下面
                return BOTTOM_LEFT;
            } else if (toPos.y == fromPos.y) {
                return LEFT;
            }
            return TOP_LEFT;
        }
    } else {  // 房间边界点
        if (fromPos.x == 0 || fromPos.x == 49) {  // 左右相邻的房间，只需上下移动（左右边界会自动弹过去）
            if (toPos.y > fromPos.y) {   // 下一步在下面
                return BOTTOM;
            } else if (toPos.y < fromPos.y) { // 下一步在上
                return TOP
            } // else 正左正右
            return fromPos.x ? RIGHT : LEFT;
        } else if (fromPos.y == 0 || fromPos.y == 49) {    // 上下相邻的房间，只需左右移动（上下边界会自动弹过去）
            if (toPos.x > fromPos.x) {    // 下一步在右边
                return RIGHT;
            } else if (toPos.x < fromPos.x) {
                return LEFT;
            }// else 正上正下
            return fromPos.y ? BOTTOM : TOP;
        }
    }
}

// let reg2 = /^[WE]([0-9]+)[NS]([0-9]+)$/;    // parse得到['E28N7','28','7']
// let isHighWay = config.地图房号最大数字超过100 ?
//     (roomName) => {
//         let splited = reg2.exec(roomName);
//         return splited[1] % 10 == 0 || splited[2] % 10 == 0;
//     } :
//     (roomName) => {
//         // E0 || E10 || E1S0 || [E10S0|E1S10] || [E10S10] 比正则再除快
//         return roomName[1] == 0 || roomName[2] == 0 || roomName[3] == 0 || roomName[4] == 0 || roomName[5] == 0;
//     }

// 检查是否是高速公路（末位为0或N/S前一位为0）
// 只支持1000以内的房间号, 如果要扩展, 可在继续加匹配
let isHighWay = (roomName) => {
    // 1. 检查末位 (Y坐标个位)
    if (roomName.charCodeAt(roomName.length - 1) === 48) return true;

    // 2. 探测 N(78) 或 S(83) 的位置并检查前一位
    // Index 2 (例如 E1N1)
    let code = roomName.charCodeAt(2);
    if (code === 78 || code === 83) return roomName.charCodeAt(1) === 48;
    
    // Index 3 (例如 E10N1)
    code = roomName.charCodeAt(3);
    if (code === 78 || code === 83) return roomName.charCodeAt(2) === 48;
    
    // Index 4 (例如 E100N1)
    code = roomName.charCodeAt(4);
    if (code === 78 || code === 83) return roomName.charCodeAt(3) === 48;
    
    return false;
};

/**
 *  缓存的路径和当前moveTo参数相同
 * @param {MyPath} path
 * @param {*} ops
 */
function isSameOps(path, ops) {
    return path.ignoreRoads == !!ops.ignoreRoads &&
        path.ignoreSwamps == !!ops.ignoreSwamps &&
        path.ignoreStructures == !!ops.ignoreDestructibleStructures;
}

function getPathOpsSignature(ignoreRoads, ignoreSwamps, ignoreStructures) {
    let bits = 0;
    if (ignoreRoads) bits |= 1;
    if (ignoreSwamps) bits |= 2;
    if (ignoreStructures) bits |= 4;
    return bits;
}

function buildPathVariantKey(ignoreRoads, ignoreSwamps, ignoreStructures, endRoomName) {
    const opsSig = getPathOpsSignature(!!ignoreRoads, !!ignoreSwamps, !!ignoreStructures);
    return `${opsSig}|${endRoomName || ""}`;
}

function buildPathVariantKeyFromPath(path) {
    if (!path || !path.posArray || !path.posArray.length) return null;
    const endRoomName = path.posArray[path.posArray.length - 1].roomName || "";
    return buildPathVariantKey(path.ignoreRoads, path.ignoreSwamps, path.ignoreStructures, endRoomName);
}

function buildPathVariantKeyFromQuery(ops, toRoomName) {
    return buildPathVariantKey(ops.ignoreRoads, ops.ignoreSwamps, ops.ignoreDestructibleStructures, toRoomName);
}


function hasActiveBodypart(body, type) {
    if (!body) {
        return true;
    }

    for (var i = body.length - 1; i >= 0; i--) {
        if (body[i].hits <= 0)
            break;
        if (body[i].type === type)
            return true;
    }

    return false;

}

function isClosedRampart(structure) {
    return structure.structureType == STRUCTURE_RAMPART && !structure.my && !structure.isPublic;
}

/**
 *  查看是否有挡路建筑
 * @param {Room} room
 * @param {RoomPosition} pos
 * @param {boolean} ignoreStructures
 */
function isObstacleStructure(room, pos, ignoreStructures) {
    let consSite = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos);
    if (0 in consSite && consSite[0].my && obstacles[consSite[0].structureType]) {  // 工地会挡路
        return true;
    }
    const structures = room.lookForAt(LOOK_STRUCTURES, pos);
    for (let i = structures.length; i--;) {
        const s = structures[i];
        if (!s.hits || s.ticksToDeploy) {     // 是新手墙或者无敌中的invaderCore
            return true;
        } else if (!ignoreStructures && (obstacles[s.structureType] || isClosedRampart(s))) {
            return true
        }
    }
    return false;
    // let possibleStructures = room.lookForAt(LOOK_STRUCTURES, pos);  // room.lookForAt比pos.lookFor快
    // 万一有人把路修在extension上，导致需要每个建筑都判断，最多重叠3个建筑（rap+road+其他）
    // return obstacles.has(possibleStructures[0]) || obstacles.has(possibleStructures[1]) || obstacles.has(possibleStructures[2]);    // 条件判断平均每次0.00013cpu
}

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

/**
 *  尝试用ob检查路径
 */
function doObTask() {
    for (let i = observers.length - 1; i >= 0; i--) { // 遍历所有ob（倒序便于安全删除）
        const obData = observers[i];
        while (getObserverQueueSize(obData) > 0) {  // 没有task就pass
            const task = peekObserverTask(obData);
            if (!task) {
                dropObserverTask(obData);
                continue;
            }
            const roomName = task.roomName;
            if (isObserverTaskExpired(task) || isObserverTaskStale(task)) {
                // 任务过期或路径版本已失效，丢弃该任务避免浪费 ob/CPU
                dropObserverTask(obData);
                continue;
            }
            if (roomName in Game.rooms) { // 已有视野则无需 observeRoom，直接校验并补齐 direction
                const ok = checkRoom(Game.rooms[roomName], task.path, task.idx - 1); // checkRoom要传有direction的idx
                if (!ok) {
                    // OB 已确认堵路，立即失效该缓存路径，避免 creep 走到才重算
                    deletePath(task.path);
                }
                dropObserverTask(obData);
                continue;
            }
            if (roomName in costMatrixCache) {  // 有过视野不用再ob
                if (!task.path.directionArray[task.idx]) {
                    //console.log(roomName + ' 有视野了无需ob');
                    const ok = checkRoom({ name: roomName }, task.path, task.idx - 1);
                    if (!ok) {
                        // OB 校验发现堵路，立即失效该缓存路径
                        deletePath(task.path);
                    }
                }
                dropObserverTask(obData);
                continue;
            }
            /** @type {StructureObserver} */
            const ob = Game.getObjectById(obData.id);
            if (!ob) {
                observers.splice(i, 1);
                break;
            }
            //console.log('ob ' + roomName);
            const code = ob.observeRoom(roomName);
            if (code !== OK) {
                // observeRoom 失败（通常是参数/距离问题），丢弃该任务避免队列卡死
                dropObserverTask(obData);
                continue;
            }
            obData.lastIssuedTick = Game.time;
            const obDueTick = Game.time + 1;
            if (!(obDueTick in obTimer)) {
                obTimer[obDueTick] = [];
                enqueueDueTick(obTimerDueQueue, obDueTick);
            }
            obTimer[obDueTick].push({
                path: task.path,
                idx: task.idx,
                roomName: roomName,
                pathVersion: task.pathVersion,
                expireTick: task.expireTick
            });    // idx位置无direction
            dropObserverTask(obData);
            break;
        }
    }
}

/**
 *  查看ob得到的房间
 */
function checkObResult() {
    drainDueTickQueue(obTimerDueQueue, Game.time, (tick) => {
        if (tick < Game.time) {
            delete obTimer[tick];
            return;
        }
        const results = obTimer[tick];
        if (!results || !results.length) {
            delete obTimer[tick];
            return;
        }
        for (let i = results.length; i--;) {
            const result = results[i];
            if (isObserverTaskExpired(result) || isObserverTaskStale(result)) {
                continue;
            }
            if (result.roomName in Game.rooms) {
                const ok = checkRoom(Game.rooms[result.roomName], result.path, result.idx - 1);
                if (!ok) {
                    deletePath(result.path);
                }
            }
        }
        delete obTimer[tick];
    });
}

// ----------------------------------------------------------------------------
// 7) CostMatrix 构建与房间可行走性校验
// ----------------------------------------------------------------------------
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
    
    // 优化：避免创建大数组，分别遍历
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

    costMatrixCache[roomName] = {
        roomName: roomName,
        true: noStructureCostMat,   // 对应 ignoreDestructibleStructures = true
        false: structureCostMat     // 对应 ignoreDestructibleStructures = false
    };
    costMatrixRevision[roomName] = ((costMatrixRevision[roomName] | 0) + 1) | 0;

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
function trySwap(creep, pos, bypassHostileCreeps, ignoreCreeps) {     // ERR_NOT_FOUND开销0.00063，否则开销0.0066
    let obstacleCreeps = creep.room.lookForAt(LOOK_CREEPS, pos).concat(creep.room.lookForAt(LOOK_POWER_CREEPS, pos));
    if (obstacleCreeps.length) {
        if (!ignoreCreeps) {
            return ERR_INVALID_TARGET;
        }
        for (let i = obstacleCreeps.length; i--;) {
            const c = obstacleCreeps[i];
            if (c.my) {
                if (c.memory.dontPullMe) {    // 第1种不可穿情况：挡路的creep设置了不对穿
                    return ERR_INVALID_TARGET;
                }
                if (creepMoveCache[c.name] != Game.time && originMove.call(c, getDirection(pos, creep.pos)) == ERR_NO_BODYPART && creep.pull) {
                    creep.pull(c);
                    originMove.call(c, creep);
                }
            } else if (bypassHostileCreeps && (!c.room.controller || !c.room.controller.my || !c.room.controller.safeMode)) {  // 第二种不可穿情况：希望绕过敌对creep
                return ERR_INVALID_TARGET;
            }
        }
        if (isCpuStatsEnabled()) testTrySwap++;
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

function setRouteCacheEntry(key, entry) {
    const statsEnabled = isCacheStatsEnabled();
    if (!(key in routeCache)) {
        routeCacheEntryCount++;
        if (!entry.bypass) {
            routeCacheNonBypassEntryCount++;
        }
    }
    routeCache[key] = entry;
    if (statsEnabled) {
        routeCacheWriteStoreCount++;
    }
}

function removeRouteCacheEntry(key, reason) {
    const statsEnabled = isCacheStatsEnabled();
    if (!(key in routeCache)) return;
    const prev = routeCache[key];
    delete routeCache[key];
    if (routeCacheEntryCount > 0) {
        routeCacheEntryCount--;
    }
    if (prev && !prev.bypass && routeCacheNonBypassEntryCount > 0) {
        routeCacheNonBypassEntryCount--;
    }
    if (statsEnabled) {
        if (reason === 'bypass') routeCacheEvictBypassCount++;
        else if (reason === 'ttl') routeCacheEvictTTLCount++;
    }
}

function clearRouteCacheEntries() {
    for (let key in routeCache) {
        delete routeCache[key];
    }
    routeCacheEntryCount = 0;
    routeCacheNonBypassEntryCount = 0;
    routeCacheWriteTick = -1;
    routeCacheWriteCount = 0;
    routeCacheMaintainTick = -1;
}

function canCacheRouteKey(key) {
    const statsEnabled = isCacheStatsEnabled();
    if (key in routeCache) return true; // rewrite existing key is always allowed

    const maxEntries = config.routeCacheMaxEntries | 0;
    if (maxEntries > 0 && routeCacheNonBypassEntryCount >= maxEntries) {
        if (statsEnabled) routeCacheSkipByCapacityCount++;
        return false;
    }

    const maxNewPerTick = config.routeCacheMaxNewPerTick | 0;
    if (maxNewPerTick <= 0) {
        if (statsEnabled) routeCacheSkipByBudgetCount++;
        return false;
    }
    if (routeCacheWriteTick !== Game.time) {
        routeCacheWriteTick = Game.time;
        routeCacheWriteCount = 0;
    }
    if (routeCacheWriteCount >= maxNewPerTick) {
        if (statsEnabled) routeCacheSkipByBudgetCount++;
        return false;
    }
    routeCacheWriteCount++;
    return true;
}

function ensureRouteCacheMaintenance(force) {
    if (!force && routeCacheMaintainTick === Game.time) return;
    routeCacheMaintainTick = Game.time;
    clearExpiredRouteCache(force);
}

function trackRouteCacheKey(key, dueTick) {
    const tick = dueTick | 0;
    if (tick < 0) return;
    if (!(tick in routeCacheKeysByDueTick)) {
        routeCacheKeysByDueTick[tick] = [];
        enqueueDueTick(routeCacheDueQueue, tick);
    }
    routeCacheKeysByDueTick[tick].push(key);
}

function trackBypassRouteCacheKey(key) {
    if (!(Game.time in bypassRouteCacheKeysByTick)) {
        bypassRouteCacheKeysByTick[Game.time] = [];
        enqueueDueTick(bypassRouteCacheDueQueue, Game.time);
    }
    bypassRouteCacheKeysByTick[Game.time].push(key);
}

function clearExpiredBypassRouteCache() {
    const due = Game.time - 1;
    if (due < 0) return;
    drainDueTickQueue(bypassRouteCacheDueQueue, due, (tick) => {
        const keys = bypassRouteCacheKeysByTick[tick];
        if (keys && keys.length) {
            for (let i = keys.length; i--;) {
                removeRouteCacheEntry(keys[i], 'bypass');
            }
        }
        delete bypassRouteCacheKeysByTick[tick];
    });
}

function clearExpiredRouteCache(force) {
    clearExpiredBypassRouteCache();

    if (!config.enableRouteCache) {
        clearRouteCacheEntries();
        routeCacheTrackedTtl = -1;
        clearObjectKeys(routeCacheKeysByDueTick);
        clearDueTickQueue(routeCacheDueQueue);
        clearObjectKeys(bypassRouteCacheKeysByTick);
        clearDueTickQueue(bypassRouteCacheDueQueue);
        return;
    }

    const ttl = config.routeCacheTTL | 0;
    if (ttl <= 0) {
        routeCacheTrackedTtl = ttl;
        clearObjectKeys(routeCacheKeysByDueTick);
        clearDueTickQueue(routeCacheDueQueue);
        return;
    }

    if (routeCacheTrackedTtl !== ttl) {
        routeCacheTrackedTtl = ttl;
        clearObjectKeys(routeCacheKeysByDueTick);
        clearDueTickQueue(routeCacheDueQueue);
        for (let key in routeCache) {
            const entry = routeCache[key];
            if (!entry || entry.bypass) continue;
            if ((Game.time - (entry.tick | 0)) > ttl) {
                removeRouteCacheEntry(key, 'ttl');
                continue;
            }
            trackRouteCacheKey(key, (entry.tick | 0) + ttl + 1);
        }
    }

    if (force) {
        for (let key in routeCache) {
            const entry = routeCache[key];
            if (!entry || entry.bypass) continue;
            if ((Game.time - (entry.tick | 0)) > ttl) {
                removeRouteCacheEntry(key, 'ttl');
            }
        }
        return;
    }

    drainDueTickQueue(routeCacheDueQueue, Game.time, (tick) => {
        const keys = routeCacheKeysByDueTick[tick];
        if (keys && keys.length) {
            for (let i = keys.length; i--;) {
                const key = keys[i];
                const entry = routeCache[key];
                if (!entry || entry.bypass) continue;
                if ((Game.time - (entry.tick | 0)) > ttl) {
                    removeRouteCacheEntry(key, 'ttl');
                }
            }
        }
        delete routeCacheKeysByDueTick[tick];
    });
}

function getRouteCacheKey(fromRoomName, toRoomName, bypass) {
    if (!bypass) {
        return `${fromRoomName}|${toRoomName}|0|${avoidRoomsVersion}|${avoidExitsVersion}`;
    }
    return `${fromRoomName}|${toRoomName}|1|${avoidRoomsVersion}|${avoidExitsVersion}|${temporalAvoidFrom}|${temporalAvoidTo}|${bounceAvoidFrom}|${bounceAvoidTo}|${bounceAvoidUntil || 0}|${Game.time}`;
}

function routeCallback(nextRoomName, fromRoomName) {    // 避开avoidRooms设置了的
    if (fromRoomName && avoidExits[fromRoomName] && avoidExits[fromRoomName][nextRoomName]) {
        return Infinity;
    }
    if (nextRoomName in avoidRooms) {
        //console.log('Infinity at ' + nextRoomName);
        return Infinity;
    }
    return isHighWay(nextRoomName) ? 1 : 1.15;
}
function bypassRouteCallback(nextRoomName, fromRoomName) {
    if (fromRoomName == temporalAvoidFrom && nextRoomName == temporalAvoidTo) {
        //console.log(`Infinity from ${fromRoomName} to ${nextRoomName}`);
        return Infinity;
    }
    if (bounceAvoidUntil && Game.time <= bounceAvoidUntil && fromRoomName == bounceAvoidFrom && nextRoomName == bounceAvoidTo) {
        return Infinity;
    }
    return routeCallback(nextRoomName, fromRoomName);
}
/**
 *  遇到跨房寻路，先以房间为单位寻route，再寻精细的path
 * @param {string} fromRoomName
 * @param {string} toRoomName
 * @param {boolean} bypass
 */
function findRoute(fromRoomName, toRoomName, bypass) {  // supports shard-prefixed room names; cross-shard returns ERR_NO_PATH
    //console.log('findRoute', fromRoomName, toRoomName, bypass);
    const currentShard = Game.shard?.name;
    const parsedFrom = parseShardRoomName(fromRoomName);
    const parsedTo = parseShardRoomName(toRoomName);
    if ((parsedFrom.shard && parsedFrom.shard !== currentShard) || (parsedTo.shard && parsedTo.shard !== currentShard)) {
        return ERR_NO_PATH;
    }
    fromRoomName = parsedFrom.room;
    toRoomName = parsedTo.room;

    ensureAvoidRoomsUpToDate();
    ensureRouteCacheMaintenance(false);
    if (config.enableRouteCache) {
        const statsEnabled = isCacheStatsEnabled();
        const key = getRouteCacheKey(fromRoomName, toRoomName, bypass);
        const cached = routeCache[key];
        const ttl = config.routeCacheTTL | 0;
        if (statsEnabled) {
            routeCacheLookupCount++;
        }
        if (cached && (bypass || ttl <= 0 || (Game.time - cached.tick) <= ttl)) {
            if (statsEnabled) {
                routeCacheHitCount++;
            }
            return cached.route;
        }
        const result = bypass
            ? Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: bypassRouteCallback })
            : Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: routeCallback });
        const routeTick = Game.time;
        if (!bypass && !canCacheRouteKey(key)) {
            return result;
        }
        setRouteCacheEntry(key, { tick: routeTick, route: result, bypass: bypass ? 1 : 0 });
        if (bypass) {
            trackBypassRouteCacheKey(key);
        } else if (ttl > 0) {
            trackRouteCacheKey(key, routeTick + ttl + 1);
        }
        return result;
    }
    if (bypass) {
        return Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: bypassRouteCallback });
    }
    return Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: routeCallback });
}

/**
 * @param {RoomPosition} pos
 * @param {Room} room
 * @param {CostMatrix} costMat
 * @param {string | undefined} targetRoomName
 */
function checkTemporalAvoidExit(pos, room, costMat, targetRoomName) {    // 用于记录因creep堵路导致的房间出口临时封闭
    temporalAvoidFrom = temporalAvoidTo = '';   // 清空旧数据

    const cacheTTL = getPositiveConfigNumber(config.temporalAvoidExitCheckTTL, 1);
    if (temporalAvoidExitCacheTick === -1 || (Game.time - temporalAvoidExitCacheTick) >= cacheTTL) {
        temporalAvoidExitCacheTick = Game.time;
        temporalAvoidExitCache = Object.create(null);
    }

    const cacheKey = `${room.name}|${pos.x}|${pos.y}|${targetRoomName || ''}`;
    if (cacheKey in temporalAvoidExitCache) {
        const cached = temporalAvoidExitCache[cacheKey];
        if (cached) {
            temporalAvoidFrom = room.name;
            temporalAvoidTo = cached;
        }
        return;
    }

    const neighbors = Game.map.describeExits(room.name);
    const refine = !!config.enableTemporalBypassRefine;

    if (!refine) {
        for (let direction in neighbors) {
            const nextRoom = neighbors[direction];
            if (nextRoom in avoidRooms) continue;
            const exits = room.find(+direction);
            if (PathFinder.search(pos, exits, {
                maxRooms: 1,
                roomCallback: () => costMat
            }).incomplete) {    // 此路不通
                temporalAvoidFrom = room.name;
                temporalAvoidTo = nextRoom;
            }
        }
        temporalAvoidExitCache[cacheKey] = temporalAvoidTo || '';
        return;
    }

    const exitCandidates = [];
    for (let direction in neighbors) {
        const nextRoom = neighbors[direction];
        if (!nextRoom || nextRoom in avoidRooms) continue;
        const score = targetRoomName ? Game.map.getRoomLinearDistance(nextRoom, targetRoomName, true) : 0;
        exitCandidates.push({ direction: +direction, nextRoom, score });
    }
    exitCandidates.sort((a, b) => a.score - b.score);

    for (let i = 0; i < exitCandidates.length; i++) {
        const candidate = exitCandidates[i];
        const exits = room.find(candidate.direction);
        if (PathFinder.search(pos, exits, {
            maxRooms: 1,
            roomCallback: () => costMat
        }).incomplete) {    // 此路不通
            temporalAvoidFrom = room.name;
            temporalAvoidTo = candidate.nextRoom;
            break;
        }
    }

    temporalAvoidExitCache[cacheKey] = temporalAvoidTo || '';
}
function buildRouteRoomSet(routeList, startRoomName) {
    const roomSet = Object.create(null);
    roomSet[startRoomName] = 1;
    for (let i = routeList.length; i--;) {
        roomSet[routeList[i].room] = 1;
    }
    return roomSet;
}
function bypassHostile(creep) {
    return !creep.my || creep.memory.dontPullMe;
}
function bypassMy(creep) {
    return creep.my && creep.memory.dontPullMe;
}

// ----------------------------------------------------------------------------
// 9) PathFinder 组装：临时 costMatrix、roomCallback 与通用参数
// ----------------------------------------------------------------------------
let bypassRoomName, bypassCostMat, bypassIgnoreCondition, userCostCallback, costMat, route;
let bypassCostMatReuseCache = Object.create(null);
let findPathPortalPos = null;
let findPathPortalMat = null;
let findPathAllowPortal = false;

function getReusableBypassCostMatrix(roomName, ignoreCondition) {
    const key = `${roomName}|${ignoreCondition ? 1 : 0}`;
    const baseRev = costMatrixRevision[roomName] | 0;
    let entry = bypassCostMatReuseCache[key];
    if (!entry || entry.tick !== Game.time || entry.baseRev !== baseRev) {
        entry = bypassCostMatReuseCache[key] = {
            tick: Game.time,
            baseRev,
            mat: costMatrixCache[roomName][ignoreCondition].clone(),
            changedKeys: [],
            oldCosts: []
        };
    } else {
        entry.changedKeys.length = 0;
        entry.oldCosts.length = 0;
    }
    return entry;
}

function applyTemporaryCreepBlocks(mat, creeps, changedKeys, oldCosts) {
    for (let i = creeps.length; i--;) {
        const c = creeps[i];
        const x = c.pos.x;
        const y = c.pos.y;
        const k = x * 50 + y;
        changedKeys.push(k);
        oldCosts.push(mat.get(x, y));
        mat.set(x, y, unWalkableCCost);
    }
}

function rollbackTemporaryCreepBlocks(mat, changedKeys, oldCosts) {
    for (let i = changedKeys.length; i--;) {
        const k = changedKeys[i];
        const x = (k / 50) | 0;
        const y = k - x * 50;
        mat.set(x, y, oldCosts[i]);
    }
}

function createPathFinderBaseOpts(ops) {
    return {
        maxRooms: ops.maxRooms,
        maxCost: ops.maxCost,
        heuristicWeight: ops.heuristicWeight || 1.2
    };
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

function bypassRoomCallback(roomName) {
    if (roomName in avoidRooms) {
        return false;
    }
    if (roomName == bypassRoomName) {     // 在findTemporalRoute函数里刚刚建立了costMatrix
        costMat = bypassCostMat;
    } else {
        costMat = roomName in costMatrixCache ? costMatrixCache[roomName][findPathIgnoreCondition] : emptyCostMatrix;
    }

    if (userCostCallback) {
        let resultCostMat = userCostCallback(roomName, roomName in costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix);
        if (resultCostMat instanceof PathFinder.CostMatrix) {
            costMat = resultCostMat;
        }
    }
    return costMat;
}
function bypassRoomCallbackWithRoute(roomName) {
    if (roomName in route) {
        if (roomName == bypassRoomName) {     // 在findTemporalRoute函数里刚刚建立了costMatrix
            costMat = bypassCostMat;
        } else {
            costMat = roomName in costMatrixCache ? costMatrixCache[roomName][findPathIgnoreCondition] : emptyCostMatrix;
        }

        if (userCostCallback) {
            let resultCostMat = userCostCallback(roomName, roomName in costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                costMat = resultCostMat;
            }
        }
        return costMat;
    }
    return false;
}
/**
 *  影响参数：bypassHostileCreeps, ignoreRoads, ignoreDestructibleStructures, ignoreSwamps, costCallback, range, bypassRange
 *  及所有PathFinder参数：plainCost, SwampCost, masOps, maxRooms, maxCost, heuristicWeight
 * @param {Creep} creep
 * @param {RoomPosition} toPos
 * @param {MoveToOpts} ops
 */
function findTemporalPath(creep, toPos, ops) {
    ensureAvoidRoomsUpToDate();
    let nearbyCreeps;
    if (ops.ignoreCreeps) { // 有ignoreCreep，只绕过无法对穿的creep
        nearbyCreeps = creep.pos.findInRange(FIND_CREEPS, ops.bypassRange, {
            filter: ops.bypassHostileCreeps ? bypassHostile : bypassMy
        }).concat(creep.pos.findInRange(FIND_POWER_CREEPS, ops.bypassRange, {
            filter: ops.bypassHostileCreeps ? bypassHostile : bypassMy
        }));
    } else {    // 绕过所有creep
        nearbyCreeps = creep.pos.findInRange(FIND_CREEPS, ops.bypassRange).concat(
            creep.pos.findInRange(FIND_POWER_CREEPS, ops.bypassRange)
        )
    }
    if (!(creep.room.name in costMatrixCache)) { // 这个房间的costMatrix已经被删了
        generateCostMatrix(creep.room, creep.pos);
    }
    bypassIgnoreCondition = !!ops.ignoreDestructibleStructures;
    let reuseEntry;
    if (config.enableBypassCostMatReuse) {
        reuseEntry = getReusableBypassCostMatrix(creep.room.name, bypassIgnoreCondition);
        bypassCostMat = reuseEntry.mat;
        applyTemporaryCreepBlocks(bypassCostMat, nearbyCreeps, reuseEntry.changedKeys, reuseEntry.oldCosts);
    } else {
        bypassCostMat = costMatrixCache[creep.room.name][bypassIgnoreCondition].clone();
        for (let i = nearbyCreeps.length; i--;) {
            const c = nearbyCreeps[i];
            bypassCostMat.set(c.pos.x, c.pos.y, unWalkableCCost);
        }
    }
    bypassRoomName = creep.room.name;
    userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;

    /**@type {PathFinderOpts} */
    let PathFinderOpts = createPathFinderBaseOpts(ops);
    applyMoveToTerrainCosts(PathFinderOpts, ops);

    try {
        if (creep.pos.roomName != toPos.roomName) { // findRoute会导致非最优path的问题
            checkTemporalAvoidExit(creep.pos, creep.room, bypassCostMat, toPos.roomName);   // 因为creep挡路导致的无法通行的出口
            route = findRoute(creep.pos.roomName, toPos.roomName, true);
            if (route == ERR_NO_PATH) {
                return false;
            }
            PathFinderOpts.maxRooms = PathFinderOpts.maxRooms || route.length + 1;
            PathFinderOpts.maxOps = ops.maxOps || 4000 + route.length ** 2 * 100;  // 跨10room则有4000+10*10*100=14000
            route = buildRouteRoomSet(route, creep.pos.roomName);     // 路由房间集合，用于 roomCallback 快速判定
            PathFinderOpts.roomCallback = bypassRoomCallbackWithRoute;
        } else {
            PathFinderOpts.maxOps = ops.maxOps;
            PathFinderOpts.roomCallback = bypassRoomCallback;
        }

        let result = PathFinder.search(creep.pos, { pos: toPos, range: ops.range }, PathFinderOpts).path;
        if (result.length) {
            let creepCache = creepPathCache[creep.name];
            creepCache.path = {     // 弄个新的自己走，不修改公用的缓存路，只会用于正向走所以也不需要start属性，idx属性会在startRoute中设置
                end: formalize(result[result.length - 1]),
                posArray: result,
                ignoreStructures: !!ops.ignoreDestructibleStructures
            }
            ensurePathVersion(creepCache.path);
            generateDirectionArray(creepCache.path);
            return true;
        }
        return false;
    } finally {
        if (reuseEntry) {
            rollbackTemporaryCreepBlocks(bypassCostMat, reuseEntry.changedKeys, reuseEntry.oldCosts);
        }
    }
}

let findPathIgnoreCondition;
/**
 * @param {{[roomName:string]:1}} temp
 * @param {{room:string}} item
 * @returns {{[roomName:string]:1}}
 */
function roomCallback(roomName) {
    if (roomName in avoidRooms) {
        return false;
    }

    costMat = roomName in costMatrixCache ? costMatrixCache[roomName][findPathIgnoreCondition] : emptyCostMatrix;
    if (userCostCallback) {
        let resultCostMat = userCostCallback(roomName, roomName in costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix);
        if (resultCostMat instanceof PathFinder.CostMatrix) {
            costMat = resultCostMat;
        }
    }
    if (findPathAllowPortal && findPathPortalPos && roomName === findPathPortalPos.roomName) {
        if (!findPathPortalMat) {
            // 跨 shard 走 portal：允许把 portal 这一格视为可走，否则路径无法踩上 portal 触发传送
            findPathPortalMat = costMat.clone();
            findPathPortalMat.set(findPathPortalPos.x, findPathPortalPos.y, 1);
        }
        return findPathPortalMat;
    }
    return costMat;
}
function roomCallbackWithRoute(roomName) {
    if (roomName in route) {
        costMat = roomName in costMatrixCache ? costMatrixCache[roomName][findPathIgnoreCondition] : emptyCostMatrix;
        //console.log('in route ' + roomName);
        if (userCostCallback) {
            let resultCostMat = userCostCallback(roomName, roomName in costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                costMat = resultCostMat;
            }
        }
        if (findPathAllowPortal && findPathPortalPos && roomName === findPathPortalPos.roomName) {
            if (!findPathPortalMat) {
                // 跨 shard 走 portal：允许把 portal 这一格视为可走，否则路径无法踩上 portal 触发传送
                findPathPortalMat = costMat.clone();
                findPathPortalMat.set(findPathPortalPos.x, findPathPortalPos.y, 1);
            }
            return findPathPortalMat;
        }
        return costMat;
    }
    //console.log('out route ' + roomName);
    return false;   // 不在route上的不搜索
}
/**
 *  影响参数：ignoreRoads, ignoreDestructibleStructures, ignoreSwamps, costCallback, range
 *  及所有PathFinder参数：plainCost, SwampCost, masOps, maxRooms, maxCost, heuristicWeight
 * @param {RoomPosition} fromPos
 * @param {RoomPosition} toPos
 * @param {MoveToOpts} ops
 */
function findPath(fromPos, toPos, ops) {
    ensureAvoidRoomsUpToDate();

    if (!(fromPos.roomName in costMatrixCache) && fromPos.roomName in Game.rooms) {   // 有视野没costMatrix
        generateCostMatrix(Game.rooms[fromPos.roomName], fromPos);
    }

    findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;
    userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;
    findPathAllowPortal = !!ops._bmAllowPortal;
    findPathPortalPos = findPathAllowPortal ? toPos : null;
    findPathPortalMat = null;

    /**@type {PathFinderOpts} */
    let PathFinderOpts = createPathFinderBaseOpts(ops);
    applyMoveToTerrainCosts(PathFinderOpts, ops);

    if (fromPos.roomName != toPos.roomName) {   // findRoute会导致非最优path的问题
        route = findRoute(fromPos.roomName, toPos.roomName);
        if (route == ERR_NO_PATH) {
            return { path: [] };
        }
        PathFinderOpts.maxOps = ops.maxOps || 4000 + route.length ** 2 * 100;  // 跨10room则有2000+10*10*50=7000
        PathFinderOpts.maxRooms = PathFinderOpts.maxRooms || route.length + 1;
        route = buildRouteRoomSet(route, fromPos.roomName);   // 路由房间集合，用于 roomCallback 快速判定
        //console.log(fromPos + ' using route ' + JSON.stringify(route));
        PathFinderOpts.roomCallback = roomCallbackWithRoute;
    } else {
        PathFinderOpts.maxOps = ops.maxOps;
        PathFinderOpts.roomCallback = roomCallback;
    }

    return PathFinder.search(fromPos, { pos: toPos, range: ops.range }, PathFinderOpts);
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
function findPathInCache(formalFromPos, formalToPos, fromPos, toRoomName, creepCache, ops, requireSecondStepCheck) {
    const statsEnabled = isCpuStatsEnabled();
    if (statsEnabled) {
        startCacheSearch = Game.cpu.getUsed();
    }

    const range = ops.range | 0;
    const endKey = formalToPos.x + formalToPos.y;
    const minY = endKey - 1 - range;
    const maxY = endKey + 1 + range;
    const variantKey = buildPathVariantKeyFromQuery(ops, toRoomName);

    const visit = (pathArray, skipOpsCheck) => {
        for (let i = pathArray.length; i--;) {
            let path = pathArray[i];
            if (statsEnabled) pathCounter++;
            if (!skipOpsCheck && !isSameOps(path, ops)) {
                continue;
            }
            if (!isNear(path.start, formalFromPos)) {
                continue;
            }
            if (requireSecondStepCheck && fromPos && !isNear(fromPos, path.posArray[1])) {
                continue;
            }
            if (!inRange(path.end, formalToPos, ops.range)) {
                continue;
            }
            creepCache.path = path;
            return true;
        }
        return false;
    };

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const startKey = ((formalFromPos.x + dx) << 16) | ((formalFromPos.y + dy) & 0xFFFF);
            const variantBuckets = globalPathCacheByVariant[startKey];
            const variantYBuckets = variantBuckets && variantBuckets[variantKey];
            if (variantYBuckets) {
                for (let combinedY = minY; combinedY <= maxY; combinedY++) {
                    const pathArray = variantYBuckets[combinedY];
                    if (!pathArray) continue;
                    if (visit(pathArray, true)) return true;
                }
                continue;
            }

            const xBucket = globalPathCache[startKey];
            if (!xBucket) continue;
            for (let combinedY = minY; combinedY <= maxY; combinedY++) {
                const pathArray = xBucket[combinedY];
                if (!pathArray) continue;
                if (visit(pathArray, false)) return true;
            }
        }
    }

    return false;
}
/**
 *  寻找房内缓存路径，起始位置两步限制避免复用非最优路径
 * @param {RoomPosition} formalFromPos
 * @param {RoomPosition} formalToPos
 * @param {RoomPosition} fromPos
 * @param {CreepPaths} creepCache
 * @param {MoveToOpts} ops
 */
function findShortPathInCache(formalFromPos, formalToPos, fromPos, toRoomName, creepCache, ops) {
    return findPathInCache(formalFromPos, formalToPos, fromPos, toRoomName, creepCache, ops, true);
}

/**
 *  寻找跨房缓存路径，允许起始位置少量的误差
 * @param {RoomPosition} formalFromPos
 * @param {RoomPosition} formalToPos
 * @param {CreepPaths} creepCache
 * @param {MoveToOpts} ops
 */
function findLongPathInCache(formalFromPos, formalToPos, toRoomName, creepCache, ops) {
    return findPathInCache(formalFromPos, formalToPos, undefined, toRoomName, creepCache, ops, false);
}

/**
 *  起止点都在自己房间的路不清理
 * @param {CreepPaths['name']} creepCache
 */
function setPathTimer(creepCache) {
    if (pathClearDelay) {
        let posArray = creepCache.path.posArray;
        const startRoomName = posArray[0].roomName;
        const endRoomName = posArray[posArray.length - 1].roomName;
        if (startRoomName != endRoomName || (startRoomName in Game.rooms && Game.rooms[startRoomName].controller && !Game.rooms[startRoomName].controller.my)) {    // 跨房路或者敌方房间路
            const pathDueTick = Game.time + pathClearDelay;
            if (!(pathDueTick in pathCacheTimer)) {
                pathCacheTimer[pathDueTick] = [];
                enqueueDueTick(pathCacheTimerDueQueue, pathDueTick);
            }
            pathCacheTimer[pathDueTick].push(creepCache.path);
            creepCache.path.lastTime = Game.time;
        }
    }
}

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
function moveOneStep(creep, visualStyle, toPos) {
    let creepCache = creepPathCache[creep.name];
    if (visualStyle) {
        showVisual(creep, toPos, creepCache.path.posArray, creepCache.idx, 1, visualStyle);
    }
    if (creep.fatigue) {
        return ERR_TIRED;
    }
    creepCache.idx++;
    creepMoveCache[creep.name] = Game.time;
    if (isCpuStatsEnabled()) {
        testNormal++;
        let t = Game.cpu.getUsed() - startTime;
        if (t > 0.2) {
            normalLogicalCost += t - 0.2;
        } else {
            normalLogicalCost += t;
        }
    }
    //creep.room.visual.circle(creepCache.path.posArray[creepCache.idx]);
    return originMove.call(creep, creepCache.path.directionArray[creepCache.idx]);
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

function startRoute(creep, pathCache, visualStyle, toPos, ignoreCreeps) {
    let posArray = pathCache.path.posArray;

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
    if (ignoreCreeps && isNear(creep.pos, nextStep)) {
        trySwap(creep, nextStep, false, true);
    }
    return originMove.call(creep, getDirection(creep.pos, nextStep));
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

function runMoveOptTickMaintenance() {
    if (obTick < Game.time) {
        obTick = Game.time;
        ensureRouteCacheMaintenance(false);
        checkObResult();
        doObTask();
        scanPortals(false);
    }
}

// ----------------------------------------------------------------------------
// 12) 原型包装入口：统计、去重、每 tick 维护
// ----------------------------------------------------------------------------
/**
 * @param {Function} fn
 */
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
function clearObjectKeys(obj) {
    for (let key in obj) {
        delete obj[key];
    }
}

function clearDeadCreepPathCache() {
    if (Game.time % pathClearDelay == 0) { // 随机清一次已死亡creep
        for (let name in creepPathCache) {
            if (!(name in Game.creeps)) {
                delete creepPathCache[name];
            }
        }
    }
}

function clearExpiredPaths() {
    drainDueTickQueue(pathCacheTimerDueQueue, Game.time, (time) => {
        const paths = pathCacheTimer[time];
        if (!paths || !paths.length) {
            delete pathCacheTimer[time];
            return;
        }
        for (let i = paths.length; i--;) {
            const path = paths[i];
            if (path.lastTime == time - pathClearDelay) {
                deletePath(path);
            }
        }
        delete pathCacheTimer[time];
    });
}

function clearExpiredCostMatrix() {
    drainDueTickQueue(costMatrixCacheTimerDueQueue, Game.time, (time) => {
        let avoidChanged = false;
        const dataList = costMatrixCacheTimer[time];
        if (!dataList || !dataList.length) {
            delete costMatrixCacheTimer[time];
            return;
        }
        for (let i = dataList.length; i--;) {
            const data = dataList[i];
            delete costMatrixCache[data.roomName];
            delete costMatrixRevision[data.roomName];
            const avoids = data.avoids;
            for (let j = avoids.length; j--;) {
                const avoidRoomName = avoids[j];
                if (avoidRoomName in avoidRooms) {
                    delete avoidRooms[avoidRoomName];
                    avoidChanged = true;
                }
            }
        }
        if (avoidChanged) {
            markAvoidRoomsChanged();
        }
        delete costMatrixCacheTimer[time];
    });
}

function clearUnused() {
    clearDeadCreepPathCache();
    clearExpiredPaths();
    clearExpiredCostMatrix();
}

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
            idx: 0
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
    const found = creep.pos.roomName == toPos.roomName ?
        findShortPathInCache(fromFormalPos, toFormalPos, creep.pos, toPos.roomName, creepCache, ops) :
        findLongPathInCache(fromFormalPos, toFormalPos, toPos.roomName, creepCache, ops);
    if (found) {
        //creep.say('cached');
        //console.log(creep, creep.pos, 'hit');
        if (isCpuStatsEnabled()) testCacheHits++;
    } else {  // 没找到缓存路
        if (isCpuStatsEnabled()) testCacheMiss++;

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
        addPathIntoCache(newPath);
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
        found ? cacheHitCost += Game.cpu.getUsed() - startCacheSearch : cacheMissCost += Game.cpu.getUsed() - startCacheSearch;
    }

    return startRoute(creep, creepCache, ops.visualizePathStyle, toPos, ops.ignoreCreeps);
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
    return originMove.call(creep, getDirection(creep.pos, curStep));
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

    if (!path || !(idx in path.posArray) || path.ignoreStructures != !!ops.ignoreDestructibleStructures) {
        return null;
    }

    const posArray = path.posArray;
    if (!(isEqual(toPos, creepCache.dst) || inRange(posArray[posArray.length - 1], toPos, ops.range))) {
        return null;
    }

    const curStep = posArray[idx];
    const nextStep = posArray[idx + 1];

    if (isEqual(creep.pos, curStep)) {    // 正常
        if ('storage' in creep.room && inRange(creep.room.storage.pos, creep.pos, coreLayoutRange) && ops.ignoreCreeps) {
            if (isCpuStatsEnabled()) testNearStorageCheck++;
            if (trySwap(creep, nextStep, false, true) == OK) {
                if (isCpuStatsEnabled()) testNearStorageSwap++;
            }
        }
        //creep.say('正常');
        return moveOneStep(creep, ops.visualizePathStyle, toPos);
    }

    if (idx + 2 in posArray && isEqual(creep.pos, nextStep)) {  // 跨房了
        creepCache.idx++;
        if (!path.directionArray[idx + 2]) {  // 第一次见到该房则检查房间
            if (checkRoom(creep.room, path, creepCache.idx)) {   // 传creep所在位置的idx
                //creep.say('新房 可走');
                //console.log(`${Game.time}: ${creep.name} check room ${creep.pos.roomName} OK`);
                return moveOneStep(creep, ops.visualizePathStyle, toPos);  // 路径正确，继续走
            }   // else 检查中发现房间里有建筑挡路，重新寻路
            //console.log(`${Game.time}: ${creep.name} check room ${creep.pos.roomName} failed`);
            deletePath(path);
            return null;
        }
        //creep.say('这个房间见过了');
        return moveOneStep(creep, ops.visualizePathStyle, toPos);  // 路径正确，继续走
    }

    if (isNear(creep.pos, curStep)) {  // 堵路了
        const code = trySwap(creep, curStep, ops.bypassHostileCreeps, ops.ignoreCreeps);  // 检查挡路creep
        if (code == ERR_INVALID_TARGET) {   // 是被设置了不可对穿的creep或者敌对creep挡路，临时绕路
            if (isCpuStatsEnabled()) testBypass++;
            ops.bypassRange = ops.bypassRange || 5; // 默认值
            if (typeof ops.bypassRange != "number" || typeof ops.range != 'number') {
                return ERR_INVALID_ARGS;
            }
            const bypassSignature = buildTemporalBypassSignature(path, idx, curStep, toPos, ops);
            const canAttemptBypass = shouldAttemptTemporalBypass(creepCache, bypassSignature);
            if (canAttemptBypass) {
                const bypassOk = findTemporalPath(creep, toPos, ops);
                recordTemporalBypassResult(creepCache, bypassSignature, bypassOk);
                if (bypassOk) { // 有路，creepCache的内容会被这个函数更新
                    //creep.say('开始绕路');
                    return startRoute(creep, creepCache, ops.visualizePathStyle, toPos, ops.ignoreCreeps);
                }
            }
            // 绕路冷却窗口内直接沿旧路径尝试推进，避免空转并等待前方creep让路
            return moveTowardCachedStep(creep, curStep, ops, toPos, posArray, idx);
        }

        if (code == ERR_NOT_FOUND && isObstacleStructure(creep.room, curStep, ops.ignoreDestructibleStructures)) {   // 发现出现新建筑物挡路，删除costMatrix和path缓存，重新寻路
            //console.log(`${Game.time}: ${creep.name} find obstacles at ${creep.pos}`);
            delete costMatrixCache[creep.pos.roomName];
            delete costMatrixRevision[creep.pos.roomName];
            deletePath(path);
            return null;
        }
        // else 上tick移动失败但也不是建筑物和creep/pc挡路。有2个情况：1.下一格路本来是穿墙路并碰巧消失了；2.下一格是房间出口，有另一个creep抢路了然后它被传送到隔壁了。不处理第1个情况，按第2个情况对待。
        //creep.say('对穿' + getDirection(creep.pos, posArray[idx]) + '-' + originMove.call(creep, getDirection(creep.pos, posArray[idx])));
        return moveTowardCachedStep(creep, curStep, ops, toPos, posArray, idx);  // 有可能是第一步就没走上路or通过略过moveTo的move操作偏离路线，直接call可兼容
    }

    if (idx - 1 >= 0 && isNear(creep.pos, posArray[idx - 1])) {  // 因为堵路而被自动传送反向跨房了
        //creep.say('偏离一格');
        if (creep.pos.roomName == posArray[idx - 1].roomName && ops.ignoreCreeps) {    // 不是跨房而是偏离，检查对穿
            trySwap(creep, posArray[idx - 1], false, true);
        }
        if (ops.visualizePathStyle) {
            showVisual(creep, toPos, posArray, idx, 1, ops.visualizePathStyle);
        }
        creepMoveCache[creep.name] = Game.time;
        return originMove.call(creep, getDirection(creep.pos, posArray[idx - 1]));    // 同理兼容略过moveTo的move
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
    if (!this.my) {
        return ERR_NOT_OWNER;
    }

    if (this.spawning) {
        return ERR_BUSY;
    }

    // moveTo 调用临时变量（局部声明，避免跨调用串值）
    const args = resolveMoveToArgs(this, firstArg, secondArg, opts);
    let toPos = args.toPos;
    const ops = normalizeMoveToOpts(args.ops);

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
        if (this.pos.roomName == toPos.roomName && ops.ignoreCreeps) {    // 同房间考虑一下对穿
            trySwap(this, toPos, false, true);
        }
        creepMoveCache[this.name] = Game.time;      // 用于防止自己移动后被误对穿
        if (isCpuStatsEnabled()) {
            testNormal++;
            let t = Game.cpu.getUsed() - startTime;
            normalLogicalCost += t > 0.2 ? t - 0.2 : t;
        }
        return originMove.call(this, getDirection(this.pos, toPos));
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
    if (creepCache) {  // 有缓存
        const code = tryMoveWithCreepCache(this, toPos, ops, creepCache);
        if (code !== null) {
            return code;
        }
    } // else 需要重新寻路，先找缓存路，找不到就寻路

    creepCache = getOrInitCreepCache(this);
    return resolvePathAndStartRoute(this, toPos, ops, creepCache);
}

/**
 *
 * @param {DirectionConstant | Creep} target
 */
function betterMove(target) {
    if (typeof target == "number") {
        const nextPos = direction2Pos(this.pos, target);
        if (nextPos) {
            trySwap(this, nextPos, false, true);
        }
        creepMoveCache[this.name] = Game.time;
        return originMove.call(this, target);
    }
    if (target && typeof target == 'object' && 'pos' in target) { // pull 机制
        creepMoveCache[this.name] = Game.time;
        return originMove.call(this, target);
    }
    return ERR_INVALID_ARGS;
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
 * @param {RoomPosition} toPos
 * @param {*} opts
 */
function findSquadPathTo(toPos, opts) {
    ensureAvoidRoomsUpToDate();
    if (!toPos || typeof toPos.x != 'number' || typeof toPos.y != 'number') {
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
        if (roomName in avoidRooms) {
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

    return PathFinder.search(this, { pos: toPos, range }, PathFinderOpts).path;
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
        if (roomName in avoidRooms) {
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

    const result = PathFinder.search(this.pos, goals, PathFinderOpts).path;
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
// observers / avoidRooms 已改为按需刷新：仅在调用相关能力时触发，并在同 tick 去重。

function applyConfig() {
    cacheStatsEnabled = !!config.enableCacheStats;
    bmSetChangeMove(!!config.changeMove);
    bmSetChangeMoveTo(!!config.changeMoveTo);
    bmSetChangeFindClostestByPath(!!config.changeFindClostestByPath);
    bmSetEnableFlee(!!config.enableFlee);
    bmSetEnableSquadPath(!!config.enableSquadPath);
}

applyConfig();


// 15.1 BetterMove 控制面（配置、缓存维护、调试输出）
function bmDeletePathInRoom(roomName) {
    const parsed = parseRoomName(roomName);
    if (!parsed) {
        return ERR_INVALID_ARGS;
    }

    this.deleteCostMatrix(roomName);

    // 无缓存路径时无需进入扫描流程
    if (!globalPathCachePathCount) {
        return OK;
    }

    // 快速路径：优先按同房路径版本索引删除
    const sameRoomRefs = roomSameRoomPathRefs[roomName];
    if (sameRoomRefs) {
        const versions = Object.keys(sameRoomRefs);
        for (let i = 0; i < versions.length; i++) {
            const version = versions[i];
            const path = sameRoomRefs[version];
            if (!path) continue;
            deletePath(path);
        }
        const remainStart = roomStartKeyCount[roomName] || 0;
        const remainEnd = roomEndKeyCount[roomName] || 0;
        if (!remainStart && !remainEnd) {
            return OK;
        }
    }

    const roomKeyCount = roomStartKeyCount[roomName] || 0;
    const roomEndCount = roomEndKeyCount[roomName] || 0;
    // 该房间没有登记过同房路径起点，说明无可删路径
    if (!roomKeyCount && !roomEndCount) {
        return OK;
    }

    const bucketCount = globalPathCacheBucketCount;
    // 根据当前规模选择遍历策略，减少无关扫描
    const useEndIndex = roomEndCount && (!roomKeyCount || roomEndCount < roomKeyCount);
    // roomKeyCount 是该房间记录的起点数，天然 <= 2500，无需额外判断 < 2500
    const useRoomIndex = !useEndIndex && roomKeyCount && roomKeyCount <= bucketCount;
    const useBucketScan = !useRoomIndex && !useEndIndex && bucketCount && bucketCount < 2500;

    if (useRoomIndex) {
        // 房间索引更小：只遍历该房间登记过的 startKey
        const roomKeys = roomStartKeyRefs[roomName];
        if (!roomKeys) return OK;
        
        for (let startKey in roomKeys) {
            const targetCount = roomKeys[startKey] | 0;
            if (targetCount <= 0) continue;
            let deletedCount = 0;
            const xBucket = globalPathCache[startKey];
            if (!xBucket) continue;
            
            for (let combinedYKey in xBucket) {
                const pathArray = xBucket[combinedYKey];
                if (!pathArray || !pathArray.length) continue;
                
                for (let i = pathArray.length; i--; ) {
                    let path = pathArray[i];
                    let posArray = path.posArray;
                    if (!posArray || !posArray.length) continue;
                    
                    // 仅删除“起点和终点都在该房间”的路径
                    if (posArray[0].roomName == roomName && posArray[posArray.length - 1].roomName == roomName) {
                        deletePath(path);
                        deletedCount++;
                        if (deletedCount >= targetCount) {
                            break;
                        }
                    }
                }
                if (deletedCount >= targetCount) {
                    break;
                }
            }
        }
        return OK;
    }

    if (useEndIndex) {
        // 终点索引更小：先枚举 endKey，再通过 endKey->startKey 索引定位桶
        const roomEndKeys = roomEndKeyRefs[roomName];
        if (!roomEndKeys) return OK;

        const baseX = parsed.baseX;
        const baseY = parsed.baseY;
        const maxX = baseX + 50;
        const maxY = baseY + 50;

        for (let endKey in roomEndKeys) {
            const targetCount = roomEndKeys[endKey] | 0;
            if (targetCount <= 0) continue;
            let deletedCount = 0;
            const startKeys = endKeyStartKeyRefs[endKey];
            if (!startKeys) continue;
            
            for (let startKey in startKeys) {
                // 优化：利用 startKey 包含的坐标信息进行快速预过滤
                // 显式转为数字，虽然 JS 位运算会自动转，但显式转换更安全且明确
                const key = +startKey;
                const globalX = key >> 16;
                const globalY = key & 0xFFFF;
                if (globalX < baseX || globalX >= maxX || globalY < baseY || globalY >= maxY) {
                    continue;
                }

                const xBucket = globalPathCache[key];
                if (!xBucket) continue;
                
                const pathArray = xBucket[endKey];
                if (!pathArray || !pathArray.length) continue;

                for (let i = pathArray.length; i--; ) {
                    let path = pathArray[i];
                    let posArray = path.posArray;
                    if (!posArray || !posArray.length) continue;
                    
                    if (posArray[0].roomName == roomName && posArray[posArray.length - 1].roomName == roomName) {
                        deletePath(path);
                        deletedCount++;
                        if (deletedCount >= targetCount) {
                            break;
                        }
                    }
                }
                if (deletedCount >= targetCount) {
                    break;
                }
            }
        }
        return OK;
    }

    if (useBucketScan) {
        // 全局桶数量较小：直接扫全局桶
        for (let startKey in globalPathCache) {
            const xBucket = globalPathCache[startKey];
            for (let combinedYKey in xBucket) {
                const pathArray = xBucket[combinedYKey];
                if (!pathArray || !pathArray.length) continue;

                for (let i = pathArray.length; i--; ) {
                    let path = pathArray[i];
                    let posArray = path.posArray;
                    if (!posArray || !posArray.length) continue;
                    
                    if (posArray[0].roomName == roomName && posArray[posArray.length - 1].roomName == roomName) {
                        deletePath(path);
                    }
                }
            }
        }
        return OK;
    }

    // 最后兜底：遍历房间 50x50 起点范围对应的 startKey
    const baseX = parsed.baseX;
    const baseY = parsed.baseY;
    for (let x = 0; x < 50; x++) {
        const globalX = baseX + x;
        for (let y = 0; y < 50; y++) {
            const globalY = baseY + y;
            const startKey = (globalX << 16) | (globalY & 0xFFFF);
            const xBucket = globalPathCache[startKey];
            if (!xBucket) continue;
            
            for (let combinedYKey in xBucket) {
                const pathArray = xBucket[combinedYKey];
                if (!pathArray || !pathArray.length) continue;

                for (let i = pathArray.length; i--; ) {
                    let path = pathArray[i];
                    let posArray = path.posArray;
                    if (!posArray || !posArray.length) continue;
                    
                    if (posArray[0].roomName == roomName && posArray[posArray.length - 1].roomName == roomName) {
                        deletePath(path);
                    }
                }
            }
        }
    }
    return OK;
}

function bmSetChangeMoveTo(bool) {
    config.changeMoveTo = !!bool;
    const core = bool ? betterMoveTo : originMoveTo;
    const impl = wrapFn(function (...args) {
        updateDontPullMeForMoveTo(this);
        return core.apply(this, args);
    }, 'moveTo');
    if (Creep.prototype.$moveTo) {
        Creep.prototype.$moveTo = impl;
    } else {
        Creep.prototype.moveTo = impl;
    }
    analyzeCPU.moveTo = { sum: 0, calls: 0 };
    testCacheHits = 0;
    testCacheMiss = 0;
    testNormal = 0;
    testNearStorageCheck = 0;
    testNearStorageSwap = 0;
    testTrySwap = 0;
    testBypass = 0;
    normalLogicalCost = 0;
    cacheHitCost = 0;
    cacheMissCost = 0;
    return OK;
}

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

function bmGetCacheStats() {
    const safeDiv = (num, den) => den ? (num / den) : 0;
    const routeLookups = routeCacheLookupCount;
    const routeHits = routeCacheHitCount;
    const routeMisses = routeLookups - routeHits;
    const routeSkips = routeCacheSkipByBudgetCount + routeCacheSkipByCapacityCount;
    return {
        enabled: isCacheStatsEnabled(),
        tick: Game.time,
        route: {
            lookups: routeLookups,
            hits: routeHits,
            misses: routeMisses,
            hitRate: safeDiv(routeHits, routeLookups),
            writes: routeCacheWriteStoreCount,
            skipByBudget: routeCacheSkipByBudgetCount,
            skipByCapacity: routeCacheSkipByCapacityCount,
            skipRate: safeDiv(routeSkips, routeLookups),
            evictTTL: routeCacheEvictTTLCount,
            evictBypass: routeCacheEvictBypassCount,
            size: routeCacheEntryCount,
            nonBypassSize: routeCacheNonBypassEntryCount
        },
        path: {
            inserts: pathCacheInsertCount,
            trimRuns: pathCacheTrimRunCount,
            trimScans: pathCacheTrimScanCount,
            trimDeletes: pathCacheTrimDeleteCount,
            trimHitRate: safeDiv(pathCacheTrimDeleteCount, pathCacheTrimScanCount),
            size: globalPathCachePathCount,
            insertQueueSize: Math.max(0, pathCacheInsertQueue.length - pathCacheInsertHead)
        }
    };
}

function bmResetCacheStats() {
    resetCacheRuntimeStats();
    return OK;
}

function appendCacheStatsText(text) {
    const stats = bmGetCacheStats();
    if (!stats.enabled) {
        text += '\ncache stats disabled (set config.enableCacheStats=true to enable)';
        return text;
    }
    text += '\nroute cache: size=' + stats.route.size + '/' + stats.route.nonBypassSize + ', hit=' + stats.route.hits + '/' + stats.route.lookups + ' (' + stats.route.hitRate.toFixed(4) + ')';
    text += ', writes=' + stats.route.writes + ', skip(budget/cap)=' + stats.route.skipByBudget + '/' + stats.route.skipByCapacity + ', evict(ttl/bypass)=' + stats.route.evictTTL + '/' + stats.route.evictBypass;
    text += '\npath cache: size=' + stats.path.size + ', inserts=' + stats.path.inserts + ', trim runs=' + stats.path.trimRuns + ', trim delete/scan=' + stats.path.trimDeletes + '/' + stats.path.trimScans + ' (' + stats.path.trimHitRate.toFixed(4) + ')';
    return text;
}

function bmPrint() {
    const safeDiv = (num, den) => den ? (num / den) : 0;
    if (!isCpuStatsEnabled()) {
        return appendCacheStatsText('\n[BetterMove] cpu stats disabled (set config.enableCpuStats=true to enable)');
    }

    let text = '\navarageTime\tcalls\tFunctionName';
    for (let fn in analyzeCPU) {
        const calls = analyzeCPU[fn].calls;
        text += '\n' + safeDiv(analyzeCPU[fn].sum, calls).toFixed(5) + '\t\t' + calls + '\t\t' + fn;
    }

    const hitCost = safeDiv(cacheHitCost, testCacheHits);
    const missCost = safeDiv(cacheMissCost, testCacheMiss);
    const searchCount = testCacheHits + testCacheMiss;
    const missRate = safeDiv(testCacheMiss, searchCount);
    const hitRate = searchCount ? (1 - missRate) : 0;
    const moveToCalls = analyzeCPU.moveTo.calls || 0;

    text += '\nnormal logical cost: ' + safeDiv(normalLogicalCost, testNormal).toFixed(5) + ', total cross rate: ' + safeDiv(testTrySwap, moveToCalls).toFixed(4) + ', total bypass rate:  ' + safeDiv(testBypass, moveToCalls).toFixed(4);
    text += '\nnear storage check rate: ' + safeDiv(testNearStorageCheck, moveToCalls).toFixed(4) + ', near storage cross rate: ' + safeDiv(testNearStorageSwap, testNearStorageCheck).toFixed(4);
    text += '\ncache search rate: ' + safeDiv(searchCount, moveToCalls).toFixed(4) + ', total hit rate: ' + hitRate.toFixed(4) + ', avg check paths: ' + safeDiv(pathCounter, searchCount).toFixed(3);
    text += '\ncache hit avg cost: ' + hitCost.toFixed(5) + ', cache miss avg cost: ' + missCost.toFixed(5) + ', total avg cost: ' + (hitCost * hitRate + missCost * missRate).toFixed(5);
    return appendCacheStatsText(text);
}

function bmSetChangeMove(bool) {
    config.changeMove = !!bool;
    if (bool) {
        if (!Creep.prototype.$move) {
            Creep.prototype.$move = Creep.prototype.move;
        }
        Creep.prototype.move = wrapFn(betterMove, 'move');
    } else if (bool === false) {
        if (Creep.prototype.$move) {
            Creep.prototype.move = Creep.prototype.$move;
        }
    }
    analyzeCPU.move = { sum: 0, calls: 0 };
    return OK;
}

function bmSetChangeFindClostestByPath(bool) {
    config.changeFindClostestByPath = !!bool;
    if (bool) {
        if (!RoomPosition.prototype.$findClosestByPath) {
            RoomPosition.prototype.$findClosestByPath = RoomPosition.prototype.findClosestByPath;
        }
        RoomPosition.prototype.findClosestByPath = wrapFn(betterFindClosestByPath, 'findClosestByPath');
    } else if (bool === false) {
        if (RoomPosition.prototype.$findClosestByPath) {
            RoomPosition.prototype.findClosestByPath = RoomPosition.prototype.$findClosestByPath;
        }
    }
    analyzeCPU.findClosestByPath = { sum: 0, calls: 0 };
    return OK;
}

function bmSetPathClearDelay(number) {
    if (typeof number == "number" && number > 0) {
        pathClearDelay = Math.ceil(number);
        return OK;
    } else if (number === undefined) {
        pathClearDelay = undefined;
    }
    return ERR_INVALID_ARGS;
}

function bmSetHostileCostMatrixClearDelay(number) {
    if (typeof number == "number" && number > 0) {
        hostileCostMatrixClearDelay = Math.ceil(number);
        return OK;
    } else if (number === undefined) {
        hostileCostMatrixClearDelay = undefined;
        return OK;
    }
    return ERR_INVALID_ARGS;
}

function bmDeleteCostMatrix(roomName) {
    delete costMatrixCache[roomName];
    delete costMatrixRevision[roomName];
    return OK;
}

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

function bmSetEnableSquadPath(bool) {
    config.enableSquadPath = !!bool;
    if (bool) {
        if (!RoomPosition.prototype.$findSquadPathTo) {
            RoomPosition.prototype.$findSquadPathTo = RoomPosition.prototype.findSquadPathTo;
        }
        RoomPosition.prototype.findSquadPathTo = wrapFn(findSquadPathTo, 'findSquadPathTo');
    } else if (bool === false) {
        if (RoomPosition.prototype.$findSquadPathTo) {
            RoomPosition.prototype.findSquadPathTo = RoomPosition.prototype.$findSquadPathTo;
        }
    }
    return OK;
}

function bmSetEnableFlee(bool) {
    config.enableFlee = !!bool;
    if (bool) {
        if (!Creep.prototype.$flee) {
            Creep.prototype.$flee = Creep.prototype.flee;
        }
        Creep.prototype.flee = wrapFn(flee, 'flee');
    } else if (bool === false) {
        if (Creep.prototype.$flee) {
            Creep.prototype.flee = Creep.prototype.$flee;
        } else {
            delete Creep.prototype.flee;
        }
    }
    return OK;
}

function bmGetConfig() {
    return config;
}

function bmSetConfig(partial) {
    if (!partial || typeof partial != 'object') {
        return ERR_INVALID_ARGS;
    }
    Object.assign(config, partial);
    if ('enableCacheStats' in partial && !partial.enableCacheStats) {
        resetCacheRuntimeStats();
    }
    applyConfig();
    return OK;
}

function resetMoveOptStats() {
    for (let fn in analyzeCPU) {
        analyzeCPU[fn] = { sum: 0, calls: 0 };
    }
    pathCounter = 0;
    testCacheHits = 0;
    testCacheMiss = 0;
    testNormal = 0;
    testNearStorageCheck = 0;
    testNearStorageSwap = 0;
    testTrySwap = 0;
    testBypass = 0;
    normalLogicalCost = 0;
    cacheHitCost = 0;
    cacheMissCost = 0;
    resetCacheRuntimeStats();
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
    clearObjectKeys(roomNameParseCache);
    clearObjectKeys(shardRoomNameParseCache);
    squadDerivedMatCacheTick = -1;
    clearObjectKeys(squadDerivedMatCache);

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
        portalScanTick = -1;
        portalPruneTick = -1;
    }

    if (resetStats) {
        resetMoveOptStats();
    }

    return OK;
}

function bmResolvePosArg(posOrObj) {
    if (!posOrObj) return null;
    const pos = posOrObj.pos || posOrObj;
    if (!pos || typeof pos !== 'object') return null;
    if (typeof pos.x !== 'number' || typeof pos.y !== 'number' || typeof pos.roomName !== 'string') return null;
    return pos;
}

function bmDeltePath(fromPos, toPos, opts) {   // BetterMove 历史拼写：deltePath
    const from = bmResolvePosArg(fromPos);
    const to = bmResolvePosArg(toPos);
    if (!from || !to) return ERR_INVALID_ARGS;

    const ops = (opts && typeof opts === 'object') ? opts : {};
    ops.range = ops.range || 1;

    const fromFormalPos = formalize(from);
    const toFormalPos = formalize(to);
    if (typeof fromFormalPos.x !== 'number' || typeof fromFormalPos.y !== 'number' || typeof toFormalPos.x !== 'number' || typeof toFormalPos.y !== 'number') {
        return ERR_INVALID_ARGS;
    }

    // 复用缓存索引的扫描策略：起点 3x3 + 终点 endKey 范围过滤
    const minY = toFormalPos.x + toFormalPos.y - 1 - ops.range;
    const maxY = toFormalPos.x + toFormalPos.y + 1 + ops.range;
    let deleted = 0;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const startKey = ((fromFormalPos.x + dx) << 16) | ((fromFormalPos.y + dy) & 0xFFFF);
            const xBucket = globalPathCache[startKey];
            if (!xBucket) continue;

            for (let combinedYKey in xBucket) {
                const combinedY = +combinedYKey;
                if (combinedY < minY || combinedY > maxY) continue;
                const pathArray = xBucket[combinedYKey];
                if (!pathArray || !pathArray.length) continue;

                for (let i = pathArray.length; i--;) {
                    const path = pathArray[i];
                    if (!path || !path.posArray || !path.posArray.length) continue;
                    if (!isSameOps(path, ops)) continue;
                    if (!isNear(path.start, fromFormalPos)) continue;
                    if (!inRange(path.end, toFormalPos, ops.range)) continue;
                    deletePath(path);
                    deleted++;
                }
            }
        }
    }

    return deleted ? OK : ERR_NOT_FOUND;
}

// 15.2 对外挂载：提供调参、缓存管理与调试能力
// 15.2 对外挂载：提供调参、缓存管理与调试能力
global.BetterMove = {
    // getPosMoveAble (pos){
    //     generateCostMatrix(Game.rooms[pos.roomName])
    //     if(pos.roomName in costMatrixCache)
    //         return (costMatrixCache[pos.roomName][false].get(pos.x,pos.y))
    // },
    setChangeMove: bmSetChangeMove,
    creepPathCache:creepPathCache,
    setChangeMoveTo: bmSetChangeMoveTo,
    setChangeFindClostestByPath: bmSetChangeFindClostestByPath,
    setPathClearDelay: bmSetPathClearDelay,
    setHostileCostMatrixClearDelay: bmSetHostileCostMatrixClearDelay,
    deleteCostMatrix: bmDeleteCostMatrix,
    deltePath: bmDeltePath,
    getAvoidRoomsMap: bmGetAvoidRoomsMap,
    getAvoidExitsMap: bmGetAvoidExitsMap,
    addAvoidRooms: bmAddAvoidRooms,
    deleteAvoidRooms: bmDeleteAvoidRooms,
    clearAvoidExits: bmClearAvoidExits,
    getClosestExitPos: getClosestExitPos,
    setEnableSquadPath: bmSetEnableSquadPath,
    setEnableFlee: bmSetEnableFlee,
    getConfig: bmGetConfig,
    setConfig: bmSetConfig,
    getCacheStats: bmGetCacheStats,
    resetCacheStats: bmResetCacheStats,
    deletePathInRoom: bmDeletePathInRoom,
    addAvoidExits (fromRoomName, toRoomName) {
        if (parseRoomName(fromRoomName) && parseRoomName(toRoomName)) {
            avoidExits[fromRoomName] ? avoidExits[fromRoomName][toRoomName] = 1 : avoidExits[fromRoomName] = { [toRoomName]: 1 };
            markAvoidExitsChanged();
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    deleteAvoidExits (fromRoomName, toRoomName) {
        if (parseRoomName(fromRoomName) && parseRoomName(toRoomName)) {
            if (fromRoomName in avoidExits && toRoomName in avoidExits[fromRoomName]) {
                delete avoidExits[fromRoomName][toRoomName];
            }
            markAvoidExitsChanged();
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    syncPortals() {
        // 立即扫描一次可见房间中的 portal，并写入 global._bmPortals
        scanPortals(true);
        return getPortalRegistry();
    },
    printPortals(targetShard) {
        // 打印当前 shard 已登记的 portal（可选按目标 shard 过滤）
        const reg = getPortalRegistry();
        const list = reg.list || [];
        const filtered = typeof targetShard === 'string' && targetShard
            ? list.filter((p) => p && p.destShard === targetShard)
            : list;
        console.log(`[BetterMove] shard=${Game.shard?.name || ''} portals=${filtered.length}`);
        for (let i = 0; i < filtered.length; i++) {
            const p = filtered[i];
            if (!p) continue;
            console.log(`- ${p.roomName} (${p.x},${p.y}) -> ${p.destShard}/${p.destRoom} (${p.destX},${p.destY}) lastSeen=${p.lastSeen}`);
        }
        return filtered;
    },
    print: bmPrint,
    clear: bmClear
}





// ============================================================================
// 16) 行为增强：dontPullMe 相关包装
// ============================================================================
/**
 * 原型方法包装工具
 * @description
 * 1) 第一次包装时将原方法保存到 backupName（如 $moveTo）；
 * 2) 后续再次调用不会覆盖 backupName，避免多次加载导致丢失原实现；
 * 3) 将 originalName 替换为 wrap。
 */
function wrapProtoMethod(proto, originalName, backupName, wrap) {
    if (!proto[backupName] || proto[backupName] === proto[originalName]) {
        proto[backupName] = proto[originalName];
    }
    proto[originalName] = wrap;
}

/**
 * moveTo 前更新 dontPullMe 状态
 * @description
 * - 靠近房间边缘两格（<=1 或 >=48）时：禁止被对穿/拉动
 * - 原地停留超过 6 tick 时：禁止被对穿/拉动
 * 说明：保持使用 creep.memory.lastPos 字段，避免影响已有线上行为/数据结构
 */
function updateDontPullMeForMoveTo(creep) {
    let isNearEdge = creep.pos.x <= 1 || creep.pos.x >= 48 || creep.pos.y <= 1 || creep.pos.y >= 48;

    // 使用数字编码替代对象存储，避免每 tick 创建新字符串或对象
    const currentPacked = (creep.pos.x << 6) | creep.pos.y;
    if (creep.memory._lpv === currentPacked) {
        creep.memory._lpt = (creep.memory._lpt || 0) + 1;
    } else {
        creep.memory._lpv = currentPacked;
        creep.memory._lpt = 0;
    }

    creep.memory.dontPullMe = isNearEdge || creep.memory._lpt > 6;
}

/**
 * 对指定 action 进行 dontPullMe 包装（复用同一套逻辑）
 * @description
 * - 首次包装时保存原方法到 $methodName
 * - 执行 action 前将 dontPullMe 设为 true，避免被对穿打断关键动作
 */
function wrapActionSetDontPullMeTrue(methodName) {
    const backupName = `$${methodName}`;
    if (Creep.prototype[backupName]) {
        return;
    }
    wrapProtoMethod(Creep.prototype, methodName, backupName, function (...args) {
        this.memory.dontPullMe = true;
        return this[backupName](...args);
    });
}

wrapActionSetDontPullMeTrue('build');
wrapActionSetDontPullMeTrue('repair');
wrapActionSetDontPullMeTrue('upgradeController');
wrapActionSetDontPullMeTrue('dismantle');
wrapActionSetDontPullMeTrue('harvest');
wrapActionSetDontPullMeTrue('attack');

// wrapActionSetDontPullMeTrue('move');
// wrapActionSetDontPullMeTrue('withdraw');

