/**
 * 一些基础的功能
 */
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';
import { inWhitelist } from '@/shared/whitelist';

type TakeTargetType = 'dropped' | 'structure' | 'ruin';
type TakeTarget = { id: Id<any>; type: TakeTargetType };

type EnergyPickupSnapshot = {
    centerLink: StructureLink | null;
    providers: AnyStoreStructure[];
    dropped: Resource<RESOURCE_ENERGY>[];
    droppedLarge: Resource<RESOURCE_ENERGY>[];
    ruins: Ruin[];
};

const getEnergyPickupSnapshot = (() => {
    let cachedTick = -1;
    let cachedByRoom: Record<string, EnergyPickupSnapshot> = {};
    return (room: Room) => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            cachedByRoom = {};
        }
        const hit = cachedByRoom[room.name];
        if (hit) return hit;

        const snapshot: EnergyPickupSnapshot = {
            centerLink: null,
            providers: [],
            dropped: [],
            droppedLarge: [],
            ruins: [],
        };

        const linkArr = (room as any).link as StructureLink[] | undefined;
        if (linkArr && linkArr.length) {
            const centerPos = room.getCenter();
            snapshot.centerLink = linkArr.find(l =>
                l &&
                l.pos.inRangeTo(centerPos, 1) &&
                l.store[RESOURCE_ENERGY] >= 400
            ) || null;
        } else {
            snapshot.centerLink = null;
        }

        const storage = room.storage;
        const terminal = room.terminal;
        if (storage && storage.store[RESOURCE_ENERGY] >= 5000) snapshot.providers.push(storage);
        if (terminal && terminal.store[RESOURCE_ENERGY] >= 5000) snapshot.providers.push(terminal);
        if (linkArr && linkArr.length) {
            for (const l of linkArr) {
                if (l && l.store[RESOURCE_ENERGY] >= 400) snapshot.providers.push(l);
            }
        }
        const contArr = (room as any).container as StructureContainer[] | undefined;
        if (contArr && contArr.length) {
            for (const c of contArr) {
                if (c && c.store[RESOURCE_ENERGY] >= 500) snapshot.providers.push(c);
            }
        }

        snapshot.dropped = room.find(FIND_DROPPED_RESOURCES, {
            filter: resource => resource.resourceType === RESOURCE_ENERGY && resource.amount >= 100
        }) as Resource<RESOURCE_ENERGY>[];
        snapshot.droppedLarge = snapshot.dropped.filter(r => r.amount >= 1000);
        snapshot.ruins = room.find(FIND_RUINS, {
            filter: r => r && r.store[RESOURCE_ENERGY] > 0
        }) as Ruin[];

        cachedByRoom[room.name] = snapshot;
        return snapshot;
    };
})();

export default class BaseFunction extends Creep {
    disableAttackNotificationsOnce(): void {
        if (this.memory.notified) return;
        this.notifyWhenAttacked(false);
        this.memory.notified = true;
    }

    /**
     * 获取能量
     */
    TakeEnergy(pickup: boolean = true) {   // worker、upgrader 的能量获取
        const cache = ensureMemoryCache(this.memory) as any;
        const clearBoundSource = () => {
            delete this.memory.targetSourceId;
        };

        const moveToTakeTarget = (target: RoomObject) => {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 1
            });
        };

        const selectTakeTarget = (excludeId?: Id<any>): TakeTarget | null => {
            const withId = <T extends { id: Id<any> }>(target: T | null, type: TakeTargetType): TakeTarget | null => {
                if (!target) return null;
                if (excludeId && target.id === excludeId) return null;
                return { id: target.id, type };
            };

            const snapshot = getEnergyPickupSnapshot(this.room);

            const findDropped = (minAmount: number): TakeTarget | null => {
                if (!pickup) return null;
                const list = minAmount >= 1000 ? snapshot.droppedLarge : snapshot.dropped;
                const closest = list && list.length ? this.pos.findClosestByRange(list) : null;
                return withId(closest, 'dropped');
            };

            const findStructureTarget = (): TakeTarget | null => {
                if (snapshot.centerLink && (!excludeId || snapshot.centerLink.id !== excludeId)) {
                    return { id: snapshot.centerLink.id, type: 'structure' };
                }
                const closest = snapshot.providers && snapshot.providers.length ? this.pos.findClosestByRange(snapshot.providers) : null;
                return withId(closest, 'structure');
            };

            const findRuinTarget = (): TakeTarget | null => {
                if (!pickup) return null;
                const closest = snapshot.ruins && snapshot.ruins.length ? this.pos.findClosestByRange(snapshot.ruins) : null;
                return withId(closest, 'ruin');
            };

            return (
                findDropped(1000) ||
                findStructureTarget() ||
                findDropped(100) ||
                findRuinTarget()
            );
        };

        const updateTakeTarget = (excludeId?: Id<any>) => {
            if (cache.takeTarget && (!excludeId || cache.takeTarget.id !== excludeId)) {
                clearBoundSource();
                return true;
            }

            const target = selectTakeTarget(excludeId);

            if (target) {
                clearBoundSource();
                cache.takeTarget = target;
                return true;
            }
            cache.takeTarget = null;
            return false;
        };

        const getHarvestSource = () => {
            if (!this.memory.targetSourceId) {
                let targetSource = this.room.closestSource(this);
                if (targetSource) {
                    this.memory.targetSourceId = targetSource.id;
                }
            }

            const currentSource = Game.getObjectById(this.memory.targetSourceId as Id<Source>);
            const targetSource = this.resolveSourceByPriority(currentSource);
            if (!targetSource || targetSource.energy <= 0) {
                clearBoundSource();
                return null;
            }
            return targetSource;
        };

        const moveToHarvestSource = () => {
            const targetSource = getHarvestSource();
            if (!targetSource || this.pos.inRangeTo(targetSource, 1)) return false;

            this.moveTo(targetSource, { visualizePathStyle: { stroke: '#ffaa00' } });
            return true;
        };

        const handleExistingTarget = (): boolean | null => {
            if (!cache.takeTarget) return null;

            const takeTarget = cache.takeTarget as TakeTarget;
            clearBoundSource();
            const target = Game.getObjectById(takeTarget.id);
            if (!target) {
                cache.takeTarget = null;
                return null;
            }

            const type = takeTarget.type;
            if (type === 'dropped') {
                if (target.amount <= 0) {
                    cache.takeTarget = null;
                    return null;
                }
                if (!this.pos.isNearTo(target)) {
                    moveToTakeTarget(target);
                    return false;
                }
                const freeCapacity = this.store.getFreeCapacity();
                const result = this.pickup(target);
                if (result === ERR_NOT_IN_RANGE) {
                    moveToTakeTarget(target);
                    return false;
                }
                if (result !== OK) {
                    if (result === ERR_FULL) return true;
                    cache.takeTarget = null;
                    return null;
                }
                cache.takeTarget = null;
                if (target.amount >= freeCapacity) return true;
                if (updateTakeTarget(takeTarget.id)) {
                    const nextTarget = Game.getObjectById(cache.takeTarget.id) as unknown as RoomObject | null;
                    if (nextTarget) moveToTakeTarget(nextTarget);
                    else cache.takeTarget = null;
                } else moveToHarvestSource();
                return false;
            }
            if (type === 'structure' || type === 'ruin') {
                if (!target.store || target.store[RESOURCE_ENERGY] <= 0) {
                    cache.takeTarget = null;
                    return null;
                }
                if (!this.pos.isNearTo(target)) {
                    moveToTakeTarget(target);
                    return false;
                }
                const freeCapacity = this.store.getFreeCapacity();
                const availableEnergy = target.store[RESOURCE_ENERGY];
                const result = this.withdraw(target, RESOURCE_ENERGY);
                if (result === ERR_NOT_IN_RANGE) {
                    moveToTakeTarget(target);
                    return false;
                }
                if (result !== OK) {
                    if (result === ERR_FULL) return true;
                    cache.takeTarget = null;
                    return null;
                }
                cache.takeTarget = null;
                if (availableEnergy >= freeCapacity) return true;
                if (updateTakeTarget(takeTarget.id)) {
                    const nextTarget = Game.getObjectById(cache.takeTarget.id) as unknown as RoomObject | null;
                    if (nextTarget) moveToTakeTarget(nextTarget);
                    else cache.takeTarget = null;
                } else moveToHarvestSource();
                return false;
            }
            return null;
        };

        const harvestEnergy = () => {
            // if (this.room.level > 4) return false;
            const targetSource = getHarvestSource();
            if (!targetSource) return false;

            if (this.pos.inRangeTo(targetSource, 1)) {
                return this.harvest(targetSource) === OK;
            } else {
                this.moveTo(targetSource, { visualizePathStyle: { stroke: '#ffaa00' } });
                return true;
            }
        };

        updateTakeTarget();   // 更新目标
        const handled = handleExistingTarget();
        if (handled !== null) return handled;    // 拿取能量
        harvestEnergy();    // 采集能量
        return false;
    }

    // 是否处于白名单中
    yieldSourcePosition(source: Source) {
        if (!this.pos.inRangeTo(source.pos, 1)) return false;

        const terrain = this.room.getTerrain();
        let bestPos: RoomPosition | null = null;
        let bestScore = -Infinity;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = this.pos.x + dx;
                const y = this.pos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                const pos = new RoomPosition(x, y, this.room.name);
                if (pos.inRangeTo(source.pos, 1)) continue;
                if (pos.lookFor(LOOK_CREEPS).length > 0 || pos.lookFor(LOOK_POWER_CREEPS).length > 0) continue;

                const score = pos.getRangeTo(source.pos);
                if (score > bestScore) {
                    bestScore = score;
                    bestPos = pos;
                }
            }
        }

        if (bestPos) {
            this.moveTo(bestPos, { range: 0, reusePath: 0 });
            return true;
        }
        return false;
    }

    resolveSourceByPriority(source?: Source | null) {
        let currentSource = source || this.getBoundSource();
        if (!currentSource || currentSource.energy <= 0) {
            delete this.memory.targetSourceId;
            currentSource = null;
        }

        if (currentSource && !this.room.shouldYieldSourceByPriority(this, currentSource)) {
            if (this.memory.targetSourceId !== currentSource.id) {
                this.memory.targetSourceId = currentSource.id;
            }
            return currentSource;
        }

        if (currentSource) delete this.memory.targetSourceId;

        const rebound = this.room.closestSource(this);
        if (rebound) {
            this.memory.targetSourceId = rebound.id;
            return rebound;
        }

        if (currentSource) this.yieldSourcePosition(currentSource);
        return null;
    }

    isWhiteList() {
        return inWhitelist(this.owner.username);
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
