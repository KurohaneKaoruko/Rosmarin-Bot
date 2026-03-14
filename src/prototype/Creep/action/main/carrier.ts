import { THRESHOLDS } from '@/constant/Thresholds';
import { getCoreDepotContainer, getCoreDepotTarget, hasCoreDepotTarget, isCoreDepotContainer } from '@/modules/utils/coreDepot';

type CarrierLockEntry = {
    name: string;
    expire: number;
};

type CarrierCache = {
    sourceId?: Id<any>;
    sourceKind?: 'dropped' | 'tombstone' | 'ruin' | 'container' | 'link' | 'storage' | 'terminal';
    targetId?: Id<any>;
    resourceType?: ResourceConstant;
};

const getCarrierSourceCache = (creep: Creep): CarrierCache => {
    creep.memory.cacheSource = creep.memory.cacheSource || {}
    return creep.memory.cacheSource as CarrierCache
}

const getCarrierTargetCache = (creep: Creep): CarrierCache => {
    creep.memory.cacheTarget = creep.memory.cacheTarget || {}
    return creep.memory.cacheTarget as CarrierCache
}

const getRoomCarrierLocks = (roomName: string): Record<string, CarrierLockEntry> => {
    const roomMem = ((Memory.rooms as any)[roomName] ||= {});
    return (roomMem.carrierLocks ||= {}) as Record<string, CarrierLockEntry>;
};

const getRoomCarrierNoPath = (roomName: string): Record<string, number> => {
    const roomMem = ((Memory.rooms as any)[roomName] ||= {});
    return (roomMem.carrierNoPath ||= {}) as Record<string, number>;
};

const cleanupRoomCarrierLocks = (roomName: string) => {
    const locks = getRoomCarrierLocks(roomName);
    for (const id in locks) {
        if (locks[id].expire <= Game.time) delete locks[id];
    }
};

const cleanupRoomCarrierNoPath = (roomName: string) => {
    const noPath = getRoomCarrierNoPath(roomName);
    for (const id in noPath) {
        if (noPath[id] <= Game.time) delete noPath[id];
    }
};

const isLockedByOtherCarrier = (roomName: string, id: string, creepName: string): boolean => {
    const lock = getRoomCarrierLocks(roomName)[id];
    return !!lock && lock.expire > Game.time && lock.name !== creepName;
};

const isNoPath = (roomName: string, id: string): boolean => {
    const expire = getRoomCarrierNoPath(roomName)[id];
    return typeof expire === 'number' && expire > Game.time;
};

const markNoPath = (roomName: string, id: string, ttl: number) => {
    if (!id) return;
    const noPath = getRoomCarrierNoPath(roomName);
    noPath[id] = Game.time + ttl;
};

const lockCarrierTarget = (roomName: string, id: string, creepName: string, ttl: number) => {
    const locks = getRoomCarrierLocks(roomName);
    locks[id] = { name: creepName, expire: Game.time + ttl };
};

const getClaimedTargetIdsByCarrier = (() => {
    let cachedTick = -1;
    let byRoom: Record<string, Set<string>> = {};
    const EMPTY_IDS = new Set<string>();
    return (roomName: string): Set<string> => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            byRoom = {};
            for (const creepName in Game.creeps) {
                const creep = Game.creeps[creepName];
                if (!creep) continue;
                if (creep.memory?.role !== 'carrier') continue;
                const sourceId = creep.memory.cacheSource?.sourceId || creep.memory.cacheTarget?.sourceId;
                if (!sourceId) continue;
                const creepRoom = creep.room.name;
                if (!byRoom[creepRoom]) byRoom[creepRoom] = new Set<string>();
                byRoom[creepRoom].add(sourceId);
            }
        }
        return byRoom[roomName] || EMPTY_IDS;
    };
})();

const getPositiveStoreTypes = (store: StoreDefinition): ResourceConstant[] => {
    return (Object.keys(store) as ResourceConstant[]).filter(t => (store as any)[t] > 0);
};

const canCarryResourceSafely = (creep: Creep, resourceType: ResourceConstant): boolean => {
    if (resourceType === RESOURCE_ENERGY) return true;
    if (!hasCoreDepotTarget(creep.room)) return false;
    return !!creep.findBestStoreTarget(resourceType);
};

const getCreepCarryTypesSorted = (creep: Creep): ResourceConstant[] => {
    const types = getPositiveStoreTypes(creep.store);
    if (types.length <= 1) return types;

    const urgentEnergy = creep.room.CheckSpawnAndTower();

    types.sort((a, b) => {
        if (urgentEnergy) {
            if (a === RESOURCE_ENERGY && b !== RESOURCE_ENERGY) return -1;
            if (b === RESOURCE_ENERGY && a !== RESOURCE_ENERGY) return 1;
        } else {
            if (a === RESOURCE_ENERGY && b !== RESOURCE_ENERGY) return 1;
            if (b === RESOURCE_ENERGY && a !== RESOURCE_ENERGY) return -1;
        }
        return (creep.store[b] || 0) - (creep.store[a] || 0);
    });

    return types;
};

const pickBestWithdrawTypeFromStore = (
    creep: Creep,
    store: StoreDefinition,
    prefer?: 'energy' | 'nonEnergy'
): ResourceConstant | null => {
    const types = getPositiveStoreTypes(store);
    if (types.length === 0) return null;

    if (prefer === 'energy' && (store as any)[RESOURCE_ENERGY] > 0) return RESOURCE_ENERGY;

    if (prefer === 'nonEnergy') {
        const candidates = types.filter(t => t !== RESOURCE_ENERGY && canCarryResourceSafely(creep, t));
        if (candidates.length > 0) {
            candidates.sort((a, b) => ((store as any)[b] || 0) - ((store as any)[a] || 0));
            return candidates[0];
        }
    }

    if ((store as any)[RESOURCE_ENERGY] > 0) return RESOURCE_ENERGY;

    const fallback = types.find(t => canCarryResourceSafely(creep, t));
    return fallback || null;
};

// 获取 storage 或 terminal 作为能量来源
const getStorageOrTerminal = (creep: Creep) => {
    const { storage, terminal, container, link, controller } = creep.room as any;
    const storageFallback = storage || getCoreDepotContainer(creep.room, 'storage');
    const terminalFallback = terminal || getCoreDepotContainer(creep.room, 'terminal');
    if (!storageFallback && !terminalFallback) return null;
    
    const controllerContainer = container?.find((c: StructureContainer) => c.pos.inRangeTo(controller, 1));
    const controllerLink = link?.find((l: StructureLink) => l.pos.inRangeTo(controller, 2));
    
    const needEnergy = creep.room.CheckSpawnAndTower() ||
                       (!controllerLink && controllerContainer?.store.getFreeCapacity(RESOURCE_ENERGY) > THRESHOLDS.ENERGY.CONTAINER_MIN);
    
    const storageEnergy = storageFallback?.store[RESOURCE_ENERGY] || 0;
    const terminalEnergy = terminalFallback?.store[RESOURCE_ENERGY] || 0;
    const getMinEnergy = (target: AnyStoreStructure | null) =>
        target?.structureType === STRUCTURE_CONTAINER ? THRESHOLDS.ENERGY.CONTAINER_MIN : THRESHOLDS.ENERGY.STORAGE_MIN;
    
    if (needEnergy) {
        // 优先从能量更多的结构取
        if (storageEnergy > getMinEnergy(storageFallback) && terminalEnergy > getMinEnergy(terminalFallback)) {
            return storageEnergy < terminalEnergy ? terminalFallback : storageFallback;
        }
        if (storageEnergy > getMinEnergy(storageFallback)) return storageFallback;
        if (terminalEnergy > getMinEnergy(terminalFallback)) return terminalFallback;
    }

    // 平衡 terminal 和 storage 的能量
    if (terminalFallback && storageFallback && terminalEnergy > THRESHOLDS.TRANSPORT.MIN_AMOUNT &&
        storageFallback.store.getFreeCapacity() > THRESHOLDS.TRANSPORT.MIN_AMOUNT && terminalEnergy > storageEnergy) {
        return terminalFallback;
    }
    
    return null;
};

// 路过时顺便填充附近的 extension
const checkAndFillNearbyExtensions = (creep: Creep) => {
    const { pos, room, store, memory } = creep;
    const energyAvailable = store[RESOURCE_ENERGY];
    
    if (energyAvailable <= 50) {
        return false;
    }

    const urgentEnergy = room.CheckSpawnAndTower();
    const nearStorage = !!room.storage && pos.getRangeTo(room.storage) <= 10;
    if (!urgentEnergy && !nearStorage) {
        return false;
    }

    const lastPos = memory.lastCheckPos as { x: number; y: number } | undefined;
    const moved = lastPos ? Math.abs(lastPos.x - pos.x) + Math.abs(lastPos.y - pos.y) : 2;

    // 移动超过1格时重新扫描附近可补能目标
    if (!memory.nearbyExtensions || moved > 1) {
        const structures = room.lookForAtArea(
            LOOK_STRUCTURES,
            Math.max(0, pos.y - 1), Math.max(0, pos.x - 1),
            Math.min(49, pos.y + 1), Math.min(49, pos.x + 1),
            true
        );
        memory.nearbyExtensions = structures
            .filter(item => 
                (item.structure.structureType === STRUCTURE_EXTENSION ||
                    item.structure.structureType === STRUCTURE_SPAWN ||
                    (urgentEnergy && item.structure.structureType === STRUCTURE_TOWER) ||
                    (urgentEnergy && item.structure.structureType === STRUCTURE_POWER_SPAWN)) &&
                (item.structure as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
            )
            .map(item => item.structure.id);
        memory.lastCheckPos = { x: pos.x, y: pos.y };
    }

    const extensions = memory.nearbyExtensions as Id<AnyStoreStructure>[];
    for (let i = 0; i < extensions.length; i++) {
        const ext = Game.getObjectById(extensions[i]) as AnyStoreStructure | null;
        if (!ext) continue;
        if (ext.structureType === STRUCTURE_TOWER && ext.store.getFreeCapacity(RESOURCE_ENERGY) <= THRESHOLDS.TOWER.HEAL_THRESHOLD) continue;
        if (ext.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            if (creep.transfer(ext, RESOURCE_ENERGY) === OK) {
                extensions.splice(i, 1);
                if (extensions.length === 0) delete memory.nearbyExtensions;
                return true;
            }
        }
    }
    return false;
};

type WithdrawPlan = {
    id: Id<any>;
    kind: CarrierCache['sourceKind'];
    resourceType?: ResourceConstant;
    lockTtl?: number;
};

type WithdrawCandidate = {
    priority: number;
    range: number;
    amount: number;
    plan: WithdrawPlan;
};

const clearCarrierSourceCache = (cache: CarrierCache) => {
    cache.sourceId = undefined;
    cache.sourceKind = undefined;
    cache.resourceType = undefined;
};

const clearCarrierTargetCache = (cache: CarrierCache) => {
    cache.targetId = undefined;
    cache.resourceType = undefined;
};

const compareWithdrawCandidate = (a: WithdrawCandidate, b: WithdrawCandidate) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.range !== b.range) return a.range - b.range;
    return b.amount - a.amount;
};

const selectWithdrawPlan = (creep: Creep, excludeId?: Id<any>): WithdrawPlan | null => {
    const { room, pos, store } = creep;
    const roomAny = room as any;

    cleanupRoomCarrierLocks(room.name);
    cleanupRoomCarrierNoPath(room.name);

    const claimed = getClaimedTargetIdsByCarrier(room.name);

    const urgentEnergy = room.CheckSpawnAndTower();
    const hasStorage = hasCoreDepotTarget(room);
    const freeCap = store.getFreeCapacity();

    const candidates: WithdrawCandidate[] = [];

    // 优先级1：掉落资源（能量随时可收；非能量需要中心仓保障可存放）
    const dropped = room.find(FIND_DROPPED_RESOURCES, {
        filter: (r: Resource) => r.amount > 0
    });

    for (const r of dropped) {
        if (excludeId && r.id === excludeId) continue;
        if (!canCarryResourceSafely(creep, r.resourceType)) continue;
        if (isNoPath(room.name, r.id)) continue;
        if (claimed.has(r.id) || isLockedByOtherCarrier(room.name, r.id, creep.name)) continue;

        const priority = r.resourceType === RESOURCE_ENERGY ? 50 : 80;

        // 能量掉落只有在数量较大时才抢占优先级，避免反复捡小堆
        if (r.resourceType === RESOURCE_ENERGY && r.amount < THRESHOLDS.ENERGY.PICKUP_THRESHOLD * 2) continue;

        candidates.push({
            priority,
            range: pos.getRangeTo(r),
            amount: r.amount,
            plan: { id: r.id, kind: 'dropped', resourceType: r.resourceType, lockTtl: 3 }
        });
    }

    // 优先级2：墓碑/废墟（回收衰减资源）
    const tombstones = room.find(FIND_TOMBSTONES, {
        filter: (t: Tombstone) => t.store.getUsedCapacity() > 0
    });
    for (const t of tombstones) {
        if (excludeId && t.id === excludeId) continue;
        if (isNoPath(room.name, t.id)) continue;
        if (claimed.has(t.id) || isLockedByOtherCarrier(room.name, t.id, creep.name)) continue;
        const type = pickBestWithdrawTypeFromStore(creep, t.store, urgentEnergy ? 'energy' : 'nonEnergy');
        if (!type) continue;
        const amount = t.store.getUsedCapacity(type);
        if (type === RESOURCE_ENERGY && amount < 100) continue;

        candidates.push({
            priority: 75,
            range: pos.getRangeTo(t),
            amount,
            plan: { id: t.id, kind: 'tombstone', resourceType: type, lockTtl: 5 }
        });
    }

    const ruins = room.find(FIND_RUINS, {
        filter: (r: Ruin) => r.store.getUsedCapacity() > 0
    });
    for (const r of ruins) {
        if (excludeId && r.id === excludeId) continue;
        if (isNoPath(room.name, r.id)) continue;
        if (claimed.has(r.id) || isLockedByOtherCarrier(room.name, r.id, creep.name)) continue;
        const type = pickBestWithdrawTypeFromStore(creep, r.store, urgentEnergy ? 'energy' : 'nonEnergy');
        if (!type) continue;
        const amount = r.store.getUsedCapacity(type);
        if (type === RESOURCE_ENERGY && amount < 100) continue;

        candidates.push({
            priority: 70,
            range: pos.getRangeTo(r),
            amount,
            plan: { id: r.id, kind: 'ruin', resourceType: type, lockTtl: 5 }
        });
    }

    // 优先级3：link/container
    const controller = room.controller;
    if (urgentEnergy || !hasStorage) {
        const links = (roomAny.link || []).filter((l: StructureLink) => l?.store[RESOURCE_ENERGY] > 0) as StructureLink[];
        for (const l of links) {
            if (excludeId && l.id === excludeId) continue;
            if (isNoPath(room.name, l.id)) continue;
            if (claimed.has(l.id) || isLockedByOtherCarrier(room.name, l.id, creep.name)) continue;
            candidates.push({
                priority: 55,
                range: pos.getRangeTo(l),
                amount: l.store[RESOURCE_ENERGY] || 0,
                plan: { id: l.id, kind: 'link', resourceType: RESOURCE_ENERGY, lockTtl: 2 }
            });
        }
    }

    const containers = (roomAny.container || []).filter((c: StructureContainer) => c && c.store?.getUsedCapacity?.() > 0) as StructureContainer[];
    for (const c of containers) {
        if (excludeId && c.id === excludeId) continue;
        if (isNoPath(room.name, c.id)) continue;
        if (isCoreDepotContainer(room, c)) continue;
        if (controller && c.pos.inRangeTo(controller, 1) && (urgentEnergy || !hasStorage)) continue;
        if (claimed.has(c.id) || isLockedByOtherCarrier(room.name, c.id, creep.name)) continue;

        const prefer = urgentEnergy || !hasStorage ? 'energy' : 'nonEnergy';
        const type = pickBestWithdrawTypeFromStore(creep, c.store, prefer);
        if (!type) continue;

        const amount = c.store.getUsedCapacity(type);
        const min = Math.min(THRESHOLDS.ENERGY.PICKUP_LARGE * 0.666, freeCap);
        if (amount < Math.min(min, type === RESOURCE_ENERGY ? THRESHOLDS.ENERGY.CONTAINER_MIN * 0.3 : THRESHOLDS.ENERGY.PICKUP_THRESHOLD * 0.5)) continue;

        candidates.push({
            priority: 45,
            range: pos.getRangeTo(c),
            amount,
            plan: { id: c.id, kind: 'container', resourceType: type, lockTtl: 3 }
        });
    }

    // 优先级4：从 storage/terminal 取能量（仅用于补能模式的兜底）
    if (urgentEnergy && freeCap > 0) {
        const source = getStorageOrTerminal(creep) as AnyStoreStructure | null;
        const minAmount = source?.structureType === STRUCTURE_CONTAINER ? THRESHOLDS.ENERGY.CONTAINER_MIN : THRESHOLDS.ENERGY.STORAGE_MIN;
        if (source && source.store.getUsedCapacity(RESOURCE_ENERGY) > minAmount) {
            if ((!excludeId || source.id !== excludeId) && !isNoPath(room.name, source.id)) {
            candidates.push({
                priority: 20,
                range: pos.getRangeTo(source),
                amount: source.store.getUsedCapacity(RESOURCE_ENERGY),
                plan: { id: source.id, kind: source.structureType === STRUCTURE_TERMINAL ? 'terminal' : source.structureType === STRUCTURE_STORAGE ? 'storage' : 'container', resourceType: RESOURCE_ENERGY, lockTtl: 1 }
            });
            }
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort(compareWithdrawCandidate);
    return candidates[0].plan;
};

const cacheWithdrawPlan = (creep: Creep, plan: WithdrawPlan) => {
    const cache = getCarrierSourceCache(creep);
    cache.sourceId = plan.id;
    cache.sourceKind = plan.kind;
    cache.resourceType = plan.resourceType;
    if (plan.lockTtl) {
        lockCarrierTarget(creep.room.name, plan.id, creep.name, plan.lockTtl);
    }
};

const moveToNextWithdrawTarget = (creep: Creep, excludeId?: Id<any>) => {
    const cache = getCarrierSourceCache(creep);
    clearCarrierSourceCache(cache);
    const plan = selectWithdrawPlan(creep, excludeId);
    if (!plan) return false;

    cacheWithdrawPlan(creep, plan);
    const nextTarget = Game.getObjectById(plan.id) as any;
    if (!nextTarget) {
        clearCarrierSourceCache(cache);
        return false;
    }
    if (creep.pos.inRangeTo(nextTarget, 1)) return true;

    const ret = creep.moveTo(nextTarget, { visualizePathStyle: { stroke: '#ffaa00' } });
    if (ret === ERR_NO_PATH) {
        markNoPath(creep.room.name, plan.id, 100);
        clearCarrierSourceCache(cache);
        return false;
    }
    return true;
};

const resolveCarryTarget = (creep: Creep, forceRetarget: boolean = false) => {
    const { store, room, pos } = creep;
    const roomAny = room as any;
    const cache = getCarrierTargetCache(creep)

    const carryTypes = getCreepCarryTypesSorted(creep);
    if (carryTypes.length === 0) return { carryTypes, target: null as AnyStoreStructure | null, resourceType: undefined as ResourceConstant | undefined };

    const currentType = !forceRetarget && cache.resourceType && store[cache.resourceType] > 0 ? cache.resourceType : undefined;
    const currentTarget = !forceRetarget && cache.targetId ? (Game.getObjectById(cache.targetId) as any) : null;

    const needNewTarget =
        forceRetarget ||
        !currentType ||
        !currentTarget ||
        !currentTarget.store?.getFreeCapacity ||
        currentTarget.store.getFreeCapacity(currentType) <= 0;

    let target: AnyStoreStructure | null = (currentTarget?.store?.getFreeCapacity ? currentTarget : null);
    let resourceType: ResourceConstant = currentType || carryTypes[0];

    if (needNewTarget) {
        clearCarrierTargetCache(cache);

        const urgentEnergy = room.CheckSpawnAndTower();
        const controllerContainer = roomAny.container?.find((c: StructureContainer) =>
            c.pos.inRangeTo(room.controller, 1));
        const controllerLink = roomAny.link?.find((l: StructureLink) =>
            l.pos.inRangeTo(room.controller, 2));

        for (const t of carryTypes) {
            target = null;
            if (t === RESOURCE_ENERGY) {
                if (urgentEnergy) {
                    const spawnExtensions = [...(roomAny.spawn || []), ...(roomAny.extension || [])]
                        .filter((e: StructureSpawn | StructureExtension) => e?.store.getFreeCapacity(RESOURCE_ENERGY) > 0);

                    target = pos.findClosestByRange(spawnExtensions) ||
                        pos.findClosestByRange((roomAny.tower || [])
                            .filter((tw: StructureTower) => tw?.store.getFreeCapacity(RESOURCE_ENERGY) > 100));

                    if (!target && roomAny.powerSpawn?.store.getFreeCapacity(RESOURCE_ENERGY) > 100) {
                        target = roomAny.powerSpawn;
                    }
                } else if (!controllerLink && controllerContainer && controllerContainer.store.getFreeCapacity() > 0) {
                    target = controllerContainer;
                }

                if (!target) target = creep.findBestStoreTarget(RESOURCE_ENERGY);
            } else {
                target = creep.findBestStoreTarget(t);
            }

            if (target && !isNoPath(room.name, target.id) && target.store.getFreeCapacity(t) > 0) {
                resourceType = t;
                cache.targetId = target.id;
                cache.resourceType = t;
                break;
            }
        }
    }

    return { carryTypes, target, resourceType };
};

const moveToNextCarryTarget = (creep: Creep) => {
    const { room, pos } = creep;
    const roomAny = room as any;
    const cache = getCarrierTargetCache(creep);
    const { carryTypes, target } = resolveCarryTarget(creep, true);
    if (carryTypes.length === 0) return false;

    if (!target) {
        const dropType = carryTypes.find(t => creep.store[t] > 0);
        if (!dropType) return false;

        const anchor = getCoreDepotTarget(room, 'storage') || getCoreDepotTarget(room, 'terminal') || pos.findClosestByRange(roomAny.spawn || []);
        if (anchor && pos.getRangeTo(anchor) > 2) {
            creep.moveTo(anchor, { visualizePathStyle: { stroke: '#ffffff' } });
            return true;
        }
        clearCarrierTargetCache(cache);
        return false;
    }

    if (pos.inRangeTo(target, 1)) return true;

    const ret = creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
    if (ret === ERR_NO_PATH) {
        markNoPath(room.name, target.id, 100);
        clearCarrierTargetCache(cache);
        return false;
    }
    return true;
};

// 收集资源阶段
const withdraw = (creep: Creep) => {
    const cache = getCarrierSourceCache(creep)
    const { pos, store, room } = creep;

    const targetId = cache.sourceId;
    if (targetId && !Game.getObjectById(targetId)) {
        clearCarrierSourceCache(cache);
    }

    if (!cache.sourceId) {
        const plan = selectWithdrawPlan(creep);
        if (!plan) return false;

        cacheWithdrawPlan(creep, plan);
    }

    const target = Game.getObjectById(cache.sourceId);
    if (!target) {
        clearCarrierSourceCache(cache);
        return false;
    }

    if ((target as Resource).amount !== undefined) {
        const res = target as Resource;
        if (res.amount <= 0) {
            clearCarrierSourceCache(cache);
            return false;
        }
        if (pos.inRangeTo(res, 1)) {
            const available = res.amount;
            const result = creep.pickup(res);
            if (result === OK) {
                const fullAfterTake = available >= store.getFreeCapacity();
                if (fullAfterTake) return true;
                moveToNextWithdrawTarget(creep, res.id);
                return false;
            }
            if (result === ERR_FULL) return true;
            clearCarrierSourceCache(cache);
            return false;
        }
        const ret = creep.moveTo(res, { visualizePathStyle: { stroke: '#ffaa00' } });
        if (ret === ERR_NO_PATH) {
            markNoPath(room.name, res.id, 100);
            clearCarrierSourceCache(cache);
        }
        return false;
    }

    const storeTarget = target as any;
    const resourceType = cache.resourceType || RESOURCE_ENERGY;
    const used = storeTarget.store?.getUsedCapacity?.(resourceType) ?? 0;
    if (used <= 0) {
        if (storeTarget.structureType !== STRUCTURE_LINK || pos.inRangeTo(storeTarget, 1)) {
            clearCarrierSourceCache(cache);
            return false;
        }
    }

    if (pos.inRangeTo(storeTarget, 1)) {
        const available = storeTarget.store[resourceType] || 0;
        const result = creep.withdraw(storeTarget, resourceType);
        if (result === OK) {
            const fullAfterTake = available >= store.getFreeCapacity();
            if (fullAfterTake) return true;
            moveToNextWithdrawTarget(creep, storeTarget.id);
            return false;
        }
        if (result === ERR_FULL) return true;
        clearCarrierSourceCache(cache);
        return false;
    }

    const ret = creep.moveTo(storeTarget, { visualizePathStyle: { stroke: '#ffaa00' } });
    if (ret === ERR_NO_PATH) {
        markNoPath(room.name, storeTarget.id, 100);
        clearCarrierSourceCache(cache);
        return false;
    }
};

// 运送资源阶段
const carry = (creep: Creep) => {
    const { store, room, pos } = creep;
    const roomAny = room as any;
    const cache = getCarrierTargetCache(creep)

    const { carryTypes, target, resourceType } = resolveCarryTarget(creep);
    if (carryTypes.length === 0) return true;

    if (!target) {
        const dropType = carryTypes.find(t => store[t] > 0);
        if (!dropType) return true;

        const anchor = getCoreDepotTarget(room, 'storage') || getCoreDepotTarget(room, 'terminal') || pos.findClosestByRange(roomAny.spawn || []);
        if (anchor && pos.getRangeTo(anchor) > 2) {
            creep.moveTo(anchor, { visualizePathStyle: { stroke: '#ffffff' } });
            return;
        }
        creep.drop(dropType);
        clearCarrierTargetCache(cache);
        return;
    }

    if (pos.inRangeTo(target, 1)) {
        const transferResult = creep.transfer(target, resourceType);
        if (transferResult === OK) {
            clearCarrierTargetCache(cache);
            if (creep.store.getUsedCapacity() === 0) return true;
            moveToNextCarryTarget(creep);
            return;
        }
        if (transferResult === ERR_FULL) {
            clearCarrierTargetCache(cache);
            return;
        }
        clearCarrierTargetCache(cache);
        return;
    }

    const ret = creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
    if (ret === ERR_NO_PATH) {
        markNoPath(room.name, target.id, 100);
        clearCarrierTargetCache(cache);
        return;
    }
};

// 生成安全模式
const goGenerateSafeMode = (creep: Creep): boolean => {
    const controller = creep.room.controller;
    if (!controller?.my || controller.level < 7 || controller.safeModeAvailable > 0) {
        return false;
    }
    
    const ghodiumNeeded = 1000;
    if (creep.store[RESOURCE_GHODIUM] < ghodiumNeeded) {
        if (creep.store.getCapacity() < ghodiumNeeded) return false;
        
        const source = [creep.room.storage, creep.room.terminal]
            .find(s => s && s.store[RESOURCE_GHODIUM] >= ghodiumNeeded);
        if (!source) return false;
        
        creep.goWithdraw(source, RESOURCE_GHODIUM, ghodiumNeeded);
        return true;
    }
    
    if (creep.pos.isNearTo(controller)) {
        creep.generateSafeMode(controller);
    } else {
        creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
    }
    return true;
};



// Carrier 主逻辑
const CarrierFunction = {
    source: (creep: Creep) => {
        if (!creep.moveHomeRoom()) return;
        if (creep.store.getFreeCapacity() === 0) {
            carry(creep)
            return true
        }
        if (goGenerateSafeMode(creep)) return;
        const result = withdraw(creep);
        if (result) return true;

        // 源侧暂时断流时，允许带着半仓资源先回去交付，避免卡在 source 态空转。
        if (creep.store.getUsedCapacity() > 0 && !getCarrierSourceCache(creep).sourceId) {
            carry(creep);
            return true;
        }

        return result;
    },
    target: (creep: Creep) => {
        if (!creep.moveHomeRoom()) return;
        if (creep.store.getUsedCapacity() === 0) {
            withdraw(creep)
            return true
        }
        if (checkAndFillNearbyExtensions(creep)) return;
        return carry(creep);;
    },
};

export default CarrierFunction;

export { getStorageOrTerminal, selectWithdrawPlan };
