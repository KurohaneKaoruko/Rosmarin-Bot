

const outCarry = {
    withdraw: function(creep: Creep) {
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
            return;
        }
        
        if (creep.memory.cache.targetId) {
            let target = Game.getObjectById(creep.memory.cache.targetId) as any;
            if (!target) {
                delete creep.memory.cache.targetId;
                delete creep.memory.cache.targetType;
                return;
            }

            if (!creep.pos.inRangeTo(target, 1)) {
                creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 })
                return;
            }

            const targetType = creep.memory.cache.targetType;
            if (targetType === 'dropped') {
                creep.pickup(target);
            } else if (targetType === 'container' || targetType === 'ruin' || targetType === 'tombstone') {
                const resourceType = Object.keys(target.store)[0] as ResourceConstant;
                creep.withdraw(target, resourceType);
            }

            if ((targetType === 'dropped' && target.amount === 0) || 
                ((targetType === 'container' || targetType === 'ruin' || targetType === 'tombstone') && target.store.getUsedCapacity() === 0)) {
                delete creep.memory.cache.targetId;
                delete creep.memory.cache.targetType;
                return;
            }

            delete creep.memory.cache.targetId;
            delete creep.memory.cache.targetType;
        }

        let container: StructureContainer;
        const containers = creep.room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                    s.store.getUsedCapacity() >= 300 &&
                    Object.values(Memory.creeps).every((m) => 
                        (m.role != 'out-carry' && m.role != 'out-car') ||  m.cache?.targetId !== s.id)
        }) as StructureContainer[];
        // 先找mineral旁边的container
        if (creep.room.mineral) {
            const mineralContainer = containers.find((container) =>
                container.pos.inRangeTo(creep.room.mineral, 2));
            if (mineralContainer) {
                container = mineralContainer;
                creep.memory.cache.targetId = container.id;
                creep.memory.cache.targetType = 'container';
                creep.moveTo(container, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 })
                return;
            }
        }
        // 再找能量container
        container = creep.pos.findClosestByRange(containers||[]);
        if (container) {
            creep.memory.cache.targetId = container.id;
            creep.memory.cache.targetType = 'container';
            creep.moveTo(container, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 })
            return;
        }

        // 再找掉落资源
        const droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, 
            {filter: (resource) => resource.amount > 500});
        if (droppedResources && droppedResources.length > 0) {
            const droppedResource = droppedResources.reduce((a, b) => {
                if (a.resourceType !== RESOURCE_ENERGY && b.resourceType === RESOURCE_ENERGY) return a;
                if (b.resourceType !== RESOURCE_ENERGY && a.resourceType === RESOURCE_ENERGY) return b;
                return a.amount < b.amount ? b : a
            });
            creep.memory.cache.targetId = droppedResource.id;
            creep.memory.cache.targetType = 'dropped';
            creep.moveTo(droppedResource, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 })
            return;
        }
        
        // 最后查找墓碑，优先级最低
        const tombstones = creep.room.find(FIND_TOMBSTONES, {
            filter: (tombstone) => tombstone.store.getUsedCapacity() > 0
        });
        if (tombstones.length > 0) {
            const target = creep.pos.findClosestByRange(tombstones);
            creep.memory.cache.targetId = target.id;
            creep.memory.cache.targetType = 'tombstone';
            creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 })
            return;
        }

        // 检查有没有这两种建筑
        if (creep.room.storage || creep.room.terminal) {
            const storage = creep.room.storage || creep.room.terminal;
            if (storage.store[RESOURCE_ENERGY] > 0) {
                creep.memory.cache.targetId = storage.id;
                creep.memory.cache.targetType = 'container';
                creep.moveTo(storage, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10 })
                return;
            }
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
        if (creep.room.name != creep.memory.homeRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.homeRoom, { plainCost: 2, swampCost: 10 });
            return;
        }

        let target: StructureContainer | StructureStorage;
    
        if (creep.memory.cache.targetId) {
            target = Game.getObjectById(creep.memory.cache.targetId) as StructureContainer | StructureStorage;
            if (target) {
                if (creep.pos.inRangeTo(target, 1)) {
                    if (target.store.getFreeCapacity(RESOURCE_ENERGY) > 200) {
                        creep.transfer(target, Object.keys(creep.store)[0]);
                    } else {
                        delete creep.memory.cache.targetId;
                    }
                } else {
                    creep.moveTo(target, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10  });
                }
                return;
            }
            delete creep.memory.cache.targetId;
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
            creep.memory.cache.targetId = target.id;
            if (creep.pos.inRangeTo(target, 1)) {
                if (target.store.getFreeCapacity() > 0) {
                    creep.transfer(target, Object.keys(creep.store)[0]);
                } else {
                    delete creep.memory.cache.targetId;
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
                const center = Memory['RoomControlData'][creep.room.name]?.center;
                const centerPos = new RoomPosition(center.x, center.y, creep.room.name);
                if (centerPos && creep.pos.inRangeTo(centerPos, 1)) {
                    creep.drop(Object.keys(creep.store)[0]);
                } else {
                    creep.moveTo(centerPos, { maxRooms: 1, range: 1, plainCost: 2, swampCost: 10  });
                }
            }
        }
    },

    buildRepair: function(creep) {
        if(creep.room.name == creep.memory.homeRoom) return false;
        if(creep.memory.role !== 'out-car') return false;
        if(creep.store[RESOURCE_ENERGY] == 0) return false;
        const roads = creep.room.road.filter((r: any) => {
            if (!r || r.hits >= r.hitsMax * 0.8) return false;
            if (!creep.pos.inRangeTo(r.pos, 1)) return false;
            return true;
        });
        if (roads.length > 0) {
            const road = creep.pos.findClosestByRange(roads);
            const result = creep.repair(road)
            if (creep.pos.isRoomEdge()) {
                creep.moveToRoom(creep.room.name, { plainCost: 2, swampCost: 10 });
            }
            if(result == OK) return true;
            if(result == ERR_NOT_IN_RANGE) { creep.moveTo(road); return true; }
        }
        const roadSite = creep.room.find(FIND_MY_CONSTRUCTION_SITES)
        if (roadSite.length > 0) {
            const site = creep.pos.findClosestByRange(roadSite);
            const result = creep.build(site)
            if (creep.pos.isRoomEdge()) {
                creep.moveToRoom(creep.room.name, { plainCost: 2, swampCost: 10 });
            }
            if(result == OK) return true;
            if(result == ERR_NOT_IN_RANGE) { creep.moveTo(site); return true; }
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