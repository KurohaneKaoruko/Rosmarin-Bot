const GetContainer = {
    link: function (creep: Creep) {
        // 查找未满的 link
        if (creep.room.level < 5) return null;
        if (!creep.room.link) return null; // 如果没有 link，则返回 null
        const source = Game.getObjectById(creep.memory.targetSourceId) as Source;
        const link = creep.room.link.find(l => l.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && source?.pos.inRangeTo(l, 2));
        return link ?? null;
    },
    container: function (creep: Creep) {
        // 查找未满的container
        if (!creep.room.container) return null;
        const source = Game.getObjectById(creep.memory.targetSourceId) as Source;
        const container = creep.room.container.find(c => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && source?.pos.inRangeTo(c, 2));
        return container ?? null;
    }
}

const HarvesterAction = {
    run: function (creep: Creep) {
        if (!creep.moveHomeRoom()) return;

        if (!creep.memory.ready) {
            creep.memory.ready = this.prepare(creep);
            return;
        }

        switch (creep.memory.action) {
            case 'harvest':
                this.harvest(creep)
                return;
            case 'transfer':
                this.transfer(creep)
                return;
            case 'build':
                this.build(creep)
                return;
            default:
                this.switch(creep);
                return;
        }
    },
    prepare: function (creep: Creep) {
        if (!creep.room.source ||
            creep.room.source.length == 0) return false;
        let targetSource = creep.room.closestSource(creep);
        if (!targetSource) return false;
        creep.memory.targetSourceId = targetSource.id;
        return true;
    },
    harvest: function (creep: Creep) {
        if (creep.store.getFreeCapacity() === 0) {
            this.switch(creep);
            return;
        }
        const targetSource = Game.getObjectById(creep.memory.targetSourceId) as Source;
        if (!targetSource) {
            creep.memory.ready = false;
            return;
        }
        if (targetSource.energy === 0) {
            this.switch(creep);
            return;
        }

        const sourceContainer = creep.room.container.find(c => c.pos.inRangeTo(targetSource, 1));
        if (sourceContainer && !creep.pos.isEqualTo(sourceContainer)) {
            if (creep.moveTo(sourceContainer)===OK) return;
        }
        let result = creep.goHaverst(targetSource);
        if (!result) return;
        if (creep.store.getCapacity() == 0) return;

        let energy = 0;
        for (const part of creep.body) {
            if (part.type !== WORK) continue;
            if (part.hits === 0) continue;
            if (!part.boost) energy += 2;
            else energy += 2 * (BOOSTS.work[part.boost]['harvest'] || 1);
        }
        if (creep.store.getFreeCapacity() <= energy) {
            this.switch(creep);
        }
    },
    transfer: function (creep: Creep) {
        const target = GetContainer['link'](creep) || GetContainer['container'](creep);
        if (!target) {
            creep.drop(RESOURCE_ENERGY);
            this.switch(creep);
            return;
        }
        let result = creep.goTransfer(target, RESOURCE_ENERGY);
        if (!result) return;
        this.switch(creep);
    },
    build: function (creep: Creep) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            this.switch(creep);
            return;
        }

        const constructionSites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        });
        const constructionSite = creep.pos.findClosestByRange(constructionSites);
        if (constructionSite) {
            creep.build(constructionSite);
            return;
        }

        // 如果容器已存在，则不创建
        const containers = creep.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        });
        const container = creep.pos.findClosestByRange(containers);
        if (container) {
            this.switch(creep);
            return;
        }

        // 如果link存在，则不建造
        const links = creep.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_LINK
        })
        const link = creep.pos.findClosestByRange(links);
        if (link) {
            this.switch(creep);
            return;
        }

        // 如果能量源不存在，或是不在能量源附近，则移动
        const tsid = creep.memory.targetSourceId;
        const targetSource = Game.getObjectById(tsid) as Source;
        if (!targetSource || !creep.pos.inRangeTo(targetSource, 1)) {
            creep.moveTo(targetSource);
            return false;
        }

        let result = creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
        if (result !== OK) creep.drop(RESOURCE_ENERGY);

        this.switch(creep);
        return;
    },
    switch: function (creep: Creep) {
        creep.memory.action = '';
        if (creep.store[RESOURCE_ENERGY] > 0) {
            const link = creep.room.link.find(l => l.pos.inRangeTo(creep.pos, 2));
            const container = creep.room.container.find(c => c.pos.inRangeTo(creep.pos, 2));
            if (!link && !container) {
                creep.memory.action = 'build';
            } else {
                creep.memory.action = 'transfer';
            }
            return;
        } else {
            const source = Game.getObjectById(creep.memory.targetSourceId) as Source;
            if (!source) {
                creep.memory.ready = false;
            } else if (source.energy === 0 && creep.pos.isNearTo(source)) {
                if(!creep.room.container || !creep.room.link) return;
                const container = creep.room.container.find(c =>
                    c.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && creep.pos.inRangeTo(c, 1));
                const link = GetContainer['link'](creep);
                if (!container || !link) return;
                creep.goWithdraw(container, RESOURCE_ENERGY);
            } else {
                creep.memory.action = 'harvest';
            }
            return;
        }
    }
}

export default HarvesterAction;
