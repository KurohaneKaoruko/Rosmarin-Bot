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
        const candidates = containers.filter(c => source.pos.inRangeTo(c, range));
        if (candidates.length === 0) return null;
        return this.pos.findClosestByRange(candidates) ?? null;
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
        const candidates = links.filter(l => source.pos.inRangeTo(l, range));
        if (candidates.length === 0) return null;
        return this.pos.findClosestByRange(candidates) ?? null;
    }

    /**
     * 移动并重合到能量源附近的容器上
     * @returns true 表示已到达或无需移动，false 表示正在移动中
     */
    sitOnSourceContainer(): boolean {
        const sourceContainer = this.getNearbySourceContainer(1);
        if (!sourceContainer) return true;
        const source = this.getBoundSource();
        if (source && this.pos.inRangeTo(source, 1)) {
            const sourceLinks = (this.room.link || []).filter(
                link => source.pos.inRangeTo(link, 2) &&
                    link.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                    this.pos.isNearTo(link)
            );
            if (sourceLinks.length > 0) {
                return true;
            }
            if (this.pos.inRangeTo(sourceContainer, 1)) {
                return true;
            }
        }
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
     * @returns `acted` 表示本 tick 已处理；`blocked` 表示想建但当前建不出来；`idle` 表示当前无需处理
     */
    maintainSourceContainer(): 'acted' | 'blocked' | 'idle' {
        if (this.store[RESOURCE_ENERGY] === 0) return 'idle';
        
        const container = this.getNearbySourceContainer(1);
        if (container) {
            if (container.hits < container.hitsMax * 0.8) {
                this.repair(container);
                return 'acted';
            }
            return 'idle';
        }

        // 寻找或创建工地
        const source = this.getBoundSource();
        if (!source) return 'idle';
        
        let site = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        })[0];
        
        if (!site) {
            // 如果附近有 Link，则不建造 Container (视逻辑而定，这里参考 harvester.ts)
            if (source.pos.findInRange(FIND_STRUCTURES, 2, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0) {
                return 'idle';
            }
            // 在当前位置创建（需确保在范围内）
            if (this.pos.inRangeTo(source, 1)) {
                const result = this.pos.createConstructionSite(STRUCTURE_CONTAINER);
                return result === OK ? 'acted' : 'blocked';
            }
            return 'idle'; // 下一 tick 靠近后再建造
        }
        
        this.build(site);
        return 'acted';
    }

    /**
     * 将能量转移到 Source 旁的 Link 或 Container
     * @returns 是否成功转移
     */
    transferToSourceStructure(): boolean {
        if (this.store[RESOURCE_ENERGY] === 0) return false;

        const source = this.getBoundSource();
        if (!source) return false;

        const links = this.room.link;
        const linkCandidates = (links || []).filter(
            (l) => source.pos.inRangeTo(l, 2) && l.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        );
        const inRangeLinks = linkCandidates.filter(link => this.pos.isNearTo(link));
        if (inRangeLinks.length > 0) {
            const link = this.pos.findClosestByRange(inRangeLinks) as StructureLink | null;
            if (link) return this.transfer(link, RESOURCE_ENERGY) === OK;
        }

        const containers = this.room.container;
        const containerCandidates = (containers || []).filter(
            (c) => source.pos.inRangeTo(c, 2) && c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        );
        const inRangeContainers = containerCandidates.filter(container => this.pos.isNearTo(container));
        if (inRangeContainers.length > 0) {
            const container = this.pos.findClosestByRange(inRangeContainers) as StructureContainer | null;
            if (container) return this.transfer(container, RESOURCE_ENERGY) === OK;
        }
        
        return false;
    }
}
