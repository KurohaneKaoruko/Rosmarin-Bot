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
};

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

export type BetterMoveConfigPatch = Partial<BetterMoveConfig> & Record<string, unknown>;
