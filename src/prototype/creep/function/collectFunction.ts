/**
 * 资源收集功能类
 * 提供各种资源收集方法的原型扩展
 */
export default class CollectFunction extends Creep {
    /**
     * 收集掉落的资源
     * @param resourceType 资源类型，默认为任意类型
     * @param minAmount 最小数量阈值，默认为 50
     * @param range 搜索范围，默认为整个房间
     * @returns boolean - true 表示找到并正在收集，false 表示未找到
     */
    collectDroppedResource(
        resourceType?: ResourceConstant,
        minAmount: number = 50,
        range?: number
    ): boolean {
        let droppedResources: Resource[];
        
        if (range) {
            droppedResources = this.pos.findInRange(FIND_DROPPED_RESOURCES, range, {
                filter: (resource: Resource) => {
                    if (resourceType && resource.resourceType !== resourceType) return false;
                    return resource.amount >= minAmount;
                }
            });
        } else {
            droppedResources = this.room.find(FIND_DROPPED_RESOURCES, {
                filter: (resource: Resource) => {
                    if (resourceType && resource.resourceType !== resourceType) return false;
                    return resource.amount >= minAmount;
                }
            });
        }

        if (droppedResources.length === 0) return false;

        const target = this.pos.findClosestByRange(droppedResources);
        if (!target) return false;

        this.goPickup(target);
        return true;
    }

    /**
     * 从墓碑收集资源
     * @param resourceType 资源类型，默认为任意类型
     * @returns boolean - true 表示找到并正在收集，false 表示未找到
     */
    collectFromTombstone(resourceType?: ResourceConstant): boolean {
        const tombstones = this.room.find(FIND_TOMBSTONES, {
            filter: (tombstone: Tombstone) => {
                if (resourceType) {
                    return tombstone.store.getUsedCapacity(resourceType) > 0;
                }
                return tombstone.store.getUsedCapacity() > 0;
            }
        });

        if (tombstones.length === 0) return false;

        const target = this.pos.findClosestByRange(tombstones);
        if (!target) return false;

        const withdrawType = resourceType || 
            (Object.keys(target.store) as ResourceConstant[]).find(r => target.store[r] > 0);
        
        if (!withdrawType) return false;

        this.goWithdraw(target, withdrawType);
        return true;
    }

    /**
     * 从废墟收集资源
     * @param resourceType 资源类型，默认为任意类型
     * @returns boolean - true 表示找到并正在收集，false 表示未找到
     */
    collectFromRuin(resourceType?: ResourceConstant): boolean {
        const ruins = this.room.find(FIND_RUINS, {
            filter: (ruin: Ruin) => {
                if (resourceType) {
                    return ruin.store.getUsedCapacity(resourceType) > 0;
                }
                return ruin.store.getUsedCapacity() > 0;
            }
        });

        if (ruins.length === 0) return false;

        const target = this.pos.findClosestByRange(ruins);
        if (!target) return false;

        const withdrawType = resourceType || 
            (Object.keys(target.store) as ResourceConstant[]).find(r => target.store[r] > 0);
        
        if (!withdrawType) return false;

        this.goWithdraw(target, withdrawType);
        return true;
    }

    /**
     * 从容器收集资源
     * @param minAmount 最小数量阈值，默认为 500
     * @param resourceType 资源类型，默认为能量
     * @param excludeControllerContainer 是否排除控制器旁的容器，默认为 false
     * @returns boolean - true 表示找到并正在收集，false 表示未找到
     */
    collectFromContainer(
        minAmount: number = 500,
        resourceType: ResourceConstant = RESOURCE_ENERGY,
        excludeControllerContainer: boolean = false
    ): boolean {
        const containers = this.room.container;
        if (!containers || containers.length === 0) return false;

        const controllerPos = this.room.controller?.pos;

        const validContainers = containers.filter((container: StructureContainer) => {
            if (!container || !container.store) return false;
            if (container.store.getUsedCapacity(resourceType) < minAmount) return false;
            if (excludeControllerContainer && controllerPos && container.pos.inRangeTo(controllerPos, 3)) {
                return false;
            }
            return true;
        });

        if (validContainers.length === 0) return false;

        const target = this.pos.findClosestByRange(validContainers);
        if (!target) return false;

        this.goWithdraw(target, resourceType);
        return true;
    }

    /**
     * 从存储或终端收集资源
     * @param resourceType 资源类型，默认为能量
     * @param minAmount 最小数量阈值，默认为 5000
     * @returns boolean - true 表示找到并正在收集，false 表示未找到
     */
    collectFromStorage(
        resourceType: ResourceConstant = RESOURCE_ENERGY,
        minAmount: number = 5000
    ): boolean {
        const targets: (StructureStorage | StructureTerminal)[] = [];

        const storage = this.room.storage;
        if (storage && storage.store.getUsedCapacity(resourceType) >= minAmount) {
            targets.push(storage);
        }

        const terminal = this.room.terminal;
        if (terminal && terminal.store.getUsedCapacity(resourceType) >= minAmount) {
            targets.push(terminal);
        }

        if (targets.length === 0) return false;

        const target = this.pos.findClosestByRange(targets);
        if (!target) return false;

        this.goWithdraw(target, resourceType);
        return true;
    }

    /**
     * 智能收集资源（按优先级尝试各种来源）
     * 优先级: 掉落资源 > 墓碑 > 废墟 > 容器 > 存储
     * @param resourceType 资源类型，默认为能量
     * @param options 配置选项
     * @returns boolean - true 表示找到并正在收集，false 表示未找到
     */
    smartCollect(
        resourceType: ResourceConstant = RESOURCE_ENERGY,
        options?: {
            includeDropped?: boolean;
            includeTombstone?: boolean;
            includeRuin?: boolean;
            includeContainer?: boolean;
            includeStorage?: boolean;
            minDroppedAmount?: number;
            minContainerAmount?: number;
        }
    ): boolean {
        const opts = {
            includeDropped: true,
            includeTombstone: true,
            includeRuin: true,
            includeContainer: true,
            includeStorage: true,
            minDroppedAmount: 50,
            minContainerAmount: 500,
            ...options
        };

        // 优先级1: 掉落资源
        if (opts.includeDropped && this.collectDroppedResource(resourceType, opts.minDroppedAmount)) {
            return true;
        }

        // 优先级2: 墓碑
        if (opts.includeTombstone && this.collectFromTombstone(resourceType)) {
            return true;
        }

        // 优先级3: 废墟
        if (opts.includeRuin && this.collectFromRuin(resourceType)) {
            return true;
        }

        // 优先级4: 容器
        if (opts.includeContainer && this.collectFromContainer(opts.minContainerAmount, resourceType)) {
            return true;
        }

        // 优先级5: 存储
        if (opts.includeStorage && this.collectFromStorage(resourceType)) {
            return true;
        }

        return false;
    }
}
