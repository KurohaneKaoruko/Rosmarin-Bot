const aid_build = {
    run: function (creep: Creep) {
        if (!creep.memory.ready) {
            creep.memory.ready = this.prepare(creep);
            return;
        }

        switch (creep.memory.action) {
            case 'harvest':
                this.harvest(creep);
                return;
            case 'build':
                this.build(creep);
                return;
            case 'repair':
                this.repair(creep);
                return;
            case 'upgrade':
                this.upgrade(creep);
            default:
                this.switch(creep);
                return;
        }
    },

    prepare: function (creep: Creep) {
        if (creep.memory['boostmap']) {
            return creep.Boost(creep.memory['boostmap']);
        } else {
            return creep.goBoost(['XLH2O', 'LH2O', 'LH']);
        }
        
    },

    harvest: function (creep: Creep) {
        const sourceRoom = creep.memory.sourceRoom || creep.memory.targetRoom;
        if (sourceRoom && creep.room.name != creep.memory.sourceRoom) {
            creep.moveToRoom(creep.memory.sourceRoom);
            return;
        }

        if (creep.store.getFreeCapacity() === 0) {
            creep.memory.action = '';
            return;
        }

        // 使用 smartCollect 方法收集资源
        // 优先级: 掉落资源 > 墓碑 > 废墟 > 容器 > 存储
        if (creep.smartCollect(RESOURCE_ENERGY, {
            includeDropped: true,
            includeTombstone: true,
            includeRuin: true,
            includeContainer: true,
            includeStorage: true,
            minDroppedAmount: 50,
            minContainerAmount: 0
        })) {
            // 检查是否收集完成
            const freeCapacity = creep.store.getFreeCapacity();
            if (freeCapacity === 0) {
                creep.memory.action = '';
            }
            return;
        }

        // 如果没有找到资源，尝试从 source 采集
        if (!creep.room.source) {
            if (Game.time % 10 !== 0) return;
            creep.room.update();
        }

        if (!creep.room.source) return;

        const targetSource = creep.room.source.find(s => s.energy > 0);
        if (!targetSource && creep.store[RESOURCE_ENERGY] > 0) {
            creep.memory.action = '';
            return;
        }

        let result = creep.goHaverst(targetSource);
        if (!result) return;
        let energy = 0;
        for (const part of creep.body) {
            if (part.type !== WORK) continue;
            if (part.hits === 0) continue;
            if (!part.boost) energy += 2;
            else energy += 2 * (BOOSTS.work[part.boost]['harvest'] || 1);
        }
        if (creep.store.getFreeCapacity() > energy) return;
        creep.memory.action = '';
    },

    build: function (creep: Creep) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = '';
            return;
        }

        const targetRoom = creep.memory.targetRoom;
        if (targetRoom && creep.room.name != creep.memory.targetRoom && creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }

        if (creep.pos.isRoomEdge()) {
            creep.moveTo(creep.room.controller);
            return;
        }

        // 使用 findAndBuild 方法查找并建造
        // 优先级: road > spawn > storage > terminal > extension > tower
        if (!creep.findAndBuild({
            priority: [
                STRUCTURE_ROAD,
                STRUCTURE_SPAWN,
                STRUCTURE_STORAGE,
                STRUCTURE_TERMINAL,
                STRUCTURE_EXTENSION,
                STRUCTURE_TOWER
            ]
        })) {
            creep.memory.action = '';
        }
    },

    repair: function (creep: Creep) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = '';
            return;
        }

        const targetRoom = creep.memory.targetRoom;
        if (targetRoom && creep.room.name != creep.memory.targetRoom) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }

        if (creep.pos.isRoomEdge()) {
            creep.moveTo(creep.room.controller);
            return;
        }

        // 如果有缓存的维修目标，继续维修
        if (creep.memory.cache?.repairTarget) {
            const repairTarget = Game.getObjectById(creep.memory.cache.repairTarget as Id<Structure>)
            if (repairTarget) {
                if (repairTarget.hits === repairTarget.hitsMax) {
                    creep.memory.cache.repairTarget = '';
                    creep.memory.action = '';
                    return;
                }
                creep.goRepair(repairTarget);
                return;
            }
        }

        // 使用 findAndRepair 方法查找并维修
        if (!creep.findAndRepair({
            maxHitsRatio: 0.8
        })) {
            creep.memory.action = '';
        }
    },

    upgrade: function (creep: Creep) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = '';
            return;
        }

        const contoroller = creep.room.controller;
        if (creep.room.level < 8) {
            if (creep.upgradeController(contoroller) == ERR_NOT_IN_RANGE) {
                creep.moveTo(contoroller, { maxRooms: 1 });
            }
            return;
        }
    },

    switch: function (creep: Creep) {
        creep.memory.cache = {};
        
        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = 'harvest';
            return;
        }

        const targetRoom = creep.memory.targetRoom;
        if (targetRoom && creep.room.name != creep.memory.targetRoom) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }


        const site = creep.room.find(FIND_CONSTRUCTION_SITES);
        if (site.length > 0) {
            creep.memory.action = 'build';
            return;
        }

        const repair = creep.room.find(FIND_STRUCTURES, {
            filter: (s) => s.hits < s.hitsMax * 0.8 &&
                s.structureType != STRUCTURE_ROAD &&
                s.structureType != STRUCTURE_CONTAINER
        })
        if (repair.length > 0) {
            creep.memory.action = 'repair';
            const repairTarget = repair.reduce((a, b) => a.hits < b.hits ? a : b);
            creep.memory.cache.repairTarget = repairTarget.id;
            return;
        }

        creep.memory.action = 'upgrade';
    }
}
export default aid_build;