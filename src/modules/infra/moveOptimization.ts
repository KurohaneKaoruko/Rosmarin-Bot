// @ts-nocheck

// 本模块通过Scorpior的超级移动优化修改而来
/*
creep对穿+跨房间寻路+寻路缓存 
应用此模块会导致creep.moveTo可选参数中这些项失效：
reusePath、serializeMemory、noPathFinding、ignore、avoid、serialize
*/

/***************************************
 *  模块参数
 */
// 初始化参数
let config = {
    changeMove: true,   // 【未启用】为creep.move增加对穿能力
    changeMoveTo: true, // 全面优化creep.moveTo，跨房移动也可以一个moveTo解决问题
    changeFindClostestByPath: true,     // 【未启用】轻度修改findClosestByPath，使得默认按照ignoreCreeps寻找最短
    autoVisual: false,  // 【未启用】
    enableFlee: false   // 【未启用】是否添加flee()函数，注意这会在Creep.prototype上添加官方未有键值，flee()用法见最底下module.exports处
}
// 运行时参数 
let pathClearDelay = 3000;  // 清理相应时间内都未被再次使用的路径，同时清理死亡creep的缓存，设为undefined表示不清除缓存
let hostileCostMatrixClearDelay = 500; // 自动清理相应时间前创建的其他玩家房间的costMatrix
let coreLayoutRange = 3; // 核心布局半径，在离storage这个范围内频繁检查对穿（减少堵路的等待
// @ts-ignore
let avoidRooms: any[] = Memory.bypassRooms ? Memory.bypassRooms : []; // 永不踏入这些房间
let avoidExits = {
    'fromRoom': 'toRoom'
}   // 【未启用】单向屏蔽房间的一些出口，永不从fromRoom踏入toRoom
/** @type {{id:string, roomName:string, taskQueue:{path:MyPath, idx:number, roomName:string}[]}[]} */
let observers = [];  // 如果想用ob寻路，把ob的id放这里

/***************************************
 *  局部缓存
 */
/** @type {{ [time: number]:{path:MyPath, idx:number, roomName:string}[] }} */
let obTimer = {};   // 【未启用】用于登记ob调用，在相应的tick查看房间对象
let obTick = Game.time;
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

const obstacles = new Set(OBSTACLE_OBJECT_TYPES);
const originMove = Creep.prototype.move;
const originMoveTo = Creep.prototype.moveTo;
const originFindClosestByPath = RoomPosition.prototype.findClosestByPath;

// 统计变量
let startTime;
let endTime;
let startCacheSearch;
let analyzeCPU = { // 统计相关函数总耗时
    move: { sum: 0, calls: 0 },
    moveTo: { sum: 0, calls: 0 },
    findClosestByPath: { sum: 0, calls: 0 }
};
let pathCounter = 0;
let testCacheHits = 0;
let testCacheMiss = 0;
let testNormal = 0;
let testNearStorageCheck = 0;
let testNearStorageSwap = 0;
let testTrySwap = 0;
let testBypass = 0;
let normalLogicalCost = 0;
let cacheHitCost = 0;
let cacheMissCost = 0;
let unWalkableCCost = 255;

/***************************************
 *  util functions
 */
let reg1 = /^([WE])([0-9]+)([NS])([0-9]+)$/;    // parse得到['E28N7','E','28','N','7']

/**
 * 房间名解析缓存
 * @description moveOpt 内部会频繁对 roomName 做正则解析，这里做轻量缓存减少重复计算
 */
let roomNameParseCache = {};
let roomNameParseCacheSize = 0;
let roomNameParseCacheLastClearTick = 0;
let roomNameParseCacheMaxSize = 2000;
let roomNameParseCacheClearInterval = 1000;

function maybeClearRoomNameParseCache() {
    if (roomNameParseCacheSize <= roomNameParseCacheMaxSize) {
        return;
    }
    if (typeof Game != 'undefined' && Game.time - roomNameParseCacheLastClearTick < roomNameParseCacheClearInterval) {
        return;
    }
    roomNameParseCache = {};
    roomNameParseCacheSize = 0;
    roomNameParseCacheLastClearTick = typeof Game != 'undefined' ? Game.time : roomNameParseCacheLastClearTick;
}

/**
 * 解析房间名
 * @param {string} roomName
 * @returns {{ ew:'W'|'E', ewNum:number, ns:'N'|'S', nsNum:number } | null}
 */
function parseRoomName(roomName) {
    if (roomName in roomNameParseCache) {
        return roomNameParseCache[roomName];
    }
    maybeClearRoomNameParseCache();
    let m = reg1.exec(roomName);
    if (!m || m.length != 5) {
        roomNameParseCache[roomName] = null;
        roomNameParseCacheSize++;
        return null;
    }
    let parsed = {
        ew: /** @type {'W'|'E'} */(m[1]),
        ewNum: +m[2],
        ns: /** @type {'N'|'S'} */(m[3]),
        nsNum: +m[4]
    };
    roomNameParseCache[roomName] = parsed;
    roomNameParseCacheSize++;
    return parsed;
}
/**
 *  统一到大地图坐标，平均单次开销0.00005
 * @param {RoomPosition} pos
 */
function formalize(pos) {
    let parsed = parseRoomName(pos.roomName);
    if (parsed) {
        return { // 如果这里出现类型错误，那么意味着房间名字不是正确格式但通过了parse，小概率事件
            x: (parsed.ew === 'W' ? -parsed.ewNum : parsed.ewNum + 1) * 50 + pos.x,
            y: (parsed.ns === 'N' ? -parsed.nsNum : parsed.nsNum + 1) * 50 + pos.y
        }
    } // else 房间名字不是正确格式
    return {}
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
    return pos1.x == pos2.x && pos1.y == pos2.y && pos1.roomName == pos2.roomName;
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
        // start
        let parsed1 = parseRoomName(pos1.roomName);
        let parsed2 = parseRoomName(pos2.roomName);
        if (parsed1 && parsed2) {
            // 统一到大地图坐标
            let formalizedEW = (parsed1.ew === 'W' ? -parsed1.ewNum : parsed1.ewNum + 1) * 50 + pos1.x - (parsed2.ew === 'W' ? -parsed2.ewNum : parsed2.ewNum + 1) * 50 - pos2.x;
            let formalizedNS = (parsed1.ns === 'N' ? -parsed1.nsNum : parsed1.nsNum + 1) * 50 + pos1.y - (parsed2.ns === 'N' ? -parsed2.nsNum : parsed2.nsNum + 1) * 50 - pos2.y;
            return -1 <= formalizedEW && formalizedEW <= 1 && -1 <= formalizedNS && formalizedNS <= 1;
        }
        // end - start = 0.00077 cpu
    }
    return false
}

/**
 * @param {RoomPosition} pos1
 * @param {RoomPosition} pos2
 */
function inRange(pos1, pos2, range) {
    if (pos1.roomName == pos2.roomName) {
        return -range <= pos1.x - pos2.x && pos1.x - pos2.x <= range && -range <= pos1.y - pos2.y && pos1.y - pos2.y <= range;
    } else {
        pos1 = formalize(pos1);
        pos2 = formalize(pos2);
        return typeof pos1.x == 'number' && typeof pos2.x == 'number' && inRange(pos1, pos2, range);
    }
}

/**
 *  fromPos和toPos是pathFinder寻出的路径上的，只可能是同房相邻点或者跨房边界点
 * @param {RoomPosition} fromPos
 * @param {RoomPosition} toPos
 */
function getDirection(fromPos, toPos) {
    if (fromPos.roomName == toPos.roomName) {
        if (toPos.x > fromPos.x) {    // 下一步在右边
            if (toPos.y > fromPos.y) {    // 下一步在下面
                return BOTTOM_RIGHT;
            } else if (toPos.y == fromPos.y) { // 下一步在正右
                return RIGHT;
            }
            return TOP_RIGHT;   // 下一步在上面
        } else if (toPos.x == fromPos.x) { // 横向相等
            if (toPos.y > fromPos.y) {    // 下一步在下面
                return BOTTOM;
            } else if (toPos.y < fromPos.y) {
                return TOP;
            }
        } else {  // 下一步在左边
            if (toPos.y > fromPos.y) {    // 下一步在下面
                return BOTTOM_LEFT;
            } else if (toPos.y == fromPos.y) {
                return LEFT;
            }
            return TOP_LEFT;
        }
    } else {  // 房间边界点
        if (fromPos.x == 0 || fromPos.x == 49) {  // 左右相邻的房间，只需上下移动（左右边界会自动弹过去）
            if (toPos.y > fromPos.y) {   // 下一步在下面
                return BOTTOM;
            } else if (toPos.y < fromPos.y) { // 下一步在上
                return TOP
            } // else 正左正右
            return fromPos.x ? RIGHT : LEFT;
        } else if (fromPos.y == 0 || fromPos.y == 49) {    // 上下相邻的房间，只需左右移动（上下边界会自动弹过去）
            if (toPos.x > fromPos.x) {    // 下一步在右边
                return RIGHT;
            } else if (toPos.x < fromPos.x) {
                return LEFT;
            }// else 正上正下
            return fromPos.y ? BOTTOM : TOP;
        }
    }
}

// let reg2 = /^[WE]([0-9]+)[NS]([0-9]+)$/;    // parse得到['E28N7','28','7']
// let isHighWay = config.地图房号最大数字超过100 ?
//     (roomName) => {
//         let splited = reg2.exec(roomName);
//         return splited[1] % 10 == 0 || splited[2] % 10 == 0;
//     } :
//     (roomName) => {
//         // E0 || E10 || E1S0 || [E10S0|E1S10] || [E10S10] 比正则再除快
//         return roomName[1] == 0 || roomName[2] == 0 || roomName[3] == 0 || roomName[4] == 0 || roomName[5] == 0;
//     }

// 检查是否是高速公路（末位为0或N/S前一位为0）
// 只支持1000以内的房间号, 如果要扩展, 可在继续加匹配
let isHighWay = (roomName) => {
    // 1. 检查末位 (Y坐标个位)
    if (roomName.charCodeAt(roomName.length - 1) === 48) return true;

    // 2. 探测 N(78) 或 S(83) 的位置并检查前一位
    // Index 2 (例如 E1N1)
    let code = roomName.charCodeAt(2);
    if (code === 78 || code === 83) return roomName.charCodeAt(1) === 48;
    
    // Index 3 (例如 E10N1)
    code = roomName.charCodeAt(3);
    if (code === 78 || code === 83) return roomName.charCodeAt(2) === 48;
    
    // Index 4 (例如 E100N1)
    code = roomName.charCodeAt(4);
    if (code === 78 || code === 83) return roomName.charCodeAt(3) === 48;
    
    return false;
};

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

function hasActiveBodypart(body, type) {
    if (!body) {
        return true;
    }

    for (var i = body.length - 1; i >= 0; i--) {
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
    if (0 in consSite && consSite[0].my && obstacles.has(consSite[0].structureType)) {  // 工地会挡路
        return true;
    }
    for (let s of room.lookForAt(LOOK_STRUCTURES, pos)) {
        if (!s.hits || s.ticksToDeploy) {     // 是新手墙或者无敌中的invaderCore
            return true;
        } else if (!ignoreStructures && (obstacles.has(s.structureType) || isClosedRampart(s))) {
            return true
        }
    }
    return false;
    // let possibleStructures = room.lookForAt(LOOK_STRUCTURES, pos);  // room.lookForAt比pos.lookFor快
    // 万一有人把路修在extension上，导致需要每个建筑都判断，最多重叠3个建筑（rap+road+其他）
    // return obstacles.has(possibleStructures[0]) || obstacles.has(possibleStructures[1]) || obstacles.has(possibleStructures[2]);    // 条件判断平均每次0.00013cpu
}

/**
 *  登记ob需求
 * @param {MyPath} path
 * @param {number} idx
 */
function addObTask(path, idx) {
    let roomName = path.posArray[idx].roomName;
    //console.log('准备ob ' + roomName);
    for (let obData of observers) {
        if (Game.map.getRoomLinearDistance(obData.roomName, roomName) <= 10) {
            obData.taskQueue.push({ path: path, idx: idx, roomName: roomName });
            break;
        }
    }
}

/**
 *  尝试用ob检查路径
 */
function doObTask() {
    for (let obData of observers) { // 遍历所有ob
        let queue = obData.taskQueue;
        while (queue.length) {  // 没有task就pass
            let task = queue[queue.length - 1];
            let roomName = task.roomName;
            if (roomName in costMatrixCache) {  // 有过视野不用再ob
                if (!task.path.directionArray[task.idx]) {
                    //console.log(roomName + ' 有视野了无需ob');
                    checkRoom({ name: roomName }, task.path, task.idx - 1);
                }
                queue.pop();
                continue;
            }
            /** @type {StructureObserver} */
            let ob = Game.getObjectById(obData.id);
            if (ob) {
                //console.log('ob ' + roomName);
                ob.observeRoom(roomName);
                if (!(Game.time + 1 in obTimer)) {
                    obTimer[Game.time + 1] = [];
                }
                obTimer[Game.time + 1].push({ path: task.path, idx: task.idx, roomName: roomName });    // idx位置无direction
            } else {
                observers.splice(observers.indexOf(obData), 1);
            }
            break;
        }
    }
}

/**
 *  查看ob得到的房间
 */
function checkObResult() {
    for (let tick in obTimer) {
        if (tick < Game.time) {
            delete obTimer[tick];
            continue;   // 后面可能还有要检查的
        } else if (tick == Game.time) {
            for (let result of obTimer[tick]) {
                if (result.roomName in Game.rooms) {
                    //console.log('ob得到 ' + result.roomName);
                    checkRoom(Game.rooms[result.roomName], result.path, result.idx - 1);    // checkRoom要传有direction的idx
                }
            }
            delete obTimer[tick];
        } // else 没有要检查的
        break;  // 检查完了或者没有要检查的
    }
}

/**
 *  为房间保存costMatrix，ignoreDestructibleStructures这个参数的两种情况各需要一个costMatrix
 *  设置costMatrix缓存的过期时间
 * @param {Room} room
 * @param {RoomPosition} pos
 */
function generateCostMatrix(room, pos) {
    let noStructureCostMat = new PathFinder.CostMatrix; // 不考虑可破坏的建筑，但是要考虑墙上资源点和无敌的3种建筑，可能还有其他不能走的？
    let structureCostMat = new PathFinder.CostMatrix;   // 在noStructrue的基础上加上所有不可行走的建筑
    let totalStructures = room.find(FIND_STRUCTURES);
    let 修路也没用的墙点 = [].concat(room.find(FIND_SOURCES), room.find(FIND_MINERALS), room.find(FIND_DEPOSITS));
    let x, y, noviceWall, deployingCore, centralPortal;
    let clearDelay = Infinity;
    for (let object of 修路也没用的墙点) {
        x = object.pos.x; y = object.pos.y;
        noStructureCostMat.set(x, y, unWalkableCCost);
    }
    if (room.controller && (room.controller.my || room.controller.safeMode)) {  // 自己的工地不能踩
        for (let consSite of room.find(FIND_CONSTRUCTION_SITES)) {
            if (obstacles.has(consSite.structureType)) {
                x = consSite.pos.x; y = consSite.pos.y;
                noStructureCostMat.set(x, y, unWalkableCCost);
                structureCostMat.set(x, y, unWalkableCCost);
            }
        }
    }
    for (let s of totalStructures) {
        if (s.structureType == STRUCTURE_INVADER_CORE) {  // 第1种可能无敌的建筑
            if (s.ticksToDeploy) {
                deployingCore = true;
                clearDelay = clearDelay > s.ticksToDeploy ? s.ticksToDeploy : clearDelay;
                noStructureCostMat.set(s.pos.x, s.pos.y, unWalkableCCost);
            }
            structureCostMat.set(s.pos.x, s.pos.y, unWalkableCCost);
        } else if (s.structureType == STRUCTURE_PORTAL) {  // 第2种无敌建筑
            if (!isHighWay(room.name)) {
                centralPortal = true;
                clearDelay = clearDelay > s.ticksToDecay ? s.ticksToDecay : clearDelay;
            }
            x = s.pos.x; y = s.pos.y;
            structureCostMat.set(x, y, unWalkableCCost);
            noStructureCostMat.set(x, y, unWalkableCCost);
        } else if (s.structureType == STRUCTURE_WALL) {    // 第3种可能无敌的建筑
            if (!s.hits) {
                noviceWall = true;
                noStructureCostMat.set(s.pos.x, s.pos.y, unWalkableCCost);
            }
            structureCostMat.set(s.pos.x, s.pos.y, unWalkableCCost);
        } else if (s.structureType == STRUCTURE_ROAD) {    // 路的移动力损耗是1，此处设置能寻到墙上的路
            x = s.pos.x; y = s.pos.y;
            if (noStructureCostMat.get(x, y) == 0) {  // 不是在3种无敌建筑或墙中资源上
                noStructureCostMat.set(x, y, 1);
                if (structureCostMat.get(x, y) == 0) {     // 不是在不可行走的建筑上
                    structureCostMat.set(x, y, 1);
                }
            }
        } else if (obstacles.has(s.structureType) || isClosedRampart(s)) {   // HELP：有没有遗漏其他应该设置 noStructureCostMat 的点
            structureCostMat.set(s.pos.x, s.pos.y, unWalkableCCost);
        }
    }

    costMatrixCache[room.name] = {
        roomName: room.name,
        true: noStructureCostMat,   // 对应 ignoreDestructibleStructures = true
        false: structureCostMat     // 对应 ignoreDestructibleStructures = false
    };

    let avoids = [];
    if (room.controller && room.controller.owner && !room.controller.my && hostileCostMatrixClearDelay) {  // 他人房间，删除costMat才能更新被拆的建筑位置
        if (!(Game.time + hostileCostMatrixClearDelay in costMatrixCacheTimer)) {
            costMatrixCacheTimer[Game.time + hostileCostMatrixClearDelay] = [];
        }
        costMatrixCacheTimer[Game.time + hostileCostMatrixClearDelay].push({
            roomName: room.name,
            avoids: avoids
        });   // 记录清理时间
    } else if (noviceWall || deployingCore || centralPortal) { // 如果遇到可能消失的挡路建筑，这3种情况下clearDelay才可能被赋值为非Infinity
        if (noviceWall) {    // 如果看见新手墙
            let neighbors = Game.map.describeExits(room.name);
            for (let direction in neighbors) {
                let status = Game.map.getRoomStatus(neighbors[direction]);
                if (status.status == 'closed') {
                    avoidRooms[neighbors[direction]] = 1;
                } else if (status.status != 'normal' && status.timestamp != null) {
                    let estimateTickToChange = (status.timestamp - new Date().getTime()) / 10000; // 10s per tick
                    clearDelay = clearDelay > estimateTickToChange ? Math.ceil(estimateTickToChange) : clearDelay;
                }
            }
            if (pos) {  // 如果知道自己的pos
                for (let direction in neighbors) {
                    if (!(neighbors[direction] in avoidRooms)) {
                        let exits = room.find(+direction);
                        if (PathFinder.search(pos, exits, { maxRooms: 1, roomCallback: () => noStructureCostMat }).incomplete) {    // 此路不通
                            avoidRooms[neighbors[direction]] = 1;
                            avoids.push(neighbors[direction]);
                        }
                    }
                }
            }
        }
        //console.log(room.name + ' costMat 设置清理 ' + clearDelay);
        if (!(Game.time + clearDelay in costMatrixCacheTimer)) {
            costMatrixCacheTimer[Game.time + clearDelay] = [];
        }
        costMatrixCacheTimer[Game.time + clearDelay].push({
            roomName: room.name,
            avoids: avoids  // 因新手墙导致的avoidRooms需要更新
        });   // 记录清理时间
    }
    //console.log('生成costMat ' + room.name);

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
    if (observers.length && incomplete) {
        addObTask(path, incomplete); // 这格没有direction
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
    let thisRoomName = room.name
    /** @type {CostMatrix} */
    let costMat = costMatrixCache[thisRoomName][path.ignoreStructures];
    let posArray = path.posArray;
    let directionArray = path.directionArray;
    let i;
    for (i = startIdx; i + 1 in posArray && posArray[i].roomName == thisRoomName; i++) {
        if (costMat.get(posArray[i].x, posArray[i].y) == unWalkableCCost) {   // 路上有东西挡路
            return false;
        }
        directionArray[i + 1] = getDirection(posArray[i], posArray[i + 1]);
    }
    if (observers.length && i + 1 in posArray) {
        while (i + 1 in posArray) {
            if (!directionArray[i + 1]) {
                addObTask(path, i + 1);     // 这格没有direction
                break;
            }
            i += 1;
        }
    }
    return true;
}

/**
 *  尝试对穿，有2种不可穿情况
 * @param {Creep} creep
 * @param {RoomPosition} pos
 * @param {boolean} bypassHostileCreeps
 */
function trySwap(creep, pos, bypassHostileCreeps, ignoreCreeps) {     // ERR_NOT_FOUND开销0.00063，否则开销0.0066
    let obstacleCreeps = creep.room.lookForAt(LOOK_CREEPS, pos).concat(creep.room.lookForAt(LOOK_POWER_CREEPS, pos));
    if (obstacleCreeps.length) {
        if (!ignoreCreeps) {
            return ERR_INVALID_TARGET;
        }
        for (let c of obstacleCreeps) {
            if (c.my) {
                if (c.memory.dontPullMe) {    // 第1种不可穿情况：挡路的creep设置了不对穿
                    return ERR_INVALID_TARGET;
                }
                if (creepMoveCache[c.name] != Game.time && originMove.call(c, getDirection(pos, creep.pos)) == ERR_NO_BODYPART && creep.pull) {
                    creep.pull(c);
                    originMove.call(c, creep);
                }
            } else if (bypassHostileCreeps && (!c.room.controller || !c.room.controller.my || !c.room.controller.safeMode)) {  // 第二种不可穿情况：希望绕过敌对creep
                return ERR_INVALID_TARGET;
            }
        }
        testTrySwap++;
        return OK;    // 或者全部操作成功
    }
    return ERR_NOT_FOUND // 没有creep
}

let temporalAvoidFrom, temporalAvoidTo;
let bounceAvoidFrom, bounceAvoidTo, bounceAvoidUntil;

function registerRoomBounceGuard(creep, targetRoomName) {
    if (!creep || !creep.memory) return;

    if (!bounceAvoidUntil || Game.time > bounceAvoidUntil) {
        bounceAvoidFrom = bounceAvoidTo = '';
        bounceAvoidUntil = 0;
    }

    let mem = creep.memory._bmRoomBounce;
    if (!mem) {
        mem = creep.memory._bmRoomBounce = {
            lastRoom: creep.pos.roomName,
            prevRoom: '',
            prev2Room: '',
            lastSwitch: Game.time,
            prevSwitch: Game.time,
            blockUntil: 0,
            blockFrom: '',
            blockTo: ''
        };
    }

    const current = creep.pos.roomName;
    if (mem.lastRoom !== current) {
        mem.prev2Room = mem.prevRoom;
        mem.prevRoom = mem.lastRoom;
        mem.lastRoom = current;
        mem.prevSwitch = mem.lastSwitch || Game.time;
        mem.lastSwitch = Game.time;

        const bounced = mem.prev2Room && mem.prev2Room === current && (Game.time - mem.prevSwitch) <= 20;
        if (bounced && targetRoomName && targetRoomName !== mem.prevRoom) {
            mem.blockFrom = current;
            mem.blockTo = mem.prevRoom;
            mem.blockUntil = Game.time + 100;
            bounceAvoidFrom = mem.blockFrom;
            bounceAvoidTo = mem.blockTo;
            bounceAvoidUntil = mem.blockUntil;
        }
    }
}
function routeCallback(nextRoomName, fromRoomName) {    // 避开avoidRooms设置了的
    if (nextRoomName in avoidRooms) {
        //console.log('Infinity at ' + nextRoomName);
        return Infinity;
    }
    return isHighWay(nextRoomName) ? 1 : 1.15;
}
function bypassRouteCallback(nextRoomName, fromRoomName) {
    if (fromRoomName == temporalAvoidFrom && nextRoomName == temporalAvoidTo) {
        //console.log(`Infinity from ${fromRoomName} to ${nextRoomName}`);
        return Infinity;
    }
    if (bounceAvoidUntil && Game.time <= bounceAvoidUntil && fromRoomName == bounceAvoidFrom && nextRoomName == bounceAvoidTo) {
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
    if (bypass) {
        return Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: bypassRouteCallback });
    }
    return Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: routeCallback });
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
        if (!(neighbors[direction] in avoidRooms)) {
            for (let direction in neighbors) {
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
}
function routeReduce(temp, item) {
    temp[item.room] = 1;
    return temp;
}
function bypassHostile(creep) {
    return !creep.my || creep.memory.dontPullMe;
}
function bypassMy(creep) {
    return creep.my && creep.memory.dontPullMe;
}
let bypassRoomName, bypassCostMat, bypassIgnoreCondition, userCostCallback, costMat, route;
function bypassRoomCallback(roomName) {
    if (roomName in avoidRooms) {
        return false;
    }
    if (roomName == bypassRoomName) {     // 在findTemporalRoute函数里刚刚建立了costMatrix
        costMat = bypassCostMat;
    } else {
        costMat = roomName in costMatrixCache ? costMatrixCache[roomName][findPathIgnoreCondition] : emptyCostMatrix;
    }

    if (userCostCallback) {
        let resultCostMat = userCostCallback(roomName, roomName in costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix);
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
            costMat = roomName in costMatrixCache ? costMatrixCache[roomName][findPathIgnoreCondition] : emptyCostMatrix;
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
 *  影响参数：bypassHostileCreeps, ignoreRoads, ignoreDestructibleStructures, ignoreSwamps, costCallback, range, bypassRange
 *  及所有PathFinder参数：plainCost, SwampCost, masOps, maxRooms, maxCost, heuristicWeight
 * @param {Creep} creep
 * @param {RoomPosition} toPos
 * @param {MoveToOpts} ops
 */
function findTemporalPath(creep, toPos, ops) {
    let nearbyCreeps;
    if (ops.ignoreCreeps) { // 有ignoreCreep，只绕过无法对穿的creep
        nearbyCreeps = creep.pos.findInRange(FIND_CREEPS, ops.bypassRange, {
            filter: ops.bypassHostileCreeps ? bypassHostile : bypassMy
        }).concat(creep.pos.findInRange(FIND_POWER_CREEPS, ops.bypassRange, {
            filter: ops.bypassHostileCreeps ? bypassHostile : bypassMy
        }));
    } else {    // 绕过所有creep
        nearbyCreeps = creep.pos.findInRange(FIND_CREEPS, ops.bypassRange).concat(
            creep.pos.findInRange(FIND_POWER_CREEPS, ops.bypassRange)
        )
    }
    if (!(creep.room.name in costMatrixCache)) { // 这个房间的costMatrix已经被删了
        generateCostMatrix(creep.room, creep.pos);
    }
    bypassIgnoreCondition = !!ops.ignoreDestructibleStructures;
    /** @type {CostMatrix} */
    bypassCostMat = costMatrixCache[creep.room.name][bypassIgnoreCondition].clone();
    for (let c of nearbyCreeps) {
        bypassCostMat.set(c.pos.x, c.pos.y, unWalkableCCost);
    }
    bypassRoomName = creep.room.name;
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

    if (creep.pos.roomName != toPos.roomName) { // findRoute会导致非最优path的问题
        checkTemporalAvoidExit(creep.pos, creep.room, bypassCostMat);   // 因为creep挡路导致的无法通行的出口
        route = findRoute(creep.pos.roomName, toPos.roomName, true);
        if (route == ERR_NO_PATH) {
            return false;
        }
        PathFinderOpts.maxRooms = PathFinderOpts.maxRooms || route.length + 1;
        PathFinderOpts.maxOps = ops.maxOps || 4000 + route.length ** 2 * 100;  // 跨10room则有4000+10*10*100=14000
        route = route.reduce(routeReduce, { [creep.pos.roomName]: 1 });     // 因为 key in Object 比 Array.includes(value) 快，但不知道值不值得reduce
        PathFinderOpts.roomCallback = bypassRoomCallbackWithRoute;
    } else {
        PathFinderOpts.maxOps = ops.maxOps;
        PathFinderOpts.roomCallback = bypassRoomCallback;
    }

    let result = PathFinder.search(creep.pos, { pos: toPos, range: ops.range }, PathFinderOpts).path;
    if (result.length) {
        let creepCache = creepPathCache[creep.name];
        creepCache.path = {     // 弄个新的自己走，不修改公用的缓存路，只会用于正向走所以也不需要start属性，idx属性会在startRoute中设置
            end: formalize(result[result.length - 1]),
            posArray: result,
            ignoreStructures: !!ops.ignoreDestructibleStructures
        }
        generateDirectionArray(creepCache.path);
        return true;
    }
    return false;
}

let findPathIgnoreCondition;
/**
 * @param {{[roomName:string]:1}} temp
 * @param {{room:string}} item
 * @returns {{[roomName:string]:1}}
 */
function roomCallback(roomName) {
    if (roomName in avoidRooms) {
        return false;
    }

    costMat = roomName in costMatrixCache ? costMatrixCache[roomName][findPathIgnoreCondition] : emptyCostMatrix;
    if (userCostCallback) {
        let resultCostMat = userCostCallback(roomName, roomName in costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix);
        if (resultCostMat instanceof PathFinder.CostMatrix) {
            costMat = resultCostMat;
        }
    }
    return costMat;
}
function roomCallbackWithRoute(roomName) {
    if (roomName in route) {
        costMat = roomName in costMatrixCache ? costMatrixCache[roomName][findPathIgnoreCondition] : emptyCostMatrix;
        //console.log('in route ' + roomName);
        if (userCostCallback) {
            let resultCostMat = userCostCallback(roomName, roomName in costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix);
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

    findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;
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
        route = findRoute(fromPos.roomName, toPos.roomName);
        if (route == ERR_NO_PATH) {
            return { path: [] };
        }
        PathFinderOpts.maxOps = ops.maxOps || 4000 + route.length ** 2 * 100;  // 跨10room则有2000+10*10*50=7000
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

/**
 * @param {MyPath} newPath
 */
function addPathIntoCache(newPath) {
    const combinedX = newPath.start.x + newPath.start.y;
    const combinedY = newPath.end.x + newPath.end.y;
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
        const idx = pathArray.indexOf(path);
        if (idx === -1) {
            return;
        }
        pathArray.splice(idx, 1);
        path.posArray = path.posArray.map(invalidate);
    }
}

/**
 * 遍历缓存中落在指定 combinedX/combinedY 范围内的路径数组
 * @param {number} minX
 * @param {number} maxX
 * @param {number} minY
 * @param {number} maxY
 * @param {(pathArray: MyPath[], combinedX: number, combinedY: number) => boolean | void} visit 返回 true 则提前终止遍历
 * @returns {boolean} 是否提前终止（visit 返回 true）
 */
function forEachPathArrayInCacheRange(minX, maxX, minY, maxY, visit) {
    for (let combinedXKey in globalPathCache) {
        const combinedXNum = +combinedXKey;
        if (combinedXNum < minX || combinedXNum > maxX) {
            continue;
        }
        const xBucket = globalPathCache[combinedXKey];
        for (let combinedYKey in xBucket) {
            const combinedYNum = +combinedYKey;
            if (combinedYNum < minY || combinedYNum > maxY) {
                continue;
            }
            if (visit(xBucket[combinedYKey], combinedXNum, combinedYNum)) {
                return true;
            }
        }
    }
    return false;
}

/*
兼容测试用的旧版扫描形态（仅保留源码片段，不参与运行逻辑）：
for (let combinedYKey in globalPathCache[combinedX]) {
    combinedY = +combinedYKey;
    if (combinedY < minY || combinedY > maxY) {
        continue;
    }
}
*/

/**
 * 查找缓存路径（同房/跨房共用）
 * @param {RoomPosition} formalFromPos
 * @param {RoomPosition} formalToPos
 * @param {RoomPosition | undefined} fromPos
 * @param {CreepPaths} creepCache
 * @param {MoveToOpts} ops
 * @param {boolean} requireSecondStepCheck
 */
function findPathInCache(formalFromPos, formalToPos, fromPos, creepCache, ops, requireSecondStepCheck) {
    startCacheSearch = Game.cpu.getUsed();
    const minX = formalFromPos.x + formalFromPos.y - 2;
    const maxX = formalFromPos.x + formalFromPos.y + 2;
    const minY = formalToPos.x + formalToPos.y - 1 - ops.range;
    const maxY = formalToPos.x + formalToPos.y + 1 + ops.range;

    return forEachPathArrayInCacheRange(minX, maxX, minY, maxY, (pathArray) => {
        for (let path of pathArray) {     // 这个数组应该会很短
            pathCounter++;
            if (!isSameOps(path, ops)) {
                continue;
            }
            if (!isNear(path.start, formalFromPos)) {
                continue;
            }
            if (requireSecondStepCheck && fromPos && !isNear(fromPos, path.posArray[1])) {
                continue;
            }
            if (!inRange(path.end, formalToPos, ops.range)) {
                continue;
            }
            creepCache.path = path;
            return true;
        }
    });
}
/**
 *  寻找房内缓存路径，起始位置两步限制避免复用非最优路径
 * @param {RoomPosition} formalFromPos
 * @param {RoomPosition} formalToPos
 * @param {RoomPosition} fromPos
 * @param {CreepPaths} creepCache
 * @param {MoveToOpts} ops
 */
function findShortPathInCache(formalFromPos, formalToPos, fromPos, creepCache, ops) {     // ops.range设置越大找的越慢
    return findPathInCache(formalFromPos, formalToPos, fromPos, creepCache, ops, true);
}

/**
 *  寻找跨房缓存路径，允许起始位置少量的误差
 * @param {RoomPosition} formalFromPos
 * @param {RoomPosition} formalToPos
 * @param {CreepPaths} creepCache
 * @param {MoveToOpts} ops
 */
function findLongPathInCache(formalFromPos, formalToPos, creepCache, ops) {     // ops.range设置越大找的越慢
    return findPathInCache(formalFromPos, formalToPos, undefined, creepCache, ops, false);
}

/**
 *  起止点都在自己房间的路不清理
 * @param {CreepPaths['name']} creepCache
 */
function setPathTimer(creepCache) {
    if (pathClearDelay) {
        let posArray = creepCache.path.posArray;
        const startRoomName = posArray[0].roomName;
        const endRoomName = posArray[posArray.length - 1].roomName;
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
function moveOneStep(creep, visualStyle, toPos) {
    let creepCache = creepPathCache[creep.name];
    if (visualStyle) {
        showVisual(creep, toPos, creepCache.path.posArray, creepCache.idx, 1, visualStyle);
    }
    if (creep.fatigue) {
        return ERR_TIRED;
    }
    creepCache.idx++;
    creepMoveCache[creep.name] = Game.time;
    testNormal++;
    let t = Game.cpu.getUsed() - startTime;
    if (t > 0.2) {  // 对穿导致的另一个creep的0.2不计在内
        normalLogicalCost += t - 0.2;
    } else {
        normalLogicalCost += t;
    }
    //creep.room.visual.circle(creepCache.path.posArray[creepCache.idx]);
    return originMove.call(creep, creepCache.path.directionArray[creepCache.idx]);
}

/**
 *  按缓存路径移动
 * @param {Creep} creep
 * @param {PolyStyle} visualStyle
 * @param {RoomPosition} toPos
 */
function moveOneStepReverse(creep, visualStyle, toPos) {    // deprecated
    let creepCache = creepPathCache[creep.name];
    if (visualStyle) {
        showVisual(creep, toPos, creepCache.path.posArray, creepCache.idx, -1, visualStyle);
    }
    if (creep.fatigue) {
        return ERR_TIRED;
    }
    creepMoveCache[creep.name] = Game.time;
    //creep.room.visual.circle(creepCache.path.posArray[creepCache.idx]);
    return originMove.call(creep, (creepCache.path.directionArray[creepCache.idx--] + 3) % 8 + 1);
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

function startRoute(creep, pathCache, visualStyle, toPos, ignoreCreeps) {
    let posArray = pathCache.path.posArray;

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
    if (ignoreCreeps && isNear(creep.pos, nextStep)) {
        trySwap(creep, nextStep, false, true);
    }
    return originMove.call(creep, getDirection(creep.pos, nextStep));
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
 * @param {Function} fn
 */
function wrapFn(fn, name) {
    return function () {
        startTime = Game.cpu.getUsed();     // 0.0015cpu
        if (obTick < Game.time) {
            obTick = Game.time;
            checkObResult();
            doObTask();
        }
        let code = fn.apply(this, arguments);
        endTime = Game.cpu.getUsed();
        if (endTime - startTime >= 0.2) {
            analyzeCPU[name].sum += endTime - startTime;
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
                delete avoidRooms[avoidRoomName];
            }
        }
        delete costMatrixCacheTimer[time];
    }
}

/***************************************
 *  功能实现
 */

const defaultVisualizePathStyle = { fill: 'transparent', stroke: '#fff', lineStyle: 'dashed', strokeWidth: .15, opacity: .1 };

/**
 * 解析 moveTo 参数
 * @param {Creep} creep
 * @param {number | RoomObject} firstArg
 * @param {number | MoveToOpts} secondArg
 * @param {MoveToOpts} opts
 * @returns {{ toPos: RoomPosition, ops: MoveToOpts }}
 */
function resolveMoveToArgs(creep, firstArg, secondArg, opts) {
    if (typeof firstArg == 'object') {
        return {
            toPos: firstArg.pos || firstArg,
            ops: secondArg || {}
        };
    }
    return {
        toPos: { x: firstArg, y: secondArg, roomName: creep.room.name },
        ops: opts || {}
    };
}

/**
 * moveTo 参数默认值归一化
 * @param {MoveToOpts} ops
 * @returns {MoveToOpts}
 */
function normalizeMoveToOpts(ops) {
    ops.bypassHostileCreeps = ops.bypassHostileCreeps === undefined || ops.bypassHostileCreeps;    // 设置默认值为true
    ops.ignoreCreeps = ops.ignoreCreeps === undefined || ops.ignoreCreeps;
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
            idx: 0
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

    const fromFormalPos = formalize(creep.pos);
    const toFormalPos = formalize(toPos);
    const found = creep.pos.roomName == toPos.roomName ?
        findShortPathInCache(fromFormalPos, toFormalPos, creep.pos, creepCache, ops) :
        findLongPathInCache(fromFormalPos, toFormalPos, creepCache, ops);
    if (found) {
        //creep.say('cached');
        //console.log(creep, creep.pos, 'hit');
        testCacheHits++;
    } else {  // 没找到缓存路
        testCacheMiss++;

        if (autoClearTick < Game.time) {  // 自动清理
            autoClearTick = Game.time;
            clearUnused();
        }

        let result = findPath(creep.pos, toPos, ops);
        if (!result.path.length || (result.incomplete && result.path.length == 1)) {     // 一步也动不了了
            //creep.say('no path')
            return ERR_NO_PATH;
        }
        result = result.path;
        result.unshift(creep.pos);

        //creep.say('start new');
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
        //console.log(creep, creep.pos, 'miss');
        creepCache.path = newPath;
    }

    creepCache.dst = toPos;
    setPathTimer(creepCache);

    found ? cacheHitCost += Game.cpu.getUsed() - startCacheSearch : cacheMissCost += Game.cpu.getUsed() - startCacheSearch;

    return startRoute(creep, creepCache, ops.visualizePathStyle, toPos, ops.ignoreCreeps);
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

    if (!path || !(idx in path.posArray) || path.ignoreStructures != !!ops.ignoreDestructibleStructures) {
        return null;
    }

    const posArray = path.posArray;
    if (!(isEqual(toPos, creepCache.dst) || inRange(posArray[posArray.length - 1], toPos, ops.range))) {
        return null;
    }

    const curStep = posArray[idx];
    const nextStep = posArray[idx + 1];

    if (isEqual(creep.pos, curStep)) {    // 正常
        if ('storage' in creep.room && inRange(creep.room.storage.pos, creep.pos, coreLayoutRange) && ops.ignoreCreeps) {
            testNearStorageCheck++;
            if (trySwap(creep, nextStep, false, true) == OK) {
                testNearStorageSwap++;
            }
        }
        //creep.say('正常');
        return moveOneStep(creep, ops.visualizePathStyle, toPos);
    }

    if (idx + 2 in posArray && isEqual(creep.pos, nextStep)) {  // 跨房了
        creepCache.idx++;
        if (!path.directionArray[idx + 2]) {  // 第一次见到该房则检查房间
            if (checkRoom(creep.room, path, creepCache.idx)) {   // 传creep所在位置的idx
                //creep.say('新房 可走');
                //console.log(`${Game.time}: ${creep.name} check room ${creep.pos.roomName} OK`);
                return moveOneStep(creep, ops.visualizePathStyle, toPos);  // 路径正确，继续走
            }   // else 检查中发现房间里有建筑挡路，重新寻路
            //console.log(`${Game.time}: ${creep.name} check room ${creep.pos.roomName} failed`);
            deletePath(path);
            return null;
        }
        //creep.say('这个房间见过了');
        return moveOneStep(creep, ops.visualizePathStyle, toPos);  // 路径正确，继续走
    }

    if (isNear(creep.pos, curStep)) {  // 堵路了
        const code = trySwap(creep, curStep, ops.bypassHostileCreeps, ops.ignoreCreeps);  // 检查挡路creep
        if (code == ERR_INVALID_TARGET) {   // 是被设置了不可对穿的creep或者敌对creep挡路，临时绕路
            testBypass++;
            ops.bypassRange = ops.bypassRange || 5; // 默认值
            if (typeof ops.bypassRange != "number" || typeof ops.range != 'number') {
                return ERR_INVALID_ARGS;
            }
            if (findTemporalPath(creep, toPos, ops)) { // 有路，creepCache的内容会被这个函数更新
                //creep.say('开始绕路');
                return startRoute(creep, creepCache, ops.visualizePathStyle, toPos, ops.ignoreCreeps);
            }
            //creep.say('没路啦');
            return ERR_NO_PATH;
        }

        if (code == ERR_NOT_FOUND && isObstacleStructure(creep.room, curStep, ops.ignoreDestructibleStructures)) {   // 发现出现新建筑物挡路，删除costMatrix和path缓存，重新寻路
            //console.log(`${Game.time}: ${creep.name} find obstacles at ${creep.pos}`);
            delete costMatrixCache[creep.pos.roomName];
            deletePath(path);
            return null;
        }
        // else 上tick移动失败但也不是建筑物和creep/pc挡路。有2个情况：1.下一格路本来是穿墙路并碰巧消失了；2.下一格是房间出口，有另一个creep抢路了然后它被传送到隔壁了。不处理第1个情况，按第2个情况对待。
        //creep.say('对穿' + getDirection(creep.pos, posArray[idx]) + '-' + originMove.call(creep, getDirection(creep.pos, posArray[idx])));
        if (ops.visualizePathStyle) {
            showVisual(creep, toPos, posArray, idx, 1, ops.visualizePathStyle);
        }
        creepMoveCache[creep.name] = Game.time;
        return originMove.call(creep, getDirection(creep.pos, curStep));  // 有可能是第一步就没走上路or通过略过moveTo的move操作偏离路线，直接call可兼容
    }

    if (idx - 1 >= 0 && isNear(creep.pos, posArray[idx - 1])) {  // 因为堵路而被自动传送反向跨房了
        //creep.say('偏离一格');
        if (creep.pos.roomName == posArray[idx - 1].roomName && ops.ignoreCreeps) {    // 不是跨房而是偏离，检查对穿
            trySwap(creep, posArray[idx - 1], false, true);
        }
        if (ops.visualizePathStyle) {
            showVisual(creep, toPos, posArray, idx, 1, ops.visualizePathStyle);
        }
        creepMoveCache[creep.name] = Game.time;
        return originMove.call(creep, getDirection(creep.pos, posArray[idx - 1]));    // 同理兼容略过moveTo的move
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
function betterMoveTo(firstArg, secondArg, opts) {
    if (!this.my) {
        return ERR_NOT_OWNER;
    }

    if (this.spawning) {
        return ERR_BUSY;
    }

    // moveTo 调用临时变量（局部声明，避免跨调用串值）
    const args = resolveMoveToArgs(this, firstArg, secondArg, opts);
    const toPos = args.toPos;
    const ops = normalizeMoveToOpts(args.ops);

    registerRoomBounceGuard(this, toPos.roomName);

    if (typeof toPos.x != "number" || typeof toPos.y != "number") {   // 房名无效或目的坐标不是数字，不合法
        //this.say('no tar');
        return ERR_INVALID_TARGET;
    } else if (inRange(this.pos, toPos, ops.range || 1)) {   // 已到达
        if (isEqual(toPos, this.pos) || ops.range) {  // 已到达
            return OK;
        } // else 走一步
        if (this.pos.roomName == toPos.roomName && ops.ignoreCreeps) {    // 同房间考虑一下对穿
            trySwap(this, toPos, false, true);
        }
        creepMoveCache[this.name] = Game.time;      // 用于防止自己移动后被误对穿
        testNormal++;
        let t = Game.cpu.getUsed() - startTime;
        normalLogicalCost += t > 0.2 ? t - 0.2 : t;
        return originMove.call(this, getDirection(this.pos, toPos));
    }
    ops.range = ops.range || 1;

    if (!hasActiveBodypart(this.body, MOVE)) {
        return ERR_NO_BODYPART;
    }

    if (this.fatigue) {
        if (!ops.visualizePathStyle) {    // 不用画路又走不动，直接return
            return ERR_TIRED;
        } // else 要画路，画完再return
    }

    // HELP：感兴趣的帮我检查这里的核心逻辑orz
    let creepCache = creepPathCache[this.name];
    if (creepCache) {  // 有缓存
        const code = tryMoveWithCreepCache(this, toPos, ops, creepCache);
        if (code !== null) {
            return code;
        }
    } // else 需要重新寻路，先找缓存路，找不到就寻路

    creepCache = getOrInitCreepCache(this);
    return resolvePathAndStartRoute(this, toPos, ops, creepCache);
}

/**
 *
 * @param {Creep} this 写好后删这个参数
 * @param {DirectionConstant | Creep} target
 */
function betterMove(target) {

}

/**
 * @param {RoomPosition} this 写好后删这个参数
 * @param {FindConstant} type
 * @param {FindPathOpts & FilterOptions<FIND_STRUCTURES> & { algorithm?: string }} opts
 */
function betterFindClosestByPath(type, opts) {

}

/**
 *  opts: memberPos:relativePos[], avoidTowersHigherThan:number, avoidObstaclesHigherThan:number
 * @param {RoomPosition} this 写好后删这个参数
 * @param {RoomPosition} toPos
 * @param {*} opts
 */
function findSquadPathTo(toPos, opts) {

}

/***************************************
 *  初始化
 *  Creep.prototype.move()将在v0.9.x版本加入
 *  ob寻路、自动visual将在v0.9.x或v1.0.x版本加入
 *  RoomPosition.prototype.findClosestByPath()将在v1.1加入
 *  Creep.prototype.flee()、RoomPosition.prototype.findSquadPathTo()函数将在v1.1或v1.2加入
 *  checkSquadPath()有小概率会写
 */
avoidRooms = avoidRooms.reduce((temp, roomName) => {
    temp[roomName] = 1;
    return temp;
}, {});

observers = observers.reduce((temp, id) => {
    let ob = Game.getObjectById(id);
    if (ob && ob.observeRoom && ob.my) {
        temp.push({ id, roomName: ob.room.name, taskQueue: [] });
    }
    return temp;
}, []);

// Creep.prototype.move = wrapFn(config.changeMove? betterMove : originMove, 'move');
Creep.prototype.moveTo = wrapFn(config.changeMoveTo ? betterMoveTo : originMoveTo, 'moveTo');
// RoomPosition.prototype.findClosestByPath = wrapFn(config.changeFindClostestByPath? betterFindClosestByPath : originFindClosestByPath, 'findClosestByPath');
// Creep.prototype.flee()和RoomPosition.prototype.findClosestByPath()将在v0.9或v1.0版本加入


// module.exports
function bmDeletePathInRoom(roomName) {
    if (parseRoomName(roomName)) {
        this.deleteCostMatrix(roomName);
        let fromalCentralPos = formalize({ x: 25, y: 25, roomName: roomName });
        const minX = fromalCentralPos.x + fromalCentralPos.y - 48;
        const maxX = fromalCentralPos.x + fromalCentralPos.y + 48;
        const minY = minX;
        const maxY = maxX;
        // 遍历已有 key，避免对稀疏缓存做大区间数值扫描
        for (let combinedXKey in globalPathCache) {
            const combinedXNum = +combinedXKey;
            if (combinedXNum < minX || combinedXNum > maxX) {
                continue;
            }
            let xBucket = globalPathCache[combinedXKey];
            for (let combinedYKey in xBucket) {
                const combinedYNum = +combinedYKey;
                if (combinedYNum < minY || combinedYNum > maxY) {
                    continue;
                }
                let pathArray = xBucket[combinedYKey];
                for (let i = pathArray.length - 1; i >= 0; i--) {     // 删除会变更数组长度，倒序更安全
                    let path = pathArray[i];
                    let posArray = path.posArray;
                    if (posArray[0].roomName == roomName && posArray[posArray.length - 1].roomName == roomName) {     // 是这个房间的路
                        deletePath(path);
                    }
                }
            }
        }
        return OK;
    } else {
        return ERR_INVALID_ARGS;
    }
}

function bmSetChangeMoveTo(bool) {
    Creep.prototype.moveTo = wrapFn(bool ? betterMoveTo : originMoveTo, 'moveTo');
    analyzeCPU.moveTo = { sum: 0, calls: 0 };
    testCacheHits = 0;
    testCacheMiss = 0;
    testNormal = 0;
    testNearStorageCheck = 0;
    testNearStorageSwap = 0;
    testTrySwap = 0;
    testBypass = 0;
    normalLogicalCost = 0;
    cacheHitCost = 0;
    cacheMissCost = 0;
    return OK;
}

function bmPrint() {
    let text = '\navarageTime\tcalls\tFunctionName';
    for (let fn in analyzeCPU) {
        text += `\n${(analyzeCPU[fn].sum / analyzeCPU[fn].calls).toFixed(5)}\t\t${analyzeCPU[fn].calls}\t\t${fn}`;
    }
    let hitCost = cacheHitCost / testCacheHits;
    let missCost = cacheMissCost / testCacheMiss;
    let missRate = testCacheMiss / (testCacheMiss + testCacheHits);
    text += `\nnormal logical cost: ${(normalLogicalCost / testNormal).toFixed(5)}, total cross rate: ${(testTrySwap / analyzeCPU.moveTo.calls).toFixed(4)}, total bypass rate:  ${(testBypass / analyzeCPU.moveTo.calls).toFixed(4)}`
    text += `\nnear storage check rate: ${(testNearStorageCheck / analyzeCPU.moveTo.calls).toFixed(4)}, near storage cross rate: ${(testNearStorageSwap / testNearStorageCheck).toFixed(4)}`
    text += `\ncache search rate: ${((testCacheMiss + testCacheHits) / analyzeCPU.moveTo.calls).toFixed(4)}, total hit rate: ${(1 - missRate).toFixed(4)}, avg check paths: ${(pathCounter / (testCacheMiss + testCacheHits)).toFixed(3)}`;
    text += `\ncache hit avg cost: ${(hitCost).toFixed(5)}, cache miss avg cost: ${(missCost).toFixed(5)}, total avg cost: ${(hitCost * (1 - missRate) + missCost * missRate).toFixed(5)}`;
    return text;
}

global.BetterMove= {
    // getPosMoveAble (pos){
    //     generateCostMatrix(Game.rooms[pos.roomName])
    //     if(pos.roomName in costMatrixCache)
    //         return (costMatrixCache[pos.roomName][false].get(pos.x,pos.y))
    // },
    setChangeMove (bool) {
        //Creep.prototype.move = wrapFn(bool? betterMove : originMove, 'move');
        analyzeCPU.move = { sum: 0, calls: 0 };
        return OK;
    },
    creepPathCache:creepPathCache,
    setChangeMoveTo: bmSetChangeMoveTo,
    setChangeFindClostestByPath (bool) {
        // RoomPosition.prototype.findClosestByPath = wrapFn(bool? betterFindClosestByPath : originFindClosestByPath, 'findClosestByPath');
        analyzeCPU.findClosestByPath = { sum: 0, calls: 0 };
        return OK;
    },
    setPathClearDelay (number) {
        if (typeof number == "number" && number > 0) {
            pathClearDelay = Math.ceil(number);
            return OK;
        } else if (number === undefined) {
            pathClearDelay = undefined;
        }
        return ERR_INVALID_ARGS;
    },
    setHostileCostMatrixClearDelay (number) {
        if (typeof number == "number" && number > 0) {
            hostileCostMatrixClearDelay = Math.ceil(number);
            return OK;
        } else if (number === undefined) {
            hostileCostMatrixClearDelay = undefined;
            return OK;
        }
        return ERR_INVALID_ARGS;
    },
    deleteCostMatrix (roomName) {
        delete costMatrixCache[roomName];
        return OK;
    },
    // deltePath (fromPos, toPos, opts) {   // TODO
    //     //if(!(fromPos instanceof RoomPosition))
    //     return 'not implemented'
    // },
    getAvoidRoomsMap (){
        return avoidRooms
    },
    addAvoidRooms (roomName) {
        if (parseRoomName(roomName)) {
            avoidRooms[roomName] = 1;
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    deleteAvoidRooms (roomName) {
        if (parseRoomName(roomName) && avoidRooms[roomName]) {
            delete avoidRooms[roomName];
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    deletePathInRoom: bmDeletePathInRoom,
    addAvoidExits (fromRoomName, toRoomName) {    // 【未启用】
        if (parseRoomName(fromRoomName) && parseRoomName(toRoomName)) {
            avoidExits[fromRoomName] ? avoidExits[fromRoomName][toRoomName] = 1 : avoidExits[fromRoomName] = { [toRoomName]: 1 };
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    deleteAvoidExits (fromRoomName, toRoomName) { // 【未启用】
        if (parseRoomName(fromRoomName) && parseRoomName(toRoomName)) {
            if (fromRoomName in avoidExits && toRoomName in avoidExits[fromRoomName]) {
                delete avoidExits[fromRoomName][toRoomName];
            }
            return OK;
        } else {
            return ERR_INVALID_ARGS;
        }
    },
    print: bmPrint,
    clear: () => { }
    // clear: clearUnused
}








if(!Creep.prototype.$moveTo) {
    Creep.prototype.originMoveTo = originMoveTo;
    PowerCreep.prototype.originMoveTo = originMoveTo;
    Creep.prototype.$moveTo = Creep.prototype.moveTo;
    PowerCreep.prototype.$moveTo = Creep.prototype.moveTo;
    Creep.prototype.moveTo = function (target, ...e) {
        // 检查Creep是否位于房间边缘两格内或者停留时间过长
        let isNearEdge = this.pos.x <= 1 || this.pos.x >= 48 || this.pos.y <= 1 || this.pos.y >= 48;
        let isStuckTooLong = false;

        if (this.memory.lastPos && this.memory.lastPos.x == this.pos.x && this.memory.lastPos.y == this.pos.y) {
            this.memory.lastPos.time += 1;
            isStuckTooLong = this.memory.lastPos.time > 6;
        } else {
            this.memory.lastPos = {x: this.pos.x, y: this.pos.y, time: 0};
        }

        this.memory.dontPullMe = isNearEdge || isStuckTooLong;
        // this.say(this.memory.lastPos.time)
        return this.$moveTo(target, ...e)
    };
}

// Creep.prototype.$move=Creep.prototype.move;
// Creep.prototype.move=function (...e) {
//     this.memory.dontPullMe = false;
//     return this.$move(...e)
// };

if(!Creep.prototype.$build) {
    Creep.prototype.$build = Creep.prototype.build;
    Creep.prototype.build = function (...e) {
        this.memory.dontPullMe = true;
        return this.$build(...e)
    };
}

if(!Creep.prototype.$repair) {
    Creep.prototype.$repair = Creep.prototype.repair;
    Creep.prototype.repair = function (...e) {
        this.memory.dontPullMe = true;
        return this.$repair(...e)
    };
}

if(!Creep.prototype.$upgradeController) {
    Creep.prototype.$upgradeController = Creep.prototype.upgradeController;
    Creep.prototype.upgradeController = function (...e) {
        this.memory.dontPullMe = true;
        return this.$upgradeController(...e)
    };
}

if(!Creep.prototype.$dismantle) {
    Creep.prototype.$dismantle = Creep.prototype.dismantle;
    Creep.prototype.dismantle = function (...e) {
        this.memory.dontPullMe = true;
        return this.$dismantle(...e)
    };
}

if(!Creep.prototype.$harvest) {
    Creep.prototype.$harvest = Creep.prototype.harvest;
    Creep.prototype.harvest = function (...e) {
        this.memory.dontPullMe = true;
        return this.$harvest(...e)
    };
}

if(!Creep.prototype.$attack){
    Creep.prototype.$attack=Creep.prototype.attack;
    Creep.prototype.attack=function (...e) {
        this.memory.dontPullMe = true;
        return this.$attack(...e)
    };
}

// Creep.prototype.$withdraw=Creep.prototype.withdraw;
// Creep.prototype.withdraw=function (...e) {
//     this.memory.dontPullMe = true;
//     return this.$withdraw(...e)
// };
