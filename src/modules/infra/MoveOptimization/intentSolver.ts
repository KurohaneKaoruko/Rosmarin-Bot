// @ts-nocheck

import moveMatch from '@/modules/utils/moveMatch';
import {
    formalizeIntentMovePos,
    formalizeIntentPos,
    getDirection,
    packIntentTile,
    tile2Pos,
} from './geometry';
import { createMoveIntentLifecycle } from './lifecycle';

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
    const cachedMoveIntents = new Map();
    const creepToSquad = new Map();
    const squadToCreeps = new Map();
    const squadNextTile = new Set();
    const rerouteSquad = new Set();
    const checkedTiles = new Map();
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

    function wrapCheckTile(checkTileFunc) {
        return (tileList) => {
            const posList = [];
            for (let i = 0; i < tileList.length; i++) {
                posList.push(tile2Pos(tileList[i]));
            }
            return checkTileFunc(posList);
        };
    }

    const defaultIsWorkTile = () => true;
    let isWorkTile = defaultIsWorkTile;

    /**
     * 默认瓦片检查器：把已占位 creep 的潜在让步目标转换成 moveMatch 可消费的候选列表。
     */
    function defaultCheckTile(tileList) {
        const moveIntents = [];
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
            const intent = [];
            const px = creep.pos.x;
            const py = creep.pos.y;
            if (creep.fatigue) {
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
                const terrain = getRoomTerrainBuffer(roomName) || room.getTerrain().getRawBuffer();
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

    let checkTile = defaultCheckTile;
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

        const moveIntents = [];
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

        const nameToIntentIdx = new Map();
        for (const [creepName, idx] of cachedMoveIntents) {
            if (idx) {
                const curTile = IntentTiles[idx + 1];
                const targetTile = IntentTiles[idx];
                const targetList = [
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
            const targetList = moveIntents[intentIdx].targetList;
            if (targetList.length !== 2) {
                continue;
            }

            const targetTile = targetList[0].target;
            const curTile = targetList[1].target;

            let score;
            const tx = (targetTile & 0x3fff) % 50;
            const ty = (targetTile >> 14) % 50;
            let creep = Game.creeps[creepName];
            if (!creep) {
                creep = Game.powerCreeps[creepName];
            }
            if (!creep) {
                continue;
            }
            const roomName = creep.room.name;
            const terrain = getRoomTerrainBuffer(roomName) || creep.room.getTerrain().getRawBuffer();
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

        const result = moveMatch(moveIntents, checkTile);

        const allCreeps = Game.creeps;
        const allPowerCreeps = Game.powerCreeps;
        let moveCount = 0;
        for (const { start, target } of result) {
            if (typeof start === 'string') {
                const startIdx = cachedMoveIntents.get(start);
                if (!startIdx) {
                    let creep = allCreeps[start];
                    if (!creep) {
                        creep = allPowerCreeps[start];
                    }
                    if (!creep) continue;
                    if (powerCreepProto && creep instanceof PowerCreep) continue;
                    const creepPos = creep.pos;
                    const pos = tile2Pos(target);
                    if (pos.x !== creepPos.x || pos.y !== creepPos.y) {
                        getOriginMoveMethod(creep).call(creep, getDirection(creepPos, pos));
                        moveCount++;
                    }
                } else if (target !== IntentTiles[startIdx + 1]) {
                    let creep = allCreeps[start];
                    if (!creep) {
                        creep = allPowerCreeps[start];
                    }
                    if (!creep) continue;
                    if (powerCreepProto && creep instanceof PowerCreep) continue;
                    const creepPos = creep.pos;
                    const pos = tile2Pos(target);
                    if (pos.x !== creepPos.x || pos.y !== creepPos.y) {
                        getOriginMoveMethod(creep).call(creep, getDirection(creepPos, pos));
                        moveCount++;
                    }
                }
            } else {
                const squad = squadToCreeps.get(start);
                for (let i = squad.length; i--;) {
                    let creep = allCreeps[squad[i]];
                    if (!creep) {
                        creep = allPowerCreeps[squad[i]];
                    }
                    if (!creep) continue;
                    if (powerCreepProto && creep instanceof PowerCreep) continue;
                    const creepPos = creep.pos;
                    const pos = tile2Pos(target[i]);
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
