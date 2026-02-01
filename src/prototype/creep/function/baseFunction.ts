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

        const center = Memory.RoomControlData?.[room.name]?.center;
        const linkArr = (room as any).link as StructureLink[] | undefined;
        if (center && linkArr && linkArr.length) {
            snapshot.centerLink = linkArr.find(l =>
                l &&
                l.pos.inRangeTo(center.x, center.y, 1) &&
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
        const updateTakeTarget = () => {
            if (this.memory.cache.takeTarget) return false;

            const snapshot = getEnergyPickupSnapshot(this.room);

            const findDropped = (minAmount: number): TakeTarget | null => {
                if (!pickup) return null;
                const list = minAmount >= 1000 ? snapshot.droppedLarge : snapshot.dropped;
                const closest = list && list.length ? this.pos.findClosestByRange(list) : null;
                return closest ? { id: closest.id, type: 'dropped' } : null;
            };

            const findStructureTarget = (): TakeTarget | null => {
                if (snapshot.centerLink) return { id: snapshot.centerLink.id, type: 'structure' };
                const closest = snapshot.providers && snapshot.providers.length ? this.pos.findClosestByRange(snapshot.providers) : null;
                return closest ? { id: closest.id, type: 'structure' } : null;
            };

            const findRuinTarget = (): TakeTarget | null => {
                if (!pickup) return null;
                const closest = snapshot.ruins && snapshot.ruins.length ? this.pos.findClosestByRange(snapshot.ruins) : null;
                return closest ? { id: closest.id, type: 'ruin' } : null;
            };

            const target =
                findDropped(1000) ||
                findStructureTarget() ||
                findDropped(100) ||
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
