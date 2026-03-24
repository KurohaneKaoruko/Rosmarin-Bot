/**
 * BetterMove 的运行时状态控制面。
 * @description
 * 这部分本质上是“读 Memory / Game.*，同步到运行时状态”的边缘层，
 * 当前收口：
 * - avoidRooms / avoidExits 同步与控制
 * - observer 自动发现
 * - portal 注册表维护与跨 shard 入口选择
 * - 运行时缓存清理与重置
 */
import type {
    BetterMoveEndKeyPathRefCounts,
    BetterMoveObserverRuntime,
    BetterMoveObserverTask,
    BetterMovePath,
    BetterMovePathCache,
    BetterMovePathInsertToken,
    BetterMovePathVariantCache,
    BetterMovePortalRecord,
    BetterMovePortalRegistry,
    BetterMoveRoomCounterMap,
    BetterMoveRoomPathRefCounts,
    BetterMoveSameRoomPathRefs,
    BetterMoveTileIntent,
    CreepPathCacheEntry,
} from './types';

type RoomFlagMap = Record<string, 1>;
type AvoidExitMap = Record<string, RoomFlagMap>;
type MemoryBypassRooms = readonly string[] | undefined;
type ParsedRoomName = Record<string, number | string>;
type PortalRegistryEntry = BetterMovePortalRecord & {
    id: Id<StructurePortal>;
    roomName: string;
    x: number;
    y: number;
    destShard: string;
    destRoom: string;
    destX: number;
    destY: number;
    lastSeen: number;
};
type PortalGlobalScope = {
    _bmPortals?: BetterMovePortalRegistry;
};
type NumericMap = Record<string, number>;
type ClearableValue = object | string | number | boolean | null | undefined;
type ClearableMap = Record<string, ClearableValue>;
type PathTimerMap = Record<number, BetterMovePath[]>;
type CostMatrixExpiryEntry = { roomName: string; avoids: string[] };
type CostMatrixTimerMap = Record<number, CostMatrixExpiryEntry[]>;
type RouteKeysByTick = Record<number, string[]>;
type ObserverResultMap = Record<number, BetterMoveObserverTask[]>;
type BetterMoveGlobalState = {
    _bmPortals?: BetterMovePortalRegistry;
};
type DueTickQueue = {
    heap: number[];
    marks: Record<number, 1>;
};
type RuntimeSyncDeps = {
    observers: BetterMoveObserverRuntime[];
    avoidRooms: RoomFlagMap;
    avoidExits: AvoidExitMap;
    syncedBypassRooms: RoomFlagMap;
    parseRoomName: (roomName: string) => ParsedRoomName | null;
    markAvoidRoomsChanged: () => void;
    markAvoidExitsChanged: () => void;
    getAvoidRoomsSyncTick: () => number;
    setAvoidRoomsSyncTick: (value: number) => void;
    getAvoidRoomsMemorySignature: () => string;
    setAvoidRoomsMemorySignature: (value: string) => void;
    getAvoidRoomsMemoryInitialized: () => boolean;
    setAvoidRoomsMemoryInitialized: (value: boolean) => void;
};
type CleanupDeps = {
    globalPathCache: BetterMovePathCache;
    globalPathCacheByVariant: BetterMovePathVariantCache;
    roomSameRoomPathRefs: BetterMoveSameRoomPathRefs;
    roomSameRoomPathCount: BetterMoveRoomCounterMap;
    roomStartKeyRefs: BetterMoveRoomPathRefCounts;
    roomStartKeyCount: BetterMoveRoomCounterMap;
    endKeyStartKeyRefs: BetterMoveEndKeyPathRefCounts;
    roomEndKeyRefs: BetterMoveRoomPathRefCounts;
    roomEndKeyCount: BetterMoveRoomCounterMap;
    creepPathCache: Record<string, CreepPathCacheEntry | undefined>;
    creepMoveCache: NumericMap;
    pathCacheTimer: PathTimerMap;
    pathCacheTimerDueQueue: DueTickQueue;
    pathCacheInsertQueue: BetterMovePathInsertToken[];
    costMatrixCacheTimer: CostMatrixTimerMap;
    costMatrixCacheTimerDueQueue: DueTickQueue;
    costMatrixCache: ClearableMap;
    costMatrixRevision: NumericMap;
    sameRoomEdgeCostMatCache: ClearableMap;
    avoidRooms: RoomFlagMap;
    avoidExits: AvoidExitMap;
    syncedBypassRooms: RoomFlagMap;
    observers: BetterMoveObserverRuntime[];
    obTimer: ObserverResultMap;
    obTimerDueQueue: DueTickQueue;
    routeCacheKeysByDueTick: RouteKeysByTick;
    routeCacheDueQueue: DueTickQueue;
    bypassRouteCacheKeysByTick: RouteKeysByTick;
    bypassRouteCacheDueQueue: DueTickQueue;
    bypassCostMatReuseCache: ClearableMap;
    temporalAvoidExitCache: ClearableMap;
    geometryCaches: {
        roomNameParseCache: ClearableMap;
        shardRoomNameParseCache: ClearableMap;
        tileToPosCache: Map<number, RoomPosition>;
    };
    getPathClearDelay: () => number;
    setGlobalPathCacheBucketCount: (value: number) => void;
    setGlobalPathCachePathCount: (value: number) => void;
    setPathCacheInsertHead: (value: number) => void;
    setRouteCacheTrackedTtl: (value: number) => void;
    setTemporalAvoidExitCacheTick: (value: number) => void;
    setTemporalAvoidRooms: (from: string, to: string) => void;
    setBounceAvoidState: (from: string, to: string, until: number) => void;
    setSquadDerivedState: (tick: number, cache: ClearableMap) => void;
    setAutoDiscoverObserverTick: (value: number) => void;
    setObTick: (value: number) => void;
    setAvoidRoomsMemoryInitialized: (value: boolean) => void;
    setAvoidRoomsMemorySignature: (value: string) => void;
    setAvoidRoomsSyncTick: (value: number) => void;
    deletePath: (path: BetterMovePath) => void;
    drainDueTickQueue: (queue: DueTickQueue, now: number, visit: (tick: number) => void) => void;
    clearDueTickQueue: (queue: DueTickQueue) => void;
    markAvoidRoomsChanged: () => void;
    markAvoidExitsChanged: () => void;
    clearRouteCacheEntries: () => void;
    resetPortalScanState: () => void;
    ensureObserversUpToDate: () => void;
    resetMoveOptStats: () => void;
    resetMoveIntentState: () => void;
    setCheckTile: (value: ((posList: RoomPosition[]) => BetterMoveTileIntent[]) | undefined) => void;
};

function isOwnedObserver(structure: Structure<StructureConstant>): structure is StructureObserver {
    return structure.structureType === STRUCTURE_OBSERVER && 'my' in structure && !!structure.my;
}

/**
 * 兼容旧运行时：Screeps 某些环境没有 `globalThis`。
 */
const getPortalGlobalScope = (): PortalGlobalScope => {
    if (typeof globalThis !== 'undefined') return globalThis as PortalGlobalScope;
    if (typeof global !== 'undefined') return global as PortalGlobalScope;
    return Function('return this')() as PortalGlobalScope;
};

const getCleanupGlobalScope = (): BetterMoveGlobalState => {
    if (typeof globalThis !== 'undefined') return globalThis as BetterMoveGlobalState;
    if (typeof global !== 'undefined') return global as BetterMoveGlobalState;
    return Function('return this')() as BetterMoveGlobalState;
};

export function clearObjectKeys<T extends object>(obj: T) {
    const target = obj as Record<string, ClearableValue>;
    for (const key in target) {
        delete target[key];
    }
}

export function createPortalModule() {
    let portalScanTick = -1;
    let portalPruneTick = -1;
    const PORTAL_SCAN_INTERVAL = 20;
    const PORTAL_ENTRY_TTL = 50000;

    function getPortalRegistry(): BetterMovePortalRegistry {
        const globalState = getPortalGlobalScope();
        if (!globalState._bmPortals || typeof globalState._bmPortals !== 'object') {
            globalState._bmPortals = { v: 1, list: [], updated: 0 };
        }
        if (!globalState._bmPortals.list || !Array.isArray(globalState._bmPortals.list)) {
            globalState._bmPortals.list = [];
        }
        return globalState._bmPortals;
    }

    function scanPortals(force: boolean) {
        if (!force && portalScanTick !== -1 && (Game.time - portalScanTick) < PORTAL_SCAN_INTERVAL) {
            return;
        }
        portalScanTick = Game.time;

        const reg = getPortalRegistry();
        const list = reg.list as PortalRegistryEntry[];
        const indexById: Record<string, PortalRegistryEntry> = Object.create(null);
        for (let i = list.length; i--;) {
            const it = list[i];
            if (it && it.id) indexById[it.id] = it;
        }

        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room) continue;
            const portals = room.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_PORTAL }) as StructurePortal[];
            if (!portals || !portals.length) continue;

            for (let i = portals.length; i--;) {
                const portal = portals[i];
                const id = portal.id;
                const dest = portal.destination;
                if (!dest) continue;
                const runtimeDest = dest as RoomPosition & {
                    shard?: string;
                    room?: string;
                    roomName?: string;
                    x?: number;
                    y?: number;
                };

                let destShard = Game.shard && Game.shard.name ? Game.shard.name : '';
                let destRoom = '';
                let destX = 25;
                let destY = 25;

                if (typeof runtimeDest.shard === 'string') destShard = runtimeDest.shard;
                if (typeof runtimeDest.room === 'string') destRoom = runtimeDest.room;
                else if (typeof runtimeDest.roomName === 'string') destRoom = runtimeDest.roomName;
                if (typeof runtimeDest.x === 'number') destX = runtimeDest.x;
                if (typeof runtimeDest.y === 'number') destY = runtimeDest.y;

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
            for (let i = list.length; i--;) {
                const it = list[i];
                if (!it || !it.lastSeen || (Game.time - it.lastSeen) > PORTAL_ENTRY_TTL) {
                    list.splice(i, 1);
                }
            }
        }
    }

    function pickPortalToShard(fromRoomName: string, targetShard: string, targetRoomName: string) {
        const reg = getPortalRegistry();
        const list = reg.list as PortalRegistryEntry[];
        if (!list || !list.length) return null;

        let best: PortalRegistryEntry | null = null;
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

    function resetPortalScanState() {
        portalScanTick = -1;
        portalPruneTick = -1;
    }

    return {
        getPortalRegistry,
        scanPortals,
        pickPortalToShard,
        resetPortalScanState,
    };
}

export function createRuntimeSyncModule(deps: RuntimeSyncDeps) {
    function syncAvoidRooms(bypassRooms: string[]) {
        const nextBypassRooms: RoomFlagMap = Object.create(null);
        if (Array.isArray(bypassRooms)) {
            for (const roomName of bypassRooms) {
                if (typeof roomName !== 'string' || !roomName) continue;
                nextBypassRooms[roomName] = 1;
            }
        }

        let changed = false;

        for (const roomName in deps.syncedBypassRooms) {
            if (!(roomName in nextBypassRooms)) {
                delete deps.syncedBypassRooms[roomName];
                delete deps.avoidRooms[roomName];
                changed = true;
            }
        }

        for (const roomName in nextBypassRooms) {
            deps.syncedBypassRooms[roomName] = 1;
            if (!(roomName in deps.avoidRooms)) {
                deps.avoidRooms[roomName] = 1;
                changed = true;
            }
        }

        if (changed) {
            deps.markAvoidRoomsChanged();
        }
    }

    function normalizeBypassRooms(rawBypassRooms: MemoryBypassRooms): string[] {
        if (!rawBypassRooms || !rawBypassRooms.length) {
            return [];
        }

        const dedup: Record<string, 1> = Object.create(null);
        const normalized: string[] = [];
        for (let i = 0; i < rawBypassRooms.length; i++) {
            const roomName = rawBypassRooms[i];
            if (typeof roomName !== 'string' || !roomName || dedup[roomName]) continue;
            dedup[roomName] = 1;
            normalized.push(roomName);
        }
        normalized.sort();
        return normalized;
    }

    function isBypassRoomsStateConsistent(bypassRooms: string[]) {
        let syncedCount = 0;
        for (const roomName in deps.syncedBypassRooms) {
            syncedCount++;
            if (!(roomName in deps.avoidRooms)) {
                return false;
            }
        }
        if (syncedCount !== bypassRooms.length) {
            return false;
        }
        for (let i = 0; i < bypassRooms.length; i++) {
            const roomName = bypassRooms[i];
            if (!(roomName in deps.syncedBypassRooms) || !(roomName in deps.avoidRooms)) {
                return false;
            }
        }
        return true;
    }

    function ensureAvoidRoomsUpToDate() {
        if (deps.getAvoidRoomsSyncTick() === Game.time) {
            return;
        }
        deps.setAvoidRoomsSyncTick(Game.time);

        const bypassRooms = normalizeBypassRooms((Memory as { bypassRooms?: MemoryBypassRooms }).bypassRooms);
        const nextSignature = bypassRooms.join('|');
        let needSync = !deps.getAvoidRoomsMemoryInitialized() || nextSignature !== deps.getAvoidRoomsMemorySignature();
        if (!needSync && !isBypassRoomsStateConsistent(bypassRooms)) {
            needSync = true;
        }
        if (!needSync) {
            return;
        }

        deps.setAvoidRoomsMemoryInitialized(true);
        deps.setAvoidRoomsMemorySignature(nextSignature);
        syncAvoidRooms(bypassRooms);
    }

    function autoDiscoverObservers() {
        const newObservers: BetterMoveObserverRuntime[] = [];

        for (const id in Game.structures) {
            const structure = Game.structures[id];
            if (isOwnedObserver(structure)) {
                const observer = structure;
                const existing = deps.observers.find((ob) => ob.id === id);
                if (existing) {
                    if (typeof existing.taskHead !== 'number') {
                        existing.taskHead = 0;
                    }
                    newObservers.push(existing);
                } else {
                    newObservers.push({ id, roomName: observer.room.name, taskQueue: [], taskHead: 0 });
                }
            }
        }

        deps.observers.length = 0;
        for (const obs of newObservers) {
            deps.observers.push(obs);
        }
    }

    // 返回运行时 avoidRooms 的实时映射，保持与旧 BetterMove 控制台接口一致。
    function bmGetAvoidRoomsMap() {
        return deps.avoidRooms;
    }

    // 返回运行时 avoidExits 的实时映射，供控制台排查出口避让状态。
    function bmGetAvoidExitsMap() {
        return deps.avoidExits;
    }

    function bmAddAvoidRooms(roomName) {
        if (!deps.parseRoomName(roomName)) {
            return ERR_INVALID_ARGS;
        }
        if (!(roomName in deps.avoidRooms)) {
            deps.avoidRooms[roomName] = 1;
            deps.markAvoidRoomsChanged();
        }
        return OK;
    }

    function bmDeleteAvoidRooms(roomName) {
        if (!deps.parseRoomName(roomName) || !deps.avoidRooms[roomName]) {
            return ERR_INVALID_ARGS;
        }
        delete deps.avoidRooms[roomName];
        deps.markAvoidRoomsChanged();
        return OK;
    }

    function bmClearAvoidExits(fromRoomName) {
        if (fromRoomName === undefined) {
            let changed = false;
            for (const key in deps.avoidExits) {
                delete deps.avoidExits[key];
                changed = true;
            }
            if (changed) {
                deps.markAvoidExitsChanged();
            }
            return OK;
        }

        if (!deps.parseRoomName(fromRoomName)) {
            return ERR_INVALID_ARGS;
        }
        if (!(fromRoomName in deps.avoidExits)) {
            return ERR_NOT_FOUND;
        }
        delete deps.avoidExits[fromRoomName];
        deps.markAvoidExitsChanged();
        return OK;
    }

    function bmAddAvoidExits(fromRoomName, toRoomName) {
        if (!deps.parseRoomName(fromRoomName) || !deps.parseRoomName(toRoomName)) {
            return ERR_INVALID_ARGS;
        }
        deps.avoidExits[fromRoomName]
            ? deps.avoidExits[fromRoomName][toRoomName] = 1
            : deps.avoidExits[fromRoomName] = { [toRoomName]: 1 } as RoomFlagMap;
        deps.markAvoidExitsChanged();
        return OK;
    }

    function bmDeleteAvoidExits(fromRoomName, toRoomName) {
        if (!deps.parseRoomName(fromRoomName) || !deps.parseRoomName(toRoomName)) {
            return ERR_INVALID_ARGS;
        }
        if (fromRoomName in deps.avoidExits && toRoomName in deps.avoidExits[fromRoomName]) {
            delete deps.avoidExits[fromRoomName][toRoomName];
        }
        deps.markAvoidExitsChanged();
        return OK;
    }

    return {
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
    };
}

export function createCleanupModule(deps: CleanupDeps) {
    function clearDeadCreepPathCache() {
        if (Game.time % deps.getPathClearDelay() == 0) {
            for (const name in deps.creepPathCache) {
                if (!(name in Game.creeps)) {
                    delete deps.creepPathCache[name];
                }
            }
        }
    }

    function clearExpiredPaths() {
        deps.drainDueTickQueue(deps.pathCacheTimerDueQueue, Game.time, (time) => {
            const paths = deps.pathCacheTimer[time] as BetterMovePath[] | undefined;
            if (!paths || !paths.length) {
                delete deps.pathCacheTimer[time];
                return;
            }
            for (let i = paths.length; i--;) {
                const path = paths[i];
                if (path.lastTime == time - deps.getPathClearDelay()) {
                    deps.deletePath(path);
                }
            }
            delete deps.pathCacheTimer[time];
        });
    }

    function clearExpiredCostMatrix() {
        deps.drainDueTickQueue(deps.costMatrixCacheTimerDueQueue, Game.time, (time) => {
            let avoidChanged = false;
            const dataList = deps.costMatrixCacheTimer[time] as Array<{ roomName: string; avoids: string[] }> | undefined;
            if (!dataList || !dataList.length) {
                delete deps.costMatrixCacheTimer[time];
                return;
            }
            for (let i = dataList.length; i--;) {
                const data = dataList[i];
                delete deps.costMatrixCache[data.roomName];
                delete deps.costMatrixRevision[data.roomName];
                delete deps.sameRoomEdgeCostMatCache[data.roomName];
                const avoids = data.avoids;
                for (let j = avoids.length; j--;) {
                    const avoidRoomName = avoids[j];
                    if (avoidRoomName in deps.avoidRooms) {
                        delete deps.avoidRooms[avoidRoomName];
                        avoidChanged = true;
                    }
                }
            }
            if (avoidChanged) {
                deps.markAvoidRoomsChanged();
            }
            delete deps.costMatrixCacheTimer[time];
        });
    }

    function clearUnused() {
        clearDeadCreepPathCache();
        clearExpiredPaths();
        clearExpiredCostMatrix();
    }

    function bmClear(opts) {
        const options = (opts && typeof opts === 'object') ? opts : {};
        const clearAvoidRooms = !!options.clearAvoidRooms;
        const clearAvoidExitsFlag = !!options.clearAvoidExits;
        const clearPortals = !!options.clearPortals;
        const rediscoverObservers = options.rediscoverObservers !== false;
        const resetStats = options.resetStats !== false;

        clearObjectKeys(deps.globalPathCache);
        clearObjectKeys(deps.globalPathCacheByVariant);
        deps.setGlobalPathCacheBucketCount(0);
        deps.setGlobalPathCachePathCount(0);
        deps.pathCacheInsertQueue.length = 0;
        deps.setPathCacheInsertHead(0);
        clearObjectKeys(deps.roomSameRoomPathRefs);
        clearObjectKeys(deps.roomSameRoomPathCount);
        clearObjectKeys(deps.roomStartKeyRefs);
        clearObjectKeys(deps.roomStartKeyCount);
        clearObjectKeys(deps.endKeyStartKeyRefs);
        clearObjectKeys(deps.roomEndKeyRefs);
        clearObjectKeys(deps.roomEndKeyCount);
        clearObjectKeys(deps.pathCacheTimer);
        deps.clearDueTickQueue(deps.pathCacheTimerDueQueue);
        clearObjectKeys(deps.creepPathCache);
        clearObjectKeys(deps.creepMoveCache);
        clearObjectKeys(deps.costMatrixCache);
        clearObjectKeys(deps.costMatrixRevision);
        clearObjectKeys(deps.costMatrixCacheTimer);
        deps.clearDueTickQueue(deps.costMatrixCacheTimerDueQueue);
        deps.clearRouteCacheEntries();
        clearObjectKeys(deps.routeCacheKeysByDueTick);
        deps.clearDueTickQueue(deps.routeCacheDueQueue);
        deps.setRouteCacheTrackedTtl(-1);
        clearObjectKeys(deps.bypassRouteCacheKeysByTick);
        deps.clearDueTickQueue(deps.bypassRouteCacheDueQueue);
        clearObjectKeys(deps.bypassCostMatReuseCache);
        clearObjectKeys(deps.temporalAvoidExitCache);
        deps.setTemporalAvoidExitCacheTick(-1);
        deps.setTemporalAvoidRooms('', '');
        deps.setBounceAvoidState('', '', 0);
        clearObjectKeys(deps.geometryCaches.roomNameParseCache);
        clearObjectKeys(deps.geometryCaches.shardRoomNameParseCache);
        deps.geometryCaches.tileToPosCache.clear();
        deps.setSquadDerivedState(-1, Object.create(null));
        deps.resetMoveIntentState();
        deps.setCheckTile(undefined);

        deps.observers.length = 0;
        clearObjectKeys(deps.obTimer);
        deps.clearDueTickQueue(deps.obTimerDueQueue);
        deps.setAutoDiscoverObserverTick(-1);
        deps.setObTick(Game.time);
        if (rediscoverObservers) {
            deps.ensureObserversUpToDate();
        }

        if (clearAvoidRooms) {
            clearObjectKeys(deps.avoidRooms);
            clearObjectKeys(deps.syncedBypassRooms);
            deps.setAvoidRoomsMemoryInitialized(false);
            deps.setAvoidRoomsMemorySignature('');
            deps.setAvoidRoomsSyncTick(-1);
            deps.markAvoidRoomsChanged();
        }

        if (clearAvoidExitsFlag) {
            clearObjectKeys(deps.avoidExits);
            deps.markAvoidExitsChanged();
        }

        if (clearPortals) {
            getCleanupGlobalScope()._bmPortals = { v: 1, list: [], updated: Game.time };
            deps.resetPortalScanState();
        }

        if (resetStats) {
            deps.resetMoveOptStats();
        }

        return OK;
    }

    return {
        clearObjectKeys,
        clearDeadCreepPathCache,
        clearExpiredPaths,
        clearExpiredCostMatrix,
        clearUnused,
        bmClear,
    };
}
