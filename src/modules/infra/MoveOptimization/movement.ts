/**
 * BetterMove 移动执行层。
 * @description
 * 收口 `moveTo/move/pull/squadMoveTo/findClosestByPath` 相关主流程，
 * 让 `index.ts` 不再直接承载整块移动执行逻辑。
 *
 * 当前优先保持行为稳定，因此先沿用原有自由函数实现，
 * 通过构造器闭包 + 依赖注入建立模块边界，再逐步收紧类型。
 */
import type {
    BetterMoveConfig,
    BetterMoveParsedShardRoomName,
    BetterMovePath,
    BetterMovePathSearchResult,
    BetterMoveRoomCostMatrixCache,
    BetterMoveSameRoomEdgeCostMatrixCache,
    BetterMoveTarget,
    CreepPathCacheEntry,
    FormalizedPos,
} from './types';

type BetterMoveToMethod = (this: Creep, target: BetterMoveTarget, opts?: MoveToOpts) => ScreepsReturnCode;
type BetterMoveToXYMethod = (this: Creep, x: number, y: number, opts?: MoveToOpts) => ScreepsReturnCode;
type SquadMoveToTargetMethod = (squad: Creep[], target: BetterMoveTarget, opts?: SquadMoveToOpts) => ScreepsReturnCode;
type SquadMoveToXYMethod = (squad: Creep[], x: number, y: number, opts?: SquadMoveToOpts) => ScreepsReturnCode;
type BetterFindClosestByPathOpts = FindPathOpts & Partial<FilterOptions<FIND_STRUCTURES>> & { algorithm?: string };
type BetterFindClosestByPathResult = ReturnType<typeof RoomPosition.prototype.findClosestByPath>;
type SquadTemporalPathFn = (leader: Creep, toPos: RoomPosition, ops: SquadMoveToOpts, key: string, severe?: boolean, squadNames?: Set<string>) => boolean;

export interface MovementModuleApi {
    betterMoveTo: BetterMoveToMethod & BetterMoveToXYMethod;
    betterMove: (this: Creep, target: DirectionConstant | Creep | PowerCreep) => ScreepsReturnCode;
    betterPull: (this: Creep, target: Creep) => ScreepsReturnCode;
    squadMove: (squad: Creep[], target?: BetterMoveTarget[]) => ScreepsReturnCode;
    squadMoveTo: SquadMoveToTargetMethod & SquadMoveToXYMethod;
    betterFindClosestByPath: (this: RoomPosition, type: FindConstant, opts?: BetterFindClosestByPathOpts) => BetterFindClosestByPathResult;
}

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

type MovementDeps = {
    config: BetterMoveConfig;
    powerCreepProto?: (typeof PowerCreep.prototype & {
        $move?: typeof PowerCreep.prototype.move;
        $moveTo?: typeof PowerCreep.prototype.moveTo;
    }) | undefined;
    originMoveTo: typeof Creep.prototype.moveTo;
    originMove: typeof Creep.prototype.move;
    originPull: typeof Creep.prototype.pull;
    originFindClosestByPath: typeof RoomPosition.prototype.findClosestByPath;
    getPowerCreepMoveToMethod: () => typeof PowerCreep.prototype.moveTo | undefined;
    getPowerCreepMoveMethod: () => typeof PowerCreep.prototype.move | undefined;
    parseShardRoomName: (roomName: string | null | undefined) => BetterMoveParsedShardRoomName;
    scanPortals: (force: boolean) => void;
    pickPortalToShard: (fromRoomName: string, targetShard: string, targetRoomName: string | null | undefined) => { x: number; y: number; roomName: string } | null | undefined;
    registerRoomBounceGuard: (creep: Creep, targetRoomName: string) => void;
    applySameRoomDetourCooldown: (creep: Creep, toPos: RoomPosition, ops: MoveToOpts) => void;
    validateMoveToArgTypes: (ops: MoveToOpts | object | null | undefined) => ops is MoveToOpts;
    getScopedAvoidSignature: (ops: MoveToOpts) => string;
    formalizeIntentPos: (pos: { x: number; y: number; roomName?: string | null } | null | undefined) => FormalizedPos;
    formalizeIntentMovePos: (pos: { x: number; y: number; roomName?: string | null } | null | undefined) => FormalizedPos;
    hasActiveBodypart: (body: BodyPartDefinition[] | undefined | null, type: BodyPartConstant) => boolean;
    getPositiveConfigNumber: (value: number | null | undefined, fallback: number) => number;
    formalize: (pos: { x: number; y: number; roomName?: string | null } | null | undefined) => FormalizedPos;
    inRange: (pos1: { x: number; y: number; roomName?: string | null }, pos2: { x: number; y: number; roomName?: string | null }, range: number) => boolean;
    isEqual: (pos1: { x: number; y: number; roomName?: string | null }, pos2: { x: number; y: number; roomName?: string | null }) => boolean;
    isNear: (pos1: { x: number; y: number; roomName?: string | null }, pos2: { x: number; y: number; roomName?: string | null }) => boolean;
    isCpuStatsEnabled: () => boolean;
    runtimeMetrics: RuntimeMetrics;
    checkRoom: (room: Room | { name: string }, path: BetterMovePath, startIdx: number) => boolean;
    deletePath: (path: BetterMovePath) => void;
    clearUnused: () => void;
    findPath: (fromPos: RoomPosition, toPos: RoomPosition, ops: MoveToOpts) => BetterMovePathSearchResult;
    findTemporalPath: (creep: Creep, toPos: RoomPosition, ops: MoveToOpts) => boolean;
    findShortPathInCache: (
        fromFormalPos: FormalizedPos,
        toFormalPos: FormalizedPos,
        fromPos: RoomPosition,
        toRoomName: string,
        creepCache: CreepPathCacheEntry,
        ops: MoveToOpts
    ) => boolean;
    findLongPathInCache: (
        fromFormalPos: FormalizedPos,
        toFormalPos: FormalizedPos,
        toRoomName: string,
        creepCache: CreepPathCacheEntry,
        ops: MoveToOpts
    ) => boolean;
    findSquadTemporalPath: SquadTemporalPathFn;
    findSquadPath: (fromPos: RoomPosition, toPos: RoomPosition, ops: SquadMoveToOpts) => BetterMovePathSearchResult;
    setPathTimer: (path: CreepPathCacheEntry) => void;
    ensurePathVersion: (path: BetterMovePath) => number;
    generateDirectionArray: (path: BetterMovePath) => void;
    addPathIntoCache: (newPath: BetterMovePath) => void;
    isObstacleStructure: (room: Room, pos: RoomPosition, ignoreStructures: boolean) => boolean;
    registerMoveIntent: (creep: Creep, targetFormalPos: { x: number; y: number } | 0, priority?: number) => ScreepsReturnCode;
    registerSquad: (creep1: Creep, creep2: Creep) => void;
    checkSquadTarget: (
        creepPosArray: RoomPosition[],
        leaderPos: { x: number; y: number; roomName: string },
        leaderNextPos: { x: number; y: number; roomName: string }
    ) => boolean;
    creepPathCache: Record<string, CreepPathCacheEntry | undefined>;
    creepMoveCache: Record<string, number>;
    costMatrixCache: BetterMoveRoomCostMatrixCache;
    costMatrixRevision: Record<string, number>;
    sameRoomEdgeCostMatCache: BetterMoveSameRoomEdgeCostMatrixCache;
    rerouteSquad: Set<string>;
    tempArray: RoomPosition[];
    defaultVisualizePathStyle: PolyStyle;
    generateCostMatrix: (room: Room, pos?: RoomPosition) => void;
    getSquadCostMatrixForRoom: (roomName: string, ignoreStructures: boolean | undefined) => CostMatrix;
    unWalkableCCost: number;
    tile2Pos: (tile: number) => RoomPosition;
    packIntentTile: (formalPos: { x: number; y: number }) => number;
    getStartCacheSearch: () => number;
    getStartTime: () => number;
};

export class MovementService {
    declare betterMoveTo: MovementModuleApi['betterMoveTo'];
    declare betterMove: MovementModuleApi['betterMove'];
    declare betterPull: MovementModuleApi['betterPull'];
    declare squadMove: MovementModuleApi['squadMove'];
    declare squadMoveTo: MovementModuleApi['squadMoveTo'];
    declare betterFindClosestByPath: MovementModuleApi['betterFindClosestByPath'];

    constructor(deps: MovementDeps) {
        let autoClearTick = Game.time;
        let findPathIgnoreCondition: boolean | undefined;

        const {
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
        } = deps;

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
        let t = Game.cpu.getUsed() - deps.getStartTime();
        if (t > 0.2) {
            runtimeMetrics.normalLogicalCost += t - 0.2;
        } else {
            runtimeMetrics.normalLogicalCost += t;
        }
    }
    const pos = creepCache.path.posArray[creepCache.idx];
    return registerMoveIntent(creep, formalizeIntentMovePos(pos), ops.priority);
}

function lookCreepAt(room, pos) {
    return room.lookForAt(LOOK_CREEPS, pos).concat(room.lookForAt(LOOK_POWER_CREEPS, pos));
}

function tryStartTemporalBypass(creep, toPos, ops, creepCache, bypassHostilesOnly) {
    const bypassOps = Object.assign({}, ops, {
        ignoreCreeps: true,
        bypassHostileCreeps: bypassHostilesOnly,
    });
    if (!findTemporalPath(creep, toPos, bypassOps)) {
        return null;
    }
    if (isCpuStatsEnabled()) runtimeMetrics.testBypass++;
    return startRoute(creep, creepCache, ops, toPos);
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

function startRoute(creep, pathCache, ops, toPos, ignoreCreeps = undefined) {
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
 * @param {IArguments | ArrayLike<object | string | number | boolean | null | undefined>} args
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
                if (pathCache) {
                    pathCache.idx--;
                }
                squadMove(squad);
                return ERR_TIRED;
            }
            helper.pull(creep);
            break;
        }
    }
    return OK;
}

function squadStepToPos(leaderNextPos, squad, leader, creepPosArray, leaderPos, someOneTired, pathCache, ignoreCondition) {
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
        } else if (xdiff === -1 && ((leader.pos.x === 1 && formalPos.x < leaderPos.x) || (leader.pos.x === 49 && formalPos.x > leaderPos.x))) {
            squadMove(squad);
            return OK;
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
        } else if (ydiff === -1 && ((leader.pos.y === 1 && formalPos.y < leaderPos.y) || (leader.pos.y === 49 && formalPos.y > leaderPos.y))) {
            squadMove(squad);
            return OK;
        }

        const px = formalPos.x + xdiff;
        const py = formalPos.y + ydiff;
        targets.push(tile2Pos(packIntentTile({ x: px, y: py })));
    }
    if (isSquadNextStepBlocked(leaderNextPos, ignoreCondition)) {
        if (pathCache) {
            pathCache.idx--;
        }
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

function moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, visualStyle, toPos, someOneTired) {
    if (visualStyle) {
        showVisual(leader, toPos, creepCache.path.posArray, creepCache.idx, 1, visualStyle);
    }

    const posArray = creepCache.path.posArray;
    creepCache.idx++;
    const leaderNextPos = posArray[creepCache.idx];
    return squadStepToPos(leaderNextPos, squad, leader, creepPosArray, leaderPos, someOneTired, creepCache, !!creepCache.path.ignoreStructures);
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
    return squadStepToPos(leaderNextPos, squad, leader, creepPosArray, leaderPos, someOneTired, pathCache, !!pathCache.path.ignoreStructures);
}

function resolveMoveToArgs(creep, firstArg, secondArg, opts) {
    if (typeof firstArg == 'object') {
        return {
            toPos: ('pos' in firstArg) ? firstArg.pos : firstArg,
            ops: secondArg || {}
        };
    }
    return {
        toPos: { x: firstArg, y: secondArg, roomName: creep.room.name },
        ops: opts || {}
    };
}

function resolveTargetPos(target: BetterMoveTarget): RoomPosition {
    return 'pos' in target ? target.pos : target;
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

        const pathResult = findPath(creep.pos, toPos, ops);
        if (!pathResult.path.length || (pathResult.incomplete && pathResult.path.length == 1)) {     // 一步也动不了了
            //creep.say('no path')
            return ERR_NO_PATH;
        }
        const pathArray = pathResult.path.slice();
        pathArray.unshift(creep.pos);

        //creep.say('start new');
        let newPath = {
            start: formalize(pathArray[0]),
            end: formalize(pathArray[pathArray.length - 1]),
            posArray: pathArray,
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
        found ? runtimeMetrics.cacheHitCost += Game.cpu.getUsed() - deps.getStartCacheSearch() : runtimeMetrics.cacheMissCost += Game.cpu.getUsed() - deps.getStartCacheSearch();
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
        const blockedTicks = Game.time - creepMoveCache[creep.name];
        const blockingCreep = lookCreepAt(creep.room, curStep)[0];
        if (blockingCreep) {
            if (!blockingCreep.my) {
                if (blockedTicks >= 2 && ops.bypassHostileCreeps) {
                    const bypassResult = tryStartTemporalBypass(creep, toPos, ops, creepCache, true);
                    if (bypassResult !== null) {
                        return bypassResult;
                    }
                }
            } else if (blockedTicks >= 5) {
                const bypassResult = tryStartTemporalBypass(creep, toPos, ops, creepCache, false);
                if (bypassResult !== null) {
                    return bypassResult;
                }
                creepMoveCache[creep.name] = Game.time;
            }
            if (ops.visualizePathStyle) {
                showVisual(creep, toPos, posArray, idx, 1, ops.visualizePathStyle);
            }
            return registerMoveIntent(creep, formalizeIntentMovePos(curStep), ops.priority);
        }
        if (blockedTicks >= 5) {
            if (isObstacleStructure(creep.room, curStep, ops.ignoreDestructibleStructures)) {
                delete costMatrixCache[creep.pos.roomName];
                delete costMatrixRevision[creep.pos.roomName];
                delete sameRoomEdgeCostMatCache[creep.pos.roomName];
                deletePath(path);
                return null;
            }
            const bypassResult = tryStartTemporalBypass(creep, toPos, ops, creepCache, !!ops.bypassHostileCreeps);
            if (bypassResult !== null) {
                return bypassResult;
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
function betterMoveTo(this: Creep, firstArg: number | BetterMoveTarget, secondArg?: number | MoveToOpts, opts?: MoveToOpts) {
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
            let t = Game.cpu.getUsed() - deps.getStartTime();
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
function betterMove(this: Creep, target: DirectionConstant | Creep | PowerCreep) {
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

function squadMove(squad: Creep[], target: BetterMoveTarget[] | undefined = undefined) {
    if (squad.length <= 1 || squad.length > 9 || (target && target.length !== squad.length)) {
        return ERR_INVALID_ARGS;
    }
    if (target) {
        const firstPos = resolveTargetPos(target[0]);
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
            const pos = resolveTargetPos(target[i]);
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

function squadMoveTo(squad: Creep[], firstArg: number | BetterMoveTarget, secondArg?: number | SquadMoveToOpts, opts?: SquadMoveToOpts) {
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
        toPos = resolveTargetPos(firstArg);
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
    findPathIgnoreCondition = !!moveOpts.ignoreDestructibleStructures;
    const leaderPos = { x: qx, y: qy, roomName: leader.room.name };
    const rangeToPos = leader.pos.getRangeTo(toPos);
    if (rangeToPos === 0) {
        squadMove(squad);
        return OK;
    } else if (rangeToPos === 1) {
        if (findPathIgnoreCondition && toPos.roomName === leader.room.name && !(toPos.roomName in costMatrixCache)) {
            generateCostMatrix(leader.room);
        }
        if (toPos.roomName === leader.room.name && isSquadNextStepBlocked(toPos, findPathIgnoreCondition)) {
            squadMove(squad);
            return findPathIgnoreCondition ? ERR_FULL : OK;
        }
        return squadStepToPos(toPos, squad, leader, creepPosArray, leaderPos, someOneTired, undefined, findPathIgnoreCondition);
    }
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
                    } else if (!isNear(leader.pos, posArray[idx + 1])) {
                        creepCache.idx--;
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
                } else if (idx - 1 >= 0 && isNear(leader.pos, posArray[idx - 1])) {
                    creepCache.idx = Math.max(0, creepCache.idx - 2);
                    return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, moveOpts.visualizePathStyle, toPos, someOneTired);
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

    const squadPathResult = findSquadPath(leader.pos, toPos, moveOpts);
    if (!squadPathResult.path.length || (squadPathResult.incomplete && squadPathResult.path.length == 1)) {
        creepCache.path = undefined;
        squadMove(squad);
        return ERR_NO_PATH;
    }
    const squadPathArray = squadPathResult.path.slice();
    squadPathArray.unshift(leader.pos);
    let newPath = {
        end: formalize(squadPathArray[squadPathArray.length - 1]),
        posArray: squadPathArray,
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
function betterFindClosestByPath(this: RoomPosition, type: FindConstant, opts?: BetterFindClosestByPathOpts): BetterFindClosestByPathResult {
    if (!opts) {
        opts = {};
    }
    if (opts.ignoreCreeps === undefined) {
        opts = Object.assign({ ignoreCreeps: true }, opts);
    }
    return originFindClosestByPath.call(this, type, opts);
}


        Object.assign(this, {
            betterMoveTo,
            betterMove,
            betterPull,
            squadMove,
            squadMoveTo,
            betterFindClosestByPath,
        });
    }
}
