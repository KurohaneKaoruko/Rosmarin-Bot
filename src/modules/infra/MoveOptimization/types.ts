/**
 * BetterMove 共享运行时类型。
 * @description
 * 只放多个模块都会复用、而且语义稳定的运行时结构，
 * 避免 `movement/pathing/controls/cleanup` 各自重复声明一份。
 */

export type FormalizedPos = {
    x: number;
    y: number;
};

export type BetterMovePortalRecord = {
    roomName?: string;
    x?: number;
    y?: number;
    destShard?: string;
    destRoom?: string;
    destX?: number;
    destY?: number;
    lastSeen?: number;
};

export type BetterMovePortalRegistry = {
    v: number;
    list: BetterMovePortalRecord[];
    updated: number;
};

export type BetterMoveParsedShardRoomName = {
    shard: string | null;
    room: string | null | undefined;
};

export type BetterMovePath = {
    start?: FormalizedPos;
    end?: FormalizedPos;
    posArray: RoomPosition[];
    ignoreRoads?: boolean;
    ignoreStructures?: boolean;
    ignoreSwamps?: boolean;
    directionArray?: Array<DirectionConstant | 0>;
    lastTime?: number;
    _bmVersion?: number;
    _bmObDedup?: Record<number, number>;
    _bmVariantKey?: string;
    _bmDeletedTick?: number;
};

export type BetterMovePathBucket = Record<number, BetterMovePath[]>;

export type BetterMovePathVariantBucket = Record<string, BetterMovePathBucket>;

export type BetterMovePathCache = Record<number, BetterMovePathBucket>;

export type BetterMovePathVariantCache = Record<number, BetterMovePathVariantBucket>;

export type BetterMovePathRefCountBucket = Record<number, number>;

export type BetterMoveSameRoomPathBucket = Record<number, BetterMovePath>;

export type BetterMoveSameRoomPathRefs = Record<string, BetterMoveSameRoomPathBucket>;

export type BetterMoveRoomPathRefCounts = Record<string, BetterMovePathRefCountBucket>;

export type BetterMoveEndKeyPathRefCounts = Record<number, BetterMovePathRefCountBucket>;

export type BetterMoveRoomCounterMap = Record<string, number>;

export type BetterMoveRoomCostMatrixCacheEntry = {
    roomName?: string;
    my?: boolean;
    true: CostMatrix;
    false: CostMatrix;
    squad: CostMatrix;
    squadFalse: CostMatrix;
    squadTrue: CostMatrix;
    edgeArray?: Uint16Array;
};

export type BetterMoveRoomCostMatrixCache = Record<string, BetterMoveRoomCostMatrixCacheEntry | undefined>;

export type BetterMoveSameRoomEdgeCostMatrixEntry = {
    revision: number;
    true: CostMatrix | null;
    false: CostMatrix | null;
};

export type BetterMoveSameRoomEdgeCostMatrixCache = Record<string, BetterMoveSameRoomEdgeCostMatrixEntry | undefined>;

export type TemporalBypassState = {
    signature: string;
    lastAttemptTick: number;
    nextRetryTick: number;
    failCount: number;
};

export type CreepPathCacheEntry = {
    dst?: RoomPosition | { x: number; y: number; roomName?: string };
    path?: BetterMovePath;
    idx: number;
    avoidSignature?: string;
    _bmTemporalBypass?: TemporalBypassState;
};

export type BetterMoveObserverTask = {
    path: BetterMovePath;
    idx: number;
    roomName: string;
    createdTick?: number;
    expireTick?: number;
    pathVersion?: number;
};

export type BetterMoveObserverRuntime = {
    id: string;
    roomName: string;
    taskQueue: BetterMoveObserverTask[];
    taskHead: number;
    lastIssuedTick?: number;
};

export type BetterMoveTarget = RoomPosition | { pos: RoomPosition };

export type BetterMovePathCacheEntry = CreepPathCacheEntry;

export type BetterMoveTileIntent = {
    start: string | number;
    isSuper: boolean;
    targetList: Array<{
        target: number | number[];
        score: number;
    }>;
};

export type BetterMoveFleeTarget =
    | RoomPosition
    | {
        pos: RoomPosition;
        range?: number;
    };

export type BetterMovePathSearchResult = {
    path: RoomPosition[];
    incomplete?: boolean;
};

export type BetterMovePathInsertToken = {
    startKey: number;
    endKey: number;
    version: number;
};

export type BetterMoveCacheStats = {
    enabled: boolean;
    tick: number;
    route: {
        lookups: number;
        hits: number;
        misses: number;
        hitRate: number;
        writes: number;
        skipByBudget: number;
        skipByCapacity: number;
        skipRate: number;
        evictTTL: number;
        evictBypass: number;
        size: number;
        nonBypassSize: number;
    };
    path: {
        inserts: number;
        trimRuns: number;
        trimScans: number;
        trimDeletes: number;
        trimHitRate: number;
        size: number;
        insertQueueSize: number;
    };
};

export type BetterMoveConfig = {
    changeMove: boolean;
    changeMoveTo: boolean;
    changeFindClostestByPath: boolean;
    autoVisual: boolean;
    enableCpuStats: boolean;
    enableCacheStats: boolean;
    enableFlee: boolean;
    enableSquadPath: boolean;
    enableRouteCache: boolean;
    routeCacheTTL: number;
    routeCacheMaxEntries: number;
    routeCacheMaxNewPerTick: number;
    enableBypassCostMatReuse: boolean;
    enableSameRoomDetourCooldown: boolean;
    sameRoomDetourCooldownTTL: number;
    enableRoomBounceGuardV2: boolean;
    roomBounceWindow: number;
    roomBounceTTL: number;
    enableSameRoomDetourCooldownV2: boolean;
    sameRoomDetourBounceWindow: number;
    enableSameRoomEdgePenalty: boolean;
    sameRoomEdgePenaltyCost: number;
    enableTemporalBypassRefine: boolean;
    temporalAvoidExitCheckTTL: number;
    temporalBypassRetryMinTicks: number;
    temporalBypassRetryMaxTicks: number;
    pathCacheMaxEntries: number;
    pathCacheTrimBatch: number;
    enableObserverQueueRefine: boolean;
    observerTaskTTL: number;
};

export type BetterMoveConfigPatch = Partial<BetterMoveConfig>;
