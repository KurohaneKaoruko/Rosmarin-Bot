import { THRESHOLDS } from '@/constant/Thresholds';

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
    const cache: Record<string, { time: number; ids: Set<string> }> = {};
    return (roomName: string): Set<string> => {
        const hit = cache[roomName];
        if (hit && hit.time === Game.time) return hit.ids;

        const ids = new Set<string>();
        for (const creep of Object.values(Game.creeps)) {
            if (!creep) continue;
            if (creep.memory?.role !== 'carrier') continue;
            if (creep.room.name !== roomName) continue;
            const sourceId = creep.memory.cacheSource?.sourceId || creep.memory.cacheTarget?.sourceId;
            if (sourceId) ids.add(sourceId);
        }
        cache[roomName] = { time: Game.time, ids };
        return ids;
    };
})();

const getPositiveStoreTypes = (store: StoreDefinition): ResourceConstant[] => {
    return (Object.keys(store) as ResourceConstant[]).filter(t => (store as any)[t] > 0);
};

const canCarryResourceSafely = (creep: Creep, resourceType: ResourceConstant): boolean => {
    if (resourceType === RESOURCE_ENERGY) return true;
    if (!creep.room.storage && !creep.room.terminal) return false;
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
    if (!storage && !terminal) return null;
    
    const controllerContainer = container?.find((c: StructureContainer) => c.pos.inRangeTo(controller, 1));
    const controllerLink = link?.find((l: StructureLink) => l.pos.inRangeTo(controller, 2));
    
    const needEnergy = creep.room.CheckSpawnAndTower() ||
                       (!controllerLink && controllerContainer?.store.getFreeCapacity(RESOURCE_ENERGY) > THRESHOLDS.ENERGY.CONTAINER_MIN);
    
    const storageEnergy = storage?.store[RESOURCE_ENERGY] || 0;
    const terminalEnergy = terminal?.store[RESOURCE_ENERGY] || 0;
    
    if (needEnergy) {
        // 优先从能量更多的结构取
        if (storageEnergy > THRESHOLDS.ENERGY.STORAGE_MIN && terminalEnergy > THRESHOLDS.ENERGY.STORAGE_MIN) {
            return storageEnergy < terminalEnergy ? terminal : storage;
        }
        if (storageEnergy > THRESHOLDS.ENERGY.STORAGE_MIN) return storage;
        if (terminalEnergy > THRESHOLDS.ENERGY.STORAGE_MIN) return terminal;
    }

    // 平衡 terminal 和 storage 的能量
    if (terminal && storage && terminalEnergy > THRESHOLDS.TRANSPORT.MIN_AMOUNT &&
        storage.store.getFreeCapacity() > THRESHOLDS.TRANSPORT.MIN_AMOUNT && terminalEnergy > storageEnergy) {
        return terminal;
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

const scoreByRange = (range: number) => Math.max(0, 30 - range * 2);

const selectWithdrawPlan = (creep: Creep): WithdrawPlan | null => {
    const { room, pos, store } = creep;
    const roomAny = room as any;

    cleanupRoomCarrierLocks(room.name);
    cleanupRoomCarrierNoPath(room.name);

    const claimed = getClaimedTargetIdsByCarrier(room.name);

    const urgentEnergy = room.CheckSpawnAndTower();
    const hasStorage = !!room.storage || !!room.terminal;
    const freeCap = store.getFreeCapacity();

    const candidates: { score: number; plan: WithdrawPlan }[] = [];

    // 优先级1：掉落资源（能量随时可收；非能量需要中心仓保障可存放）
    const dropped = room.find(FIND_DROPPED_RESOURCES, {
        filter: (r: Resource) => r.amount > 0
    });

    for (const r of dropped) {
        if (!canCarryResourceSafely(creep, r.resourceType)) continue;
        if (isNoPath(room.name, r.id)) continue;
        if (claimed.has(r.id) || isLockedByOtherCarrier(room.name, r.id, creep.name)) continue;

        const base = r.resourceType === RESOURCE_ENERGY ? 50 : 80;
        const amountScore = Math.min(30, Math.floor(r.amount / 100));
        const rangeScore = scoreByRange(pos.getRangeTo(r));

        // 能量掉落只有在数量较大时才抢占优先级，避免反复捡小堆
        if (r.resourceType === RESOURCE_ENERGY && r.amount < THRESHOLDS.ENERGY.PICKUP_THRESHOLD * 2) continue;

        candidates.push({
            score: base + amountScore + rangeScore,
            plan: { id: r.id, kind: 'dropped', resourceType: r.resourceType, lockTtl: 3 }
        });
    }

    // 优先级2：墓碑/废墟（回收衰减资源）
    const tombstones = room.find(FIND_TOMBSTONES, {
        filter: (t: Tombstone) => t.store.getUsedCapacity() > 0
    });
    for (const t of tombstones) {
        if (isNoPath(room.name, t.id)) continue;
        if (claimed.has(t.id) || isLockedByOtherCarrier(room.name, t.id, creep.name)) continue;
        const type = pickBestWithdrawTypeFromStore(creep, t.store, urgentEnergy ? 'energy' : 'nonEnergy');
        if (!type) continue;
        const amount = t.store.getUsedCapacity(type);
        if (type === RESOURCE_ENERGY && amount < 100) continue;

        candidates.push({
            score: 75 + Math.min(35, Math.floor(amount / 100)) + scoreByRange(pos.getRangeTo(t)),
            plan: { id: t.id, kind: 'tombstone', resourceType: type, lockTtl: 5 }
        });
    }

    const ruins = room.find(FIND_RUINS, {
        filter: (r: Ruin) => r.store.getUsedCapacity() > 0
    });
    for (const r of ruins) {
        if (isNoPath(room.name, r.id)) continue;
        if (claimed.has(r.id) || isLockedByOtherCarrier(room.name, r.id, creep.name)) continue;
        const type = pickBestWithdrawTypeFromStore(creep, r.store, urgentEnergy ? 'energy' : 'nonEnergy');
        if (!type) continue;
        const amount = r.store.getUsedCapacity(type);
        if (type === RESOURCE_ENERGY && amount < 100) continue;

        candidates.push({
            score: 70 + Math.min(35, Math.floor(amount / 100)) + scoreByRange(pos.getRangeTo(r)),
            plan: { id: r.id, kind: 'ruin', resourceType: type, lockTtl: 5 }
        });
    }

    // 优先级3：link/container
    const controller = room.controller;
    if (urgentEnergy || !hasStorage) {
        const links = (roomAny.link || []).filter((l: StructureLink) => l?.store[RESOURCE_ENERGY] > 0) as StructureLink[];
        for (const l of links) {
            if (isNoPath(room.name, l.id)) continue;
            if (claimed.has(l.id) || isLockedByOtherCarrier(room.name, l.id, creep.name)) continue;
            candidates.push({
                score: 55 + Math.min(35, Math.floor((l.store[RESOURCE_ENERGY] || 0) / 100)) + scoreByRange(pos.getRangeTo(l)),
                plan: { id: l.id, kind: 'link', resourceType: RESOURCE_ENERGY, lockTtl: 2 }
            });
        }
    }

    const containers = (roomAny.container || []).filter((c: StructureContainer) => c && c.store?.getUsedCapacity?.() > 0) as StructureContainer[];
    for (const c of containers) {
        if (isNoPath(room.name, c.id)) continue;
        if (controller && c.pos.inRangeTo(controller, 1) && (urgentEnergy || !hasStorage)) continue;
        if (claimed.has(c.id) || isLockedByOtherCarrier(room.name, c.id, creep.name)) continue;

        const prefer = urgentEnergy || !hasStorage ? 'energy' : 'nonEnergy';
        const type = pickBestWithdrawTypeFromStore(creep, c.store, prefer);
        if (!type) continue;

        const amount = c.store.getUsedCapacity(type);
        const min = Math.min(THRESHOLDS.ENERGY.PICKUP_LARGE * 0.666, freeCap);
        if (amount < Math.min(min, type === RESOURCE_ENERGY ? THRESHOLDS.ENERGY.CONTAINER_MIN * 0.3 : THRESHOLDS.ENERGY.PICKUP_THRESHOLD * 0.5)) continue;

        candidates.push({
            score: 45 + Math.min(35, Math.floor(amount / 100)) + scoreByRange(pos.getRangeTo(c)),
            plan: { id: c.id, kind: 'container', resourceType: type, lockTtl: 3 }
        });
    }

    // 优先级4：从 storage/terminal 取能量（仅用于补能模式的兜底）
    if (urgentEnergy && freeCap > 0) {
        const source = getStorageOrTerminal(creep) as (StructureStorage | StructureTerminal | null);
        if (source && source.store.getUsedCapacity(RESOURCE_ENERGY) > THRESHOLDS.ENERGY.STORAGE_MIN) {
            if (!isNoPath(room.name, source.id)) {
            candidates.push({
                score: 20 + Math.min(20, Math.floor(source.store.getUsedCapacity(RESOURCE_ENERGY) / 1000)) + scoreByRange(pos.getRangeTo(source)),
                plan: { id: source.id, kind: source.structureType === STRUCTURE_TERMINAL ? 'terminal' : 'storage', resourceType: RESOURCE_ENERGY, lockTtl: 1 }
            });
            }
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].plan;
};

// 收集资源阶段
const withdraw = (creep: Creep) => {
    const cache = getCarrierSourceCache(creep)
    const { pos, store, room } = creep;

    const targetId = cache.sourceId;
    if (targetId && !Game.getObjectById(targetId)) {
        cache.sourceId = undefined;
        cache.sourceKind = undefined;
        cache.resourceType = undefined;
    }

    if (!cache.sourceId) {
        const plan = selectWithdrawPlan(creep);
        if (!plan) return false;

        cache.sourceId = plan.id;
        cache.sourceKind = plan.kind;
        cache.resourceType = plan.resourceType;

        if (plan.lockTtl) {
            lockCarrierTarget(room.name, plan.id, creep.name, plan.lockTtl);
        }
    }

    const target = Game.getObjectById(cache.sourceId);
    if (!target) {
        cache.sourceId = undefined;
        cache.sourceKind = undefined;
        cache.resourceType = undefined;
        return false;
    }

    if ((target as Resource).amount !== undefined) {
        const res = target as Resource;
        if (res.amount <= 0) {
            cache.sourceId = undefined;
            cache.sourceKind = undefined;
            cache.resourceType = undefined;
            return false;
        }
        if (pos.inRangeTo(res, 1)) {
            const result = creep.pickup(res);
            return result === OK && res.amount >= store.getFreeCapacity();
        }
        const ret = creep.moveTo(res, { visualizePathStyle: { stroke: '#ffaa00' } });
        if (ret === ERR_NO_PATH) {
            markNoPath(room.name, res.id, 100);
            cache.sourceId = undefined;
            cache.sourceKind = undefined;
            cache.resourceType = undefined;
        }
        return false;
    }

    const storeTarget = target as any;
    const resourceType = cache.resourceType || RESOURCE_ENERGY;
    const used = storeTarget.store?.getUsedCapacity?.(resourceType) ?? 0;
    if (used <= 0) {
        if (storeTarget.structureType !== STRUCTURE_LINK || pos.inRangeTo(storeTarget, 1)) {
            cache.sourceId = undefined;
            cache.sourceKind = undefined;
            cache.resourceType = undefined;
            return false;
        }
    }

    if (pos.inRangeTo(storeTarget, 1)) {
        const result = creep.withdraw(storeTarget, resourceType);
        return result === OK && storeTarget.store[resourceType] >= store.getFreeCapacity();
    }

    const ret = creep.moveTo(storeTarget, { visualizePathStyle: { stroke: '#ffaa00' } });
    if (ret === ERR_NO_PATH) {
        markNoPath(room.name, storeTarget.id, 100);
        cache.sourceId = undefined;
        cache.sourceKind = undefined;
        cache.resourceType = undefined;
        return false;
    }
};

// 运送资源阶段
const carry = (creep: Creep) => {
    const { store, room, pos } = creep;
    const roomAny = room as any;
    const cache = getCarrierTargetCache(creep)

    const carryTypes = getCreepCarryTypesSorted(creep);
    if (carryTypes.length === 0) return true;

    const currentType = cache.resourceType && store[cache.resourceType] > 0 ? cache.resourceType : undefined;
    const currentTarget = cache.targetId ? (Game.getObjectById(cache.targetId) as any) : null;

    const needNewTarget =
        !currentType ||
        !currentTarget ||
        !currentTarget.store?.getFreeCapacity ||
        currentTarget.store.getFreeCapacity(currentType) <= 0;

    let target: AnyStoreStructure | null = (currentTarget?.store?.getFreeCapacity ? currentTarget : null);
    let resourceType: ResourceConstant = currentType || carryTypes[0];

    if (needNewTarget) {
        cache.targetId = undefined;
        cache.resourceType = undefined;

        const urgentEnergy = room.CheckSpawnAndTower();
        const controllerContainer = roomAny.container?.find((c: StructureContainer) =>
            c.pos.inRangeTo(room.controller, 1));
        const controllerLink = roomAny.link?.find((l: StructureLink) =>
            l.pos.inRangeTo(room.controller, 2));

        for (const t of carryTypes) {
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

    if (!target) {
        const dropType = carryTypes.find(t => store[t] > 0);
        if (!dropType) return true;

        const anchor = room.storage || room.terminal || pos.findClosestByRange(roomAny.spawn || []);
        if (anchor && pos.getRangeTo(anchor) > 2) {
            creep.moveTo(anchor, { visualizePathStyle: { stroke: '#ffffff' } });
            return;
        }
        creep.drop(dropType);
        cache.targetId = undefined;
        cache.resourceType = undefined;
        return;
    }

    if (pos.inRangeTo(target, 1)) {
        const transferResult = creep.transfer(target, resourceType);
        if (transferResult === OK) {
            cache.targetId = undefined;
            cache.resourceType = undefined;
            if (creep.store.getUsedCapacity() === 0) return true;
            return;
        }
        if (transferResult === ERR_FULL) {
            cache.targetId = undefined;
            cache.resourceType = undefined;
            return;
        }
        cache.targetId = undefined;
        cache.resourceType = undefined;
        return;
    }

    const ret = creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
    if (ret === ERR_NO_PATH) {
        markNoPath(room.name, target.id, 100);
        cache.targetId = undefined;
        cache.resourceType = undefined;
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
        return withdraw(creep);
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
