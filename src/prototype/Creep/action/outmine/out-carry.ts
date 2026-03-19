import { getCreepSourceRoom } from '@/modules/utils/creepMemory';
import { StrategyContainer, runStrategy } from '@/framework/ai/strategy';

const routeExitCache: Record<string, { tick: number; exit: number | null }> = {};

// 策略 ID：集中声明，避免散落字符串
const OUT_CARRY_STRATEGIES = {
    BUILD_REPAIR: 'build-repair',
    COLLECT: 'collect',
    DELIVER: 'deliver'
} as const;

type OutCarryMode = typeof OUT_CARRY_STRATEGIES[keyof typeof OUT_CARRY_STRATEGIES];

type OutCarryContext = {
    creep: Creep;
    mode: OutCarryMode;
};

type OutCarryAction = {
    run: (creep: Creep) => void;
    resolveCarryDepositTarget: (creep: Creep) => StructureTerminal | StructureStorage | null;
    isLikelyCollecting: (creep: Creep) => boolean;
    getRouteExitDirection: (creep: Creep, targetRoom: string | undefined) => number | null;
    moveAlongRouteExit: (creep: Creep, targetRoom: string | undefined) => boolean;
    estimateIncomingPerTick: (container: StructureContainer) => number;
    calcWaitTicksNearHarvester: (creep: Creep, container: StructureContainer) => number;
    findBestWithdrawTarget: (creep: Creep) => { id: string; type: 'dropped' | 'container' | 'tombstone' | 'ruin' } | null;
    withdraw: (creep: Creep) => void;
    carry: (creep: Creep) => void;
    buildRepair: (creep: Creep) => boolean;
};

// Build/repair 能力判定：
// 这里不再依赖 role 字符串，而是按 creep 是否真的还有 WORK 能力来判断。
// 这样共享同一 handler 的不同角色或未来变体不会因为命名差异被误伤。
const canBuildRepair = (creep: Creep): boolean => {
    if (creep.store[RESOURCE_ENERGY] <= 0) return false;
    if (typeof creep.getActiveBodyparts !== 'function') return false;
    return creep.getActiveBodyparts(WORK) > 0;
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

        const exitDirection = this.getRouteExitDirection(creep, targetRoom);
        if (!exitDirection) return false;

        const exits = creep.room.find(exitDirection);
        if (!exits || exits.length <= 0) return false;
        const exitPos = creep.pos.findClosestByRange(exits);
        if (!exitPos) return false;

        creep.moveTo(exitPos, {
            maxRooms: 1,
            range: 0,
            ignoreCreeps: false,
            plainCost: 2,
            swampCost: 10,
            reusePath: 3
        });
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
        const sourceRoomName = getCreepSourceRoom(creep.memory);
        const sourceRoom = sourceRoomName ? Game.rooms[sourceRoomName] : undefined;
        const canStoreMinerals = !!(sourceRoom?.storage || sourceRoom?.terminal);

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
            if (getCreepSourceRoom(other.memory) !== sourceRoomName) continue;
            if (other.memory.targetRoom !== creep.memory.targetRoom) continue;
            if (!this.isLikelyCollecting(other)) continue;
            const targetId = other.memory.cacheSource?.targetId;
            if (!targetId) continue;
            reservedByTarget[targetId] = (reservedByTarget[targetId] || 0) + other.store.getFreeCapacity();
        }

        let bestScore = -Infinity;
        let best: { id: string; type: 'dropped' | 'container' | 'tombstone' | 'ruin' } | null = null;

        const consider = (id: string, type: 'dropped' | 'container' | 'tombstone' | 'ruin', pos: RoomPosition, amount: number, nonEnergyBonus = 0) => {
            if (!id || amount <= 0) return;
            if (isDangerousPos(pos)) return;

            const reserved = reservedByTarget[id] || 0;
            const remaining = amount - reserved;
            if (remaining <= 0) return;

            const range = creep.pos.getRangeTo(pos);
            let score = remaining + nonEnergyBonus;
            score -= range * range * 0.5;

            if (score > bestScore) {
                bestScore = score;
                best = { id, type };
            }
        };

        const droppedThreshold = Math.min(500, creep.store.getCapacity());
        const dropped = room.find(FIND_DROPPED_RESOURCES, {
            filter: (r: Resource) => r.amount >= droppedThreshold
        });
        for (const resource of dropped) {
            if (!canStoreMinerals && resource.resourceType !== RESOURCE_ENERGY) continue;
            const bonus = resource.resourceType === RESOURCE_ENERGY ? 0 : resource.amount * 3;
            consider(resource.id, 'dropped', resource.pos, resource.amount, bonus);
        }

        const containers = (room.container || []).filter((c: StructureContainer) => c.store.getUsedCapacity() >= 300);
        for (const container of containers) {
            const energyAmount = container.store[RESOURCE_ENERGY] || 0;
            const totalAmount = container.store.getUsedCapacity();
            const amount = canStoreMinerals ? totalAmount : energyAmount;
            const incoming = this.estimateIncomingPerTick(container);
            const bonus = incoming > 0 ? Math.min(creep.store.getFreeCapacity(), incoming * 5) : 0;
            consider(container.id, 'container', container.pos, amount, bonus);
        }

        const tombstones = room.find(FIND_TOMBSTONES, {
            filter: (t: Tombstone) => t.store.getUsedCapacity() > 0
        });
        for (const tombstone of tombstones) {
            const energyAmount = tombstone.store[RESOURCE_ENERGY] || 0;
            const totalAmount = tombstone.store.getUsedCapacity();
            const amount = canStoreMinerals ? totalAmount : energyAmount;
            const mixedBonus = canStoreMinerals && totalAmount > energyAmount ? 200 : 0;
            consider(tombstone.id, 'tombstone', tombstone.pos, amount, mixedBonus);
        }

        const ruins = room.find(FIND_RUINS, {
            filter: (r: Ruin) => r.store.getUsedCapacity() > 0
        });
        for (const ruin of ruins) {
            const energyAmount = ruin.store[RESOURCE_ENERGY] || 0;
            const totalAmount = ruin.store.getUsedCapacity();
            const amount = canStoreMinerals ? totalAmount : energyAmount;
            const mixedBonus = canStoreMinerals && totalAmount > energyAmount ? 120 : 0;
            consider(ruin.id, 'ruin', ruin.pos, amount, mixedBonus);
        }

        return best;
    },

    withdraw: function (creep: Creep) {
        creep.memory.cacheSource = creep.memory.cacheSource || {};
        const cache = creep.memory.cacheSource as any;
        const sourceRoom = getCreepSourceRoom(creep.memory);

        if (cache.waitUntil && Game.time < cache.waitUntil) {
            const nearbyDrop = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
                filter: (r: Resource) => r.amount > 0
            })[0];
            if (nearbyDrop) creep.pickup(nearbyDrop);
            return;
        }
        delete cache.waitUntil;

        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            if (this.moveAlongRouteExit(creep, creep.memory.targetRoom)) return;
            creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
            return;
        }

        if (cache.targetId) {
            const target = Game.getObjectById(cache.targetId as Id<any>) as any;
            if (!target) {
                delete cache.targetId;
                delete cache.targetType;
                return;
            }

            if (!creep.pos.inRangeTo(target, 1)) {
                creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
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

            const target = Game.getObjectById(bestTarget.id as Id<any>) as any;
            if (target) {
                if (bestTarget.type === 'dropped' && creep.pos.isNearTo(target)) {
                    creep.pickup(target);
                } else {
                    creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
                }
                return;
            }
            delete cache.targetId;
            delete cache.targetType;
        }

        const droppedPickupThreshold = Math.min(500, creep.store.getCapacity());
        if (creep.collectDroppedResource(undefined, droppedPickupThreshold)) return;
        if (creep.collectFromContainer(300, RESOURCE_ENERGY, false)) return;
        if (creep.collectFromTombstone(undefined, 500)) return;
        if (creep.collectFromStorage(RESOURCE_ENERGY, 0)) return;

        const nearestMiner = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'out-mineral'
        });
        if (nearestMiner) {
            if (!creep.pos.inRangeTo(nearestMiner, 1) || nearestMiner.store.getUsedCapacity() > 0) {
                creep.moveTo(nearestMiner, {
                    ignoreCreeps: false,
                    range: 1,
                    maxRooms: 1,
                    plainCost: 2,
                    swampCost: 10
                });
            }
            return;
        }

        const nearestHarvester = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'out-harvest' && c.pos.findInRange(FIND_SOURCES, 1).length > 0
        });
        if (nearestHarvester) {
            if (!creep.pos.inRangeTo(nearestHarvester, 2) || nearestHarvester.store[RESOURCE_ENERGY] > 0) {
                creep.moveTo(nearestHarvester, {
                    ignoreCreeps: false,
                    range: 1,
                    maxRooms: 1,
                    plainCost: 2,
                    swampCost: 10
                });
            }
            return;
        }

        const nearestSource = creep.pos.findClosestByRange(FIND_SOURCES);
        if (nearestSource) {
            creep.moveTo(nearestSource, {
                ignoreCreeps: false,
                range: 3,
                maxRooms: 1,
                plainCost: 2,
                swampCost: 10
            });
        }
    },

    carry: function (creep: Creep) {
        creep.memory.cacheTarget = creep.memory.cacheTarget || {};
        const cache = creep.memory.cacheTarget as any;
        const sourceRoom = getCreepSourceRoom(creep.memory);
        if (!sourceRoom) return;

        if (creep.room.name != sourceRoom || creep.pos.isRoomEdge()) {
            if (creep.room.name != sourceRoom && !creep.pos.isRoomEdge()) {
                if (this.moveAlongRouteExit(creep, sourceRoom)) return;
            }
            creep.moveToRoom(sourceRoom, { plainCost: 2, swampCost: 10 });
            return;
        }

        let target: StructureTerminal | StructureStorage | null = null;
        if (cache.targetId) {
            target = Game.getObjectById(cache.targetId as Id<StructureTerminal | StructureStorage>) as StructureTerminal | StructureStorage;
            if (target) {
                if (creep.pos.inRangeTo(target, 1)) {
                    if (target.store.getFreeCapacity(RESOURCE_ENERGY) > 200) {
                        creep.transfer(target, Object.keys(creep.store)[0] as ResourceConstant);
                    } else {
                        delete cache.targetId;
                    }
                } else {
                    creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
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
                creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
            }
            return;
        }

        const storage = creep.room.storage;
        const controller = creep.room.controller;
        if (storage) {
            if (creep.pos.inRangeTo(storage, 1)) creep.drop(Object.keys(creep.store)[0] as ResourceConstant);
            else creep.moveTo(storage, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
            return;
        }

        if (controller && controller.level < 8) {
            if (creep.pos.inRangeTo(controller, 1)) creep.drop(Object.keys(creep.store)[0] as ResourceConstant);
            else creep.moveTo(controller, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
            return;
        }

        const centerPos = creep.room.getCenter();
        if (centerPos && creep.pos.inRangeTo(centerPos, 1)) {
            creep.drop(Object.keys(creep.store)[0] as ResourceConstant);
        } else {
            creep.moveTo(centerPos, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
        }
    },

    buildRepair: function (creep: Creep) {
        const sourceRoom = getCreepSourceRoom(creep.memory);
        if (sourceRoom && creep.room.name == sourceRoom) return false;
        if (!canBuildRepair(creep)) return false;

        const roads = creep.room.road?.filter((r: any) => {
            if (!r || r.hits >= r.hitsMax * 0.8) return false;
            if (!creep.pos.inRangeTo(r.pos, 1)) return false;
            return true;
        });
        if (roads && roads.length > 0) {
            const road = creep.pos.findClosestByRange(roads);
            const result = creep.repair(road);
            if (creep.pos.isRoomEdge()) {
                creep.moveToRoom(creep.room.name, { plainCost: 2, swampCost: 10 });
            }
            if (result == OK) return true;
            if (result == ERR_NOT_IN_RANGE) {
                creep.moveTo(road);
                return true;
            }
        }

        if (creep.buildRoad()) {
            if (creep.pos.isRoomEdge()) {
                creep.moveToRoom(creep.room.name, { plainCost: 2, swampCost: 10 });
            }
            return true;
        }

        creep.memory.dontPullMe = false;
        return false;
    },

    // 统一入口：先执行 BuildRepair，若无动作则按采集/交付兜底
    run: function (creep: Creep) {
        creep.memory.cache = creep.memory.cache || {};
        creep.memory.cacheSource = creep.memory.cacheSource || {};
        creep.memory.cacheTarget = creep.memory.cacheTarget || {};
        delete creep.memory.working;

        const mode: OutCarryMode = shouldBuildRepair(creep)
            ? OUT_CARRY_STRATEGIES.BUILD_REPAIR
            : shouldCollect(creep)
                ? OUT_CARRY_STRATEGIES.COLLECT
                : OUT_CARRY_STRATEGIES.DELIVER;

        const ctx: OutCarryContext = { creep, mode };
        const handled = runStrategy(outCarryStrategyContainer, ctx);

        if (mode === OUT_CARRY_STRATEGIES.BUILD_REPAIR && !handled) {
            const fallbackMode: OutCarryMode = shouldCollect(creep)
                ? OUT_CARRY_STRATEGIES.COLLECT
                : OUT_CARRY_STRATEGIES.DELIVER;
            runStrategy(outCarryStrategyContainer, { creep, mode: fallbackMode });
        }
    },
};

// 判断是否满足“修路/修路肩”策略的前置条件
const shouldBuildRepair = (creep: Creep): boolean => {
    const sourceRoom = getCreepSourceRoom(creep.memory);
    if (sourceRoom && creep.room.name == sourceRoom) return false;
    return canBuildRepair(creep);
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

// 复刻原采集逻辑（包含“半仓等待”策略）
const runCollectMode = (creep: Creep) => {
    const sourceCache = creep.memory.cacheSource as any;
    const used = creep.store.getUsedCapacity();
    const free = creep.store.getFreeCapacity();
    const inTargetRoom = creep.room.name === creep.memory.targetRoom;
    const lowHealth = creep.hits < creep.hitsMax * 0.5;

    if (inTargetRoom && !lowHealth && free > 0) {
        const before = used;
        outCarry.withdraw(creep);
        creep.memory.dontPullMe = false;

        const after = creep.store.getUsedCapacity();
        if (after > before) {
            sourceCache.partialLeaveWait = 0;
            return;
        }

        const wait = Number(sourceCache.partialLeaveWait || 0) + 1;
        sourceCache.partialLeaveWait = wait;
        if (after === 0) return;
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

    outCarry.carry(creep);
    creep.memory.dontPullMe = false;
};

// 策略容器：按优先级注册
const outCarryStrategyContainer = new StrategyContainer<OutCarryContext, boolean>();

outCarryStrategyContainer.register({
    id: OUT_CARRY_STRATEGIES.BUILD_REPAIR,
    canRun: (ctx) => ctx.mode === OUT_CARRY_STRATEGIES.BUILD_REPAIR,
    run: (ctx) => outCarry.buildRepair(ctx.creep)
});

outCarryStrategyContainer.register({
    id: OUT_CARRY_STRATEGIES.COLLECT,
    canRun: (ctx) => ctx.mode === OUT_CARRY_STRATEGIES.COLLECT,
    run: (ctx) => {
        runCollectMode(ctx.creep);
        return true;
    }
});

outCarryStrategyContainer.register({
    id: OUT_CARRY_STRATEGIES.DELIVER,
    canRun: (ctx) => ctx.mode === OUT_CARRY_STRATEGIES.DELIVER,
    run: (ctx) => {
        outCarry.carry(ctx.creep);
        ctx.creep.memory.dontPullMe = false;
        return true;
    }
});

export default outCarry;
