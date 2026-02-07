type LogisticCache = {
    targetId?: Id<any>;
    resType?: ResourceConstant;
    actionType?: 'pickup' | 'withdraw';
};

type LogisticMemory = CreepMemory & {
    sourceRoom?: string;
    targetRoom?: string;
    idleUntil?: number;
    cacheSource?: LogisticCache;
};

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

const isCacheValid = (target: any, actionType: LogisticCache['actionType'], resType: ResourceConstant | undefined): boolean => {
    if (!target) return false;
    if (actionType === 'pickup') return typeof target.amount === 'number' && target.amount > 0;
    if (actionType === 'withdraw') {
        if (!resType) return false;
        return !!target.store && target.store.getUsedCapacity(resType) > 0;
    }
    return false;
};

function withdraw(creep: Creep) {
    const mem = creep.memory as LogisticMemory;
    if (!mem.sourceRoom) return;

    if (creep.room.name !== mem.sourceRoom) {
        creep.moveToRoom(mem.sourceRoom);
        return;
    }

    if (mem.idleUntil && Game.time < mem.idleUntil) return;

    const room = creep.room;
    const cache = (mem.cacheSource ||= {});
    let target = cache.targetId ? (Game.getObjectById(cache.targetId) as any) : null;
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

const logisticFunction = {
    prepare: function (creep: Creep) {
        const boostmap = (creep.memory as any).boostmap
        if (boostmap === null) {
            creep.memory.boosted = true
            return true
        }
        if (boostmap) {
            const ret = creep.goBoost(boostmap)
            creep.memory.boosted = ret === OK
            return creep.memory.boosted
        }
        const boosts = ['XKH2O', 'KH2O', 'KH'] as MineralBoostConstant[]
        const result = creep.goBoost({ [CARRY]: boosts })
        creep.memory.boosted = result === OK
        return creep.memory.boosted
    },
    source: function (creep: Creep) {
        withdraw(creep);
        return creep.store.getFreeCapacity() === 0;
    },
    target: function (creep: Creep) {
        transfer(creep);
        return creep.store.getUsedCapacity() === 0;
    }
};

export default logisticFunction;
