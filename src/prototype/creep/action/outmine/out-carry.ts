const relayExitCache: Record<string, { tick: number; exit: number | null }> = {};

const outCarry = {
    getRelayExitDirection: function (creep: Creep): number | null {
        const homeRoom = creep.memory.homeRoom;
        if (!homeRoom || creep.room.name === homeRoom) return null;

        const cacheKey = `${creep.room.name}->${homeRoom}`;
        const cached = relayExitCache[cacheKey];
        if (cached && cached.tick === Game.time) return cached.exit;

        let exit: number | null = null;
        const route = Game.map.findRoute(creep.room.name, homeRoom);
        if (Array.isArray(route) && route.length > 0) {
            exit = route[0].exit;
        }

        relayExitCache[cacheKey] = { tick: Game.time, exit };
        return exit;
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

    relayCarryToForward: function (creep: Creep): boolean {
        if (!creep.memory.aggressiveCarry) return false;
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
                c.memory.targetRoom === creep.memory.targetRoom &&
                c.memory.working === true &&
                c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        if (teammates.length === 0) return false;

        const candidates = teammates.filter((c: Creep) => this.getExitProgress(c.pos, exitDirection) > selfProgress);
        if (candidates.length === 0) return false;

        let target = candidates[0];
        let bestScore = this.getExitProgress(target.pos, exitDirection) * 100 + target.store.getFreeCapacity(RESOURCE_ENERGY);
        for (let i = 1; i < candidates.length; i++) {
            const c = candidates[i];
            const score = this.getExitProgress(c.pos, exitDirection) * 100 + c.store.getFreeCapacity(RESOURCE_ENERGY);
            if (score > bestScore) {
                bestScore = score;
                target = c;
            }
        }

        const ret = creep.transfer(target, RESOURCE_ENERGY);
        if (ret !== OK) return false;

        creep.moveToRoom(creep.memory.homeRoom, { plainCost: 2, swampCost: 10 });
        return true;
    },

    withdraw: function(creep: Creep) {
        creep.memory.cacheSource = creep.memory.cacheSource || {}
        const cache = creep.memory.cacheSource as any
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
            return;
        }
        
        // 处理缓存的目标
        if (cache.targetId) {
            let target = Game.getObjectById(cache.targetId) as any;
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
                const resourceType = Object.keys(target.store)[0] as ResourceConstant;
                creep.withdraw(target, resourceType);
            }

            if ((targetType === 'dropped' && target.amount === 0) || 
                ((targetType === 'container' || targetType === 'ruin' || targetType === 'tombstone') && target.store.getUsedCapacity() === 0)) {
                delete cache.targetId;
                delete cache.targetType;
                return;
            }

            delete cache.targetId;
            delete cache.targetType;
        }

        // 先找mineral旁边的container (特殊逻辑，保留原有行为)
        if (creep.room.mineral) {
            const containers = creep.room.container?.filter((container: StructureContainer) =>
                container && container.store.getUsedCapacity() >= 300 &&
                container.pos.inRangeTo(creep.room.mineral, 2) &&
                Object.values(Memory.creeps).every((m) => 
                    (m.role != 'out-carry' && m.role != 'out-car') || (m.cacheSource?.targetId || m.cacheTarget?.targetId || m.cache?.targetId) !== container.id)
            );
            if (containers && containers.length > 0) {
                const container = creep.pos.findClosestByRange(containers);
                if (container) {
                    cache.targetId = container.id;
                    cache.targetType = 'container';
                    creep.moveTo(container, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 });
                    return;
                }
            }
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

    source: function(creep: Creep) {
        if (creep.store.getFreeCapacity() === 0) {
            return true;
        }

        if (creep.hits < creep.hitsMax * 0.5 &&
            creep.store.getUsedCapacity() > 0) return true;
        this.withdraw(creep);
        creep.memory.dontPullMe = false;
        return false;
    },

    target: function(creep: Creep) {
        if (creep.store.getUsedCapacity() === 0) {
            return true;
        }

        if (this.buildRepair(creep)) return;
        this.carry(creep);
        creep.memory.dontPullMe = false;
        return false;
    },
}

export default outCarry;
