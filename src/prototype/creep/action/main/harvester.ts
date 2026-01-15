const NEAR_RANGE = 2;
const SOURCE_RANGE = 1;
const STAY_BUILD_RANGE = 3;

type ActionName = 'harvest' | 'transfer' | 'build' | '';

/**
 * 查找适合投递的 Link
 * @description 要求房间 RCL>=5，Link 在 source 附近且未满
 */
function findTransferLink(creep: Creep, source: Source): StructureLink | null {
    if (creep.room.level < 5) return null;
    const links = creep.room.link;
    if (!links) return null;
    return links.find(l => l.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && source.pos.inRangeTo(l, NEAR_RANGE)) ?? null;
}

/**
 * 查找适合投递的 Container
 * @description 要求 Container 在 source 附近且未满
 */
function findTransferContainer(creep: Creep, source: Source): StructureContainer | null {
    const containers = creep.room.container;
    if (!containers) return null;
    return containers.find(c => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && source.pos.inRangeTo(c, NEAR_RANGE)) ?? null;
}

/**
 * 查找 Creep 附近的任意 Link
 * @description 用于状态切换判断，不检查容量
 */
function findAnyNearbyLink(creep: Creep): StructureLink | null {
    const links = creep.room.link;
    if (!links) return null;
    return links.find(l => l.pos.inRangeTo(creep.pos, NEAR_RANGE)) ?? null;
}

/**
 * 查找 Creep 附近的任意 Container
 * @description 用于状态切换判断，不检查容量
 */
function findAnyNearbyContainer(creep: Creep): StructureContainer | null {
    const containers = creep.room.container;
    if (!containers) return null;
    return containers.find(c => c.pos.inRangeTo(creep.pos, NEAR_RANGE)) ?? null;
}

/**
 * 原地尝试建造附近的工地
 * @description 如果身上有能量且周围有工地，则进行建造；不产生移动
 * @returns 是否进行了建造
 */
function stayAndBuildNearby(creep: Creep): boolean {
    if (creep.store[RESOURCE_ENERGY] === 0) return false;
    const constructionSites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, STAY_BUILD_RANGE);
    const target = creep.pos.findClosestByRange(constructionSites);
    if (!target) return false;
    creep.build(target);
    return true;
}

const HarvesterAction = {
    /**
     * Harvester 主运行逻辑
     */
    run: function (creep: Creep) {
        if (!creep.moveHomeRoom()) return;

        if (!creep.memory.ready) {
            creep.memory.ready = this.prepare(creep);
            return;
        }

        const action = (creep.memory.action || '') as ActionName;
        switch (action) {
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
                this.chooseNextAction(creep);
                return;
        }
    },
    /**
     * 准备阶段：绑定 Source
     */
    prepare: function (creep: Creep) {
        if (!creep.room.source || creep.room.source.length === 0) return false;
        const targetSource = creep.room.closestSource(creep);
        if (!targetSource) return false;
        creep.setBoundSourceId(targetSource.id);
        return true;
    },
    /**
     * 采集阶段
     * @description 采集能量，自动对齐到 Container，满载前预判切换
     */
    harvest: function (creep: Creep) {
        if (creep.store.getFreeCapacity() === 0) {
            this.chooseNextAction(creep);
            return;
        }
        const targetSource = creep.getBoundSource();
        if (!targetSource) {
            creep.memory.ready = false;
            return;
        }
        if (targetSource.energy === 0) {
            this.chooseNextAction(creep);
            return;
        }

        if (!creep.sitOnSourceContainer()) return;

        const result = creep.goHaverst(targetSource);
        if (!result) return;
        if (creep.store.getCapacity() === 0) return;

        const energyIncome = creep.calculateHarvestIncomePerTick();
        if (creep.store.getFreeCapacity() <= energyIncome) {
            this.chooseNextAction(creep);
        }
    },
    /**
     * 转移阶段
     * @description 将能量转移到 Link 或 Container，若无处可放则原地建造或丢弃
     */
    transfer: function (creep: Creep) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            this.chooseNextAction(creep);
            return;
        }
        const source = creep.getBoundSource();
        if (!source) {
            creep.memory.ready = false;
            return;
        }
        const target = findTransferLink(creep, source) || findTransferContainer(creep, source);
        if (!target) {
            if (stayAndBuildNearby(creep)) return;
            creep.drop(RESOURCE_ENERGY);
            this.chooseNextAction(creep);
            return;
        }
        const result = creep.goTransfer(target, RESOURCE_ENERGY);
        if (!result) return;
        this.chooseNextAction(creep);
    },
    /**
     * 建造容器阶段
     * @description 当 Source 旁没有 Container/Link 时，负责维护和建造 Container
     */
    build: function (creep: Creep) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            this.chooseNextAction(creep);
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

        // 如果容器已存在，则不建造
        const containers = creep.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        });
        const container = creep.pos.findClosestByRange(containers);
        if (container) {
            this.chooseNextAction(creep);
            return;
        }

        // 如果link存在，则不建造
        const links = creep.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_LINK
        })
        const link = creep.pos.findClosestByRange(links);
        if (link) {
            this.chooseNextAction(creep);
            return;
        }

        const targetSource = creep.getBoundSource();
        if (!targetSource) {
            creep.memory.ready = false;
            return;
        }
        if (!creep.pos.inRangeTo(targetSource, SOURCE_RANGE)) {
            creep.moveTo(targetSource);
            return;
        }

        const result = creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
        if (result !== OK) creep.drop(RESOURCE_ENERGY);

        this.chooseNextAction(creep);
    },
    /**
     * 决策下一动作
     * @description 根据能量和周边设施状态，在 harvest/transfer/build 间切换
     */
    chooseNextAction: function (creep: Creep) {
        creep.memory.action = '' as ActionName;
        if (creep.store[RESOURCE_ENERGY] > 0) {
            const link = findAnyNearbyLink(creep);
            const container = findAnyNearbyContainer(creep);
            if (!link && !container) {
                creep.memory.action = 'build';
            } else {
                creep.memory.action = 'transfer';
            }
            return;
        } else {
            const source = creep.getBoundSource();
            if (!source) {
                creep.memory.ready = false;
                return;
            }

            if (source.energy === 0 && creep.pos.isNearTo(source)) {
                if (!creep.room.container || !creep.room.link) return;
                const container = creep.room.container.find(c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && creep.pos.inRangeTo(c, SOURCE_RANGE));
                const link = findTransferLink(creep, source);
                if (!container || !link) return;
                creep.goWithdraw(container, RESOURCE_ENERGY);
                return;
            } else {
                creep.memory.action = 'harvest';
                return;
            }
        }
    }
}

export default HarvesterAction;
