import type {
    BetterMovePath,
    BetterMovePathSearchResult,
    BetterMoveRoomCostMatrixCache,
    BetterMoveTarget,
    CreepPathCacheEntry,
    FormalizedPos,
} from './types';

/**
 * squad 相关逻辑收口模块。
 * @description
 * 这里集中维护：
 * - squad costMatrix / edgeArray 构建
 * - squad move / squadMoveTo 执行流程
 *
 * 当前项目里 squad 逻辑并不常用，把它单独塞到一个文件里，
 * 可以让 `index.ts` 和普通单 creep 移动实现都更干净一些。
 */

/**
 * squad 矩阵构建结果。
 * @description
 * - `squadCostMatrix`：2x2 squad 专用寻路矩阵
 * - `squareMap`：以当前格为右下角时，可形成的最大连续正方形边长
 * - `edgeArray`：单 creep 意图求解复用的邻接表
 */
export interface SquadCostMatrixData {
    squadCostMatrix: CostMatrix;
    squareMap: Uint8Array;
    edgeArray: Uint16Array;
}

export interface SquadMovementHelpers {
    resolveTargetPos: (target: BetterMoveTarget) => RoomPosition;
    showVisual: (
        creep: Creep,
        toPos: RoomPosition,
        posArray: RoomPosition[],
        startIdx: number,
        idxStep: number,
        visualStyle: PolyStyle
    ) => void;
}

export interface SquadMovementDeps {
    formalizeIntentPos: (pos: { x: number; y: number; roomName?: string | null } | null | undefined) => FormalizedPos;
    formalize: (pos: { x: number; y: number; roomName?: string | null } | null | undefined) => FormalizedPos;
    isNear: (pos1: { x: number; y: number; roomName?: string | null }, pos2: { x: number; y: number; roomName?: string | null }) => boolean;
    isEqual: (pos1: { x: number; y: number; roomName?: string | null }, pos2: { x: number; y: number; roomName?: string | null } | undefined) => boolean;
    findSquadTemporalPath: (
        leader: Creep,
        toPos: RoomPosition,
        ops: SquadMoveToOpts,
        key: string,
        severe?: boolean,
        squadNames?: Set<string>
    ) => boolean;
    findSquadPath: (fromPos: RoomPosition, toPos: RoomPosition, ops: SquadMoveToOpts) => BetterMovePathSearchResult;
    isObstacleStructure: (room: Room, pos: RoomPosition, ignoreStructures: boolean) => boolean;
    registerMoveIntent: (creep: Creep, targetFormalPos: { x: number; y: number } | 0, priority?: number) => ScreepsReturnCode;
    registerSquad: (creep1: Creep, creep2: Creep) => void;
    checkSquadTarget: (
        creepPosArray: FormalizedPos[],
        leaderPos: { x: number; y: number; roomName: string },
        leaderNextPos: { x: number; y: number; roomName: string }
    ) => boolean;
    creepPathCache: Record<string, CreepPathCacheEntry | undefined>;
    creepMoveCache: Record<string, number>;
    costMatrixCache: BetterMoveRoomCostMatrixCache;
    rerouteSquad: Set<string>;
    generateCostMatrix: (room: Room, pos?: RoomPosition) => void;
    getSquadCostMatrixForRoom: (roomName: string, ignoreStructures: boolean | undefined) => CostMatrix;
    unWalkableCCost: number;
    tile2Pos: (tile: number) => RoomPosition;
    packIntentTile: (formalPos: { x: number; y: number }) => number;
}

type SquadMemberOffset = { x: number; y: number };
type SquadPathToOpts = MoveToOpts & { memberPos?: SquadMemberOffset[] };
type SquadPathFinderOpts = SquadMoveToOpts & { maxCost?: number; maxOps?: number; heuristicWeight?: number };
type PathFinderOptsWithMaxOps = PathFinderOpts & { maxOps?: number };
type UserCostCallback = ((roomName: string, costMatrix: CostMatrix) => CostMatrix | boolean | void) | undefined;

export interface SquadPathingHelpers {
    resolveTargetPos: (target: BetterMoveTarget | null | undefined) => RoomPosition | null;
    getCachedRoomCostMatrix: (roomName: string, ignoreCondition: boolean | undefined) => CostMatrix;
}

export interface SquadPathingDeps {
    ensureAvoidRoomsUpToDate: () => void;
    withScopedAvoids: <T>(ops: MoveToOpts | SquadMoveToOpts, fn: () => T) => T;
    isRoomAvoided: (roomName: string) => boolean;
    getSquadCostMatrixForRoom: (roomName: string, ignoreCondition?: boolean) => CostMatrix;
    costMatrixCache: BetterMoveRoomCostMatrixCache;
    generateCostMatrix: (room: Room, pos?: RoomPosition) => void;
    unWalkableCCost: number;
    creepToSquad: Map<string, number>;
    rerouteSquad: Set<string>;
    squadDerivedState: {
        tick: number;
        cache: Record<string, CostMatrix>;
    };
    createPathFinderBaseOpts: (ops: MoveToOpts | SquadMoveToOpts) => PathFinderOptsWithMaxOps;
    applyMoveToTerrainCosts: (pathFinderOpts: PathFinderOptsWithMaxOps, ops: MoveToOpts | SquadMoveToOpts) => void;
    creepPathCache: Record<string, CreepPathCacheEntry | undefined>;
    formalize: (pos: { x: number; y: number; roomName?: string | null } | null | undefined) => FormalizedPos;
}

/**
 * 初始化首行 / 首列的 squad 拓扑数据。
 * @param terrain 房间地形缓冲区
 * @param unWalkableCCost 不可通行代价值
 */
function initialMap(terrain: Uint8Array, unWalkableCCost: number) {
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

/**
 * 基于房间地形与普通 costMatrix 生成 squad 专用矩阵。
 * @description
 * 命名虽然沿用旧接口，但这里同时负责生成 `edgeArray`，以保持
 * 旧版单 creep 意图求解的拓扑数据来源不变。
 * @param terrain 房间地形缓冲区
 * @param costMatrix 普通 creep 使用的 costMatrix
 * @param unWalkableCCost 不可通行代价值
 */
export function getSquadCostMatrix(
    terrain: Uint8Array,
    costMatrix: CostMatrix,
    unWalkableCCost: number
): SquadCostMatrixData {
    const { squareMap, squadCostMatrix, edgeArray, edgeIdx } = initialMap(terrain, unWalkableCCost);
    let current;
    let u;
    let v;
    let w;

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

/**
 * 为 squad 房间边缘补充轻度代价，减少 2x2 编队贴边抖动。
 * @param squareMap squad 正方形缓存
 * @param squadCostMatrix 需要写入的 squad costMatrix
 */
export function applySquadRoomEdgeCosts(squareMap: Uint8Array, squadCostMatrix: CostMatrix): void {
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
 * 创建 squad 寻路 helper。
 * @description
 * 这里收口 squad 专用的 PathFinder 回调与派生矩阵逻辑，
 * 让 `pathing.ts` 可以只保留普通 creep 与 observer 主流程。
 */
export function createSquadPathingHelpers(deps: SquadPathingDeps, helpers: SquadPathingHelpers) {
    let squadBypassRoomName = '';
    let squadBypassCostMat: CostMatrix;
    let squadUserCostCallback: UserCostCallback;
    let squadCostMat: CostMatrix;
    let squadFindPathIgnoreCondition: boolean | undefined;

    function createSquadPathFinderOpts(ops: SquadPathFinderOpts, roomCallback: PathFinderOpts['roomCallback']): PathFinderOptsWithMaxOps {
        const pathFinderOpts: PathFinderOptsWithMaxOps = {
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

    function squadTemporalRoomCallback(roomName: string) {
        if (deps.isRoomAvoided(roomName)) {
            return false;
        }
        if (roomName == squadBypassRoomName) {
            squadCostMat = squadBypassCostMat;
        } else {
            squadCostMat = deps.getSquadCostMatrixForRoom(roomName, squadFindPathIgnoreCondition);
        }
        if (squadUserCostCallback) {
            const roomCache = deps.costMatrixCache[roomName];
            const resultCostMat = squadUserCostCallback(roomName, roomCache ? squadCostMat.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                squadCostMat = resultCostMat;
            }
        }
        return squadCostMat;
    }

    function findSquadTemporalPath(leader: Creep, toPos: RoomPosition, ops: SquadMoveToOpts, key: string, severe = false, squadNames: Set<string> = new Set()) {
        squadBypassRoomName = leader.room.name;
        if (!(squadBypassRoomName in deps.costMatrixCache) && squadBypassRoomName in Game.rooms) {
            deps.generateCostMatrix(Game.rooms[squadBypassRoomName], leader.pos);
        }
        squadUserCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;
        squadFindPathIgnoreCondition = !!ops.ignoreDestructibleStructures;
        const nearbyCreeps = leader.pos.findInRange(FIND_CREEPS, 5);
        squadBypassCostMat = deps.getSquadCostMatrixForRoom(squadBypassRoomName, squadFindPathIgnoreCondition).clone();
        if (severe) {
            for (const creep of nearbyCreeps) {
                if (!squadNames.has(creep.name)) {
                    squadBypassCostMat.set(creep.pos.x, creep.pos.y, 10);
                    squadBypassCostMat.set(creep.pos.x + 1, creep.pos.y, squadBypassCostMat.get(creep.pos.x + 1, creep.pos.y) === deps.unWalkableCCost ? deps.unWalkableCCost : 10);
                    squadBypassCostMat.set(creep.pos.x, creep.pos.y + 1, squadBypassCostMat.get(creep.pos.x, creep.pos.y + 1) === deps.unWalkableCCost ? deps.unWalkableCCost : 10);
                    squadBypassCostMat.set(creep.pos.x + 1, creep.pos.y + 1, squadBypassCostMat.get(creep.pos.x + 1, creep.pos.y + 1) === deps.unWalkableCCost ? deps.unWalkableCCost : 10);
                }
            }
        } else {
            for (const creep of nearbyCreeps) {
                if (deps.creepToSquad.has(creep.name) && !deps.rerouteSquad.has(creep.name)) {
                    squadBypassCostMat.set(creep.pos.x, creep.pos.y, deps.unWalkableCCost);
                    squadBypassCostMat.set(creep.pos.x + 1, creep.pos.y, deps.unWalkableCCost);
                    squadBypassCostMat.set(creep.pos.x, creep.pos.y + 1, deps.unWalkableCCost);
                    squadBypassCostMat.set(creep.pos.x + 1, creep.pos.y + 1, squadBypassCostMat.get(creep.pos.x + 1, creep.pos.y + 1) === deps.unWalkableCCost ? deps.unWalkableCCost : 5);
                    leader.room.visual.circle(creep.pos, { radius: 0.5, fill: 'red', opacity: 0.1 });
                }
            }
        }
        const pathFinderOpts = createSquadPathFinderOpts(ops, squadTemporalRoomCallback);
        const creepCache = deps.creepPathCache[key]!;
        const range = typeof ops.range === 'number' ? ops.range : 0;
        const searchResult = deps.withScopedAvoids(ops, () => PathFinder.search(leader.pos, { pos: toPos, range }, pathFinderOpts));
        if (searchResult.incomplete && searchResult.path.length <= 1) {
            return false;
        }
        const result = searchResult.path;
        creepCache.path = {
            end: deps.formalize(result[result.length - 1]),
            posArray: result,
            ignoreStructures: squadFindPathIgnoreCondition
        };
        return true;
    }

    function squadRoomCallback(roomName: string) {
        if (deps.isRoomAvoided(roomName)) {
            return false;
        }
        squadCostMat = deps.getSquadCostMatrixForRoom(roomName, squadFindPathIgnoreCondition);
        if (squadUserCostCallback) {
            const roomCache = deps.costMatrixCache[roomName];
            const resultCostMat = squadUserCostCallback(roomName, roomCache ? squadCostMat.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                squadCostMat = resultCostMat;
            }
        }
        return squadCostMat;
    }

    function findSquadPath(fromPos: RoomPosition, toPos: RoomPosition, ops: SquadMoveToOpts): BetterMovePathSearchResult {
        deps.ensureAvoidRoomsUpToDate();
        if (!(fromPos.roomName in deps.costMatrixCache) && fromPos.roomName in Game.rooms) {
            deps.generateCostMatrix(Game.rooms[fromPos.roomName], fromPos);
        }

        squadFindPathIgnoreCondition = !!ops.ignoreDestructibleStructures;
        squadUserCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;
        const pathFinderOpts = createSquadPathFinderOpts(ops, squadRoomCallback);
        return deps.withScopedAvoids(ops, () => PathFinder.search(fromPos, { pos: toPos, range: ops.range }, pathFinderOpts));
    }

    function getMemberPosSignature(memberPos: SquadMemberOffset[]) {
        if (!memberPos.length) {
            return '';
        }
        return memberPos.map((p) => `${p.x},${p.y}`).sort().join('|');
    }

    function getSquadDerivedMatCacheForThisTick() {
        if (typeof Game == 'undefined') {
            return null;
        }
        if (deps.squadDerivedState.tick !== Game.time) {
            deps.squadDerivedState.tick = Game.time;
            deps.squadDerivedState.cache = Object.create(null);
        }
        return deps.squadDerivedState.cache;
    }

    function findSquadPathTo(this: RoomPosition, toPos: BetterMoveTarget, opts: SquadPathToOpts | undefined) {
        deps.ensureAvoidRoomsUpToDate();
        const targetPos = helpers.resolveTargetPos(toPos);
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

        const roomCallback = (roomName: string) => {
            if (deps.isRoomAvoided(roomName)) {
                return false;
            }
            let base = helpers.getCachedRoomCostMatrix(roomName, ignoreCondition);
            if (userCallback) {
                const resultCostMat = userCallback(roomName, roomName in deps.costMatrixCache ? base.clone() : new PathFinder.CostMatrix);
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
            const derived = new PathFinder.CostMatrix;
            for (let y = 0; y < 50; y++) {
                for (let x = 0; x < 50; x++) {
                    let blocked = false;
                    for (let i = memberPos.length; i--;) {
                        const rel = memberPos[i];
                        const rx = x + rel.x;
                        const ry = y + rel.y;
                        if (rx < 0 || ry < 0 || rx > 49 || ry > 49 || base.get(rx, ry) == deps.unWalkableCCost) {
                            blocked = true;
                            break;
                        }
                    }
                    if (blocked) {
                        derived.set(x, y, deps.unWalkableCCost);
                    } else {
                        const value = base.get(x, y);
                        if (value) {
                            derived.set(x, y, value);
                        }
                    }
                }
            }
            derivedMatCache[cacheKey] = derived;
            return derived;
        };

        const pathFinderOpts = deps.createPathFinderBaseOpts(opts);
        deps.applyMoveToTerrainCosts(pathFinderOpts, opts);
        pathFinderOpts.roomCallback = roomCallback;
        pathFinderOpts.maxOps = opts.maxOps;

        return deps.withScopedAvoids(opts, () => PathFinder.search(this, { pos: targetPos, range }, pathFinderOpts).path);
    }

    return {
        findSquadTemporalPath,
        findSquadPath,
        findSquadPathTo,
    };
}

/**
 * 创建 squad 移动执行 helper。
 * @description
 * 把 `squadMove` / `squadMoveTo` 及其配套推进逻辑从普通移动实现中拆出来，
 * 避免 `movement.ts` 继续被一整块暂时不用的 squad 流程撑大。
 */
export function createSquadMovementHelpers(deps: SquadMovementDeps, helpers: SquadMovementHelpers) {
    function checkSquadRoom(room: Room, path: BetterMovePath, startIdx: number) {
        if (!(room.name in deps.costMatrixCache)) {
            deps.generateCostMatrix(room);
        }
        const thisRoomName = room.name;
        const costMat = deps.getSquadCostMatrixForRoom(thisRoomName, !!path.ignoreStructures);
        const posArray = path.posArray;
        for (let i = startIdx; i + 1 in posArray && posArray[i].roomName == thisRoomName; i++) {
            if (costMat.get(posArray[i].x, posArray[i].y) == deps.unWalkableCCost) {
                return false;
            }
        }
        return true;
    }

    function isSquadNextStepBlocked(leaderNextPos: RoomPosition, ignoreCondition: boolean | undefined) {
        if (!ignoreCondition || !(leaderNextPos.roomName in deps.costMatrixCache)) {
            return false;
        }
        return deps.getSquadCostMatrixForRoom(leaderNextPos.roomName, true).get(leaderNextPos.x, leaderNextPos.y) === deps.unWalkableCCost;
    }

    function squadMove(squad: Creep[], target: BetterMoveTarget[] | undefined = undefined) {
        if (squad.length <= 1 || squad.length > 9 || (target && target.length !== squad.length)) {
            return ERR_INVALID_ARGS;
        }
        if (target) {
            const firstPos = helpers.resolveTargetPos(target[0]);
            const firstFormalPos = deps.formalizeIntentPos(firstPos);
            if (firstPos.x === 0) {
                firstFormalPos.x--;
            } else if (firstPos.x === 49) {
                firstFormalPos.x++;
            } else if (firstPos.y === 0) {
                firstFormalPos.y--;
            } else if (firstPos.y === 49) {
                firstFormalPos.y++;
            }
            deps.registerMoveIntent(squad[0], firstFormalPos);
            for (let i = squad.length; --i;) {
                const pos = helpers.resolveTargetPos(target[i]);
                const formalPos = deps.formalizeIntentPos(pos);
                if (pos.x === 0) {
                    formalPos.x--;
                } else if (pos.x === 49) {
                    formalPos.x++;
                } else if (pos.y === 0) {
                    formalPos.y--;
                } else if (pos.y === 49) {
                    formalPos.y++;
                }
                deps.registerMoveIntent(squad[i], formalPos);
                deps.registerSquad(squad[0], squad[i]);
            }
        } else {
            deps.registerMoveIntent(squad[0], 0);
            for (let i = squad.length; --i;) {
                deps.registerMoveIntent(squad[i], 0);
                deps.registerSquad(squad[0], squad[i]);
            }
        }
    }

    function handleAutoPullForSquad(pathCache: CreepPathCacheEntry | undefined, squad: Creep[], targets: RoomPosition[], someOneTired: boolean) {
        if (!someOneTired) {
            return OK;
        }
        for (let i = 0; i < squad.length; i++) {
            const creep = squad[i];
            if (!creep.fatigue) {
                continue;
            }
            const targetPos = deps.formalizeIntentPos(targets[i]);
            for (let j = 0; j < squad.length; j++) {
                const helper = squad[j];
                const helperPos = deps.formalizeIntentPos(helper.pos);
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

    function squadStepToPos(
        leaderNextPos: RoomPosition,
        squad: Creep[],
        leader: Creep,
        creepPosArray: FormalizedPos[],
        leaderPos: { x: number; y: number; roomName: string },
        someOneTired: boolean,
        pathCache: CreepPathCacheEntry | undefined,
        ignoreCondition: boolean | undefined
    ) {
        const formalPos = deps.formalizeIntentPos(leaderNextPos);
        const targets: RoomPosition[] = [];
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
            targets.push(deps.tile2Pos(deps.packIntentTile({ x: px, y: py })));
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

    function moveOneStepSquad(
        creepCache: CreepPathCacheEntry,
        squad: Creep[],
        leader: Creep,
        creepPosArray: FormalizedPos[],
        leaderPos: { x: number; y: number; roomName: string },
        visualStyle: PolyStyle | undefined,
        toPos: RoomPosition,
        someOneTired: boolean
    ) {
        if (visualStyle) {
            helpers.showVisual(leader, toPos, creepCache.path!.posArray, creepCache.idx, 1, visualStyle);
        }

        const posArray = creepCache.path!.posArray;
        creepCache.idx++;
        const leaderNextPos = posArray[creepCache.idx];
        return squadStepToPos(leaderNextPos, squad, leader, creepPosArray, leaderPos, someOneTired, creepCache, !!creepCache.path!.ignoreStructures);
    }

    function startSquadRoute(
        squad: Creep[],
        leader: Creep,
        creepPosArray: FormalizedPos[],
        leaderPos: { x: number; y: number; roomName: string },
        pathCache: CreepPathCacheEntry,
        visualStyle: PolyStyle | undefined,
        toPos: RoomPosition,
        someOneTired: boolean
    ) {
        const posArray = pathCache.path!.posArray;

        let idx = 0;
        while (idx in posArray && deps.isNear(leader.pos, posArray[idx])) {
            idx += 1;
        }
        idx -= 1;
        pathCache.idx = idx;

        if (visualStyle) {
            helpers.showVisual(leader, toPos, posArray, idx, 1, visualStyle);
        }
        deps.creepMoveCache[leader.name] = Game.time;

        const leaderNextPos = posArray[idx];
        return squadStepToPos(leaderNextPos, squad, leader, creepPosArray, leaderPos, someOneTired, pathCache, !!pathCache.path!.ignoreStructures);
    }

    function squadMoveTo(squad: Creep[], firstArg: number | BetterMoveTarget, secondArg?: number | SquadMoveToOpts, opts?: SquadMoveToOpts) {
        let qx = 0;
        let qy = 0;
        let px;
        let py;
        let leader;
        const creepPosArray: FormalizedPos[] = [];
        let toPos: RoomPosition;
        let moveOpts: SquadMoveToOpts;
        if (squad.length !== 4) {
            return ERR_INVALID_ARGS;
        }
        if (typeof firstArg == 'object') {
            toPos = helpers.resolveTargetPos(firstArg);
            moveOpts = (secondArg && typeof secondArg === 'object') ? secondArg : {};
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
                const pos = deps.formalizeIntentPos(creep.pos);
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
            toPos = new RoomPosition(firstArg, secondArg as number, leader.room.name);
        }
        const ignoreCondition = !!moveOpts.ignoreDestructibleStructures;
        const leaderPos = { x: qx, y: qy, roomName: leader.room.name };
        const rangeToPos = leader.pos.getRangeTo(toPos);
        if (rangeToPos === 0) {
            squadMove(squad);
            return OK;
        } else if (rangeToPos === 1) {
            if (ignoreCondition && toPos.roomName === leader.room.name && !(toPos.roomName in deps.costMatrixCache)) {
                deps.generateCostMatrix(leader.room);
            }
            if (toPos.roomName === leader.room.name && isSquadNextStepBlocked(toPos, ignoreCondition)) {
                squadMove(squad);
                return ignoreCondition ? ERR_FULL : OK;
            }
            return squadStepToPos(toPos, squad, leader, creepPosArray, leaderPos, someOneTired, undefined, ignoreCondition);
        }
        const key = leader.name + '_quad';
        let creepCache = deps.creepPathCache[key];
        if (creepCache) {
            if (deps.isEqual(toPos, creepCache.dst as RoomPosition | undefined)) {
                const path = creepCache.path;
                const idx = creepCache.idx;
                if (path && idx < path.posArray.length - 1 && path.ignoreStructures === ignoreCondition) {
                    const posArray = path.posArray;
                    if (crossRoom) {
                        if (idx + 2 < posArray.length && deps.isNear(leader.pos, posArray[idx + 2])) {
                            creepCache.idx++;
                        } else if (!deps.isNear(leader.pos, posArray[idx + 1])) {
                            creepCache.idx--;
                        }
                        if (leader.room.name in deps.costMatrixCache || checkSquadRoom(leader.room, path, creepCache.idx)) {
                            deps.creepMoveCache[leader.name] = Game.time;
                            return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, moveOpts.visualizePathStyle, toPos, someOneTired);
                        }
                    } else if (deps.isEqual(leader.pos, posArray[idx])) {
                        deps.creepMoveCache[leader.name] = Game.time;
                        return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, moveOpts.visualizePathStyle, toPos, someOneTired);
                    } else if (deps.isNear(leader.pos, posArray[idx])) {
                        if (deps.checkSquadTarget(creepPosArray, leaderPos, posArray[idx])) {
                            if (deps.findSquadTemporalPath(leader, toPos, moveOpts, key)) {
                                leader.say('绕路');
                                for (const creep of squad) {
                                    deps.rerouteSquad.add(creep.name);
                                }
                                return startSquadRoute(squad, leader, creepPosArray, leaderPos, creepCache, moveOpts.visualizePathStyle, toPos, someOneTired);
                            }
                            leader.say('没路了');
                            squadMove(squad);
                            return ERR_NO_PATH;
                        } else if (deps.isObstacleStructure(leader.room, posArray[idx], true)) {
                            leader.say('绕建筑');
                            delete deps.costMatrixCache[leader.pos.roomName];
                        } else if (leader.name in deps.creepMoveCache && deps.creepMoveCache[leader.name] <= Game.time - 4) {
                            if (deps.findSquadTemporalPath(leader, toPos, moveOpts, key, true, new Set(squad.map(c => c.name)))) {
                                leader.say('严重绕路');
                                for (const creep of squad) {
                                    deps.rerouteSquad.add(creep.name);
                                }
                                return startSquadRoute(squad, leader, creepPosArray, leaderPos, creepCache, moveOpts.visualizePathStyle, toPos, someOneTired);
                            }
                            leader.say('没路了');
                            squadMove(squad);
                            return ERR_NO_PATH;
                        } else {
                            leader.say(`${Game.time - deps.creepMoveCache[leader.name]}`);
                            creepCache.idx--;
                            return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, moveOpts.visualizePathStyle, toPos, someOneTired);
                        }
                    } else if (idx - 1 >= 0 && deps.isNear(leader.pos, posArray[idx - 1])) {
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
            deps.creepPathCache[key] = creepCache;
        }

        const squadPathResult = deps.findSquadPath(leader.pos, toPos, moveOpts);
        if (!squadPathResult.path.length || (squadPathResult.incomplete && squadPathResult.path.length == 1)) {
            creepCache.path = undefined;
            squadMove(squad);
            return ERR_NO_PATH;
        }
        const squadPathArray = squadPathResult.path.slice();
        squadPathArray.unshift(leader.pos);
        const newPath: BetterMovePath = {
            end: deps.formalize(squadPathArray[squadPathArray.length - 1]),
            posArray: squadPathArray,
            ignoreStructures: ignoreCondition
        };
        creepCache.path = newPath;
        creepCache.dst = toPos;
        return startSquadRoute(squad, leader, creepPosArray, leaderPos, creepCache, moveOpts.visualizePathStyle, toPos, someOneTired);
    }

    return {
        squadMove,
        squadMoveTo,
    };
}
