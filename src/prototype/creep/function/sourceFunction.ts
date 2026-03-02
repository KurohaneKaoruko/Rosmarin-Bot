export default class SourceFunction extends Creep {
    /**
     * 计算采集产能
     * @returns 每 tick 预计获得的能量值（考虑 WORK 部件与 boost）
     */
    calculateHarvestIncomePerTick(): number {
        let energy = 0;
        for (const part of this.body) {
            if (part.type !== WORK) continue;
            if (part.hits === 0) continue;
            if (!part.boost) {
                energy += 2;
                continue;
            }
            energy += 2 * (BOOSTS.work[part.boost]['harvest'] || 1);
        }
        return energy;
    }

    /**
     * 获取绑定的能量源
     * @returns Source 对象或 null
     */
    getBoundSource(): Source | null {
        const targetSourceId = this.memory.targetSourceId as Id<Source> | null | undefined;
        if (!targetSourceId) return null;
        const source = Game.getObjectById(targetSourceId);
        if (!source) {
            delete this.memory.targetSourceId;
            return null;
        }
        // Room switch / reassignment: stale source binding must be dropped.
        if (source.room.name !== this.room.name) {
            delete this.memory.targetSourceId;
            return null;
        }
        return source;
    }

    /**
     * 绑定能量源 ID
     * @param id - Source 的 ID
     */
    setBoundSourceId(id: Id<Source>) {
        this.memory.targetSourceId = id;
    }

    /**
     * 获取绑定能量源附近的容器
     * @param range - 搜索范围，默认 2
     * @returns 附近的 StructureContainer 或 null
     */
    getNearbySourceContainer(range = 2): StructureContainer | null {
        const source = this.getBoundSource();
        if (!source) return null;
        const containers = this.room.container;
        if (!containers) return null;
        return containers.find(c => source.pos.inRangeTo(c, range)) ?? null;
    }

    /**
     * 获取绑定能量源附近的 Link
     * @param range - 搜索范围，默认 2
     * @returns 附近的 StructureLink 或 null（RCL < 5 时也返回 null）
     */
    getNearbySourceLink(range = 2): StructureLink | null {
        if (this.room.level < 5) return null;
        const source = this.getBoundSource();
        if (!source) return null;
        const links = this.room.link;
        if (!links) return null;
        return links.find(l => source.pos.inRangeTo(l, range)) ?? null;
    }

    /**
     * 移动并重合到能量源附近的容器上
     * @returns true 表示已到达或无需移动，false 表示正在移动中
     */
    sitOnSourceContainer(): boolean {
        const sourceContainer = this.getNearbySourceContainer(1);
        if (!sourceContainer) return true;
        const creepsOnContainer = sourceContainer.pos.lookFor(LOOK_CREEPS);
        const powerCreepsOnContainer = sourceContainer.pos.lookFor(LOOK_POWER_CREEPS);
        if (
            creepsOnContainer.length > 0 ||
            powerCreepsOnContainer.length > 0
        ) {
            return true;
        }
        this.moveTo(sourceContainer, { range: 0 });
        return false;
    }

    /**
     * 维护 Source 旁的 Container (建造/修理)
     * @returns 是否进行了动作
     */
    maintainSourceContainer(): boolean {
        if (this.store[RESOURCE_ENERGY] === 0) return false;
        
        const container = this.getNearbySourceContainer(1);
        if (container) {
            if (container.hits < container.hitsMax * 0.8) {
                this.repair(container);
                return true;
            }
            return false;
        }

        // 寻找或创建工地
        const source = this.getBoundSource();
        if (!source) return false;
        
        let site = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        })[0];
        
        if (!site) {
            // 如果附近有 Link，则不建造 Container (视逻辑而定，这里参考 harvester.ts)
            if (source.pos.findInRange(FIND_STRUCTURES, 2, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0) {
                return false;
            }
            // 在当前位置创建（需确保在范围内）
            if (this.pos.inRangeTo(source, 1)) {
                this.pos.createConstructionSite(STRUCTURE_CONTAINER);
            }
            return false; // 下一 tick 才能建造
        }
        
        this.build(site);
        return true;
    }

    /**
     * 将能量转移到 Source 旁的 Link 或 Container
     * @returns 是否成功转移
     */
    transferToSourceStructure(): boolean {
        if (this.store[RESOURCE_ENERGY] === 0) return false;
        
        const link = this.getNearbySourceLink();
        if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            this.transfer(link, RESOURCE_ENERGY);
            return true;
        }
        
        const container = this.getNearbySourceContainer();
        if (container && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            this.transfer(container, RESOURCE_ENERGY);
            return true;
        }
        
        return false;
    }
}
