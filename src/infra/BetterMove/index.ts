// @ts-nocheck
/*
creep 堵车解算+跨房间寻路+寻路缓存+小队移动
跑的比香港记者还快从你做起

=== 核心 feature ===
1. creep.moveTo 缓存路径节约 cpu，自动解算堵车；
2. 需要在主 loop 中调用 preTickBetterMove() 和 endTickResolve() 才能实际执行移动，压缩包中 main.js 是样例；
3. endTickResolve 中传入 isWorkTile() 判断工作范围，压缩包中 main.js 是样例，若 creep 不在工作时务必返回 true！若 creep 不在工作时务必返回 true！若 creep 不在工作时务必返回 true！
4. squadMoveTo 四人小队，需要用户先摆成正方形再调用，ignoreDestructibleStructures 为 true 时，会在遇到建筑（包括己方建筑）时停下并返回 ERR_FULL，战斗决策时可以考虑这个特殊返回值。

=== deprecated ===
* 应用此模块会导致 creep.moveTo 可选参数中这些项失效：ignoreCreeps、reusePath、serializeMemory、noPathFinding、ignore、avoid、serialize；
* 旧版轮子中 dontPullMe 已被废弃，不再支持，现在采用 endTickResolve 中传入 isWorkTile() 判断工作范围；
* 旧版轮子中不成熟的 observer 寻路已被废弃，不再支持；
* 旧版轮子中 ob 寻路和 avoidRoom、avoidExit 功能暂未与新版改动合并，将在 1.0.0beta 中支持；

=== keep ===
保留 creep.moveTo 中其他全部可选参数如 visualizePathStyle、range、ignoreDestructibleStructures、ignoreRoad、maxOps、maxRooms、maxCost、heuristicWeight 等。

=== new feature ===
1. creep.moveTo
* 新增 creep.moveTo 中可选参数 priority，可设置单个 creep 的移动优先级，默认0，需为 0~2 整数。建议 work 工种为 0，运输工为 1，战斗 creep 为 2。
    例：creep.moveTo(controller, {priority: 2});
* 新增 creep.moveTo 中可选参数 ignoreSwamps，会无视swamp与road的移动力损耗差异，一律与plain相同处理，用于方便pc和眼，默认false
    例：creep.moveTo(controller, {ignoreSwamps: true});
* 新增 creep.moveTo 中可选参数 bypassHostileCreeps，被 creep 挡路时若此项为 true 则绕过别人的 creep，默认为 true，设为 false 用于近战攻击
    例：creep.moveTo(controller, {bypassHostileCreeps: false});
* 新增 creep.moveTo 中可选参数 bypassRange，被 creep 挡路准备绕路时的绕路半径，默认为5
    例：creep.moveTo(controller, {bypassRange: 10});
* 新增 creep.moveTo 中可选参数 avoidRooms，可设置避免进入的房间，默认 undefined，设为 Set 类型房间名集合，用于避免进入房间拥堵。
    例：creep.moveTo(controller, {avoidRooms: new Set(['W1N1', 'W2N2'])});
* 新增 creep.moveTo 中可选参数 avoidExits，可设置避免进入的房间出口，默认 undefined，设为 Map 类型 房间名-出口房间集合 ，用于避免从特定出口走。
    例：creep.moveTo(controller, {avoidExits: new Map([['W1N1', new Set(['W1N2'])], ['W2N2', new Set(['W2N3'])]])});
* 新增返回值 ERR_INVALID_ARGS，表示 range 或 bypassRange 或 avoidRooms 或 avoidExits 类型错误;

2. squadMoveTo(Creep[], x, y, [opts]) | squadMoveTo(Creep[], target, [opts])
* 新增小队移动函数 squadMoveTo()，仅支持正方形4人小队寻路及移动，会自动处理堵车解算。
    * 使用方式类似 creep.moveTo，其中 opts 支持参数： visualizePathStyle, costCallback, ignoreDestructibleStructures, enableAutoPull;
    * 第一个参数需为包含4个 creep 的数组，否则返回 ERR_INVALID_ARGS。且 creep 需已排列成正方形，否则返回 ERR_NOT_IN_RANGE;
    * 其他可能的返回有：
        * OK、ERR_BUSY、ERR_TIRED、ERR_NOT_OWNER、ERR_NO_PATH，含义与 creep.moveTo 相同;
        * ERR_FULL: 在 ignoreDestructibleStructures：true 时，表示遇到障碍建筑，无法继续移动，可以用这个辅助判断是否要对建筑开火。
    * opts 参数解释：
        * visualizePathStyle：与 creep.moveTo 相同，用于可视化路径；
        * costCallback：与 creep.moveTo 相同，用于自定义移动成本；
        * maxOps、maxRooms、maxCost、heuristicWeight：与 creep.moveTo 相同，用于 PathFinder；
        * ignoreDestructibleStructures：默认 false，绕过所有建筑；设为 true 会忽略敌方建筑，并在遇到建筑时停在原地；
        * enableAutoPull：默认 true，开启后若部分 creep 有疲劳值且下一步前方有同队的无疲劳 creep，则自动调用 creep.pull() 拉车。
    * 注意：撞建筑、撞墙、撞敌方 creep 以及异常的跨房行为会导致队形走散，导致下一次调用返回 ERR_NOT_IN_RANGE，走散后需用户处理摆回正方形.
    例：squadMoveTo([creep1, creep2, creep3, creep4], Flag1);

3. squadMove(Creep[], RoomPosition[])
* 新增小队移动函数 squadMove()，可用于多个 creep 同时移动到一个目标位置，会自动处理堵车解算，固定采用最高 priority。
    * 第一个参数是 creep 数组，第二个参数是目标位置数组，两个数组长度需相同，长度为 2~9，每个目标位置与 creep 一一对应。注意，每个目标位置需在其对应 creep 身边，否则解算将出现异常现象。
    例：squadMove([creep1, creep2], [roomPosition1, roomPosition2]);
    * 若小队无需移动，但要避免被其他 creep 推走，也需要用 squadMove 注册小队，第二个参数不填。
    例：squadMove([creep1, creep2]);

5. creep.pull()
* 现在调用 creep.pull() 会自动将相关的两个 creep 注册为同一个小队，最终解算后要么都移动要么都不动.

6. RoomPosition.prototype.findSquadPathTo(target: RoomPosition | RoomObject, [opts])
* 新增 RoomPosition 原型方法 findSquadPathTo()，用于查找小队移动到目标位置的路径。
    * 第一个参数是目标，第二个参数是可选参数 opts，类似 RoomPosition.findPathTo()。
    * opts 支持参数：
        * ignoreDestructibleStructures, costCallback, range, maxOps, maxCost, maxRooms, heuristicWeight
    * 返回值：若当前 RoomPosition 不可作为四人小队站位的右下角，则返回 ERR_NO_PATH，否则返回 PathFinder 的结果。
    例：roomPosition.findSquadPathTo(flag1);

7. preTickBetterMove()
* 新增 preTickBetterMove() 函数，必须每个 tick 开始时调用，清空缓存数据。
    * 调用样例见压缩包中 main.js

8. endTickResolve(isWorkTile: (creep, RoomPosition) => boolean)
* 新增 endTickResolve() 函数，必须每个 tick 结束时调用，否则任何 creep 都不会移动。
    * 可选参数 isWorkTile：用于判断某个位置是否为该 creep 的工作地点，默认返回 true。功能是堵车解算时优先让 creep 留在工作范围内;
    * 调用样例见压缩包中 main.js;
    * 不传 isWorkTile 也能跑，结果是工作 creep 容易被推出工位然后再走回去，不在工作状态的 creep 需 isWorkTile 返回 true。

9. getSquadCostMatrix(roomName, ignoreDestructibleStructures)
* 如果无此 roomName 的缓存，返回 undefined。否则返回 CostMatrix，其中每格代表以此格为四人小队右下角时的移动开销，
  255 表示摆不下四人小队。用于方便用户将小队摆成正方形、作其他战术判断。

=== 典型用例 ===
1. 设置 harvester、upgrader、builder 的工作范围：参考文件夹中样例 main.js；
2. 民用 creep 不能进去部分房间，战斗 creep 允许进去：通过 addAvoidRooms、addAvoidExits 设置默认不可入房间，
    在战斗 creep 调用 moveTo() 时传入特定的 avoidRooms、avoidExits（都可以为空 object）来覆盖默认设置。
3. 将任意 4 个 creep 摆成正方形后，就可以用 squadMoveTo(creepArray, target) 来移动它们，target 可以是其他房间的 RoomPosition。
    如果撞到东西走散了，需要用户自己处理摆回正方形。
4. 提前评估4人小队路径上有没有墙、敌方火力如何：
    从起点 let start = new RoomPosition(...); 
    start.findSquadPathTo(target) 就能返回路径（对于无视野的房间不会考虑其中建筑），可以自己遍历路径看其中有没有你关注的信息。
5. pull 拖车按官方原版调用方式即可；
6. 【高级用法】读懂 squadMoveTo 是如何调用 squadMove() 后，可基于此实现你自己复杂的小队逻辑。
    对 squadMove 有疑问可以咨询作者 Scorpior。

=== 一些说明 ===
* 遇到己方有 MOVE 的 creep 自动进行解算堵车（推走），bypassHostileCreeps 设为 true 时遇到他人 creep 会在撞上后绕过；
* 轮子的 squadMoveTo 是（不鲁棒的）小队功能示例，复杂的情况可能导致队形走散，需要用户自己研究；
* 轮子的 squadMove 是鲁棒的小队移动接口，支持2~9个creep任意队形的小队，用户可以基于此实现复杂小队逻辑；
* 会将新手墙和部署中的invaderCore处理为无法通过；
* 会绕过非终点的 portal，不影响 creep.moveTo(portal)；
* 不使用 Memory 及 global，不会因此干扰外部代码；
* 不会在Creep.prototype、PowerCreep.prototype上增加官方未有的键值，不会因此干扰外部代码；
* 本模块不可用于sim，在sim会因为房间名格式不对返回ERR_INVALID_TARGET；
* 模块参数见代码头部，模块接口见代码尾部；
* 版本号规则：alpha test = 0.1.x，beta test = 0.9.x，publish >= 1.0.0

author: Scorpior
debug helpers: fangxm, czc

date: 2026/3/21
version: 1.0.2

Usage:
module: main.js

let {preTickBetterMove, endTickResolve} = require('超级移动优化');
module.exports.loop = function() {
    preTickBetterMove();

    //your codes go here

    endTickResolve();
}

changelog:
0.1.0:  maybe not runnable
0.1.1： still maybe not runnable，修了一些typo，完成正向移动，修改isObstacleStructure
0.1.2： maybe runnable，some bugs are fixed
0.1.3:  修正工地位置寻路错误，调整打印格式
0.1.4:  补充pc对穿，打印中增加cache hits统计
0.9.0:  启用自动清理缓存，保留ignoreCreeps参数，调整对穿顺序+增加在storage附近检查对穿，
        正确识别敌对rampart，正确查询带range路径，打印中增加对穿频率统计
0.9.1:  增加正常逻辑开销统计，修改cache搜索开销统计为cache miss开销统计，绕路bugfix，跨房检测bugfix，other bugfix
0.9.2:  修改缓存策略减少查找耗时增加命中率，增加核心区对穿次数统计，对穿bugfix，other bugfix
0.9.3： 取消路径反向复用避免偶发的复用非最优路径的情况，改进识别被新手墙封闭的房间，增加avoidRooms设置，
        增加远距离跨房寻路成功率，房间出口处对穿bug fix
0.9.4:  优化路径复用避免偶发的复用非最优路径的情况，删除运行时参数中neutralCostMatrixClearDelay，
        自动根据挡路建筑情况设置中立房间costMatrix过期时间，增加ob寻路（检查房间是否可走），
        提供deletePathInRoom接口（使用方式见下方ps），print()中增加平均每次查找缓存时检查的路径数量统计，
        findRoute遇到过道新手墙时bugfix，偏移路径bugfix;
1.0.0:  新增堵车解算算法与 preTickBetterMove、endTickResolve 函数，必须按样例调用这俩函数才能移动；
        新增 squadMove, squadMoveTo、RoomPosition.findSquadPathTo 接口;
        替换 Creep.prototype.move(), Creep.prototype.pull(), Creep.prototype.cancelOrder();
        avoidRoom、avoidExit 可以作为 creep.moveTo 参数传入了;
1.0.1:  Tons of bugfix;
1.0.2:  新增 export 接口: getSquadCostMatrix(string, boolean): undefined | CostMatrix，返回的 CostMatrix 代表以此格为四人小队右下角时的移动开销，255 表示摆不下四人小队。
        bugfix：pull bug；moveTo 撞到障碍物未触发重新寻路 bug；

1.1.0: TODO（看心情更新）: 
        1. betterFindClosestByPath
        2. 提供 deletePathFromRoom、deletePathToRoom 接口；

ps:
1.修路后希望手动更新房间内路径，可执行如下代码：
require('超级移动优化').deletePathInRoom(roomName)；
2.战斗中遇到敌方pc不断产生新rampart挡路的情况，目前是撞上建筑物才重新寻路（原版moveTo撞上也继续撞），后续更新可能增加提前发现建筑物功能；
3.在控制台输入 require('超级移动优化').print() 获取性能信息，鼓励发给作者用于优化；
*/

import moveMatch from './moveMatch';

/***************************************
 *  模块参数
 */


// 运行时参数 
let pathClearDelay = 5000;  // 清理相应时间内都未被再次使用的路径，同时清理死亡creep的缓存，设为undefined表示不清除缓存
let hostileCostMatrixClearDelay = 500; // 自动清理相应时间前创建的其他玩家房间的costMatrix
let coreLayoutRange = 3; // 核心布局半径，在离storage这个范围内频繁检查对穿（减少堵路的等待
let avoidRooms = new Set(['W99N99', 'E99S99']); // 永不踏入这些房间，按你自己需要填写
let avoidExits = new Map([  // 按以下格式设为你自己需要的
    ['W99N99', new Set(['E99S99'])],   // 举例：从W99N99进入E99S99是被屏蔽的
    ['E99S99', new Set(['W99N99'])],   // 举例：从E99S99进入W99N99是被屏蔽的
]);   // 单向屏蔽房间的一些出口，永不从fromRoom踏入toRoom

/***************************************
 *  局部缓存
 */
/** @type {Paths} */
let globalPathCache = {};     // 缓存path
/** @type {MoveTimer} */
let pathCacheTimer = {}; // 用于记录path被使用的时间，清理长期未被使用的path
/** @type {CreepPaths} */
let creepPathCache = {};    // 缓存每个creep使用path的情况
let creepMoveCache = {};    // 缓存每个creep最后一次移动的tick
let emptyCostMatrix = new PathFinder.CostMatrix;
/** @type {CMs} */
let costMatrixCache = {};    // true存ignoreDestructibleStructures==true的，false同理
/** @type {{ [time: number]:{roomName:string, avoids:string[]}[] }} */
let costMatrixCacheTimer = {}; // 用于记录costMatrix的创建时间，清理过期costMatrix
let autoClearTick = Game.time;  // 用于避免重复清理缓存
const roomNameCache = new Map(); // 缓存房间名字，避免重复parse
const tile2PosCache = new Map(); // 缓存tile到pos的转换，避免重复计算
const unWalkableCost = 255;
const halfWorldSize = 255 >> 1;
const activeMoveScore = 32;
const highMoveScore = activeMoveScore << 1;
const ultraMoveScore = activeMoveScore << 2;
const passiveMoveScore = -4;
const overlapMoveScore = -4;
const badMoveScore = -32;

const IntentTiles = new Uint32Array(Math.max(Object.keys(Game.rooms).length * 128, 2048));
const Priorities = new Uint8Array(IntentTiles.length);
/**@type {Map<string, number>} */
const cachedMoveIntents = new Map(); // 缓存 creep 的移动意图
/**@type {Map<string, number>} */
const creepToSquad = new Map(); // 记录 creep 的组队关系
/**@type {Map<number, string[]>} */
const squadToCreeps = new Map();    // 记录 creep 的组队关系
const squadNextTile = new Set();    // 记录小队的移动目标，如果普通 creep 处于小队移动目标上，则可以被强行推开
const rerouteSquad = new Set();
let squadIdx = 1; // 用于给新队伍分配id
let creepIdx = 1; // 用于给新 creep 分配id
const checkedTiles = new Map(); // 记录当前 tick 已经检查过的格子
const nameToIntentIdx = new Map();
const pullPair = new Map();
let curTick = 0;

const obstacles = new Set(OBSTACLE_OBJECT_TYPES);
const originMove = Creep.prototype.move;
const originMoveTo = Creep.prototype.moveTo;
const originPull = Creep.prototype.pull;
const originCancelOrder = Creep.prototype.cancelOrder;
const originFindClosestByPath = RoomPosition.prototype.findClosestByPath;

// 统计变量
let startTime;
let endTime;
let startCacheSearch;
let analyzeCPU = { // 统计相关函数总耗时
    move: { sum: 0, calls: 0 },
    moveTo: { sum: 0, calls: 0 },
    findClosestByPath: { sum: 0, calls: 0 },
    endTickResolve: { sum: 0, calls: 0, moveCount: 0 }
};
let pathCounter = 0;
let testCacheHits = 0;
let testCacheMiss = 0;
let testBypass = 0;
let cacheHitCost = 0;
let cacheMissCost = 0;


const circleStyle = [
    { radius: 0.3, opacity: 0.3, fill: '#ADFF2F' },
    { radius: 0.3, opacity: 0.3, fill: '#f47983' },
    { radius: 0.3, opacity: 0.4, fill: '#4169E1' },
    { radius: 0.3, opacity: 0.9, fill: '#FFD700' },
    { radius: 0.3, opacity: 0.75, fill: '#D2B48C' },
]

const lineStyle = [
    { color: '#40de5a', width: .15, opacity: .4 },
    { color: '#FFA500', width: .15, opacity: .4 },
    { color: '#4169E1', width: .15, opacity: .4 }
]
/***************************************
 *  util functions
 */

/**
 * 
 * @param {string} roomName 
 * @returns {{ ew:'W'|'E', ewNum:number, ns:'N'|'S', nsNum:number, baseX:number, baseY:number } | null}
 */
function parseRoomName(roomName) {
    let parsed = roomNameCache.get(roomName);
    if (parsed) return parsed;

    const len = roomName.length;
    if (len < 4) {
        roomNameCache.set(roomName, null);
        return null;
    }

    const ewCode = roomName.charCodeAt(0);
    if (ewCode !== 69 && ewCode !== 87) {
        roomNameCache.set(roomName, null);
        return null;
    }

    let i = 1;
    let ewNum = 0;
    const ewStart = i;
    while (i < len) {
        const code = roomName.charCodeAt(i);
        if (code === 78 || code === 83) break;
        const digit = code - 48;
        if (digit < 0 || digit > 9) {
            roomNameCache.set(roomName, null);
            return null;
        }
        ewNum = ewNum * 10 + digit;
        i++;
    }
    if (i === ewStart || i >= len) {
        roomNameCache.set(roomName, null);
        return null;
    }

    const nsCode = roomName.charCodeAt(i);
    if (nsCode !== 78 && nsCode !== 83) {
        roomNameCache.set(roomName, null);
        return null;
    }
    i++;
    if (i >= len) {
        roomNameCache.set(roomName, null);
        return null;
    }

    let nsNum = 0;
    const nsStart = i;
    while (i < len) {
        const digit = roomName.charCodeAt(i) - 48;
        if (digit < 0 || digit > 9) {
            roomNameCache.set(roomName, null);
            return null;
        }
        nsNum = nsNum * 10 + digit;
        i++;
    }
    if (i === nsStart) {
        roomNameCache.set(roomName, null);
        return null;
    }

    parsed = {
        ew: /** @type {'W'|'E'} */(ewCode === 87 ? 'W' : 'E'),
        ewNum,
        ns: /** @type {'N'|'S'} */(nsCode === 83 ? 'S' : 'N'),
        nsNum,
        baseX: (ewCode === 87 ? halfWorldSize - ewNum : halfWorldSize + ewNum + 1) * 50,
        baseY: (nsCode === 83 ? halfWorldSize + nsNum + 1 : halfWorldSize - nsNum) * 50
    };
    roomNameCache.set(roomName, parsed);
    return parsed;
}

/**
 *  官方映射：https://github.com/screeps/driver/blob/d551e857615ef79b0dff1e7bcdc82a1797fab9e0/lib/path-finder.js
 *  统一到大地图坐标，平均单次开销0.00005
 * @param {RoomPosition} pos 
 */
function formalize(pos) {
    let parsed = parseRoomName(pos.roomName);
    if (parsed) {
        return {
            x: parsed.baseX + pos.x,
            y: parsed.baseY + pos.y
        }
    } // else 房间名字不是正确格式
    return {}
}

/**
 * 
 * @param {number} tile 
 * @returns 
 */
function tile2Pos(tile) {
    const cached = tile2PosCache.get(tile);
    if (cached) return cached;

    const y = tile >> 14;
    const x = tile & 0x3fff;
    const rx = x / 50 | 0, ry = y / 50 | 0;
    const roomName = (rx <= halfWorldSize ? 'W' + (halfWorldSize - rx) : 'E' + (rx - halfWorldSize - 1)) +
        (ry <= halfWorldSize ? 'N' + (halfWorldSize - ry) : 'S' + (ry - halfWorldSize - 1));
    const pos = new RoomPosition(x % 50, y % 50, roomName);
    tile2PosCache.set(tile, pos);
    return pos;
}


/**
 * 解析带 shard 前缀的房间名（约定格式：shardX/W1N1）
 * @param {string} roomName
 * @returns {{ shard: string | null, room: string }}
 */
function parseShardRoomName(roomName) {
    if (typeof roomName !== 'string') return { shard: null, room: roomName };
    const idx = roomName.indexOf('/');
    if (idx === -1) return { shard: null, room: roomName };
    const shard = roomName.slice(0, idx);
    const room = roomName.slice(idx + 1);
    return { shard: shard || null, room };
}

function getAdjacents(pos) {
    let posArray = [];
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            posArray.push({
                x: pos.x + i,
                y: pos.y + j
            })
        }
    }
    return posArray;
}

/**
 *  阉割版isEqualTo，提速
 * @param {RoomPosition} pos1 
 * @param {RoomPosition} pos2 
 */
function isEqual(pos1, pos2) {
    return pos1.x === pos2.x && pos1.y === pos2.y && pos1.roomName == pos2.roomName;
}

/**
 *  兼容房间边界
 *  参数具有x和y属性就行
 * @param {RoomPosition} pos1 
 * @param {RoomPosition} pos2 
 */
function isNear(pos1, pos2) {
    if (pos1.roomName == pos2.roomName) {    // undefined == undefined 也成立
        return -1 <= pos1.x - pos2.x && pos1.x - pos2.x <= 1 && -1 <= pos1.y - pos2.y && pos1.y - pos2.y <= 1;
    } else if (pos1.roomName && pos2.roomName) {    // 是完整的RoomPosition
        if (pos1.x + pos2.x != 49 && pos1.y + pos2.y != 49) return false;    // 肯定不是两个边界点, 0.00003 cpu
        let parsed1 = parseRoomName(pos1.roomName);
        let parsed2 = parseRoomName(pos2.roomName);
        if (parsed1 && parsed2) {
            let formalizedEW = parsed1.baseX + pos1.x - parsed2.baseX - pos2.x;
            let formalizedNS = parsed1.baseY + pos1.y - parsed2.baseY - pos2.y;
            return -1 <= formalizedEW && formalizedEW <= 1 && -1 <= formalizedNS && formalizedNS <= 1;
        }
    }
    return false
}

/** 
 * 
 * @param {RoomPosition} pos1 
 * @param {RoomPosition} pos2 
 * @param {number} range 
 * @returns {boolean}
*/
function inRange(pos1, pos2, range) {
    if (pos1.roomName == pos2.roomName) {
        return -range <= pos1.x - pos2.x && pos1.x - pos2.x <= range && -range <= pos1.y - pos2.y && pos1.y - pos2.y <= range;
    } else {
        try {
            pos1 = formalize(pos1);
            pos2 = formalize(pos2);
            return pos1.x && pos2.x && inRange(pos1, pos2, range);
        } catch (error) {
            console.log(`inRange: pos1: [${typeof pos1}, ${JSON.stringify(pos1)}] pos2: [${typeof pos2}, ${JSON.stringify(pos2)}}]\nposArray: ${JSON.stringify(posArray)}\n${error}`);
            return false;
        }
    }
}

/**
 *  fromPos和toPos是pathFinder寻出的路径上的，只可能是同房相邻点或者跨房边界点
 * @param {RoomPosition} fromPos 
 * @param {RoomPosition} toPos 
 */
function getDirection(fromPos, toPos) {
    if (fromPos.roomName === toPos.roomName) {
        if (toPos.x > fromPos.x) {    // 下一步在右边
            if (toPos.y > fromPos.y) {    // 下一步在下面
                return BOTTOM_RIGHT;
            } else if (toPos.y === fromPos.y) { // 下一步在正右
                return RIGHT;
            }
            return TOP_RIGHT;   // 下一步在上面
        } else if (toPos.x === fromPos.x) { // 横向相等
            if (toPos.y > fromPos.y) {    // 下一步在下面
                return BOTTOM;
            } else if (toPos.y < fromPos.y) {
                return TOP;
            }
            return 0;
        } else {  // 下一步在左边
            if (toPos.y > fromPos.y) {    // 下一步在下面
                return BOTTOM_LEFT;
            } else if (toPos.y === fromPos.y) {
                return LEFT;
            }
            return TOP_LEFT;
        }
    } else {  // 房间边界点
        if (fromPos.x <= 1 || fromPos.x >= 48) {  // 左右相邻的房间，只需上下移动（左右边界会自动弹过去）
            if (toPos.y > fromPos.y) {   // 下一步在下面
                if (fromPos.x === 1) return BOTTOM_LEFT;
                if (fromPos.x === 48) return BOTTOM_RIGHT;
                return BOTTOM;
            } else if (toPos.y < fromPos.y) { // 下一步在上
                if (fromPos.x === 1) return TOP_LEFT;
                if (fromPos.x === 48) return TOP_RIGHT;
                return TOP
            } // else 正左正右
            if (fromPos.x === 1) return LEFT;
            if (fromPos.x === 48) return RIGHT;
            return 0;
        } else if (fromPos.y <= 1 || fromPos.y >= 48) {    // 上下相邻的房间，只需左右移动（上下边界会自动弹过去）
            if (toPos.x > fromPos.x) {    // 下一步在右边
                if (fromPos.y === 1) return TOP_RIGHT;
                if (fromPos.y === 48) return BOTTOM_RIGHT;
                return RIGHT;
            } else if (toPos.x < fromPos.x) {
                if (fromPos.y === 1) return TOP_LEFT;
                if (fromPos.y === 48) return BOTTOM_LEFT;
                return LEFT;
            }// else 正上正下
            if (fromPos.y === 1) return TOP;
            if (fromPos.y === 48) return BOTTOM;
            return 0;
        }
        return 0;       
    }
}

/**
 * 
 * @param {string} roomName 
 * @returns {boolean}
 */
function isHighWay(roomName) {
    // 1. 检查末位（Y坐标个位）
    if (roomName.charCodeAt(roomName.length - 1) === 48) return true;

    // 2. 探测 N(78) 或 S(83) 的位置并检查前一位
    // Index 2（例如 E0N1）
    let code = roomName.charCodeAt(2);
    if (code === 78 || code === 83) return roomName.charCodeAt(1) === 48;

    // Index 3（例如 E10N1）
    code = roomName.charCodeAt(3);
    if (code === 78 || code === 83) return roomName.charCodeAt(2) === 48;

    // Index 4（例如 E100N1）
    code = roomName.charCodeAt(4);
    if (code === 78 || code === 83) return roomName.charCodeAt(3) === 48;

    return false;
}

/**
 *  缓存的路径和当前moveTo参数相同
 * @param {MyPath} path 
 * @param {*} ops 
 */
function isSameOps(path, ops) {
    return path.ignoreRoads == !!ops.ignoreRoads &&
        path.ignoreSwamps == !!ops.ignoreSwamps &&
        path.ignoreStructures == !!ops.ignoreDestructibleStructures;
}

/**
 *  检查creep是否有指定的bodypart
 * @param {BodyPartDefinition[]} body 
 * @param {BodyPartConstant} type 
 * @returns {boolean}
 */

function hasActiveBodypart(body, type) {
    if (!body) {
        return true;
    }

    for (let i = body.length - 1; i >= 0; i--) {
        if (body[i].hits <= 0)
            break;
        if (body[i].type === type)
            return true;
    }

    return false;

}

function isClosedRampart(structure) {
    return structure.structureType == STRUCTURE_RAMPART && !structure.my && !structure.isPublic;
}

/**
 *  查看是否有挡路建筑
 * @param {Room} room
 * @param {RoomPosition} pos 
 * @param {boolean} ignoreStructures
 */
function isObstacleStructure(room, pos, ignoreStructures) {
    let consSite = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos);
    if (_.any(consSite, c => c.my && obstacles.has(c.structureType))) {  // 工地会挡路
        return true;
    }
    for (const s of room.lookForAt(LOOK_STRUCTURES, pos)) {
        if (!s.hits || s.ticksToDeploy) {     // 是新手墙或者无敌中的invaderCore
            return true;
        } else if (obstacles.has(s.structureType)) {  // 挡路的建筑
            if (s.my || !ignoreStructures) {
                return true;
            }
        } else if (!ignoreStructures && isClosedRampart(s)) {
            return true
        }
    }
    return false;
    // let possibleStructures = room.lookForAt(LOOK_STRUCTURES, pos);  // room.lookForAt比pos.lookFor快
    // 万一有人把路修在extension上，导致需要每个建筑都判断，最多重叠3个建筑（rap+road+其他）
    // return obstacles.has(possibleStructures[0]) || obstacles.has(possibleStructures[1]) || obstacles.has(possibleStructures[2]);    // 条件判断平均每次0.00013cpu
}


/**
 * 初始化用于计算最大空地正方形的二维数组
 * 
 * @param {Uint8Array} terrain 
 * @param {CostMatrix} squadNoStructureCostMatrix 多 creep 寻路的 costMatrix
 * @param {CostMatrix} squadStructureCostMatrix 多 creep 寻路的 costMatrix
 */
function initialMap(terrain, squadNoStructureCostMatrix, squadStructureCostMatrix) {
    const squareMap = new Uint8Array(2500);
    const edgeArray = new Uint16Array(2500 << 3);
    const edgeIdx = new Uint8Array(2500);

    // 设置动态规划的递推所需的初始值，只需考虑房间正方形左、上两条边的所有格子
    for (let u = 0; u < 50; u++) {
        if (terrain[u] & TERRAIN_MASK_WALL) {
            squareMap[u] = 0;  // 是墙则0
        } else {
            squareMap[u] = 1;
            const v = u - 1;
            if (squareMap[v] === 0) {
                squadNoStructureCostMatrix.set(u, 0, unWalkableCost);
                squadStructureCostMatrix.set(u, 0, unWalkableCost);
            } else {
                edgeArray[(u << 3) + edgeIdx[u]++] = v;
                edgeArray[(v << 3) + edgeIdx[v]++] = u;
            }
        }
    }
    for (let y = 1, u = 50; y < 50; y++, u += 50) {
        if (terrain[u] & TERRAIN_MASK_WALL) {
            squareMap[u] = 0;  // 是墙则0
        } else {
            squareMap[u] = 1;
            const v = u - 50;
            if (squareMap[v] === 0) {
                squadNoStructureCostMatrix.set(0, y, unWalkableCost);
                squadStructureCostMatrix.set(0, y, unWalkableCost);
            } else {
                edgeArray[(u << 3) + edgeIdx[u]++] = v;
                edgeArray[(v << 3) + edgeIdx[v]++] = u;
            }
        }
    }
    return { squareMap, edgeArray, edgeIdx };
}

/**
 * 
 * 
 * 
 * @param {Room} room 
 * @param {CostMatrix} costMatrix 单 creep 寻路的 costMatrix，有路
 * @param {CostMatrix} squadNoStructureCostMatrix 多 creep 寻路的 costMatrix
 * @param {CostMatrix} squadStructureCostMatrix
 */
function getEdgeArray(room, costMatrix, squadNoStructureCostMatrix, squadStructureCostMatrix) {
    const terrain = room.getTerrain().getRawBuffer();
    const { squareMap, edgeArray, edgeIdx } = initialMap(terrain, squadNoStructureCostMatrix, squadStructureCostMatrix);    // 二维数组，每一个值代表以此为右下角的最大空地正方形边长
    let current, cost, idx, u, v, w;

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
                squadNoStructureCostMatrix.set(x, y, unWalkableCost);
                squadStructureCostMatrix.set(x, y, unWalkableCost);

            } else {
                u = idx - 1;
                v = idx - 50;
                w = idx - 51;
                const uTerrain = terrain[u], vTerrain = terrain[v], wTerrain = terrain[w];
                if (uTerrain !== TERRAIN_MASK_WALL) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = u;
                    edgeArray[(u << 3) + edgeIdx[u]++] = idx;
                    if (vTerrain !== TERRAIN_MASK_WALL) {
                        edgeArray[(idx << 3) + edgeIdx[idx]++] = v;
                        edgeArray[(v << 3) + edgeIdx[v]++] = idx;

                        edgeArray[(v << 3) + edgeIdx[v]++] = u;
                        edgeArray[(u << 3) + edgeIdx[u]++] = v;
                    }
                } else if (vTerrain !== TERRAIN_MASK_WALL) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = v;
                    edgeArray[(v << 3) + edgeIdx[v]++] = idx;
                }
                if (wTerrain !== TERRAIN_MASK_WALL) {
                    edgeArray[(idx << 3) + edgeIdx[idx]++] = w;
                    edgeArray[(w << 3) + edgeIdx[w]++] = idx;
                }

                // DP: 最大空地正方形
                current = squareMap[w];
                if (current > squareMap[u]) {  // 取min
                    current = squareMap[u];
                }
                if (current > squareMap[v]) {  // 取min
                    current = squareMap[v];
                }
                current = current + 1;  // 递推
                squareMap[idx] = current;
                if (current >= 2) {     // 有 2x2 空地正方形，可以走，要看 terrain 决定 cost
                    // 如果左上格是无路的 swamp，当前格、正上格、正左格也代价大
                    if (wTerrain === TERRAIN_MASK_SWAMP && costMatrix.get(x - 1, y - 1) !== 1) {
                        squadNoStructureCostMatrix.get(x, y) || squadNoStructureCostMatrix.set(x, y, 5);
                        squadStructureCostMatrix.get(x, y) || squadStructureCostMatrix.set(x, y, 5);

                        squadNoStructureCostMatrix.get(x - 1, y) || squadNoStructureCostMatrix.set(x - 1, y, 5);
                        squadStructureCostMatrix.get(x - 1, y) || squadStructureCostMatrix.set(x - 1, y, 5);

                        squadNoStructureCostMatrix.get(x, y - 1) || squadNoStructureCostMatrix.set(x, y - 1, 5);
                        squadStructureCostMatrix.get(x, y - 1) || squadStructureCostMatrix.set(x, y - 1, 5);
                    } // else costMatrix 为默认0，按地形是平原 1 
                } else {
                    squadNoStructureCostMatrix.set(x, y, unWalkableCost);
                    squadStructureCostMatrix.set(x, y, unWalkableCost);
                }
            }
            //rv.text(squareMap[x + y*50], x, y, { opacity: 0.3 });
        }
    }
    return { edgeArray, squareMap };
}


/**
 *  为房间保存costMatrix，ignoreDestructibleStructures这个参数的两种情况各需要一个costMatrix
 *  设置costMatrix缓存的过期时间
 * @param {Room} room 
 * @param {RoomPosition | undefined} pos
 */
function generateCostMatrix(room, pos) {
    const noStructureCostMat = new PathFinder.CostMatrix; // 不考虑可破坏的建筑，但是要考虑墙上资源点和无敌的3种建筑，可能还有其他不能走的？
    const structureCostMat = new PathFinder.CostMatrix;   // 在noStructrue的基础上加上所有不可行走的建筑
    const noStructureSquadCostMatrix = new PathFinder.CostMatrix;
    const squadStructureCostMatrix = new PathFinder.CostMatrix;
    let totalStructures = room.find(FIND_STRUCTURES);

    // 优化：避免创建大数组，分别遍历
    let sources = room.find(FIND_SOURCES);
    for (let i = sources.length; i--;) {
        noStructureCostMat.set(sources[i].pos.x, sources[i].pos.y, unWalkableCost);
    }
    let minerals = room.find(FIND_MINERALS);
    for (let i = minerals.length; i--;) {
        noStructureCostMat.set(minerals[i].pos.x, minerals[i].pos.y, unWalkableCost);
    }
    let deposits = room.find(FIND_DEPOSITS);
    for (let i = deposits.length; i--;) {
        noStructureCostMat.set(deposits[i].pos.x, deposits[i].pos.y, unWalkableCost);
    }

    let x, y, noviceWall, deployingCore, centralPortal;
    let clearDelay = Infinity;
    const roomName = room.name;

    if (room.controller && (room.controller.my || room.controller.safeMode)) {  // 自己的工地不能踩
        for (let consSite of room.find(FIND_CONSTRUCTION_SITES)) {
            if (obstacles.has(consSite.structureType)) {
                x = consSite.pos.x; y = consSite.pos.y;
                noStructureCostMat.set(x, y, 255);
                structureCostMat.set(x, y, 255);
            }
        }
    }

    for (let i = totalStructures.length; i--;) {
        let s = totalStructures[i];
        x = s.pos.x; y = s.pos.y;

        switch (s.structureType) {
            case STRUCTURE_INVADER_CORE:  // 第1种可能无敌的建筑
                if (s.ticksToDeploy) {
                    deployingCore = true;
                    clearDelay = clearDelay > s.ticksToDeploy ? s.ticksToDeploy : clearDelay;
                    noStructureCostMat.set(x, y, unWalkableCost);
                    noStructureSquadCostMatrix.set(x, y, unWalkableCost);
                    noStructureSquadCostMatrix.set(x + 1, y, unWalkableCost);
                    noStructureSquadCostMatrix.set(x, y + 1, unWalkableCost);
                    noStructureSquadCostMatrix.set(x + 1, y + 1, unWalkableCost);
                }
                structureCostMat.set(x, y, unWalkableCost);
                squadStructureCostMatrix.set(x, y, unWalkableCost);
                squadStructureCostMatrix.set(x + 1, y, unWalkableCost);
                squadStructureCostMatrix.set(x, y + 1, unWalkableCost);
                squadStructureCostMatrix.set(x + 1, y + 1, unWalkableCost);
                break;
            case STRUCTURE_PORTAL:        // 第2种无敌建筑
                if (!isHighWay(roomName)) {
                    centralPortal = true;
                    clearDelay = clearDelay > s.ticksToDecay ? s.ticksToDecay : clearDelay;
                }
                structureCostMat.set(x, y, unWalkableCost);
                noStructureCostMat.set(x, y, unWalkableCost);

                squadStructureCostMatrix.set(x, y, unWalkableCost);
                squadStructureCostMatrix.set(x + 1, y, unWalkableCost);
                squadStructureCostMatrix.set(x, y + 1, unWalkableCost);
                squadStructureCostMatrix.set(x + 1, y + 1, unWalkableCost);

                noStructureSquadCostMatrix.set(x, y, unWalkableCost);
                noStructureSquadCostMatrix.set(x + 1, y, unWalkableCost);
                noStructureSquadCostMatrix.set(x, y + 1, unWalkableCost);
                noStructureSquadCostMatrix.set(x + 1, y + 1, unWalkableCost);
                break;
            case STRUCTURE_WALL:        // 第3种可能无敌的建筑
                if (!s.hits) {
                    noviceWall = true;
                    noStructureCostMat.set(x, y, unWalkableCost);
                    noStructureSquadCostMatrix.set(x, y, unWalkableCost);
                    if (s.pos.x < 49) {
                        noStructureSquadCostMatrix.set(x + 1, y, unWalkableCost);
                        if (s.pos.y < 49) {
                            noStructureSquadCostMatrix.set(x, y + 1, unWalkableCost);
                            noStructureSquadCostMatrix.set(x + 1, y + 1, unWalkableCost);
                        }
                    } else if (s.pos.y < 49) {
                        noStructureSquadCostMatrix.set(x, y + 1, unWalkableCost);
                    }
                }
                structureCostMat.set(x, y, unWalkableCost);

                squadStructureCostMatrix.set(x, y, unWalkableCost);
                if (s.pos.x < 49) {
                    squadStructureCostMatrix.set(x + 1, y, unWalkableCost);
                    if (s.pos.y < 49) {
                        squadStructureCostMatrix.set(x, y + 1, unWalkableCost);
                        squadStructureCostMatrix.set(x + 1, y + 1, unWalkableCost);
                    }
                } else if (s.pos.y < 49) {
                    squadStructureCostMatrix.set(x, y + 1, unWalkableCost);
                }
                break;
            case STRUCTURE_ROAD:
                if (noStructureCostMat.get(x, y) == 0) {  // 不是在3种无敌建筑或墙中资源上
                    noStructureCostMat.set(x, y, 1);
                    if (structureCostMat.get(x, y) == 0) {     // 不是在不可行走的建筑上
                        structureCostMat.set(x, y, 1);
                    }
                }
                break;
            case STRUCTURE_RAMPART:
                if (!s.my && !s.isPublic) {
                    structureCostMat.set(x, y, unWalkableCost);

                    squadStructureCostMatrix.set(x, y, unWalkableCost);
                    squadStructureCostMatrix.set(x + 1, y, unWalkableCost);
                    squadStructureCostMatrix.set(x, y + 1, unWalkableCost);
                    squadStructureCostMatrix.set(x + 1, y + 1, unWalkableCost);
                }
                break;
            default:
                if (obstacles.has(s.structureType)) {
                    // console.log(`${Game.time}: generateCostMatrix: ${s.structureType} at ${x}, ${y}`);
                    structureCostMat.set(x, y, unWalkableCost);
                    squadStructureCostMatrix.set(x, y, unWalkableCost);
                    squadStructureCostMatrix.set(x + 1, y, unWalkableCost);
                    squadStructureCostMatrix.set(x, y + 1, unWalkableCost);
                    squadStructureCostMatrix.set(x + 1, y + 1, unWalkableCost);
                }
                break;
        }
    }

    const { edgeArray, squareMap } = getEdgeArray(room, structureCostMat, noStructureSquadCostMatrix, squadStructureCostMatrix);

    // 房间出口设为沼泽
    for (let i = 1, j = 50; i < 49; i++, j += 50) {
        if (squareMap[i]) {
            noStructureCostMat.set(i, 0, 5);
            structureCostMat.set(i, 0, 5);
            squadStructureCostMatrix.get(i, 0) || squadStructureCostMatrix.set(i, 0, 5);
            squadStructureCostMatrix.get(i, 1) || squadStructureCostMatrix.set(i, 1, 5);
            noStructureSquadCostMatrix.get(i, 0) || noStructureSquadCostMatrix.set(i, 0, 5);
            noStructureSquadCostMatrix.get(i, 1) || noStructureSquadCostMatrix.set(i, 1, 5);
        }
        if (squareMap[i + 2450]) {
            noStructureCostMat.set(i, 49, 5);
            structureCostMat.set(i, 49, 5);
            squadStructureCostMatrix.get(i, 49) || squadStructureCostMatrix.set(i, 49, 5);
            noStructureSquadCostMatrix.get(i, 49) || noStructureSquadCostMatrix.set(i, 49, 5);
        }
        if (squareMap[j]) {
            noStructureCostMat.set(0, i, 5);
            structureCostMat.set(0, i, 5);
            squadStructureCostMatrix.get(0, i) || squadStructureCostMatrix.set(0, i, 5);
            squadStructureCostMatrix.get(1, i) || squadStructureCostMatrix.set(1, i, 5);
            noStructureSquadCostMatrix.get(0, i) || noStructureSquadCostMatrix.set(0, i, 5);
            noStructureSquadCostMatrix.get(1, i) || noStructureSquadCostMatrix.set(1, i, 5);
        }
        if (squareMap[j + 49]) {
            noStructureCostMat.set(49, i, 5);
            structureCostMat.set(49, i, 5);
            squadStructureCostMatrix.get(49, i) || squadStructureCostMatrix.set(49, i, 5);
            noStructureSquadCostMatrix.get(49, i) || noStructureSquadCostMatrix.set(49, i, 5);
        }
    }

    costMatrixCache[roomName] = {
        roomName: roomName,
        my: room.controller && room.controller.my,
        true: noStructureCostMat,   // 对应 ignoreDestructibleStructures = true
        false: structureCostMat,     // 对应 ignoreDestructibleStructures = false
        squad: {
            true: noStructureSquadCostMatrix,   // 对应 ignoreDestructibleStructures = true
            false: squadStructureCostMatrix,     // 对应 ignoreDestructibleStructures = false
        },
        edgeArray: edgeArray,
    };

    let avoids = [];
    let avoidChanged = false;
    if (room.controller && room.controller.owner && !room.controller.my && hostileCostMatrixClearDelay) {  // 他人房间，删除costMat才能更新被拆的建筑位置
        if (!(Game.time + hostileCostMatrixClearDelay in costMatrixCacheTimer)) {
            costMatrixCacheTimer[Game.time + hostileCostMatrixClearDelay] = [];
        }
        costMatrixCacheTimer[Game.time + hostileCostMatrixClearDelay].push({
            roomName: roomName,
            avoids: avoids
        });   // 记录清理时间
    } else if (noviceWall || deployingCore || centralPortal) { // 如果遇到可能消失的挡路建筑，这3种情况下clearDelay才可能被赋值为非Infinity
        if (noviceWall) {    // 如果看见新手墙
            const neighbors = Game.map.describeExits(roomName);
            for (const direction in neighbors) {
                const status = Game.map.getRoomStatus(neighbors[direction]);
                if (status.status == 'closed') {
                    if (!avoidRooms.has(neighbors[direction])) {
                        avoidRooms.add(neighbors[direction]);
                        avoidChanged = true;
                    }
                } else if (status.status != 'normal' && status.timestamp != null) {
                    let estimateTickToChange = (status.timestamp - new Date().getTime()) / 10000; // 10s per tick
                    clearDelay = clearDelay > estimateTickToChange ? Math.ceil(estimateTickToChange) : clearDelay;
                }
            }
            if (pos) {  // 如果知道自己的pos
                for (let direction in neighbors) {
                    if (!avoidRooms.has(neighbors[direction])) {
                        let exits = room.find(+direction);
                        if (PathFinder.search(pos, exits, { maxRooms: 1, roomCallback: () => noStructureCostMat }).incomplete) {    // 此路不通
                            avoidRooms.add(neighbors[direction]);
                            avoids.push(neighbors[direction]);
                            avoidChanged = true;
                        }
                    }
                }
            }
        }
        //console.log(roomName + ' costMat 设置清理 ' + clearDelay);
        if (!(Game.time + clearDelay in costMatrixCacheTimer)) {
            costMatrixCacheTimer[Game.time + clearDelay] = [];
        }
        costMatrixCacheTimer[Game.time + clearDelay].push({
            roomName: roomName,
            avoids: avoids  // 因新手墙导致的avoidRooms需要更新
        });   // 记录清理时间
    }
    //console.log('生成costMat ' + roomName);
}

/**
 *  把路径上有视野的位置的正向移动方向拿到，只有在找新路时调用，找新路时会把有视野房间都缓存进costMatrixCache
 * @param {MyPath} path 
 */
function generateDirectionArray(path) {
    let posArray = path.posArray
    let directionArray = new Array(posArray.length);
    let incomplete = false;
    for (let idx = 1; idx in posArray; idx++) {
        if (posArray[idx - 1].roomName in costMatrixCache) {    // 有costMat，是准确路径，否则需要在有视野时checkRoom()
            directionArray[idx] = getDirection(posArray[idx - 1], posArray[idx]);
        } else if (!incomplete) {   // 记录第一个缺失准确路径的位置
            incomplete = idx;
        }
    }
    path.directionArray = directionArray;
}

/**
 *  第一次拿到该room视野，startIdx是新房中唯一有direction的位置
 * @param {Room} room 
 * @param {MyPath} path 
 * @param {number} startIdx 
 */
function checkRoom(room, path, startIdx) {
    if (!(room.name in costMatrixCache)) {
        generateCostMatrix(room, path.posArray[startIdx]);
    }
    const thisRoomName = room.name
    /** @type {CostMatrix} */
    let costMat = costMatrixCache[thisRoomName][path.ignoreStructures];
    let posArray = path.posArray;
    let directionArray = path.directionArray;
    let i;
    for (i = startIdx; i + 1 in posArray && posArray[i].roomName == thisRoomName; i++) {
        if (costMat.get(posArray[i].x, posArray[i].y) == 255) {   // 路上有东西挡路
            return false;
        }
        directionArray[i + 1] = getDirection(posArray[i], posArray[i + 1]);
    }
    return true;
}

/**
 *  第一次拿到该room视野，startIdx是新房中要检查的第一个位置
 * @param {Room} room 
 * @param {MyPath} path 
 * @param {number} startIdx 
 */
function checkSquadRoom(room, path, startIdx) {
    if (!(room.name in costMatrixCache)) {
        generateCostMatrix(room);
    }
    const thisRoomName = room.name;
    /** @type {CostMatrix} */
    let costMat = costMatrixCache[thisRoomName]['squad'][findPathIgnoreCondition];
    let posArray = path.posArray;
    let i;
    for (i = startIdx; i + 1 in posArray && posArray[i].roomName == thisRoomName; i++) {
        if (costMat.get(posArray[i].x, posArray[i].y) == 255) {   // 路上有东西挡路
            return false;
        }
    }
    return true;

}

let temporalAvoidFrom, temporalAvoidTo, curAvoidRooms, curAvoidExits;
function routeCallback(nextRoomName, fromRoomName) {    // 避开avoidRooms设置了的
    if (curAvoidRooms.has(nextRoomName)) {
        //console.log('Infinity at ' + nextRoomName);
        return Infinity;
    } else if (curAvoidExits.has(fromRoomName) && curAvoidExits.get(fromRoomName).has(nextRoomName)) {
        return Infinity;
    }
    return isHighWay(nextRoomName) ? 1 : 1.15;
}
function bypassRouteCallback(nextRoomName, fromRoomName) {
    if (fromRoomName == temporalAvoidFrom && nextRoomName == temporalAvoidTo) {
        //console.log(`Infinity from ${fromRoomName} to ${nextRoomName}`);
        return Infinity;
    }
    return routeCallback(nextRoomName, fromRoomName);
}
/**
 *  遇到跨房寻路，先以房间为单位寻route，再寻精细的path
 * @param {string} fromRoomName 
 * @param {string} toRoomName 
 * @param {boolean} bypass
 */
function findRoute(fromRoomName, toRoomName, bypass) {  // TODO 以后跨shard寻路也放在这个函数里
    //console.log('findRoute', fromRoomName, toRoomName, bypass);
    return Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: bypass ? bypassRouteCallback : routeCallback });
}

/**
 * @param {RoomPosition} pos
 * @param {Room} room 
 * @param {CostMatrix} costMat 
 */
function checkTemporalAvoidExit(pos, room, costMat) {    // 用于记录因creep堵路导致的房间出口临时封闭
    let neighbors = Game.map.describeExits(room.name);
    temporalAvoidFrom = temporalAvoidTo = '';   // 清空旧数据
    for (let direction in neighbors) {
        if (!curAvoidRooms.has(neighbors[direction])) {
            let exits = room.find(+direction);
            if (PathFinder.search(pos, exits, {
                maxRooms: 1,
                roomCallback: () => costMat
            }).incomplete) {    // 此路不通
                temporalAvoidFrom = room.name;
                temporalAvoidTo = neighbors[direction];
            }
        }
    }
}
function routeReduce(temp, item) {
    temp[item.room] = 1;
    return temp;
}

/**
 * 
 * @param {RoomPosition} pos 
 * @returns 
 */
function lookCreepAt(pos) {
    return pos.lookFor(LOOK_CREEPS) || pos.lookFor(LOOK_POWER_CREEPS);
}

function bypassHostile(creep) {
    return !creep.my;
}

let findPathIgnoreCondition;
let bypassRoomName, bypassCostMat, userCostCallback, costMat, route;
function bypassRoomCallback(roomName) {
    if (avoidRooms.has(roomName)) {
        return false;
    }
    if (roomName === bypassRoomName) {     // 在findTemporalRoute函数里刚刚建立了costMatrix
        costMat = bypassCostMat;
    } else {
        const roomCache = costMatrixCache[roomName];
        costMat = roomCache ? roomCache[findPathIgnoreCondition] : emptyCostMatrix;
    }

    if (userCostCallback) {
        const resultCostMat = userCostCallback(roomName, costMatrixCache[roomName] ? costMat.clone() : new PathFinder.CostMatrix);
        if (resultCostMat instanceof PathFinder.CostMatrix) {
            costMat = resultCostMat;
        }
    }
    return costMat;
}

function bypassRoomCallbackWithRoute(roomName) {
    if (roomName in route) {
        if (roomName == bypassRoomName) {     // 在findTemporalRoute函数里刚刚建立了costMatrix
            costMat = bypassCostMat;
        } else {
            const roomCache = costMatrixCache[roomName];
            costMat = roomCache ? roomCache[findPathIgnoreCondition] : emptyCostMatrix;
        }

        if (userCostCallback) {
            let resultCostMat = userCostCallback(roomName, roomName in costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                costMat = resultCostMat;
            }
        }
        return costMat;
    }
    return false;
}
/**
 *  影响参数：ignoreRoads, ignoreDestructibleStructures, ignoreSwamps, costCallback, range, bypassRange
 *  及所有PathFinder参数：plainCost, SwampCost, masOps, maxRooms, maxCost, heuristicWeight
 * @param {Creep} creep 
 * @param {RoomPosition} toPos 
 * @param {MoveToOpts} ops 
 */
function findTemporalPath(creep, toPos, ops) {
    let nearbyCreeps;
    // 周围所有creep
    nearbyCreeps = creep.pos.findInRange(FIND_CREEPS, ops.bypassRange).concat(
        creep.pos.findInRange(FIND_POWER_CREEPS, ops.bypassRange)
    )

    if (ops.bypassHostileCreeps && !ops.bypassMyCreeps) {         // 情况 1：只绕过别人的 creep
        nearbyCreeps = nearbyCreeps.filter(bypassHostile);
    } else if (ops.bypassMyCreeps && !ops.bypassHostileCreeps) {      // 情况 2：只绕过自己的
        nearbyCreeps = nearbyCreeps.filter(creep => creep.my);
    }   // else 都要绕

    if (!(creep.room.name in costMatrixCache)) { // 这个房间的costMatrix已经被删了
        generateCostMatrix(creep.room, creep.pos);
    }
    /** @type {CostMatrix} */
    bypassCostMat = costMatrixCache[creep.room.name][findPathIgnoreCondition].clone();
    for (let c of nearbyCreeps) {
        bypassCostMat.set(c.pos.x, c.pos.y, 255);
    }
    bypassRoomName = creep.room.name;
    userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;

    /**@type {PathFinderOpts} */
    let PathFinderOpts = {
        maxRooms: ops.maxRooms,
        maxCost: ops.maxCost,
        maxOps: 200,
        heuristicWeight: ops.heuristicWeight || 1.2
    }
    if (ops.ignoreSwamps) {   // HELP 这里有没有什么不增加计算量的简短写法
        PathFinderOpts.plainCost = ops.plainCost;
        PathFinderOpts.swampCost = ops.swampCost || 1;
    } else if (ops.ignoreRoads) {
        PathFinderOpts.plainCost = ops.plainCost;
        PathFinderOpts.swampCost = ops.swampCost || 5;
    } else {
        PathFinderOpts.plainCost = ops.plainCost || 2;
        PathFinderOpts.swampCost = ops.swampCost || 10;
    }

    if (creep.pos.roomName != toPos.roomName) { // findRoute会导致非最优path的问题

        curAvoidRooms = ops.avoidRooms || avoidRooms;
        curAvoidExits = ops.avoidExits || avoidExits;

        checkTemporalAvoidExit(creep.pos, creep.room, bypassCostMat);   // 因为creep挡路导致的无法通行的出口
        route = findRoute(creep.pos.roomName, toPos.roomName, true);
        if (route == ERR_NO_PATH) {
            return false;
        }
        PathFinderOpts.maxRooms = PathFinderOpts.maxRooms || route.length + 1;
        // PathFinderOpts.maxOps = ops.maxOps || 2000 + route.length ** 2 * 100;  // 跨10room则有2000+10*10*100=12000
        route = route.reduce(routeReduce, { [creep.pos.roomName]: 1 });     // 因为 key in Object 比 Array.includes(value) 快，但不知道值不值得reduce
        PathFinderOpts.roomCallback = bypassRoomCallbackWithRoute;
    } else {
        // PathFinderOpts.maxOps = ops.maxOps;
        PathFinderOpts.roomCallback = bypassRoomCallback;
    }

    const creepCache = creepPathCache[creep.name];
    const posArray = creepCache.path.posArray;
    const goals = [{ pos: toPos, range: ops.range }];
    // 把 path 中当前 idx 之后的位置都加入 goals，寻到之前的 path 上都算成功
    for (let idx = creepCache.idx + 2; idx < posArray.length; idx++) {
        goals.push({ pos: posArray[idx], range: 0 });
    }
    let result = PathFinder.search(creep.pos, { pos: toPos, range: ops.range }, PathFinderOpts);
    if (result.incomplete && result.path.length <= 1) {
        return false;
    }
    // console.log(`${creep.name} temporal path: incomplete ${result.incomplete}, length ${result.path.length}`);
    result = result.path;
    const resultFinalPos = result[result.length - 1];
    if (resultFinalPos.getRangeTo(toPos) > ops.range) {  // 是寻到旧路上
        let idx;
        for (idx = creepCache.idx + 2; idx < posArray.length; idx++) {
            if (posArray[idx].getRangeTo(resultFinalPos) === 0) {
                idx++;
                break
            }
        }
        while (idx < posArray.length) {
            result.push(posArray[idx++]);
        }
    }
    creepCache.path = {     // 弄个新的自己走，不修改公用的缓存路，只会用于正向走所以也不需要start属性，idx属性会在startRoute中设置
        end: formalize(result[result.length - 1]),
        posArray: result,
        ignoreStructures: !!ops.ignoreDestructibleStructures
    }
    generateDirectionArray(creepCache.path);
    return true;
}

function squadTemporalRoomCallback(roomName) {
    if (roomName === bypassRoomName) {     // 在findTemporalRoute函数里刚刚建立了costMatrix
        costMat = bypassCostMat;
    } else {
        const roomCache = costMatrixCache[roomName];
        costMat = roomCache ? roomCache['squad'][findPathIgnoreCondition] : emptyCostMatrix;
    }
    if (userCostCallback) {
        let resultCostMat = userCostCallback(roomName, roomName in costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix);
        if (resultCostMat instanceof PathFinder.CostMatrix) {
            costMat = resultCostMat;
        }
    }
    return costMat;
}

/**
 * 
 * @param {Creep} leader 
 * @param {RoomPosition} toPos 
 * @param {*} ops 
 * @param {string} key 
 * @param {boolean} severe 
 * @param {Set<string>} squadNames 
 */
function findSquadTemporalPath(leader, toPos, ops, key, severe, squadNames) {
    bypassRoomName = leader.room.name;
    userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;
    const nearbyCreeps = leader.pos.findInRange(FIND_CREEPS, 5);
    /** @type {CostMatrix} */
    bypassCostMat = costMatrixCache[bypassRoomName]['squad'][findPathIgnoreCondition].clone();
    if (severe) {
        for (let c of nearbyCreeps) {
            if (!squadNames.has(c.name)) {
                bypassCostMat.set(c.pos.x, c.pos.y, 10);
                bypassCostMat.set(c.pos.x + 1, c.pos.y, bypassCostMat.get(c.pos.x + 1, c.pos.y) === 255 ? 255 : 10);
                bypassCostMat.set(c.pos.x, c.pos.y + 1, bypassCostMat.get(c.pos.x, c.pos.y + 1) === 255 ? 255 : 10);
                bypassCostMat.set(c.pos.x + 1, c.pos.y + 1, bypassCostMat.get(c.pos.x + 1, c.pos.y + 1) === 255 ? 255 : 10);
            }
        }
    } else {
        for (let c of nearbyCreeps) {
            if (creepToSquad.has(c.name) && !rerouteSquad.has(c.name)) {
                bypassCostMat.set(c.pos.x, c.pos.y, 255);
                bypassCostMat.set(c.pos.x + 1, c.pos.y, 255);
                bypassCostMat.set(c.pos.x, c.pos.y + 1, 255);
                bypassCostMat.set(c.pos.x + 1, c.pos.y + 1, bypassCostMat.get(c.pos.x + 1, c.pos.y + 1) === 255 ? 255 : 5);
                // leader.room.visual.circle(c.pos, { radius: 0.5, fill: 'red', opacity: 0.1 });
            }
        }
    }
    const PathFinderOpts = {
        maxRooms: ops.maxRooms || 10,
        maxCost: ops.maxCost || 1000,
        heuristicWeight: ops.heuristicWeight || 1.2,
        roomCallback: squadTemporalRoomCallback
    };
    let result = PathFinder.search(leader.pos, { pos: toPos, range: ops.range || 1 }, PathFinderOpts);
    if (result.incomplete && result.path.length <= 1) {
        return false;
    }
    result = result.path;
    creepCache.path = {
        end: formalize(result[result.length - 1]),
        posArray: result,
        ignoreStructures: findPathIgnoreCondition
    }
    return true;
}

/**
 * @param {{[roomName:string]:1}} temp 
 * @param {{room:string}} item 
 * @returns {{[roomName:string]:1}}
 */
function roomCallback(roomName) {
    if (avoidRooms.has(roomName)) {
        return false;
    }
    const roomCache = costMatrixCache[roomName];
    costMat = roomCache ? roomCache[findPathIgnoreCondition] : emptyCostMatrix;
    if (userCostCallback) {
        let resultCostMat = userCostCallback(roomName, roomCache ? costMat.clone() : new PathFinder.CostMatrix);
        if (resultCostMat instanceof PathFinder.CostMatrix) {
            costMat = resultCostMat;
        }
    }
    return costMat;
}
function roomCallbackWithRoute(roomName) {
    if (roomName in route) {
        const roomCache = costMatrixCache[roomName];
        costMat = roomCache ? roomCache[findPathIgnoreCondition] : emptyCostMatrix;
        //console.log('in route ' + roomName);
        if (userCostCallback) {
            let resultCostMat = userCostCallback(roomName, roomCache ? costMat.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                costMat = resultCostMat;
            }
        }
        return costMat;
    }
    //console.log('out route ' + roomName);
    return false;   // 不在route上的不搜索
}
/**
 *  影响参数：ignoreRoads, ignoreDestructibleStructures, ignoreSwamps, costCallback, range
 *  及所有PathFinder参数：plainCost, SwampCost, masOps, maxRooms, maxCost, heuristicWeight
 * @param {RoomPosition} fromPos 
 * @param {RoomPosition} toPos 
 * @param {MoveToOpts} ops 
 */
function findPath(fromPos, toPos, ops) {

    if (!(fromPos.roomName in costMatrixCache) && fromPos.roomName in Game.rooms) {   // 有视野没costMatrix
        generateCostMatrix(Game.rooms[fromPos.roomName], fromPos);
    }

    userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;

    /**@type {PathFinderOpts} */
    let PathFinderOpts = {
        maxRooms: ops.maxRooms,
        maxCost: ops.maxCost,
        heuristicWeight: ops.heuristicWeight || 1.2
    }
    if (ops.ignoreSwamps) {   // HELP 这里有没有什么不增加计算量的简短写法
        PathFinderOpts.plainCost = ops.plainCost;
        PathFinderOpts.swampCost = ops.swampCost || 1;
    } else if (ops.ignoreRoads) {
        PathFinderOpts.plainCost = ops.plainCost;
        PathFinderOpts.swampCost = ops.swampCost || 5;
    } else {
        PathFinderOpts.plainCost = ops.plainCost || 2;
        PathFinderOpts.swampCost = ops.swampCost || 10;
    }

    if (fromPos.roomName != toPos.roomName) {   // findRoute会导致非最优path的问题
        curAvoidRooms = ops.avoidRooms || avoidRooms;
        curAvoidExits = ops.avoidExits || avoidExits;
        route = findRoute(fromPos.roomName, toPos.roomName);
        if (route == ERR_NO_PATH) {
            return { path: [] };
        }
        PathFinderOpts.maxOps = ops.maxOps || 2000 + route.length ** 2 * 100;  // 跨10room则有2000+10*10*50=7000
        PathFinderOpts.maxRooms = PathFinderOpts.maxRooms || route.length + 1;
        route = route.reduce(routeReduce, { [fromPos.roomName]: 1 });   // 因为 key in Object 比 Array.includes(value) 快，但不知道值不值得reduce
        //console.log(fromPos + ' using route ' + JSON.stringify(route));
        PathFinderOpts.roomCallback = roomCallbackWithRoute;
    } else {
        PathFinderOpts.maxOps = ops.maxOps;
        PathFinderOpts.roomCallback = roomCallback;
    }

    return PathFinder.search(fromPos, { pos: toPos, range: ops.range }, PathFinderOpts);
}

function squadRoomCallback(roomName) {
    const roomCache = costMatrixCache[roomName];
    costMat = roomCache ? roomCache['squad'][findPathIgnoreCondition] : emptyCostMatrix;
    if (userCostCallback) {
        let resultCostMat = userCostCallback(roomName, roomCache ? costMat.clone() : new PathFinder.CostMatrix);
        if (resultCostMat instanceof PathFinder.CostMatrix) {
            costMat = resultCostMat;
        }
    }
    // if (roomName in Game.rooms) {
    //     const room = Game.rooms[roomName];
    //     for (let x = 0; x <= 49; x++) {
    //         for (let y = 0; y <= 49; y++) {
    //             room.visual.text(costMat.get(x, y), x, y);
    //         }
    //     }
    // }
    return costMat;
}

/**
 * 影响参数：ignoreDestructibleStructures, costCallback, range
 * 及 PathFinder 参数：masOps, maxRooms, maxCost, heuristicWeight
 */
function findSquadPath(fromPos, toPos, ops) {

    if (!(fromPos.roomName in costMatrixCache) && fromPos.roomName in Game.rooms) {   // 有视野没costMatrix
        generateCostMatrix(Game.rooms[fromPos.roomName], fromPos);
    }

    userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;

    const PathFinderOpts = {
        maxRooms: ops.maxRooms || 10,
        maxCost: ops.maxCost || 1000,
        maxOps: ops.maxOps || 2000,
        heuristicWeight: ops.heuristicWeight || 1.2,
        roomCallback: squadRoomCallback
    };
    return PathFinder.search(fromPos, { pos: toPos, range: ops.range || 1 }, PathFinderOpts);
}

let combinedX, combinedY;
/**
 * @param {MyPath} newPath 
 */
function addPathIntoCache(newPath) {
    combinedX = newPath.start.x + newPath.start.y;
    combinedY = newPath.end.x + newPath.end.y;
    if (!(combinedX in globalPathCache)) {
        globalPathCache[combinedX] = {
            [combinedY]: []  // 数组里放不同ops的及其他start、end与此对称的
        };
    } else if (!(combinedY in globalPathCache[combinedX])) {
        globalPathCache[combinedX][combinedY] = []      // 数组里放不同ops的及其他start、end与此对称的
    }
    globalPathCache[combinedX][combinedY].push(newPath);
}

function invalidate() {
    return 0;
}
/**
 * @param {MyPath} path 
 */
function deletePath(path) {
    if (path.start) {     // 有start属性的不是临时路
        let pathArray = globalPathCache[path.start.x + path.start.y][path.end.x + path.end.y];
        pathArray.splice(pathArray.indexOf(path), 1);
        path.posArray = path.posArray.map(invalidate);
    }
}

let minX, maxX, minY, maxY;
/**
 *  寻找房内缓存路径，起始位置两步限制避免复用非最优路径
 * @param {RoomPosition} formalFromPos 
 * @param {RoomPosition} formalToPos
 * @param {RoomPosition} fromPos
 * @param {CreepPaths} creepCache 
 * @param {MoveToOpts} ops 
 */
function findShortPathInCache(formalFromPos, formalToPos, fromPos, creepCache, ops) {     // ops.range设置越大找的越慢
    startCacheSearch = Game.cpu.getUsed();
    minX = formalFromPos.x + formalFromPos.y - 2;
    maxX = formalFromPos.x + formalFromPos.y + 2;
    minY = formalToPos.x + formalToPos.y - 1 - ops.range;
    maxY = formalToPos.x + formalToPos.y + 1 + ops.range;
    for (combinedX = minX; combinedX <= maxX; combinedX++) {
        if (combinedX in globalPathCache) {
            for (combinedY = minY; combinedY <= maxY; combinedY++) {
                if (combinedY in globalPathCache[combinedX]) {
                    for (let path of globalPathCache[combinedX][combinedY]) {     // 这个数组应该会很短
                        pathCounter++;
                        if (isNear(path.start, formalFromPos) && isNear(fromPos, path.posArray[1]) && inRange(path.end, formalToPos, ops.range) && isSameOps(path, ops)) {     // 找到路了
                            creepCache.path = path;
                            return true;
                        }
                    }
                }
            }
        }
    }
    return false;
}

/**
 *  寻找跨房缓存路径，允许起始位置少量的误差
 * @param {RoomPosition} formalFromPos
 * @param {RoomPosition} formalToPos
 * @param {CreepPaths} creepCache
 * @param {MoveToOpts} ops
 */
function findLongPathInCache(formalFromPos, formalToPos, creepCache, ops) {     // ops.range设置越大找的越慢
    startCacheSearch = Game.cpu.getUsed();
    minX = formalFromPos.x + formalFromPos.y - 2;
    maxX = formalFromPos.x + formalFromPos.y + 2;
    minY = formalToPos.x + formalToPos.y - 1 - ops.range;
    maxY = formalToPos.x + formalToPos.y + 1 + ops.range;
    for (combinedX = minX; combinedX <= maxX; combinedX++) {
        if (combinedX in globalPathCache) {
            for (combinedY = minY; combinedY <= maxY; combinedY++) {
                if (combinedY in globalPathCache[combinedX]) {
                    for (let path of globalPathCache[combinedX][combinedY]) {     // 这个数组应该会很短
                        pathCounter++;
                        if (isNear(path.start, formalFromPos) && inRange(path.end, formalToPos, ops.range) && isSameOps(path, ops)) {     // 找到路了
                            creepCache.path = path;
                            return true;
                        }
                    }
                }
            }
        }
    }
    return false;
}

let startRoomName, endRoomName;
/**
 *  起止点都在自己房间的路不清理
 * @param {CreepPaths['name']} creepCache 
 */
function setPathTimer(creepCache) {
    if (pathClearDelay) {
        let posArray = creepCache.path.posArray;
        startRoomName = posArray[0].roomName;
        endRoomName = posArray[posArray.length - 1].roomName;
        if (startRoomName != endRoomName || (startRoomName in Game.rooms && Game.rooms[startRoomName].controller && !Game.rooms[startRoomName].controller.my)) {    // 跨房路或者敌方房间路
            if (!(Game.time + pathClearDelay in pathCacheTimer)) {
                pathCacheTimer[Game.time + pathClearDelay] = [];
            }
            pathCacheTimer[Game.time + pathClearDelay].push(creepCache.path);
            creepCache.path.lastTime = Game.time;
        }
    }
}

/**@type {RoomPosition[]} */
let tempArray = [];
/**
 *  
 * @param {Creep} creep 
 * @param {RoomPosition} toPos 
 * @param {RoomPosition[]} posArray 
 * @param {number} startIdx 
 * @param {number} idxStep 
 * @param {PolyStyle} visualStyle 
 */
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
    // creep.room.visual.circle(creepCache.path.posArray[creepCache.idx]);
    return registerMoveIntent(creep, creepCache.path.posArray[creepCache.idx], ops.priority);
}

function squadStepToPos(leaderNextPos, squad, leader, creepPosArray, leaderPos, someOneTired, creepCache) {
    const formalPos = formalize(leaderNextPos);
    const targets = [];
    for (let i = 0; i < squad.length; i++) {
        let xdiff = creepPosArray[i].x - leaderPos.x;
        if (xdiff === -2) {     // 如果小队被出口隔开
            if (leader.pos.x === 1) {   // 如果是需要等待跳房的情况
                if (formalPos.x > leaderPos.x) {
                    //console.log(`等跳房 leaderNextPos ${JSON.stringify(leaderNextPos)}`);
                    squadMove(squad);
                    return OK
                }
            } else if (leaderNextPos.x === 49 && leader.pos.x === 0) {  // 如果是需要等待跳房的情况
                xdiff = -1;
            }
        }
        else if (xdiff === -1 && ((leader.pos.x === 1 && formalPos.x < leaderPos.x) || (leader.pos.x === 49 && formalPos.x > leaderPos.x))) {     // 需要等待跳房的情况
            //console.log(`等跳房 leaderNextPos ${JSON.stringify(leaderNextPos)}`);
            squadMove(squad);
            return OK
        }
        let ydiff = creepPosArray[i].y - leaderPos.y;
        if (ydiff === -2) {     // 如果小队被出口隔开
            if (leader.pos.y === 1) {   // 如果是需要等待跳房的情况
                if (formalPos.y > leaderPos.y) {
                    //console.log(`等跳房 leaderNextPos ${JSON.stringify(leaderNextPos)}`);
                    squadMove(squad);
                    return OK
                }
            } else if (leaderNextPos.y === 49 && leader.pos.y === 0) {  // 如果是需要等待跳房的情况
                ydiff = -1;
            }
        }
        else if (ydiff === -1 && ((leader.pos.y === 1 && formalPos.y < leaderPos.y) || (leader.pos.y === 49 && formalPos.y > leaderPos.y))) {     // 需要等待跳房的情况
            //console.log(`等跳房 leaderNextPos ${JSON.stringify(leaderNextPos)}`);
            squadMove(squad);
            return OK
        }

        const px = formalPos.x + xdiff;
        const py = formalPos.y + ydiff;
        targets.push(tile2Pos(py << 14 | px));
    }
    if (someOneTired) {
        for (let i = 0; i < squad.length; i++) {
            const creep = squad[i];
            if (creep.fatigue) {        // 如果这个 creep 有疲劳，看他移动目标位置上有没有队友能拉它
                const targetPos = formalize(targets[i]);
                for (let j = 0; j < squad.length; j++) {    // 遍历队友
                    const creep2 = squad[j];
                    const creepPos = formalize(creep2.pos);
                    if (creepPos.x === targetPos.x && creepPos.y === targetPos.y) {     // 位置相同
                        if (creep2.name == creep.name) {    // 如果目标位置就是当前位置，不处理
                            break;
                        }
                        if (creep2.fatigue) {   // 队友也有疲劳
                            creepCache.idx--;
                            squadMove(squad);
                            return ERR_TIRED;
                        }
                        creep2.pull(creep);     // 队友拉一把
                        break;
                    }
                }
            }
        }
    }
    squadMove(squad, targets);
    return OK;
}

/**
 * 
 * @param {*} creepCache 
 * @param {Creep[]} squad 
 * @param {*} leader 
 * @param {*} creepPosArray 
 * @param {{x:number, y:number}} leaderPos 
 * @param {*} visualStyle 
 * @param {RoomPosition} toPos 
 * @param {boolean} someOneTired 
 * @returns 
 */
function moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, visualStyle, toPos, someOneTired) {

    if (visualStyle) {
        showVisual(leader, toPos, creepCache.path.posArray, creepCache.idx, 1, visualStyle);
    }

    creepCache.idx++;
    const leaderNextPos = posArray[creepCache.idx];
    return squadStepToPos(leaderNextPos, squad, leader, creepPosArray, leaderPos, creepCache, someOneTired);
}

/**
 *  按缓存路径移动
 * @param {Creep} creep 
 * @param {RoomPosition} toPos 
 */
function moveOneStepReverse(creep, ops, toPos) {    // deprecated
    let creepCache = creepPathCache[creep.name];
    const visualStyle = ops.visualizePathStyle;
    if (visualStyle) {
        showVisual(creep, toPos, creepCache.path.posArray, creepCache.idx, -1, visualStyle);
    }
    if (creep.fatigue) {
        return ERR_TIRED;
    }
    creepMoveCache[creep.name] = Game.time;
    //creep.room.visual.circle(creepCache.path.posArray[creepCache.idx]);
    const pos = creepCache.path.posArray[creepCache.idx--];     // 是否应该 --creepCache.idx ?
    return registerMoveIntent(creep, pos, ops.priority);
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
 */
function startRoute(creep, pathCache, ops, toPos) {
    const posArray = pathCache.path.posArray;
    const visualStyle = ops.visualizePathStyle;

    let idx = 0;
    while (idx in posArray && isNear(creep.pos, posArray[idx])) {
        idx += 1;
    }
    idx -= 1;
    pathCache.idx = idx;

    if (visualStyle) {
        showVisual(creep, toPos, posArray, idx, 1, visualStyle);
    }
    creepMoveCache[creep.name] = Game.time;

    return registerMoveIntent(creep, posArray[idx], ops.priority);
}

/**
 * 
 * @param {*} squad 
 * @param {Creep} leader 
 * @param {{x: number, y: number}[]} creepPosArray 
 * @param {{x: number, y: number}} leaderPos 
 * @param {*} pathCache 
 * @param {*} visualStyle 
 * @param {*} toPos 
 */
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
    //console.log(`startSquadRoute: ${JSON.stringify(posArray)}`);
    
    const leaderNextPos = posArray[idx];
    if (findPathIgnoreCondition && leaderNextPos.roomName === leader.room.name) {
        if (!(leaderNextPos.roomName in costMatrixCache)) {
            generateCostMatrix(leader.room);
        }
        const costMatrix = costMatrixCache[leaderNextPos.roomName]['squad']['false'];
        if (costMatrix.get(leaderNextPos.x, leaderNextPos.y) === 255) {
            // leader.say('有障碍建筑');
            pathCache.idx -= idx > 0;
            squadMove(squad);
            return ERR_FULL;
        }
    }
    return squadStepToPos(leaderNextPos, squad, leader, creepPosArray, leaderPos, someOneTired, pathCache);
}

/**
 *  将用在Creep.prototype.move中
 * @param {RoomPosition} pos 
 * @param {DirectionConstant} target 
 */
function direction2Pos(pos, target) {
    // if (typeof target != "number") {
    //     // target 不是方向常数
    //     return undefined;
    // }

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
 * 
 * @param {Creep} creep 
 * @param {RoomPosition} targetPos 
 * @param {number} priority 
 * @returns 
 */
function registerMoveIntent(creep, targetPos, priority) {
    const formalCreepPos = formalize(creep.pos);
    // 所有登记 intents 都把当前 tick creep 脚下格子缓存为已检查过的 target
    checkedTiles.set(formalCreepPos.y << 14 | formalCreepPos.x, creep.name);

    let targetTile;
    if (typeof targetPos === 'number') {
        targetTile = targetPos;
    } else {
        const targetFormalPos = formalize(targetPos);
        if (targetPos.roomName !== creep.room.name) {       // 考虑跨房，送进解算算法的都是当前 tick 格子
            targetFormalPos.x += (targetPos.x === 49) - (targetPos.x === 0);
            targetFormalPos.y += (targetPos.y === 49) - (targetPos.y === 0);
        }   // else 如果 targetPos 已经是同一边了，不用处理
        targetTile = targetFormalPos.y << 14 | targetFormalPos.x;
    }
    const curTile = formalCreepPos.y << 14 | formalCreepPos.x;
    priority = priority || 0;
    // 每个 creep 单独记录目标格子
    cachedMoveIntents.set(creep.name, creepIdx);
    Priorities[creepIdx] = priority;
    IntentTiles[creepIdx++] = targetTile;
    // 记录 creep 自身所在格子
    IntentTiles[creepIdx++] = curTile;
    return OK;
}

function registerSquad(creep1, creep2) {
    const squad1 = creepToSquad.get(creep1.name);
    const squad2 = creepToSquad.get(creep2.name);
    // console.log(`set ${creep1.name} ${squad1} 和 ${creep2.name} ${squad2}`);
    if (squad1) {
        if (squad2) {
            // console.log(`有两个 squad: ${squad1} 和 ${squad2}`);
            if (squad1 !== squad2) {
                // 将所有 squad2 的 creep 加入 squad1
                const squad1List = squadToCreeps.get(squad1);
                for (const creepName of squadToCreeps.get(squad2)) {
                    creepToSquad.set(creepName, squad1);
                    squad1List.push(creepName);
                }
                squadToCreeps.delete(squad2);
            }
        } else {
            // console.log(`只有 squad1: ${squad1}`);
            creepToSquad.set(creep2.name, squad1);
            squadToCreeps.get(squad1).push(creep2.name);
        }
    } else if (squad2) {
        // console.log(`只有 squad2: ${squad2}`);
        creepToSquad.set(creep1.name, squad2);
        squadToCreeps.get(squad2).push(creep1.name);
    } else {
        const squadName = squadIdx++;
        creepToSquad.set(creep1.name, squadName);
        creepToSquad.set(creep2.name, squadName);
        squadToCreeps.set(squadName, [creep1.name, creep2.name]);
        // console.log(`新建 squad: ${squadName}`);
    }
}

/**
 * 在当前小队的前方是否有其他未绕路小队
 */
function checkSquadTarget(creepPosArray, leaderPos, leaderNextPos) {
    const formalPos = formalize(leaderNextPos);
    for (const pos of creepPosArray) {
        const x = formalPos.x + pos.x - leaderPos.x;
        const y = formalPos.y + pos.y - leaderPos.y;
        const tile = y << 14 | x;
        const creepName = checkedTiles.get(tile);
        if (creepName && creepToSquad.has(creepName) && !rerouteSquad.has(creepName)) {
            return true;
        }
    }
    return false;
}

/**
 * 这里检查格子时，遇到新的 creep 只会将其视为单人，不会考虑是否属于小队
 * 
 * @param {number[]} tileList 格子的世界坐标（一个整数表示）
 */
function defaultCheckTile(tileList) {
    const moveIntents = [];
    for (let tile of tileList) {    // 从解算算法回来的 tile 都是本 tick 格子
        let pos = tile2Pos(tile);   // 此处 pos 是本 tick 对应的格子
        if (!checkedTiles.has(tile)) {  // 只检查未检查过的格子
            const roomName = pos.roomName;
            const room = Game.rooms[roomName];
            if (!room) {
                checkedTiles.set(tile, '');
                continue;
            }
            // 只能把自己的 creep 作为新 start
            let creep = room.lookForAt('creep', pos.x, pos.y).filter(c => c.my)[0];
            if (!creep) {   // 没有普通 creep，看看 pc
                creep = room.lookForAt('powerCreep', pos.x, pos.y).filter(c => c.my)[0];
                if (!creep) {   // 也没有 pc，无需处理这个格子
                    checkedTiles.set(tile, '');
                    continue;
                }
            }
            checkedTiles.set(tile, creep.name); // 这个 tile 是 creep 当前 tick 位置
            const intent = [];
            const px = pos.x;
            const py = pos.y;
            if (creep.fatigue || !hasActiveBodypart(creep.body, MOVE)) {    // 走不动，又没有被人为 pull
                intent.push({   // 送入解算的 tile 是 creep 当前 tick 位置
                    target: tile,
                    score: activeMoveScore
                });
            } else {    // 检查这个 creep 周围8个格子，允许它被推走
                intent.push({
                    target: tile,   // 这个 tile 是 creep 当前 tick 位置
                    score: 0
                });

                const terrain = creep.room.getTerrain().getRawBuffer();
                if (!(roomName in costMatrixCache)) {
                    generateCostMatrix(room);
                }
                const CostMatrix = costMatrixCache[roomName]['false'];
                const edgeArray = costMatrixCache[roomName]['edgeArray'];   // edgeArray 保证了只检查同一房间的格子，不会遍历到跨房
                const startIdx = (py * 50 + px) << 3;
                for (let idx = startIdx; idx < startIdx + 8; idx++) {
                    const v = edgeArray[idx];
                    if (v === 0) {
                        break;
                    }
                    const x = v % 50;
                    const y = v / 50 | 0;
                    const cost = CostMatrix.get(x, y);
                    if (cost === 255) {
                        continue;
                    }
                    const pos = new RoomPosition(x, y, roomName);
                    let score = passiveMoveScore;
                    if (terrain[v] === TERRAIN_MASK_SWAMP && cost !== 1) {  // 没造路的 swamp，开销较大
                        score += passiveMoveScore << 2;
                    }
                    if (!isWorkTile(creep, pos)) {
                        score += badMoveScore;
                    }
                    const formalPos = formalize(pos);
                    intent.push({
                        target: formalPos.y << 14 | formalPos.x,
                        score
                    });
                }
            }

            moveIntents.push({
                start: creep.name,
                isSuper: false,
                targetList: intent
            });
        }
    }

    // console.log(`defaultCheckTile moveIntents: ${JSON.stringify(moveIntents.map(intent => intent.start))}`);
    return moveIntents;
}

function wrapCheckTile(checkTileFunc) {
    return (tileList) => {
        const posList = [];
        for (let tile of tileList) {
            posList.push(tile2Pos(tile));
        }
        return checkTileFunc(posList);
    }
}

/**
 * @param {Function} fn 
 */
function wrapFn(fn, name) {
    analyzeCPU[name] = { sum: 0, calls: 0 };
    return function () {
        startTime = Game.cpu.getUsed();     // 0.0015cpu
        let code = fn.apply(this, arguments);
        if (code === OK) {
            analyzeCPU[name].sum += Game.cpu.getUsed() - startTime;
            analyzeCPU[name].calls++;
        }
        return code;
    }
}

function clearUnused() {
    if (Game.time % pathClearDelay == 0) { // 随机清一次已死亡creep
        for (let name in creepPathCache) {
            if (!(name in Game.creeps)) {
                delete creepPathCache[name];
            }
        }
    }
    for (let time in pathCacheTimer) {
        if (time > Game.time) {
            break;
        }
        //console.log('clear path');
        for (let path of pathCacheTimer[time]) {
            if (path.lastTime == time - pathClearDelay) {
                deletePath(path);
            }
        }
        delete pathCacheTimer[time];
    }
    for (let time in costMatrixCacheTimer) {
        if (time > Game.time) {
            break;
        }
        //console.log('clear costMat');
        for (let data of costMatrixCacheTimer[time]) {
            delete costMatrixCache[data.roomName];
            for (let avoidRoomName of data.avoids) {
                avoidRooms.delete(avoidRoomName);
            }
        }
        delete costMatrixCacheTimer[time];
    }
}


const defaultIsWorkTile = (creep, pos) => true;

/***************************************
 *  功能实现
 */
let isWorkTile = defaultIsWorkTile;

const defaultVisualizePathStyle = { fill: 'transparent', stroke: '#fff', lineStyle: 'dashed', strokeWidth: .15, opacity: .1 };
/**@type {[MoveToOpts, RoomPosition, CreepPaths['1'], MyPath, number, RoomPosition[], boolean]}
*/
let ops, toPos, creepCache, path, idx, posArray, found;
/**
 *  把moveTo重写一遍
 * @param {Creep} this
 * @param {number | RoomObject} firstArg 
 * @param {number | MoveToOpts} secondArg 
 * @param {MoveToOpts} opts 
 */
function betterMoveTo(firstArg, secondArg, opts) {
    if (!this.my) {
        return ERR_NOT_OWNER;
    }

    if (this.spawning) {
        return ERR_BUSY;
    }

    if (typeof firstArg == 'object') {
        toPos = firstArg.pos || firstArg;
        ops = secondArg || {};
    } else {
        toPos = { x: firstArg, y: secondArg, roomName: this.room.name };
        ops = opts || {};
    }
    ops.bypassHostileCreeps = ops.bypassHostileCreeps === undefined || ops.bypassHostileCreeps;    // 设置默认值为true
    findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;

    if (typeof toPos.x !== "number" || typeof toPos.y !== "number") {   // 房名无效或目的坐标不是数字，不合法
        return ERR_INVALID_TARGET;
    } else if (inRange(this.pos, toPos, ops.range || 1)) {   // 已到达，用于走进 portal
        if (isEqual(toPos, this.pos) || ops.range) {  // 已到达
            return OK;
        } // else 走一步
        creepMoveCache[this.name] = Game.time;      // 用于防止自己移动后被误对穿
        return registerMoveIntent(this, toPos, ops.priority);
    }
    ops.range = ops.range || 1;
    ops.bypassRange = ops.bypassRange || 5;

    if (!hasActiveBodypart(this.body, MOVE)) {
        return ERR_NO_BODYPART;
    }

    if (this.fatigue) {
        if (!ops.visualizePathStyle) {    // 不用画路又走不动，直接return
            return ERR_TIRED;
        } // else 要画路，画完再return
    }

    // HELP：感兴趣的帮我检查这里的核心逻辑orz
    creepCache = creepPathCache[this.name];
    if (creepCache) {  // 有缓存
        path = creepCache.path;
        idx = creepCache.idx;
        if (path && idx < path.posArray.length - 1 && path.ignoreStructures === findPathIgnoreCondition) {  // 缓存路条件相同
            posArray = path.posArray;
            if (posArray[0] && (isEqual(toPos, creepCache.dst) || inRange(posArray[posArray.length - 1], toPos, ops.range))) {   // 正向走，目的地没变
                if (isEqual(this.pos, posArray[idx])) {    // 正常
                    if (idx < posArray.length - 1) {
                        // this.say('正常');
                        return moveOneStep(this, ops, toPos);
                    }
                } else if (idx + 2 in posArray && isEqual(this.pos, posArray[idx + 1])) {  // 跨房了
                    creepCache.idx++;
                    if (!path.directionArray[idx + 2]) {  // 第一次见到该房则检查房间
                        if (checkRoom(this.room, path, creepCache.idx)) {   // 传creep所在位置的idx
                            // this.say('新房 可走');
                            //console.log(`${Game.time}: ${this.name} check room ${this.pos.roomName} OK`);
                            return moveOneStep(this, ops, toPos);  // 路径正确，继续走
                        }   // else 检查中发现房间里有建筑挡路，重新寻路
                        //console.log(`${Game.time}: ${this.name} check room ${this.pos.roomName} failed`);
                        deletePath(path);
                    } else {
                        // this.say('这个房间见过了');
                        return moveOneStep(this, ops, toPos);  // 路径正确，继续走
                    }
                } else if (isNear(this.pos, posArray[idx])) {  // 堵路了
                    /**
                     * 考虑以下情况：
                     * 1. 和平情景，别人的 creep 挡路，则只绕别人的，不绕自己的，ops.bypassHostileCreeps = true；
                     * 2. 进攻情景，被敌对 creep 挡路则不绕，只绕自己的 creep，ops.bypassHostileCreeps = false；
                     * 3. 撤退情景，绕敌对 creep，不绕自己的，ops.bypassHostileCreeps = true；
                     * 4. 被己方 creep 堵路，时间超过 5 tick 则绕自己的 creep。
                     */
                    // 挡路达到 2 tick，被敌对 creep 挡路且不忽略敌对 creep
                    if (Game.time - creepMoveCache[this.name] >= 2) {
                        const blockingCreep = lookCreepAt(posArray[idx])[0];
                        if (blockingCreep) {
                            if (!blockingCreep.my) {   // 被敌对 creep 挡路
                                if (ops.bypassHostileCreeps) {  // 如果要绕过敌对 creep，此处是默认情况
                                    ops.bypassMyCreeps = false;    // 不绕自己的
                                    if (findTemporalPath(this, toPos, ops)) { // 有路，creepCache的内容会被这个函数更新
                                        // this.say('hostile: 开始绕路');
                                        return startRoute(this, creepCache, ops, toPos);
                                    } else {  // 没路
                                        // this.say('hostile: 没路啦');
                                    }
                                }   // else 战斗情况，故意顶着敌对 creep，按原路走
                            } else if (Game.time - creepMoveCache[this.name] >= 5) {    // 绕过被自己 creep 挡住超过 5 tick
                                ops.bypassMyCreeps = true;   // 要绕自己的
                                if (findTemporalPath(this, toPos, ops)) { // 有路，creepCache的内容会被这个函数更新
                                    // this.say('开始绕路');
                                    return startRoute(this, creepCache, ops, toPos);
                                } else {  // 没路
                                    // this.say('没路啦');
                                }
                                creepMoveCache[this.name] = Game.time;
                            }
                            if (ops.visualizePathStyle) {
                                showVisual(this, toPos, posArray, idx, 1, ops.visualizePathStyle);
                            }
                            return registerMoveIntent(this, posArray[idx], ops.priority);  // 有可能是第一步就没走上路or通过略过moveTo的move操作偏离路线，直接call可兼容
                        } else if (!ops.ignoreDestructibleStructures) {    // 如果不是被 creep 堵路，且不是 ignoreDestructibleStructures
                            if (isObstacleStructure(this.room, posArray[idx], ops.ignoreDestructibleStructures)) {// 发现出现新建筑物挡路，删除costMatrix和path缓存，重新寻路
                                // console.log(`${Game.time}: ${this.name} find obstacles at ${this.pos}`);
                                delete costMatrixCache[this.pos.roomName];
                                generateCostMatrix(this.room);
                                deletePath(path);
                                // 不 return，掉下去重新寻路
                            }
                        } else {    // 不知道啥情况，兜底
                            // this.say('未知堵路')
                            if (ops.visualizePathStyle) {
                                showVisual(this, toPos, posArray, idx, 1, ops.visualizePathStyle);
                            }
                            return registerMoveIntent(this, posArray[idx], ops.priority);
                        }
                    } else {
                        // this.say('堵路1t')
                        if (ops.visualizePathStyle) {
                            showVisual(this, toPos, posArray, idx, 1, ops.visualizePathStyle);
                        }
                        return registerMoveIntent(this, posArray[idx], ops.priority);
                    }
                } else if (idx - 1 >= 0 && isNear(this.pos, posArray[idx - 1])) {  // 因为堵路而被自动传送反向跨房了
                    // this.say('偏离一格');
                    if (ops.visualizePathStyle) {
                        showVisual(this, toPos, posArray, idx, 1, ops.visualizePathStyle);
                    }
                    return registerMoveIntent(this, posArray[idx - 1], ops.priority);    // 同理兼容略过moveTo的move
                } // else 彻底偏离，重新寻路
            } // else 目的地变了
        } // else 缓存中没路或者条件变了
    } else {    // else 需要重新寻路，先找缓存路，找不到就寻路
        creepCache = {
            dst: { x: NaN, y: NaN },
            path: undefined,
            idx: 0
        };
        creepPathCache[this.name] = creepCache;
    }
    creepCache.path = undefined;

    if (typeof ops.range != 'number' || typeof ops.bypassRange != 'number' || (ops.avoidRooms !== undefined && !(ops.avoidRooms instanceof Set)) || (ops.avoidExits !== undefined && !(ops.avoidExits instanceof Map))) {
        return ERR_INVALID_ARGS
    }

    found = this.pos.roomName == toPos.roomName ? findShortPathInCache(formalize(this.pos), formalize(toPos), this.pos, creepCache, ops) : findLongPathInCache(formalize(this.pos), formalize(toPos), creepCache, ops);
    if (found) {
        //this.say('cached');
        //console.log(this, this.pos, 'hit');
        testCacheHits++;
    } else {  // 没找到缓存路
        testCacheMiss++;

        if (autoClearTick < Game.time) {  // 自动清理
            autoClearTick = Game.time;
            clearUnused();
        }

        let result = findPath(this.pos, toPos, ops);
        if (!result.path.length || (result.incomplete && result.path.length == 1)) {     // 一步也动不了了
            //this.say('no path')
            return ERR_NO_PATH;
        }
        result = result.path;
        result.unshift(this.pos);

        //this.say('start new');
        let newPath = {
            start: formalize(result[0]),
            end: formalize(result[result.length - 1]),
            posArray: result,
            ignoreRoads: !!ops.ignoreRoads,
            ignoreStructures: !!ops.ignoreDestructibleStructures,
            ignoreSwamps: !!ops.ignoreSwamps
        }
        generateDirectionArray(newPath);
        addPathIntoCache(newPath);
        //console.log(this, this.pos, 'miss');
        creepCache.path = newPath;
    }

    creepCache.dst = toPos;
    setPathTimer(creepCache);

    found ? cacheHitCost += Game.cpu.getUsed() - startCacheSearch : cacheMissCost += Game.cpu.getUsed() - startCacheSearch;

    return startRoute(this, creepCache, ops, toPos);
}

/**
 * 
 * @param {Creep} this 写好后删这个参数
 * @param {DirectionConstant | Creep} target 
 */
function betterMove(target) {
    if (!this.my) {
        return ERR_NOT_OWNER;
    }
    if (this.spawning) {
        return ERR_BUSY;
    }

    if (target && (target instanceof Creep)) {
        if (!target.pos.isNearTo(this.pos)) {
            return ERR_NOT_IN_RANGE;
        }

        registerMoveIntent(this, target.pos);
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
    if (nextPos && Game.rooms[nextPos.roomName].getTerrain().get(nextPos.x, nextPos.y) !== TERRAIN_MASK_WALL) {
        registerMoveIntent(this, nextPos);
    }
    return OK;
}

/**
 * 发生 pull 时自动合并成小队
 * 
 * @param {Creep} this 写好后删这个参数
 * @param {Creep} target 
 */
function betterPull(target) {
    const ret = originPull.call(this, target);
    if (ret === OK) {
        // 只需登记小队，无需登记 move intent
        pullPair.set(target.name, this.name);
        registerSquad(this, target);
    }
    return ret;
}

/**
 * 
 * @param {Creep} this 写好后删这个参数
 * @param {string} methodName 
 */
function betterCancelOrder(methodName) {
    // 只拦截取消移动需求
    if (methodName == 'move' || methodName == 'moveTo') {
        // 取消移动需求
        cachedMoveIntents.delete(this.name);
        const formalCreepPos = formalize(this.pos);
        const curTile = formalCreepPos.y << 14 | formalCreepPos.x;
        checkedTiles.delete(curTile);
    }
    return originCancelOrder.call(this, methodName);
}

/**
 * target === undefined 表示注册小队，允许被推动
 * 
 * @param {Creep[]} squad 只允许 2~9 个 creep 为一队
 * @param {SquadMoveTarget | undefined} target 若非 undefined，数量必须和小队 creep 数一致
 */
function squadMove(squad, target) {
    // console.log(`squadMove: [${squad.map(creep => creep.name).join(', ')}], target: ${JSON.stringify(target)}`);
    if (squad.length <= 1 || squad.length > 9 || (target && target.length !== squad.length)) {
        return ERR_INVALID_ARGS;
    }
    if (target) {   // 如果是真要移动
        registerMoveIntent(squad[0], target[0].pos || target[0]);
        for (let i = squad.length; --i;) {
            registerMoveIntent(squad[i], target[i].pos || target[i]);
            registerSquad(squad[0], squad[i]);
        }
    } else {    // 否则仅注册小队，不可被推动
        registerMoveIntent(squad[0], 0);
        for (let i = squad.length; --i;) {
            registerMoveIntent(squad[i], 0);
            registerSquad(squad[0], squad[i]);
        }
    }
}

/**
 * 
 * @param {Creep[]} squad 只允许 4 creep 小队
 */
function squadMoveTo(squad, firstArg, secondArg, opts) {
    let leaderFormalX = 0, leaderFormalY = 0, xLeader, yLeader, leader, creepPosArray = [];
    if (squad.length !== 4) {
        return ERR_INVALID_ARGS;
    }

    if (typeof firstArg == 'object') {
        toPos = firstArg.pos || firstArg;
        ops = secondArg || {};
    } else {
        toPos = { x: firstArg, y: secondArg, roomName: leader.room.name };
        ops = opts || {};
    }
    ops.enableAutoPull = ops.enableAutoPull === undefined || ops.enableAutoPull;
    let someOneTired = false;

    // 检查 fatigue, my, spawning
    for (const creep of squad) {
        if (creep.my) {
            if (creep.spawning) {
                return ERR_BUSY;
            }
            if (creep.fatigue) {
                if (!ops.enableAutoPull) {
                    squadMove(squad);
                    return ERR_TIRED;
                }
                someOneTired = true;
            }
            const pos = formalize(creep.pos);   // 用 formalize 后的兼容跨房情况
            if (pos.x > leaderFormalX || pos.y > leaderFormalY) {
                leaderFormalX = pos.x;
                leaderFormalY = pos.y;
                xLeader = creep.pos.x;
                yLeader = creep.pos.y;
                leader = creep;
            }
            creepPosArray.push(pos);
        } else {
            return ERR_NOT_OWNER;
        }
    }
    // 检查是否相邻
    let crossRoom = xLeader === 0 || xLeader === 49 || yLeader === 0 || yLeader === 49;
    let xDiff1 = 0, xDiff2 = 0, yDiff1 = 0, yDiff2 = 0;
    for (const pos of creepPosArray) {
        const xDiff = leaderFormalX - pos.x;
        const yDiff = leaderFormalY - pos.y;
        if (xDiff < 0 || xDiff > 2 || yDiff < 0 || yDiff > 2) {
            return ERR_NOT_IN_RANGE;
        }
        xDiff1 += xDiff === 1;
        xDiff2 += xDiff === 2;
        yDiff1 += yDiff === 1;
        yDiff2 += yDiff === 2;
    }
    if (xDiff2) {
        if (xDiff1 || yDiff2 || xLeader > 1) return ERR_NOT_IN_RANGE;
        //leader.say("跨房");
        crossRoom = true;
    }
    if (yDiff2) {
        if (yDiff1 || yLeader > 1) return ERR_NOT_IN_RANGE;
        //leader.say("跨房");
        crossRoom = true;
    }
    // console.log(`没掉队: ${leaderFormalX}, ${leaderFormalY}, ${xDiff1}, ${xDiff2}, ${yDiff1}, ${yDiff2}, ${JSON.stringify(creepPosArray)}`);

    findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;

    // 已到达，注册不可推动的小队
    const rangeToPos = leader.pos.getRangeTo(toPos);
    if (rangeToPos === 0) {
        squadMove(squad);
        return OK;
    } else if (rangeToPos === 1) {
        if (toPos.roomName === leader.room.name) {
            if (!(toPos.roomName in costMatrixCache)) {
                generateCostMatrix(leader.room);
            }
            if (costMatrixCache[toPos.roomName]['squad']['false'].get(toPos.x, toPos.y) === 255) {
                // leader.say('有障碍建筑');
                squadMove(squad);
                return findPathIgnoreCondition ? ERR_FULL : OK;
            }
        }
        return squadStepToPos(toPos, squad, leader, creepPosArray, { x: leaderFormalX, y: leaderFormalY }, someOneTired);
    }

    /** x、y 是 formal pos */
    const leaderPos = { x: leaderFormalX, y: leaderFormalY};
    const key = leader.name + '_quad';
    creepCache = creepPathCache[key];
    if (creepCache) {   // 有缓存
        if (isEqual(toPos, creepCache.dst)) {   // 目的地没变
            path = creepCache.path;
            idx = creepCache.idx;
            if (path && idx < path.posArray.length - 1 && path.ignoreStructures === findPathIgnoreCondition) {
                posArray = path.posArray;
                if (crossRoom) {
                    if (idx + 2 < posArray.length && isNear(leader.pos, posArray[idx + 2])) {
                        creepCache.idx++;
                    } else if (!isNear(leader.pos, posArray[idx+1])) {
                        creepCache.idx--;
                    }
                    if (leader.room.name in costMatrixCache || checkSquadRoom(leader.room, path, creepCache.idx)) {   // 房间已见过 或 检查路径正常，TODO：若寻路是在无视野时，然后被其他 creep 先进入建立了 costMatrix，仍然需要检查路径
                        creepMoveCache[leader.name] = Game.time;
                        return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, ops.visualizePathStyle, toPos, someOneTired);
                    } // else 需要重新寻路
                } else if (isEqual(leader.pos, posArray[idx])) {   // 正常
                    if (findPathIgnoreCondition) {
                        const leaderNextPos = posArray[idx + 1];
                        const roomName = leaderNextPos.roomName;
                        
                        if (roomName === leader.room.name) {
                            if (!(roomName in costMatrixCache)) {
                                generateCostMatrix(leader.room);
                            }
                            const costMatrix = costMatrixCache[roomName]['squad']['false'];
                            if (costMatrix.get(leaderNextPos.x, leaderNextPos.y) === 255) {
                                if (ops.visualizePathStyle) {
                                    showVisual(leader, toPos, posArray, idx, 1, ops.visualizePathStyle);
                                }
                                // leader.say('有障碍建筑');
                                squadMove(squad);
                                return ERR_FULL;
                            }
                        }
                    }
                    creepMoveCache[leader.name] = Game.time;
                    return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, ops.visualizePathStyle, toPos, someOneTired);
                    // } else if (idx + 1 in posArray && idx + 2 in posArray && isEqual(leader.pos, posArray[idx + 1])) {  // 跨房了 
                } else if (isNear(leader.pos, posArray[idx])) {   // 堵路了
                    if (checkSquadTarget(creepPosArray, leaderPos, posArray[idx])) { // 有其他小队在前方，绕路
                        if (findSquadTemporalPath(leader, toPos, ops, key)) {
                            // leader.say("绕路");
                            for (const creep of squad) {
                                rerouteSquad.add(creep.name);
                            }
                            return startSquadRoute(squad, leader, creepPosArray, leaderPos, creepCache, ops.visualizePathStyle, toPos, someOneTired);
                        } else {
                            // leader.say("没路了");
                            squadMove(squad);
                            return ERR_NO_PATH;
                        }
                    } else if (isObstacleStructure(leader.room, posArray[idx], true)) { // 有己方建筑物
                        // leader.say("绕建筑");
                        // 删除路和 costMatrix 后重新寻路
                        delete costMatrixCache[leader.pos.roomName];
                        generateCostMatrix(leader.room);
                    } else if (leader.name in creepMoveCache && creepMoveCache[leader.name] <= Game.time - 4) {     // 赌得严重
                        if (findSquadTemporalPath(leader, toPos, ops, key, true, new Set(squad.map(c => c.name)))) {
                            // leader.say("严重绕路");
                            for (const creep of squad) {
                                rerouteSquad.add(creep.name);
                            }
                            return startSquadRoute(squad, leader, creepPosArray, leaderPos, creepCache, ops.visualizePathStyle, toPos, someOneTired);
                        } else {
                            // leader.say("没路了");
                            squadMove(squad);
                            return ERR_NO_PATH;
                        }
                    } else { // 没有其他小队在前方正常走
                        // leader.say(`${Game.time - creepMoveCache[leader.name]}`)
                        // console.log(`${Game.time - creepMoveCache[leader.name]}: ${JSON.stringify(creepCache.path)}`);
                        creepCache.idx -= creepCache.idx > 0;
                        return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, ops.visualizePathStyle, toPos, someOneTired);
                    }
                } else if (idx - 1 >= 0 && isNear(leader.pos, posArray[idx - 1])) {  // 因为堵路而被自动传送反向跨房了
                    // TODO 解决跨房问题
                    // leader.say("偏离一格");
                    creepCache.idx -= 2;
                    return moveOneStepSquad(creepCache, squad, leader, creepPosArray, leaderPos, ops.visualizePathStyle, toPos, someOneTired);
                }   // else 彻底偏离，重新寻路
            }   // else 缓存中没路
        }   // 目的地变了
    } else {
        creepCache = {
            dst: { x: NaN, y: NaN },
            path: undefined,
            idx: 0
        };
        creepPathCache[key] = creepCache;
    }

    // 按照 squadCostMatrix 寻路
    let result = findSquadPath(leader.pos, toPos, ops);
    // console.log(`findSquadPath to ${JSON.stringify(toPos)}: ${result.incomplete}, ${JSON.stringify(result.path)}`);
    if (!result.path.length || (result.incomplete && result.path.length == 1)) {     // 一步也动不了了
        creepCache.path = undefined;
        squadMove(squad);
        return ERR_NO_PATH;
    }
    result = result.path;
    result.unshift(leader.pos);
    let newPath = {
        end: formalize(result[result.length - 1]),
        posArray: result,
        ignoreStructures: findPathIgnoreCondition,
    }
    creepCache.path = newPath;
    creepCache.dst = toPos;
    return startSquadRoute(squad, leader, creepPosArray, leaderPos, creepCache, ops.visualizePathStyle, toPos, someOneTired);
}

/**
 * 暂未完成，后续版本可能更新
 * 
 * @param {RoomPosition} this 写好后删这个参数
 * @param {FindConstant | RoomObject[] | RoomPosition[]} objects 
 * @param {FindPathOpts & FilterOptions<FIND_STRUCTURES> & { algorithm?: string }} opts 
 */
function betterFindClosestByPath(objects, opts) {
    throw new Error("betterFindClosestByPath 未实现");

    const room = Game.rooms[this.roomName];
    if (!room) {
        throw new Error(`Could not access room ${this.roomName}`);
    }

    opts = opts || {};


    if (_.isNumber(objects)) {
        objects = room.find(objects, { filter: opts.filter });
    }
    else if (opts.filter) {
        objects = _.filter(objects, opts.filter);
    }

    if (!objects.length) {
        return null;
    }

    const objectOnSquare = _.find(objects, obj => this.isEqualTo(obj));
    if (objectOnSquare) {
        return objectOnSquare;
    }

    const goals = _.map(objects, i => {
        if (i.pos) {
            i = i.pos;
        }
        return { range: opts.range || 1, pos: i };
    });

    findPathIgnoreCondition = !!opts.ignoreDestructibleStructures
    const searchOpts = {
        roomCallback: roomCallback,
        maxOps: opts.maxOps,
        maxRooms: 1
    };
    if (!opts.ignoreRoads) {
        searchOpts.plainCost = 2;
        searchOpts.swampCost = 10;
    }
    var ret = globals.PathFinder.search(fromPos, goals, searchOpts);

    var result = null;
    var lastPos = fromPos;

    if (ret.path.length) {
        lastPos = ret.path[ret.path.length - 1];
    }

    objects.forEach(obj => {
        if (lastPos.isNearTo(obj)) {
            result = obj;
        }
    });

    return result;

}

/**
 * 若当前位置不可作为四人小队站位的右下角，则返回 ERR_NO_PATH
 * 
 * @param {RoomPosition} this 写好后删这个参数
 * @param {RoomPosition | RoomObject} toPos 
 * @param {*} opts  支持 costCallback, ignoreDestructibleStructures, range, maxOps, maxCost, maxRooms, heuristicWeight
 */
function findSquadPathTo(toPos, opts) {
    if (!(this.roomName in costMatrixCache) && this.roomName in Game.rooms) {
        generateCostMatrix(Game.rooms[this.roomName]);
    }
    toPos = toPos.pos || toPos;
    opts = opts || {};
    findPathIgnoreCondition = !!opts.ignoreDestructibleStructures;
    if (this.roomName in costMatrixCache) {
        const costMatrix = costMatrixCache[this.roomName]['squad'][findPathIgnoreCondition];
        if (costMatrix.get(this.x, this.y) === 255) {
            return ERR_NO_PATH;
        }
    }
    let result = findSquadPath(this, toPos, opts);
    return result;
}

function endTickResolve(userIsWorkTile) {
    const startTime = Game.cpu.getUsed();

    if (userIsWorkTile && typeof userIsWorkTile === 'function') {
        isWorkTile = userIsWorkTile;
    } else {
        isWorkTile = defaultIsWorkTile;
    }

    const moveIntents = [];
    const creepAtSquadTarget = [];

    // 先组装 squad 移动意图
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
            if (noMove) {   // 停在原地
                moveIntents.push({
                    start: curSquadIdx,
                    isSuper: true,
                    targetList: [
                        {
                            target: curTiles,
                            score: ultraMoveScore,
                        }
                    ],
                })
            } else {
                moveIntents.push({
                    start: curSquadIdx,
                    isSuper: true,
                    targetList: [
                        {
                            target: targetTiles,
                            score: ultraMoveScore,
                        },
                        {
                            target: curTiles,
                            score: 0,
                        }
                    ],
                })
            }
        }
    }
    
    // 再遍历所有 creep 移动 intent，保留不属于 squad 的
    for (const [creepName, idx] of cachedMoveIntents) {
        if (idx) {
            const curTile = IntentTiles[idx + 1];
            const targetTile = IntentTiles[idx];
            const targetList = curTile === targetTile ? [
                {
                    target: targetTile,
                    score: activeMoveScore << Priorities[idx],
                },
            ] : [
                {
                    target: targetTile,
                    score: activeMoveScore << Priorities[idx],
                },
                {
                    target: curTile,
                    score: 0,
                },
            ];
            nameToIntentIdx.set(creepName, moveIntents.length);
            moveIntents.push({
                start: creepName,
                isSuper: false,
                targetList
            })
        }
    }
    // 把 squad 所在的连通片的所有 creep 允许强行推动
    let bfsIdx = 0;
    while (bfsIdx < creepAtSquadTarget.length) {
        const creepName = creepAtSquadTarget[bfsIdx++];
        const intentIdx = nameToIntentIdx.get(creepName);
        const targetList = moveIntents[intentIdx].targetList;
        if (targetList.length > 2) {
            continue;
        }

        const targetTile = targetList[0].target;

        let score;
        const tx = (targetTile & 0x3fff) % 50;
        const ty = (targetTile >> 14) % 50;
        const creep = Game.creeps[creepName];
        const roomName = creep.room.name;
        const terrain = creep.room.getTerrain().getRawBuffer();
        const CostMatrix = costMatrixCache[roomName]['false'];
        const edgeArray = costMatrixCache[roomName]['edgeArray'];
        const startIdx = (creep.pos.y * 50 + creep.pos.x) << 3;
        for (let idx = startIdx; idx < startIdx + 8; idx++) {
            const v = edgeArray[idx];
            if (v === 0) {
                break;
            }
            const vx = v % 50, vy = v / 50 | 0;
            if (vx === tx && vy === ty) {
                continue;
            }
            const cost = CostMatrix.get(vx, vy);
            if (cost === 255) {     // 有不可行走的建筑
                continue;
            }
            // 如果和下一步相邻，代价较小
            if (vx - tx <= 1 && tx - vx <= 1 && vy - ty <= 1 && ty - vy <= 1) {
                score = passiveMoveScore;
            } else {    // 否则，代价较大
                score = badMoveScore;
            }
            // 如果是无路沼泽，代价较大
            if (terrain[v] === TERRAIN_MASK_SWAMP && cost !== 1) {
                score += passiveMoveScore << 2;
            }
            const vFormal = formalize(new RoomPosition(vx, vy, roomName));
            const target = vFormal.y << 14 | vFormal.x;
            targetList.push({
                target,
                score,
            })
            const singleCreepName = checkedTiles.get(target);
            if (singleCreepName && !creepToSquad.has(singleCreepName)) {
                creepAtSquadTarget.push(singleCreepName);
            }
        }
        const singleCreepName = checkedTiles.get(targetTile);
        if (singleCreepName && !creepToSquad.has(singleCreepName)) {
            creepAtSquadTarget.push(singleCreepName);
        }
        const formalCreepPos = formalize(creep.pos);
        checkedTiles.set(formalCreepPos.y << 14 | formalCreepPos.x, '');   // 从 checkedTiles 中删除当前位置，因为它已经被处理过了
    }
    // console.log(`creepAtSquadTarget: ${creepAtSquadTarget}`);
    // if (moveIntents.length) {
    //     for (let idx = 0; idx < moveIntents.length; idx++) {
    //         if (moveIntents[idx].isSuper) {
    //             let text = `squad moveIntents: start: ${moveIntents[idx].start}, targetList: [`;
    //             for (let target of moveIntents[idx].targetList) {
    //                 text += `{target: ${target.target.map(tile => {
    //                     const pos = tile2Pos(tile);
    //                     return `${pos}`;
    //                 })}}, score: ${target.score}}`;
    //             }
    //             text += `]`;
    //             console.log(text);
    //         } else {
    //             let text = `creep moveIntents: start: ${moveIntents[idx].start}, targetList: [`;
    //             for (let target of moveIntents[idx].targetList) {
    //                 text += `{target: ${tile2Pos(target.target)}, score: ${target.score}}`;
    //             }
    //             text += `]`;
    //             console.log(text);
    //         }
    //     }
    // }


    if (!moveIntents.length) {
        return;
    }
    // console.log(`moveIntents starts: ${moveIntents.map(intent => intent.start)}`);

    const result = moveMatch(moveIntents, defaultCheckTile);

    const allCreeps = Game.creeps;
    const allPowerCreeps = Game.powerCreeps;
    let moveCount = 0;
    for (const { start, target } of result) {
        if (typeof start === 'string') {    // 普通 creep
            const startIdx = cachedMoveIntents.get(start);
            if (!startIdx) {
                let creep = allCreeps[start];
                if (!creep) {
                    creep = allPowerCreeps[start];
                }
                const creepPos = creep.pos;
                const pos = tile2Pos(target);
                if (pos.x !== creepPos.x || pos.y !== creepPos.y) {  // 如果 target !== start 当前所在位置才需要移动
                    // creep.room.visual.line(creep.pos, pos, lineStyle[0]);
                    const puller = pullPair.get(start);
                    if (puller) {
                        originMove.call(creep, Game.creeps[puller]);
                    } else {
                        originMove.call(creep, getDirection(creepPos, pos));
                    }
                    moveCount++;
                }
            } else if (target !== IntentTiles[startIdx + 1]) { // 如果 target !== start 当前所在位置才需要移动
                let creep = allCreeps[start];
                if (!creep) {
                    creep = allPowerCreeps[start];
                }
                const creepPos = creep.pos;
                const pos = tile2Pos(target);
                if (pos.x !== creepPos.x || pos.y !== creepPos.y) {  // 如果 target !== start 当前所在位置才需要移动
                    // creep.room.visual.line(creep.pos, pos, lineStyle[0]);
                    const puller = pullPair.get(start);
                    if (puller) {
                        originMove.call(creep, Game.creeps[puller]);
                    } else {
                        originMove.call(creep, getDirection(creepPos, pos));
                    }
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
                const creepPos = creep.pos;
                const pos = tile2Pos(target[i]);
                if (pos.x !== creepPos.x || pos.y !== creepPos.y) {  // 如果 target !== start 当前所在位置才需要移动
                    // if (pos.roomName === creepPos.roomName) creep.room.visual.line(creep.pos, pos, lineStyle[start % lineStyle.length]);
                    // console.log(`squad ${creep.name} from ${JSON.stringify(creepPos)} move to ${JSON.stringify(pos)}: ${getDirection(creepPos, pos)}`);
                    const puller = pullPair.get(creep.name);
                    if (puller) {
                        originMove.call(creep, Game.creeps[puller]);
                    } else {
                        originMove.call(creep, getDirection(creepPos, pos));
                    }
                    moveCount++;
                }
            }
        }
    }

    analyzeCPU['endTickResolve'].calls++;
    analyzeCPU['endTickResolve'].moveCount += moveCount;
    analyzeCPU['endTickResolve'].sum += Game.cpu.getUsed() - startTime - moveCount * 0.2;
}

function preTickBetterMove() {
    cachedMoveIntents.clear();
    creepToSquad.clear();
    squadToCreeps.clear();
    squadNextTile.clear();
    rerouteSquad.clear();
    checkedTiles.clear();
    nameToIntentIdx.clear();
    pullPair.clear();
    creepIdx = 1;
    squadIdx = 1;
}

/***************************************
 *  初始化
 *  ob寻路、自动visual将在v0.9.x或v1.0.x版本加入
 *  RoomPosition.prototype.findClosestByPath()将在v1.1加入
 */
// avoidRooms = avoidRooms.reduce((temp, roomName) => {
//     temp[roomName] = 1;
//     return temp;
// }, {});


Creep.prototype.move = wrapFn(betterMove, 'move');
PowerCreep.prototype.move = wrapFn(betterMove, 'move');
Creep.prototype.moveTo = wrapFn(betterMoveTo, 'moveTo');
PowerCreep.prototype.moveTo = wrapFn(betterMoveTo, 'moveTo');
Creep.prototype.cancelOrder = betterCancelOrder;
PowerCreep.prototype.cancelOrder = betterCancelOrder;
Creep.prototype.pull = wrapFn(betterPull, 'pull');
RoomPosition.prototype.findSquadPathTo = wrapFn(findSquadPathTo, 'findSquadPathTo');
// findClosestByPath 暂未完成，后续版本可能更新
// RoomPosition.prototype.findClosestByPath = wrapFn(betterFindClosestByPath, 'findClosestByPath');

global.BetterMove = {
    squadMove,
    squadMoveTo,
    preTickBetterMove,
    endTickResolve,
    getSquadCostMatrix: function (roomName, ignoreDestructibleStructures) {
        const cache = costMatrixCache[roomName];
        if (cache) {
            return cache['squad'][!!ignoreDestructibleStructures].clone();
        }
        return undefined;

    },
    setPathClearDelay: function (number) {
        if (typeof number == "number" && number > 0) {
            pathClearDelay = Math.ceil(number);
            return OK;
        } else if (number === undefined) {
            pathClearDelay = undefined;
        }
        return ERR_INVALID_ARGS;
    },
    setHostileCostMatrixClearDelay: function (number) {
        if (typeof number == "number" && number > 0) {
            hostileCostMatrixClearDelay = Math.ceil(number);
            return OK;
        } else if (number === undefined) {
            hostileCostMatrixClearDelay = undefined;
            return OK;
        }
        return ERR_INVALID_ARGS;
    },
    deleteCostMatrix: function (roomName) {
        let parsed = parseRoomName(roomName);
        if (parsed) {
            delete costMatrixCache[roomName];
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    deletePath: function (fromPos, toPos, opts) {   // TODO
        //if(!(fromPos instanceof RoomPosition))
        return 'not implemented'
    },
    deletePathInRoom: function (roomName) {
        let parsed = parseRoomName(roomName);
        if (parsed) {
            module.exports.deleteCostMatrix(roomName);
            let fromalCentralPos = formalize({ x: 25, y: 25, roomName: roomName });
            minX = fromalCentralPos.x + fromalCentralPos.y - 48;
            maxX = fromalCentralPos.x + fromalCentralPos.y + 48;
            minY = minX;
            maxY = maxX;
            for (combinedX = minX; combinedX <= maxX; combinedX++) {
                if (combinedX in globalPathCache) {
                    for (combinedY = minY; combinedY <= maxY; combinedY++) {
                        if (combinedY in globalPathCache[combinedX]) {
                            for (let path of globalPathCache[combinedX][combinedY]) {     // 这个数组应该会很短
                                let posArray = path.posArray;
                                if (posArray[0].roomName == roomName && posArray[posArray.length - 1].roomName == roomName) {     // 是这个房间的路
                                    deletePath(path);
                                }
                            }
                        }
                    }
                }
            }
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    addAvoidRooms: function (roomName) {
        let parsed = parseRoomName(roomName);
        if (parsed) {
            avoidRooms.add(roomName);
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    deleteAvoidRooms: function (roomName) {
        let parsed = parseRoomName(roomName);
        if (parsed) {
            avoidRooms.delete(roomName);
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    addAvoidExits: function (fromRoomName, toRoomName) {
        let parsed1 = parseRoomName(fromRoomName);
        let parsed2 = parseRoomName(toRoomName);
        if (parsed1 && parsed2) {
            if (avoidExits.has(fromRoomName)) {
                avoidExits.get(fromRoomName).add(toRoomName);
            } else {
                avoidExits.set(fromRoomName, new Set([toRoomName]));
            }
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    deleteAvoidExits: function (fromRoomName, toRoomName) { // 【未启用】
        let parsed1 = parseRoomName(fromRoomName);
        let parsed2 = parseRoomName(toRoomName);
        if (parsed1 && parsed2) {
            if (avoidExits.has(fromRoomName) && avoidExits.get(fromRoomName).has(toRoomName)) {
                avoidExits.get(fromRoomName).delete(toRoomName);
            }
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    print: function () {
        let text = '\navarageTime\tcalls\tFunctionName';
        for (let fn in analyzeCPU) {
            const stat = analyzeCPU[fn];
            const avg = stat.calls > 0 ? (stat.sum / stat.calls).toFixed(5) : '0.0';
            text += `\n${avg}\t\t${stat.calls}\t\t${fn}`;
        }
        const totalCacheSearches = testCacheMiss + testCacheHits;
        const hitCost = testCacheHits > 0 ? cacheHitCost / testCacheHits : 0;
        const missCost = testCacheMiss > 0 ? cacheMissCost / testCacheMiss : 0;
        const missRate = totalCacheSearches > 0 ? testCacheMiss / totalCacheSearches : 0;
        const moveCount = analyzeCPU['endTickResolve'].moveCount || 0;
        const costPerMove = moveCount > 0 ? ((analyzeCPU['moveTo'].sum + analyzeCPU['endTickResolve'].sum) / moveCount).toFixed(5) : '0.00000';
        text += `\nnormal logical cost per move: ${costPerMove}, total move count: ${moveCount}`;
        const moveToCalls = analyzeCPU['moveTo'].calls || 0;
        const searchRate = moveToCalls > 0 ? ((totalCacheSearches) / moveToCalls).toFixed(4) : '0.0000';
        const avgCheckPaths = totalCacheSearches > 0 ? (pathCounter / totalCacheSearches).toFixed(3) : '0.000';
        text += `\ncache search rate: ${searchRate}, total hit rate: ${(1 - missRate).toFixed(4)}, avg check paths: ${avgCheckPaths}`;
        text += `\ncache hit avg cost: ${(hitCost).toFixed(5)}, cache miss avg cost: ${(missCost).toFixed(5)}, total avg cost: ${(hitCost * (1 - missRate) + missCost * missRate).toFixed(5)}`;
        return text;
    },
    clear: () => { }
    // clear: clearUnused
}