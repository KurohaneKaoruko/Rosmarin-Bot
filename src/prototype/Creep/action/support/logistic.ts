import { createBoostedRole, createWorkLayerRole } from '@/framework/ai/creepRole';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

/**
 * 后勤角色在「取货态」下的目标缓存。
 */
type LogisticCache = {
    targetId?: Id<any>;
    resType?: ResourceConstant;
    actionType?: 'pickup' | 'withdraw';
};

/**
 * 后勤角色内存扩展：
 * - `sourceRoom` 取货房间；
 * - `targetRoom` 送货房间；
 * - `idleUntil` 未找到目标时的短暂休眠截止 tick；
 * - `cache.source` 取货目标缓存。
 */
type LogisticMemory = CreepMemory & {
    sourceRoom?: string;
    targetRoom?: string;
    idleUntil?: number;
};

const getLogisticSourceCache = (memory: LogisticMemory): LogisticCache => {
    const cache = ensureMemoryCache(memory) as Record<string, any>;
    return (cache.source && typeof cache.source === 'object' ? cache.source : (cache.source = {})) as LogisticCache;
};

/**
 * 从存储结构中挑选存量最大的资源类型。
 *
 * @param store 任意可读 Store。
 * @returns 数量最多的资源类型；若为空则返回 `undefined`。
 */
const pickMostStoredResource = (store: StoreDefinition): ResourceConstant | undefined => {
    let best: ResourceConstant | undefined;
    let bestAmount = 0;
    for (const k of Object.keys(store) as ResourceConstant[]) {
        const amt = store.getUsedCapacity(k) || 0;
        if (amt > bestAmount) {
            bestAmount = amt;
            best = k;
        }
    }
    return best;
};

/**
 * 校验取货缓存是否仍然有效。
 *
 * @param target 缓存目标对象。
 * @param actionType 缓存动作类型。
 * @param resType 资源类型（withdraw 场景必填）。
 * @returns `true` 表示缓存仍可继续使用。
 */
const isCacheValid = (target: any, actionType: LogisticCache['actionType'], resType: ResourceConstant | undefined): boolean => {
    if (!target) return false;
    if (actionType === 'pickup') return typeof target.amount === 'number' && target.amount > 0;
    if (actionType === 'withdraw') {
        if (!resType) return false;
        return !!target.store && target.store.getUsedCapacity(resType) > 0;
    }
    return false;
};

/**
 * 取货逻辑：
 * - 仅在 sourceRoom 执行；
 * - 优先复用缓存，失效后重新选目标；
 * - 目标优先级：掉落资源 -> 墓碑 -> 废墟 -> storage -> terminal -> container。
 *
 * @param creep 当前后勤 creep。
 */
function withdraw(creep: Creep) {
    const mem = creep.memory as LogisticMemory;
    const sourceRoom = mem.sourceRoom;
    if (!sourceRoom) return;

    if (creep.room.name !== sourceRoom) {
        creep.moveToRoom(sourceRoom);
        return;
    }

    if (mem.idleUntil && Game.time < mem.idleUntil) return;

    const room = creep.room;
    const cache = getLogisticSourceCache(mem);
    let target = cache.targetId ? Game.getObjectById(cache.targetId) : null;
    let resType = cache.resType;
    let actionType = cache.actionType;

    if (!isCacheValid(target, actionType, resType)) {
        target = null;
        resType = undefined;
        actionType = undefined;
        cache.targetId = undefined;
        cache.resType = undefined;
        cache.actionType = undefined;
    }

    if (!target) {
        const resources = room.find(FIND_DROPPED_RESOURCES, {
            filter: (resource) => resource.amount > 500
        });
        if (resources.length > 0) {
            target = creep.pos.findClosestByRange(resources);
            if (target) {
                resType = target.resourceType;
                actionType = 'pickup';
            }
        }
    }

    if (!target) {
        const tombstones = room.find(FIND_TOMBSTONES, {
            filter: (t) => t.store.getUsedCapacity() > 0
        });
        if (tombstones.length > 0) {
            target = creep.pos.findClosestByRange(tombstones);
            if (target) {
                resType = pickMostStoredResource(target.store);
                actionType = resType ? 'withdraw' : undefined;
            }
        }
    }

    if (!target) {
        const ruins = room.find(FIND_RUINS, {
            filter: (ruin) => ruin.store.getUsedCapacity() > 0
        });
        if (ruins.length > 0) {
            target = creep.pos.findClosestByRange(ruins);
            if (target) {
                resType = pickMostStoredResource(target.store);
                actionType = resType ? 'withdraw' : undefined;
            }
        }
    }

    if (!target && room.storage && room.storage.store.getUsedCapacity() > 0) {
        target = room.storage;
        resType = pickMostStoredResource(room.storage.store);
        actionType = resType ? 'withdraw' : undefined;
    }

    if (!target && room.terminal && room.terminal.store.getUsedCapacity() > 0) {
        target = room.terminal;
        resType = pickMostStoredResource(room.terminal.store);
        actionType = resType ? 'withdraw' : undefined;
    }

    if (!target) {
        const containers = (room as any).container as StructureContainer[] | undefined;
        if (containers && containers.length) {
            const container = creep.pos.findClosestByRange(containers, {
                filter: (c) => c.store.getUsedCapacity() > 0
            })
            if (container) {
                target = container;
                resType = pickMostStoredResource(container.store);
                actionType = resType ? 'withdraw' : undefined;
            }
        }
    }

    if (!target || !actionType) {
        mem.idleUntil = Game.time + 10;
        return;
    }

    cache.targetId = target.id;
    cache.resType = resType;
    cache.actionType = actionType;

    if (actionType === 'pickup') {
        if (creep.pos.isNearTo(target)) {
            creep.pickup(target);
        } else {
            creep.moveTo(target, { maxRooms: 1, range: 1, ignoreCreeps: false });
        }
        return;
    }

    if (actionType === 'withdraw' && resType) {
        if (creep.pos.isNearTo(target)) {
            creep.withdraw(target, resType);
        } else {
            creep.moveTo(target, { maxRooms: 1, range: 1, ignoreCreeps: false });
        }
    }
}

/**
 * 送货逻辑：
 * - 回到 targetRoom；
 * - 优先入库 storage，其次 terminal；
 * - 无法存放时兜底 drop。
 *
 * @param creep 当前后勤 creep。
 */
function transfer(creep: Creep) {
    const mem = creep.memory as LogisticMemory;
    if (!mem.targetRoom) return;

    if (creep.room.name !== mem.targetRoom) {
        creep.moveToRoom(mem.targetRoom);
        return;
    }

    if (creep.store.getUsedCapacity() === 0) return;

    const room = creep.room;
    const resoureType = Object.keys(creep.store)[0] as ResourceConstant | undefined;
    if (!resoureType) return;

    if (room.storage && room.storage.store.getFreeCapacity(resoureType) > 0) {
        creep.goTransfer(room.storage, resoureType);
        return;
    }

    if (room.terminal && room.terminal.store.getFreeCapacity(resoureType) > 0) {
        creep.goTransfer(room.terminal, resoureType);
        return;
    }

    creep.drop(resoureType);
}

/**
 * WorkLayer 的 source 态回调。
 *
 * @param creep 当前后勤 creep。
 * @returns 满仓后切换到 target 态。
 */
const onSource = (creep: Creep): WorkEvent => {
    withdraw(creep);
    return creep.store.getFreeCapacity() === 0 ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
};

/**
 * WorkLayer 的 target 态回调。
 *
 * @param creep 当前后勤 creep。
 * @returns 清空后切换到 source 态。
 */
const onTarget = (creep: Creep): WorkEvent => {
    transfer(creep);
    return creep.store.getUsedCapacity() === 0 ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
};

/**
 * 通用物流角色入口。
 *
 * @remarks
 * 使用 WorkLayer 双态循环实现「取货 -> 送货」。
 */
const logisticWork = createWorkLayerRole({
    onSource,
    onTarget,
    reenter: true
});

const logisticFunction = createBoostedRole({
    boost: (creep) => {
        const boostmap = (creep.memory as any).boostmap;
        if (boostmap === null) return null;
        return boostmap || { [CARRY]: ['XKH2O', 'KH2O', 'KH'] as MineralBoostConstant[] };
    },
    run: logisticWork.run
});

export default logisticFunction;
