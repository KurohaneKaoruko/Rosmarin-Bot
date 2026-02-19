import { minCut, getTowerCandidatePoses, getVisitedAndDist } from '../utils/minCut';

type XY = [number, number];
type LayoutStructMap = { [structureType: string]: XY[] };
const max = (arr: number[]) => Math.max(...arr);
const min = (arr: number[]) => Math.min(...arr);
/**
 *  作者：Scorpior
 *  贡献者：A56，搞成了傻瓜版本
 * 
 *  版本: v2.1.0
 *  v2.1 为最后一个开源版本，除了 bugfix 外不会新增 feature。
 * 
 *  changelog:
 *  1.0.1: 修了parseLayout()的bug，未改plan()，换了2号layout。
 *  1.0.2: 修了placeAlongRoad()中的几个bug。
 *  2.0.0: 
 *      1）中央布局大改，2x2 第一 spawn 和中央 link，3x3 storage & terminal & powerSpawn & factory，4x4 lab 集群，互相邻近且方向自动计算；
 *      2）加入沿出口贴边 rampart 和均匀分布的 tower（受其他建筑阻挡时可能造不满 6 tower）；
 *      3）自动计算 source 和 controller 的 link，mineral 的 container。
 *  2.0.1: A56 封装成根据 flag 调用及存入 Memory 功能。
 *  2.0.2: 往 rampart 铺路 bugfix，精简代码，添加注释。
 *  2.1.0:
 *      1）中央建筑进一步修改，spawn 和 lab 都不再视为中央建筑，3x3 改成4角是 road，2x2 去掉 spawn，这保证中央建筑肯定不堵路；
 *      2）mincut 修 rampart；
 *      3）按新 rampart 位置计算造 tower 候选位置，按伤害选择最终 tower 位置；
 *      4）按新 rampart 位置计算 workPos 和 link 权重，给其中会被 rangeAttack 到的加 rampart；
 *      5）完全自由形状 lab，得到的 layout[STRUCTURE_LAB] 数组末尾两个是原料 lab，利用 RoomVisual.js 可视化时为白色；
 *      4）ext（extension）沿路摆优化，优先摆到通往 现有 ext 的路边（而不是同一方向无 ext 的路边）；
 *      6）允许中央和 controller 共用 link，由 config 中的 shareControllerLink 控制。
 *  2.1.0 已知问题（不会在开源版本中修复）：
 *      1）核心选址可能落在被墙和 exit 隔开的小区域，导致建筑摆不完，若房间内其他区域有更大空地，可以修改 config 中不同资源点的 weight 来调整核心选址；
 *      2）仅考虑了从 rampart 前 rangeAttack 区域，未考虑自然墙体薄时隔墙 rangeAttack 范围；
 *      3）tower 有小概率在伤害次佳位置；
 *    
 * 
 *  需要配合压缩包内的 RoomVisual.js 使用。
 *
 *  ==================== 基础使用 ====================
 *  require('RoomVisual');
 *  require('planner');
 *  RP('W1N1');  // 原始方法（运行规划 + 可视化）
 * 
 *  ==================== 调整布局偏好 ====================
 *  修改下方 const config 常量字典。
 *  修改 initialMap 函数可以调整 controller、source 等附近不可建造范围。
 *
 *  ==================== 全局缓存系统 ====================
 *  新增全局缓存功能，将规划和可视化分离：
 *
 *  1. 运行规划并保存到全局缓存（不显示可视化）
 *     runPlan('W1N1')
 *
 *  2. 从缓存读取并可视化
 *     visualizePlan('W1N1')
 *
 *  3. 保存到 Memory.roomPlanner[roomName]（会清除旧数据）
 *     savePlanToMemory('W1N1')
 *
 *  4. 列出所有缓存
 *     listPlanCache()
 *
 *  5. 清除指定房间缓存
 *     clearRoomPlanCache('W1N1')
 *
 *  ==================== Flag 自动化使用（需手动取消下方注释）====================
 *  在 main.js 的 loop 中调用 autoPlannerByFlag() 实现 flag 驱动：
 *
 *  - RP flag: 运行规划 -> 删除 RP -> 创建 VP
 *  - VP flag: 从缓存可视化
 *  - SP flag: 保存到 Memory -> 删除 SP
 *
 *  算法流程：
 *  1.  getaccumulateCostMat() 中动态规划（dp）算4个资源（source、mineral、controller）的路程图，用于选建筑中心时选总路程短的。
 *  2.  getExitGroups() 遍历四条边，将房间出口分组（被墙隔断的为不同组），计算每组距离出口（dist）为 0~5 的 pos，按距离、方向、分组存储下来。
 *      dist 0 是出口本身，
 *      dist 1 是出口旁边的空地，不可造除了路以外的建筑。
 *      dist 2 是允许造 rampart 的最外围位置；
 *      dist 3、4、5 可能被 rangeAttack（新 powerCreep 可以提升攻击距离打到 dist 5），不造建筑，除非是资源点工位；
 *  3.  dist 0~5 视作墙，calSquare() 中 dp 按 terrain 算房间内空地，选能摆下核心区的总路程最小点作为 anchor。
 *      核心区包括2块：
 *      3x3 的正方形内摆storage、terminal、powerSpawn、factory；
 *      2x2 的正方形内摆第央link，规则是与3x3的核心区块相邻，且会自动计算朝向让link与storage格子相邻；
 *  4.  根据 anchor 和核心建筑位置设置 CostMatrix 和被占用的空地，dp 摆 extension，总数算上 lab、spawn 和 nuker，
 *      每个 extension 都有一个 entry 点作为填 extension 的位置，entry 点按树状连接。
 *  5.  将核心区和 extension 作为源（start），dist=0 房间出口作为汇（target），用 minCut 计算 rampart。
 *  6.  按 rampart 位置计算各资源点工位和 link/container，往工位铺路，往 rampart 寻路保证可达，期间可能移除挡路 extension。
 *  7.  按 rampart 位置铺 tower，选取伤害最大化位置，且倾向于让 tower 两者、三者成组以便填充。
 *      往 tower 铺路，若有 tower 挡路则移除，从候选位置中选伤害最大的位置造 tower，直到无候选位置或造齐6个有路的 tower。
 *      期间可能移除挡路或在 tower 位置的 extension。 
 *  8.  沿路铺 extension，补齐被移除的数量。
 *  9.  从 extension 位置中选取 10 个改为 lab，3个改为 spawn，1个改ob、1个改nuker。
 * 
 * 教程文章：
 *  1. https://github.com/scorpior0/The-design-of-OverDom/blob/master/advanced%20guide/%E8%87%AA%E5%8A%A8%E8%A7%84%E5%88%92.md
 *  2. https://github.com/scorpior0/The-design-of-OverDom/blob/master/advanced%20guide/%E8%87%AA%E5%8A%A8%E8%A7%84%E5%88%92%E8%BF%9B%E9%98%B6.md
 * 
 * 
 *  TODO
 *  2.2
 *    1）calSquare() 中用 union-find 思路记录不同连通区，只在面积足够大的连通区中选 anchor；
 *    2）往资源点的路 road[x][y] 设资源点编号，以便按资源点最外围 ext 改成 spawn，超出数量的 ext 若 road[x][y] 不为资源点则删 road；
 *    3）spawn 分开：1个靠近核心，2个靠近不同方向的工位；
 *    4）分割 ext，每 NUM_EXT_FOR_GROUP 个作为一个cluster；
 *    5）1~8 级建筑图分开，低级时 tower 放在 spawn 旁；src 和 controller container； storage 和 terminal 考虑放在 controller 旁；
 *    6）建筑需避开隔墙 range_attack 的区域；
 *  2.3 
 *    1）计算外矿路程，在选中心时考虑；
 *    2）外矿铺路和 container；
 *    3）自动按能量运输需求量造用于外矿或用于填 tower 的 link；
 *    4）src 矿工身边 ext 甚至 spawn；
 *    5）ob 和 nuker 放远点防核；
 *    6）rampart 之中周围8格只有1个格可能存在敌人的改成 c.wall
 * 
 */
// ==================== Flag 自动化代码（需取消注释）====================
// 将下方代码复制到 main.js 的 loop 中，或者取消注释并在 main.js 中调用 autoPlannerByFlag()

/*
function autoPlannerByFlag() {
    // RP flag: 运行规划 -> 删除 RP -> 创建 VP
    if (Game.flags.RP) {
        const flag = Game.flags.RP;
        const roomName = flag.pos.roomName;
        console.log(`[AutoPlanner] 检测到 RP flag，开始规划房间 ${roomName}`);

        if (runPlan(roomName)) {
            const flagPos = flag.pos;
            flag.remove();
            Game.rooms[roomName].createFlag(flagPos, 'VP');
            console.log(`[AutoPlanner] 规划完成，已创建 VP flag`);
        }
    }

    // VP flag: 从缓存可视化
    if (Game.flags.VP) {
        const roomName = Game.flags.VP.pos.roomName;
        visualizePlan(roomName);
    }

    // SP flag: 保存到 Memory -> 删除 SP
    if (Game.flags.SP) {
        const flag = Game.flags.SP;
        const roomName = flag.pos.roomName;
        console.log(`[AutoPlanner] 检测到 SP flag，保存房间 ${roomName} 到 Memory`);

        if (savePlanToMemory(roomName)) {
            flag.remove();
            console.log(`[AutoPlanner] 已保存到 Memory.roomPlanner['${roomName}']`);
        }
    }
}

// 在 main.js 的 loop 中调用:
// autoPlannerByFlag();
*/



/**
 * @typedef {{x:number, y:number}} Pos
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
 * @typedef {{x:number, y:number, potentialExtPos:Pos[], extPos:Pos[], hasPotential:boolean, parent:Pos, children:Pos[], accumExtPos:number}} RoadPos
 */

/************   修改这里面的参数可以微调布局，效果自己试试看   ************/
const config = {
    controllerWeight: 3,    // 到 controller 路程长度权重倍数，数字越大则中心越靠近 controller
    sourceWeight: 1,        // 到 source 路程长度权重倍数，数字越大则中心越靠近 source
    mineralWeight: 2,       // 到 mineral 路程长度权重倍数，数字越大则中心越靠近 mineral
    shareControllerLink: false, // true 则允许 controller 和中央建筑共用一个 link
    labProposalNum: 10,     // 如果地形太狭窄导致没有摆 lab，则可以尝试把这个数字减小到 9 或 8
    maxExtensionDistance: 15, // 动态规划摆 extension 的最远距离，如果该距离内摆不完则会沿路摆
    acceptThreshold: 2, // 动态规划中控制 extension 分布
    reviewThreshold: 3, // 动态规划中控制 extension 分布
    fillUpThreshold: 3, // 动态规划中控制 extension 分布
};
const NUM_EXT_FOR_SPAWN = 3;
const NUM_LAB = 10;
/** 多摆的 NUM_EXT_FOR_SPAWN 个 ext 会被替换成 spawn， NUM_LAB 个 ext 替换成 lab，额外2个供 ob、nuker 用 */
const MAX_EXTENSIONS = CONTROLLER_STRUCTURES.extension[8] + NUM_EXT_FOR_SPAWN + NUM_LAB + 2;
const NUM_EXT_FOR_GROUP = 6;
/** 计算到资源点、出口的路径时移除 ext 的代价 */
const EXTENSION_COST = 8;
/** 路程踏入 exit 被敌方 range_attack 范围内的代价 */
const EXIT_PATHFINDER_COST = 9;
const WORK_POS = 'work_pos';
const TOWER_DAMAGE_DECLINE = (TOWER_POWER_ATTACK * TOWER_FALLOFF) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);

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

let circleStyle = [
    { radius: 0.4, opacity: 0.6, fill: '#9acd32' },
    { radius: 0.8, opacity: 0.4, fill: '#90ee90' },
    { radius: 0.4, opacity: 0.9, fill: '#ffd700' },
    { radius: 0.3, opacity: 0.75, fill: '#8b4513' },
    { radius: 0.4, opacity: 0.7, fill: '#ff69b4' }
]

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
 * 初始化 costMat，把 pos 的 range 范围内的所有墙、出口视为 255（不可通过）。   
 * 若传入 layoutCost，代表已摆下的建筑图，其中 pos 的 range 范围内的不可穿过的建筑也是 255。    
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
 * @param {CostMat} accumulateCostMat 
 */
function calCostMat(pos, range, terrain, weight, accumulateCostMat) {
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
                accumulateCostMat[i][j] = accumulateCostMat[i][j] ? accumulateCostMat[i][j] + costMat[i][j] : costMat[i][j];
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
 * @returns {CostMat}
 */
function getaccumulateCostMat(room, terrain) {
    let accumulateCostMat = getEmptyMat(0, 49);
    calCostMat(room.controller.pos, 2, terrain, config.controllerWeight, accumulateCostMat);
    for (let source of room.source) {
        calCostMat(source.pos, 1, terrain, config.sourceWeight, accumulateCostMat);
    }
    if (room.mineral) {
        calCostMat(room.mineral.pos, 1, terrain, config.mineralWeight, accumulateCostMat);
    }
    return accumulateCostMat;
}

/**
 * 获取每个出口周围不同距离的空地格子。
 * 对于每一待检查的 eixtGroup，用线段起止点表示，对于检查后的，用 {x:number, y:number} 数组
 * dist == 0 为出口格，dist == 1 也不能建造
 * dist == 2 可以造 ramp
 * dist == 3、4 为敌方可攻击区，设置为不能建造除矿点 container、link 以外建筑
 * 
 * @param {Uint8Array} terrain 
 * @param {RoomVisual} rv 
 * @returns {{exitGroup:ExitGroups, exitMaps:{[dist:number]:CostMat}}} dist 0~2 相连的才算一个 group，dist 3 以上各方向只算作同一个 group
 */
function getExitGroups(terrain, rv) {
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
                        // rv.text('0', exitPos.x, exitPos.y);
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
                                        // rv.text('' + dist, irv, j, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                                    }

                                } else {
                                    if (!exitCost[i][irv]) {
                                        posGroup.push({ x: i, y: irv });
                                        exitCost[i][irv] = dist;
                                        exitMaps[dist][i][irv] = 1;
                                        // rv.text('' + dist, i, irv, { color: global.colours.暗青, opacity: 1, font: 0.6 });
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
                                        // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                                    }
                                }
                                for (let xVert = idx - 1, yVert = j - yDeltaNext; 0 < yVert && yVert < 49; yVert -= yDeltaNext) {
                                    if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                                        exitCost[xVert][yVert] = dist;
                                        posGroup.push({ x: xVert, y: yVert });
                                        exitMaps[dist][xVert][yVert] = 1;
                                        // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                                    }
                                }
                            } else {
                                for (let xVert = i - xDeltaNext, yVert = curMinP; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                                    if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                                        exitCost[xVert][yVert] = dist;
                                        posGroup.push({ x: xVert, y: yVert });
                                        exitMaps[dist][xVert][yVert] = 1;
                                        // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                                    }
                                }
                                for (let xVert = i - xDeltaNext, yVert = idx - 1; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                                    if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                                        exitCost[xVert][yVert] = dist;
                                        posGroup.push({ x: xVert, y: yVert });
                                        exitMaps[dist][xVert][yVert] = 1;
                                        // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
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
                            // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                        }
                    }
                    for (let xVert = group[group.length - 1].x + dist - 1, yVert = j - yDeltaNext; 0 < yVert && yVert < 49; yVert -= yDeltaNext) {
                        if (xVert <= 0 || 49 <= xVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                            // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
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
                            // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                        }
                    }
                    for (let xVert = i - xDeltaNext, yVert = group[group.length - 1].y + dist - 1; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                        if (yVert <= 0 || 49 <= yVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                            // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
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
    for (let dist = 3; dist <= 5; dist++) {
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
                    iMin = max([2, group[0].x - dist + 1]);
                    iMax = min([47, group[group.length - 1].x + dist - 1]);
                } else {
                    jMin = max([2, group[0].y - dist + 1]);
                    jMax = min([47, group[group.length - 1].y + dist - 1]);
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
                            // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                        }
                    }
                    for (let xVert = iMax, yVert = j; 0 < yVert && yVert < 49; yVert -= yDeltaNext) {
                        if (xVert <= 0 || 49 <= xVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                            // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                        }
                    }
                    // 然后处理平行于 exit 的格子
                    for (let terrainIdx = iMin + 1 + j * 50, idx = iMin + 1;
                        idx < iMax;
                        idx++, terrainIdx += terrainIdxDelta) {
                        if (!exitCost[idx][j] && !(terrain[terrainIdx] & TERRAIN_MASK_WALL)) {
                            exitCost[idx][j] = dist;
                            posGroup.push({ x: idx, y: j });
                            // rv.text('' + dist, idx, j, { color: global.colours.暗青, opacity: 1, font: 0.6 });
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
                            // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                        }
                    }
                    for (let xVert = i, yVert = jMax; 0 < xVert && xVert < 49; xVert -= xDeltaNext) {
                        if (yVert <= 0 || 49 <= yVert) {
                            break
                        }
                        if (!exitCost[xVert][yVert] && !(terrain[xVert + yVert * 50] & TERRAIN_MASK_WALL)) {
                            exitCost[xVert][yVert] = dist;
                            posGroup.push({ x: xVert, y: yVert });
                            // rv.text('' + dist, xVert, yVert, { color: global.colours.暗青, opacity: 1, font: 0.6 });
                        }
                    }
                    // 然后处理平行于 exit 的格子
                    for (let terrainIdx = i + (jMin + 1) * 50, idx = jMin + 1;
                        idx < jMax;
                        idx++, terrainIdx += terrainIdxDelta) {
                        if (!exitCost[i][idx] && !(terrain[terrainIdx] & TERRAIN_MASK_WALL)) {
                            exitCost[i][idx] = dist;
                            posGroup.push({ x: i, y: idx });
                            // rv.text('' + dist, i, idx, { color: global.colours.暗青, opacity: 1, font: 0.6 });
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
    setAsWall(room.controller.pos, 1, terrain);     // controller 周围 range 1 内设为墙，视为不可建造
    if (room.mineral) {
        setAsWall(room.mineral.pos, 1, terrain);    // mineral 周围 range 1 内视为不可建造
    }
    for (let src of room.source) {
        setAsWall(src.pos, 1, terrain);             // source 周围 range 1 内视为不可建造
    }
    for (let dist = 0; dist <= 5; dist++) {                // exit 周围 range 3 内视为不可建造
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

function getRange(x1, y1, x2, y2) {
    let diffX = x1 - x2, diffY = y1 - y2;
    if (diffX < 0) {
        diffX = -diffX;
    }
    if (diffY < 0) {
        diffY = -diffY;
    }
    return diffX > diffY ? diffX : diffY;
}

/**
 * 
 * @param {Anchor} bestAnchor2x2 
 * @param {Anchor} bestAnchor3x3 
 * @param {RoomVisual} rv 
 * @returns {{layout: {[type:string]:{x:number, y:number}[]}, layoutCost:CostMat}}
 */
function placeCentralStructure(bestAnchor2x2, bestAnchor3x3, rv) {
    /**@type {{[type: string]: {x:number, y:number}[]}} */
    let layout = {}, layoutCost = getEmptyMat(1, 48);

    let center3x3 = { x: bestAnchor3x3.x - 1, y: bestAnchor3x3.y - 1 };

    // link in 2x2
    let link = { x: bestAnchor2x2.x + ((bestAnchor2x2.x == bestAnchor3x3.x) || (bestAnchor2x2.x == bestAnchor3x3.x - 3) ? 0 : -1), y: bestAnchor2x2.y + ((bestAnchor2x2.y == bestAnchor3x3.y) || (bestAnchor2x2.y == bestAnchor3x3.y-3) ? 0 : -1) };
    layoutCost[link.x][link.y] = 255;
    layout[STRUCTURE_LINK] = [{ x: link.x, y: link.y }];

    // storage in 3x3
    let storage = { x: center3x3.x + ((link.x < center3x3.x - 1) ? -1 : (link.x > center3x3.x + 1) ? 1 : 0), y: center3x3.y + ((link.y < center3x3.y - 1) ? -1 : (link.y > center3x3.y + 1) ? 1 : 0) };
    layoutCost[storage.x][storage.y] = 255;
    layout[STRUCTURE_STORAGE] = [{ x: storage.x, y: storage.y }];
    // powerSpawn in 3x3
    let powerSpawn = { x: 2 * storage.x - link.x, y: 2 * storage.y - link.y };
    layoutCost[powerSpawn.x][powerSpawn.y] = 255;
    layout[STRUCTURE_POWER_SPAWN] = [{ x: powerSpawn.x, y: powerSpawn.y }];
    // terminal in 3x3
    let terminal = { x: 2 * center3x3.x - powerSpawn.x, y: 2 * center3x3.y - powerSpawn.y };
    layoutCost[terminal.x][terminal.y] = 255;
    layout[STRUCTURE_TERMINAL] = [{ x: terminal.x, y: terminal.y }];
    // factory in 3x3
    let factory = { x: 2 * center3x3.x - storage.x, y: 2 * center3x3.y - storage.y };
    layoutCost[factory.x][factory.y] = 255;
    layout[STRUCTURE_FACTORY] = [{ x: factory.x, y: factory.y }];

    // central roads
    layout[STRUCTURE_ROAD] = [];
    layout[STRUCTURE_ROAD].push({x: storage.x - 1, y: storage.y});
    layoutCost[storage.x - 1][storage.y] = 1;
    layout[STRUCTURE_ROAD].push({x: storage.x + 1, y: storage.y});
    layoutCost[storage.x + 1][storage.y] = 1;
    layout[STRUCTURE_ROAD].push({x: storage.x, y: storage.y - 1});
    layoutCost[storage.x][storage.y - 1] = 1;
    layout[STRUCTURE_ROAD].push({x: storage.x, y: storage.y + 1});
    layoutCost[storage.x][storage.y + 1] = 1;


    return { layout, layoutCost };
}

/**
 * 选 link 方向：如果能在 controller range 3内则选此方向以便共用，否则按与其他几处 link 的距离
 * TODO：考虑外矿，考虑 PC 对 src 产量的影响
 * 
 * @param {ClaimableRoom} room 
 * @param {CandidateAnchors} candidate3x3 
 * @param {CostMat} map 
 * @param {CostMat} accumulateCostMat 
 * @returns {{bestAnchor3x3: {x:number, y:number} | undefined, bestAnchor2x2: {x:number, y:number} | undefined, bestAnchor4x4: {x:number, y:number} | undefined,
 *      layout: {[structureType: string]: {x:number, y:number}[]} | undefined, layoutCost: CostMat | undefined}}
 */
function getBestAnchor(room, candidate3x3, map, accumulateCostMat, rv) {
    for (let cost in candidate3x3) {
        for (let anchor3x3 of candidate3x3[cost]) {
            // 绝对坐标
            /**@type {CandidateAnchors} */
            let bestAnchor2x2 = null, minCost = 9999, curCost, linkPos, src, controllerRange;
            for (let anchor2x2 of CANDIDATE_2x2) {
                // CANDIDATE_2x2 存储的是相对坐标，需加上 anchor3x3 的绝对坐标 
                let x = anchor3x3.x + anchor2x2.x, y = anchor3x3.y + anchor2x2.y;
                // >= 2 是足够的空地，按照 cost 加入 validCandidate2x2 以待进一步检查 
                if (map[x][y] >= 2) {
                    linkPos = { x: x + ((anchor2x2.x === 0) || (anchor2x2.x === -3) ? 0 : -1), y: y + ((anchor2x2.y === 0) || (anchor2x2.y === -3) ? 0 : -1) };
                    curCost = 0;
                    for (src of room.source) {
                        curCost = Math.max(curCost, getRange(src.pos.x, src.pos.y, linkPos.x, linkPos.y));
                    }
                    controllerRange = getRange(room.controller.pos.x, room.controller.pos.y, linkPos.x, linkPos.y);
                    if (controllerRange <= 3) {
                        curCost -= 100;
                    } 
                    // else {
                    //     curCost += controllerRange;
                    // }
                    if (curCost < minCost) {
                        minCost = curCost;
                        bestAnchor2x2 = {x, y};
                    }
                } // if (map[x][y] >=2)
            } // for (let anchor2x2 of CANDIDATE_2x2)
            if (bestAnchor2x2 !== null) {
                let { layout, layoutCost } = placeCentralStructure(bestAnchor2x2, anchor3x3, rv);
                return {
                    bestAnchor3x3: anchor3x3, bestAnchor2x2, layout: layout, layoutCost: layoutCost,
                };
            }
        }
    }
    return {};
}

/**
 *  计算地图正方形面积同时把总路程最短的作为中心
 *  经过此函数后，terrain 中会将矿点、出口 dist 0~4 范围内都视为墙
 * 
 * 
 * @param {ClaimableRoom} room 
 * @param {Uint8Array} terrain 
 * @param {ExitGroups} exitGroups 
 * @param {CostMat} accumulateCostMat
 * @param {RoomVisual} rv 
 * @returns {{map: CostMat, bestAnchors: {bestAnchor3x3: Anchor, bestAnchor2x2: Anchor, bestAnchor4x4: Anchor, layout: {[structureType: string]: {x:number, y:number}[]} | undefined, layoutCost: CostMat | undefined}} map: 二维数组，每一个值代表以此为右下角的最大空地正方形边长，bestAnchor: 满足边长的正方形中总路程最短的右下角
 */
function calSquare(room, terrain, exitGroups, accumulateCostMat, rv) {
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
                    cost = accumulateCostMat[x - radius3x3][y - radius3x3];
                    if (candidate3x3[cost]) {
                        candidate3x3[cost].push({ x: x, y: y })
                    } else {
                        candidate3x3[cost] = [{ x: x, y: y }]
                    }
                }
            }
            //rv.text(map[x][y], x, y, { opacity: 0.3 });
        }
    }
    let result = getBestAnchor(room, candidate3x3, map, accumulateCostMat, rv);
    if (result.bestAnchor3x3 === undefined) {
        return { map, bestAnchors: result, layout: undefined, layoutCost: undefined };
    } else {
        return { map, bestAnchors: result, layout: result.layout, layoutCost: result.layoutCost };
    }
}


/**
 * 
 * @param {CostMat} map 
 * @param {{bestAnchor2x2:Anchor, bestAnchor3x3:Anchor, bestAnchor4x4:Anchor}} bestAnchors 
 */
function updateMap(map, bestAnchors) {
    let squares = [];
    let { bestAnchor2x2, bestAnchor3x3 } = bestAnchors;
    squares.push(
        { x: bestAnchor2x2.x, y: bestAnchor2x2.y, diameter: 2 },
        { x: bestAnchor3x3.x, y: bestAnchor3x3.y, diameter: 3 }
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
    } else if (Number(map[px][py] >= 2) + Number(map[px + 1][py] >= 2) + Number(map[px][py + 1] >= 2) + Number(map[px + 1][py + 1] >= 2) == 3) {
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
        try {
            square32[testSquare(px, py, costMat, planedExtensions, planedEntries, pos.blockX, pos.blockY, pos.blockCost).num].push(pos); 
        } catch (error) {
            console.log('❌', error, testSquare(px, py, costMat, planedExtensions, planedEntries, pos.blockX, pos.blockY, pos.blockCost).num);
        }
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
        //rv.text(cost, px, py);
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
 * @param {number} acceptThreshold 
 * @param {number} reviewThreshold 
 */
function getExtentions(bestAnchors, terrain, map, layout, layoutCost, acceptThreshold, reviewThreshold) {
    //for (idx = 3; idx == idx; idx++) {
    updateMap(map, bestAnchors);
    let storagePos = { x: layout[STRUCTURE_STORAGE][0].x, y: layout[STRUCTURE_STORAGE][0].y };
    let result = calExtensionPos(storagePos, map, terrain, layoutCost, acceptThreshold, reviewThreshold);
    //console.log(JSON.stringify(extensionPos));
    console.log(`extension 总数 num: ${result.num}，总路程 cost:${result.totalCost}`);
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
 * 3. 已经摆下的 ext 的路设 1，已经摆下的 ext 本身设为 EXTENSION_COST（默认值为 swamp 2倍）；
 * 4. exitGroups 中 1、2、3、4 的格子在上述基础上加 EXIT_PATHFINDER_COST。
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
    let pfCostMat = new PathFinder.CostMatrix, terrain = room.getTerrain().getRawBuffer();

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
 * 对于 mincut rampart 后可以被 rangeAttack 的地方，增加寻路开销
 * 
 * @param {CostMatrix} pfCostMat 
 * @param {Uint8Array} vertexDist 
 */
function updatePfCostMat(pfCostMat, vertexDist) {
    let px, py, y50, idx, cost;
    for (py = 1; py < 49; py++) {
        y50 = py*50;
        for (px = 1; px < 49; px++) {
            idx = px + y50;
            if (vertexDist[idx] > 0 && vertexDist[idx] <= 3) {
                cost = pfCostMat.get(px, py);
                if (cost < EXIT_PATHFINDER_COST) pfCostMat.set(px, py, cost + EXIT_PATHFINDER_COST);
            }
        }
    }
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
 * 会铺路
 * 
 * @param {*} start 
 * @param {*} goals 
 * @param {CostMatrix} pfCostMat 
 * @param {CostMat} roads 
 * @param {CostMat} extensionPos 
 * @param {*} rv 
 * @param {CostMat} towerPos 
 * @returns 
 */
function findAllGoals(start, goals, pfCostMat, roads, extensionPos, rv, towerPos = undefined) {
    let removedPosList = [], removedTowers = [], result, path, px, py;
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
        nearestPos = path.length ? (towerPos ? path[path.length - 1] : path.pop()) : start;
        removedGoals = removeGoal(nearestPos, goals);
        if (removedGoals.length) {
            for (let goal of removedGoals) {
                // rv.circle(nearestPos.x, nearestPos.y, circleStyle[1]);
                goalNearestPos[`${goal.pos.x}_${goal.pos.y}`] = nearestPos;
            }
        }
        // 每找到一个，就铺路
        for (let pos of path) {
            px = pos.x;
            py = pos.y;
            roads[px][py] = 1;      // 铺路
            pfCostMat.set(px, py, 1);   // 铺了路以后的地方，移动开销为 1
            if (py in extensionPos[px]) {
                rv.circle(px, py, circleStyle[4]);
                delete extensionPos[px][py];
                removedPosList.push(pos);
            } else if (towerPos && px in towerPos && py in towerPos[px]) {
                removedTowers.push(pos);
            }
        }
    }
    return { removedPosList, goalNearestPos, removedTowers };
}

/**
 * 
 * @param {*} start 
 * @param {*} goals 
 * @param {*} pfCostMat 
 * @param {*} roads 
 * @param {*} extensionPos 
 * @param {CostMat} towerCandidateMat 
 * @param {*} rv 
 * @returns 
 */
function findRoadToRamp(start, goals, pfCostMat, roads, extensionPos, rv) {
    /**@type {RoomPosition[]} */
    let removedPosList = [], result, path, px, py, canReach;
    let fakeRoads = getEmptyMat(1, 49);
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
        return { removedPosList, canReach };
    }
    path = result.path;
    for (let idx = 0; idx < path.length; idx++) {
        let pos = path[idx];
        px = pos.x;
        py = pos.y;
        // pfCostMat.set(px, py, 1);   // 铺了路以后的地方，移动开销为 1
        if (pos.y in extensionPos[pos.x]) {     // 这里越界会报undefined
            rv.circle(px, py, circleStyle[4]);
            delete extensionPos[px][py];
            pfCostMat.set(px, py, 1);
            removedPosList.push(pos);
        }
        if (idx < path.length - 3) {
            // roads[px][py] = 1;
            fakeRoads[px][py] = 1;
        }
    }
    canReach = true;
    return { removedPosList, canReach, fakeRoads };
}

/**
 * 
 * pos 代价考虑因素：
 * 1. pos 上已建了路，代价大（会频繁被 swap）；
 * 1. pos 上已有 ramp，代价略小；
 * 2. pos 离对应的 goalNearestPos 越远，代价越大；
 * 3. pos 本身在 vertexDist 1\2\3 内，可能被攻击，代价大；
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
 * @param {CostMatrix} pfCostMat 是用于 PathFinder 计算的代价矩阵
 * @param {CostMat} extensionPos 是所有 extension 的位置
 * @param {CostMat} roads 是所有 road 的位置
 * @param {{[dist:number]:CostMat}} exitMaps 
 * @param {{[type:string]:{x:number, y:number}[]}} layout 
 * @param {CostMat} layoutCost 
 * @param {RoomVisual} rv
 */
function placeLinkAndContainer(room, goalObjects, goalNearestPos, pfCostMat, roads, fakeRoads, extensionPos, exitMaps, layout, layoutCost, vertexVisited, vertexDist, shareControllerLink, rv) {
    /**@type {RoomPosition[]} */
    let removedPosList = [], terrain = room.getTerrain().getRawBuffer();
    let mineralWorkPos, controllerWorkPos, sourceWorkPosList = [], u, v, linkX, linkY, linkY50;
    let centralLinkPos = layout[STRUCTURE_LINK][0];

    // 寻路到 nearestPos 代价
    let pfOpts = {
        maxRooms: 1,
        plainCost: 2,
        swampCost: 4,
        maxOps: 100,
        roomCallback: () => pfCostMat
    }
    layout[STRUCTURE_CONTAINER] = layout[STRUCTURE_CONTAINER] || [];
    layout[STRUCTURE_RAMPART] = layout[STRUCTURE_RAMPART] || [];
    layout[WORK_POS] = [];
    for (let goal of goalObjects) {
        let goalPos = goal.pos;
        let nearestPos = goalNearestPos[`${goalPos.x}_${goalPos.y}`] || goalPos, y50;
        let nearestRange = getRange(centralLinkPos.x, centralLinkPos.y, nearestPos.x, nearestPos.y);
        //@ts-ignore
        if (goal.mineralType) {
            // it's a Mineral，不用 link 只找 pos
            let curCost, bestPos, bestCost = 999;
            for (let y = goalPos.y - 1; y <= goalPos.y + 1; y++) {
                y50 = y * 50;
                for (let x = goalPos.x - 1; x <= goalPos.x + 1; x++) {
                    curCost = 500;
                    u = x + y50;
                    // 是墙，不可用
                    if (terrain[u] & TERRAIN_MASK_WALL) {
                        continue;
                    }

                    // 已经有 extension，代价大，可以考虑
                    if (y in extensionPos[x]) {
                        curCost += 4;
                        // 已经有其他建筑，pos 不可用
                    } else if (pfCostMat.get(x, y) == 255 || layoutCost[x][y] == 255) {
                        continue;
                    }

                    let result = PathFinder.search(new RoomPosition(x, y, room.name), { pos: nearestPos, range: nearestPos == goalPos ? 1 : 0 }, pfOpts);
                    if (result.incomplete) {    //  到不了的位置，不考虑
                        curCost = 999;
                        continue;
                    } else {
                        curCost += result.path.length;
                    }

                    // 有路
                    if (layoutCost[x][y] == 1 || y in roads[x] || y in fakeRoads[x]) {
                        curCost += 8;  // 即使有 ramp 也比造在 ext 上差
                    }

                    // 有 ramp
                    if (vertexVisited[u] === 4) {
                        curCost -= 2;
                        
                    } // else if 在 ram 保护内，可能被 rangeAttack
                    else if (vertexVisited[u] !== 0 && 1 <= vertexDist[u] && vertexDist[u] <= 3) {
                        curCost += 5 + 3 - vertexDist[u];   // 比 ext 大一点，宁愿拆 ext 也不要被 rangeAttack
                        
                    } // else if 可被攻击且无法造 ramp，位置巨差
                    else if (vertexVisited[u] === 0) {
                        curCost += 12;
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
                pfCostMat.set(bestPos.x, bestPos.y, pfCostMat.get(bestPos.x, bestPos.y) + EXTENSION_COST);
                layoutCost[bestPos.x][bestPos.y] = 255;     // 用 255 表示已用
                u = bestPos.x + bestPos.y * 50;
                // 在 ram 保护内，可能被 rangeAttack
                if (vertexVisited[u] !== 0 && 1 <= vertexDist[u] && vertexDist[u] <= 3) {
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
            let range = goal.progressTotal !== undefined ? 2 : 1;
            let curCost, bestPos, bestLinkPos, bestCost = 999;
            for (let y = goalPos.y - range; y <= goalPos.y + range; y++) {
                y50 = y * 50;
                for (let x = goalPos.x - range; x <= goalPos.x + range; x++) {
                    curCost = 500;
                    u = x + y50;
                    // 是墙，不可用
                    if (terrain[u] & TERRAIN_MASK_WALL) {
                        continue;
                    }

                    // 已经有 extension，代价大，可以考虑
                    if (y in extensionPos[x]) {
                        curCost += 4;
                        // 已经有其他建筑，pos 不可用
                    } else if (pfCostMat.get(x, y) == 255 || layoutCost[x][y] == 255) {
                        continue;
                    }

                    let result = PathFinder.search(new RoomPosition(x, y, room.name), nearestPos, pfOpts);
                    if (result.incomplete) {    //  到不了的位置，不考虑
                        curCost = 999;
                        continue;
                    } else {
                        curCost += result.path.length;
                    }

                    // 有路
                    if (layoutCost[x][y] == 1 || y in roads[x] || y in fakeRoads[x]) {
                        curCost += 8;  // 即使有 ramp 也比造在 ext 上差
                    }

                    // 有 ramp
                    if (vertexVisited[u] === 4) {
                        curCost -= 2;
                    } // else if 在 ram 保护内，可能被 rangeAttack
                    else if (vertexVisited[u] !== 0 && 1 <= vertexDist[u] && vertexDist[u] <= 3) {
                        curCost += 5 + 3 - vertexDist[u];   // 比 ext 大一点，宁愿拆 ext 也不要被 rangeAttack

                    } // else if 可被攻击且无法造 ramp，位置巨差
                    else if (vertexVisited[u] === 0) {
                        curCost += 12;
                    } 

                    // 找 link 位置
                    let linkPos = undefined, curLinkCost, bestLinkCost = nearestRange + 15;
                    for (linkY = y - 1; linkY <= y + 1; linkY++) {
                        linkY50 = linkY * 50;
                        for (linkX = x - 1; linkX <= x + 1; linkX++) {
                            curLinkCost = 0;
                            v = linkX + linkY50;
                            // 有墙，不能建 link
                            if (terrain[v] & TERRAIN_MASK_WALL) {
                                continue;
                            }
                            // 工位 pos 不能建 link
                            if (linkX == x && linkY == y) {
                                continue;
                            }
                            // 寻路路径上的 pos 不能建 link
                            if (linkX == nearestPos.x && linkY == nearestPos.y) {
                                continue;
                            }
                            // 有路，不能建 link
                            if (layoutCost[linkX][linkY] == 1 || linkY in roads[linkX] || linkY in fakeRoads[linkX]) {
                                continue;
                            }
                            // controller 可以和中央共用 link 
                            if (centralLinkPos.x == linkX && centralLinkPos.y == linkY && goal.progressTotal !== undefined && shareControllerLink ) {
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
                                
                            } // 有 ramp，代价低
                            else if (vertexVisited[v] === 4) {
                                curLinkCost -= 2;
                            } // else if 在 ram 保护内，可能被 rangeAttack
                            else if (vertexVisited[v] !== 0 && 1 <= vertexDist[v] && vertexDist[v] <= 3) {
                                curLinkCost += 5 + 3 - vertexDist[v];   // 比 ext 大一点，宁愿拆 ext 也不要被 rangeAttack
                            } // else if 可被攻击且无法造 ramp，位置巨差
                            else if (vertexVisited[v] === 0) {
                                curLinkCost += 12;
                            } 
                            
                            // 与中央距离的影响
                            curLinkCost += getRange(linkX, linkY, centralLinkPos.x, centralLinkPos.y);
                            // rv.text(curLinkCost, linkX, linkY, { color: global.colours.暗青, font: 0.9 });

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
                    linkX = bestLinkPos.x;
                    linkY = bestLinkPos.y;
                    if (layoutCost[linkX][linkY] !== 255) {
                        layout[STRUCTURE_LINK].push(bestLinkPos);
                        layoutCost[linkX][linkY] = 255;     // 用 255 表示已用
                        pfCostMat.set(linkX, linkY, 255);     // 用 255 表示已用
                    }
                    v = linkX + linkY * 50;
                    pfCostMat.set(linkX, linkY, 255);     // 用 255 表示已用

                    // 在 ram 保护内，可能被 rangeAttack
                    if (vertexVisited[v] !== 0 && 1 <= vertexDist[v] && vertexDist[v] <= 3) {
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
                pfCostMat.set(bestPos.x, bestPos.y, pfCostMat.get(bestPos.x, bestPos.y) + EXTENSION_COST);
                u = bestPos.x + bestPos.y * 50;
                // 在 ram 保护内，可能被 rangeAttack
                if (vertexVisited[u] !== 0 && 1 <= vertexDist[u] && vertexDist[u] <= 3) {
                    layout[STRUCTURE_RAMPART].push(bestPos);
                }
                if (bestPos.y in extensionPos[bestPos.x]) {
                    delete extensionPos[bestPos.x][bestPos.y];
                    removedPosList.push(bestPos);
                }
                goal.progressTotal !== undefined ? controllerWorkPos = bestPos : sourceWorkPosList.push(bestPos);
                layoutCost[bestPos.x][bestPos.y] = 255;     // 用 255 表示已用
                layoutCost[nearestPos.x][nearestPos.y] = 255;    
            }
        }
    }
    return { removedPosList, sourceWorkPosList, controllerWorkPos, mineralWorkPos };
}

function getTowerDmg(towerX, towerY, enemyPos) {
    let range = getRange(towerX, towerY, enemyPos.x, enemyPos.y);
    if (range <= 4) {
        return 0;
    } else if (range >= TOWER_FALLOFF_RANGE) {
        return 150;
    } else if (range > TOWER_OPTIMAL_RANGE) {
        return TOWER_POWER_ATTACK - TOWER_DAMAGE_DECLINE * (range - TOWER_OPTIMAL_RANGE);
    } else {
        return TOWER_POWER_ATTACK;
    }
}

function removeAdjTowers(towerPos, validTowerPoses) {
    let x = towerPos.x, y = towerPos.y, px, py, removedPoses = [];
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            px = +x + i;
            py = +y + j;
            if (px in validTowerPoses && py in validTowerPoses[px]) {
                if (i || j) {
                    removedPoses.push({ x: px, y: py, total: validTowerPoses[px][py].total});
                }
                validTowerPoses[px][py] = false;
            }
        }
    }
    // console.log(`removeAdjTowers 移除: ${JSON.stringify(removedPoses)}`);
    return removedPoses;
}

/**
 * 根据 敌人可能站位的伤害 摆塔。
 * 逻辑：
 * 1. 计算每个候选位置 towerCandidatePoses 对所有敌人 enermyPoses 的伤害之和。
 * 2. 循环选择第 i+1 个塔：对于该 towerPos，其伤害 >500 覆盖的点中，有当前累计伤害为 150*i 的点，且该 towerPos 总伤最大
 * 
 * 
 * @param {CostMat} layoutCost 
 * @param {CostMat} roads 
 */
function placeTower(towerCandidatePoses, enermyPoses, layoutCost, roads, fakeRoads) {
    /**@type {{[x:number]:{[y:number]: {total:number, perPos:number[]}}}} */
    let validTowerPoses = {}, removedPoses = [], accumulateDamage, damageData, perDmg;
    /**@type {{x:number, y:number}[]} */
    let selectedTowerPos = [], minPossibleDmg, dmg, maxDmg, minDmg, minTowerDamageFactor, maxRange;
    let x, y, px, py, i, j, validNum, pos, bestTowerPos = null, hasAdjTower, nearMinEnemy, removedNum = 0;
    // 1. 先统计伤害并根据伤害确定第一个 tower 位置
    validNum = 0, maxDmg = 0;
    for (x in towerCandidatePoses) {
        for (y in towerCandidatePoses[x]) {
            if (y in roads[x] || y in layoutCost[x] || y in fakeRoads[x]) {
                continue;
            }
            // 有效位置
            damageData = {total:0, perPos:[]};
            for (i = 0; i < enermyPoses.length; i++) {
                pos = enermyPoses[i];
                dmg = getTowerDmg(+x, +y, pos);
                // 如果 tower 离敌人的距离是可以被 rangeAttack 的距离，视为 invalid
                if (dmg === 0) {
                    damageData = null;
                    break;
                }
                damageData.total += dmg;
                damageData.perPos.push(dmg);
            }
            // 如果 tower 离敌人的距离是可以被 rangeAttack 的距离，视为 invalid
            if (damageData === null) {
                continue;
            }

            if (!(x in validTowerPoses)) {
                validTowerPoses[x] = {};
            }
            validTowerPoses[x][y] = damageData;
            validNum++;

            if (damageData.total > maxDmg) {
                // 如果周围有其他 towerCandidatePoses 才能做第一个 tower
                hasAdjTower = false;
                for (let i = -1; i <= 1; i++) {
                    for (let j = -1; j <= 1; j++) {
                        if (i || j) {
                            px = +x + i;
                            py = +y + j;
                            if (px in validTowerPoses && py in validTowerPoses[px]) {
                                hasAdjTower = true;
                                break;
                            }
                        }
                    }
                }
                maxDmg = damageData.total;
                bestTowerPos = {x: +x, y: +y};
            }
        }
    }
    // 1.1 如果候选位置不超过 6 个，直接返回所有候选位置
    if (validNum <= 6) {
        for (x in validTowerPoses) {
            for (y in validTowerPoses[x]) {
                selectedTowerPos.push({x: +x, y: +y});
            }
        }
        return selectedTowerPos;
    }
    selectedTowerPos.push(bestTowerPos);
    accumulateDamage = validTowerPoses[bestTowerPos.x][bestTowerPos.y].perPos;
    removedPoses.push(removeAdjTowers(bestTowerPos, validTowerPoses));
    removedNum += removedPoses[removedPoses.length - 1].length;

    // 根据 bestTowerPos 与最远的 enermyPos 的距离，确定 minTowerDamageFactor
    maxRange = 0;
    for (i = 0; i < enermyPoses.length; i++) {
        pos = enermyPoses[i];
        let range = getRange(bestTowerPos.x, bestTowerPos.y, pos.x, pos.y);
        if (range > maxRange) {
            maxRange = range;
        }
    }
    if (maxRange > 20) {
        minTowerDamageFactor = 160;
    } else if (maxRange > 16) {
        minTowerDamageFactor = 600 - TOWER_DAMAGE_DECLINE * (maxRange - TOWER_OPTIMAL_RANGE) + 60;
    } else {
        minTowerDamageFactor = 330;
    }
    
    // 2. 循环找第 i+1 个塔，使得不存在有累计伤害为 150*i 的点
    minPossibleDmg = minTowerDamageFactor * selectedTowerPos.length;
    minDmg = Math.min(...accumulateDamage);
    while (selectedTowerPos.length < 6 && minDmg < minPossibleDmg) {
        maxDmg = 0;
        bestTowerPos = null;
        for (x in validTowerPoses) {
            for (y in validTowerPoses[x]) {
                if (validTowerPoses[x][y]) {
                    dmg = validTowerPoses[x][y].total;
                    // 寻找 伤害最大 且 能覆盖到当前受伤最小的敌人 的塔
                    if (dmg > maxDmg) {
                        perDmg = validTowerPoses[x][y].perPos;
                        nearMinEnemy = false;
                        for (i = 0; i < enermyPoses.length; i++) {
                            if (perDmg[i] > 550 && accumulateDamage[i] === minDmg) {
                                nearMinEnemy = true;
                                break;
                            }
                        }
                        if (nearMinEnemy) {
                            maxDmg = dmg;
                            bestTowerPos = { x: +x, y: +y };
                        }
                    }
                }
            }
        }
        if (!bestTowerPos) {
            console.log('Error: no best tower pos');
            break;
        }
        selectedTowerPos.push(bestTowerPos);
        perDmg = validTowerPoses[bestTowerPos.x][bestTowerPos.y].perPos;
        for (i = 0; i < enermyPoses.length; i++) {
            accumulateDamage[i] += perDmg[i];
        }
        removedPoses.push(removeAdjTowers(bestTowerPos, validTowerPoses));
        removedNum += removedPoses[removedPoses.length - 1].length;
        minPossibleDmg = minTowerDamageFactor * selectedTowerPos.length;
        minDmg = Math.min(...accumulateDamage);
    }
    console.log(`placeTower 主循环找到: ${JSON.stringify(selectedTowerPos)}, removedNum: ${removedNum}\n${JSON.stringify(removedPoses)}`);

    // 3. 退出 while 循环后，有两种情况：
    // 1. 找到 6 个塔
    // 2. 所有敌人都被覆盖
    // 3.1 找到 6 个塔
    if (selectedTowerPos.length === 6) {
        return selectedTowerPos;
    } 
    // 3.2 所有敌人都被覆盖
    else {
        // 意外情况，在之前选好的 tower 附近相邻位置不够多
        if (removedNum + selectedTowerPos.length <= 6) {
            for (i = 0; i < removedPoses.length; i++) {
                selectedTowerPos.push(...removedPoses[i]);
                removedPoses[i].length = 0;
            }
        } 
        // 正常情况，在之前选好的 tower 附近相邻位置造塔
        else {
            let hasAdjPos = true;
            while (selectedTowerPos.length < 6 && hasAdjPos) {
                hasAdjPos = false;
                for (i = 0; i < removedPoses.length && selectedTowerPos.length < 6; i++) {
                    pos = removedPoses[i].pop();
                    if (pos) {
                        hasAdjPos = true;
                        selectedTowerPos.push(pos);
                    }
                }
            }
        }
        if (selectedTowerPos.length >= 6) {
            for (i = 0; i < removedPoses.length; i++) {
                for (pos of removedPoses[i]) {
                    validTowerPoses[pos.x][pos.y] = { total: pos.total, perPos: []};
                }
            }
        }

        while (selectedTowerPos.length < 6) {
            maxDmg = 0;
            bestTowerPos = null;
            for (x in validTowerPoses) {
                for (y in validTowerPoses[x]) {
                    if (validTowerPoses[x][y]) {
                        dmg = validTowerPoses[x][y].total;
                        if (dmg > maxDmg) {
                            maxDmg = dmg;
                            bestTowerPos = { x: +x, y: +y };
                        }
                    }
                }
            }
            if (bestTowerPos) {
                selectedTowerPos.push(bestTowerPos);
                validTowerPoses[bestTowerPos.x][bestTowerPos.y] = false;
            } else {
                break;
            }
        }
    }
    return { selectedTowerPos, validTowerPoses };
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
 * @param {RoomVisual} rv 
 */
function placeRoadsAndLinkAndRampartAndTower(room, start, layout, layoutCost, extensionPos, roadPos, entryRoots, exitGroups, exitMaps, shareControllerLink, rv) {
    /** @type {CostMatrix} */
    let pfCostMat, roads = getEmptyMat(1, 48), px, py, x, y;
    let removedExt = getEmptyMat(2, 47), removedNum = 0;
    /**
     * src 和 mineral 相邻空地、controller range2 空地设为与 swamp 相同代价
     */
    pfCostMat = initPfCostMat(layoutCost, roadPos, extensionPos, exitGroups, roads, room);
    
    // 首先考虑所有 ext 圈，必须都能进入
    let goals = entryRoots.map(root => ({ pos: { x: root.x, y: root.y, roomName: room.name }, range: 0 }));
    //console.log('start:', JSON.stringify(start));
    var { removedPosList } = findAllGoals(start, goals, pfCostMat, roads, extensionPos, rv);
    removedNum += removedPosList.length;
    for (let pos of removedPosList) {
        removedExt[pos.x][pos.y] = 1;
    }

    // 然后考虑所有 src、controller、mineral，必须都能抵达
    let goalObjects = [];
    goalObjects.push(room.controller, ...room.source.map(source => source));
    if (room.mineral) {
        goalObjects.push(room.mineral);
    }
    goals = goalObjects.map(o => ({ pos: o.pos, range: 1 }));
    // console.log('find road to 资源点');
    var { removedPosList, goalNearestPos } = findAllGoals(start, goals, pfCostMat, roads, extensionPos, rv);
    removedNum += removedPosList.length;
    for (let pos of removedPosList) {
        removedExt[pos.x][pos.y] = 1;
    }

    // 摆完 ext 后摆 ram
    let startPoses = [];
    for (let x in layoutCost) {
        for (let y in layoutCost[x]) {
            if (layoutCost[x][y] === 255) startPoses.push({ x: +x, y: +y });
        }
    }
    for (let x in extensionPos) {
        for (let y in extensionPos[x]) {
            startPoses.push({ x: +x, y: +y });
        }
    }
    let targetPoses = []
    for (let x in exitMaps[1]) {
        for (let y in exitMaps[1][x]) {
            targetPoses.push({ x: +x, y: +y });
        }
    }
    let startMinCutCPU = Game.cpu.getUsed();
    let ramparts = minCut(room.getTerrain().getRawBuffer(), startPoses, targetPoses, rv);
    console.log(`minCut cpu: ${Game.cpu.getUsed() - startMinCutCPU}`);
    layout[STRUCTURE_RAMPART] = ramparts;
    let { towerCandidatePoses, enermyPoses, rampartGroups } = getTowerCandidatePoses(ramparts);
    let { vertexVisited, vertexDist } = getVisitedAndDist();

    updatePfCostMat(pfCostMat, vertexDist);


    // 确保 ram 可达，移除 ext 并铺路
    for (let group of rampartGroups) {
        goals = group.map(pos => ({ pos: { x: pos.x, y: pos.y, roomName: room.name }, range: 1 }));
        var { removedPosList, canReach, fakeRoads } = findRoadToRamp(start, goals, pfCostMat, roads, extensionPos, rv);
        removedNum += removedPosList.length;
        for (let pos of removedPosList) {
            removedExt[pos.x][pos.y] = 1;
        }
        for (let x in fakeRoads) {
            for (let y in fakeRoads[x]) {
                removedExt[x][y] = 1;
            }
        }
    }
    
    // 在 ram 的路也确定后，铺 link 或 container
    var { removedPosList, sourceWorkPosList, controllerWorkPos, mineralWorkPos } = placeLinkAndContainer(room, goalObjects, goalNearestPos, pfCostMat, roads, fakeRoads, extensionPos, exitMaps, layout, layoutCost, vertexVisited, vertexDist, shareControllerLink, rv);
    removedNum += removedPosList.length;
    for (let pos of removedPosList) {
        px = pos.x;
        py = pos.y;
        removedExt[px][py] = 1;
        delete extensionPos[px][py];
    }

    // 铺 tower，此时肯定不会挡住 workPos 或者 link 或者 roads
    let { selectedTowerPos, validTowerPoses } = placeTower(towerCandidatePoses, enermyPoses, layoutCost, roads, fakeRoads) as any;
    // 确保 tower 可达，往 tower 铺路
    goals = [];
    let towerPos = {};
    for (let pos of selectedTowerPos) {
        px = pos.x, py = pos.y;
        goals.push({ pos: { x: +px, y: +py, roomName: room.name }, range: 1 });
        pfCostMat.set(px, py, EXTENSION_COST + 4);
        if (py in extensionPos[px]) {
            removedNum++;
            // console.log(`remove ext for tower at (${px}, ${py})`);
            delete extensionPos[px][py];
        }

        if (!(px in towerPos)) {
            towerPos[px] = {};
        }
        towerPos[px][py] = 1;
        validTowerPoses[px][py] = false;
    }
    while (true) {
        var { removedPosList, removedTowers } = findAllGoals(start, goals, pfCostMat, roads, extensionPos, rv, towerPos);
        removedNum += removedPosList.length;
        for (let pos of removedPosList) {
            removedExt[pos.x][pos.y] = 1;
        }
        if (removedTowers.length > 0) {
            for (let pos of removedTowers) {
                towerPos[pos.x][pos.y] = 0;
            }
            goals = [];
            while (goals.length < removedTowers.length) {
                let maxDmg = 0, dmg, bestTowerPos = null;
                for (x in validTowerPoses) {
                    for (y in validTowerPoses[x]) {
                        if (validTowerPoses[x][y] && !(y in roads[x]) && !(y in layoutCost[x])) {
                            dmg = validTowerPoses[x][y].total;
                            if (dmg > maxDmg) {
                                maxDmg = dmg;
                                bestTowerPos = { x: +x, y: +y, roomName: room.name };
                            }
                        }
                    }
                }
                if (bestTowerPos) {
                    x = bestTowerPos.x, y = bestTowerPos.y;
                    console.log(`additional tower at (${x}, ${y})`);
                    goals.push({ pos: bestTowerPos, range: 1 });
                    validTowerPoses[x][y] = false;
                    if (!(x in towerPos)) {
                        towerPos[x] = {};
                    }
                    towerPos[x][y] = 1;
                    if (y in extensionPos[x]) delete extensionPos[x][y];
                } else {
                    break;
                }
            }
            if (goals.length === 0) break;
        } else {
            break;
        }
    }
    layout[STRUCTURE_TOWER] = [];
    for (let x in towerPos) {
        for (let y in towerPos[x]) {
            if (towerPos[x][y] === 1) {
                layout[STRUCTURE_TOWER].push({ x: +x, y: +y });
                // 将 tower 位置设为 255，防止后续沿路摆 ext 时错误使用这些位置
                layoutCost[x][y] = 255;     
            }
        }
    }

    return { removedNum, removedExt, roads, vertexVisited, vertexDist };
}

/**
 * 铺 lab，先选 accumExtPos>=10 的点，在其附近选10个 lab
 * 原料 lab 位于 layout[STRUCTURE_LAB] 末尾两个
 * 
 * @param {RoadPos[]} roadPosQueue 
 * @param {*} layout 
 * @param {CostMat} layoutCost 
 * @param {CostMat} extensionPos 
 * @param {CostMat} costMat 
 * @param {RoomVisual} rv 
 */
function placeLab(roadPosQueue, layout, layoutCost, extensionPos, costMat, rv) {
    let labPos = [], pos;
    let potentialLabPos, validRoadPos, xMin, xMax, yMin, yMax, px, py;
    let i, j, k, labA, labAX, labAY, labB, labBX, labBY, labK, labPosNearA, labPosNearAB;
    layout[STRUCTURE_LAB] = [];

    for (let roadPos of roadPosQueue) {
        // rv.text(`${roadPos.accumExtPos}`, roadPos.x - 0.5, roadPos.y - 0.5, { color: global.colours.暗青, font: 0.6});
        // 先选 accumExtPos >= labProposalNum 的点，在其所有2级孩子的 ext 中选 lab
        if (roadPos.accumExtPos >= config.labProposalNum) {
            potentialLabPos = [];
            xMin = 0, xMax = 49, yMin = 0, yMax = 49;
            validRoadPos = [roadPos];
            for (let child of roadPos.children) {
                validRoadPos.push(child);
                validRoadPos.push(...child.children);
            }
            for (let roadPos of validRoadPos) {
                for (let extPos of roadPos.extPos) {
                    potentialLabPos.push({ x: extPos.x, y: extPos.y });
                    if (extPos.x < xMin) xMin = extPos.x;
                    if (extPos.x > xMax) xMax = extPos.x;
                    if (extPos.y < yMin) yMin = extPos.y;
                    if (extPos.y > yMax) yMax = extPos.y;
                }
            }
            // console.log(`test (${roadPos.x}, ${roadPos.y}) with potential ${potentialLabPos.length}`);
            for (i=0; i<potentialLabPos.length-1 && !labPos.length; i++) {
                labA = potentialLabPos[i];
                labAX = labA.x;
                labAY = labA.y;
                if (labAX <= xMin || labAX >= xMax || labAY <= yMin || labAY >= yMax) continue;
                labPosNearA = [];
                for (px = labAX-2; px <= labAX+2; px++) {
                    for (py = labAY-2; py <= labAY+2; py++) {
                        if (py in extensionPos[px] && (px != labAX || py != labAY)) {
                            labPosNearA.push({ x: px, y: py });
                        }
                    }
                }
                if (labPosNearA.length < 9) continue;
                labPosNearA.sort((a, b) => costMat[a.x][a.y] - costMat[b.x][b.y]);
                for (j=i+1; j<potentialLabPos.length; j++) {
                    labB = potentialLabPos[j];
                    labBX = labB.x;
                    labBY = labB.y;
                    if (labBX <= xMin || labBX >= xMax || labBY <= yMin || labBY >= yMax) continue;
                    labPosNearAB = [];
                    for (labK of labPosNearA) {
                        if (labK.x == labBX && labK.y == labBY) continue;
                        if (Math.abs(labK.x - labBX) <= 2 && Math.abs(labK.y - labBY) <= 2) {
                            labPosNearAB.push(labK);
                        }
                    }
                    if (labPosNearAB.length >= 8) {
                        xMin = xMax = labA.x, yMin = yMax = labA.y;
                        labPos.push(labA);
                        labPos.push(labB);
                        for (j=0; j<8; j++) {
                            pos = labPosNearAB[j];
                            if (pos.x < xMin) xMin = pos.x;
                            else if (pos.x > xMax) xMax = pos.x;
                            if (pos.y < yMin) yMin = pos.y;
                            else if (pos.y > yMax) yMax = pos.y;
                            labPos.push(pos)
                        }
                        break;
                    }
                }
            }
            if (labPos.length) {
                // 重新整理，找最近的合适 lab 作为原料 lab，原料 lab 位于 layout[STRUCTURE_LAB] 末尾两个
                let coreLabs = [], minDist = 50;
                for (let pos of labPos) {
                    px = pos.x, py = pos.y;
                    layoutCost[px][py] = 255;
                    if (px - xMin <= 2 && xMax - px <= 2 && py - yMin <= 2 && yMax - py <= 2) {
                        coreLabs.push(pos);
                    } else {
                        layout[STRUCTURE_LAB].push(pos);
                    }
                    // delete extensionPos[pos.x][pos.y];
                }
                if (coreLabs.length > 2) {
                    coreLabs.sort((a, b) => costMat[b.x][b.y] - costMat[a.x][a.y]);
                }
                layout[STRUCTURE_LAB].push(...coreLabs);
                break;
            }
        }
    }
    return labPos;
}

/**
 * 铺 lab、spawn、nuker、被移除的 ext、ob。
 * 会修改 layout(加入 nuker)、extensionPos（加入新 ext）。
 * 
 * 算法步骤：
 * 1. 先从 storage 开始沿 roads bfs，作用：
 *   1.1. 确定所有 ext 最短路程;
 *   1.2. 确定 ext 属于哪个 road 格子，记录每个 road 格子关联的 ext 数量;
 *   1.3. 确定 road 格子的父子关系;
 *   1.4. 将内部路边空地铺上 ext;
 * 2. 
 * 
 * @param {{x:number, y:number}} storagePos 
 * @param {Uint8Array} terrain 
 * @param {*} layout
 * @param {CostMat} layoutCost 
 * @param {CostMat} roads 
 * @param {CostMat} extensionPos 
 * @param {CostMat} removedExt 
 * @param {*} entryRoots 
 * @param {*} num 
 * @param {RoomVisual} rv 
 */
function placeAlongRoad(storagePos, terrain, layout, layoutCost, roads, extensionPos, removedExt, vertexVisited, vertexDist, rv) {
    let { costMat, edgeSet } = initialCost(storagePos, 1, terrain, layoutCost, extensionPos);
    let px, py, y50, u, cost, canPlacePos = [], obPos, newRoadPos, curPos, potNum;

    // potentialExtPos: 每格道路可能摆的 extensions
    // extPos: 每格道路实际关联的 extensions
    // hasPotential: 此格及其所有前序节点是否有 potentialExtPos
    // parent: 每格道路的父 road 格子，往 parent 回溯2步统计 ext 用于 lab
    // children: 每格道路的孩子 road 格子，用于最后 dfs 分组
    // accumExtPos: 此格及其最近两级前序节点的 ext 节点总数，用于选 accumExtPos>=10 的点铺 lab
    /**@type {RoadPos[]} */
    let bfsQueue = [];
    for (let pos of edgeSet) {
        newRoadPos = { x: pos.x, y: pos.y, potentialExtPos: [], extPos: [], hasPotential: false, parent: undefined, children: [], accumExtPos: 0 };
        bfsQueue.push(newRoadPos);
        costMat[pos.x][pos.y] = 0;
    }

    // 这里是一个 bfs
    let totalExt = 0, curCost, totalPotentialExt = 0;
    for (let roadPos of bfsQueue) {
        px = roadPos.x, py = roadPos.y;
        curCost = costMat[px][py];
        // rv.text(`${curCost}`, px - 0.5, py - 0.5, { color: global.colours.宝蓝 });
        for (let y = py - 1; y <= py + 1; y++) {
            if (y <= 0 || y >= 49) continue;
            y50 = y * 50;
            for (let x = px - 1; x <= px + 1; x++) {
                if (x <= 0 || x >= 49) continue;
                if (y in roads[x]) {
                    if (!(y in costMat[x])) {
                        newRoadPos = { x, y, potentialExtPos: [], extPos: [], hasPotential: false, parent: roadPos, children: [], accumExtPos: 0 };
                        roadPos.children.push(newRoadPos);
                        bfsQueue.push(newRoadPos);
                        costMat[x][y] = curCost + 1;
                    }
                } else if (y in extensionPos[x]) {
                    if (!(y in costMat[x])) {
                        totalExt++;
                        roadPos.extPos.push({ x, y });
                        roadPos.accumExtPos++;
                        costMat[x][y] = curCost;
                    }
                } else if (!(terrain[y * 50 + x] & TERRAIN_MASK_WALL) &&
                    !(y in layoutCost[x]) &&
                    !(y in removedExt[x]) &&
                    !(y in costMat[x])) {
                        // 如果在 ram 外或会被 rangeAttack 的区域，不造额外补充的 ext
                        u = y50 + x;
                        if (vertexVisited[u] === 0 || (vertexDist[u] > 0 && vertexDist[u] <= 3)) {
                            continue;
                        }
                        else if (curCost === 0) {
                            totalExt++;
                            roadPos.extPos.push({ x, y });
                            roadPos.accumExtPos++;
                            costMat[x][y] = curCost;
                            extensionPos[x][y] = 1;
                        } else {
                            roadPos.potentialExtPos.push({ x, y });
                            costMat[x][y] = curCost;
                            roadPos.hasPotential = true; // 代表自己及上游有 potential
                        }
                }
            }
        }
        // 如果此格有 ext，所有上游 potential 变现
        if (roadPos.extPos.length) {
            roadPos.parent && (roadPos.parent.accumExtPos += roadPos.accumExtPos) && roadPos.parent.parent && (roadPos.parent.parent.accumExtPos += roadPos.accumExtPos);
            curPos = roadPos;
            while (curPos && curPos.hasPotential) {
                potNum = curPos.potentialExtPos.length;
                if (potNum) {
                    totalExt += potNum;
                    for (let pos of curPos.potentialExtPos) {
                        extensionPos[pos.x][pos.y] = 1;
                    }
                    curPos.extPos.push(...curPos.potentialExtPos);
                    totalPotentialExt -= potNum;
                    curPos.potentialExtPos.length = 0;
                    curPos.accumExtPos += potNum;
                    curPos.parent && (curPos.parent.accumExtPos += potNum) && curPos.parent.parent && (curPos.parent.parent.accumExtPos += potNum);
                }
                curPos.hasPotential = false;
                curPos = curPos.parent;
            }
        } else {
            totalPotentialExt += roadPos.potentialExtPos.length;
            for (let pos of roadPos.children) {
                pos.hasPotential = roadPos.hasPotential;    // 代表上游有 potential
            }
        }
        if (totalExt >= MAX_EXTENSIONS) {
            console.log(`✅✅不外扩情况下满足 totalExt=${totalExt}`);
            break;
        } else if (totalExt + totalPotentialExt >= MAX_EXTENSIONS) {
            console.log(`✅外扩情况下满足 totalExt=${totalExt}, totalPotentialExt=${totalPotentialExt}`);
            break;
        }
    }

    placeLab(bfsQueue, layout, layoutCost, extensionPos, costMat, rv);
    let placedNum = 0, labNum = layout[STRUCTURE_LAB].length;   
    let lackNum = MAX_EXTENSIONS - NUM_LAB - totalExt + labNum;     // 更鲁棒，适应能摆下的 lab 不足10个或根本没摆 lab
    let numToPlace = MAX_EXTENSIONS - NUM_LAB + labNum;     // 更鲁棒，适应能摆下的 lab 不足10个或根本没摆 lab
    layout[STRUCTURE_EXTENSION] = [];
    for (let roadPos of bfsQueue) {
        while (roadPos.extPos.length && placedNum < numToPlace) {
            curPos = roadPos.extPos.pop();
            if (!(curPos.y in layoutCost[curPos.x])) {
                // layoutCost[curPos.x][curPos.y] = 255;
                layout[STRUCTURE_EXTENSION].push(curPos);
            }
            placedNum++;
        }
        while (roadPos.potentialExtPos.length && lackNum > 0 && placedNum < numToPlace) {
            layout[STRUCTURE_EXTENSION].push(roadPos.potentialExtPos.pop());
            placedNum++;
            lackNum--;
        }
        if (placedNum >= numToPlace) break;
    }
    layout[STRUCTURE_SPAWN] = layout[STRUCTURE_EXTENSION].slice(0, 3);
    layout[STRUCTURE_EXTENSION] = layout[STRUCTURE_EXTENSION].slice(3);
    if (layout[STRUCTURE_EXTENSION].length) {
        layout[STRUCTURE_OBSERVER] = [layout[STRUCTURE_EXTENSION].pop()];
    } else {
        layout[STRUCTURE_OBSERVER] = [];
    }
    if (layout[STRUCTURE_EXTENSION].length) {
        layout[STRUCTURE_NUKER] = [layout[STRUCTURE_EXTENSION].pop()];
    } else {
        layout[STRUCTURE_NUKER] = [];
    }
    
    // dfs 的起始点只包括 edgeArray
    // let placedNum = 0, lackNum = MAX_EXTENSIONS - totalExt;   
    // let dfsArray = bfsQueue.slice(0, edgeSet.length);
    // let hasCentralSpawn = false, numOuterSpawn = 0;
    // layout[STRUCTURE_EXTENSION] = [];
    // layout[STRUCTURE_SPAWN] = [];
    // while (dfsArray.length && placedNum < MAX_EXTENSIONS) {
    //     curPos = dfsArray[dfsArray.length - 1];
    //     if (curPos.extPos.length && placedNum < MAX_EXTENSIONS) {
    //         for (let pos of curPos.extPos) {
    //             placedNum++;
    //             // 如果没有被 lab 占用，
    //             if (!(pos.y in layoutCost[pos.x])) {
    //                 layoutCost[pos.x][pos.y] = 255;
    //                 layout[STRUCTURE_EXTENSION].push(pos);
    //             }
    //             if (placedNum >= MAX_EXTENSIONS) break;
    //         }
    //         curPos.extPos.length = 0;
    //     }
    //     while (curPos.potentialExtPos.length && lackNum > 0) {
    //         let pos = curPos.potentialExtPos.pop();
    //         layoutCost[pos.x][pos.y] = 255;
    //         layout[STRUCTURE_EXTENSION].push(pos);
    //         placedNum++;
    //         lackNum--;
    //     }
    //     if (placedNum >= MAX_EXTENSIONS) break;
    //     if (curPos.children.length) {
    //         dfsArray.push(curPos.children.pop());
    //     } else {
    //         dfsArray.pop();
    //     } 
    // }
    // throw new Error(`cannot place all extension and ob: ${placedNum}, ${JSON.stringify(obPos)}`);
}

/**
 * 
 * @param {RoomVisual} rv 
 */
function showBetter(layout, rv) {

    for (let s of layout[STRUCTURE_ROAD]) {
        rv.structure(s.x, s.y, STRUCTURE_ROAD);
    }
    rv.connectRoads();
    for (let type in layout) {
        if (type == STRUCTURE_EXTENSION && layout[type].length) {
            let num = 1;
            for (let s of layout[type]) {
                rv.structure(s.x, s.y, type);
                rv.text(num, +s.x, +s.y, { color: '#ffd700', opacity: 1, font: 0.6 });
                num++;
            }
        } else if (type == STRUCTURE_LAB && layout[type].length) {
            for (let i = 0; i < layout[type].length - 2; i++) {
                rv.structure(layout[type][i].x, layout[type][i].y, type);
            }
            for (let i = layout[type].length - 2; i < layout[type].length; i++) {
                rv.structure(layout[type][i].x, layout[type][i].y, type, { isCore: true });
            }
        } else if (type != STRUCTURE_ROAD && layout[type].length) {
            for (let s of layout[type]) {
                rv.structure(s.x, s.y, type);
            }
        } 
    }
}

/**
 * 
 * @param {ClaimableRoom|string} room 
 * @param {boolean} showPlan 可选参数，显示结果
 * @param {number} acceptThreshold 可选参数，1~7，默认2，控制extension分布
 * @param {number} reviewThreshold 可选参数，1~7，默认3，控制extension分布
 */
export function plan(room: Room | string, showPlan = false) {
    let startPlanCPU = Game.cpu.getUsed();
    if (typeof room == 'string') {
        room = Game.rooms[room];
    }
    if (!(room instanceof Room) || !room.controller) {
        return false;
    }
    room.source = room.source || room.find(FIND_SOURCES);   // 
    room.mineral = room.mineral || room.find(FIND_MINERALS)[0];  // 
    // showPlan = showPlan === undefined || showPlan;  // 取消此行注释可以将默认值设true
    let terrain = (room.getTerrain() as any).getRawBuffer();
    // @ts-ignore
    let accumulateCostMat = getaccumulateCostMat(room, terrain);      // 获取从每个矿点及 controller 出发的路程图列表

    let rv = new RoomVisual(room.name);

    let { exitGroups, exitMaps } = getExitGroups(terrain, rv);
    // return

    // calSquare 会改变 terrain，会摆下中央建筑
    let { map, bestAnchors, layout, layoutCost } = calSquare(room, terrain, exitGroups, accumulateCostMat, rv);
    if (bestAnchors.bestAnchor3x3 === undefined) {
        console.log('找不到能摆下中央建筑的位置');
        return false;
    }

    // getExtentions 不会改变 layout、layoutCost
    let { extensionPos, entryRoots, roadPos, num } = getExtentions(bestAnchors, terrain, map, layout, layoutCost,
        config.acceptThreshold, config.reviewThreshold);
    // console.log(`best layout num: ${num}`);

    // 先把通往资源点的路留出来
    let storage = layout[STRUCTURE_STORAGE][0];
    let startPos = { x: storage.x, y: storage.y, roomName: room.name };
    let { removedNum, removedExt, roads, vertexVisited, vertexDist } = placeRoadsAndLinkAndRampartAndTower(room, startPos, layout, layoutCost, extensionPos, roadPos, entryRoots, exitGroups, exitMaps, config.shareControllerLink, rv);
    console.log(`为连通道路移除 extension num: ${removedNum}`);

    placeAlongRoad(startPos, terrain, layout, layoutCost, roads, extensionPos, removedExt, vertexVisited, vertexDist, rv);
    console.log(`最终建造 extension num: ${layout[STRUCTURE_EXTENSION].length}`);
    

    /**
     * roads 中是所有路点，之前的 layout[STRUCTURE_ROAD] 只包含中央路点
     */
    layout[STRUCTURE_ROAD] = [];
    for (let x in roads) {
        for (let y in roads[x]) {
            layout[STRUCTURE_ROAD].push({ x: +x, y: +y });
        }
    }
    console.log(`找到 ${layout[STRUCTURE_LAB].length} 个 lab`);
    console.log(`自动规划总 CPU（含 minCut 不含可视化）: ${Game.cpu.getUsed() - startPlanCPU}`);
    if (showPlan) {
        if (rv.structure) {
            showBetter(layout, rv);
        } else {
            console.log('快去群里下载先进作图工具（RoomVisual.js）');
            throw new Error('需要导入 RoomVisual.js');
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
            const structMap = toStructMap(layout as Record<string, Array<{ x: number; y: number }>>);
            const centerPos = pickCenter(structMap);
            return {
                roomName,
                structMap,
                centerPos: centerPos || { x: 25, y: 25 }
            };
        }
    }
};
