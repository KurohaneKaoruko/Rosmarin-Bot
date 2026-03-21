import moveMatch, {
    type MoveMatchCheckNewSource,
    type MoveMatchEntry,
    type MoveMatchResultEntry,
    type MoveMatchSingleEntry,
    type MoveMatchStartList,
    type MoveMatchTargetScore,
} from '@/modules/infra/MoveOptimization/moveMatch';
import {
    formalizeIntentMovePos,
    formalizeIntentPos,
    getDirection,
    packIntentTile,
    tile2Pos,
} from './geometry';
import { createMoveIntentLifecycle } from './lifecycle';

type MoveableCreep = Creep | PowerCreep;
type WorkTileChecker = (creep: MoveableCreep, pos: RoomPosition) => boolean;
type IntentTile = number;
type MoveIntentEntry = MoveMatchEntry;
type MoveIntentList = MoveMatchStartList;
type MoveIntentResultEntry = MoveMatchResultEntry;
type SingleMoveIntentEntry = MoveMatchSingleEntry;
type TileIntentChecker = MoveMatchCheckNewSource;
type SingleMoveResultEntry = Extract<MoveIntentResultEntry, { start: string }>;
type SquadMoveResultEntry = Extract<MoveIntentResultEntry, { start: number }>;

function isSingleMoveResult(entry: MoveIntentResultEntry): entry is SingleMoveResultEntry {
    return typeof entry.start === 'string';
}

function isSquadMoveResult(entry: MoveIntentResultEntry): entry is SquadMoveResultEntry {
    return typeof entry.start === 'number';
}

function getTerrainBuffer(room: Room, getRoomTerrainBuffer: (roomName: string) => Uint8Array | undefined): Uint8Array {
    return getRoomTerrainBuffer(room.name) || (room.getTerrain() as RoomTerrain & { getRawBuffer(): Uint8Array }).getRawBuffer();
}

function getOwnedUnit(name: string): MoveableCreep | undefined {
    return Game.creeps[name] || Game.powerCreeps[name];
}

/**
 * 统一封装移动意图登记与 tick 末解算。
 * @description
 * 这个模块只处理“谁想去哪、如何解冲突、最后下发 move 指令”，
 * 不关心跨房寻路、observer 补视野、costMatrix 构建等路径规划细节。
 */
export function createIntentSolverModule(deps) {
    const {
        getOriginCancelOrderMethod,
        getOriginMoveMethod,
        hasActiveBodypart,
        powerCreepProto,
        isCpuStatsEnabled,
        analyzeCPU,
        ensureMyCreepIndex,
        getMyCreepIndex,
        getMyPowerCreepIndex,
        getRoomTerrainBuffer,
        costMatrixCache,
        generateCostMatrix,
        unWalkableCCost,
    } = deps;

    const activeMoveScore = 32;
    const ultraMoveScore = activeMoveScore << 2;
    const passiveMoveScore = -4;
    const badMoveScore = -32;
    const IntentTiles = new Uint32Array(Math.max(Object.keys(Game.rooms).length * 64, 4096));
    const Priorities = new Uint8Array(IntentTiles.length);
    const cachedMoveIntents = new Map<string, number>();
    const creepToSquad = new Map<string, number>();
    const squadToCreeps = new Map<number, string[]>();
    const squadNextTile = new Set<number>();
    const rerouteSquad = new Set<string>();
    const checkedTiles = new Map<number, string>();
    let squadIdx = 1;
    let creepIdx = 1;

    function registerMoveIntent(creep, targetFormalPos, priority) {
        const checkedFormalPos = formalizeIntentPos(creep.pos);
        if (typeof checkedFormalPos.x !== 'number' || typeof checkedFormalPos.y !== 'number') {
            return ERR_INVALID_ARGS;
        }
        checkedTiles.set(packIntentTile(checkedFormalPos), creep.name);
        const curFormalPos = formalizeIntentMovePos(creep.pos);
        if (typeof curFormalPos.x !== 'number' || typeof curFormalPos.y !== 'number') {
            return ERR_INVALID_ARGS;
        }
        let targetTile = 0;
        if (targetFormalPos !== 0) {
            if (typeof targetFormalPos.x !== 'number' || typeof targetFormalPos.y !== 'number') {
                return ERR_INVALID_ARGS;
            }
            targetTile = packIntentTile(targetFormalPos);
        }
        const finalPriority = priority || 0;
        cachedMoveIntents.set(creep.name, creepIdx);
        Priorities[creepIdx] = finalPriority;
        IntentTiles[creepIdx++] = targetTile;
        IntentTiles[creepIdx++] = packIntentTile(curFormalPos);
        return OK;
    }

    function registerSquad(creep1, creep2) {
        const squad1 = creepToSquad.get(creep1.name);
        const squad2 = creepToSquad.get(creep2.name);
        if (squad1) {
            if (squad2) {
                if (squad1 !== squad2) {
                    const squad1List = squadToCreeps.get(squad1);
                    for (const creepName of squadToCreeps.get(squad2)) {
                        creepToSquad.set(creepName, squad1);
                        squad1List.push(creepName);
                    }
                    squadToCreeps.delete(squad2);
                }
            } else {
                creepToSquad.set(creep2.name, squad1);
                squadToCreeps.get(squad1).push(creep2.name);
            }
        } else if (squad2) {
            creepToSquad.set(creep1.name, squad2);
            squadToCreeps.get(squad2).push(creep1.name);
        } else {
            const squadName = squadIdx++;
            creepToSquad.set(creep1.name, squadName);
            creepToSquad.set(creep2.name, squadName);
            squadToCreeps.set(squadName, [creep1.name, creep2.name]);
        }
    }

    function checkSquadTarget(creepPosArray, leaderPos, leaderNextPos) {
        const formalPos = formalizeIntentPos(leaderNextPos);
        for (const pos of creepPosArray) {
            const x = formalPos.x + pos.x - leaderPos.x;
            const y = formalPos.y + pos.y - leaderPos.y;
            const tile = packIntentTile({ x, y });
            const creepName = checkedTiles.get(tile);
            if (creepName && creepToSquad.has(creepName) && !rerouteSquad.has(creepName)) {
                return true;
            }
        }
        return false;
    }

    function wrapCheckTile(checkTileFunc: (posList: RoomPosition[]) => SingleMoveIntentEntry[]) {
        return (tileList: IntentTile[]) => {
            const posList: RoomPosition[] = [];
            for (let i = 0; i < tileList.length; i++) {
                posList.push(tile2Pos(tileList[i]));
            }
            return checkTileFunc(posList);
        };
    }

    const defaultIsWorkTile: WorkTileChecker = () => true;
    let isWorkTile: WorkTileChecker = defaultIsWorkTile;

    /**
     * 默认瓦片检查器：把已占位 creep 的潜在让步目标转换成 moveMatch 可消费的候选列表。
     */
    function defaultCheckTile(tileList: IntentTile[]): SingleMoveIntentEntry[] {
        const moveIntents: SingleMoveIntentEntry[] = [];
        ensureMyCreepIndex();
        const myCreepIndex = getMyCreepIndex();
        const myPowerCreepIndex = getMyPowerCreepIndex();
        for (let i = 0; i < tileList.length; i++) {
            const tile = tileList[i];
            if (checkedTiles.has(tile)) {
                continue;
            }
            const creepName = myCreepIndex.get(tile);
            if (!creepName) {
                const powerName = myPowerCreepIndex.get(tile);
                if (!powerName) {
                    checkedTiles.set(tile, '');
                    continue;
                }
                const powerCreep = Game.powerCreeps[powerName];
                if (!powerCreep) {
                    checkedTiles.set(tile, '');
                    continue;
                }
                // PowerCreep 不参与 BetterMove 对穿博弈，只作为不可让步占位点。
                checkedTiles.set(tile, powerCreep.name);
                moveIntents.push({
                    start: powerCreep.name,
                    isSuper: false,
                    targetList: [{ target: tile, score: ultraMoveScore }],
                });
                continue;
            }
            const creep = Game.creeps[creepName];
            if (!creep) {
                checkedTiles.set(tile, '');
                continue;
            }
            checkedTiles.set(tile, creep.name);
            const intent: MoveMatchTargetScore[] = [];
            const px = creep.pos.x;
            const py = creep.pos.y;
            if (creep.fatigue || !hasActiveBodypart(creep.body, MOVE)) {
                intent.push({
                    target: tile,
                    score: activeMoveScore,
                });
            } else {
                intent.push({
                    target: tile,
                    score: 0,
                });
                const room = creep.room;
                const roomName = room.name;
                if (!(roomName in costMatrixCache)) {
                    generateCostMatrix(room);
                }
                const roomCache = costMatrixCache[roomName];
                const CostMatrix = roomCache.false;
                const edgeArray = roomCache.edgeArray;
                const terrain = getTerrainBuffer(room, getRoomTerrainBuffer);
                const startIdx = (py * 50 + px) << 3;
                for (let idx = startIdx; idx < startIdx + 8; idx++) {
                    const v = edgeArray[idx];
                    if (v === 0) {
                        break;
                    }
                    const vx = v % 50;
                    const vy = v / 50 | 0;
                    const cost = CostMatrix.get(vx, vy);
                    if (cost === unWalkableCCost) {
                        continue;
                    }
                    const pos = new RoomPosition(vx, vy, roomName);
                    let score = passiveMoveScore;
                    if (terrain[v] === TERRAIN_MASK_SWAMP && cost !== 1) {
                        score += passiveMoveScore << 2;
                    }
                    if (!isWorkTile(creep, pos)) {
                        score += badMoveScore;
                    }
                    const formalPos = formalizeIntentPos(pos);
                    intent.push({
                        target: packIntentTile(formalPos),
                        score,
                    });
                }
            }

            moveIntents.push({
                start: creep.name,
                isSuper: false,
                targetList: intent,
            });
        }
        return moveIntents;
    }

    let checkTile: TileIntentChecker = defaultCheckTile;
    const { resetMoveIntentState, preTickBetterMove } = createMoveIntentLifecycle({
        cachedMoveIntents,
        creepToSquad,
        squadToCreeps,
        squadNextTile,
        rerouteSquad,
        checkedTiles,
        setCreepIdx(value) {
            creepIdx = value;
        },
        setSquadIdx(value) {
            squadIdx = value;
        },
    });

    function betterCancelOrder(methodName) {
        if (methodName === 'move' || methodName === 'moveTo') {
            cachedMoveIntents.delete(this.name);
            const formalCreepPos = formalizeIntentPos(this.pos);
            if (typeof formalCreepPos.x === 'number' && typeof formalCreepPos.y === 'number') {
                checkedTiles.delete(packIntentTile(formalCreepPos));
            }
        }
        return getOriginCancelOrderMethod(this).call(this, methodName);
    }

    function endTickResolve(userIsWorkTile) {
        const resolveStartTime = Game.cpu.getUsed();
        if (userIsWorkTile && typeof userIsWorkTile === 'function') {
            isWorkTile = userIsWorkTile;
        } else {
            isWorkTile = defaultIsWorkTile;
        }

        const moveIntents: MoveIntentList = [];
        const creepAtSquadTarget = [];

        let noMove = false;
        for (const [curSquadIdx, creepList] of squadToCreeps) {
            const targetTiles = [];
            const curTiles = [];
            const validCreeps = [];
            noMove = false;
            for (const creepName of creepList) {
                const idx = cachedMoveIntents.get(creepName);
                if (idx !== undefined) {
                    const tile = IntentTiles[idx];
                    targetTiles.push(tile);
                    curTiles.push(IntentTiles[idx + 1]);
                    cachedMoveIntents.set(creepName, 0);
                    validCreeps.push(creepName);
                    if (tile === 0) {
                        noMove = true;
                    } else {
                        const singleCreepName = checkedTiles.get(tile);
                        if (singleCreepName && !creepToSquad.has(singleCreepName)) {
                            creepAtSquadTarget.push(singleCreepName);
                        }
                    }
                }
            }
            if (targetTiles.length) {
                squadToCreeps.set(curSquadIdx, validCreeps);
                if (noMove) {
                    moveIntents.push({
                        start: curSquadIdx,
                        isSuper: true,
                        targetList: [{ target: curTiles, score: ultraMoveScore }],
                    });
                } else {
                    moveIntents.push({
                        start: curSquadIdx,
                        isSuper: true,
                        targetList: [
                            { target: targetTiles, score: ultraMoveScore },
                            { target: curTiles, score: 0 },
                        ],
                    });
                }
            }
        }

        const nameToIntentIdx = new Map<string, number>();
        for (const [creepName, idx] of cachedMoveIntents) {
            if (idx) {
                const curTile = IntentTiles[idx + 1];
                const targetTile = IntentTiles[idx];
                const targetList: MoveMatchTargetScore[] = targetTile === curTile
                    ? [{ target: targetTile, score: activeMoveScore << Priorities[idx] }]
                    : [
                        { target: targetTile, score: activeMoveScore << Priorities[idx] },
                        { target: curTile, score: 0 },
                    ];
                nameToIntentIdx.set(creepName, moveIntents.length);
                moveIntents.push({
                    start: creepName,
                    isSuper: false,
                    targetList,
                });
            }
        }

        let bfsIdx = 0;
        while (bfsIdx < creepAtSquadTarget.length) {
            const creepName = creepAtSquadTarget[bfsIdx++];
            const intentIdx = nameToIntentIdx.get(creepName);
            if (intentIdx === undefined) continue;
            const targetList = (moveIntents[intentIdx] as SingleMoveIntentEntry).targetList;
            if (targetList.length !== 2) {
                continue;
            }

            const targetTile = targetList[0].target;
            const curTile = targetList[1].target;

            let score;
            const tx = (targetTile & 0x3fff) % 50;
            const ty = (targetTile >> 14) % 50;
            const creep = getOwnedUnit(creepName);
            if (!creep) {
                continue;
            }
            const roomName = creep.room.name;
            const terrain = getTerrainBuffer(creep.room, getRoomTerrainBuffer);
            const roomCache = costMatrixCache[roomName];
            const CostMatrix = roomCache.false;
            const edgeArray = roomCache.edgeArray;
            const startIdx = (creep.pos.y * 50 + creep.pos.x) << 3;
            for (let idx = startIdx; idx < startIdx + 8; idx++) {
                const v = edgeArray[idx];
                if (v === 0) {
                    break;
                }
                const vx = v % 50;
                const vy = v / 50 | 0;
                if (vx === tx && vy === ty) {
                    continue;
                }
                const cost = CostMatrix.get(vx, vy);
                if (cost === unWalkableCCost) {
                    continue;
                }
                if (vx - tx <= 1 && tx - vx <= 1 && vy - ty <= 1 && ty - vy <= 1) {
                    score = passiveMoveScore;
                } else {
                    score = badMoveScore;
                }
                if (terrain[v] === TERRAIN_MASK_SWAMP && cost !== 1) {
                    score += passiveMoveScore << 2;
                }
                const vFormal = formalizeIntentPos(new RoomPosition(vx, vy, roomName));
                const target = packIntentTile(vFormal);
                targetList.push({
                    target,
                    score,
                });
                const singleCreepName = checkedTiles.get(target);
                if (singleCreepName && !creepToSquad.has(singleCreepName)) {
                    creepAtSquadTarget.push(singleCreepName);
                }
            }
            const singleCreepName = checkedTiles.get(targetTile);
            if (singleCreepName && !creepToSquad.has(singleCreepName)) {
                creepAtSquadTarget.push(singleCreepName);
            }
            checkedTiles.set(curTile, '');
        }

        if (!moveIntents.length) {
            resetMoveIntentState();
            isWorkTile = defaultIsWorkTile;
            return;
        }

        const result: MoveIntentResultEntry[] = moveMatch(moveIntents, checkTile);

        const allCreeps = Game.creeps;
        const allPowerCreeps = Game.powerCreeps;
        let moveCount = 0;
        for (const match of result) {
            if (isSingleMoveResult(match)) {
                const startIdx = cachedMoveIntents.get(match.start);
                if (!startIdx) {
                    const creep = getOwnedUnit(match.start);
                    if (!creep) continue;
                    if (powerCreepProto && creep instanceof PowerCreep) continue;
                    const creepPos = creep.pos;
                    const pos = tile2Pos(match.target);
                    if (pos.x !== creepPos.x || pos.y !== creepPos.y) {
                        getOriginMoveMethod(creep).call(creep, getDirection(creepPos, pos));
                        moveCount++;
                    }
                } else if (match.target !== IntentTiles[startIdx + 1]) {
                    const creep = getOwnedUnit(match.start);
                    if (!creep) continue;
                    if (powerCreepProto && creep instanceof PowerCreep) continue;
                    const creepPos = creep.pos;
                    const pos = tile2Pos(match.target);
                    if (pos.x !== creepPos.x || pos.y !== creepPos.y) {
                        getOriginMoveMethod(creep).call(creep, getDirection(creepPos, pos));
                        moveCount++;
                    }
                }
            } else if (isSquadMoveResult(match)) {
                const squad = squadToCreeps.get(match.start);
                for (let i = squad.length; i--;) {
                    const creep = getOwnedUnit(squad[i]);
                    if (!creep) continue;
                    if (powerCreepProto && creep instanceof PowerCreep) continue;
                    const creepPos = creep.pos;
                    const pos = tile2Pos(match.target[i]);
                    if (pos.x !== creepPos.x || pos.y !== creepPos.y) {
                        getOriginMoveMethod(creep).call(creep, getDirection(creepPos, pos));
                        moveCount++;
                    }
                }
            }
        }

        resetMoveIntentState();
        isWorkTile = defaultIsWorkTile;

        if (isCpuStatsEnabled()) {
            analyzeCPU.endTickResolve.calls++;
            analyzeCPU.endTickResolve.moveCount += moveCount;
            analyzeCPU.endTickResolve.sum += Game.cpu.getUsed() - resolveStartTime - moveCount * 0.2;
        }
    }

    return {
        registerMoveIntent,
        registerSquad,
        checkSquadTarget,
        betterCancelOrder,
        setCheckTile(userCheckTile) {
            if (userCheckTile === undefined) {
                checkTile = defaultCheckTile;
                return OK;
            }
            if (typeof userCheckTile !== 'function') {
                return ERR_INVALID_ARGS;
            }
            checkTile = wrapCheckTile(userCheckTile);
            return OK;
        },
        preTickBetterMove,
        resetMoveIntentState,
        endTickResolve,
        markSquadRerouted(name) {
            rerouteSquad.add(name);
        },
        isSquadRerouted(name) {
            return rerouteSquad.has(name);
        },
        getCheckedTiles() {
            return checkedTiles;
        },
        getResolveStats() {
            return analyzeCPU.endTickResolve;
        },
        resetResolveStats() {
            analyzeCPU.endTickResolve = { sum: 0, calls: 0, moveCount: 0 };
        },
        getDefaultIsWorkTile() {
            return defaultIsWorkTile;
        },
        getCheckTile() {
            return checkTile;
        },
    };
}
