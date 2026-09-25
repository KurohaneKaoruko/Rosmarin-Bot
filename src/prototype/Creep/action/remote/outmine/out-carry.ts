import { ExternalMineAnalysis, ExternalMineSourceStat } from '@/modules/features/external/externalMine';
import { RoadMemory } from '@/modules/features/external/externalRoad';
import { OUT_CARRY_HALF_LOAD_RATIO, readRelayDirection, tryOutCarryRelayHandoff } from '@/prototype/Creep/function/relayHandoff';
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
const OUT_CARRY_STRATEGIES = {
    COLLECT: 'collect',
    DELIVER: 'deliver'
} as const;

// collect/deliver 之间保留明显滞回，避免因为修一次路/掉 1 点能量就立刻回头。
// 这条线必须与接力（relayHandoff）的交接判定共用同一个值：
// 接力保证交接后落在返程侧的那一方够半仓，正是为了让这里的滞回不会把方向判反。
const OUT_CARRY_RETURN_TO_COLLECT_RATIO = OUT_CARRY_HALF_LOAD_RATIO;

const shouldUseOutCarryRelay = (creep: Creep): boolean => {
    if ((Memory as any).tightCpu) return false;

    const sourceRoomName = creep.memory.sourceRoom;
    if (!sourceRoomName) return true;

    const sourceRoom = Game.rooms[sourceRoomName];
    if (!sourceRoom?.controller?.my) return true;

    const effectiveLevel = sourceRoom.getEffectiveRoomLevel?.() ?? sourceRoom.controller.level;
    return effectiveLevel < 7;
};
const OUT_CARRY_DYING_TTL = 80;

/**
 * 判断外矿搬运 creep 是否已经进入濒死返程阶段。
 *
 * @param creep 待判断的外矿搬运 creep。
 * @returns `true` 表示应停止继续取货，优先把现有资源送回母房。
 */
const isOutCarryDying = (creep: Creep) => {
    return typeof creep.ticksToLive === 'number' && creep.ticksToLive <= OUT_CARRY_DYING_TTL;
};

/**
 * 统计指定掉落锚点附近一团掉落资源的有效总量。
 *
 * @param dropped 房间内所有待评估掉落资源。
 * @param anchor 当前正在评分的锚点掉落。
 * @param reservedByTarget 其他搬运 creep 已经预留的目标量。
 * @param clusterRange 掉落团聚合半径，默认按 1 格邻接计算。
 * @returns 扣除预留量后的有效剩余总量。
 */
const getDroppedClusterRemaining = (
    dropped: Resource[],
    anchor: Resource,
    reservedByTarget: Record<string, number>,
    clusterRange = 1
) => {
    let total = 0;
    for (const resource of dropped) {
        if (resource.resourceType !== anchor.resourceType) continue;
        if (!anchor.pos.inRangeTo(resource.pos, clusterRange)) continue;
        total += Math.max(0, resource.amount - (reservedByTarget[resource.id] || 0));
    }
    return total;
};

const isSameRoomPosition = (left: RoomPosition, right: RoomPosition): boolean => (
    left.x === right.x &&
    left.y === right.y &&
    left.roomName === right.roomName
);

const isWalkablePlannedRoadPos = (room: Room, pos: RoomPosition): boolean => {
    if (pos.roomName !== room.name) return false;
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

const isInPreferredSourceScope = (sourceStat: ExternalMineSourceStat | null, pos: RoomPosition): boolean => {
    if (!sourceStat) return false;
    if (pos.roomName !== sourceStat.sourcePos.roomName) return false;
    return sourceStat.sourcePos.inRangeTo(pos, sourceStat.collectionRange);
};

const getPreferredCarrySource = (creep: Creep): ExternalMineSourceStat | null => {
    return ExternalMineAnalysis.pickBestCarrySource(creep);
};

const getPlannedTransitRoadTarget = (creep: Creep, nextRoomName: string | undefined): RoomPosition | null => {
    const sourceRoom = creep.memory.sourceRoom;
    const taskTargetRoom = creep.memory.targetRoom;
    if (!nextRoomName || !sourceRoom || !taskTargetRoom || sourceRoom === taskTargetRoom) return null;

    const allPaths = RoadMemory.getAllPaths(sourceRoom, taskTargetRoom);
    if (!(allPaths instanceof Map) || allPaths.size === 0) return null;

    const towardTaskTarget = nextRoomName === taskTargetRoom;
    let best: { pos: RoomPosition; range: number; progress: number } | null = null;

    for (const path of allPaths.values()) {
        if (!Array.isArray(path) || path.length === 0) continue;

        const travelPath = towardTaskTarget ? path : [...path].reverse();
        const roomPath = travelPath
            .map((pos, idx) => ({ pos, idx }))
            .filter((entry) => entry.pos.roomName === creep.room.name);
        if (roomPath.length === 0) continue;

        const walkableRoomPath = roomPath.filter((entry) => isWalkablePlannedRoadPos(creep.room, entry.pos));
        if (walkableRoomPath.length === 0) continue;

        let nearestIndex = -1;
        let nearestRange = Infinity;
        for (let i = 0; i < walkableRoomPath.length; i++) {
            const range = creep.pos.getRangeTo(walkableRoomPath[i].pos);
            if (range < nearestRange || (range === nearestRange && i > nearestIndex)) {
                nearestRange = range;
                nearestIndex = i;
            }
        }
        if (nearestIndex < 0) continue;

        let candidateIndex = nearestIndex;
        if (isSameRoomPosition(creep.pos, walkableRoomPath[nearestIndex].pos) && nearestIndex + 1 < walkableRoomPath.length) {
            candidateIndex = nearestIndex + 1;
        }

        const candidate = walkableRoomPath[candidateIndex];
        const progress = roomPath.length - candidate.idx;
        if (
            !best ||
            nearestRange < best.range ||
            (nearestRange === best.range && progress < best.progress)
        ) {
            best = { pos: candidate.pos, range: nearestRange, progress };
        }
    }

    return best?.pos || null;
};


type OutCarryMode = typeof OUT_CARRY_STRATEGIES[keyof typeof OUT_CARRY_STRATEGIES];

type OutCarryAction = {
    run: (creep: Creep) => void;
    resolveCarryDepositTarget: (creep: Creep) => StructureTerminal | StructureStorage | null;
    isLikelyCollecting: (creep: Creep) => boolean;
    getRouteExitDirection: (creep: Creep, targetRoom: string | undefined) => number | null;
    moveAlongRouteExit: (creep: Creep, targetRoom: string | undefined, collectRelay?: boolean) => boolean;
    estimateIncomingPerTick: (container: StructureContainer) => number;
    calcWaitTicksNearHarvester: (creep: Creep, container: StructureContainer) => number;
    findBestWithdrawTarget: (creep: Creep) => { id: string; type: 'dropped' | 'container' | 'tombstone' | 'ruin' } | null;
    withdraw: (creep: Creep) => void;
    carry: (creep: Creep) => void;
};

/**
 * 移动到目标；允许接力时，**先移动（登记本 tick 意图）、再尝试接头**。
 *
 * @remarks
 * 顺序不能反：接头判据是「双方本 tick 都已登记移动意图、且互为对方的目标格」
 * （见 relayHandoff），所以自己必须先走一步、登记过意图，才有资格接头。
 * 命中接力时，刚登记的这一笔意图会被立刻作废并换成新方向的意图。
 *
 * @param allowRelay 是否在移动后尝试外矿搬运接力。
 */
const moveOutCarryTo = (
    creep: Creep,
    target: RoomPosition | { pos: RoomPosition },
    opts?: MoveToOpts,
    allowRelay = false
) => {
    const result = creep.moveTo(target, opts);
    if (allowRelay && shouldUseOutCarryRelay(creep) && tryOutCarryRelayHandoff(creep)) {
        return OK;
    }
    return result;
};

const moveOutCarryToRoom = (
    creep: Creep,
    roomName: string,
    opts?: Record<string, any>
) => {
    return creep.moveToRoom(roomName, opts);
};

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

    moveAlongRouteExit: function (creep: Creep, targetRoom: string | undefined, collectRelay = false): boolean {
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
            }, collectRelay);
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
        }, collectRelay);
        return true;
    },

    estimateIncomingPerTick: function (container: StructureContainer): number {
        const feeders = container.pos.lookFor(LOOK_CREEPS).filter((c: Creep) =>
            c.my &&
            (c.memory.role === 'out-harvest' || c.memory.role === 'out-mineral')
        );
        if (feeders.length === 0) return 0;

        let incoming = 0;
        for (const feeder of feeders) {
            const work = Math.max(0, feeder.getActiveBodyparts(WORK));
            if (work === 0) continue;
            if (feeder.memory.role === 'out-harvest') incoming += work * HARVEST_POWER;
            else incoming += work * HARVEST_MINERAL_POWER;
        }
        return incoming;
    },

    calcWaitTicksNearHarvester: function (creep: Creep, container: StructureContainer): number {
        const incoming = this.estimateIncomingPerTick(container);
        if (incoming <= 0) return 0;

        const free = creep.store.getFreeCapacity();
        const current = container.store.getUsedCapacity();
        if (free <= 0 || current >= free) return 0;

        const need = free - current;
        let sleepTicks = Math.ceil(need / incoming);
        sleepTicks = Math.min(sleepTicks, 25);
        sleepTicks = Math.min(sleepTicks, Math.max(0, creep.ticksToLive - 50));
        if (sleepTicks <= 2) return 0;
        return sleepTicks;
    },

    findBestWithdrawTarget: function (creep: Creep): { id: string; type: 'dropped' | 'container' | 'tombstone' | 'ruin' } | null {
        const room = creep.room;
        const sourceRoomName = creep.memory.sourceRoom;
        const sourceRoom = sourceRoomName ? Game.rooms[sourceRoomName] : undefined;
        const canStoreMinerals = !!(sourceRoom?.storage || sourceRoom?.terminal);
        const cache = getOutCarrySourceCache(creep);

        const dangerousHostiles = room.find(FIND_HOSTILE_CREEPS, {
            filter: (c: Creep) =>
                !c.isWhiteList() &&
                (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0)
        });
        const isDangerousPos = (pos: RoomPosition) =>
            dangerousHostiles.some((h: Creep) => h.pos.inRangeTo(pos, 5));

        const reservedByTarget: Record<string, number> = {};
        for (const name in Game.creeps) {
            const other = Game.creeps[name];
            if (!other || other.id === creep.id || other.spawning) continue;
            if (other.memory.role !== 'out-carry' && other.memory.role !== 'out-car') continue;
            if (other.memory.sourceRoom !== sourceRoomName) continue;
            if (other.memory.targetRoom !== creep.memory.targetRoom) continue;
            if (!this.isLikelyCollecting(other)) continue;
            const targetId = (ensureMemoryCache(other.memory).source as Record<string, any> | undefined)?.targetId;
            if (!targetId) continue;
            reservedByTarget[targetId] = (reservedByTarget[targetId] || 0) + other.store.getFreeCapacity();
        }

        let bestScore = -Infinity;
        let best: { id: string; type: 'dropped' | 'container' | 'tombstone' | 'ruin' } | null = null;
        const carryNeed = Math.max(1, creep.store.getFreeCapacity());
        const preferredSource = getPreferredCarrySource(creep);

        const consider = (id: string, type: 'dropped' | 'container' | 'tombstone' | 'ruin', pos: RoomPosition, amount: number, nonEnergyBonus = 0) => {
            if (!id || amount <= 0) return;
            if (isDangerousPos(pos)) return;

            const reserved = reservedByTarget[id] || 0;
            const remaining = amount - reserved;
            if (remaining <= 0) return;

            const range = creep.pos.getRangeTo(pos);
            const usefulAmount = Math.min(remaining, carryNeed);
            const overflowBonus = Math.min(carryNeed, Math.max(0, remaining - carryNeed)) * 0.1;
            let score = usefulAmount + overflowBonus + nonEnergyBonus;
            score -= range * range * 0.5;

            if (score > bestScore) {
                bestScore = score;
                best = { id, type };
            }
        };

        const droppedThreshold = Math.min(500, Math.max(1, creep.store.getFreeCapacity()));
        const dropped = room.find(FIND_DROPPED_RESOURCES, {
            filter: (r: Resource) => r.amount > 0
        });
        const containers = (room.container || []).filter((c: StructureContainer) => c.store.getUsedCapacity() >= 300);
        const tombstones = room.find(FIND_TOMBSTONES, {
            filter: (t: Tombstone) => t.store.getUsedCapacity() > 0
        });
        const ruins = room.find(FIND_RUINS, {
            filter: (r: Ruin) => r.store.getUsedCapacity() > 0
        });

        const scoreDroppedTargets = (resources: Resource[]) => {
            for (const resource of resources) {
                if (!canStoreMinerals && resource.resourceType !== RESOURCE_ENERGY) continue;
                const remaining = Math.max(0, resource.amount - (reservedByTarget[resource.id] || 0));
                if (remaining <= 0) continue;

                let effectiveAmount = remaining;
                if (resource.resourceType === RESOURCE_ENERGY) {
                    const clusterRemaining = getDroppedClusterRemaining(resources, resource, reservedByTarget);
                    if (remaining < droppedThreshold && clusterRemaining < droppedThreshold) continue;
                    effectiveAmount = Math.max(remaining, Math.min(clusterRemaining, creep.store.getFreeCapacity()));
                } else if (remaining < droppedThreshold) {
                    continue;
                }
                const bonus = resource.resourceType === RESOURCE_ENERGY ? 0 : resource.amount * 3;
                consider(resource.id, 'dropped', resource.pos, effectiveAmount, bonus);
            }
        };

        const scoreContainerTargets = (items: StructureContainer[]) => {
            for (const container of items) {
                const energyAmount = container.store[RESOURCE_ENERGY] || 0;
                const totalAmount = container.store.getUsedCapacity();
                const amount = canStoreMinerals ? totalAmount : energyAmount;
                const incoming = this.estimateIncomingPerTick(container);
                const bonus = incoming > 0 ? Math.min(creep.store.getFreeCapacity(), incoming * 5) : 0;
                consider(container.id, 'container', container.pos, amount, bonus);
            }
        };

        const scoreTombstoneTargets = (items: Tombstone[]) => {
            for (const tombstone of items) {
                const energyAmount = tombstone.store[RESOURCE_ENERGY] || 0;
                const totalAmount = tombstone.store.getUsedCapacity();
                const amount = canStoreMinerals ? totalAmount : energyAmount;
                const mixedBonus = canStoreMinerals && totalAmount > energyAmount ? 200 : 0;
                consider(tombstone.id, 'tombstone', tombstone.pos, amount, mixedBonus);
            }
        };

        const scoreRuinTargets = (items: Ruin[]) => {
            for (const ruin of items) {
                const energyAmount = ruin.store[RESOURCE_ENERGY] || 0;
                const totalAmount = ruin.store.getUsedCapacity();
                const amount = canStoreMinerals ? totalAmount : energyAmount;
                const mixedBonus = canStoreMinerals && totalAmount > energyAmount ? 120 : 0;
                consider(ruin.id, 'ruin', ruin.pos, amount, mixedBonus);
            }
        };

        if (preferredSource) {
            scoreDroppedTargets(dropped.filter((resource) => isInPreferredSourceScope(preferredSource, resource.pos)));
            scoreContainerTargets(containers.filter((container) => isInPreferredSourceScope(preferredSource, container.pos)));
            scoreTombstoneTargets(tombstones.filter((tombstone) => isInPreferredSourceScope(preferredSource, tombstone.pos)));
            scoreRuinTargets(ruins.filter((ruin) => isInPreferredSourceScope(preferredSource, ruin.pos)));
            if (best) {
                assignPreferredSourceCache(cache, preferredSource);
                return best;
            }
        }

        // 掉落资源不能只看单堆大小：
        // 外矿常见情况是一圈小堆叠在采集位附近，单堆不够大，但总量足以装满一个搬运 creep。
        // 因此这里按“当前剩余容量”和“邻近掉落簇总量”共同判断是否值得接单。
        scoreDroppedTargets(dropped);
        scoreContainerTargets(containers);
        scoreTombstoneTargets(tombstones);
        scoreRuinTargets(ruins);

        if (best) {
            assignPreferredSourceCache(cache, preferredSource);
            return best;
        }

        clearAssignedSourceCache(cache);
        return best;
    },

    /**
     * 执行 collect 态的取货流程。
     *
     * @remarks
     * 先尝试已经评分完成的最佳目标；没有命中时，再按掉落、坟墓、container、
     * storage 等回退顺序取货。坟墓回退优先级被提高，用来兜住“明明有坟墓能量却不取”的场景。
     *
     * @param creep 当前处于 collect 态的外矿搬运 creep。
     */
    withdraw: function (creep: Creep) {
        const cache = getOutCarrySourceCache(creep);
        const sourceRoom = creep.memory.sourceRoom;

        if (cache.waitUntil && Game.time < cache.waitUntil) {
            const nearbyDrop = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
                filter: (r: Resource) => r.amount > 0
            })[0];
            if (nearbyDrop) {
                creep.pickup(nearbyDrop);
                return;
            }
            // 拥挤疏散：容器口附近同路线同伴过多时向空旷处让位，
            // 防止等填装的搬运工把唯一通道和 out-harvest 的工作位全部堵死。
            const crowd = creep.pos.findInRange(FIND_MY_CREEPS, 2, {
                filter: (c: Creep) => c.id !== creep.id && c.memory.role === creep.memory.role
            }).length;
            if (crowd >= 3) {
                creep.moveTo(new RoomPosition(25, 25, creep.room.name), { range: 15, plainCost: 2, swampCost: 10 });
            }
            return;
        }
        delete cache.waitUntil;

        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            if (this.moveAlongRouteExit(creep, creep.memory.targetRoom, true)) return;
            moveOutCarryToRoom(creep, creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
            return;
        }

        if (cache.targetId) {
            const target = Game.getObjectById(cache.targetId) as any;
            if (!target) {
                delete cache.targetId;
                delete cache.targetType;
                return;
            }

            if (!creep.pos.inRangeTo(target, 1)) {
                moveOutCarryTo(creep, target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 }, true);
                return;
            }

            const targetType = cache.targetType;
            if (targetType === 'dropped') {
                creep.pickup(target);
            } else if (targetType === 'container' || targetType === 'ruin' || targetType === 'tombstone') {
                if (targetType === 'container' && target.store.getUsedCapacity() < creep.store.getFreeCapacity()) {
                    const waitTicks = this.calcWaitTicksNearHarvester(creep, target as StructureContainer);
                    if (waitTicks > 0) {
                        cache.waitUntil = Game.time + waitTicks;
                        return;
                    }
                }

                const nonEnergyResource = Object.keys(target.store).find((res) => res !== RESOURCE_ENERGY && target.store[res] > 0) as ResourceConstant;
                const energyAmount = target.store[RESOURCE_ENERGY] || 0;
                const canStoreMinerals = !!(sourceRoom && (Game.rooms[sourceRoom]?.storage || Game.rooms[sourceRoom]?.terminal));
                const resourceType = (canStoreMinerals && nonEnergyResource)
                    ? nonEnergyResource
                    : (energyAmount > 0 ? RESOURCE_ENERGY : (Object.keys(target.store)[0] as ResourceConstant));
                creep.withdraw(target, resourceType);
            }

            if ((targetType === 'dropped' && target.amount === 0) ||
                ((targetType === 'container' || targetType === 'ruin' || targetType === 'tombstone') && target.store.getUsedCapacity() === 0)) {
                delete cache.targetId;
                delete cache.targetType;
                return;
            }

            if (creep.store.getFreeCapacity() === 0) {
                delete cache.targetId;
                delete cache.targetType;
            }
            return;
        }

        const bestTarget = this.findBestWithdrawTarget(creep);
        if (bestTarget) {
            cache.targetId = bestTarget.id;
            cache.targetType = bestTarget.type;

            const target = Game.getObjectById(bestTarget.id) as any;
            if (target) {
                if (bestTarget.type === 'dropped' && creep.pos.isNearTo(target)) {
                    creep.pickup(target);
                } else {
                    moveOutCarryTo(creep, target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 }, true);
                }
                return;
            }
            delete cache.targetId;
            delete cache.targetType;
        }

        const preferredSource = getPreferredCarrySource(creep);
        if (preferredSource) {
            assignPreferredSourceCache(cache, preferredSource);

            if (preferredSource.container) {
                if (!creep.pos.inRangeTo(preferredSource.container, 1) || preferredSource.container.store.getUsedCapacity() > 0) {
                    moveOutCarryTo(creep, preferredSource.container, {
                        ignoreCreeps: false,
                        range: 1,
                        maxRooms: 1,
                        plainCost: 2,
                        swampCost: 10
                    }, true);
                }
                return;
            }

            const assignedHarvester = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
                filter: (c) =>
                    c.memory.role === 'out-harvest' &&
                    c.memory.targetSourceId === preferredSource.sourceId
            });
            if (assignedHarvester) {
                if (!creep.pos.inRangeTo(assignedHarvester, 2) || assignedHarvester.store[RESOURCE_ENERGY] > 0) {
                    moveOutCarryTo(creep, assignedHarvester, {
                        ignoreCreeps: false,
                        range: 2,
                        maxRooms: 1,
                        plainCost: 2,
                        swampCost: 10
                    }, true);
                }
                return;
            }

            moveOutCarryTo(creep, preferredSource.sourcePos, {
                ignoreCreeps: false,
                range: Math.min(2, preferredSource.collectionRange),
                maxRooms: 1,
                plainCost: 2,
                swampCost: 10
            }, true);
            return;
        }

        // 兜底拾取链只允许在【目标外矿房】运行：
        // 在母房/途经房拾取会倒腾 home storage/source 的能量——
        // collect 拿了 deliver 又放回，形成「拿了又放」的死循环。
        if (creep.room.name !== creep.memory.targetRoom) return;

        const droppedPickupThreshold = Math.min(500, creep.store.getCapacity());
        if (creep.collectDroppedResource(undefined, droppedPickupThreshold)) return;
        if (creep.collectFromTombstone(undefined, 0)) return;
        if (creep.collectFromContainer(300, RESOURCE_ENERGY, false)) return;
        if (creep.collectFromStorage(RESOURCE_ENERGY, 0)) return;

        const nearestMiner = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'out-mineral'
        });
        if (nearestMiner) {
            if (!creep.pos.inRangeTo(nearestMiner, 1) || nearestMiner.store.getUsedCapacity() > 0) {
                moveOutCarryTo(creep, nearestMiner, {
                    ignoreCreeps: false,
                    range: 1,
                    maxRooms: 1,
                    plainCost: 2,
                    swampCost: 10
                }, true);
            }
            return;
        }

        const nearestHarvester = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'out-harvest' && c.pos.findInRange(FIND_SOURCES, 1).length > 0
        });
        if (nearestHarvester) {
            if (!creep.pos.inRangeTo(nearestHarvester, 2) || nearestHarvester.store[RESOURCE_ENERGY] > 0) {
                moveOutCarryTo(creep, nearestHarvester, {
                    ignoreCreeps: false,
                    range: 2,
                    maxRooms: 1,
                    plainCost: 2,
                    swampCost: 10
                }, true);
            }
            return;
        }

        const nearestSource = creep.pos.findClosestByRange(FIND_SOURCES);
        if (nearestSource) {
            moveOutCarryTo(creep, nearestSource, {
                ignoreCreeps: false,
                range: 3,
                maxRooms: 1,
                plainCost: 2,
                swampCost: 10
            }, true);
        }
    },

    /**
     * 执行 deliver 态的返程与卸货流程。
     *
     * @remarks
     * 返程途中会先尝试接力；若未命中接力条件，再沿既定路线回母房并把资源交给 storage/terminal。
     *
     * @param creep 当前处于 deliver 态的外矿搬运 creep。
     */
    carry: function (creep: Creep) {
        const cache = getOutCarryTargetCache(creep);
        const sourceRoom = creep.memory.sourceRoom;
        if (!sourceRoom) return;

        if (creep.room.name != sourceRoom || creep.pos.isRoomEdge()) {
            if (creep.room.name != sourceRoom && !creep.pos.isRoomEdge()) {
                // 返程途中允许接头：先走一步登记意图，接不上就照常移动
                if (this.moveAlongRouteExit(creep, sourceRoom, true)) return;
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

    // 统一入口：只做 collect / deliver，修路与建造交给 out-build。
    run: function (creep: Creep) {
        (creep.memory as any).lastRunTick = Game.time;
        delete creep.memory.working;

        runModeCycle(creep);

        // 接力后续跑：本 tick 由自己发起过接力（relayedSelfTick）时，memory 已换成新身份，
        // 立即再决策一轮——转移与移动同 tick 完成，货物单 tick 前进两格。
        // 例：贴脸队形 A-B-C（C 满载）只传一次 C→B，随后 B 掉头带货行驶、A/C 各自让位分开，
        // 最终 ABC → BAOC（O 为空位），而不是原地 C→B→A 逐手倒货。
        // 第二轮中的接力尝试会被同 tick 接力标记阻断，不会连环传递。
        if ((creep.memory as any).relayedSelfTick === Game.time) {
            runModeCycle(creep);
        }

        // 空闲让位：本 tick 没有任何移动意图、又滞留在出口格上的搬运工，
        // 主动向房间内部挪动——出口格是跨房交通的必经之路，停车等于堵门。
        clearDoorZoneIfIdle(creep);
    },
};

// 出口格（x/y = 0/49）是跨界交通唯一的必经之路，
// 没有搬运目标而原地滞留的搬运工必须让位，否则对向 creep 全部被堵在门外。
const clearDoorZoneIfIdle = (creep: Creep): void => {
    const pos = creep.pos;
    if (pos.x > 0 && pos.x < 49 && pos.y > 0 && pos.y < 49) return;
    const betterMove = (global as any).BetterMove;
    if (betterMove && typeof betterMove.hasMoveIntent === 'function' && betterMove.hasMoveIntent(creep)) return;
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { range: 20, plainCost: 2, swampCost: 10 });
};

// 判定是否进入采集策略
const shouldCollect = (creep: Creep): boolean => {
    const used = creep.store.getUsedCapacity();
    const free = creep.store.getFreeCapacity();
    const inTargetRoom = creep.room.name === creep.memory.targetRoom;
    const lowHealth = creep.hits < creep.hitsMax * 0.5;
    if (inTargetRoom && !lowHealth && free > 0) return true;
    if (used === 0) return true;
    return false;
};

// 显式态解析：
// - 已在 deliver 态时，只有能量低于半仓才允许切回 collect
// - 已在 collect 态时，优先把这趟货拿满；只有满仓/离开目标房/受伤时才切出去
/**
 * 按显式滞回规则解析外矿搬运 creep 当前应处的模式。
 *
 * @remarks
 * 这里故意避免“掉 1 点能量就立刻回 collect”的抖动：
 * - 已在 deliver 态时，只有载荷降到半仓以下才允许切回 collect。
 * - 已在 collect 态时，优先把这趟货尽量拿满；只有满仓、已回到母房或受伤时才切去 deliver。
 * - 濒死且身上有货时，直接锁定 deliver，优先把资源往回送。
 *
 * @param creep 当前外矿搬运 creep。
 * @param previousMode 上一 tick 缓存的模式。
 * @returns 本 tick 应执行的 collect / deliver 模式。
 */
const resolveOutCarryMode = (creep: Creep, previousMode?: OutCarryMode): OutCarryMode => {
    const used = creep.store.getUsedCapacity();
    const free = creep.store.getFreeCapacity();
    const cap = Math.max(1, creep.store.getCapacity());
    const inTargetRoom = creep.room.name === creep.memory.targetRoom;
    const inSourceRoom = creep.room.name === creep.memory.sourceRoom;
    const lowHealth = creep.hits < creep.hitsMax * 0.5;
    const collectResumeThreshold = Math.ceil(cap * OUT_CARRY_RETURN_TO_COLLECT_RATIO);

    if (isOutCarryDying(creep)) return OUT_CARRY_STRATEGIES.DELIVER;

    // 接力当 tick 的方向锁：本 tick 下达的动作要到 tick 末才落账，这里读到的 store
    // 还是交接前的旧载荷，「谁接了货谁返程」推导不出来——所以交接当 tick 直接用
    // 接力写下的方向（见 relayHandoff.setRelayDirection），只对本 tick 有效。
    const relayDir = readRelayDirection(creep);
    if (relayDir === OUT_CARRY_STRATEGIES.COLLECT) return OUT_CARRY_STRATEGIES.COLLECT;
    if (relayDir === OUT_CARRY_STRATEGIES.DELIVER) return OUT_CARRY_STRATEGIES.DELIVER;

    if (used === 0) return OUT_CARRY_STRATEGIES.COLLECT;

    if (previousMode === OUT_CARRY_STRATEGIES.COLLECT) {
        if (lowHealth || free === 0) return OUT_CARRY_STRATEGIES.DELIVER;
        if (inTargetRoom) return OUT_CARRY_STRATEGIES.COLLECT;
        if (!inSourceRoom && used < collectResumeThreshold) return OUT_CARRY_STRATEGIES.COLLECT;
        return OUT_CARRY_STRATEGIES.DELIVER;
    }

    if (previousMode === OUT_CARRY_STRATEGIES.DELIVER) {
        if (!inSourceRoom && !lowHealth && used < collectResumeThreshold) return OUT_CARRY_STRATEGIES.COLLECT;
        return OUT_CARRY_STRATEGIES.DELIVER;
    }

    return shouldCollect(creep) ? OUT_CARRY_STRATEGIES.COLLECT : OUT_CARRY_STRATEGIES.DELIVER;
};

/**
 * 执行 collect 态主流程，并保留“半仓等待”策略。
 *
 * @remarks
 * 当 creep 仍在目标房且未受伤时，会优先继续补货；若短时间内取不到更多资源，
 * 则按等待计数决定是否提前返程。对濒死且已带货的 creep，会直接跳过等待并强制返程。
 *
 * @param creep 当前外矿搬运 creep。
 */
const runCollectMode = (creep: Creep) => {
    const sourceCache = getOutCarrySourceCache(creep);
    const used = creep.store.getUsedCapacity();
    const free = creep.store.getFreeCapacity();
    const cap = Math.max(1, creep.store.getCapacity());
    const inTargetRoom = creep.room.name === creep.memory.targetRoom;
    const inSourceRoom = creep.room.name === creep.memory.sourceRoom;
    const lowHealth = creep.hits < creep.hitsMax * 0.5;
    const collectResumeThreshold = Math.ceil(cap * OUT_CARRY_RETURN_TO_COLLECT_RATIO);

    if (used > 0 && isOutCarryDying(creep)) {
        sourceCache.partialLeaveWait = 0;
        outCarry.carry(creep);
        creep.memory.dontPullMe = false;
        return;
    }

    // 接力当 tick 的方向锁：这里的载荷同样还是交接前的旧值（动作 tick 末才落账），
    // 按载荷挑分支会让刚交出全部货物的供给方落进 carry（返程）而走反方向。
    // 锁成采集就一律走取货流程：交接后这一方已经是空仓，取货流程会自己把它送回外矿。
    if (readRelayDirection(creep) === OUT_CARRY_STRATEGIES.COLLECT) {
        sourceCache.partialLeaveWait = 0;
        outCarry.withdraw(creep);
        creep.memory.dontPullMe = false;
        return;
    }

    if (inTargetRoom && !lowHealth && free > 0) {
        const memBefore = creep.memory;

        // 「这一趟有没有真进到货」不能拿本 tick 的快照自比：动作要到 tick 末才落账，
        // tick 中间读到的 store 是 tick 开始的快照（见官方「理解游戏循环」），
        // 前后两次读同一个快照永远相等，等仓计数就再也回不了零。
        // 只能和上一个 tick 开始时的快照比——那个值已经包含上一 tick 动作的结果。
        const usedAtTickStart = used;
        const previousUsed = Number(sourceCache.collectUsedAtTickStart || 0);
        const gainedSinceLastTick = usedAtTickStart > previousUsed;
        sourceCache.collectUsedAtTickStart = usedAtTickStart;

        outCarry.withdraw(creep);
        creep.memory.dontPullMe = false;

        // 交接会交换双方 memory：此时 sourceCache 已经跟着旧记忆落到伙伴身上了，
        // 再往它里面写等仓计数就是在污染伙伴的缓存。交接后的补跑由
        // 「接力后续跑」（relayedSelfTick）按新身份完成，这里直接退出。
        if (creep.memory !== memBefore) return;

        if (gainedSinceLastTick) {
            sourceCache.partialLeaveWait = 0;
            return;
        }

        const wait = Number(sourceCache.partialLeaveWait || 0) + 1;
        sourceCache.partialLeaveWait = wait;
        if (usedAtTickStart === 0) return;
        if (wait < 18) return;

        delete sourceCache.partialLeaveWait;
        outCarry.carry(creep);
        creep.memory.dontPullMe = false;
        return;
    }

    sourceCache.partialLeaveWait = 0;
    if (used === 0) {
        outCarry.withdraw(creep);
        creep.memory.dontPullMe = false;
        return;
    }

    if (!inSourceRoom && !lowHealth && free > 0 && used < collectResumeThreshold) {
        outCarry.withdraw(creep);
        creep.memory.dontPullMe = false;
        return;
    }

    outCarry.carry(creep);
    creep.memory.dontPullMe = false;
};

const runOutCarryMode = (creep: Creep, mode: OutCarryMode) => {
    if (mode === OUT_CARRY_STRATEGIES.COLLECT) {
        runCollectMode(creep);
        return;
    }
    outCarry.carry(creep);
    creep.memory.dontPullMe = false;
};

// 单轮模式决策 + 执行：解析 collect/deliver，切态时清对侧缓存，然后跑对应主流程。
// 接力后续跑会以交换后的新 memory 再调用一次本函数，缓存按当下 memory 现取现用。
// 接力后续跑的跨模块入口：relayHandoff 在完全交接后，
// 对「本 tick 已跑过、意图被作废」的伙伴 creep 调用此钩子重登记移动意图。
;(global as any).__outCarryReissue = (creep: Creep) => {
    if (!creep || !(creep.memory as any)) return;
    delete creep.memory.working;
    runModeCycle(creep);
};

const runModeCycle = (creep: Creep): void => {
    const cache = getOutCarryCache(creep);
    const previousMode = cache.outCarryMode as OutCarryMode | undefined;
    const mode = resolveOutCarryMode(creep, previousMode);

    if (mode !== previousMode) {
        // collect / deliver 切换时必须清掉对侧缓存，避免刚切态就被旧目标拖回去。
        const sourceCache = getOutCarrySourceCache(creep);
        const targetCache = getOutCarryTargetCache(creep);
        if (mode === OUT_CARRY_STRATEGIES.COLLECT) {
            delete targetCache.targetId;
        } else {
            delete sourceCache.targetId;
            delete sourceCache.targetType;
            delete sourceCache.waitUntil;
            delete sourceCache.partialLeaveWait;
            clearAssignedSourceCache(sourceCache);
        }
    }
    cache.outCarryMode = mode;

    runOutCarryMode(creep, mode);
};

export default outCarry;
