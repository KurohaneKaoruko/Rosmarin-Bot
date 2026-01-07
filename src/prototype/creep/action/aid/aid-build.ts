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

        let dropEnergy = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES,
            { filter: r => r.resourceType == RESOURCE_ENERGY || r.amount >= 500});
        if (dropEnergy) {
            creep.goPickup(dropEnergy);
            if (dropEnergy.amount >= creep.store.getFreeCapacity()) {
                creep.memory.action = '';
            }
            return;
        }

        let containers = creep.room.container.filter(c => c.store[RESOURCE_ENERGY] > 0) || [];
        let container = creep.pos.findClosestByRange(containers);
        if (container) {
            creep.goWithdraw(container, RESOURCE_ENERGY);
            if (container.store[RESOURCE_ENERGY] >= creep.store.getFreeCapacity()) {
                creep.memory.action = '';
            }
            return;
        }

        let storage = creep.room.storage;
        if (storage && storage.store[RESOURCE_ENERGY] > 0) {
            creep.goWithdraw(storage, RESOURCE_ENERGY);
            if (storage.store[RESOURCE_ENERGY] >= creep.store.getFreeCapacity()) {
                creep.memory.action = '';
            }
            return;
        }

        let terminal = creep.room.terminal;
        if (terminal && terminal.store[RESOURCE_ENERGY] > 0) {
            creep.goWithdraw(terminal, RESOURCE_ENERGY);
            if (terminal.store[RESOURCE_ENERGY] >= creep.store.getFreeCapacity()) {
                creep.memory.action = '';
            }
            return;
        }

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

        const site = creep.room.find(FIND_CONSTRUCTION_SITES);
        if (site.length === 0) {
            creep.memory.action = '';
            return;
        }

        let targetSite = creep.pos.findClosestByRange(site, {
            filter: (s) => s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_SPAWN ||
            s.structureType == STRUCTURE_STORAGE || s.structureType == STRUCTURE_TERMINAL
        });

        if (!targetSite) {
            targetSite = creep.pos.findClosestByRange(site, {
                filter: (s) => s.structureType == STRUCTURE_EXTENSION || s.structureType == STRUCTURE_TOWER
            });
        }

        if (!targetSite) {
            targetSite = creep.pos.findClosestByRange(site);
        }

        if (!targetSite) return;
        creep.goBuild(targetSite);
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

        const repair = creep.room.find(FIND_STRUCTURES, {filter: (s) => s.hits < s.hitsMax * 0.8})
        if (repair.length === 0) {
            creep.memory.action = '';
        }

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

        creep.memory.action = '';
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