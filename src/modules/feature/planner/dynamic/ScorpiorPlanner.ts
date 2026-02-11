type XY = [number, number];
type LayoutStructMap = { [structureType: string]: XY[] };

/**
 * @typedef {{[x:number]:{[y:number]:number}}} CostMat
 * @typedef {{[cost:number]: {x: number, y:number}[]}} CandidateAnchors
 * @typedef {{x:number, y:number, cost:number, noControllerCost:number}} Anchor
 * @typedef {{x:number, y:number, eX:number, eY:number}} SingleExtension
 * @typedef {{x:number, y:number, children:TailEntry[], isHead:true}} HeadEntry
 * @typedef {{x:number, y:number, children:TailEntry[], isHead:undefined, parentEntryX:number, parentEntryY:number}} TailEntry
 * @typedef {HeadEntry|TailEntry} SingleEntry
 * @typedef {{[x:number]:{[y:number]:SingleExtension}}} PlanedExtensions
 * @typedef {{[x:number]:{[y:number]:SingleEntry}}} PlanedEntries
 * @typedef {FIND_EXIT_TOP | FIND_EXIT_BOTTOM | FIND_EXIT_LEFT | FIND_EXIT_RIGHT} FIND_EXIT_K
 * @typedef {{
 *   0: {[exitType:number]: Array<Array<{x:number, y:number}>>},  // 每个exitGroup的exits列表
 *   1: {[exitType:number]: Array<Array<{x:number, y:number}>>}, // creep 进入房间后落地格，不可建造
 *   2: {[exitType:number]: Array<Array<{x:number, y:number}>>}, // 此处铺满 rampart，外矿路边放 link
 *   3: {[exitType:number]: Array<Array<{x:number, y:number}>>},
 *   4: {[exitType:number]: Array<Array<{x:number, y:number}>>}, // 0~4 都不可造除了路、rampart、link、extractor 以外的建筑物
 *   5: {[exitType:number]: Array<Array<{x:number, y:number}>>}, // 5、6 摆 tower
 *   [key:number]: {[exitType:number]: Array<Array<{x:number, y:number}>>}  // 作类型提示用，实际只计算 0~6
* }} ExitGroups
 */

/** */
const config = {
    controllerWeight: 1,    // 到 controller 路程长度权重倍数
    sourceWeight: 2,        // 到 source 路程长度权重倍数
    mineralWeight: 3,       // 到 mineral 路程长度权重倍数
    maxExtensionDistance: 10, // 允许摆extension的最远距离
    acceptThreshold: 2, // 控制extension分布，在最终plan()函数中可以另外指定
    reviewThreshold: 3, // 控制extension分布，在最终plan()函数中可以另外指定
    fillUpThreshold: 3
};
const NUM_EXT_FOR_SPAWN = 2;
/** 多摆的 2 个 ext 会被替换成 spawn */
const MAX_EXTENSIONS = CONTROLLER_STRUCTURES.extension[8] + NUM_EXT_FOR_SPAWN;
/** 计算到资源点、出口的路径时移除 ext 的代价 */
const EXTENSION_COST = 8;
/** 路程踏入 exit 被敌方 range_attack 范围内的代价 */
const EXIT_PATHFINDER_COST = 9;
const LAB_IDEAL_DISTANCE = 3.8;
const WORK_POS = 'work_pos'

const CANDIDATE_2x2 = [
    { x: -1, y: -3 },
    { x: 0, y: -3 },
    { x: -3, y: -1 },
    { x: -3, y: 0 },
    { x: -1, y: 2 },
    { x: 0, y: 2 },
    { x: 2, y: -1 },
    { x: 2, y: 0 },
]
const CANDIDATE_4x4 = [
    { x_start: -3, y_start: -3, x_end: 3, y_end: -3 },
    { x_start: 4, y_start: -3, x_end: 4, y_end: 3 },
    { x_start: -2, y_start: 4, x_end: 4, y_end: 4 },
    { x_start: -3, y_start: -2, x_end: -3, y_end: 4 },
]
const LAB_LAYOUT = {
    1: [
        { x: -3, y: -3 },
        { x: -2, y: -2 },
        { x: -1, y: -1 },
        { x: 0, y: 0 },
        { x: -1, y: -3 },
        { x: 0, y: -3 },
        { x: 0, y: -2 },
        { x: -3, y: -1 },
        { x: -3, y: 0 },
        { x: -2, y: 0 },
    ],
    2: [
        { x: -3, y: 0 },
        { x: -2, y: -1 },
        { x: -1, y: -2 },
        { x: 0, y: -3 },
        { x: 0, y: 0 },
        { x: 0, y: -1 },
        { x: -1, y: 0 },
        { x: -3, y: -3 },
        { x: -2, y: -3 },
        { x: -3, y: -2 },
    ]
}

/**
 * 获得一个 [start:end] = {} 的二维空数组
 * 
 * @param {number} start 
 * @param {number} end 
 */
function getEmptyMat(start, end) {
    /**@type {{[i:number]:{[j:number]:any}}} */
    let mat = {};
    for (let x = start; x <= end; x++) {
        mat[x] = {};
    }
    return mat;
}


/**
 * @param {number} x1 
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 */
function isNear(x1, y1, x2, y2) {
    return -1 <= x1 - x2 && x1 - x2 <= 1 && -1 <= y1 - y2 && y1 - y2 <= 1;
}

/**
 * 初始化 costMat，把所有墙、出口视为 255（不可通过）。   
 * 若传入 layoutCost，代表已摆下的建筑图，其中不可穿过的建筑也是 255。    
 * 
 * @param {RoomPosition} pos 
 * @param {number} range 
 * @param {Uint8Array} terrain
 * @param {{[x:number]:{[y:number]:number}}} layoutCost
 * @param {CostMat} extensionPos 
 */
function initialCost(pos, range, terrain, layoutCost = undefined, extensionPos = undefined) {
    /**@type {{[x:number]:{[y:number]:number}}} */
    let costMat = getEmptyMat(0, 49);
    let edgeSet = [];
    let j50;
    for (let j = pos.y - range; j <= pos.y + range; j++) {
        if (j < 1 || j > 48) {
            continue;
        }
        j50 = j * 50;
        for (let i = pos.x - range; i <= pos.x + range; i++) {
            if (i < 1 || i > 48 || terrain[j50 + i] & TERRAIN_MASK_WALL ||
                (layoutCost && layoutCost[i][j] == 255) ||
                (extensionPos && j in extensionPos[i])
            ) {
                continue;
            }
            edgeSet.push({
                x: i,
                y: j
            });
            costMat[i][j] = 0;
        }
    }
    return { costMat, edgeSet };
}

/**
 * 根据一张未摆建筑、只考虑出口和墙不可通行的初始 costMat，   
 * 计算以某个资源点为出发点，到所有其他可达点的最短路径。    
 * 返回的 costMat 中每一格数字代表此格到目标资源点的路程。
 * 
 * @param {RoomPosition} pos 
 * @param {number} range 
 * @param {Uint8Array} terrain 
 * @param {number} weight 
 */
function calCostMat(pos, range, terrain, weight) {
    let { costMat, edgeSet } = initialCost(pos, range, terrain);
    let j50, px, py;
    for (let pos of edgeSet) {
        px = pos.x;
        py = pos.y;
        for (let j = py - 1; j <= py + 1; j++) {
            if (j < 1 || j > 48) {
                continue;
            }
            j50 = j * 50;
            for (let i = px - 1; i <= px + 1; i++) {
                if (j in costMat[i] || i < 1 || i > 48 || terrain[j50 + i] & TERRAIN_MASK_WALL) {
                    continue;
                }
                edgeSet.push({
                    x: i,
                    y: j
                });
                costMat[i][j] = costMat[px][py] + weight;
            }
        }
    }
    return costMat;
}

/**
 * 分别以 controller、每个 source、mineral 为目标计算当前整个房间的路程图。   
 * 上述每个目标 goal 有一个 costMat，返回所有这几个 costMat 组成的列表。
 * 
 * @param {ClaimableRoom} room 
 * @param {Uint8Array} terrain 
 * @returns {CostMat[]}
 */
function getCostMats(room, terrain) {
    let costMats = [calCostMat(room.controller.pos, 2, terrain, config.controllerWeight)];
    for (let source of room.source) {
        costMats.push(calCostMat(source.pos, 1, terrain, config.sourceWeight));
    }
    if (room.mineral) {
        costMats.push(calCostMat(room.mineral.pos, 1, terrain, config.mineralWeight));
    }
    return costMats;
}

/**
 * 获取每个出口周围不同距离的空地格子。
 * 对于每一待检查的 eixtGroup，用线段起止点表示，对于检查后的，用 {x:number, y:number} 数组
 * dist == 0 为出口格，dist == 1 也不能建造
 * dist == 2 造 ramp
 * dist == 3、4 为敌方可攻击区，设置为不能建造除矿点 container、link 以外建筑
 * dist == 5、6 为 tower 位置
 * 
 * @param {Uint8Array} terrain 
 * @returns {ExitGroups} dist 0~2 相连的才算一个 group，dist 3 以上各方向只算作同一个 group
 */
function getExitGroups(terrain) {
    /**@type {ExitGroups} */
    let exitGroups = { 0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };    // 用于存储算法结果，每一级代表与出口不同距离的空地
    let exitMaps = {
        0: getEmptyMat(0, 49), 1: getEmptyMat(0, 49), 2: getEmptyMat(0, 49),
        3: getEmptyMat(0, 49), 4: getEmptyMat(0, 49), 5: getEmptyMat(0, 49), 6: getEmptyMat(0, 49)
    };
    /**@type {CostMat} */
    let exitCost = {};
    for (let x = 1; x < 25; x++) {
        exitCost[x] = {}
        exitCost[49 - x] = {}
    }
    /**@type {Array<[FIND_EXIT_K, number, number, number, number]>} */
    let exitConfig = [
        [FIND_EXIT_TOP, 1, 0, 0, 1],    // exitDirection, 遍历当前层的方向(xDelta, yDelta)，往更内一层的方向(xDelta, yDelta)
        [FIND_EXIT_BOTTOM, 1, 0, 0, -1],
        [FIND_EXIT_LEFT, 0, 1, 1, 0],
        [FIND_EXIT_RIGHT, 0, 1, -1, 0],
    ];
    for (let conf of exitConfig) {
        let [exitType, xDeltaCur, yDeltaCur, xDeltaNext, yDeltaNext] = conf;
        let i, j;
        if (exitType == FIND_EXIT_TOP) {
            i = 1, j = 0;
        } else if (exitType == FIND_EXIT_BOTTOM) {
            i = 1, j = 49;
        } else if (exitType == FIND_EXIT_LEFT) {
            i = 0, j = 1;
        } else {
            i = 49, j = 1;
        }
        exitGroups[0][exitType] = [];
        let counter = 0;
        let terrainIdxDelta = xDeltaCur + yDeltaCur * 50;
        let terrainIdx = i + j * 50;
        /**@type {Array<{x:number, y:number}>} */
        let currentGroup = []   // 同一方向的 exit 若被墙截断则分为不同 exitGroups
        while (counter < 49) {  // 第 49 次 loop 是房间角点，一定是墙，保证最后一个 currentGroup 也收进 exitGroups
            if (terrain[terrainIdx] & TERRAIN_MASK_WALL) {
                if (currentGroup.length > 0) {
                    for (let exitPos of currentGroup) {
                        exitMaps[0][exitPos.x][exitPos.y] = 1;
                    }
                    // console.log(`group from`, JSON.stringify(pStart), ' to ', JSON.stringify(pEnd));
                    exitGroups[0][exitType].push(currentGroup);
                    currentGroup = [];
                }
            } else {
                currentGroup.push({ x: i, y: j })
            }
            i += xDeltaCur;
            j += yDeltaCur;
            terrainIdx += terrainIdxDelta;
            counter += 1;
        }
        if (!exitGroups[0][exitType].length) {
            continue;
        }

        // 接下来为每个 exitGroups 计算更内一层的相邻格，放入 exitGroups[dist+1] 中以待检查地形
        let nextDistGroups = [];
        for (let group of exitGroups[0][exitType]) {
            let firstPos = group[0], lastPos = group[group.length - 1];
            let minP, maxP;
            if (exitType == FIND_EXIT_TOP || exitType == FIND_EXIT_BOTTOM) {
                minP = firstPos.x - 1 > 1 ? firstPos.x - 1 : 1;
                maxP = lastPos.x + 1 < 48 ? lastPos.x + 1 : 48;
            } else {    // exitType == FIND_EXIT_LEFT || exitType == FIND_EXIT_RIGHT
                minP = firstPos.y - 1 > 1 ? firstPos.y - 1 : 1;
                maxP = lastPos.y + 1 < 48 ? lastPos.y + 1 : 48;
            }
            // 如果当前 dist 层级的出口不相连，但是更远一层级相连，在下一层视作同一个 exitGroups 处理
            if (nextDistGroups.length && nextDistGroups[nextDistGroups.length - 1].maxP >= minP - 1) {
                nextDistGroups[nextDistGroups.length - 1].maxP = maxP;
            } else {
                nextDistGroups.push({ minP: minP, maxP: maxP })
            }
        }
        //@ts-ignore
        exitGroups[1][exitType] = nextDistGroups;

    }
    // 接下来处理 1~2 dist，是以路程为准，dist 2 是通达 exit 路程为 2 的点。
    // dist 1 是不可建造区域，也是敌方 creep 可达区域，用于计算不可建筑范围
    // dist 2 用于造 rampart
    for (let dist = 1; dist <= 2; dist++) {
        for (let conf of exitConfig) {
            let [exitType, xDeltaCur, yDeltaCur, xDeltaNext, yDeltaNext] = conf;
            if (!exitGroups[dist][exitType]) {
                continue;
            }

            let terrainIdxDelta = xDeltaCur + yDeltaCur * 50;
            let exitGroupsToCheck = exitGroups[dist][exitType];
            exitGroups[dist][exitType] = [];

            // console.log(`type ${exitType} dist ${dist} has ${exitGroupsToCheck.length} groups to check: `, JSON.stringify(exitGroupsToCheck));
            let i, j;
            if (exitType == FIND_EXIT_TOP || exitType == FIND_EXIT_BOTTOM) {
                j = exitType == FIND_EXIT_TOP ? dist : 49 - dist;
            } else {
                i = exitType == FIND_EXIT_LEFT ? dist : 49 - dist;
            }
            let nextDistGroups = [];
            for (let eGroup of exitGroupsToCheck) {
                if (exitType == FIND_EXIT_TOP || exitType == FIND_EXIT_BOTTOM) {
                    //@ts-ignore
                    i = eGroup.minP;
                } else {
                    //@ts-ignore
                    j = eGroup.minP;
                }

                let curMinP = 0;
                //@ts-ignore
                for (let terrainIdx = i + j * 50, idx = eGroup.minP;
                    //@ts-ignore
                    idx <= eGroup.maxP;
                    idx++, terrainIdx += terrainIdxDelta) {
                    if (terrain[terrainIdx] & TERRAIN_MASK_WALL || idx == eGroup.maxP) {
                        // 如果之前不是墙，现在遇到墙，则将 之前至idx-1 作为一个 exitGroups
                        if (curMinP > 0) {
                            // idx 到达最大值，视为 idx+1 处有墙
                            if (!(terrain[terrainIdx] & TERRAIN_MASK_WALL)) {
                                idx += 1;
                            }

                            // 最终版本不用线段，用数组
                            let posGroup = [];
                            for (let irv = curMinP; irv < idx; irv++) {
                                if (exitType == FIND_EXIT_TOP || exitType == FIND_EXIT_BOTTOM) {
                                    // 由于最外层 for 循环 dist 从小到大遍历，只要 exitCost 有值则代表当前点已被其他方向的 exitGroups 纳入
                                    if (!exitCost[irv][j]) {
                                        posGroup.push({ x: irv, y: j });
                                        exitCost[irv][j] = dist;    // 标记 exitCost 此处距离出口最近距离
                                        exitMaps[dist][irv][j] = 1;
                                    }

                                } else {
                                    if (!exitCost[i][irv]) {
                                        posGroup.push({ x: i, y: irv });
                                        exitCost[i][irv] = dist;
                                        exitMaps[dist][i][irv] = 1;
                                    }
                                }
                            }
                            // 检查当前 group 起、止这两点垂直于出入口的格子
                            if (exitType == FIND_EXIT_TOP || exitType == FIND_EXIT_BOTTOM) {
                                // yVert - yDeltaNext 代表往房间边缘走一层
                                for (let xVert = curMinP, yVert = j - yDeltaNext; 0 < yVert && yVert < 49; yVert -= yDeltaNext) {
                                    if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                                        exitCost[xVert][yVert] = dist;
                                        posGroup.push({ x: xVert, y: yVert });
                                        exitMaps[dist][xVert][yVert] = 1;
                                    }
                                }
                                for (let xVert = idx - 1, yVert = j - yDeltaNext; 0 < yVert && yVert < 49; yVert -= yDeltaNext) {
                                    if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                                        exitCost[xVert][yVert] = dist;
                                        posGroup.push({ x: xVert, y: yVert });
                                        exitMaps[dist][xVert][yVert] = 1;
                                    }
                                }
                            } else {
                                for (let xVert = i - xDeltaNext, yVert = curMinP; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                                    if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                                        exitCost[xVert][yVert] = dist;
                                        posGroup.push({ x: xVert, y: yVert });
                                        exitMaps[dist][xVert][yVert] = 1;
                                    }
                                }
                                for (let xVert = i - xDeltaNext, yVert = idx - 1; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                                    if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                                        exitCost[xVert][yVert] = dist;
                                        posGroup.push({ x: xVert, y: yVert });
                                        exitMaps[dist][xVert][yVert] = 1;
                                    }
                                }
                            }
                            exitGroups[dist][exitType].push(posGroup);

                            // 如果还需计算下一 dist 层级，则放入待检查的
                            if (dist + 1 in exitGroups) {
                                let nextMinP = curMinP > 2 ? curMinP - 1 : 1, nextMaxP = idx < 48 ? idx : 48;
                                //@ts-ignore

                                if (nextDistGroups.length && nextDistGroups[nextDistGroups.length - 1].maxP >= nextMinP - 1) {
                                    //@ts-ignore
                                    nextDistGroups[nextDistGroups.length - 1].maxP = nextMaxP;
                                } else {
                                    //@ts-ignore
                                    nextDistGroups.push({ minP: nextMinP, maxP: nextMaxP });
                                }
                            }
                            curMinP = 0;

                        }
                    } else if (curMinP == 0) {
                        // 如果之前是墙，现在遇到平地，则将当前 idx 作为下一个 exitGroups 的起始点
                        curMinP = idx;
                    }
                }
                if (dist + 1 in exitGroups) {
                    //@ts-ignore
                    exitGroups[dist + 1][exitType] = nextDistGroups;
                }
            }

            if (dist <= 1) {
                continue;
            }

            let posGroup = [];
            // 检查当前层级最两端垂直于出入口的格子
            for (let group of exitGroups[1][exitType]) {
                if (exitType == FIND_EXIT_TOP || exitType == FIND_EXIT_BOTTOM) {
                    // yVert - yDeltaNext 代表往房间边缘走一层
                    for (let xVert = group[0].x - dist + 1, yVert = j - yDeltaNext; 0 < yVert && yVert < 49; yVert -= yDeltaNext) {
                        if (xVert <= 0 || 49 <= xVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                        }
                    }
                    for (let xVert = group[group.length - 1].x + dist - 1, yVert = j - yDeltaNext; 0 < yVert && yVert < 49; yVert -= yDeltaNext) {
                        if (xVert <= 0 || 49 <= xVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                        }
                    }
                } else {
                    for (let xVert = i - xDeltaNext, yVert = group[0].y - dist + 1; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                        if (yVert <= 0 || 49 <= yVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                        }
                    }
                    for (let xVert = i - xDeltaNext, yVert = group[group.length - 1].y + dist - 1; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                        if (yVert <= 0 || 49 <= yVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                        }
                    }
                }
            }
            if (posGroup.length) {
                for (let pos of posGroup) {
                    exitMaps[dist][pos.x][pos.y] = 1;
                }
                exitGroups[dist][exitType].push(posGroup)
            }
        }
    }

    // 接下来处理 3~6 dist
    // 3、4 dist 为敌方可攻击区域，只需考虑与 dist 0、dist 1 空地的 range，即 max(x1-x2, y1-y2) <= 3
    // 5、6 dist 为造 tower 的优先区域，也只考虑 range
    // 以下算法假定 dist1 的 group 必定不短于对应的 dist0 group
    for (let dist = 3; dist <= 6; dist++) {
        for (let conf of exitConfig) {
            let [exitType, xDeltaCur, yDeltaCur, xDeltaNext, yDeltaNext] = conf

            if (!exitGroups[1][exitType]) {
                continue;
            }
            exitGroups[dist][exitType] = [];

            let terrainIdxDelta = xDeltaCur + yDeltaCur * 50;

            let i, j;
            if (exitType == FIND_EXIT_TOP || exitType == FIND_EXIT_BOTTOM) {
                j = exitType == FIND_EXIT_TOP ? dist : 49 - dist;
            } else {
                i = exitType == FIND_EXIT_LEFT ? dist : 49 - dist;
            }

            let posGroup = [], iMin, iMax, jMin, jMax;
            // 由于 dist1 的 group 必定不短于对应的 dist0 group，所以只需要考虑 dist1 的 group
            for (let group of exitGroups[1][exitType]) {
                if (exitType == FIND_EXIT_TOP || exitType == FIND_EXIT_BOTTOM) {
                    iMin = Math.max(2, group[0].x - dist + 1);
                    iMax = Math.min(47, group[group.length - 1].x + dist - 1);
                } else {
                    jMin = Math.max(2, group[0].y - dist + 1);
                    jMax = Math.min(47, group[group.length - 1].y + dist - 1);
                }

                // 先处理两端垂直于 exit 的格子
                if (exitType == FIND_EXIT_TOP || exitType == FIND_EXIT_BOTTOM) {
                    // 检查当前层级最两端垂直于出入口的格子
                    // yVert - yDeltaNext 代表往房间边缘走一层
                    for (let xVert = iMin, yVert = j; 0 < yVert && yVert < 49; yVert -= yDeltaNext) {
                        if (xVert <= 0 || 49 <= xVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                        }
                    }
                    for (let xVert = iMax, yVert = j; 0 < yVert && yVert < 49; yVert -= yDeltaNext) {
                        if (xVert <= 0 || 49 <= xVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                        }
                    }
                    // 然后处理平行于 exit 的格子
                    for (let terrainIdx = iMin + 1 + j * 50, idx = iMin + 1;
                        idx < iMax;
                        idx++, terrainIdx += terrainIdxDelta) {
                        if (!exitCost[idx][j] && !(terrain[terrainIdx] & TERRAIN_MASK_WALL)) {
                            exitCost[idx][j] = dist;
                            posGroup.push({ x: idx, y: j });
                        }
                    }
                } else {
                    // 检查当前层级最两端垂直于出入口的格子
                    for (let xVert = i, yVert = jMin; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                        if (yVert <= 0 || 49 <= yVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                        }
                    }
                    for (let xVert = i, yVert = jMax; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                        if (yVert <= 0 || 49 <= yVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                        }
                    }
                    // 然后处理平行于 exit 的格子
                    for (let terrainIdx = i + (jMin + 1) * 50, idx = jMin + 1;
                        idx < jMax;
                        idx++, terrainIdx += terrainIdxDelta) {
                        if (!exitCost[i][idx] && !(terrain[terrainIdx] & TERRAIN_MASK_WALL)) {
                            exitCost[i][idx] = dist;
                            posGroup.push({ x: i, y: idx });
                        }
                    }
                }
            }
            if (posGroup.length > 0) {
                for (let pos of posGroup) {
                    exitMaps[dist][pos.x][pos.y] = 1;
                }
                exitGroups[dist][exitType].push(posGroup);
            }
        }
    }

    return { exitGroups, exitMaps };
}

/**
 * 把某一 pos 周围半径 range 的区域设为不可通过。   
 * range=0 代表仅考虑 pos 自身。
 * 
 * @param {RoomPosition} pos 
 * @param {number} range 
 * @param {Uint8Array} terrain 
 */
function setAsWall(pos, range, terrain) {
    let j50;
    for (let j = pos.y - range; j <= pos.y + range; j++) {
        if (j <= 0 || j >= 49) {
            continue;
        }
        j50 = j * 50;
        for (let i = pos.x - range; i <= pos.x + range; i++) {
            if (i <= 0 || i >= 49) {
                continue;
            }
            terrain[j50 + i] = TERRAIN_MASK_WALL;
        }
    }
}

/**
 * 初始化用于计算最大空地正方形的二维数组
 * 
 * @param {ClaimableRoom} room 
 * @param {Uint8Array} terrain 
 * @param {ExitGroups} exitGroups 
 * @return {CostMat}
 */
function initialMap(room, terrain, exitGroups) {
    /**@type {CostMat} */
    let map = {};
    setAsWall(room.controller.pos, 2, terrain);     // controller 周围 range 2 内设为墙，视为不可建造
    if (room.mineral) {
        setAsWall(room.mineral.pos, 1, terrain);    // mineral 周围 range 1 内视为不可建造
    }
    for (let src of room.source) {
        setAsWall(src.pos, 1, terrain);             // source 周围 range 1 内视为不可建造
    }
    for (let dist of [0, 1, 2, 3, 4]) {                // exit 周围 range 4 内视为不可建造
        for (let exitType in exitGroups[dist]) {
            for (let group of exitGroups[dist][exitType]) {
                for (let pos of group) {
                    // equal to setAsWall(pos, 0, terrain)
                    terrain[pos.y * 50 + pos.x] = TERRAIN_MASK_WALL;
                }
            }
        }
    }

    // 设置动态规划的递推所需的初始值，只需考虑房间正方形左、上两条边的所有格子
    for (let x = 1; x < 50; x++) {
        map[x] = {};
        map[x][1] = terrain[50 + x] & TERRAIN_MASK_WALL ? 0 : 1;   // 是墙则0
    }
    for (let y = 1; y < 49; y++) {
        map[1][y] = terrain[y * 50 + 1] & TERRAIN_MASK_WALL ? 0 : 1;    // 是墙则0
    }
    return map;
}

/**
 * 
 * @param {{x:number, y:number}} anchor2x2 绝对坐标
 * @param {{x:number, y:number}[]} validCandidate4x4 
 */
function findBestAnchor4x4(anchor2x2, validCandidate4x4) {
    let bestAnchor4x4, minRange = 999, anchor2x2_x = anchor2x2.x, anchor2x2_y = anchor2x2.y, x, y;
    for (let pos of validCandidate4x4) {
        x = pos.x, y = pos.y
        let range4x4to2x2 = Math.max(Math.abs(x - 1 - anchor2x2_x), Math.abs(y - 1 - anchor2x2_y));
        if (2 < range4x4to2x2 && Math.abs(range4x4to2x2 - LAB_IDEAL_DISTANCE) < minRange) {
            bestAnchor4x4 = { x: x, y: y };
            minRange = Math.abs(range4x4to2x2 - LAB_IDEAL_DISTANCE);
        } // TODO: 研究一下 W12S13 lab 为什么没挨着中央 link
    }
    return bestAnchor4x4;
}

/**
 * 
 * @param {CandidateAnchors} candidate3x3 
 * @param {CostMat} map 
 * @param {CostMat[]} costMats 
 * @returns {{bestAnchor3x3: {x:number, y:number} | undefined, bestAnchor2x2: {x:number, y:number} | undefined, bestAnchor4x4: {x:number, y:number} | undefined}}
 */
function getBestAnchor(candidate3x3, map, costMats) {
    let bestAnchor3x3, bestAnchor2x2, bestAnchor4x4;
    for (let cost in candidate3x3) {
        for (let anchor3x3 of candidate3x3[cost]) {
            // 绝对坐标
            /**@type {CandidateAnchors} */
            let validCandidate2x2 = {}, validCandidate4x4 = [];
            for (let anchor2x2 of CANDIDATE_2x2) {
                // CANDIDATE_2x2 存储的是相对坐标，需加上 anchor3x3 的绝对坐标 
                let x = anchor3x3.x + anchor2x2.x, y = anchor3x3.y + anchor2x2.y;
                // >= 2 是足够的空地，按照 cost 加入 validCandidate2x2 以待进一步检查 
                if (map[x][y] >= 2) {
                    let cost2 = 0;
                    for (let costMat of costMats) {
                        cost2 += costMat[x][y];
                    }
                    if (validCandidate2x2[cost2]) {
                        validCandidate2x2[cost2].push({ x: x, y: y })
                    } else {
                        validCandidate2x2[cost2] = [{ x: x, y: y }]
                    }
                } // if (map[x][y] >=2)
            } // for (let anchor2x2 of CANDIDATE_2x2)

            let anchor3x3_x = anchor3x3.x, anchor3x3_y = anchor3x3.y;
            for (let data4x4 of CANDIDATE_4x4) {
                let { x_start, y_start, x_end, y_end } = data4x4;
                if (x_end > x_start) {
                    x_end += anchor3x3_x;
                    for (let x = x_start + anchor3x3_x, y = y_start + anchor3x3_y; x <= x_end; x++) {
                        if (map[x][y] >= 4) {
                            /** 
                             * 处理可能会被墙封死 storage 和 lab 之间通路的情况
                             * 遍历 x 的情况，y 只会是 -3 或 4
                             */
                            if (y == anchor3x3_y - 3) {
                                if (x == anchor3x3_x - 3) {
                                    if (map[x][y + 1] == 0 && map[x + 1][y] == 0) {
                                        continue;
                                    }
                                } else if (x == anchor3x3_x - 2) {
                                    if (map[x - 1][y + 1] == 0 && map[x + 1][y] == 0) {
                                        continue;
                                    }
                                } else if (x == anchor3x3_x + 3) {
                                    if (map[x - 4][y] == 0 && map[x - 2][y + 1] == 0) {
                                        continue;
                                    }
                                }
                            } else {    // y == anchor3x3_y+4
                                if (x == anchor3x3_x - 2) {
                                    if (map[x - 1][y - 4] == 0 && map[x + 1][y - 3] == 0) {
                                        continue;
                                    }
                                } else if (x == anchor3x3_x + 3) {
                                    if (map[x - 2][y - 4] == 0 && map[x - 4][y - 3] == 0) {
                                        continue;
                                    }
                                } else if (x == anchor3x3_x + 4) {
                                    if (map[anchor3x3_x][anchor3x3_y + 1] == 0 && map[anchor3x3_x + 1][anchor3x3_y] == 0) {
                                        continue;
                                    }
                                }
                            }
                            validCandidate4x4.push({ x, y });
                        }
                    }
                } else {
                    y_end += anchor3x3_y;
                    for (let x = x_start + anchor3x3_x, y = y_start + anchor3x3_y; y <= y_end; y++) {
                        if (map[x][y] >= 4) {
                            /** 
                             * 处理可能会被墙封死 storage 和 lab 之间通路的情况
                             * 遍历 y 的情况，x 只会是 -3 或 4
                             */
                            if (x == anchor3x3_x - 3) {
                                if (y == anchor3x3_y - 2) {
                                    if (map[x][y + 1] == 0 && map[x + 1][y - 1] == 0) {
                                        continue;
                                    }
                                } else if (y == anchor3x3_y + 3) {
                                    if (map[x][y - 4] == 0 && map[x + 1][y - 2] == 0) {
                                        continue;
                                    }
                                } else if (y == anchor3x3_y + 4) {
                                    if (map[x][y - 4] == 0 && map[x + 1][y - 3] == 0) {
                                        continue;
                                    }
                                }
                            } else {    // x == anchor3x3_x+4
                                if (y == anchor3x3_y - 3) {
                                    if (map[x - 4][y] == 0 && map[x - 3][y + 1] == 0) {
                                        continue;
                                    }
                                } else if (y == anchor3x3_y - 2) {
                                    if (map[x - 4][y - 1] == 0 && map[x - 3][y + 1] == 0) {
                                        continue;
                                    }
                                } else if (y == anchor3x3_y + 3) {
                                    if (map[x - 4][y - 2] == 0 && map[x - 3][y - 4] == 0) {
                                        continue;
                                    }
                                }
                            }
                            validCandidate4x4.push({ x, y });
                        }
                    }
                }
            }

            if (validCandidate4x4.length == 0) {
                continue;
            }
            for (let cost2 in validCandidate2x2) {
                for (let anchor2x2 of validCandidate2x2[cost2]) {
                    bestAnchor4x4 = findBestAnchor4x4(anchor2x2, validCandidate4x4);
                    if (bestAnchor4x4 !== undefined) {
                        bestAnchor2x2 = anchor2x2;
                        bestAnchor3x3 = anchor3x3;
                        return { bestAnchor3x3, bestAnchor2x2, bestAnchor4x4 };
                    }
                } // for anchor2x2
            } // for cost2 in validCandidate2x2
        }
    }
    return { bestAnchor3x3, bestAnchor2x2, bestAnchor4x4 };
}

/**
 *  计算地图正方形面积同时把总路程最短的作为中心，路程相同选离controller最远的（5级先建link到controller）
 *  经过此函数后，terrain 中会将矿点、出口半径2范围内都视为墙
 * 
 * 
 * @param {Room} room 
 * @param {Uint8Array} terrain 
 * @param {ExitGroups} exitGroups 
 * @param {CostMat[]} costMats
 * @returns {{map: CostMat, bestAnchors: ReturnType<typeof getBestAnchor>}} map: 二维数组，每一个值代表以此为右下角的最大空地正方形边长，bestAnchor: 满足边长的正方形中总路程最短的右下角
 */
function calSquare(room, terrain, exitGroups, costMats) {
    // @ts-ignore
    let map = initialMap(room, terrain, exitGroups);    // 二维数组，每一个值代表以此为右下角的最大空地正方形边长
    /**@type {CandidateAnchors} */
    let candidate3x3 = {};
    let radius3x3 = 1;
    let y50, current, cost, noControllerCost;
    for (let y = 2; y < 49; y++) {
        y50 = y * 50;
        for (let x = 2; x < 49; x++) {
            if (terrain[y50 + x] & TERRAIN_MASK_WALL) {
                map[x][y] = 0;
            } else {
                current = map[x - 1][y - 1];
                if (current > map[x - 1][y]) {  // 取min
                    current = map[x - 1][y];
                }
                if (current > map[x][y - 1]) {  // 取min
                    current = map[x][y - 1];
                }
                current = current + 1;  // 递推
                map[x][y] = current;
                // 先找 3x3 放 storage，terminal，powerSpawn, factory
                if (current >= 3) {
                    //showAnchor(rv, x, y, (diameter - 1) / 2, 0);
                    cost = 0;
                    for (let costMat of costMats) {
                        cost += costMat[x - radius3x3][y - radius3x3];
                    }
                    if (candidate3x3[cost]) {
                        candidate3x3[cost].push({ x: x, y: y })
                    } else {
                        candidate3x3[cost] = [{ x: x, y: y }]
                    }
                }
            }
        }
    }
    let { bestAnchor3x3, bestAnchor2x2, bestAnchor4x4 } = getBestAnchor(candidate3x3, map, costMats);
    return { map, bestAnchors: { bestAnchor3x3, bestAnchor2x2, bestAnchor4x4 } };
}

/**
 * 
 * @param {{bestAnchor2x2: Anchor, bestAnchor3x3: Anchor, bestAnchor4x4: Anchor}} bestAnchors 
 * @returns {{layout: {[type:string]:{x:number, y:number}[]}, layoutCost:CostMat}}
 */
function placeCentralStructure(bestAnchors) {
    let { bestAnchor2x2, bestAnchor3x3, bestAnchor4x4 } = bestAnchors;
    /**@type {{[type: string]: {x:number, y:number}[]}} */
    let layout = {}, layoutCost = getEmptyMat(1, 48);

    let center2x2 = { x: bestAnchor2x2.x - 0.5, y: bestAnchor2x2.y - 0.5 };
    let center3x3 = { x: bestAnchor3x3.x - 1, y: bestAnchor3x3.y - 1 };
    let center4x4 = { x: bestAnchor4x4.x - 1.5, y: bestAnchor4x4.y - 1.5 };

    // link in 2x2
    let link = { x: bestAnchor2x2.x + ((center2x2.x < center3x3.x) ? 0 : -1), y: bestAnchor2x2.y + ((center2x2.y < center3x3.y) ? 0 : -1) };
    layoutCost[link.x][link.y] = 255;
    layout[STRUCTURE_LINK] = [{ x: link.x, y: link.y }];
    // spawn in 2x2
    let spawn = { x: center2x2.x * 2 - link.x, y: center2x2.y * 2 - link.y };
    layoutCost[spawn.x][spawn.y] = 255;
    layout[STRUCTURE_SPAWN] = [{ x: spawn.x, y: spawn.y }];
    // roads in 2x2
    layout[STRUCTURE_ROAD] = [];
    for (let x = bestAnchor2x2.x - 1; x <= bestAnchor2x2.x; x++) {
        for (let y = bestAnchor2x2.y - 1; y <= bestAnchor2x2.y; y++) {
            if (!layoutCost[x][y]) {
                layoutCost[x][y] = 1;
                layout[STRUCTURE_ROAD].push({ x: x, y: y });
            }
        }
    }

    // storage in 3x3
    let storage = { x: center3x3.x + ((center3x3.x < center2x2.x) ? 1 : -1), y: center3x3.y + ((center3x3.y < center2x2.y) ? 1 : -1) };
    layoutCost[storage.x][storage.y] = 255;
    layout[STRUCTURE_STORAGE] = [{ x: storage.x, y: storage.y }];
    // terminal in 3x3
    let betweenLinkAnd3x3 = { x: (link.x + center3x3.x) / 2, y: (link.y + center3x3.y) / 2 };
    let terminal = { x: betweenLinkAnd3x3.x * 2 - storage.x, y: betweenLinkAnd3x3.y * 2 - storage.y };
    layoutCost[terminal.x][terminal.y] = 255;
    layout[STRUCTURE_TERMINAL] = [{ x: terminal.x, y: terminal.y }];
    // powerSpawn in 3x3
    let powerSpawn = { x: center3x3.x, y: center3x3.y };
    layoutCost[powerSpawn.x][powerSpawn.y] = 255;
    layout[STRUCTURE_POWER_SPAWN] = [{ x: powerSpawn.x, y: powerSpawn.y }];
    // factory in 3x3
    let factory = { x: center3x3.x * 2 - betweenLinkAnd3x3.x, y: center3x3.y * 2 - betweenLinkAnd3x3.y };
    layoutCost[factory.x][factory.y] = 255;
    layout[STRUCTURE_FACTORY] = [{ x: factory.x, y: factory.y }];
    // roads in 3x3
    for (let x = bestAnchor3x3.x - 2; x <= bestAnchor3x3.x; x++) {
        for (let y = bestAnchor3x3.y - 2; y <= bestAnchor3x3.y; y++) {
            if (!layoutCost[x][y]) {
                layoutCost[x][y] = 1;
                layout[STRUCTURE_ROAD].push({ x: x, y: y });
            }
        }
    }

    // head lab in 4x4
    let headLab = { x: (center4x4.x < storage.x) ? 0 : -3, y: (center4x4.y < storage.y) ? 0 : -3 }, labLayout;
    if (headLab.x == 0) {
        labLayout = headLab.y == 0 ? LAB_LAYOUT[1] : LAB_LAYOUT[2];
    } else {
        labLayout = headLab.y == 0 ? LAB_LAYOUT[2] : LAB_LAYOUT[1];
    }
    // all labs in 4x4
    layout[STRUCTURE_LAB] = [];
    for (let lab of labLayout) {
        layoutCost[lab.x + bestAnchor4x4.x][lab.y + bestAnchor4x4.y] = 255;
        layout[STRUCTURE_LAB].push({ x: lab.x + bestAnchor4x4.x, y: lab.y + bestAnchor4x4.y });
    }
    // roads in 4x4
    for (let x = bestAnchor4x4.x - 3; x <= bestAnchor4x4.x; x++) {
        for (let y = bestAnchor4x4.y - 3; y <= bestAnchor4x4.y; y++) {
            if (!layoutCost[x][y]) {
                layoutCost[x][y] = 1;
                layout[STRUCTURE_ROAD].push({ x: x, y: y });
            }
        }
    }

    return { layout, layoutCost };
}

/**
 * 在计算任何 ext 之前，确保 storage 到 lab 集群中心有路
 * 
 * @param {ClaimableRoom} room 
 * @param {CostMat} layoutCost 
 * @param {{[type: string]: {x:number, y:number}[]}} layout 
 * @param {Anchor} bestAnchor4x4 
 * @returns {{x:number, y:number}[]} 用于计算 ext 时将这些路点右下正方形边长设 1、2
 */
function paveRoadFromStorageToLab(room, layoutCost, layout, bestAnchor4x4) {
    // lab 中心，这个位置足够了
    let goals = [{ pos: new RoomPosition(bestAnchor4x4.x - 1, bestAnchor4x4.y - 1, room.name), range: 1 }];
    let pfCostMat = new PathFinder.CostMatrix, start;
    /**@type {{x:number, y:number}[]} */
    let additionalRoads = [];

    for (let x in layoutCost) {
        for (let y in layoutCost[x]) {
            pfCostMat.set(+x, +y, layoutCost[x][y]);
        }
    }
    let pfOpts = {
        maxRooms: 1,
        plainCost: 2,
        swampCost: 4,
        roomCallback: () => pfCostMat
    }
    start = new RoomPosition(layout[STRUCTURE_STORAGE][0].x, layout[STRUCTURE_STORAGE][0].y, room.name);
    let result = PathFinder.search(start, goals, pfOpts);
    let path = result.path, px, py;
    for (let idx = 0; idx < path.length; idx++) {
        let pos = path[idx];
        px = pos.x;
        py = pos.y;
        if (!(py in layoutCost[px])) {
            layoutCost[px][py] = 1;
            additionalRoads.push({ x: px, y: py })
            layout[STRUCTURE_ROAD].push({ x: px, y: py });
        }
    }
    return additionalRoads;
}


/**
 * 
 * @param {CostMat} map 
 * @param {{bestAnchor2x2:Anchor, bestAnchor3x3:Anchor, bestAnchor4x4:Anchor}} bestAnchors 
 * @param {{x:number, y:number}[]} additionalRoads 
 */
function updateMap(map, bestAnchors, additionalRoads) {
    let squares = additionalRoads.map(pos => ({ x: pos.x, y: pos.y, diameter: 1 }));
    let { bestAnchor2x2, bestAnchor3x3, bestAnchor4x4 } = bestAnchors;
    squares.push(
        { x: bestAnchor2x2.x, y: bestAnchor2x2.y, diameter: 2 },
        { x: bestAnchor3x3.x, y: bestAnchor3x3.y, diameter: 3 },
        { x: bestAnchor4x4.x, y: bestAnchor4x4.y, diameter: 4 },
    );

    // 暂存被修改的位置的数据
    let absx, absy;
    for (let square of squares) {
        absx = square.x;
        absy = square.y;
        // 布局正方形内空地置0
        for (let y = -square.diameter + 1; y <= 0; y++) {
            for (let x = -square.diameter + 1; x <= 0; x++) {
                map[x + absx][y + absy] = 0;
            }
        }
        // 右下角第一圈值1，第二圈置2
        for (let i = -square.diameter + 1; i <= 1; i++) {
            map[absx + 1][absy + i] = map[absx + 1][absy + i] && 1; // 0&&1 = 0, 2&&1 = 1
            map[absx + 2][absy + i] = map[absx + 2][absy + i] >= 2 ? 2 : map[absx + 2][absy + i];
            map[absx + i][absy + 1] = map[absx + i][absy + 1] && 1;
            map[absx + i][absy + 2] = map[absx + i][absy + 2] >= 2 ? 2 : map[absx + i][absy + 2];
        }
        map[absx + 2][absy + 2] = map[absx + 2][absy + 2] >= 2 ? 2 : map[absx + 2][absy + 2];
    }
}

/**
 * 
 * @param {number} x 测试中心x
 * @param {number} y 测试中心y
 * @param {CostMat} costMat 每个点到storage的距离
 * @param {PlanedExtensions} planedExtensions 已放置的extension
 * @param {PlanedEntries} planedEntries 已放置的entry
 * @param {number} blockX 
 * @param {number} blockY 
 * @param {number} blockCost 
 */
function testSquare(x, y, costMat, planedExtensions, planedEntries, blockX = undefined, blockY = undefined, blockCost = undefined) {
    let num = 0, nearest = { cost: config.maxExtensionDistance + 1, x: 0, y: 0 }, hasEntry = false;
    let extPos = [];
    let edgeEntry, centralEntry, ext;
    for (let i = x - 1; i <= x + 1; i++) {
        for (let j = y - 1; j <= y + 1; j++) {
            if (i == x && j == y) {                 // 中心点
                if (j in planedExtensions[i]) {     // 如果有extension则要移除 
                    num--;
                    if (!hasEntry) {
                        hasEntry = true;
                        centralEntry = { x: i, y: j };  // 自身点
                        ext = planedExtensions[i][j];
                        edgeEntry = planedEntries[ext.eX][ext.eY];
                    }
                }
            } else if (i != blockX || j != blockY) {// 边缘点且不是square32中被挡那块
                if (!hasEntry) {                    // 还没找到entry
                    if (j in planedEntries[i]) {    // 这个点是别人的entry 
                        hasEntry = true;
                        centralEntry = { x, y };
                        edgeEntry = planedEntries[i][j];
                        continue;
                    } else if (costMat[i][j] < nearest.cost) {  // 找离storage最近的点准备作为entry
                        nearest.cost = costMat[i][j];
                        nearest.x = i;
                        nearest.y = j;
                    }
                }
                if (!(j in planedExtensions[i]) && !(j in planedEntries[i])) { // 这个点没人用过
                    extPos.push({ x: i, y: j, eX: x, eY: y });  // 自身点，entry点
                    num++;
                }
            } else if (blockCost == 1) {            // 
                hasEntry = true;
                centralEntry = { x, y };
                edgeEntry = { x: i, y: j, isHead: true };
            }
        }
    }
    if (!hasEntry) {    // 周围8个点没有共用之前的entry，需要开一个口
        centralEntry = { x, y };
        if (nearest.y in planedExtensions[nearest.x]) {
            ext = planedExtensions[nearest.x][nearest.y];
            let cEntry = planedEntries[ext.eX][ext.eY];
            if ('parentEntryX' in cEntry && isNear(cEntry.parentEntryX, cEntry.parentEntryY, nearest.x, nearest.y)) {
                edgeEntry = { x: nearest.x, y: nearest.y, parentEntryX: cEntry.parentEntryX, parentEntryY: cEntry.parentEntryY };
            } else {
                edgeEntry = { x: nearest.x, y: nearest.y, parentEntryX: ext.eX, parentEntryY: ext.eY };
            }
        } else {
            edgeEntry = { x: nearest.x, y: nearest.y, isHead: true };
        }
        num--;
    }
    return {
        num,
        extensionPos: extPos,
        centralEntry,
        edgeEntry,
        isNewBranch: edgeEntry.isHead
    };
}

/**
 * 
 * @param {SingleExtension[]} extPos
 * @param {TailEntry} cEntry
 * @param {SingleEntry} eEntry
 * @param {PlanedExtensions} planedExtensions 
 * @param {PlanedEntries} planedEntries 
 */
function updatePlan(extPos, cEntry, eEntry, planedExtensions, planedEntries) {
    let num = 0;
    // cEntry
    if (cEntry.y in planedExtensions[cEntry.x]) {
        delete planedExtensions[cEntry.x][cEntry.y];
        num--;
    }
    cEntry.parentEntryX = eEntry.x;
    cEntry.parentEntryY = eEntry.y;
    cEntry.children = [];
    planedEntries[cEntry.x][cEntry.y] = cEntry;
    // eEntry
    if (eEntry.y in planedExtensions[eEntry.x]) {
        delete planedExtensions[eEntry.x][eEntry.y];
        num--;
    }
    if (!(eEntry.y in planedEntries[eEntry.x])) {
        eEntry.children = [cEntry];
        planedEntries[eEntry.x][eEntry.y] = eEntry;
        if (!eEntry.isHead) {
            planedEntries[eEntry.parentEntryX][eEntry.parentEntryY].children.push(eEntry);
        }
    } else {
        eEntry.children.push(cEntry);
    }
    // extPos
    for (let pos of extPos) {
        if (!(pos.y in planedEntries[pos.x])) {
            planedExtensions[pos.x][pos.y] = pos;
            num++;
        }
    }
    return num;
}

function prune(center, planedExtensions, planedEntries, overflowNum) {
    let centralEntry = planedEntries[center.x][center.y], num = 0, closerExtensions = [];
    for (let x = center.x - 1; x <= center.x + 1; x++) {
        for (let y = center.y - 1; y <= center.y + 1; y++) {
            if (y in planedExtensions[x]) {
                if (!isNear(x, y, centralEntry.parentEntryX, centralEntry.parentEntryY)) {
                    delete planedExtensions[x][y];
                    num++;
                    if (num >= overflowNum) {
                        return num;
                    }
                } else {
                    closerExtensions.push({ x, y });
                }
            }
        }
    }
    if (num < overflowNum) {
        for (let { x, y } of closerExtensions) {
            delete planedExtensions[x][y];
            num++;
            if (num >= overflowNum) {
                break;
            }
        }
    }
    return num;
}

function placeExtensions(squares, costMat, planedExtensions, planedEntries, leftNum, acceptThreshold, reviewThreshold) {
    let newExtNum = 0, cost = 0, newBranches = [];
    for (let expectNum = 7; expectNum >= 0; expectNum--) {
        if (expectNum >= acceptThreshold) {
            for (let pos of squares[expectNum]) {
                let { num, extensionPos, centralEntry, edgeEntry, isNewBranch } = testSquare(pos.x, pos.y, costMat, planedExtensions, planedEntries, pos.blockX, pos.blockY, pos.blockCost);
                //console.log(JSON.stringify(pos), ':', num);
                if (num == expectNum) {
                    num = updatePlan(extensionPos, centralEntry, edgeEntry, planedExtensions, planedEntries);
                    cost += num * costMat[pos.x][pos.y];
                    newExtNum += num;
                    if (isNewBranch) {
                        edgeEntry.cost = costMat[pos.x][pos.y] - 1;
                        newBranches.push(edgeEntry);
                    }
                    if (newExtNum >= leftNum) {
                        if (newExtNum > leftNum) {
                            let pruned = prune(pos, planedExtensions, planedEntries, newExtNum - leftNum);
                            cost -= pruned * costMat[pos.x][pos.y];
                            newExtNum -= pruned;
                        }
                        return { newExtNum, newBranches, cost };
                    }
                } else if (num >= reviewThreshold) {
                    squares[num].push(pos);
                }
            }
        }
        squares[expectNum].length = 0;
    }
    return { newExtNum, newBranches, cost };
}

/**
 * 
 * @return {{newExtNum: number, newBranches: {x:number, y:number, ...}[], cost:number}}
 */
function placeSquares(square33, square32, costMat, planedExtensions, planedEntries, leftNum, acceptThreshold, reviewThreshold) {
    let { newExtNum, newBranches, cost } = placeExtensions(square33, costMat, planedExtensions, planedEntries, leftNum, acceptThreshold, reviewThreshold);
    if (newExtNum < leftNum) {
        let result = placeExtensions(square32, costMat, planedExtensions, planedEntries, leftNum - newExtNum, acceptThreshold, reviewThreshold);
        newExtNum += result.newExtNum;
        newBranches.push(...result.newBranches);
        cost += result.cost;
    }
    // console.log(`place squares: ${cost}`);
    return { newExtNum, newBranches, cost };
}

function addSquare(pos, square33, square32, map, costMat, layoutCost, planedExtensions, planedEntries) {
    let px = pos.x, py = pos.y;
    if (map[px + 1][py + 1] >= 3) { // map[2~49], px=1~48
        square33[testSquare(px, py, costMat, planedExtensions, planedEntries).num].push(pos);
    } else if ((map[px][py] >= 2 ? 1 : 0) + (map[px + 1][py] >= 2 ? 1 : 0) + (map[px][py + 1] >= 2 ? 1 : 0) + (map[px + 1][py + 1] >= 2 ? 1 : 0) == 3) {
        if (map[px][py] < 2) {  // 左上角被挡
            pos.blockX = px - 1;
            pos.blockY = py - 1;
            pos.blockCost = layoutCost[px - 1][py - 1] || 255;
        } else if (map[px + 1][py] < 2) { // 右上角被挡
            pos.blockX = pos.x + 1;
            pos.blockY = pos.y - 1;
            pos.blockCost = layoutCost[px + 1][py - 1] || 255;
        } else if (map[px][py + 1] < 2) {
            pos.blockX = pos.x - 1;
            pos.blockY = pos.y + 1;
            pos.blockCost = layoutCost[px - 1][py + 1] || 255;
        } else {
            pos.blockX = pos.x + 1;
            pos.blockY = pos.y + 1;
            pos.blockCost = layoutCost[px + 1][py + 1] || 255;
        }
        square32[testSquare(px, py, costMat, planedExtensions, planedEntries, pos.blockX, pos.blockY, pos.blockCost).num].push(pos);
    }
}

/**
 *  planedExtensions = {[x]:{[y]:extension}}   
 *  extension = {x:entry.x, y:entry.y}   
 *  planedEntries = {[x]:{[y]:entry}}   
 *  entry = {x, y, isHead?:bool, parentEntryX?:number, parentEntryY?:number}  
 *  entryRoots = {[x]:{[y]:1}}   
 *  square33: 3*3空地，索引是能额外摆放的extension数    
 *  square32：3个2*2空地，索引是能额外摆放的extension数，适应崎岖地形   
 * @param {{[x:number]:{[y:number]:number}}} map 
 * @param {*} terrain 
 */
function calExtensionPos(storagePos, map, terrain, layoutCost, acceptThreshold, reviewThreshold) {
    let { costMat, edgeSet } = initialCost(storagePos, 1, terrain, layoutCost);
    let planedExtensions = getEmptyMat(1, 48), planedEntries = getEmptyMat(1, 48), entryRoots = [];
    let planedExtNum = 0, totalCost = 0, result;
    let square33 = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    let square32 = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    let j50, px, py, cost, prevCost;
    for (let pos of edgeSet) {
        px = pos.x;
        py = pos.y;
        cost = costMat[px][py];
        if (cost != prevCost) {
            //console.log('prevCost:', prevCost, 'square33:', JSON.stringify(square33));
            result = placeSquares(square33, square32, costMat, planedExtensions, planedEntries, MAX_EXTENSIONS - planedExtNum, acceptThreshold, reviewThreshold);
            planedExtNum += result.newExtNum;
            //console.log(`place result: ${JSON.stringify(result)}`);
            totalCost += result.cost;
            if (result.newBranches.length) {
                for (let root of result.newBranches) {
                    entryRoots.push(root);
                }
            }
            if (planedExtNum >= MAX_EXTENSIONS || cost > config.maxExtensionDistance) {
                break;
            }
            prevCost = cost;
        }
        for (let j = py - 1; j <= py + 1; j++) {
            if (j < 1 || j > 48) {
                continue;
            }
            j50 = j * 50;
            for (let i = px - 1; i <= px + 1; i++) {
                if (j in costMat[i] || i < 1 || i > 48 || terrain[j50 + i] & TERRAIN_MASK_WALL || layoutCost[i][j] == 255) {
                    continue;
                }
                edgeSet.push({
                    x: i,
                    y: j
                });
                costMat[i][j] = cost + 1;
            }
        }
        addSquare(pos, square33, square32, map, costMat, layoutCost, planedExtensions, planedEntries);
    }
    return {
        extensionPos: planedExtensions,
        roadPos: planedEntries,
        num: planedExtNum,
        entryRoots,
        totalCost
    };
}

/**
 * 
 * @param {{bestAnchor3x3: Anchor, bestAnchor2x2: Anchor, bestAnchor4x4: Anchor}} bestAnchors 
 * @param {Uint8Array} terrain 
 * @param {CostMat} map
 * @param {{[type: string]: {x:number, y:number}[]}} layout 
 * @param {CostMat} layoutCost 
 * @param {{x:number, y:number}[]} additionalRoads 
 * @param {number} acceptThreshold 
 * @param {number} reviewThreshold 
 */
function getExtentions(bestAnchors, terrain, map, layout, layoutCost, additionalRoads, acceptThreshold, reviewThreshold) {
    //for (idx = 3; idx == idx; idx++) {
    updateMap(map, bestAnchors, additionalRoads);
    let storagePos = { x: layout[STRUCTURE_STORAGE][0].x, y: layout[STRUCTURE_STORAGE][0].y };
    let result = calExtensionPos(storagePos, map, terrain, layoutCost, acceptThreshold, reviewThreshold);
    //console.log(JSON.stringify(extensionPos));
    console.log(`finally cost:${result.totalCost}, num: ${result.num}`);
    return {
        extensionPos: result.extensionPos,
        roadPos: result.roadPos,
        entryRoots: result.entryRoots,
        num: result.num
    };

}

/**
 * 1. src 和 mineral 相邻空地、controller range2 空地设为与 swamp 相同代价;  
 * 2. 核心区不可穿过建筑设 255，路 1；
 * 3. 已经摆下的 ext 的路设 1，已经摆下的 ext 本身设为 8（swamp 2倍）；
 * 4. exitGroups 中 1、2、3、4 的格子在上述基础上加 4。
 * 
 * @param {CostMat} layoutCost 
 * @param {CostMat} roadPos 
 * @param {CostMat} extensionPos 
 * @param {ExitGroups} exitGroups 
 * @param {CostMat} roads 
 * @param {ClaimableRoom} room 
 * @returns 
 */
function initPfCostMat(layoutCost, roadPos, extensionPos, exitGroups, roads, room) {
    let pfCostMat = new PathFinder.CostMatrix, terrain = (room.getTerrain() as any).getRawBuffer();

    // controller 周围 range 2 内空地设为 4，与 swamp 相同代价
    let px, py;
    for (let x = -2, cpx = room.controller.pos.x, cpy = room.controller.pos.y; x <= 2; x++) {
        for (let y = -2; y <= 2; y++) {
            px = x + cpx, py = y + cpy;
            if (!(terrain[py * 50 + px] & TERRAIN_MASK_WALL)) {
                pfCostMat.set(px, py, 4);
            }
        }
    }
    // mineral 周围 range 1 内空地设为 4，与 swamp 相同代价
    if (room.mineral) {
        for (let x = -1, cpx = room.mineral.pos.x, cpy = room.mineral.pos.y; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                px = x + cpx, py = y + cpy;
                if (!(terrain[py * 50 + px] & TERRAIN_MASK_WALL)) {
                    pfCostMat.set(px, py, 4);
                }
            }
        }
    }
    // source 周围 range 1 内空地设为 4，与 swamp 相同代价
    for (let src of room.source) {
        for (let x = -1, cpx = src.pos.x, cpy = src.pos.y; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                px = x + cpx, py = y + cpy;
                if (!(terrain[py * 50 + px] & TERRAIN_MASK_WALL)) {
                    pfCostMat.set(px, py, 4);
                }
            }
        }
    }
    for (let x in layoutCost) {
        for (let y in layoutCost[x]) {
            if (layoutCost[x][y] == 1) {
                roads[x][y] = 1;
                pfCostMat.set(+x, +y, 1);
            } else {
                pfCostMat.set(+x, +y, 255);
            }
        }
    }
    for (let x in roadPos) {
        for (let y in roadPos[x]) {
            roads[x][y] = 1;
            pfCostMat.set(+x, +y, 1);
        }
    }
    for (let x in extensionPos) {
        for (let y in extensionPos[x]) {
            pfCostMat.set(+x, +y, EXTENSION_COST);
        }
    }
    for (let dist = 1; dist < 5; dist++) {
        for (let exitType in exitGroups[dist]) {
            for (let group of exitGroups[dist][exitType]) {
                for (let pos of group) {
                    pfCostMat.set(pos.x, pos.y, pfCostMat.get(pos.x, pos.y) + EXIT_PATHFINDER_COST);
                }
            }
        }
    }
    return pfCostMat;
}

/**
 * 
 * @param {RoomPosition} pos 
 * @param {any[]} goals 
 */
function removeGoal(pos, goals) {
    let goal, removedGoals = [];
    for (let idx = goals.length - 1; idx >= 0; idx--) {
        goal = goals[idx];
        if (isNear(pos.x, pos.y, goal.pos.x, goal.pos.y)) {
            goals.splice(idx, 1);
            removedGoals.push(goal);
        }
    }
    return removedGoals;     // src、mineral、controller 用
}

/**
 * 会铺路，把头 NUM_EXT_FOR_SPAWN 个 goals 路附近的 ext 改 spawn
 * 
 * @param {*} start 
 * @param {*} goals 
 * @param {CostMatrix} pfCostMat 
 * @param {CostMat} roads 
 * @param {CostMat} extensionPos 
 * @param {*} layout
 * @param {CostMat} layoutCost 
 * @param {number} unplacedSpawn 
 * @param {*} rv 
 * @returns 
 */
function findAllGoals(start, goals, pfCostMat, roads, extensionPos, layout, layoutCost, unplacedSpawn) {
    let removedPosList = [], result, path, px, py;
    /**@type {{[posStr:string]:RoomPosition}} */
    let goalNearestPos = {}, removedGoals, nearestPos;

    /**@type {PathFinderOpts} */
    let pfOpts = {
        maxRooms: 1,
        plainCost: 2,
        swampCost: 4,
        roomCallback: () => pfCostMat
    }
    while (goals.length) {
        result = PathFinder.search(start, goals, pfOpts);
        if (result.incomplete) {
            console.log(`Error: cannot find path to goals ${JSON.stringify(goals)}`);
            break;
        }
        path = result.path;
        nearestPos = path.length ? path.pop() : start;
        removedGoals = removeGoal(nearestPos, goals);
        if (removedGoals.length) {
            for (let goal of removedGoals) {
                goalNearestPos[`${goal.pos.x}_${goal.pos.y}`] = nearestPos;
            }
        }
        // 每找到一个，就铺路，最近的一个 ext 改 spawn
        let placed = false;
        for (let pos of path) {
            px = pos.x;
            py = pos.y;
            roads[px][py] = 1;      // 铺路
            pfCostMat.set(px, py, 1);   // 铺了路以后的地方，移动开销为 1
            if (py in extensionPos[px]) {
                delete extensionPos[px][py];
                pfCostMat.set(px, py, 1);
                removedPosList.push(pos);
            }
            // 尝试找最近的一个，改成 spawn
            if (unplacedSpawn) {
                for (let i = -1; i <= 1; i++) {
                    for (let j = -1; j <= 1; j++) {
                        if (py + j in extensionPos[px + i]) {
                            delete extensionPos[px + i][py + j];
                            layout[STRUCTURE_SPAWN].push({ x: px + i, y: py + j });
                            layoutCost[px + i][py + j] = 255;
                            placed = true;
                            unplacedSpawn--;
                            break;
                        }
                    }
                    if (placed) break;
                }
            }
        }
    }
    return { removedPosList, goalNearestPos, unplacedSpawn };
}

/**
 * 
 * @param {*} start 
 * @param {*} goals 
 * @param {*} pfCostMat 
 * @param {*} roads 
 * @param {*} extensionPos 
 * @param {*} layoutCost 
 * @param {*} exitMaps 
 * @param {CostMat} towerCandidateMat 
 * @param {*} rv 
 * @returns 
 */
function findRoadToRamp(start, goals, pfCostMat, roads, extensionPos, layoutCost, exitMaps) {
    /**@type {RoomPosition[]} */
    let removedPosList = [], result, path, px, py, canReach, towerCandidatePosList = [];
    /**@type {PathFinderOpts} */
    let pfOpts = {
        maxRooms: 1,
        plainCost: 2,
        swampCost: 4,
        roomCallback: () => pfCostMat
    }
    result = PathFinder.search(start, goals, pfOpts);
    if (result.incomplete) {
        canReach = false;
        return { removedPosList, canReach, towerCandidatePosList };
    }
    path = result.path;
    for (let idx = 0; idx < path.length; idx++) {
        let pos = path[idx];
        px = pos.x;
        py = pos.y;
        pfCostMat.set(px, py, 1);   // 铺了路以后的地方，移动开销为 1
        if (pos.y in extensionPos[pos.x]) {     // 这里越界会报undefined
            delete extensionPos[px][py];
            pfCostMat.set(px, py, 1);
            removedPosList.push(pos);
        }
        if (!(py in exitMaps[3][px] || py in exitMaps[4][px] || py in exitMaps[2][px])) {
            roads[px][py] = 1;
            if (py in exitMaps[5][px] || py in exitMaps[6][px]) {
                let curCandidate = [];
                for (let x = px - 1; x <= px + 1; x++) {
                    for (let y = py - 1; y <= py + 1; y++) {
                        if (y in exitMaps[5][x]) {
                            curCandidate.push({ x, y, dist: 5 });
                        } else if (y in exitMaps[6][x]) {
                            curCandidate.push({ x, y, dist: 6 });
                        }
                    }
                }
                curCandidate.sort((a, b) => a.dist - b.dist);
                towerCandidatePosList.push(...curCandidate);
            }
        }
    }
    canReach = true;
    return { removedPosList, canReach, towerCandidatePosList };
}

/**
 * TODO: 
 * 遍历 src 和 mineral 周围 range 1 的空地，找代价最小的作为工位；
 * 遍历 controller 周围 range 2 的空地，找代价最小的作为工位；
 * 
 * pos 代价考虑因素：
 * 1. pos 上已建了路，代价大（会频繁被 swap）；
 * 1. pos 上已有 ramp (dist==2)，代价略小；
 * 2. pos 离对应的 goalNearestPos 越远，代价越大；
 * 3. pos 本身在 exitGroups dist 1、3、4内，可能被攻击，代价大；
 * 2. src、controller 需要 link（exitGroups dist 1 无法建造）：
 *   2.1. pos 周围没有不建路的空地，有 ext，代价大，必要时可以 remove ext；
 *   2.2. pos 周围没有不建路的空地，也没有 ext，代价很大；
 *   2.3. pos 周围可选建 link 的位置都在 exitGroups dist 3、4内，代价大；
 *   2.4. pos 周围可选建 link 的位置都在 dist 2 ramp 上，代价略小；
 * 
 * 
 * @param {ClaimableRoom} room 
 * @param {(Source|StructureController|Mineral<MineralConstant>)[]} goalObjects
 * @param {{[posStr:string]:RoomPosition}} goalNearestPos 是离 storage 路程最短的候选工位
 * @param {CostMatrix} pfCostMat 是 pf 计算的代价矩阵
 * @param {CostMat} extensionPos 是所有 extension 的位置
 * @param {CostMat} roads 是所有 road 的位置
 * @param {{[dist:number]:CostMat}} exitMaps 
 * @param {{[type:string]:{x:number, y:number}[]}} layout 
 * @param {CostMat} layoutCost 
 */
function placeLinkAndContainer(room, goalObjects, goalNearestPos, pfCostMat, roads, extensionPos, exitMaps, layout, layoutCost) {
    /**@type {RoomPosition[]} */
    let removedPosList = [], terrain = (room.getTerrain() as any).getRawBuffer();
    let mineralWorkPos, controllerWorkPos, sourceWorkPosList = [];
    let centralLinkPos = layout[STRUCTURE_LINK][0];
    layout[STRUCTURE_CONTAINER] = layout[STRUCTURE_CONTAINER] || [];
    layout[STRUCTURE_RAMPART] = layout[STRUCTURE_RAMPART] || [];
    layout[WORK_POS] = [];
    for (let goal of goalObjects) {
        let goalPos = goal.pos;
        let nearestPos = goalNearestPos[`${goalPos.x}_${goalPos.y}`], y50;
        let nearestRange = Math.max(Math.abs(centralLinkPos.x - nearestPos.x), Math.abs(centralLinkPos.y - nearestPos.y));
        //@ts-ignore
        if (goal.mineralType) {
            // it's a Mineral，不用 link 只找 pos
            let curCost, bestPos, bestCost = 999;
            for (let y = goalPos.y - 1; y <= goalPos.y + 1; y++) {
                y50 = y * 50;
                for (let x = goalPos.x - 1; x <= goalPos.x + 1; x++) {
                    curCost = 500;
                    // 是墙，不可用
                    if (terrain[x + y50] & TERRAIN_MASK_WALL) {
                        continue;
                    }

                    // 已经有 extension，代价大，可以考虑
                    if (y in extensionPos[x]) {
                        curCost += 4;
                        // 已经有其他建筑，pos 不可用
                    } else if (pfCostMat.get(x, y) == 255 || layoutCost[x][y] == 255) {
                        continue;
                    }

                    // 寻路到 nearestPos 代价
                    let pfOpts = {
                        maxRooms: 1,
                        plainCost: 2,
                        swampCost: 4,
                        roomCallback: () => pfCostMat
                    }
                    let result = PathFinder.search(new RoomPosition(x, y, room.name), nearestPos, pfOpts);
                    if (result.incomplete) {    //  到不了的位置，不考虑
                        curCost = 999;
                        continue;
                    } else {
                        curCost += result.path.length;
                    }

                    // 有路
                    if (layoutCost[x][y] == 1 || y in roads[x]) {
                        curCost += 8;  // 即使有 ramp 也比造在 ext 上差
                    }

                    // 有 ramp
                    if (y in exitMaps[2][x]) {
                        curCost -= 2;
                        // 其他可被攻击的无 ramp 位置
                    } else if (y in exitMaps[3][x] || y in exitMaps[4][x]) {
                        curCost += 5;   // 比 ext 大一点
                        // 可被攻击且无法造 ramp，位置巨差
                    } else if (y in exitMaps[1][x]) {
                        curCost += 12;
                        // 离门口近，代价略微高，因为以后有 pc Commander 了会被攻击
                    } else if (y in exitMaps[5][x]) {
                        curCost += 3;
                    }

                    if (curCost < bestCost) {
                        bestPos = { x, y };
                        bestCost = curCost;
                    }
                }
            }
            if (bestPos) {
                layout[STRUCTURE_CONTAINER].push(bestPos);
                mineralWorkPos = bestPos;
                layout[WORK_POS].push(bestPos);
                layoutCost[bestPos.x][bestPos.y] = 255;     // 用 255 表示已用
                if (bestPos.y in exitMaps[3][bestPos.x] || bestPos.y in exitMaps[4][bestPos.x]) {
                    layout[STRUCTURE_RAMPART].push(bestPos);
                }
                if (bestPos.y in extensionPos[bestPos.x]) {
                    delete extensionPos[bestPos.x][bestPos.y];
                    removedPosList.push(bestPos);
                }
            }

            //@ts-ignore
        } else {
            // it's a Controller or Source
            // 这是 Controller，周围 range 2 以内都可以作为工位
            let range = goal.progressTotal ? 2 : 1;
            let curCost, bestPos, bestLinkPos, bestCost = 999;
            for (let y = goalPos.y - range; y <= goalPos.y + range; y++) {
                y50 = y * 50;
                for (let x = goalPos.x - range; x <= goalPos.x + range; x++) {
                    curCost = 500;
                    // 是墙，不可用
                    if (terrain[x + y50] & TERRAIN_MASK_WALL) {
                        continue;
                    }

                    // 已经有 extension，代价大，可以考虑
                    if (y in extensionPos[x]) {
                        curCost += 4;
                        // 已经有其他建筑，pos 不可用
                    } else if (pfCostMat.get(x, y) == 255 || layoutCost[x][y] == 255) {
                        continue;
                    }

                    // 寻路到 nearestPos 代价
                    let pfOpts = {
                        maxRooms: 1,
                        plainCost: 2,
                        swampCost: 4,
                        roomCallback: () => pfCostMat
                    }
                    let result = PathFinder.search(new RoomPosition(x, y, room.name), nearestPos, pfOpts);
                    if (result.incomplete) {    //  到不了的位置，不考虑
                        curCost = 999;
                        continue;
                    } else {
                        curCost += result.path.length;
                    }

                    // 有路
                    if (layoutCost[x][y] == 1 || y in roads[x]) {
                        curCost += 8;  // 即使有 ramp 也比造在 ext 上差
                    }

                    // 有 ramp
                    if (y in exitMaps[2][x]) {
                        curCost -= 2;
                        // 其他可被攻击的无 ramp 位置
                    } else if (y in exitMaps[3][x] || y in exitMaps[4][x]) {
                        curCost += 5;   // 比 ext 大一点
                        // 可被攻击且无法造 ramp，位置巨差
                    } else if (y in exitMaps[1][x]) {
                        curCost += 12;
                        // 离门口近，代价略微高，因为以后有 pc Commander 了会被攻击
                    } else if (y in exitMaps[5][x]) {
                        curCost += 3;
                    }

                    // 找 link 位置
                    let linkPos = undefined, curLinkCost, bestLinkCost = nearestRange + 15, linkY50;
                    for (let linkY = y - 1; linkY <= y + 1; linkY++) {
                        linkY50 = linkY * 50;
                        for (let linkX = x - 1; linkX <= x + 1; linkX++) {
                            curLinkCost = 0;
                            // 有墙，不能建 link
                            if (terrain[linkX + linkY50] & TERRAIN_MASK_WALL) {
                                continue;
                            }
                            // 工位 pos 不能建 link
                            if (linkX == x && linkY == y) {
                                continue;
                            }
                            // 有路，不能建 link
                            if (layoutCost[linkX][linkY] == 1 || linkY in roads[linkX]) {
                                continue;
                            }
                            // 有 link，共用
                            if (layout[STRUCTURE_LINK].some(p => p.x == linkX && p.y == linkY)) {
                                curLinkCost = -6;
                                linkPos = { x: linkX, y: linkY };
                                bestLinkCost = curLinkCost;
                                continue
                            }

                            // 已经有 extension，代价大，可以考虑
                            if (linkY in extensionPos[linkX]) {
                                curLinkCost += 4;
                            }
                            // 已经有其他建筑，pos 不可用
                            else if (pfCostMat.get(linkX, linkY) == 255 || layoutCost[linkX][linkY] == 255) {
                                continue;
                            }

                            // 出口的影响
                            if (linkY in exitMaps[1][linkX]) {
                                // 无法造
                                continue;
                                // 离门口近，代价略微高，因为以后有 pc Commander 了会被攻击
                            } else if (linkY in exitMaps[2][linkX]) {
                                // 有 ramp
                                curLinkCost -= 2;
                            } else if (linkY in exitMaps[3][linkX] || linkY in exitMaps[4][linkX]) {
                                // 其他可被攻击的无 ramp 位置
                                curLinkCost += 5;   // 比 ext 大一点
                            } else if (linkY in exitMaps[5][linkX]) {
                                curLinkCost += 3;
                            }

                            // 与中央距离的影响
                            curLinkCost += Math.max(Math.abs(linkX - centralLinkPos.x), Math.abs(linkY - centralLinkPos.y));

                            if (curLinkCost < bestLinkCost) {
                                linkPos = { x: linkX, y: linkY };
                                bestLinkCost = curLinkCost;
                            }

                        }
                    }
                    curCost += bestLinkCost;
                    if (curCost < bestCost) {
                        bestPos = { x, y };
                        bestCost = curCost;
                        bestLinkPos = linkPos;
                    }
                }
            }
            if (bestPos) {
                if (bestLinkPos) {
                    layout[STRUCTURE_LINK].push(bestLinkPos);
                    layoutCost[bestLinkPos.x][bestLinkPos.y] = 255;     // 用 255 表示已用

                    if (bestLinkPos.y in exitMaps[3][bestLinkPos.x] || bestLinkPos.y in exitMaps[4][bestLinkPos.x]) {
                        layout[STRUCTURE_RAMPART].push(bestLinkPos);
                    }
                    if (bestLinkPos.y in extensionPos[bestLinkPos.x]) {
                        delete extensionPos[bestLinkPos.x][bestLinkPos.y];
                        removedPosList.push(bestLinkPos);
                    }
                } else {
                    layout[STRUCTURE_CONTAINER].push(bestPos);      // 没有 link 时，container 位置造在工位脚下
                }

                layout[WORK_POS].push(bestPos);
                if (bestPos.y in exitMaps[3][bestPos.x] || bestPos.y in exitMaps[4][bestPos.x]) {
                    layout[STRUCTURE_RAMPART].push(bestPos);
                }
                if (bestPos.y in extensionPos[bestPos.x]) {
                    delete extensionPos[bestPos.x][bestPos.y];
                    removedPosList.push(bestPos);
                }
                goal.progressTotal ? controllerWorkPos = bestPos : sourceWorkPosList.push(bestPos);
                layoutCost[bestPos.x][bestPos.y] = 255;     // 用 255 表示已用
            }
        }
    }
    return { removedPosList, sourceWorkPosList, controllerWorkPos, mineralWorkPos };
}

/**
 * 根据 exit 宽度摆塔。
 * 
 * 根据 exitWidths 计算每个 exitGroup 需造的塔数，总共 6 塔按 exitWidths 比例分配,
 * 先按各方向的总宽度 total 尽量均匀分配，再按 widthList 在此方向的 group 中分配。
 * 
 * @param {{[type:string]: {total:number, nTowers:number, widthList:{width: number, nTowers:number, towerCandidatePosList:{x:number, y:number}[]}[]}}} exitWidths 
 * @param {*} layout 
 * @param {CostMat} layoutCost 
 * @param {CostMat} roads 
 * @param {CostMat} extensionPos 
 */
function placeTower(exitWidths, layout, layoutCost, roads, extensionPos) {
    // exitWidths 当作一个 list 按 total 从大到小排序
    let exitWidthsList = [], removedPosList = [];
    for (let exitType in exitWidths) {
        exitWidthsList.push(exitWidths[exitType]);
    }
    exitWidthsList.sort((a, b) => b.widthList.length - a.widthList.length);
    // 计算每个 exitGroup 需造的塔数，总共 6 塔按 exitWidths 比例分配
    let towerNum = 6;
    while (towerNum) {
        for (let exitWidths of exitWidthsList) {
            exitWidths.nTowers += 1;
            towerNum -= 1;
            if (!towerNum) break;
        }
    }
    layout[STRUCTURE_TOWER] = [];   // 准备造塔
    for (let exitWidths of exitWidthsList) {
        if (exitWidths.nTowers) {
            let widthList = exitWidths.widthList.sort((a, b) => b.width - a.width), nTowers = exitWidths.nTowers;
            while (nTowers) {
                for (let group of widthList) {
                    group.nTowers += 1;
                    nTowers -= 1;
                    if (!nTowers) break;
                }
            }

            // 
            for (let group of widthList) {
                nTowers = group.nTowers;
                if (!nTowers) {
                    break;
                }
                let candidatePosOnExt = [], x, y;
                for (let pos of group.towerCandidatePosList.reverse()) {
                    x = pos.x, y = pos.y;
                    if (pos.y in extensionPos[pos.x]) {
                        candidatePosOnExt.push(pos);
                    } else if (pos.y in layoutCost[pos.x] || y in roads[x]) {
                        continue;
                    } else {    // 空地可以直接摆塔
                        layout[STRUCTURE_TOWER].push(pos);
                        layoutCost[x][y] = 255;
                        nTowers--;
                    }
                    if (!nTowers) break;
                }
                if (nTowers && candidatePosOnExt.length) {
                    for (let pos of candidatePosOnExt) {
                        removedPosList.push(pos);
                        layout[STRUCTURE_TOWER].push(pos);
                        layoutCost[pos.x][pos.y] = 255;
                        nTowers--;
                        delete extensionPos[pos.x][pos.y];
                        if (!nTowers) break;
                    }
                }
            }
        }
    }
    return removedPosList;
}

/**
 * 功能（不考虑外矿）：   
 * 1. 往 src、mineral、controller 铺路，移除挡路的 ext，记录移除的数量和位置；
 * 2. 往 exit rampart 铺路，移除挡路 ext 并记录，并根据铺路情况决定是否要造这块 ramp；
 * 3. 根据铺路情况决定 src、mineral、controller 的工作 creep 站位（工位）和对应的 link/container；
 * 4. 根据保留的 ramp 修塔。
 * 
 * @param {ClaimableRoom} room 
 * @param {{x:number, y:number}[]} entryRoots
 */
function placeRoadsAndLinkAndRampartAndTower(room, start, layout, layoutCost, extensionPos, roadPos, entryRoots, exitGroups, exitMaps) {
    let pfCostMat = new PathFinder.CostMatrix, roads = getEmptyMat(1, 48), rampPos = getEmptyMat(1, 48);
    let removedExt = getEmptyMat(2, 47), removedNum = 0;
    /**
     * src 和 mineral 相邻空地、controller range2 空地设为与 swamp 相同代价
     */
    pfCostMat = initPfCostMat(layoutCost, roadPos, extensionPos, exitGroups, roads, room);

    // 首先考虑所有 ext 圈，必须都能进入
    let goals = entryRoots.map(root => ({ pos: new RoomPosition(root.x, root.y, room.name), range: 0 }));
    //console.log('start:', JSON.stringify(start));
    var { removedPosList } = findAllGoals(start, goals, pfCostMat, roads, extensionPos, layout, layoutCost, 0);
    removedNum += removedPosList.length;
    for (let pos of removedPosList) {
        removedExt[pos.x][pos.y] = 1
    }

    // 然后考虑所有 src、controller、mineral，必须都能抵达
    let goalObjects = room.source;
    goalObjects.push(room.controller);
    if (room.mineral) {
        goalObjects.push(room.mineral);
    }
    goals = goalObjects.map(o => ({ pos: o.pos, range: 1 }));
    // console.log('find road to 资源点');
    var { removedPosList, goalNearestPos, unplacedSpawn } = findAllGoals(start, goals, pfCostMat, roads, extensionPos, layout, layoutCost, NUM_EXT_FOR_SPAWN);
    removedNum += removedPosList.length;
    for (let pos of removedPosList) {
        removedExt[pos.x][pos.y] = 1
    }

    // 如果 unplacedSpawn>0，找近的 ext 设为 spawn。此处兜底保障 spawn 造够3个
    while (unplacedSpawn > 0) {
        let placed = false;
        for (let root of entryRoots) {
            for (let x = root.x - 1; x <= root.x + 1; x++) {
                for (let y = root.y - 1; y <= root.y + 1; y++) {
                    if (y in extensionPos[x]) {
                        delete extensionPos[x][y];
                        layout[STRUCTURE_SPAWN].push({ x: x, y: y });
                        layoutCost[x][y] = 255;
                        placed = true;
                        unplacedSpawn--;
                        break;
                    }
                }
                if (placed) break;
            }
        }
    }

    /**@type {{[type:string]: {total:number, nTowers:number, widthList:{width: number, nTowers:number, towerCandidatePosList:{x:number, y:number}[]}[]}}} */
    let exitWidths = {};
    // 设置 exitGroups dist==1 的格子，如果没有为 src、mineral、controller 铺过路则为墙
    for (let exitType in exitGroups[1]) {
        for (let group of exitGroups[1][exitType]) {
            for (let pos of group) {
                // 如果铺过路，cost 会被更改为 1，不再是 EXIT_PATHFINDER_COST
                if (pfCostMat.get(pos.x, pos.y) >= EXIT_PATHFINDER_COST) {
                    pfCostMat.set(pos.x, pos.y, 255);
                }
            }
        }
    }
    // 最后考虑所有 dist == 2 的 exitGroup，必须都能抵达，除非必须经过没铺路的 dist ==1
    for (let exitType in exitGroups[2]) {
        exitWidths[exitType] = { total: 0, nTowers: 0, widthList: [] };
        for (let group of exitGroups[2][exitType]) {
            if (group.length) {
                let exitPos = group[Math.floor(group.length / 2)]
                goals = [{ pos: new RoomPosition(exitPos.x, exitPos.y, room.name), range: 0 }];
                // 对于每个 exitGroup，只需要抵达其中任意一格即可
                let { removedPosList, canReach, towerCandidatePosList } = findRoadToRamp(start, goals, pfCostMat, roads, extensionPos, layoutCost, exitMaps);
                if (canReach) {
                    exitWidths[exitType].total += group.length;
                    exitWidths[exitType].widthList.push({ width: group.length, nTowers: 0, towerCandidatePosList: towerCandidatePosList });
                    for (let pos of group) {
                        rampPos[pos.x][pos.y] = 1;
                    }
                    removedNum += removedPosList.length;
                    for (let pos of removedPosList) {
                        removedExt[pos.x][pos.y] = 1
                    }
                }
            }
        }
    }

    // 铺完所有路后，优先摆 link，最后再考虑塔
    var { removedPosList, sourceWorkPosList, controllerWorkPos, mineralWorkPos } = placeLinkAndContainer(room, goalObjects, goalNearestPos, pfCostMat, roads, extensionPos, exitMaps, layout, layoutCost);
    removedNum += removedPosList.length;
    for (let pos of removedPosList) {
        removedExt[pos.x][pos.y] = 1
    }

    // 铺塔
    removedPosList = placeTower(exitWidths, layout, layoutCost, roads, extensionPos);
    removedNum += removedPosList.length;
    for (let pos of removedPosList) {
        removedExt[pos.x][pos.y] = 1
    }

    return { removedNum, removedExt, roads, rampPos };
}

function placeAround(canPlacePos, extensionPos, num) {
    let placedNum = 0;
    for (let i = canPlacePos.length - 1; i >= 0; i--) {
        let { x, y } = canPlacePos.pop();
        extensionPos[x][y] = 1;
        placedNum++;
        if (placedNum >= num) {
            break;
        }
    }
    return placedNum;
}

/**
 * 铺 nuker、被移除的 ext、ob。
 * 会修改 layout(加入 nuker)、extensionPos（加入新 ext）
 * 
 * @param {*} storagePos 
 * @param {*} terrain 
 * @param {*} layout
 * @param {*} layoutCost 
 * @param {*} roads 
 * @param {*} extensionPos 
 * @param {*} entryPos 
 * @param {*} removedExt 
 * @param {*} entryRoots 
 * @param {*} num 
 * @returns 
 */
function placeAlongRoad(storagePos, terrain, layout, layoutCost, roads, extensionPos, entryPos, removedExt, entryRoots, num) {
    let { costMat, edgeSet } = initialCost(storagePos, 1, terrain, layoutCost, extensionPos);
    let px, py, placedNum = 0, cost, parent, canPlacePos = [], obPos, needNuker = true;

    /* for (let x in entryPos) {
        for (let y in entryPos[x]) {
            console.log(JSON.stringify(entryPos[x][y]));
        }
    } */

    for (let pos of edgeSet) {
        px = pos.x, py = pos.y;
        cost = costMat[px][py];
        parent = false;
        canPlacePos.length = 0;
        for (let x = px - 1; x <= px + 1; x++) {
            for (let y = py - 1; y <= py + 1; y++) {
                if (y in roads[x] || (y in layoutCost[x] && layoutCost[x][y] == 1)) {
                    if (!(y in costMat[x])) {
                        costMat[x][y] = cost + 1;
                        edgeSet.push({ x, y });
                    }
                    if (y in entryPos[x]) {
                        if (costMat[x][y] < cost) {
                            parent = entryPos[x][y];
                        }
                    }
                } else if (!(terrain[y * 50 + x] & TERRAIN_MASK_WALL) &&
                    !(y in extensionPos[x]) &&
                    !(y in layoutCost[x]) &&
                    !(y in removedExt[x])) {
                    canPlacePos.push({ x, y });
                }
            }
        }
        // 优先摆 nuker
        if (canPlacePos.length && needNuker) {
            let nukerPos = canPlacePos.pop();
            layout[STRUCTURE_NUKER] = [nukerPos];
            layoutCost[nukerPos.x][nukerPos.y] = 255;
            needNuker = false;
        }
        if (canPlacePos.length) {
            if (placedNum < num) {
                if (py in entryPos[px] || parent) {
                    if (!(py in entryPos[px])) {
                        let newEntry = { x: px, y: py, parentEntryX: parent.x, parentEntryY: parent.y, cost, children: [] };
                        //console.log(`parent ${JSON.stringify(parent)}`);
                        if (parent.children === undefined) {
                            console.log(`no children parent ${JSON.stringify(parent)}`);
                            parent.children = [];
                        }
                        parent.children.push(newEntry);
                        entryPos[px][py] = newEntry;
                    }
                    placedNum += placeAround(canPlacePos, extensionPos, num - placedNum);
                } else if (canPlacePos.length >= 2 || num - placedNum <= canPlacePos.length) {
                    entryPos[px][py] = { x: px, y: py, isHead: true, cost, children: [] };
                    entryRoots.push(entryPos[px][py]);
                    placedNum += placeAround(canPlacePos, extensionPos, num - placedNum);
                }
                if (obPos && obPos.y in extensionPos[obPos.x]) {    // 新摆的ext把之前ob占了
                    obPos = false;
                }
            }
            if (canPlacePos.length && !obPos) {
                obPos = canPlacePos[0];
            }
            if (placedNum >= num && obPos) {
                return { placedNum, obPos };
            }
        }
    }
    return { placedNum, obPos };
    throw new Error(`cannot place all extension and ob: ${placedNum}, ${JSON.stringify(obPos)}`);
}

/**
 * 
 */

/**
 * 
 * @param {ClaimableRoom|string} room 
 * @param {boolean} showPlan 可选参数，显示结果
 * @param {number} acceptThreshold 可选参数，1~7，默认2，控制extension分布
 * @param {number} reviewThreshold 可选参数，1~7，默认3，控制extension分布
 */
function plan(room, acceptThreshold = config.acceptThreshold, reviewThreshold = config.reviewThreshold) {
    if (typeof room == 'string') {
        room = Game.rooms[room];
    }
    if (!(room instanceof Room) || !room.controller) {
        return false;
    }
    room.source = room.source || room.find(FIND_SOURCES);   // 
    room.mineral = room.mineral || room.find(FIND_MINERALS)[0];  // 
    
    let terrain = (room.getTerrain() as any).getRawBuffer();
    // @ts-ignore
    let costMats = getCostMats(room, terrain);      // 获取从每个矿点及 controller 出发的路程图列表

    /*     for (x in costMats[3]) {
            for (y in costMats[3][x]) {
                    opacity: 0.5
                });
            }
        } */

    let { exitGroups, exitMaps } = getExitGroups(terrain);
    // return

    // calSquare 会改变 terrain
    let { map, bestAnchors } = calSquare(room, terrain, exitGroups, costMats);
    if (bestAnchors.bestAnchor3x3 === undefined) {
        console.log('找不到能摆下中央建筑的位置');
        return false;
    }
    let { layout, layoutCost } = placeCentralStructure(bestAnchors);
    let additionalRoads = paveRoadFromStorageToLab(room, layoutCost, layout, bestAnchors.bestAnchor4x4);

    let { extensionPos, entryRoots, roadPos, num } = getExtentions(bestAnchors, terrain, map, layout, layoutCost, additionalRoads,
        acceptThreshold || config.acceptThreshold, reviewThreshold || config.reviewThreshold);
    console.log(`best layout num: ${num}`);

    let storage = layout[STRUCTURE_STORAGE][0];
    let startPos = { x: storage.x, y: storage.y, roomName: room.name };
    let { removedNum, removedExt, roads, rampPos } = placeRoadsAndLinkAndRampartAndTower(room, startPos, layout, layoutCost, extensionPos, roadPos, entryRoots, exitGroups, exitMaps);
    console.log(`removed: ${removedNum}`);

    let { placedNum, obPos } = placeAlongRoad(startPos, terrain, layout, layoutCost, roads, extensionPos, roadPos, removedExt, entryRoots, MAX_EXTENSIONS - num + removedNum);

    /**
     * 在 roads 中而没有在 layout 中的点，加入 layout[STRUCTURE_ROAD]
     */
    for (let x in roads) {
        for (let y in roads[x]) {
            if (layout[STRUCTURE_ROAD].find(p => p.x === +x && p.y === +y)) {
                continue;
            }
            layout[STRUCTURE_ROAD].push({ x: +x, y: +y });
        }
    }

    /**
     * ext 加入 layout[STRUCTURE_EXTENSION]
     */
    layout[STRUCTURE_EXTENSION] = [];
    for (let x in extensionPos) {
        for (let y in extensionPos[x]) {
            layout[STRUCTURE_EXTENSION].push({ x: +x, y: +y });
        }
    }
    console.log(`placed ext: ${layout[STRUCTURE_EXTENSION].length}`);

    /**
     * obPos 加入 layout[STRUCTURE_OBSERVER]
     */
    layout[STRUCTURE_OBSERVER] = [{ x: obPos.x, y: obPos.y }];

    /**
     * rampPos 加入 layout[STRUCTURE_RAMPART]
     */
    layout[STRUCTURE_RAMPART] = [];
    for (let x in rampPos) {
        for (let y in rampPos[x]) {
            layout[STRUCTURE_RAMPART].push({ x: +x, y: +y });
        }
    }

    return layout;
}
const toStructMap = (layout: Record<string, Array<{ x: number; y: number }>>): LayoutStructMap => {
    const map: LayoutStructMap = {};
    for (const [type, list] of Object.entries(layout || {})) {
        if (!Array.isArray(list)) continue;
        map[type] = list.map((p) => [p.x, p.y]);
    }
    return map;
};

const pickCenter = (structMap: LayoutStructMap): { x: number; y: number } | null => {
    const storage = structMap['storage']?.[0];
    if (storage) return { x: storage[0], y: storage[1] };
    const spawn = structMap['spawn']?.[0];
    if (spawn) return { x: spawn[0], y: spawn[1] };
    return null;
};

export const scorpiorPlanner = {
    name: 'scorpior',
    ManagerPlanner: {
        computeManor(roomName: string) {
            const layout = plan(roomName);
            if (!layout) return null;
            const structMap = toStructMap(layout);
            const centerPos = pickCenter(structMap);
            return {
                roomName,
                structMap,
                centerPos: centerPos || { x: 25, y: 25 }
            };
        }
    }
};

