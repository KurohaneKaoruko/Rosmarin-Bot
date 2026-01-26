/**
 * 一些基础的功能
 */
export default class BaseFunction extends Creep {
    /**
     * 获取能量
     */
    TakeEnergy(pickup: boolean = true) {   // worker、upgrader 的能量获取
        const updateTakeTarget = () => {
            if (this.memory.cache.takeTarget) return false;

            const target =  (pickup ? findDroppedResourceTarget(1000) : null) ||
                            findStructureTarget() ||
                            (pickup ? findDroppedResourceTarget(100) : null) ||
                            findRuinTarget();

            if (target) {
                this.memory.cache.takeTarget = target;
                return true;
            }
            return false;
        };

        const handleExistingTarget = () => {
            if (!this.memory.cache.takeTarget) return false;

            const target = Game.getObjectById(this.memory.cache.takeTarget.id) as any;
            if (!target) {
                this.memory.cache.takeTarget = null;
                return false;
            }

            const type = this.memory.cache.takeTarget.type;
            if (type === 'dropped') {
                if (target.amount <= 0) {
                    this.memory.cache.takeTarget = null;
                    return false;
                }
                this.goPickup(target);
                return true;
            }
            if (type === 'structure' || type === 'ruin') {
                if (!target.store || target.store[RESOURCE_ENERGY] <= 0) {
                    this.memory.cache.takeTarget = null;
                    return false;
                }
                this.goWithdraw(target, RESOURCE_ENERGY);
                return true;
            }
            return false;
        };

        const findStructureTarget = () => {
            const targets: (StructureStorage | StructureTerminal | StructureLink | StructureContainer)[] = [];
            const storage = this.room.storage;
            const terminal = this.room.terminal;
            const link = this.room.link;
            const container = this.room.container;

            // 1. 优先中心 link
            const center = Memory.RoomControlData?.[this.room.name]?.center;
            if (center && link && link.length) {
                const centerLink = link.find(l =>
                    l &&
                    l.pos.inRangeTo(center.x, center.y, 1) &&
                    l.store[RESOURCE_ENERGY] >= 400    // 阈值可按你需求调整
                );
                if (centerLink) {
                    return { id: centerLink.id, type: 'structure' };
                }
            }

            // 2. storage / terminal / 其它 link / container（沿用现有阈值）
            if (storage && storage.store[RESOURCE_ENERGY] >= 5000) {
                targets.push(storage);
            }
            if (terminal && terminal.store[RESOURCE_ENERGY] >= 5000) {
                targets.push(terminal);
            }
            for (const l of link) {
                if (l && l.store[RESOURCE_ENERGY] >= 400) {
                    targets.push(l);
                }
            }
            for (const c of container) {
                if (c && c.store[RESOURCE_ENERGY] >= 500) {
                    targets.push(c);
                }
            }

            const closest = this.pos.findClosestByRange(targets);
            return closest ? { id: closest.id, type: 'structure' } : null;
        };

        const findDroppedResourceTarget = (amount = 50) => {
            const droppedResources = this.room.find(FIND_DROPPED_RESOURCES, {
                filter: resource => resource.resourceType === RESOURCE_ENERGY && resource.amount >= amount
            });
            const closestDroppedEnergy = this.pos.findClosestByRange(droppedResources);
            return closestDroppedEnergy
                ? { id: closestDroppedEnergy.id, type: 'dropped' }
                : null;
        };

        const findRuinTarget = () => {
            const ruins = this.room.find(FIND_RUINS, {
                filter: r => r && r.store[RESOURCE_ENERGY] > 0
            });
            const closestRuin = this.pos.findClosestByRange(ruins);
            return closestRuin
                ? { id: closestRuin.id, type: 'ruin' }
                : null;
        };

        const harvestEnergy = () => {
            // if (this.room.level > 4) return false;
            if (!this.memory.cache.targetSourceId) {
                let targetSource = this.room.closestSource(this);
                if (targetSource) {
                    this.memory.cache.targetSourceId = targetSource.id;
                }
            }

            const targetSource = Game.getObjectById(this.memory.cache.targetSourceId) as Source;
            if (!targetSource || targetSource.energy <= 0) {
                this.memory.cache.targetSourceId = null;
                return false;
            }

            if (this.pos.inRangeTo(targetSource, 1)) {
                return this.harvest(targetSource) === OK;
            } else {
                this.moveTo(targetSource, { visualizePathStyle: { stroke: '#ffaa00' } });
                return true;
            }
        };

        updateTakeTarget();   // 更新目标
        if (handleExistingTarget()) return;    // 拿取能量
        else harvestEnergy();    // 采集能量
    }

    // 是否处于白名单中
    isWhiteList() {
        let whiteList = new Set<string>(Memory['whitelist'] || []);
        return whiteList.has(this.owner.username);
    }

    /**
     * 切换任务状态
     * 根据 creep 的存储容量状态返回应该切换到的状态
     * @param resourceType 检查的资源类型，默认检查所有资源
     * @returns 'source' | 'target' | null - 'source' 表示需要获取资源，'target' 表示需要执行任务，null 表示不需要切换
     */
    switchTaskState(resourceType?: ResourceConstant): 'source' | 'target' | null {
        if (resourceType) {
            // 检查特定资源类型
            const usedCapacity = this.store.getUsedCapacity(resourceType);
            const freeCapacity = this.store.getFreeCapacity(resourceType);
            
            if (usedCapacity === 0) {
                return 'source';
            }
            if (freeCapacity === 0) {
                return 'target';
            }
        } else {
            // 检查所有资源
            const usedCapacity = this.store.getUsedCapacity();
            const freeCapacity = this.store.getFreeCapacity();
            
            if (usedCapacity === 0) {
                return 'source';
            }
            if (freeCapacity === 0) {
                return 'target';
            }
        }
        
        return null;
    }
}
