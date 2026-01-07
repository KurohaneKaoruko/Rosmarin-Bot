import { compress } from '@/utils';

const createSite = function(creep: any) {
    if (Game.rooms[creep.memory.homeRoom].controller.level < 4) return;

    if (!creep.room.my && creep.fatigue > 0 &&
        !(creep.room.memory.road?.includes(compress(creep.pos.x, creep.pos.y)))
    ) {
        // creep.room.memory.road?.push(compress(creep.pos.x, creep.pos.y));
        creep.room.createConstructionSite(creep.pos, STRUCTURE_ROAD);
    }


    if (creep.room.name !== creep.memory.targetRoom) return;
    if (!creep.pos.isRoomEdge()) return;
    if (creep.room.memory.road && creep.room.memory.road.length > 0) return;
    creep.room.memory.road = [];
    const Path = [];
    const pos = [];
    const sourcePos = creep.room.find(FIND_SOURCES);
    for (const source of sourcePos) {
        pos.push(source.pos);
    }
    const isCenterRoom = /^[EW]\d*[456][NS]\d*[456]$/.test(creep.room.name);
    if (isCenterRoom) {
        const mineralPos = creep.room.find(FIND_MINERALS)[0];
        if (mineralPos) pos.push(mineralPos.pos);
    }
    const closestPos = creep.pos.findClosestByRange(pos);

    const costs = new PathFinder.CostMatrix();
    const terrain = new Room.Terrain(creep.room.name);
    for (let i = 0; i < 50; i++) {
        for (let j = 0; j < 50; j++) {
            const te = terrain.get(i, j);
            costs.set(i, j, te == TERRAIN_MASK_WALL ? 255 : te == TERRAIN_MASK_SWAMP ? 4 : 2);
        }
    }

    PathFinder.search(
        creep.pos,
        { pos: closestPos, range: 1 },
        {
            roomCallback: () => {
                return costs;
            },
            maxRooms: 1
        }
    ).path.forEach(pos => {
        costs.set(pos.x,pos.y,1);
        Path.push(pos)
    })

    for (let i = 0; i < pos.length; i++) {
        for (let j = i+1; j < pos.length; j++) {
            PathFinder.search(
                pos[i],
                { pos: pos[j], range: 1 },
                {
                    roomCallback: () => {
                        return costs;
                    },
                    maxRooms: 1
                }
            ).path.forEach(pos => {
                costs.set(pos.x,pos.y,1);
                Path.push(pos)
            })
        }
    }

    for (const p of Path) {
        const xy = compress(p.x, p.y);
        if (creep.room.memory.road.includes(xy)) continue;
        creep.room.memory.road.push(xy);
    }
}

const outHarvest = {
    target: function(creep: Creep) {
        if (creep.store.getUsedCapacity() == 0) return true;

        // 尝试将能量传递给附近的运输单位
        if (this.transferToNearbyCarrier(creep)) return;

        let targetContainer

        let targetSource = Game.getObjectById(creep.memory.targetSourceId) as Source;
        if(!targetSource) {
            // 查找附近的容器
            targetContainer = creep.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
            })[0];
        } else {
            // 查找附近的容器
            targetContainer = targetSource.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
            })[0];
        }

        if (!targetContainer) {
            // 没有容器时的处理
            this.handleNoContainer(creep);
        } else {
            // 有容器时的处理
            this.handleWithContainer(creep, targetContainer);
        }

        return creep.store.getUsedCapacity() == 0;
    },

    handleNoContainer: function(creep: Creep) {
        // 建造容器前确保在采集点附近
        const source = Game.getObjectById(creep.memory.targetSourceId) as Source;
        if (!creep.pos.inRangeTo(source, 1)) {
            creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
            return;
        }

        // 建造容器
        this.buildContainer(creep);
    },

    handleWithContainer: function(creep, container) {
        // 修理容器
        if (container.hits < container.hitsMax * 0.8) {
            this.repairContainer(creep, container);
            return;
        }

        // 向容器传输能量
        if (creep.pos.isEqualTo(container)) {
            let result = creep.transfer(container, RESOURCE_ENERGY);
            if (result == ERR_FULL) {
                this.handleFullContainer(creep, container);
            }
        } else {
            creep.moveTo(container, { reusePath: 50, visualizePathStyle: { stroke: '#ffaa00' } });
        }
    },

    // 尝试将能量传递给附近的运输单位
    transferToNearbyCarrier: function(creep) {
        const nearbyCarrier = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
            filter: (c) => ((c.memory.role === 'out-carry' || c.memory.role === 'out-car') &&
                    c.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
        })[0];

        if (!nearbyCarrier) return false;

        if (creep.transfer(nearbyCarrier, RESOURCE_ENERGY) === OK) return true;

        return false;
    },

    // 建造容器
    buildContainer: function(creep) {
        let constructionSite = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
            filter: (site) => site.structureType === STRUCTURE_CONTAINER && site.my
        })[0];

        if (!constructionSite) {
            let result = creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
            if (result !== OK) {
                creep.drop(RESOURCE_ENERGY);
                return;
            }
        } else if (creep.pos.inRangeTo(constructionSite, 2)) {
            creep.build(constructionSite);
        } else {
            creep.moveTo(constructionSite, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
    },

    // 修理容器
    repairContainer: function(creep, container) {
        if (creep.pos.inRangeTo(container, 3)) {
            if (creep.repair(container) == ERR_NOT_IN_RANGE) {
                creep.moveTo(container, { reusePath: 50, visualizePathStyle: { stroke: '#ffaa00' } });
            }
        } else {
            creep.moveTo(container);
        }
    },

    // 满载时的处理
    handleFullContainer: function(creep, container) {
        if (container.hits < container.hitsMax) {
            creep.repair(container);
        } else {
            if (!this.transferToNearbyCarrier(creep)) {
                creep.drop(RESOURCE_ENERGY);
            }
        }
    },

    source: function(creep: Creep) {
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
            return;
        }

        // 如果还没有绑定采集点，则绑定一个
        if (!creep.memory.targetSourceId) {
            // 从绑定数量最少的采集点中寻找离Creep最近的
            let closestSource = creep.room.closestSource(creep);
            if (closestSource) {
                creep.memory.targetSourceId = closestSource.id;
            }
            else {
                creep.say('No source');
                return;
            }
        }

        let targetSource = Game.getObjectById(creep.memory.targetSourceId) as Source;
        if(!targetSource) {
            return;
        }

        // 如果离采集点过远，则移动过去
        if (creep.pos.isNear(targetSource.pos)) {
            if (targetSource.energy == 0) return;
            creep.harvest(targetSource);
        } else {
            if(targetSource.pos.findInRange(FIND_HOSTILE_CREEPS, 3).length > 0) return;
            creep.moveTo(targetSource, {range: 1, maxRooms: 1, plainCost: 2, swampCost: 10});
        }

        // let container = creep.room.container.find((c) => c.pos.isNearTo(targetSource.pos));
        // if (container && !creep.pos.isEqualTo(container)) {
        //     creep.moveTo(container, { maxRooms: 1, plainCost: 2, swampCost: 10});
        //     return;
        // }

        if (creep.store.getCapacity() == 0) return false;
        return creep.store.getFreeCapacity() == 0;
    }
}

export default outHarvest;
