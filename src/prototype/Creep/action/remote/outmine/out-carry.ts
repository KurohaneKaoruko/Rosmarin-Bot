import { ROLES } from '@/constant/CreepConstant';
import { ExternalMineAnalysis, ExternalMineSourceStat } from '@/modules/features/external/externalMine';
import { RoadMemory } from '@/modules/features/external/externalRoad';
import { getAssignedEnergyTarget } from '@/modules/shared/energyLogistics';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

const routeExitCache: Record<string, { tick: number; exit: number | null }> = {};

// 外矿搬运统一只保留一个 cache 根，source / target 作为其中的分区使用。
const getOutCarryCache = (creep: Creep): Record<string, any> =>
    ensureMemoryCache(creep.memory) as Record<string, any>;

const getOutCarrySectionCache = (creep: Creep, key: 'source' | 'target'): Record<string, any> => {
    const cache = getOutCarryCache(creep);
    return (cache[key] && typeof cache[key] === 'object' ? cache[key] : (cache[key] = {})) as Record<string, any>;
};

const getOutCarrySourceCache = (creep: Creep): Record<string, any> =>
    getOutCarrySectionCache(creep, 'source');

const getOutCarryTargetCache = (creep: Creep): Record<string, any> =>
    getOutCarrySectionCache(creep, 'target');

// 策略 ID：集中声明，避免散落字符串
const OUT_CARRY_HALF_LOAD_RATIO = 0.5;

const OUT_CARRY_STRATEGIES = {
    COLLECT: 'collect',
    DELIVER: 'deliver'
} as const;

// collect/deliver 之间保留明显滞回，避免因为修一次路/掉 1 点能量就立刻回头。
// 接力保证交接后落在返程侧的那一方够半仓，正是为了让这里的滞回不会把方向判反。
const OUT_CARRY_RETURN_TO_COLLECT_RATIO = OUT_CARRY_HALF_LOAD_RATIO;

const isSameRoomPosition = (left: RoomPosition, right: RoomPosition): boolean => (
    left.x === right.x &&
    left.y === right.y &&
    left.roomName === right.roomName
);

/**
 * 判定单个规划道路格是否可通行（纯函数，供记忆化入口调用）。
 */
const computeWalkablePlannedRoadPos = (room: Room, pos: RoomPosition): boolean => {
    const terrain = room.getTerrain();
    if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;

    const structures = pos.lookFor(LOOK_STRUCTURES) as Structure[];
    for (const structure of structures) {
        if (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) continue;
        if (structure.structureType === STRUCTURE_RAMPART) {
            const rampart = structure as StructureRampart;
            if (rampart.my || rampart.isPublic) continue;
        }
        return false;
    }

    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for (const site of sites) {
        if (site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER || site.structureType === STRUCTURE_RAMPART) continue;
        return false;
    }

    return true;
};

let walkableRoadPosCacheTick = -1;
const walkableRoadPosCache = new Map<string, boolean>();

/**
 * 判定规划道路格是否可通行，按 tick 记忆化。
 *
 * @remarks
 * 同一 tick 内格子上有什么建筑/工地不会变，而中转中的 out-carry 每 tick 都要
 * 拿整条规划路线逐点判定，单次判定是两次 `lookFor`（各算一次房间查询）。
 * 不记忆化的话，「路线点数 × 同路线 creep 数」会把房间查询放大到每 tick 数千次。
 */
const isWalkablePlannedRoadPos = (room: Room, pos: RoomPosition): boolean => {
    if (pos.roomName !== room.name) return false;

    if (walkableRoadPosCacheTick !== Game.time) {
        walkableRoadPosCacheTick = Game.time;
        walkableRoadPosCache.clear();
    }

    const key = `${room.name}:${pos.x}:${pos.y}`;
    const cached = walkableRoadPosCache.get(key);
    if (cached !== undefined) return cached;

    const result = computeWalkablePlannedRoadPos(room, pos);
    walkableRoadPosCache.set(key, result);
    return result;
};

const clearAssignedSourceCache = (cache: Record<string, any> | undefined) => {
    if (!cache) return;
    delete cache.assignedSourceId;
    delete cache.assignedSourceKey;
};

const assignPreferredSourceCache = (cache: Record<string, any>, sourceStat: ExternalMineSourceStat | null) => {
    if (!sourceStat) {
        clearAssignedSourceCache(cache);
        return;
    }
    cache.assignedSourceId = sourceStat.sourceId;
    cache.assignedSourceKey = sourceStat.sourceKey;
};

const getPreferredCarrySource = (creep: Creep): ExternalMineSourceStat | null => {
    return ExternalMineAnalysis.pickBestCarrySource(creep);
};

// 跨房重平衡的最小间隔：换房本身要重走一趟路，换得太勤净亏在路程上。
type TransitRoomEntry = { pos: RoomPosition; progress: number };

// 按 tick 缓存的「路线 → 房间 → 可通行点序列」，只取决于
// (源房, 目标房, 房间名, 行进方向, 路线版本)，与 creep 自身位置无关，
// 所以同一条路线上的所有中转 creep 直接共享这一份。
let transitRoomIndexTick = -1;
const transitRoomIndexForward = new Map<string, TransitRoomEntry[][]>();
const transitRoomIndexBackward = new Map<string, TransitRoomEntry[][]>();

/**
 * 取「各条路线在当前房间内的可通行点序列」，数组顺序与 `RoadMemory.getAllPaths` 的迭代顺序一致。
 *
 * @remarks
 * 原实现每个中转 creep 每 tick 都要把**整条路线**（跨多个房、上百格）扫一遍，
 * 只为了筛出落在当前房的那几十格；筛完还要再 `filter` 一次可通行性，而每格判定
 * 都要拼一次 `` `${房名}:${x}:${y}` `` 字符串去查记忆化表。
 * 这些开销全都与 creep 位置无关，因此这里按 tick 只算一次、全路线 creep 共享。
 *
 * @param sourceRoom 源头房间名。
 * @param targetRoom 目标房间名。
 * @param room 当前 creep 所在的房间（即可通行判定的房间）。
 * @param towardTaskTarget 是否朝目标房方向行进（false 表示返程）。
 * @returns 每条路线一份 `TransitRoomEntry[]`；该路线在本房没有可通行点时给空数组。
 */
const getTransitRoomEntries = (
    sourceRoom: string,
    targetRoom: string,
    room: Room,
    towardTaskTarget: boolean
): TransitRoomEntry[][] => {
    const version = RoadMemory.getRouteVersion(sourceRoom);
    if (transitRoomIndexTick !== Game.time) {
        transitRoomIndexTick = Game.time;
        transitRoomIndexForward.clear();
        transitRoomIndexBackward.clear();
    }

    const cache = towardTaskTarget ? transitRoomIndexForward : transitRoomIndexBackward;
    const cacheKey = `${sourceRoom}:${targetRoom}:${room.name}:${version}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const perRoute: TransitRoomEntry[][] = [];

    for (const path of RoadMemory.getAllPaths(sourceRoom, targetRoom).values()) {
        if (!Array.isArray(path) || path.length === 0) {
            perRoute.push([]);
            continue;
        }

        // progress 的口径依赖「本房内共有多少点」，所以先数一遍长度、再填点。
        let inRoomCount = 0;
        for (let idx = 0; idx < path.length; idx++) {
            const pos = towardTaskTarget ? path[idx] : path[path.length - 1 - idx];
            if (pos.roomName === room.name) inRoomCount++;
        }
        if (inRoomCount === 0) {
            perRoute.push([]);
            continue;
        }

        const entries: TransitRoomEntry[] = [];
        for (let idx = 0; idx < path.length; idx++) {
            const pos = towardTaskTarget ? path[idx] : path[path.length - 1 - idx];
            if (pos.roomName !== room.name) continue;
            if (!isWalkablePlannedRoadPos(room, pos)) continue;
            entries.push({ pos, progress: inRoomCount - idx });
        }

        perRoute.push(entries);
    }

    cache.set(cacheKey, perRoute);
    return perRoute;
};

// 中转目标按 creep 短缓存：跨房途中没必要每 tick 重扫全部路线点
// （路线数 × 点数 × getRangeTo），沿途 3 tick 内最近点基本不变。
// 到点 / 换房 / 超时立即失效，不会引入绕路。
const TRANSIT_REPLAN_INTERVAL_TICKS = 3;
type TransitPlanCacheEntry = { tick: number; roomName: string; target: RoomPosition };
const transitPlanCache = new Map<string, TransitPlanCacheEntry>();

const getPlannedTransitRoadTarget = (creep: Creep, nextRoomName: string | undefined): RoomPosition | null => {
    const sourceRoom = creep.memory.sourceRoom;
    const taskTargetRoom = creep.memory.targetRoom;
    if (!nextRoomName || !sourceRoom || !taskTargetRoom || sourceRoom === taskTargetRoom) return null;

    const cachedPlan = transitPlanCache.get(creep.id);
    if (
        cachedPlan &&
        Game.time - cachedPlan.tick < TRANSIT_REPLAN_INTERVAL_TICKS &&
        cachedPlan.roomName === creep.room.name &&
        !isSameRoomPosition(creep.pos, cachedPlan.target)
    ) {
        return cachedPlan.target;
    }

    const allPaths = RoadMemory.getAllPaths(sourceRoom, taskTargetRoom);
    if (!(allPaths instanceof Map) || allPaths.size === 0) return null;

    const towardTaskTarget = nextRoomName === taskTargetRoom;
    const perRoute = getTransitRoomEntries(sourceRoom, taskTargetRoom, creep.room, towardTaskTarget);

    let best: { pos: RoomPosition; range: number; progress: number } | null = null;

    for (const entries of perRoute) {
        if (entries.length === 0) continue;

        let nearestIndex = -1;
        let nearestRange = Infinity;
        for (let i = 0; i < entries.length; i++) {
            const range = creep.pos.getRangeTo(entries[i].pos);
            if (range < nearestRange || (range === nearestRange && i > nearestIndex)) {
                nearestRange = range;
                nearestIndex = i;
            }
        }
        if (nearestIndex < 0) continue;

        // 已经踩在最近点上就再往前一格，避免原地打转。
        let candidateIndex = nearestIndex;
        if (isSameRoomPosition(creep.pos, entries[nearestIndex].pos) && nearestIndex + 1 < entries.length) {
            candidateIndex = nearestIndex + 1;
        }

        const candidate = entries[candidateIndex];
        if (
            !best ||
            nearestRange < best.range ||
            (nearestRange === best.range && candidate.progress < best.progress)
        ) {
            best = { pos: candidate.pos, range: nearestRange, progress: candidate.progress };
        }
    }

    const plannedTarget = best?.pos || null;
    if (plannedTarget) {
        transitPlanCache.set(creep.id, { tick: Game.time, roomName: creep.room.name, target: plannedTarget });
    } else {
        transitPlanCache.delete(creep.id);
    }
    // 死亡 creep 的残留条目定期清一把，Map 不会无限长大。
    if (transitPlanCache.size > 500) {
        for (const [id, entry] of transitPlanCache) {
            if (Game.time - entry.tick >= TRANSIT_REPLAN_INTERVAL_TICKS) transitPlanCache.delete(id);
        }
    }
    return plannedTarget;
};


type OutCarryMode = typeof OUT_CARRY_STRATEGIES[keyof typeof OUT_CARRY_STRATEGIES];

type OutCarryAction = {
    run: (creep: Creep) => void;
    resolveCarryDepositTarget: (creep: Creep) => StructureTerminal | StructureStorage | null;
    isLikelyCollecting: (creep: Creep) => boolean;
    getRouteExitDirection: (creep: Creep, targetRoom: string | undefined) => number | null;
    moveAlongRouteExit: (creep: Creep, targetRoom: string | undefined) => boolean;
    carry: (creep: Creep) => void;
};

const moveOutCarryTo = (
    creep: Creep,
    target: RoomPosition | { pos: RoomPosition },
    opts?: MoveToOpts,
) => creep.moveTo(target, opts);

const moveOutCarryToRoom = (
    creep: Creep,
    roomName: string,
    opts?: Record<string, any>,
) => creep.moveToRoom(roomName, opts);

const outCarry: OutCarryAction = {
    resolveCarryDepositTarget: function (creep: Creep): StructureTerminal | StructureStorage | null {
        let target: StructureTerminal | StructureStorage | null = null;

        if (creep.room.terminal && creep.room.terminal.store[RESOURCE_ENERGY] < 10000) {
            target = creep.room.terminal;
        }

        if (!target) {
            const targets: (StructureTerminal | StructureStorage)[] = [];
            if (creep.room.terminal && creep.room.terminal.store.getFreeCapacity() > 50000) {
                targets.push(creep.room.terminal);
            }
            if (creep.room.storage && creep.room.storage.store.getFreeCapacity() > 10000) {
                targets.push(creep.room.storage);
            }
            target = creep.pos.findClosestByRange(targets);
        }

        return target;
    },

    isLikelyCollecting: function (creep: Creep): boolean {
        if (!creep || creep.spawning) return false;
        if (creep.store.getFreeCapacity() <= 0) return false;

        const cachedMode = getOutCarryCache(creep).outCarryMode as OutCarryMode | undefined;
        if (cachedMode === OUT_CARRY_STRATEGIES.DELIVER) {
            const used = creep.store.getUsedCapacity();
            const cap = Math.max(1, creep.store.getCapacity());
            return used < Math.ceil(cap * OUT_CARRY_RETURN_TO_COLLECT_RATIO);
        }

        const targetRoom = creep.memory.targetRoom;
        if (targetRoom && creep.room.name === targetRoom) return true;

        const used = creep.store.getUsedCapacity();
        const cap = creep.store.getCapacity();
        if (used > 0 && used >= Math.floor(cap * 0.4)) return false;

        return true;
    },

    getRouteExitDirection: function (creep: Creep, targetRoom: string | undefined): number | null {
        if (!targetRoom || creep.room.name === targetRoom) return null;

        const cacheKey = `${creep.room.name}->${targetRoom}`;
        const cached = routeExitCache[cacheKey];
        if (cached && cached.tick === Game.time) return cached.exit;

        let exit: number | null = null;
        const route = Game.map.findRoute(creep.room.name, targetRoom);
        if (Array.isArray(route) && route.length > 0) {
            exit = route[0].exit;
        }

        routeExitCache[cacheKey] = { tick: Game.time, exit };
        return exit;
    },

    moveAlongRouteExit: function (creep: Creep, targetRoom: string | undefined): boolean {
        if (!targetRoom) return false;
        if (creep.room.name === targetRoom) return false;
        if (creep.pos.isRoomEdge()) return false;

        const plannedRoadTarget = getPlannedTransitRoadTarget(creep, targetRoom);
        if (plannedRoadTarget && !isSameRoomPosition(creep.pos, plannedRoadTarget)) {
            moveOutCarryTo(creep, plannedRoadTarget, {
                maxRooms: 1,
                range: 0,
                ignoreCreeps: false,
                plainCost: 2,
                swampCost: 10,
                reusePath: 3
            });
            return true;
        }

        const exitDirection = this.getRouteExitDirection(creep, targetRoom);
        if (!exitDirection) return false;

        const exits = creep.room.find(exitDirection) as RoomPosition[];
        if (!exits || exits.length <= 0) return false;
        const exitPos = creep.pos.findClosestByRange(exits);
        if (!exitPos) return false;

        moveOutCarryTo(creep, exitPos, {
            maxRooms: 1,
            range: 0,
            ignoreCreeps: false,
            plainCost: 2,
            swampCost: 10,
            reusePath: 3
        });
        return true;
    },

    carry: function (creep: Creep) {
        const cache = getOutCarryTargetCache(creep);
        const sourceRoom = creep.memory.sourceRoom;
        if (!sourceRoom) return;

        if (creep.room.name != sourceRoom || creep.pos.isRoomEdge()) {
            if (creep.room.name != sourceRoom && !creep.pos.isRoomEdge()) {
                // 返程途中允许接头：先走一步登记意图，接不上就照常移动
                if (this.moveAlongRouteExit(creep, sourceRoom)) return;
            }
            moveOutCarryToRoom(creep, sourceRoom, { plainCost: 2, swampCost: 10 });
            return;
        }

        let target: StructureTerminal | StructureStorage | null = null;
        if (cache.targetId) {
            target = Game.getObjectById(cache.targetId as Id<StructureTerminal | StructureStorage>);
            if (target) {
                if (creep.pos.inRangeTo(target, 1)) {
                    if (target.store.getFreeCapacity(RESOURCE_ENERGY) > 200) {
                        creep.transfer(target, Object.keys(creep.store)[0] as ResourceConstant);
                    } else {
                        delete cache.targetId;
                    }
                } else {
                    moveOutCarryTo(creep, target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
                }
                return;
            }
            delete cache.targetId;
        }

        if (!target) target = this.resolveCarryDepositTarget(creep);
        if (target) {
            cache.targetId = target.id;
            if (creep.pos.inRangeTo(target, 1)) {
                if (target.store.getFreeCapacity() > 0) {
                    creep.transfer(target, Object.keys(creep.store)[0] as ResourceConstant);
                } else {
                    delete cache.targetId;
                }
            } else {
                moveOutCarryTo(creep, target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
            }
            return;
        }

        // 无仓期（terminal/storage 缺席）直进消耗链：控制器容器（喂静态升级工）→
        // extension/spawn（喂孵化）→ 家容器缓冲。原逻辑直接走到「控制器旁 drop」，
        // 能量落地被 decay 成吨蒸发（race 实测单点堆 2.3 万）。
        if (!creep.room.terminal && !creep.room.storage) {
            const deliverTo = (target: AnyStoreStructure): boolean => {
                if (creep.pos.inRangeTo(target, 1)) {
                    if (target.store.getFreeCapacity(RESOURCE_ENERGY) <= 100) {
                        delete cache.targetId;
                        return false;
                    }
                    if (creep.store.getUsedCapacity() > 0) {
                        creep.transfer(target, RESOURCE_ENERGY);
                    }
                    if (creep.store.getUsedCapacity() === 0) delete cache.targetId;
                    return true;
                }
                cache.targetId = target.id;
                moveOutCarryTo(creep, target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
                return true;
            };

            // 回程顺路灌注（参考实现 hauler 的途经填充模式）：身边 ext/spawn/tower 一并补满——
            // extension 水位随搬运节拍回满，孵化线不再等能量（OH 满档单及时出货的关键）
            if (fillAdjacentSpawnStructures(creep)) {
                if ((creep.store[RESOURCE_ENERGY] || 0) <= 0) return;
            }

            // ⓪ 能量中枢认领：集中分配的投递目标（cc/ext/spawn 优先级 1-2、断供升级工手填 5）
            const assigned = getAssignedEnergyTarget(creep) as AnyStoreStructure | null;
            if (assigned && deliverTo(assigned)) return;

            // ① 控制器容器：静态升级工的取能点，直供零搬运
            const controllerContainer = (creep.room.container || []).find(c =>
                creep.room.controller && c.pos.inRangeTo(creep.room.controller.pos, 3) &&
                c.store.getFreeCapacity(RESOURCE_ENERGY) > 100);
            if (controllerContainer && deliverTo(controllerContainer)) return;

            // ② extension / spawn：孵化线
            const freeSpawnExt = [...(creep.room.extension || []), ...(creep.room.spawn || [])]
                .filter(e => e.store.getFreeCapacity(RESOURCE_ENERGY) > 100);
            const extTarget = creep.pos.findClosestByRange(freeSpawnExt);
            if (extTarget && deliverTo(extTarget)) return;

            // ③ 家容器缓冲（家里 carrier 之后接力分发）
            const homeContainer = (creep.room.container || []).find(c =>
                c.store.getFreeCapacity(RESOURCE_ENERGY) > 100);
            if (homeContainer && deliverTo(homeContainer)) return;
        }

        const storage = creep.room.storage;
        const controller = creep.room.controller;
        if (storage) {
            if (creep.pos.inRangeTo(storage, 1)) creep.drop(Object.keys(creep.store)[0] as ResourceConstant);
            else moveOutCarryTo(creep, storage, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
            return;
        }

        if (controller && controller.level < 8) {
            if (creep.pos.inRangeTo(controller, 1)) creep.drop(Object.keys(creep.store)[0] as ResourceConstant);
            else moveOutCarryTo(creep, controller, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
            return;
        }

        const centerPos = creep.room.getCenter();
        if (centerPos && creep.pos.inRangeTo(centerPos, 1)) {
            creep.drop(Object.keys(creep.store)[0] as ResourceConstant);
        } else if (centerPos) {
            moveOutCarryTo(creep, centerPos, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
        }
    },

    // 统一入口：满载往返 collect / deliver + 相向接力，修路与建造交给 out-build
    run: function (creep: Creep) {
        (creep.memory as any).lastRunTick = Game.time;
        delete creep.memory.working;

        runWithRelay(creep);
    },
};

// 回程顺路灌注（参考实现 hauler 的途经填充模式）：把身边（range 1）的 ext/spawn/tower 顺手补满。
// 每次 transfer 只倒一格容量，不阻塞本 tick 的投递主流程。
const fillAdjacentSpawnStructures = (creep: Creep): boolean => {
    if (!creep.room.controller?.my) return false;
    if ((creep.store[RESOURCE_ENERGY] || 0) <= 0) return false;
    const area = creep.room.lookForAtArea(
        LOOK_STRUCTURES,
        Math.max(0, creep.pos.y - 1),
        Math.max(0, creep.pos.x - 1),
        Math.min(49, creep.pos.y + 1),
        Math.min(49, creep.pos.x + 1),
        true,
    );
    for (const item of area) {
        const structure = item.structure as AnyStoreStructure;
        if (!structure || !structure.store) continue;
        if (structure.structureType !== STRUCTURE_EXTENSION &&
            structure.structureType !== STRUCTURE_SPAWN &&
            structure.structureType !== STRUCTURE_TOWER) continue;
        if ((structure.store.getFreeCapacity(RESOURCE_ENERGY) || 0) <= 0) continue;
        return creep.transfer(structure, RESOURCE_ENERGY) === OK;
    }
    return false;
};

// 模式判定（对齐参考实现 supplying 语义）：空仓取货、有货回家，二值无滞回
const resolveOutCarryMode = (creep: Creep): OutCarryMode =>
    creep.store.getUsedCapacity() > 0 ? OUT_CARRY_STRATEGIES.DELIVER : OUT_CARRY_STRATEGIES.COLLECT;

// 取货（对齐参考实现 runHauler 取货段）：到矿点先捡大堆掉落，然后只做
// 「容器装得满我才取」——装不满原地等矿工灌装，绝不半载返程空跑
const runCollectMode = (creep: Creep) => {
    creep.memory.dontPullMe = false;
    if (creep.room.name !== creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        if (outCarry.moveAlongRouteExit(creep, creep.memory.targetRoom)) return;
        moveOutCarryToRoom(creep, creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
        return;
    }

    const stat = getPreferredCarrySource(creep);
    const sourcePos = stat?.sourcePos ?? creep.room.find(FIND_SOURCES)[0]?.pos ?? null;

    const drops = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount > 50
            && (!sourcePos || r.pos.inRangeTo(sourcePos, 3)),
    });
    if (drops.length > 0) {
        const biggest = drops.reduce((a, b) => (b.amount > a.amount ? b : a));
        if (creep.pos.inRangeTo(biggest, 1)) creep.pickup(biggest);
        else moveOutCarryTo(creep, biggest.pos, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
        return;
    }

    const container = stat?.container ?? null;
    if (!container) {
        if (sourcePos && !creep.pos.inRangeTo(sourcePos, 2)) {
            moveOutCarryTo(creep, sourcePos, { maxRooms: 1, range: 2, plainCost: 2, swampCost: 10 });
        }
        return;
    }
    if (!creep.pos.inRangeTo(container.pos, 1)) {
        moveOutCarryTo(creep, container.pos, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
        return;
    }
    if ((container.store[RESOURCE_ENERGY] || 0) >= creep.store.getFreeCapacity()) {
        creep.withdraw(container, RESOURCE_ENERGY);
    }
};

const runModeCycle = (creep: Creep): void => {
    const cache = getOutCarryCache(creep);
    const mode = resolveOutCarryMode(creep);
    if (mode !== cache.outCarryMode) {
        delete getOutCarryTargetCache(creep).targetId;
        cache.outCarryMode = mode;
    }
    if (mode === OUT_CARRY_STRATEGIES.COLLECT) {
        runCollectMode(creep);
        return;
    }
    outCarry.carry(creep);
    creep.memory.dontPullMe = false;
};

// 接力交接（对齐参考实现 getRelayTarget 逐语义移植）：
// 相向对穿（BetterMove.isSwapIntent）+ 一空一满 + 等容量的两只搬运工，
// 满载方整仓转给空载方后互换 Memory.creeps 身份——
// 货物单 tick 前进两格，没有任何身体掉头；relayedTick 防同 tick 连环接力。
const tryRelayHandoff = (creep: Creep): Creep | null => {
    const memAny = creep.memory as any;
    if (memAny.relayedTick === Game.time) return null;
    const betterMove = (global as any).BetterMove;
    if (!betterMove?.isSwapIntent) return null;
    const supplying = creep.store.getUsedCapacity() > 0;
    const candidates = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (c: Creep) =>
            c.id !== creep.id &&
            c.memory.role === ROLES['out-carry'] &&
            (c.memory as any).relayedTick !== Game.time,
    }) as Creep[];
    for (const other of candidates) {
        const otherSupplying = other.store.getUsedCapacity() > 0;
        if (supplying === otherSupplying) continue;
        if (!betterMove.isSwapIntent(creep, other)) continue;
        if (creep.store.getCapacity() !== other.store.getCapacity()) continue;
        const supplier = supplying ? creep : other;
        if ((supplier.ticksToLive ?? 1500) <= 50) continue;
        if (supplier.transfer(other, RESOURCE_ENERGY) !== OK) continue;
        const memA = Memory.creeps[creep.name] as any;
        const memB = Memory.creeps[other.name] as any;
        Memory.creeps[creep.name] = memB;
        Memory.creeps[other.name] = memA;
        memAny.relayedTick = Game.time;
        (other.memory as any).relayedTick = Game.time;
        return other;
    }
    return null;
};

// 接力后同 tick 双侧重跑（参考实现 reissue 语义）：
// 交接换身后，双方以新身份重登记本 tick 意图；relayedTick 保证不连环
const runWithRelay = (creep: Creep): void => {
    runModeCycle(creep);
    const partner = tryRelayHandoff(creep);
    if (!partner) return;
    runModeCycle(creep);
    runModeCycle(partner);
};

export default outCarry;
