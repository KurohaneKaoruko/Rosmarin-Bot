import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { raceEnergyMined } from '@/modules/shared/raceEnergy';

type EnergySourceTarget = AnyStoreStructure | Resource<RESOURCE_ENERGY>;
type WithdrawTarget = AnyStoreStructure | Resource | Ruin;

// 同 tick 内共享的全房扫描结果：同房 creep 复用一次扫描，避免每 creep 每 tick 重复扫全房。
// 缓存未过滤列表、每次调用重放过滤，与直接 find({filter}) 行为严格一致。
const getMyConstructionSites = (room: Room): ConstructionSite[] =>
    getRoomTickCacheValue(room, 'work:my_construction_sites', () => room.find(FIND_MY_CONSTRUCTION_SITES) as ConstructionSite[]);
const getAllStructures = (room: Room): Structure[] =>
    getRoomTickCacheValue(room, 'work:structures', () => room.find(FIND_STRUCTURES) as Structure[]);
const getDroppedResources = (room: Room): Resource[] =>
    getRoomTickCacheValue(room, 'work:dropped', () => room.find(FIND_DROPPED_RESOURCES) as Resource[]);
const getRuins = (room: Room): Ruin[] =>
    getRoomTickCacheValue(room, 'work:ruins', () => room.find(FIND_RUINS) as Ruin[]);
const getMyStructures = (room: Room): Structure[] =>
    getRoomTickCacheValue(room, 'work:my_structures', () => room.find(FIND_MY_STRUCTURES) as Structure[]);
const getMySpawns = (room: Room): StructureSpawn[] =>
    getRoomTickCacheValue(room, 'work:my_spawns', () => room.find(FIND_MY_SPAWNS) as StructureSpawn[]);

const TAKE_TARGET_MOVE_OPTS: MoveToOpts = {
    visualizePathStyle: { stroke: '#ffaa00' },
    maxRooms: 1,
    range: 1,
};

const getCachedContainers = (room: Room): StructureContainer[] =>
    ((room as any).container as StructureContainer[] | undefined) || [];

const getCachedLinks = (room: Room): StructureLink[] =>
    ((room as any).link as StructureLink[] | undefined) || [];

const getClosestByRange = <T extends RoomObject>(creep: Creep, targets: T[]): T | null =>
    targets.length > 0 ? (creep.pos.findClosestByRange(targets) as T | null) : null;

const getBuildTargetsInRange = (creep: Creep, range?: number): ConstructionSite[] => {
    if (typeof range === 'number' && typeof creep.pos.findInRange === 'function') {
        return creep.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, range) as ConstructionSite[];
    }
    return getMyConstructionSites(creep.room);
};

const getRepairTargetsInRange = (creep: Creep, range?: number): Structure[] => {
    if (typeof range === 'number' && typeof creep.pos.findInRange === 'function') {
        return creep.pos.findInRange(FIND_STRUCTURES, range) as Structure[];
    }
    return getAllStructures(creep.room);
};

const getStoreValue = (target: AnyStoreStructure, resourceType: ResourceConstant) =>
    target.store.getUsedCapacity
        ? target.store.getUsedCapacity(resourceType)
        : target.store[resourceType];

const isDroppedEnergy = (target: EnergySourceTarget): target is Resource<RESOURCE_ENERGY> =>
    'resourceType' in target && target.resourceType === RESOURCE_ENERGY;

const getHarvestIncome = (creep: Creep): number => {
    if (typeof creep.calculateHarvestIncomePerTick === 'function') {
        return creep.calculateHarvestIncomePerTick();
    }
    if (typeof creep.getActiveBodyparts === 'function') {
        return Math.max(1, creep.getActiveBodyparts(WORK) * 2);
    }
    return 2;
};

/**
 * 与“工作动作”强相关的通用原型扩展。
 *
 * @remarks
 * 这里收敛了原先分散在 `src/shared/creepActions.ts` 与
 * `src/shared/creepTargets.ts` 的三个能力面：
 * 1. 通用取能动作 `acquireEnergy`
 * 2. build / repair / withdraw 等目标选择
 * 3. 底层 `go*` 操作包装
 *
 * 这样角色层可以继续直接调用 `creep.xxx()`，
 * 避免在 shared 与 prototype 之间来回跳转。
 */
export default class WorkFunction extends Creep {
    /**
     * 查找最近且满足阈值要求的能量来源。
     *
     * @param options 来源过滤条件。
     * @returns 最优能量来源；没有候选时返回 `null`。
     *
     * @remarks
     * 搜索顺序遵循“先收集所有合格候选，再按距离选最近”的原则，
     * 因此它不是硬编码优先级队列，而是统一候选池上的最近距离决策。
     */
    findEnergySource(options: CreepFindEnergySourceOptions = {}): EnergySourceTarget | null {
        const { includeDropped = true, includeStorage = true, minAmount = 100 } = options;
        const candidates: EnergySourceTarget[] = [];

        if (includeStorage) {
            const storage = this.room.storage;
            if (storage && getStoreValue(storage, RESOURCE_ENERGY) >= minAmount) {
                candidates.push(storage);
            }

            const terminal = this.room.terminal;
            if (terminal && getStoreValue(terminal, RESOURCE_ENERGY) >= minAmount) {
                candidates.push(terminal);
            }
        }

        for (const link of getCachedLinks(this.room)) {
            if (link && getStoreValue(link, RESOURCE_ENERGY) >= minAmount) {
                candidates.push(link);
            }
        }

        for (const container of getCachedContainers(this.room)) {
            if (container && getStoreValue(container, RESOURCE_ENERGY) >= minAmount) {
                candidates.push(container);
            }
        }

        if (includeDropped) {
            const dropped = getDroppedResources(this.room).filter(
                (resource) =>
                    resource.resourceType === RESOURCE_ENERGY &&
                    resource.amount >= minAmount
            ) as Resource<RESOURCE_ENERGY>[];
            candidates.push(...dropped);
        }

        if (candidates.length > 0) return getClosestByRange(this, candidates);

        // 二级回退：无满额来源时取「存量最大的容器/掉落（≥30）」——
        // 1 tick 提取半仓 → 立即开工，远胜趴在源上以 harvest 速率龟速自填
        //（W2 自采填满 100 需 25 tick，纯移动浪费）。
        const partialCandidates: EnergySourceTarget[] = [];
        const partialMin = Math.min(30, minAmount);
        for (const container of getCachedContainers(this.room)) {
            if (container && getStoreValue(container, RESOURCE_ENERGY) >= partialMin) {
                partialCandidates.push(container);
            }
        }
        if (includeDropped) {
            const dropped = getDroppedResources(this.room).filter(
                (resource) =>
                    resource.resourceType === RESOURCE_ENERGY &&
                    resource.amount >= partialMin
            ) as Resource<RESOURCE_ENERGY>[];
            partialCandidates.push(...dropped);
        }
        if (partialCandidates.length === 0) return null;
        // 取存量最大者（一口吃干，避免多趟）
        let best = partialCandidates[0];
        let bestAmount = 0;
        for (const c of partialCandidates) {
            const amount = 'store' in c ? getStoreValue(c, RESOURCE_ENERGY) : (c as Resource<RESOURCE_ENERGY>).amount;
            if (amount > bestAmount) { bestAmount = amount; best = c; }
        }
        return best;
    }

    /**
     * 查找当前最合适的资源存放目标。
     *
     * @param resourceType 计划投递的资源类型。
     * @param excludeId 需要跳过的目标 id，通常用于避免回投来源仓。
     * @returns 可投递的存储建筑；没有可用目标时返回 `null`。
     *
     * @remarks
     * 若房间已经挂载 `findBestStoreTarget`，这里优先走更成熟的 haul 侧评分逻辑；
     * 否则退回到最基础的距离优先候选列表。
     */
    findStoreTarget(
        resourceType: ResourceConstant,
        excludeId?: Id<AnyStoreStructure>
    ): AnyStoreStructure | null {
        if (typeof this.findBestStoreTarget === 'function') {
            return this.findBestStoreTarget(resourceType, excludeId);
        }

        const candidates: AnyStoreStructure[] = [];

        if (resourceType === RESOURCE_ENERGY) {
            const spawns = getMySpawns(this.room).filter(
                (spawn) => spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            );
            candidates.push(...spawns);

            const structuresNeedingEnergy = getMyStructures(this.room).filter(
                (structure) =>
                    (structure.structureType === STRUCTURE_EXTENSION ||
                    structure.structureType === STRUCTURE_TOWER) &&
                    (structure as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
            ) as AnyStoreStructure[];
            candidates.push(...structuresNeedingEnergy);
        }

        const storage = this.room.storage;
        if (storage && storage.store.getFreeCapacity(resourceType) > 0) {
            candidates.push(storage);
        }

        const terminal = this.room.terminal;
        if (terminal && terminal.store.getFreeCapacity(resourceType) > 0) {
            candidates.push(terminal);
        }

        for (const container of getCachedContainers(this.room)) {
            if (container && container.store.getFreeCapacity(resourceType) > 0) {
                candidates.push(container);
            }
        }

        return getClosestByRange(
            this,
            excludeId ? candidates.filter((candidate) => candidate.id !== excludeId) : candidates
        );
    }

    /**
     * 查找最值得优先维修的结构。
     *
     * @param options 维修筛选条件。
     * @returns 命中值最低的合格目标；没有候选时返回 `null`。
     */
    findRepairTarget(options: CreepFindRepairTargetOptions = {}): Structure | null {
        const {
            maxHits,
            maxHitsRatio,
            excludeTypes = [],
            range,
        } = options;

        const structures = getRepairTargetsInRange(this, range).filter((structure) => {
            if (!structure || structure.hits >= structure.hitsMax) return false;
            if (excludeTypes.includes(structure.structureType)) return false;
            if (typeof maxHits === 'number' && structure.hits > maxHits) return false;
            if (typeof maxHitsRatio === 'number' && structure.hits >= structure.hitsMax * maxHitsRatio) return false;
            return true;
        });

        if (structures.length <= 0) return null;
        return structures.reduce((lowest, current) => current.hits < lowest.hits ? current : lowest);
    }

    /**
     * 查找最值得优先建造的工地。
     *
     * @param options 建造优先级与搜索范围。
     * @returns 最优工地；没有候选时返回 `null`。
     */
    findBuildTarget(options: CreepFindBuildTargetOptions = {}): ConstructionSite | null {
        const sites = getBuildTargetsInRange(this, options.range);
        if (sites.length <= 0) return null;

        const defaultPriority: StructureConstant[] = [
            STRUCTURE_SPAWN,
            STRUCTURE_EXTENSION,
            STRUCTURE_TOWER,
            STRUCTURE_STORAGE,
            STRUCTURE_TERMINAL,
            STRUCTURE_CONTAINER,
            STRUCTURE_ROAD,
            STRUCTURE_RAMPART,
        ];

        const priority = options.priority || defaultPriority;
        for (const structureType of priority) {
            const prioritized = sites.filter((site) => site.structureType === structureType);
            const target = getClosestByRange(this, prioritized);
            if (target) return target;
        }

        return getClosestByRange(this, sites);
    }

    /**
     * 为搬运类逻辑选择通用提取目标。
     *
     * @param resourceType 计划提取的资源类型，默认能量。
     * @returns 优先级最高的提取对象；没有候选时返回 `null`。
     *
     * @remarks
     * 这里保留 shared 版的优先级语义：
     * 大量掉落资源 > 大仓储 > 普通 container/link > 小掉落 > 废墟。
     */
    findWithdrawTarget(
        resourceType: ResourceConstant = RESOURCE_ENERGY
    ): WithdrawTarget | null {
        const droppedLarge = getDroppedResources(this.room).filter(
            (resource) => resource.resourceType === resourceType && resource.amount >= 1000
        );
        const closestLargeDrop = getClosestByRange(this, droppedLarge);
        if (closestLargeDrop) return closestLargeDrop;

        const candidates: WithdrawTarget[] = [];

        const storage = this.room.storage;
        if (storage && getStoreValue(storage, resourceType) >= 1000) {
            candidates.push(storage);
        }

        const terminal = this.room.terminal;
        if (terminal && getStoreValue(terminal, resourceType) >= 1000) {
            candidates.push(terminal);
        }

        for (const container of getCachedContainers(this.room)) {
            if (container && getStoreValue(container, resourceType) >= 500) {
                candidates.push(container);
            }
        }

        if (resourceType === RESOURCE_ENERGY) {
            for (const link of getCachedLinks(this.room)) {
                if (link && getStoreValue(link, RESOURCE_ENERGY) >= 400) {
                    candidates.push(link);
                }
            }
        }

        const dropped = getDroppedResources(this.room).filter(
            (resource) => resource.resourceType === resourceType && resource.amount >= 100
        );
        candidates.push(...dropped);

        const ruins = getRuins(this.room).filter(
            (ruin) => ruin.store.getUsedCapacity(resourceType) > 0
        );
        candidates.push(...ruins);

        return getClosestByRange(this, candidates);
    }

    /**
     * 执行统一主房取能动作。
     *
     * @param options 取能配置。
     * @returns `true` 表示本 tick 取能后将装满或等价完成；`false` 表示仍需继续或仅执行了移动。
     *
     * @remarks
     * 入口语义与旧 shared 版本保持一致：
     * - 先尝试房间内现成能量来源；
     * - 若成功锁定来源，会清掉 `targetSourceId` 避免与 harvest 绑定冲突；
     * - 若没有合格来源，再回退到 source harvest。
     */
    acquireEnergy(options: CreepAcquireEnergyOptions = {}): boolean {
        if (this.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return true;

        const { pickup = true, includeStorage = true, minAmount = 100 } = options;
        const target = this.findEnergySource({
            includeDropped: pickup,
            includeStorage,
            minAmount,
        });

        if (target) {
            delete this.memory.targetSourceId;

            if (!this.pos.isNearTo(target)) {
                this.moveTo(target, TAKE_TARGET_MOVE_OPTS);
                return false;
            }

            const freeCapacity = this.store.getFreeCapacity(RESOURCE_ENERGY);
            if (isDroppedEnergy(target)) {
                const available = target.amount;
                const result = this.pickup(target);
                if (result === ERR_FULL) return true;
                if (result !== OK) return false;
                return available >= freeCapacity;
            }

            const available = target.store.getUsedCapacity(RESOURCE_ENERGY);
            const result = this.withdraw(target, RESOURCE_ENERGY);
            if (result === ERR_FULL) return true;
            if (result !== OK) return false;
            return available >= freeCapacity;
        }

        const currentSource = typeof this.getBoundSource === 'function'
            ? this.getBoundSource()
            : (this.memory.targetSourceId
                ? Game.getObjectById(this.memory.targetSourceId as Id<Source>)
                : null);
        const source = typeof this.resolveSourceByPriority === 'function'
            ? this.resolveSourceByPriority(currentSource)
            : (currentSource || this.room.closestSource(this));

        if (!source || source.energy <= 0) return false;

        if (!this.pos.inRangeTo(source, 1)) {
            this.moveTo(source, TAKE_TARGET_MOVE_OPTS);
            return false;
        }

        const result = this.harvest(source);
        if (result !== OK && result !== ERR_NOT_ENOUGH_RESOURCES) return false;

        return source.energy >= this.store.getFreeCapacity(RESOURCE_ENERGY) ||
            this.store.getFreeCapacity(RESOURCE_ENERGY) <= getHarvestIncome(this);
    }

    /**
     * 采集资源
     * @param target - 要采集的目标 (Source 或 Mineral)
     * @returns true 表示正在采集或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goHaverst(target: Source | Mineral) {
        if (!target) return null;
        let result = this.harvest(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 1
            });
            return false;
        }
        // 冲级面板采样：源矿采集进账（矿物不计）
        if (result === OK && (target as Source).energy !== undefined) {
            raceEnergyMined(this.room.name, this.getActiveBodyparts(WORK) * HARVEST_POWER);
        }
        return true;
    }
    /**
     * 从指定结构中提取资源
     * @param target - 提取目标 (Structure, Tombstone, Ruin 等)
     * @param resourceType - (可选) 要提取的资源类型，默认为目标存储中的第一种资源
     * @param args - (可选) 其他传递给 withdraw 的参数
     * @returns true 表示正在提取或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goWithdraw(target: any, resourceType?: ResourceConstant, ...args: any[]): boolean {
        if (!target) return null;
        if (!resourceType) resourceType = Object.keys(target.store)[0] as ResourceConstant;
        let result = this.withdraw(target, resourceType, ...args);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 1
            });
            return false;
        } else return true;
    }
    /**
     * 向指定结构转移资源
     * @param target - 转移目标 (Creep 或 Structure)
     * @param resoureType - (可选) 要转移的资源类型，默认为自身存储中的第一种资源
     * @param amount - (可选) 转移数量
     * @returns true 表示正在转移或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goTransfer(target: AnyCreep | Structure, resoureType?: ResourceConstant, amount?: number): boolean {
        if (!target) return null; // 如果没有目标，返回 null
        if (!resoureType) resoureType = Object.keys(this.store)[0] as ResourceConstant;
        let result = this.transfer(target, resoureType, amount);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffffff' },
                maxRooms: 1,
                range: 1
            });
            return false;
        } else return true;
    }
    /**
     * 拾取掉落资源
     * @param target - 掉落的资源对象
     * @returns true 表示正在拾取或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goPickup(target: Resource): boolean {
        if (!target) return null; // 如果没有目标，返回 false
        let result = this.pickup(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 1
            });
            return false;
        } else return true;
    }
    /**
     * 建造建筑
     * @param target - 建筑工地 (ConstructionSite)
     * @returns true 表示正在建造或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goBuild(target: ConstructionSite) {
        if (!target) return null;
        let result = this.build(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 3
            });
            return false;
        } else return true;
    }
    /**
     * 维修建筑
     * @param target - 需要维修的建筑
     * @returns true 表示正在维修、已满血或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goRepair(target: Structure) {
        if (!target) return null;
        if (target.hits === target.hitsMax) return true;

        let result = this.repair(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 3
            });
            return false;
        } else return true;
    }
    /**
     * 升级控制器
     * @param target - 控制器 (Controller)
     * @returns true 表示正在升级或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goUpgrade() {
        const target = this.room.controller;
        if (!target) return null;
        let result = this.upgradeController(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 3
            });
            return false;
        } else return true;
    }
}
