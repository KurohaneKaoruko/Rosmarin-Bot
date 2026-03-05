import { decompress } from '@/modules/utils/compress';

const relayExitCache: Record<string, { tick: number; exit: number | null }> = {};
const relayQueuePosCache: Record<string, { tick: number; positions: RoomPosition[] }> = {};

const outCarry = {
    markForcedMove: function (creep: Creep, direction?: DirectionConstant | null, keepTicks = 1) {
        if (!creep || !direction) return;
        creep.memory.cacheSource = creep.memory.cacheSource || {};
        const cache = creep.memory.cacheSource as any;
        cache.forcedMoveDirection = direction;
        cache.forcedMoveTick = Game.time;
        const until = Game.time + Math.max(1, keepTicks | 0);
        cache.forcedMoveUntil = Math.max(Number(cache.forcedMoveUntil || 0), until);
    },

    markReceivedEnergy: function (receiver: Creep, homeDirection?: DirectionConstant | null) {
        if (!receiver) return;
        receiver.memory.cacheSource = receiver.memory.cacheSource || {};
        const cache = receiver.memory.cacheSource as any;
        cache.receivedEnergyTick = Game.time;
        if (homeDirection) cache.receivedMoveDirection = homeDirection;
        cache.receivedRetreatUntil = Math.max(Number(cache.receivedRetreatUntil || 0), Game.time + 3);
        // 接收能量后先锁住自己，避免同 tick 被其他 creep 的对穿覆盖移动意图。
        receiver.memory.dontPullMe = true;
        this.markForcedMove(receiver, homeDirection, 2);
        // 被接力后立即清空采集目标缓存，下一 tick 优先进入回程流程。
        delete cache.targetId;
        delete cache.targetType;
    },

    isLikelyCollecting: function (creep: Creep): boolean {
        if (!creep || creep.spawning) return false;
        if (creep.store.getFreeCapacity() <= 0) return false;

        const targetRoom = creep.memory.targetRoom;
        if (targetRoom && creep.room.name === targetRoom) return true;

        // 非目标房且已经带了不少资源，通常处于回程，不应参与采集目标预留。
        const used = creep.store.getUsedCapacity();
        const cap = creep.store.getCapacity();
        if (used > 0 && used >= Math.floor(cap * 0.4)) return false;

        return true;
    },

    getRouteExitDirection: function (creep: Creep, targetRoom: string | undefined): number | null {
        if (!targetRoom || creep.room.name === targetRoom) return null;

        const cacheKey = `${creep.room.name}->${targetRoom}`;
        const cached = relayExitCache[cacheKey];
        if (cached && cached.tick === Game.time) return cached.exit;

        let exit: number | null = null;
        const route = Game.map.findRoute(creep.room.name, targetRoom);
        if (Array.isArray(route) && route.length > 0) {
            exit = route[0].exit;
        }

        relayExitCache[cacheKey] = { tick: Game.time, exit };
        return exit;
    },

    getRelayExitDirection: function (creep: Creep): number | null {
        return this.getRouteExitDirection(creep, creep.memory.homeRoom);
    },

    getExitProgress: function (pos: RoomPosition, exitDirection: number): number {
        switch (exitDirection) {
            case FIND_EXIT_TOP: return 49 - pos.y;
            case FIND_EXIT_BOTTOM: return pos.y;
            case FIND_EXIT_LEFT: return 49 - pos.x;
            case FIND_EXIT_RIGHT: return pos.x;
            default: return 0;
        }
    },

    getOppositeDirection: function (exitDirection: number): DirectionConstant | null {
        switch (exitDirection) {
            case FIND_EXIT_TOP: return BOTTOM;
            case FIND_EXIT_BOTTOM: return TOP;
            case FIND_EXIT_LEFT: return RIGHT;
            case FIND_EXIT_RIGHT: return LEFT;
            default: return null;
        }
    },

    getHomeDirection: function (exitDirection: number): DirectionConstant | null {
        switch (exitDirection) {
            case FIND_EXIT_TOP: return TOP;
            case FIND_EXIT_BOTTOM: return BOTTOM;
            case FIND_EXIT_LEFT: return LEFT;
            case FIND_EXIT_RIGHT: return RIGHT;
            default: return null;
        }
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

    tryForceLineMove: function (
        creep: Creep,
        direction: DirectionConstant | null,
        markIntent = true,
        depth = 0,
        visited?: Record<string, 1>
    ): boolean {
        if (!direction) return false;
        if (markIntent) this.markForcedMove(creep, direction, 1);

        const moveSelf = () => {
            creep.memory.dontPullMe = false;
            creep.move(direction);
            return true;
        };

        if (creep.pos.isRoomEdge()) return moveSelf();

        const seen = visited || Object.create(null);
        if (seen[creep.id]) return moveSelf();
        seen[creep.id] = 1;

        const blocker = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
            filter: (c: Creep) =>
                c.id !== creep.id &&
                !c.spawning &&
                (c.memory.role === 'out-carry' || c.memory.role === 'out-car') &&
                creep.pos.getDirectionTo(c.pos) === direction
        })[0];
        if (blocker) {
            blocker.memory.dontPullMe = false;
            if (markIntent) this.markForcedMove(blocker, direction, 1);
            if (depth < 4 && !seen[blocker.id]) {
                // 级联推动同向 blocker，避免前方多层占位时接收者原地不动。
                this.tryForceLineMove(blocker, direction, markIntent, depth + 1, seen);
            } else {
                blocker.move(direction);
            }
        }

        return moveSelf();
    },

    getRelayQueuePositions: function (creep: Creep, exitDirection: number): RoomPosition[] {
        const roadMemory = creep.room.memory.road as number[] | undefined;
        if (!Array.isArray(roadMemory) || roadMemory.length === 0) return [];

        const cacheKey = `${creep.room.name}:${exitDirection}`;
        const cached = relayQueuePosCache[cacheKey];
        if (cached && cached.tick === Game.time) return cached.positions;

        const terrain = creep.room.getTerrain();
        const sources = creep.room.find(FIND_SOURCES);
        const sourceContainers = (creep.room.container || []).filter((c: StructureContainer) =>
            sources.some((s: Source) => c.pos.inRangeTo(s.pos, 1))
        );
        const positions: RoomPosition[] = [];
        const seen = new Set<string>();

        for (const packed of roadMemory) {
            if (typeof packed !== 'number') continue;
            const [x, y] = decompress(packed);
            if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

            const key = `${x}:${y}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const pos = new RoomPosition(x, y, creep.room.name);
            // 采集位周围留空，避免排队 creep 抢占矿工与直连传递位置。
            if (sources.some((s: Source) => pos.inRangeTo(s.pos, 1))) continue;
            // 采集容器周围也留空，避免堵住 OH 的取放与掉头路径。
            if (sourceContainers.some((c: StructureContainer) => pos.inRangeTo(c.pos, 1))) continue;
            positions.push(pos);
        }

        // 按“到回家出口的推进度”从小到大排序，形成由矿点向出口延展的站位序列。
        positions.sort((a, b) => this.getExitProgress(a, exitDirection) - this.getExitProgress(b, exitDirection));
        relayQueuePosCache[cacheKey] = { tick: Game.time, positions };
        return positions;
    },

    getRelayQueueContext: function (creep: Creep): {
        exitDirection: number;
        carriers: Creep[];
        myIndex: number;
        frontCollectors: number;
        slotPos: RoomPosition;
    } | null {
        if (creep.room.name !== creep.memory.targetRoom) return null;
        if (creep.pos.isRoomEdge()) return null;

        const exitDirection = this.getRelayExitDirection(creep);
        if (!exitDirection) return null;

        const queuePositions = this.getRelayQueuePositions(creep, exitDirection);
        if (queuePositions.length === 0) return null;

        const carriers = creep.room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) =>
                !c.spawning &&
                (c.memory.role === 'out-carry' || c.memory.role === 'out-car') &&
                c.memory.homeRoom === creep.memory.homeRoom &&
                c.memory.targetRoom === creep.memory.targetRoom &&
                c.store.getFreeCapacity() > 0
        }) as Creep[];
        if (carriers.length <= 1) return null;

        carriers.sort((a: Creep, b: Creep) => {
            const progressA = this.getExitProgress(a.pos, exitDirection);
            const progressB = this.getExitProgress(b.pos, exitDirection);
            if (progressA !== progressB) return progressA - progressB;
            return a.id.localeCompare(b.id);
        });

        const myIndex = carriers.findIndex((c: Creep) => c.id === creep.id);
        if (myIndex < 0) return null;

        const frontCollectors = 1;
        const waitingRank = Math.max(0, myIndex - frontCollectors);
        const lineLength = queuePositions.length;
        if (lineLength <= 1) return null;

        // 槽位分配策略：
        // 1) 先使用 1,3,5...（隔一格站位，给接收后返程留空）
        // 2) 超出后再使用 2,4,6...（扩大容量，避免队尾多人叠在同一格）
        // 3) 再超出时按已有槽位循环，至少保证分布而不是固定挤在末尾
        const slotOrder: number[] = [];
        for (let i = 1; i < lineLength; i += 2) slotOrder.push(i);
        for (let i = 2; i < lineLength; i += 2) slotOrder.push(i);
        if (slotOrder.length <= 0) return null;

        const slotIndex = slotOrder[waitingRank % slotOrder.length];
        const slotPos = queuePositions[slotIndex];
        if (!slotPos) return null;

        return { exitDirection, carriers, myIndex, frontCollectors, slotPos };
    },

    waitInRelayLine: function (creep: Creep): boolean {
        const context = this.getRelayQueueContext(creep);
        if (!context) return false;
        if (context.myIndex < context.frontCollectors) return false;

        if (!creep.pos.isEqualTo(context.slotPos)) {
            creep.moveTo(context.slotPos, {
                maxRooms: 1,
                range: 0,
                ignoreCreeps: false,
                plainCost: 2,
                swampCost: 10,
                reusePath: 3
            });
        }

        return true;
    },

    relayCarryToForward: function (creep: Creep): boolean {
        if (creep.store[RESOURCE_ENERGY] <= 0) return false;
        if (creep.pos.isRoomEdge()) return false;

        const exitDirection = this.getRelayExitDirection(creep);
        if (!exitDirection) return false;

        const selfProgress = this.getExitProgress(creep.pos, exitDirection);
        const teammates = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
            filter: (c: Creep) =>
                c.id !== creep.id &&
                !c.spawning &&
                !c.pos.isRoomEdge() &&
                (c.memory.role === 'out-carry' || c.memory.role === 'out-car') &&
                c.memory.homeRoom === creep.memory.homeRoom &&
                c.memory.targetRoom === creep.memory.targetRoom
        });
        if (teammates.length === 0) return false;

        const pickBestTarget = (pool: Creep[]): Creep | null => {
            let best: Creep | null = null;
            let bestProgress = -1;
            let bestFree = -1;
            for (const c of pool) {
                const progress = this.getExitProgress(c.pos, exitDirection);
                if (progress <= selfProgress) continue;
                const free = c.store.getFreeCapacity(RESOURCE_ENERGY);
                if (free <= 0) continue;
                if (!best ||
                    progress > bestProgress ||
                    (progress === bestProgress && free > bestFree) ||
                    (progress === bestProgress && free === bestFree && c.id < best.id)) {
                    best = c;
                    bestProgress = progress;
                    bestFree = free;
                }
            }
            return best;
        };

        let target = pickBestTarget(teammates.filter((c: Creep) =>
            c.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        ));
        if (!target) {
            target = pickBestTarget(teammates);
        }
        if (!target) return false;

        const ret = creep.transfer(target, RESOURCE_ENERGY);
        if (ret !== OK) return false;
        const homeDirection = this.getHomeDirection(exitDirection);
        this.markReceivedEnergy(target, homeDirection);
        // 被传递后同 tick 先锁住，避免被其他 moveTo 的对穿逻辑覆盖返程移动。
        target.memory.dontPullMe = true;
        creep.memory.dontPullMe = false;
        this.tryForceLineMove(target, homeDirection);

        const reverseDirection = this.getOppositeDirection(exitDirection);
        this.tryForceLineMove(creep, reverseDirection);
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
        const homeRoom = Game.rooms[creep.memory.homeRoom];
        const canStoreMinerals = !!(homeRoom?.storage || homeRoom?.terminal);

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
            if (other.memory.homeRoom !== creep.memory.homeRoom) continue;
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

    withdraw: function(creep: Creep) {
        creep.memory.cacheSource = creep.memory.cacheSource || {}
        const cache = creep.memory.cacheSource as any

        if (cache.waitUntil && Game.time < cache.waitUntil) {
            const relayContextOnWait = this.getRelayQueueContext(creep);
            if (!relayContextOnWait ||
                relayContextOnWait.carriers.length < 3 ||
                relayContextOnWait.myIndex < relayContextOnWait.frontCollectors) {
                const nearbyDrop = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
                    filter: (r: Resource) => r.amount > 0
                })[0];
                if (nearbyDrop) creep.pickup(nearbyDrop);
                return;
            }
        }
        delete cache.waitUntil;

        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            if (this.moveAlongRouteExit(creep, creep.memory.targetRoom)) return;
            creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
            return;
        }
        
        // 处理缓存的目标
        const relayContext = this.getRelayQueueContext(creep);
        if (relayContext && relayContext.carriers.length >= 3) {
            // 仅允许前排少量搬运冲前取货，其余固定在接力位，避免全体挤到采集点。
            if (relayContext.myIndex >= relayContext.frontCollectors) {
                delete cache.targetId;
                delete cache.targetType;

                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && this.relayCarryToForward(creep)) {
                    return;
                }

                const nearEnergy = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
                    filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount > 0
                })[0];
                if (nearEnergy) {
                    creep.pickup(nearEnergy);
                    return;
                }

                this.waitInRelayLine(creep);
                return;
            }
        }

        if (cache.targetId) {
            let target = Game.getObjectById(cache.targetId as Id<any>) as any;
            if (!target) {
                delete cache.targetId;
                delete cache.targetType;
                return;
            }

            if (!creep.pos.inRangeTo(target, 1)) {
                creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 })
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
                const canStoreMinerals = !!(Game.rooms[creep.memory.homeRoom]?.storage || Game.rooms[creep.memory.homeRoom]?.terminal);
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

        // 掉落阈值按自身容量动态调整：大于自身容量的掉落能量应允许拾取。
        const droppedPickupThreshold = Math.min(500, creep.store.getCapacity());
        if (creep.collectDroppedResource(undefined, droppedPickupThreshold)) {
            return;
        }

        // 使用 collectFromContainer 收集能量容器
        if (creep.collectFromContainer(300, RESOURCE_ENERGY, false)) {
            return;
        }
        
        // 使用 collectFromTombstone 收集墓碑资源
        if (creep.collectFromTombstone(undefined, 500)) {
            return;
        }

        // 使用 collectFromStorage 收集存储资源
        if (creep.collectFromStorage(RESOURCE_ENERGY, 0)) {
            return;
        }

        // 如果没有可以拿的资源，移动到最近的out-harvest身边，或者out-mineral身边
        // 优先miner
        // 资源暂时断流时先在道路上排成接力线，避免所有搬运同时堆在采集点。
        if (this.waitInRelayLine(creep)) {
            return;
        }

        const nearestMiner = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'out-mineral'
        });
        if (nearestMiner) {
            if(!creep.pos.inRangeTo(nearestMiner, 1) || nearestMiner.store.getUsedCapacity() > 0) {
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
            if (!creep.pos.inRangeTo(nearestHarvester, 2) ||
                nearestHarvester.store[RESOURCE_ENERGY] > 0) {
                creep.moveTo(nearestHarvester, {
                    ignoreCreeps: false,
                    range: 1,
                    maxRooms: 1,
                    plainCost: 2,
                    swampCost: 10
                })
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
            })
        }
    },
    
    carry: function(creep: any) {
        creep.memory.cacheTarget = creep.memory.cacheTarget || {}
        const cache = creep.memory.cacheTarget as any
        if (creep.room.name != creep.memory.homeRoom || creep.pos.isRoomEdge()) {
            if (creep.room.name != creep.memory.homeRoom && !creep.pos.isRoomEdge()) {
                if (this.relayCarryToForward(creep)) return;
                if (this.moveAlongRouteExit(creep, creep.memory.homeRoom)) return;
            }
            creep.moveToRoom(creep.memory.homeRoom, { plainCost: 2, swampCost: 10 });
            return;
        }

        let target: StructureContainer | StructureStorage;
    
        if (cache.targetId) {
            target = Game.getObjectById(cache.targetId) as StructureContainer | StructureStorage;
            if (target) {
                if (creep.pos.inRangeTo(target, 1)) {
                    if (target.store.getFreeCapacity(RESOURCE_ENERGY) > 200) {
                        creep.transfer(target, Object.keys(creep.store)[0]);
                    } else {
                        delete cache.targetId;
                    }
                } else {
                    creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10  });
                }
                return;
            }
            delete cache.targetId;
        }

        if(!target) {
            if (creep.room.terminal &&
                creep.room.terminal.store[RESOURCE_ENERGY] < 10000) {
                target = creep.room.terminal;
            }
        }

        if(!target) {
            const targets = [];
            if (creep.room.terminal &&
                creep.room.terminal.store.getFreeCapacity() > 50000) {
                targets.push(creep.room.terminal);
            }
            if (creep.room.storage &&
                creep.room.storage.store.getFreeCapacity() > 10000) {
                targets.push(creep.room.storage);
            }
            target = creep.pos.findClosestByRange(targets);
        }
    
        if (target) {
            cache.targetId = target.id;
            if (creep.pos.inRangeTo(target, 1)) {
                if (target.store.getFreeCapacity() > 0) {
                    creep.transfer(target, Object.keys(creep.store)[0]);
                } else {
                    delete cache.targetId;
                }
            } else {
                creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10  });
            }
        } else {
            const storage = creep.room.storage;
            const controller = creep.room.controller;
            if (storage) {
                if (creep.pos.inRangeTo(storage, 1)) {
                    creep.drop(Object.keys(creep.store)[0]);
                } else {
                    creep.moveTo(storage, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10  });
                }
            } else if (controller && controller.level < 8) {
                if (creep.pos.inRangeTo(controller, 1)) {
                    creep.drop(Object.keys(creep.store)[0]);
                } else {
                    creep.moveTo(controller, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10  });
                }
            } 
            else {
                const centerPos = creep.room.getCenter();
                if (centerPos && creep.pos.inRangeTo(centerPos, 1)) {
                    creep.drop(Object.keys(creep.store)[0]);
                } else {
                    creep.moveTo(centerPos, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10  });
                }
            }
        }
    },

    buildRepair: function(creep: Creep) {
        if(creep.room.name == creep.memory.homeRoom) return false;
        if(creep.memory.role !== 'out-car') return false;
        if(creep.store[RESOURCE_ENERGY] == 0) return false;

        // 使用 repairRoad 方法维修道路
        // 只维修范围1内的道路
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
            if(result == OK) return true;
            if(result == ERR_NOT_IN_RANGE) { creep.moveTo(road); return true; }
        }

        // 使用 buildRoad 方法建造道路
        if (creep.buildRoad()) {
            if (creep.pos.isRoomEdge()) {
                creep.moveToRoom(creep.room.name, { plainCost: 2, swampCost: 10 });
            }
            return true;
        }

        creep.memory.dontPullMe = false;
        return false;
    },
    run: function (creep: Creep) {
        creep.memory.cache = creep.memory.cache || {};
        creep.memory.cacheSource = creep.memory.cacheSource || {};
        creep.memory.cacheTarget = creep.memory.cacheTarget || {};
        delete creep.memory.working;

        const sourceCache = creep.memory.cacheSource as any;
        const forcedMoveDir = sourceCache.forcedMoveDirection as DirectionConstant | undefined;
        const forcedMoveUntil = Number(sourceCache.forcedMoveUntil || 0);
        const forcedMoveTick = Number(sourceCache.forcedMoveTick || 0);
        if (forcedMoveDir && forcedMoveUntil >= Game.time && !creep.pos.isRoomEdge()) {
            // 同 tick 可能被多段逻辑调用 move，最后一次会覆盖前面意图；
            // 把“被传能后返程/被让路推动”的移动锁定到 run 最前面，避免被后续逻辑改写。
            this.tryForceLineMove(creep, forcedMoveDir, false);
            creep.memory.dontPullMe = true;
            if (forcedMoveUntil <= Game.time) {
                delete sourceCache.forcedMoveDirection;
                delete sourceCache.forcedMoveTick;
                delete sourceCache.forcedMoveUntil;
            }
            return;
        } else if (forcedMoveTick > 0 && forcedMoveUntil < Game.time) {
            delete sourceCache.forcedMoveDirection;
            delete sourceCache.forcedMoveTick;
            delete sourceCache.forcedMoveUntil;
        }

        const used = creep.store.getUsedCapacity();
        const forcedReceivedTick = Number(sourceCache.receivedEnergyTick || 0);
        const retreatUntil = Number(sourceCache.receivedRetreatUntil || 0);
        const forcedDir = sourceCache.receivedMoveDirection as DirectionConstant | undefined;
        if (!forcedMoveDir && forcedReceivedTick === Game.time && forcedDir && used > 0 && creep.room.name !== creep.memory.homeRoom) {
            sourceCache.partialLeaveWait = 0;
            this.markForcedMove(creep, forcedDir, 1);
            this.tryForceLineMove(creep, forcedDir, false);
            creep.memory.dontPullMe = true;
            return;
        }

        if (this.buildRepair(creep)) {
            creep.memory.dontPullMe = false;
            return;
        }

        const free = creep.store.getFreeCapacity();
        const inTargetRoom = creep.room.name === creep.memory.targetRoom;
        const lowHealth = creep.hits < creep.hitsMax * 0.5;
        const receivedEnergyTick = Number(sourceCache.receivedEnergyTick || 0);
        const recentlyReceived = receivedEnergyTick >= Game.time - 1;
        const inRetreatWindow = retreatUntil >= Game.time || recentlyReceived;

        if (used === 0) {
            delete sourceCache.receivedEnergyTick;
            delete sourceCache.receivedMoveDirection;
            delete sourceCache.receivedRetreatUntil;
        }

        // 刚被接力到能量时，优先回程，不再继续向前找货。
        if (inRetreatWindow && used > 0 && creep.room.name !== creep.memory.homeRoom) {
            sourceCache.partialLeaveWait = 0;
            this.carry(creep);
            creep.memory.dontPullMe = false;
            return;
        }

        // 目标房内优先拿满：只要有空位就继续取货；连续若干 tick 无增量时才允许半仓回程。
        if (inTargetRoom && !lowHealth && free > 0) {
            const before = used;
            this.withdraw(creep);
            creep.memory.dontPullMe = false;

            const after = creep.store.getUsedCapacity();
            if (after > before) {
                sourceCache.partialLeaveWait = 0;
                return;
            }

            const wait = Number(sourceCache.partialLeaveWait || 0) + 1;
            sourceCache.partialLeaveWait = wait;

            // 空仓始终继续找货；半仓在短时等待后允许回程，避免房间瞬时断流时卡死。
            if (after === 0) return;
            if (wait < 18) return;

            delete sourceCache.partialLeaveWait;
            this.carry(creep);
            creep.memory.dontPullMe = false;
            return;
        }

        sourceCache.partialLeaveWait = 0;
        if (used === 0) {
            this.withdraw(creep);
            creep.memory.dontPullMe = false;
            return;
        }

        this.carry(creep);
        creep.memory.dontPullMe = false;
    }
}

export default outCarry;

