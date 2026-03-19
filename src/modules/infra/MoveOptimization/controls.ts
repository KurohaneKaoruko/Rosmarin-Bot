/**
 * BetterMove 运行时控制面。
 * @description
 * 统一封装原型挂载开关、统计打印与运行时配置更新，
 * 让 `index.ts` 更聚焦在移动主流程与模块装配本身。
 */
type CpuBucket = {
    sum: number;
    calls: number;
    moveCount?: number;
};

type AnalyzeCpuMap = Record<string, CpuBucket> & {
    endTickResolve: {
        sum: number;
        calls: number;
        moveCount: number;
    };
};

type RuntimeMetrics = {
    pathCounter: number;
    testCacheHits: number;
    testCacheMiss: number;
    testNormal: number;
    testNearStorageCheck: number;
    testNearStorageSwap: number;
    testTrySwap: number;
    testBypass: number;
    normalLogicalCost: number;
    cacheHitCost: number;
    cacheMissCost: number;
};

type BetterMoveCreepPrototype = typeof Creep.prototype & {
    $move?: typeof Creep.prototype.move;
    $moveTo?: typeof Creep.prototype.moveTo;
    $pull?: typeof Creep.prototype.pull;
    $flee?: (targets: unknown[], opts?: MoveToOpts) => ScreepsReturnCode;
    flee?: (targets: unknown[], opts?: MoveToOpts) => ScreepsReturnCode;
};

type BetterMoveRoomPositionPrototype = typeof RoomPosition.prototype & {
    $findClosestByPath?: typeof RoomPosition.prototype.findClosestByPath;
    $findSquadPathTo?: typeof RoomPosition.prototype.findSquadPathTo;
    findSquadPathTo?: typeof RoomPosition.prototype.findSquadPathTo;
};

type RuntimeControlDeps = {
    config: Record<string, any>;
    analyzeCPU: AnalyzeCpuMap;
    runtimeMetrics: RuntimeMetrics;
    getCacheStats: () => BetterMoveCacheStats;
    isCpuStatsEnabled: () => boolean;
    resetCacheRuntimeStats: () => void;
    applyConfig: () => void;
    originMoveTo: (...args: any[]) => any;
    wrapFn: (fn: Function, name: string) => any;
    updateDontPullMeForMoveTo: (creep: Creep) => void;
    wrapProtoMethod: (proto: object, originalName: string, backupName: string, wrap: Function) => void;
    restorePowerCreepNativeMethods: () => void;
    betterMoveTo: (...args: any[]) => any;
    betterMove: (...args: any[]) => any;
    betterPull: (...args: any[]) => any;
    betterFindClosestByPath: (...args: any[]) => any;
    findSquadPathTo: (...args: any[]) => any;
    flee: (...args: any[]) => any;
};

type RuntimeControlApi = {
    bmPrint: () => string;
    bmSetChangeMoveTo: (bool: boolean) => ScreepsReturnCode;
    bmSetChangeMove: (bool: boolean) => ScreepsReturnCode;
    bmSetChangeFindClostestByPath: (bool: boolean) => ScreepsReturnCode;
    bmSetEnableSquadPath: (bool: boolean) => ScreepsReturnCode;
    bmSetEnableFlee: (bool: boolean) => ScreepsReturnCode;
    bmGetConfig: () => Record<string, any>;
    bmSetConfig: (partial: Record<string, any>) => ScreepsReturnCode;
    resetMoveOptStats: () => void;
    bmResetCacheStats: () => ScreepsReturnCode;
};

type BetterMovePortalRecord = {
    roomName?: string;
    x?: number;
    y?: number;
    destShard?: string;
    destRoom?: string;
    destX?: number;
    destY?: number;
    lastSeen?: number;
};

type BetterMoveGlobalApiDeps = {
    bmSetChangeMove: BetterMoveAPI['setChangeMove'];
    creepPathCache: BetterMoveAPI['creepPathCache'];
    preTickBetterMove: BetterMoveAPI['preTickBetterMove'];
    squadMove: BetterMoveAPI['squadMove'];
    squadMoveTo: BetterMoveAPI['squadMoveTo'];
    bmSetChangeMoveTo: BetterMoveAPI['setChangeMoveTo'];
    setCheckTile: BetterMoveAPI['setCheckTile'];
    bmSetChangeFindClostestByPath: BetterMoveAPI['setChangeFindClostestByPath'];
    bmSetPathClearDelay: BetterMoveAPI['setPathClearDelay'];
    bmSetHostileCostMatrixClearDelay: BetterMoveAPI['setHostileCostMatrixClearDelay'];
    bmDeleteCostMatrix: BetterMoveAPI['deleteCostMatrix'];
    bmDeletePath: (fromPos: RoomPosition | { pos: RoomPosition }, toPos: RoomPosition | { pos: RoomPosition }, opts?: MoveToOpts) => ScreepsReturnCode;
    bmDeltePath: BetterMoveAPI['deltePath'];
    bmGetAvoidRoomsMap: BetterMoveAPI['getAvoidRoomsMap'];
    bmGetAvoidExitsMap: BetterMoveAPI['getAvoidExitsMap'];
    bmAddAvoidRooms: BetterMoveAPI['addAvoidRooms'];
    bmDeleteAvoidRooms: BetterMoveAPI['deleteAvoidRooms'];
    bmClearAvoidExits: BetterMoveAPI['clearAvoidExits'];
    getClosestExitPos: BetterMoveAPI['getClosestExitPos'];
    bmSetEnableSquadPath: BetterMoveAPI['setEnableSquadPath'];
    bmSetEnableFlee: BetterMoveAPI['setEnableFlee'];
    bmGetConfig: BetterMoveAPI['getConfig'];
    bmSetConfig: BetterMoveAPI['setConfig'];
    bmGetCacheStats: BetterMoveAPI['getCacheStats'];
    bmResetCacheStats: BetterMoveAPI['resetCacheStats'];
    bmDeletePathInRoom: BetterMoveAPI['deletePathInRoom'];
    bmAddAvoidExits: BetterMoveAPI['addAvoidExits'];
    bmDeleteAvoidExits: BetterMoveAPI['deleteAvoidExits'];
    scanPortals: (force: boolean) => void;
    getPortalRegistry: () => { v: number; list: BetterMovePortalRecord[]; updated: number };
    endTickResolve: BetterMoveAPI['endTickResolve'];
    bmPrint: BetterMoveAPI['print'];
    bmClear: BetterMoveAPI['clear'];
};

export function createMoveRuntimeControlModule(deps: RuntimeControlDeps): RuntimeControlApi {
    const creepProto = Creep.prototype as BetterMoveCreepPrototype;
    const roomPositionProto = RoomPosition.prototype as BetterMoveRoomPositionPrototype;

    function appendCacheStatsText(text) {
        const stats = deps.getCacheStats();
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
        if (!deps.isCpuStatsEnabled()) {
            return appendCacheStatsText('\n[BetterMove] cpu stats disabled (set config.enableCpuStats=true to enable)');
        }

        let text = '\navarageTime\tcalls\tFunctionName';
        for (const fn in deps.analyzeCPU) {
            const calls = deps.analyzeCPU[fn].calls;
            text += '\n' + safeDiv(deps.analyzeCPU[fn].sum, calls).toFixed(5) + '\t\t' + calls + '\t\t' + fn;
        }

        const metrics = deps.runtimeMetrics;
        const hitCost = safeDiv(metrics.cacheHitCost, metrics.testCacheHits);
        const missCost = safeDiv(metrics.cacheMissCost, metrics.testCacheMiss);
        const searchCount = metrics.testCacheHits + metrics.testCacheMiss;
        const missRate = safeDiv(metrics.testCacheMiss, searchCount);
        const hitRate = searchCount ? (1 - missRate) : 0;
        // 刚启用统计时经常立即手动 print，这里统一兜底，避免出现 NaN / Infinity。
        const moveToCalls = deps.analyzeCPU.moveTo?.calls || 0;

        text += '\nnormal logical cost: ' + safeDiv(metrics.normalLogicalCost, metrics.testNormal).toFixed(5) + ', total cross rate: ' + safeDiv(metrics.testTrySwap, moveToCalls).toFixed(4) + ', total bypass rate:  ' + safeDiv(metrics.testBypass, moveToCalls).toFixed(4);
        text += '\nnear storage check rate: ' + safeDiv(metrics.testNearStorageCheck, moveToCalls).toFixed(4) + ', near storage cross rate: ' + safeDiv(metrics.testNearStorageSwap, metrics.testNearStorageCheck).toFixed(4);
        text += '\ncache search rate: ' + safeDiv(searchCount, moveToCalls).toFixed(4) + ', total hit rate: ' + hitRate.toFixed(4) + ', avg check paths: ' + safeDiv(metrics.pathCounter, searchCount).toFixed(3);
        text += '\ncache hit avg cost: ' + hitCost.toFixed(5) + ', cache miss avg cost: ' + missCost.toFixed(5) + ', total avg cost: ' + (hitCost * hitRate + missCost * missRate).toFixed(5);
        return appendCacheStatsText(text);
    }

    function bmSetChangeMoveTo(bool) {
        deps.config.changeMoveTo = !!bool;
        const creepCore = bool ? deps.betterMoveTo : deps.originMoveTo;
        const creepImpl = deps.wrapFn(function (...args) {
            deps.updateDontPullMeForMoveTo(this);
            return creepCore.apply(this, args);
        }, 'moveTo');
        deps.wrapProtoMethod(Creep.prototype, 'moveTo', '$moveTo', creepImpl);
        deps.restorePowerCreepNativeMethods();
        deps.analyzeCPU.moveTo = { sum: 0, calls: 0 };
        const metrics = deps.runtimeMetrics;
        metrics.testCacheHits = 0;
        metrics.testCacheMiss = 0;
        metrics.testNormal = 0;
        metrics.testNearStorageCheck = 0;
        metrics.testNearStorageSwap = 0;
        metrics.testTrySwap = 0;
        metrics.testBypass = 0;
        metrics.normalLogicalCost = 0;
        metrics.cacheHitCost = 0;
        metrics.cacheMissCost = 0;
        return OK;
    }

    function bmSetChangeMove(bool) {
        deps.config.changeMove = !!bool;
        if (bool) {
            deps.wrapProtoMethod(Creep.prototype, 'move', '$move', deps.wrapFn(deps.betterMove, 'move'));
            deps.wrapProtoMethod(Creep.prototype, 'pull', '$pull', deps.wrapFn(deps.betterPull, 'pull'));
        } else if (bool === false) {
            if (creepProto.$move) {
                Creep.prototype.move = creepProto.$move;
            }
            if (creepProto.$pull) {
                Creep.prototype.pull = creepProto.$pull;
            }
        }
        deps.restorePowerCreepNativeMethods();
        deps.analyzeCPU.move = { sum: 0, calls: 0 };
        return OK;
    }

    function bmSetChangeFindClostestByPath(bool) {
        deps.config.changeFindClostestByPath = !!bool;
        if (bool) {
            if (!roomPositionProto.$findClosestByPath) {
                roomPositionProto.$findClosestByPath = RoomPosition.prototype.findClosestByPath;
            }
            RoomPosition.prototype.findClosestByPath = deps.wrapFn(deps.betterFindClosestByPath, 'findClosestByPath');
        } else if (bool === false) {
            if (roomPositionProto.$findClosestByPath) {
                RoomPosition.prototype.findClosestByPath = roomPositionProto.$findClosestByPath;
            }
        }
        deps.analyzeCPU.findClosestByPath = { sum: 0, calls: 0 };
        return OK;
    }

    function bmSetEnableSquadPath(bool) {
        deps.config.enableSquadPath = !!bool;
        if (bool) {
            if (!roomPositionProto.$findSquadPathTo) {
                roomPositionProto.$findSquadPathTo = RoomPosition.prototype.findSquadPathTo;
            }
            RoomPosition.prototype.findSquadPathTo = deps.wrapFn(deps.findSquadPathTo, 'findSquadPathTo');
        } else if (bool === false) {
            if (roomPositionProto.$findSquadPathTo) {
                RoomPosition.prototype.findSquadPathTo = roomPositionProto.$findSquadPathTo;
            }
        }
        return OK;
    }

    function bmSetEnableFlee(bool) {
        deps.config.enableFlee = !!bool;
        if (bool) {
            if (!creepProto.$flee) {
                creepProto.$flee = creepProto.flee;
            }
            creepProto.flee = deps.wrapFn(deps.flee, 'flee');
        } else if (bool === false) {
            if (creepProto.$flee) {
                creepProto.flee = creepProto.$flee;
            } else {
                delete creepProto.flee;
            }
        }
        return OK;
    }

    function bmGetConfig() {
        return deps.config;
    }

    function resetMoveOptStats() {
        for (const fn in deps.analyzeCPU) {
            deps.analyzeCPU[fn] = { sum: 0, calls: 0 };
        }
        deps.analyzeCPU.endTickResolve = { sum: 0, calls: 0, moveCount: 0 };
        const metrics = deps.runtimeMetrics;
        metrics.pathCounter = 0;
        metrics.testCacheHits = 0;
        metrics.testCacheMiss = 0;
        metrics.testNormal = 0;
        metrics.testNearStorageCheck = 0;
        metrics.testNearStorageSwap = 0;
        metrics.testTrySwap = 0;
        metrics.testBypass = 0;
        metrics.normalLogicalCost = 0;
        metrics.cacheHitCost = 0;
        metrics.cacheMissCost = 0;
        deps.resetCacheRuntimeStats();
    }

    function bmResetCacheStats() {
        deps.resetCacheRuntimeStats();
        return OK;
    }

    function bmSetConfig(partial) {
        if (!partial || typeof partial !== 'object') {
            return ERR_INVALID_ARGS;
        }
        Object.assign(deps.config, partial);
        if ('enableCacheStats' in partial && !partial.enableCacheStats) {
            deps.resetCacheRuntimeStats();
        }
        deps.applyConfig();
        return OK;
    }

    return {
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
    };
}

/**
 * 组装 BetterMove 对外控制面。
 * @description
 * 这里和运行时控制逻辑放在同一个文件里，避免再拆出一个只负责
 * `global.BetterMove = { ... }` 映射表的薄包装模块。
 */
export function createBetterMoveGlobalApi(deps: BetterMoveGlobalApiDeps): BetterMoveAPI {
    return {
        setChangeMove: deps.bmSetChangeMove,
        creepPathCache: deps.creepPathCache,
        preTickBetterMove: deps.preTickBetterMove,
        squadMove: deps.squadMove,
        squadMoveTo: deps.squadMoveTo,
        setChangeMoveTo: deps.bmSetChangeMoveTo,
        setCheckTile: deps.setCheckTile,
        setChangeFindClostestByPath: deps.bmSetChangeFindClostestByPath,
        setPathClearDelay: deps.bmSetPathClearDelay,
        setHostileCostMatrixClearDelay: deps.bmSetHostileCostMatrixClearDelay,
        deleteCostMatrix: deps.bmDeleteCostMatrix,
        deletePath: deps.bmDeletePath,
        deltePath: deps.bmDeltePath,
        getAvoidRoomsMap: deps.bmGetAvoidRoomsMap,
        getAvoidExitsMap: deps.bmGetAvoidExitsMap,
        addAvoidRooms: deps.bmAddAvoidRooms,
        deleteAvoidRooms: deps.bmDeleteAvoidRooms,
        clearAvoidExits: deps.bmClearAvoidExits,
        getClosestExitPos: deps.getClosestExitPos,
        setEnableSquadPath: deps.bmSetEnableSquadPath,
        setEnableFlee: deps.bmSetEnableFlee,
        getConfig: deps.bmGetConfig,
        setConfig: deps.bmSetConfig,
        getCacheStats: deps.bmGetCacheStats,
        resetCacheStats: deps.bmResetCacheStats,
        deletePathInRoom: deps.bmDeletePathInRoom,
        addAvoidExits: deps.bmAddAvoidExits,
        deleteAvoidExits: deps.bmDeleteAvoidExits,
        syncPortals() {
            // 立即扫描一次可见房间中的 portal，并写入全局注册表。
            deps.scanPortals(true);
            return deps.getPortalRegistry();
        },
        printPortals(targetShard) {
            // 控制台调试辅助：把当前 shard 已登记的 portal 打印出来。
            const reg = deps.getPortalRegistry();
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
        endTickResolve: deps.endTickResolve,
        print: deps.bmPrint,
        clear: deps.bmClear,
    };
}
