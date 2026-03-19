/**
 * moveOpt 类型扩展
 * @description 为移动优化模块补齐 MoveToOpts 扩展字段与 global.BetterMove API 类型
 */

// ============================================================
// MoveToOpts 扩展 - MoveToOpts Extensions
// ============================================================

/**
 * 扩展 Screeps 原生 MoveToOpts
 * @description moveOpt 会读取这些扩展字段；不声明会导致 TS 侧访问报错
 */
interface MoveToOpts {
  /**
   * 移动优先级
   * @description 0~2，值越高越不容易在拥堵解算中让位
   */
  priority?: number;

  /**
   * 无视 swamp 与 road 的移动力损耗差异
   * @description 主要用于 power creep / 观察者等单位，默认 false
   */
  ignoreSwamps?: boolean;

  /**
   * 被 creep 挡路时，是否绕过敌方 creep
   * @description 默认 true；设为 false 可用于近战贴脸攻击
   */
  bypassHostileCreeps?: boolean;

  /**
   * 绕路半径
   * @description 当被 creep 挡路且触发绕路时生效，默认 5
   */
  bypassRange?: number;

  /**
   * 寻得不完整路径时的再次寻路延迟
   * @description 默认 10（由 moveOpt 内部控制）
   */
  noPathDelay?: number;

  /**
   * 额外避让房间
   * @description 仅对本次 moveTo 生效
   */
  avoidRooms?: Set<string>;

  /**
   * 额外避让出口
   * @description 仅对本次 moveTo 生效，格式为 fromRoom -> toRoom 集合
   */
  avoidExits?: Map<string, Set<string>>;
}

interface SquadMoveToOpts extends MoveToOpts {
  /**
   * 小队移动时是否允许自动 pull
   * @description 默认 true，仅对 squadMoveTo 生效
   */
  enableAutoPull?: boolean;
}

// ============================================================
// global.BetterMove - BetterMove Global API
// ============================================================

/**
 * BetterMove 全局 API
 * @description moveOpt 在加载时挂载 global.BetterMove
 */
interface BetterMoveCacheStats {
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
}

interface BetterMovePathCacheEntry {
  dst?: RoomPosition | { x: number; y: number; roomName?: string };
  path?: {
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    posArray: RoomPosition[];
    ignoreRoads?: boolean;
    ignoreStructures?: boolean;
    ignoreSwamps?: boolean;
    directionArray?: Array<DirectionConstant | 0>;
    lastTime?: number;
  };
  idx: number;
  avoidSignature?: string;
}

interface BetterMoveTileIntent {
  start: string | number;
  isSuper: boolean;
  targetList: Array<{
    target: number | number[];
    score: number;
  }>;
}

interface BetterMovePortalRecord {
  roomName?: string;
  x?: number;
  y?: number;
  destShard?: string;
  destRoom?: string;
  destX?: number;
  destY?: number;
  lastSeen?: number;
}

interface BetterMovePortalRegistry {
  v: number;
  list: BetterMovePortalRecord[];
  updated: number;
}

interface BetterMoveConfig {
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
}

interface BetterMoveAPI {
  setChangeMove(bool: boolean): ScreepsReturnCode;
  creepPathCache: Record<string, BetterMovePathCacheEntry | undefined>;
  preTickBetterMove(): void;
  squadMove(squad: Creep[], target?: Array<RoomPosition | { pos: RoomPosition }>): ScreepsReturnCode;
  squadMoveTo(squad: Creep[], x: number, y: number, opts?: SquadMoveToOpts): ScreepsReturnCode;
  squadMoveTo(squad: Creep[], target: RoomPosition | { pos: RoomPosition }, opts?: SquadMoveToOpts): ScreepsReturnCode;
  setChangeMoveTo(bool: boolean): ScreepsReturnCode;
  setCheckTile(userCheckTile?: (posList: RoomPosition[]) => BetterMoveTileIntent[]): ScreepsReturnCode;
  setChangeFindClostestByPath(bool: boolean): ScreepsReturnCode;
  setPathClearDelay(number?: number): ScreepsReturnCode;
  setHostileCostMatrixClearDelay(number?: number): ScreepsReturnCode;
  deleteCostMatrix(roomName: string): ScreepsReturnCode;
  deletePath(fromPos: RoomPosition | { pos: RoomPosition }, toPos: RoomPosition | { pos: RoomPosition }, opts?: MoveToOpts): ScreepsReturnCode;
  deltePath(fromPos: RoomPosition | { pos: RoomPosition }, toPos: RoomPosition | { pos: RoomPosition }, opts?: MoveToOpts): ScreepsReturnCode;
  getAvoidRoomsMap(): Record<string, 1>;
  getAvoidExitsMap(): Record<string, Record<string, 1>>;
  addAvoidRooms(roomName: string): ScreepsReturnCode;
  deleteAvoidRooms(roomName: string): ScreepsReturnCode;
  clearAvoidExits(fromRoomName?: string): ScreepsReturnCode;
  getClosestExitPos(fromPos: RoomPosition, toRoomName: string): RoomPosition | null;
  setEnableSquadPath(bool: boolean): ScreepsReturnCode;
  setEnableFlee(bool: boolean): ScreepsReturnCode;
  getConfig(): BetterMoveConfig;
  setConfig(partial: Partial<BetterMoveConfig> & Record<string, unknown>): ScreepsReturnCode;
  getCacheStats(): BetterMoveCacheStats;
  resetCacheStats(): ScreepsReturnCode;
  deletePathInRoom(roomName: string): ScreepsReturnCode;
  addAvoidExits(fromRoomName: string, toRoomName: string): ScreepsReturnCode;
  deleteAvoidExits(fromRoomName: string, toRoomName: string): ScreepsReturnCode;
  syncPortals(): BetterMovePortalRegistry;
  printPortals(targetShard?: string): BetterMovePortalRecord[];
  endTickResolve(userIsWorkTile?: (creep: Creep | PowerCreep, pos: RoomPosition) => boolean): void;
  print(): string;
  clear(options?: {
    clearAvoidRooms?: boolean;
    clearAvoidExits?: boolean;
    clearPortals?: boolean;
    rediscoverObservers?: boolean;
    resetStats?: boolean;
  }): ScreepsReturnCode;
}

interface RoomPosition {
  findSquadPathTo(toPos: RoomPosition, opts?: PathFinderOpts): PathFinderPath | ERR_NO_PATH | ERR_INVALID_TARGET;
}

/**
 * 扩展 NodeJS.Global 接口
 * @description 声明 global.BetterMove 的类型
 */
declare namespace NodeJS {
  interface Global {
    BetterMove?: BetterMoveAPI;
  }
}
