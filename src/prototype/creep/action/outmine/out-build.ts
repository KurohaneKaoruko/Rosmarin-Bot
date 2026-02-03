const outBuild = {
    harvest: function(creep) {
        creep.memory.cacheSource = creep.memory.cacheSource || {}
        const cache = creep.memory.cacheSource
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }

        if (cache.harvestTarget) {
            let target = Game.getObjectById(cache.harvestTarget) as any;
            if (target) {
                if (creep.pos.inRangeTo(target, 1)) {
                    creep.withdraw(target, RESOURCE_ENERGY);
                    if(!target || target.store.getUsedCapacity(RESOURCE_ENERGY) == 0) {
                        cache.harvestTarget = null;
                        return;
                    }
                    cache.harvestTarget = null;
                } else {
                    creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }
            else {
                cache.harvestTarget = null;
            }
        }
    
        // 查找容器
        let container = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType == STRUCTURE_CONTAINER && structure.store.getUsedCapacity() > structure.store.getCapacity() * 0.5;
            }
        });
        if (container.length == 0) {
            container = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType == STRUCTURE_CONTAINER && structure.store.getUsedCapacity() > 0;
                }
            });
        }
        if (container.length > 0) {
            container = creep.pos.findClosestByRange(container);
            cache.harvestTarget = container.id;
            if (creep.pos.inRangeTo(container, 1)) {
                creep.withdraw(container, RESOURCE_ENERGY);
            }
            else {
                creep.moveTo(container, { visualizePathStyle: { stroke: '#ffaa00' }})
            };
            return;
        } else {
            const source = creep.room.source?.[0];
            if (!source) return;
            if (!creep.pos.inRangeTo(source, 1)) {
                creep.moveTo(source, {range: 3});
            }
            else {
                creep.harvest(source);
            }
            return;
        }
    },
    build: function(creep) {
        creep.memory.cacheTarget = creep.memory.cacheTarget || {}
        const cache = creep.memory.cacheTarget
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }

        if (cache.targetId) {
            const target = Game.getObjectById(cache.targetId);
            if (target) {
                if (creep.pos.inRangeTo(target, 3)) {
                    creep.build(target);
                }
                else {
                    creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' }, maxRooms: 1});
                }
            }
            else {
                cache.targetId = null;
            }
            return;
        }
        
        const targetRoom = Game.rooms[creep.memory.targetRoom];
        const constructionSite = targetRoom.find(FIND_CONSTRUCTION_SITES, {
            filter: (site) => site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER
        });
        if (constructionSite.length > 0) {
            const target = creep.pos.findClosestByRange(constructionSite);
            cache.targetId = target.id;
            if (creep.pos.inRangeTo(target, 3)) {
                creep.build(target);
            }
            else {
                creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
            return;
        }
    },
    target: function(creep) {
        this.build(creep);
        if (creep.store.getUsedCapacity() == 0) {
            creep.say('🔄');
            return true;
        } else { return false; }
    },
    source: function(creep) {
        this.harvest(creep);
        if (creep.store.getFreeCapacity() == 0) {
            creep.say('🚧');
            return true;
        } else { return false; }
    }
}

export default outBuild;
