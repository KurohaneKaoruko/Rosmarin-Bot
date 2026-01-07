const outMineral = {
    source: function (creep: Creep) {        
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }

        let mineral = creep.room.mineral;
        if (!mineral) {
            creep.room.update('mineral');
            mineral = creep.room.mineral;
        }

        if (mineral) {
            if (creep.pos.isNearTo(mineral)) {
                creep.harvest(mineral);
            } else {
                if (mineral.pos.findInRange(FIND_HOSTILE_CREEPS, 3).length > 0) {
                    if (creep.pos.x <= 1) creep.move(RIGHT);
                    else if (creep.pos.x >= 48) creep.move(LEFT);
                    else if (creep.pos.y <= 1) creep.move(BOTTOM);
                    else if (creep.pos.y >= 48) creep.move(TOP);
                    return;
                }
                creep.moveTo(mineral, { maxRooms: 1 });
            }
        }

        return creep.store.getFreeCapacity() == 0;
    },

    transferToNearbyCarrier: function(creep) {
        const res = Object.keys(creep.store)[0];
        const nearbyCarrier = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
            filter: (c) => ((c.memory.role === 'out-carry' || c.memory.role === 'out-car') &&
                    c.store.getFreeCapacity(res) > 0)
        })[0];

        if (nearbyCarrier){
            if (creep.transfer(nearbyCarrier, res) === OK) return true;
        }

        return false;
    },

    handleNoContainer: function(creep: Creep) {
        let constructionSite = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
            filter: (site) => site.structureType === STRUCTURE_CONTAINER && site.my
        })[0];

        if (!constructionSite) {
            // 建造容器前确保在采集点附近
            const mineral = creep.room.mineral || creep.room.find(FIND_MINERALS)[0];
            if (!creep.pos.inRangeTo(mineral, 1)) {
                creep.moveTo(mineral, { visualizePathStyle: { stroke: '#ffaa00' } });
                return;
            }
            creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
        } else {
            const container = creep.pos.findInRange(FIND_STRUCTURES, 2, {
                filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
            })[0];
            if (container) {
                creep.moveTo(container, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
        }
    },

    handleWithContainer: function(creep, container) {
        // 向容器放入资源
        if (creep.pos.isEqualTo(container)) {
            const res = Object.keys(creep.store)[0];
            let result = creep.transfer(container, res);
            if (result == ERR_FULL) {
                // creep.drop(Object.keys(creep.store)[0] as ResourceConstant);
            }
        } else {
            creep.moveTo(container, { reusePath: 50, visualizePathStyle: { stroke: '#ffaa00' } });
        }
    },

    target: function (creep: Creep) {
        // 尝试将矿传递给附近的运输单位
        if (this.transferToNearbyCarrier(creep)) return creep.store.getUsedCapacity() == 0;
        
        // 查找附近的容器
        let targetContainer = creep.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
        })[0];
        
        if (!targetContainer) {
            // 没有容器时的处理
            this.handleNoContainer(creep);
        } else {
            // 有容器时的处理
            this.handleWithContainer(creep, targetContainer);
        }

        
        return creep.store.getUsedCapacity() == 0;
    }
}

export default outMineral