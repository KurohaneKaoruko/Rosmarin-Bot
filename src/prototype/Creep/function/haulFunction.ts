import { getCoreDepotContainer, isCoreDepotContainer, isCoreDepotContainerDraining } from '@/modules/shared/coreDepot';

/**
 * 搬运通用功能
 * 提供判断存放目标与选择最佳存放建筑的原型扩展
 */
export default class HaulFunction extends Creep {
    /**
     * 判断指定结构是否适合作为某种资源的存放目标
     * @param target 目标建筑
     * @param resource 资源类型
     * @returns 是否允许将该资源存入目标
     */
    canAutoStore(target: AnyStoreStructure, resource: ResourceConstant): boolean {
        if (!target) return false;
        const type = target.structureType;
        if (type === STRUCTURE_POWER_SPAWN) {
            return resource === RESOURCE_ENERGY || resource === RESOURCE_POWER;
        }
        if (type === STRUCTURE_NUKER) {
            return resource === RESOURCE_ENERGY || resource === RESOURCE_GHODIUM;
        }
        if (type === STRUCTURE_LAB) {
            return resource === RESOURCE_ENERGY;
        }
        if (type === STRUCTURE_FACTORY) {
            return resource === RESOURCE_ENERGY;
        }
        if (type === STRUCTURE_CONTAINER) {
            if (this.isCoreDepotContainer(target)) {
                // 排空换位期：占位 container 停止一切存入（只出不进），
                // 让存量被自然取用耗尽后 planner 再拆除换真建筑
                return !isCoreDepotContainerDraining(this.room, target);
            }
            if (this.isControllerContainer(target)) return resource === RESOURCE_ENERGY;
            return !this.isSourceContainer(target) && !this.isMineralContainer(target);
        }
        return true;
    }

    isCoreDepotContainer(target: AnyStoreStructure): target is StructureContainer {
        if (!target || target.structureType !== STRUCTURE_CONTAINER) return false;
        return isCoreDepotContainer(this.room, target);
    }

    isControllerContainer(target: AnyStoreStructure): target is StructureContainer {
        if (!target || target.structureType !== STRUCTURE_CONTAINER) return false;
        const controller = this.room.controller;
        if (!controller) return false;
        const container = target as StructureContainer;
        if (isCoreDepotContainer(this.room, container)) return false;
        // 若极端布局下与 source/mineral 共用同一个箱子，存放侧仍按 controller buffer 处理：
        // 能量可以补进去，非能量一律不允许再塞回去。
        return container.pos.inRangeTo(controller.pos, 3);
    }

    /**
     * 判断容器是否为采集容器（靠近 Source 的 container）
     * @param target 要检查的结构
     * @returns 是否为采集容器
     */
    isSourceContainer(target: AnyStoreStructure): boolean {
        if (!target || target.structureType !== STRUCTURE_CONTAINER) return false;
        const sources = this.room.source as Source[] | undefined;
        if (!sources || !sources.length) return false;
        for (const src of sources) {
            if (src && target.pos.inRangeTo(src.pos, 2)) return true;
        }
        return false;
    }

    /**
     * 判断容器是否为矿物容器（靠近 Mineral 的 container）
     * @param target 要检查的结构
     * @returns 是否为矿物容器
     */
    isMineralContainer(target: AnyStoreStructure): boolean {
        if (!target || target.structureType !== STRUCTURE_CONTAINER) return false;
        const mineral = this.room.mineral as Mineral | undefined;
        if (!mineral) return false;
        if (target.pos.inRangeTo(mineral.pos, 2)) return true;
        return false;
    }

    /**
     * 为指定资源选择当前房间中“最合适”的存放建筑
     * 会综合考虑结构类型优先级、剩余容量与距离
     * @param resource 资源类型
     * @returns 选中的存放目标，找不到则为 null
     */
    findBestStoreTarget(resource: ResourceConstant, excludeId?: Id<AnyStoreStructure>): AnyStoreStructure | null {
        const roomAny = this.room as any;
        const rawPlaceholderStorage = this.room.storage ? null : getCoreDepotContainer(this.room, 'storage');
        const rawPlaceholderTerminal = this.room.terminal ? null : getCoreDepotContainer(this.room, 'terminal');
        // 排空换位期的占位 container 不再作为存放候选（存量交给自然取用耗尽）
        const placeholderStorage = rawPlaceholderStorage && !isCoreDepotContainerDraining(this.room, rawPlaceholderStorage)
            ? rawPlaceholderStorage
            : null;
        const placeholderTerminal = rawPlaceholderTerminal && !isCoreDepotContainerDraining(this.room, rawPlaceholderTerminal)
            ? rawPlaceholderTerminal
            : null;
        const candidates: AnyStoreStructure[] = [
            this.room.storage,
            this.room.terminal,
            placeholderStorage,
            placeholderTerminal,
            roomAny.factory,
            roomAny.powerSpawn,
            roomAny.nuker,
            ...(roomAny.lab || []),
            ...(roomAny.container || []),
        ].filter(Boolean) as AnyStoreStructure[];

        const visited = new Set<string>();

        let best: AnyStoreStructure | null = null;
        let bestScore = -Infinity;

        for (const s of candidates) {
            if (excludeId && s.id === excludeId) continue;
            if (visited.has(s.id)) continue;
            visited.add(s.id);
            if (!this.canAutoStore(s, resource)) continue;
            const free = s.store?.getFreeCapacity(resource) ?? 0;
            if (free <= 0) continue;
            let score = 0;
            if (s.structureType === STRUCTURE_STORAGE) score = 100;
            else if (s.structureType === STRUCTURE_TERMINAL) score = 90;
            else if (placeholderStorage && s.id === placeholderStorage.id) score = 95;
            else if (placeholderTerminal && s.id === placeholderTerminal.id) score = 85;
            else if (s.structureType === STRUCTURE_FACTORY) score = 80;
            else if (s.structureType === STRUCTURE_POWER_SPAWN) score = 70;
            else if (s.structureType === STRUCTURE_NUKER) score = 60;
            else if (s.structureType === STRUCTURE_LAB) score = 50;
            else if (s.structureType === STRUCTURE_CONTAINER) score = 40;
            score += Math.min(free / 1000, 10);
            const dist = this.pos.getRangeTo(s);
            score -= dist * 0.1;
            if (score > bestScore) {
                bestScore = score;
                best = s;
            }
        }

        return best;
    }
}
