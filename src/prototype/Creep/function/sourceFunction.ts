import { ROLES } from '@/constant/CreepConstant';
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
            // boost 表缺项时按未 boost 处理，避免异常数据导致运行时错误。
            energy += 2 * (BOOSTS.work[part.boost]?.['harvest'] || 1);
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
     * 按优先级解析采集源。
     *
     * @param preferred - 优先源（通常是距离最近的源）
     * @returns 选中的 Source；房间无源时返回 null
     *
     * @remarks
     * 选择依据：`工位富余 = 可站立工位数 − 该源当前被 harvester 绑定数`，取富余最大者。
     * preferred 仅作同分优先。
     *
     * 此方法曾长期「只有接口声明、没有实现」——未绑定 creep 走到调用点即抛
     * TypeError，被错误隔离冻结（表现为采集工不绑源、原地漫游、单源断供）。
     */
    resolveSourceByPriority(preferred?: Source | null): Source | null {
        const sources = this.room.source || [];
        if (sources.length === 0) return null;

        const claimed = new Map<string, number>();
        for (const creep of Object.values(Game.creeps)) {
            if (!creep || creep.memory?.role !== ROLES.harvester) continue;
            const id = (creep.memory as any).targetSourceId as Id<Source> | undefined;
            if (!id) continue;
            claimed.set(id, (claimed.get(id) || 0) + 1);
        }

        const ordered = preferred ? [preferred, ...sources.filter(s => s.id !== preferred?.id)] : sources.slice();
        let best: Source | null = null;
        let bestDeficit = -Infinity;
        for (const source of ordered) {
            const deficit = this.getSourceWorkSlots(source) - (claimed.get(source.id) || 0);
            if (deficit > bestDeficit) {
                bestDeficit = deficit;
                best = source;
            }
        }
        return best;
    }

    /**
     * 源周围可站立工位数（地形 + 不可通行结构；道路/容器/自家墙不算阻挡）。
     */
    getSourceWorkSlots(source: Source): number {
        let slots = 0;
        const terrain = this.room.getTerrain();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = source.pos.x + dx;
                const y = source.pos.y + dy;
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
                const structures = this.room.lookForAt(LOOK_STRUCTURES, x, y);
                const blocked = structures.some(s =>
                    s.structureType !== STRUCTURE_ROAD &&
                    s.structureType !== STRUCTURE_CONTAINER &&
                    !(s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my));
                if (blocked) continue;
                slots++;
            }
        }
        return Math.max(1, slots);
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
        if (candidates.length === 1) return candidates[0];
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
        if (typeof this.pos.findClosestByRange === 'function') {
            return this.pos.findClosestByRange(candidates) ?? null;
        }
        return candidates[0] ?? null;
    }

    /**
     * 移动并重合到能量源附近的容器上
     * @returns true 表示已到达或无需移动，false 表示正在移动中
     */
    isSourceWorkTilePassable(pos: RoomPosition): boolean {
        if (pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) return false;
        if (this.room.getTerrain().get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;
        const structures = pos.lookFor(LOOK_STRUCTURES);
        for (const structure of structures) {
            if (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) continue;
            if (structure.structureType === STRUCTURE_RAMPART) {
                const rampart = structure as StructureRampart;
                if (rampart.my || rampart.isPublic) continue;
            }
            return false;
        }

        const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
        for (const site of sites) {
            if (site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER || site.structureType === STRUCTURE_RAMPART) {
                continue;
            }
            return false;
        }

        return true;
    }

    getSourceWorkTileTrafficPenalty(pos: RoomPosition): number | null {
        if (pos.isEqualTo(this.pos)) return 0;

        const creepBlocker = pos.lookFor(LOOK_CREEPS).find(c => String(c.id) !== String(this.id));
        const powerBlocker = pos.lookFor(LOOK_POWER_CREEPS).find(c => String(c.id) !== String(this.id));
        const blocker = creepBlocker || powerBlocker;
        if (!blocker) return 0;
        if (!blocker.my) return null;
        const isCreepBlocker = 'spawning' in blocker;
        if (blocker.memory?.dontPullMe) return null;
        if (isCreepBlocker && (blocker.spawning || blocker.fatigue > 0)) return null;
        if ('getActiveBodyparts' in blocker && typeof blocker.getActiveBodyparts === 'function' && blocker.getActiveBodyparts(MOVE) <= 0) {
            return null;
        }
        return 3;
    }

    scoreSourceWorkTile(
        pos: RoomPosition,
        source: Source,
        container: StructureContainer | null,
        link: StructureLink | null,
        trafficPenalty: number
    ): number {
        let score = -this.pos.getRangeTo(pos);

        if (this.pos.isEqualTo(pos)) score += 4;

        if (container) {
            // racebot 口径：站上容器 = harvest 直落容器，最优工位；邻位次之
            if (pos.isEqualTo(container.pos)) score += 12;
            else if (pos.inRangeTo(container.pos, 1)) score += 4;
        }

        if (link && pos.inRangeTo(link.pos, 1)) score += 10;

        if (pos.lookFor(LOOK_STRUCTURES).some((structure) => structure.structureType === STRUCTURE_ROAD)) {
            score += 1;
        }

        if (!pos.inRangeTo(source.pos, 1)) score -= 100;
        score -= trafficPenalty;

        return score;
    }

    moveToSourceWorkTile(source: Source | null = this.getBoundSource()): boolean {
        if (!source) return false;

        const sourceContainer = this.getNearbySourceContainer(1);
        const sourceLink = this.getNearbySourceLink(2);

        // racebot 口径：容器已建则必站容器本体（harvest 直落脚下容器，零搬运/掉落损耗）；
        // 容器缺席时才退而求其次：link 临位（有承接空间）或任意源旁格稳定站位
        if (this.pos.inRangeTo(source, 1)) {
            if (sourceContainer) {
                if (this.pos.isEqualTo(sourceContainer.pos)) return true;
            } else if (sourceLink && this.pos.isNearTo(sourceLink) && sourceLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                return true;
            } else {
                return true;
            }
        }

        const { bestPos } = evaluateSourceWorkTiles(this, source);

        if (bestPos) {
            if (this.pos.isEqualTo(bestPos)) return true;
            this.moveTo(bestPos, { range: 0, maxRooms: 1, reusePath: 0 });
            return false;
        }

        if (this.pos.inRangeTo(source, 1)) return true;

        this.moveTo(source, { range: 1, maxRooms: 1 });
        return false;
    }

    sitOnSourceContainer(): boolean {
        return SourceFunction.prototype.moveToSourceWorkTile.call(this);
    }

    /**
     * 维护 Source 旁的 Container（修理/建造已有工地）
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

        // 寻找容器工地
        const source = this.getBoundSource();
        if (!source) return 'idle';
        
        let site = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        })[0];
        
        if (!site) {
            // 如果附近有 Link，则不需要 Container
            if (source.pos.findInRange(FIND_STRUCTURES, 2, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0) {
                return 'idle';
            }

            // 仅禁止主房 harvester 自动创建容器工地（其他角色仍可自动建）
            const role = this.memory?.role as string | undefined;
            const allowAutoSite = role !== ROLES.harvester;
            if (allowAutoSite && this.pos.inRangeTo(source, 1)) {
                const result = this.pos.createConstructionSite(STRUCTURE_CONTAINER);
                return result === OK ? 'acted' : 'blocked';
            }

            // 其他角色交给布局系统创建容器工地
            return 'idle';
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

export type SourceWorkTileReport = {
    pos: RoomPosition;
    passable: boolean;
    penalty: number | null;
    score: number | null;
};

/**
 * 只读评估 source 周边八个工作位（通行性 / 交通惩罚 / 得分）。
 * 供 moveToSourceWorkTile 与控制台诊断命令共用，保证诊断与实际行为同一份逻辑。
 */
export const evaluateSourceWorkTiles = (
    creep: Creep,
    source: Source
): { tiles: SourceWorkTileReport[]; bestPos: RoomPosition | null } => {
    const proto = SourceFunction.prototype;
    const sourceContainer = proto.getNearbySourceContainer.call(creep, 1);
    const sourceLink = proto.getNearbySourceLink.call(creep, 2);
    const tiles: SourceWorkTileReport[] = [];
    let bestPos: RoomPosition | null = null;
    let bestScore = -Infinity;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const pos = new RoomPosition(source.pos.x + dx, source.pos.y + dy, source.pos.roomName);
            const passable = proto.isSourceWorkTilePassable.call(creep, pos);
            const penalty = passable ? proto.getSourceWorkTileTrafficPenalty.call(creep, pos) : null;
            const score = passable && penalty !== null
                ? proto.scoreSourceWorkTile.call(creep, pos, source, sourceContainer, sourceLink, penalty)
                : null;
            tiles.push({ pos, passable, penalty, score });
            if (passable && penalty !== null && score !== null && score > bestScore) {
                bestScore = score;
                bestPos = pos;
            }
        }
    }
    return { tiles, bestPos };
};
