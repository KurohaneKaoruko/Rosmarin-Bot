/**
 * BetterMove 过期缓存清理与运行时状态重置。
 * @description
 * 把路径/CostMatrix 的定时回收，以及 `BetterMove.clear()` 的热重载恢复逻辑
 * 从主文件抽走，避免 `index.ts` 在核心移动流程中混入大量 housekeeping 细节。
 */
type Dictionary = Record<string, unknown>;
type ObserverRuntime = {
    id: string;
    roomName: string;
    taskQueue: unknown[];
    taskHead: number;
};
type BetterMovePortalRegistry = {
    v: number;
    list: unknown[];
    updated: number;
};
type BetterMoveGlobalState = typeof globalThis & {
    _bmPortals?: BetterMovePortalRegistry;
};
type DueTickQueue = {
    heap: number[];
    marks: Record<number, 1>;
};
type CleanupDeps = {
    globalPathCache: Dictionary;
    globalPathCacheByVariant: Dictionary;
    roomSameRoomPathRefs: Dictionary;
    roomSameRoomPathCount: Dictionary;
    roomStartKeyRefs: Dictionary;
    roomStartKeyCount: Dictionary;
    endKeyStartKeyRefs: Dictionary;
    roomEndKeyRefs: Dictionary;
    roomEndKeyCount: Dictionary;
    creepPathCache: Dictionary;
    creepMoveCache: Dictionary;
    pathCacheTimer: Dictionary;
    pathCacheTimerDueQueue: DueTickQueue;
    pathCacheInsertQueue: unknown[];
    costMatrixCacheTimer: Dictionary;
    costMatrixCacheTimerDueQueue: DueTickQueue;
    costMatrixCache: Dictionary;
    costMatrixRevision: Dictionary;
    sameRoomEdgeCostMatCache: Dictionary;
    avoidRooms: Dictionary;
    avoidExits: Dictionary;
    syncedBypassRooms: Dictionary;
    observers: ObserverRuntime[];
    obTimer: Dictionary;
    obTimerDueQueue: DueTickQueue;
    routeCacheKeysByDueTick: Dictionary;
    routeCacheDueQueue: DueTickQueue;
    bypassRouteCacheKeysByTick: Dictionary;
    bypassRouteCacheDueQueue: DueTickQueue;
    bypassCostMatReuseCache: Dictionary;
    temporalAvoidExitCache: Dictionary;
    geometryCaches: {
        roomNameParseCache: Dictionary;
        shardRoomNameParseCache: Dictionary;
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
    setSquadDerivedState: (tick: number, cache: Dictionary) => void;
    setAutoDiscoverObserverTick: (value: number) => void;
    setObTick: (value: number) => void;
    setAvoidRoomsMemoryInitialized: (value: boolean) => void;
    setAvoidRoomsMemorySignature: (value: string) => void;
    setAvoidRoomsSyncTick: (value: number) => void;
    deletePath: (path: any) => void;
    drainDueTickQueue: (queue: DueTickQueue, now: number, visit: (tick: number) => void) => void;
    clearDueTickQueue: (queue: DueTickQueue) => void;
    markAvoidRoomsChanged: () => void;
    markAvoidExitsChanged: () => void;
    clearRouteCacheEntries: () => void;
    resetPortalScanState: () => void;
    ensureObserversUpToDate: () => void;
    resetMoveOptStats: () => void;
    resetMoveIntentState: () => void;
    setCheckTile: (value: ((posList: RoomPosition[]) => unknown) | undefined) => void;
};

export function clearObjectKeys(obj: Dictionary) {
    for (const key in obj) {
        delete obj[key];
    }
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
            const paths = deps.pathCacheTimer[time] as Array<{ lastTime?: number }> | undefined;
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

    /**
     * 清空 BetterMove 运行时缓存，供热重载或线上诊断后快速恢复到干净状态。
     * 这里保留旧接口的可选开关语义，避免调用方脚本行为发生漂移。
     */
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
        // 清缓存时同步恢复默认检查器，避免热重载残留自定义检查函数。
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
            (globalThis as BetterMoveGlobalState)._bmPortals = { v: 1, list: [], updated: Game.time };
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
