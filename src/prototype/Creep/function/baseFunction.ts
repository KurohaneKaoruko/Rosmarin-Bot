/**
 * 一些基础的功能
 */
import { inWhitelist } from '@/modules/utils/whitelist';

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
    /**
     * 获取能量
     */
    TakeEnergy(pickup: boolean = true) {   // worker、upgrader 的能量获取
        const cache = (this.memory.cache || (this.memory.cache = {} as any)) as any;

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
            if (cache.takeTarget && (!excludeId || cache.takeTarget.id !== excludeId)) return true;

            const target = selectTakeTarget(excludeId);

            if (target) {
                cache.takeTarget = target;
                return true;
            }
            cache.takeTarget = null;
            return false;
        };

        const getHarvestSource = () => {
            if (!cache.targetSourceId) {
                let targetSource = this.room.closestSource(this);
                if (targetSource) {
                    cache.targetSourceId = targetSource.id;
                }
            }

            const targetSource = Game.getObjectById(cache.targetSourceId) as Source;
            if (!targetSource || targetSource.energy <= 0) {
                cache.targetSourceId = null;
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
            const target = Game.getObjectById(takeTarget.id) as any;
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
                    const nextTarget = Game.getObjectById(cache.takeTarget.id) as any;
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
                    const nextTarget = Game.getObjectById(cache.takeTarget.id) as any;
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
