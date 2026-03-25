import { THRESHOLDS } from '@/constant/Thresholds';
import {
    getCoreDepotContainer,
    getCoreDepotKindAtPos,
    getCoreDepotTarget,
    hasCoreDepotTarget,
    isCoreDepotContainer
} from '@/shared/coreDepot';
import { runWorkLayer } from '@/framework/ai/adapters';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

type CarrierCache = {
    sourceId?: Id<any>;
    sourceKind?: 'dropped' | 'tombstone' | 'ruin' | 'container' | 'link' | 'storage' | 'terminal';
    targetId?: Id<any>;
    resourceType?: ResourceConstant;
    /**
     * 记录当前载荷是从哪个“仓储型目标”借出来的，
     * 用于避免 carrier 在中心仓/中央 container 上出现“取一下又放回去”的空转。
     */
    avoidReturnTargetId?: Id<any>;
    avoidReturnResourceType?: ResourceConstant;
};

const getCarrierSourceCache = (creep: Creep): CarrierCache => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    return (cache.source && typeof cache.source === 'object' ? cache.source : (cache.source = {})) as CarrierCache;
}

const getCarrierTargetCache = (creep: Creep): CarrierCache => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    return (cache.target && typeof cache.target === 'object' ? cache.target : (cache.target = {})) as CarrierCache;
}

/**
 * 清理“避免原样放回来源仓”的借货标记。
 *
 * @param cache carrier 的 source 缓存。
 */
const clearCarrierAvoidReturnCache = (cache: CarrierCache) => {
    cache.avoidReturnTargetId = undefined;
    cache.avoidReturnResourceType = undefined;
};

const getRoomCarrierNoPath = (roomName: string): Record<string, number> => {
    const roomMem = ((Memory.rooms as any)[roomName] ||= {});
    return (roomMem.carrierNoPath ||= {}) as Record<string, number>;
};

const cleanupRoomCarrierNoPath = (roomName: string) => {
    const noPath = getRoomCarrierNoPath(roomName);
    for (const id in noPath) {
        if (noPath[id] <= Game.time) delete noPath[id];
    }
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

const getCarrierWithdrawReservationKey = (id: string, resourceType?: ResourceConstant) =>
    `${id}:${resourceType || ''}`;

const getReservedWithdrawCapacityByCarrier = (() => {
    let cachedTick = -1;
    let byRoom: Record<string, Record<string, number>> = {};
    const EMPTY_CAPACITY_MAP = Object.freeze({}) as Record<string, number>;
    return (roomName: string): Record<string, number> => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            byRoom = {};
            for (const creepName in Game.creeps) {
                const creep = Game.creeps[creepName];
                if (!creep) continue;
                if (creep.memory?.role !== 'carrier') continue;
                const sourceCache = ensureMemoryCache(creep.memory).source as CarrierCache | undefined;
                const sourceId = sourceCache?.sourceId;
                if (!sourceId) continue;
                const freeCapacity = creep.store.getFreeCapacity();
                if (freeCapacity <= 0) continue;
                const creepRoom = creep.room.name;
                if (!byRoom[creepRoom]) byRoom[creepRoom] = {};
                const key = getCarrierWithdrawReservationKey(sourceId, sourceCache?.resourceType);
                byRoom[creepRoom][key] = (byRoom[creepRoom][key] || 0) + freeCapacity;
            }
        }
        return byRoom[roomName] || EMPTY_CAPACITY_MAP;
    };
})();

const getPositiveStoreTypes = (store: StoreDefinition): ResourceConstant[] => {
    return (Object.keys(store) as ResourceConstant[]).filter(t => (store as any)[t] > 0);
};

type CarrierContainerTraits = {
    isCoreDepot: boolean;
    isController: boolean;
    isSource: boolean;
    isMineral: boolean;
};

const getContainerTraits = (room: Room, container: StructureContainer): CarrierContainerTraits => {
    const isCoreDepot = !!container && isCoreDepotContainer(room, container);
    return {
        isCoreDepot,
        isController: !isCoreDepot && !!room.controller && container.pos.inRangeTo(room.controller.pos, 3),
        isSource: (room.source || []).some((source: Source) => source && container.pos.inRangeTo(source.pos, 2)),
        isMineral: !!room.mineral && container.pos.inRangeTo(room.mineral.pos, 2),
    };
};

const getControllerContainer = (room: Room): StructureContainer | null => {
    const containers = room.container || [];
    return containers.find((container) => getContainerTraits(room, container).isController) || null;
};

/**
 * 判断某个核心仓 container 当前是否正在充当 storage / terminal 的占位结构。
 *
 * @remarks
 * 这类 container 在逻辑上已经是“中心仓”，不应该再按普通箱子处理，
 * 否则 carrier 会把其中资源当成待清理对象，出现取出后又送回的无意义循环。
 *
 * @param room 房间对象。
 * @param target 待检查的结构。
 * @returns `true` 表示它是当前仍在生效的核心仓占位 container。
 */
const isActiveCoreDepotPlaceholder = (
    room: Room,
    target: AnyStoreStructure | null | undefined
): boolean => {
    if (!target || target.structureType !== STRUCTURE_CONTAINER) return false;
    if (!isCoreDepotContainer(room, target)) return false;

    const kind = getCoreDepotKindAtPos(room.name, target.pos);
    if (kind === 'storage') return !room.storage;
    if (kind === 'terminal') return !room.terminal;
    return false;
};

/**
 * 判断本次 withdraw 的来源是否属于“仓储型来源”。
 *
 * @param room 房间对象。
 * @param target 实际取货目标。
 * @param sourceKind 规划阶段的来源类型。
 * @returns `true` 表示本次资源来自 storage / terminal / 中央仓占位 container。
 */
const isStorageLikeWithdrawSource = (
    room: Room,
    target: AnyStoreStructure,
    sourceKind: CarrierCache['sourceKind']
) => {
    if (sourceKind === 'storage' || sourceKind === 'terminal') return true;
    return isActiveCoreDepotPlaceholder(room, target);
};

/**
 * 为当前载荷标记“不要原样塞回去的来源仓”。
 *
 * @param creep 当前 carrier。
 * @param target 实际取货目标。
 * @param resourceType 本次取出的资源类型。
 */
const markCarrierAvoidReturnTarget = (
    creep: Creep,
    target: AnyStoreStructure,
    resourceType: ResourceConstant
) => {
    const cache = getCarrierSourceCache(creep);
    cache.avoidReturnTargetId = target.id;
    cache.avoidReturnResourceType = resourceType;
};

/**
 * 在挑选存放目标时，同时规避“当前 source”与“本趟借货来源仓”。
 *
 * @param creep 当前 carrier。
 * @param resourceType 当前计划投递的资源类型。
 * @param primaryExcludeId 一般是 source cache 中的 sourceId。
 * @param secondaryExcludeId 借货缓存中的 avoidReturnTargetId。
 * @returns 满足排除条件的最佳目标；找不到则返回 `null`。
 */
const pickBestStoreTargetAvoiding = (
    creep: Creep,
    resourceType: ResourceConstant,
    primaryExcludeId?: Id<AnyStoreStructure>,
    secondaryExcludeId?: Id<AnyStoreStructure>
): AnyStoreStructure | null => {
    const firstExclude = primaryExcludeId || secondaryExcludeId;
    let target = creep.findBestStoreTarget(resourceType, firstExclude);
    if (!target) return null;

    if (
        secondaryExcludeId &&
        secondaryExcludeId !== primaryExcludeId &&
        target.id === secondaryExcludeId
    ) {
        target = creep.findBestStoreTarget(resourceType, secondaryExcludeId);
        if (!target) return null;
    }

    if (primaryExcludeId && target.id === primaryExcludeId) return null;
    if (secondaryExcludeId && target.id === secondaryExcludeId) return null;
    return target;
};

const canCarryResourceSafely = (
    creep: Creep,
    resourceType: ResourceConstant,
    excludeTargetId?: Id<AnyStoreStructure>
): boolean => {
    if (resourceType === RESOURCE_ENERGY) return true;
    if (!hasCoreDepotTarget(creep.room)) return false;
    return !!creep.findBestStoreTarget(resourceType, excludeTargetId);
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

const pickBestContaminantTypeFromContainer = (
    creep: Creep,
    container: StructureContainer
): ResourceConstant | null => {
    const types = getPositiveStoreTypes(container.store)
        .filter((type) => type !== RESOURCE_ENERGY && canCarryResourceSafely(creep, type, container.id));
    if (types.length === 0) return null;
    types.sort((a, b) => (container.store[b] || 0) - (container.store[a] || 0));
    return types[0];
};

// 获取 storage 或 terminal 作为能量来源
const getStorageOrTerminal = (creep: Creep) => {
    const { storage, terminal, link, controller } = creep.room as any;
    const storageFallback = storage || getCoreDepotContainer(creep.room, 'storage');
    const terminalFallback = terminal || getCoreDepotContainer(creep.room, 'terminal');
    if (!storageFallback && !terminalFallback) return null;
    
    const controllerContainer = controller ? getControllerContainer(creep.room) : null;
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

/**
 * 判断当前 carrier 是否正背着一批“刚从仓储型来源借出的资源”。
 *
 * @param creep 当前 carrier。
 * @returns `true` 表示这批资源暂时不应该被原样送回来源仓。
 */
const shouldHoldBorrowedCargo = (creep: Creep): boolean => {
    const cache = getCarrierSourceCache(creep);
    return !!(
        cache.avoidReturnTargetId &&
        cache.avoidReturnResourceType &&
        creep.store.getUsedCapacity(cache.avoidReturnResourceType) > 0
    );
};

const compareWithdrawCandidate = (a: WithdrawCandidate, b: WithdrawCandidate) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.range !== b.range) return a.range - b.range;
    return b.amount - a.amount;
};

const getCarrierDroppedEnergyMinAmount = (
    freeCap: number,
    urgentEnergy: boolean,
    hasStorage: boolean
) => {
    if (urgentEnergy || !hasStorage) return 1;
    return Math.min(Math.max(1, freeCap), THRESHOLDS.ENERGY.PICKUP_THRESHOLD * 2);
};

const getCarrierContainerEnergyMinAmount = (
    freeCap: number,
    urgentEnergy: boolean,
    hasStorage: boolean
) => {
    if (urgentEnergy || !hasStorage) return 1;
    const normalMin = Math.min(
        Math.min(THRESHOLDS.ENERGY.PICKUP_LARGE * 0.666, freeCap),
        THRESHOLDS.ENERGY.CONTAINER_MIN * 0.3
    );
    return Math.max(1, normalMin);
};

const getCarrierEffectiveAvailableAmount = (
    reservedCapacityById: Record<string, number>,
    id: string,
    resourceType: ResourceConstant | undefined,
    amount: number
) => {
    const reserved = reservedCapacityById[getCarrierWithdrawReservationKey(id, resourceType)] || 0;
    return amount - reserved;
};

const selectWithdrawPlan = (creep: Creep, excludeId?: Id<any>): WithdrawPlan | null => {
    const { room, pos, store } = creep;
    const roomAny = room as any;

    cleanupRoomCarrierNoPath(room.name);

    const reservedCapacityById = getReservedWithdrawCapacityByCarrier(room.name);

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

        const priority = r.resourceType === RESOURCE_ENERGY ? 50 : 80;
        const effectiveAmount = getCarrierEffectiveAvailableAmount(
            reservedCapacityById,
            r.id,
            r.resourceType,
            r.amount
        );
        if (effectiveAmount <= 0) continue;

        // 能量掉落只有在数量较大时才抢占优先级，避免反复捡小堆
        if (r.resourceType === RESOURCE_ENERGY) {
            const minDroppedAmount = getCarrierDroppedEnergyMinAmount(freeCap, urgentEnergy, hasStorage);
            if (effectiveAmount < minDroppedAmount && effectiveAmount < freeCap) continue;
        }

        candidates.push({
            priority,
            range: pos.getRangeTo(r),
            amount: effectiveAmount,
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
        const type = pickBestWithdrawTypeFromStore(creep, t.store, urgentEnergy ? 'energy' : 'nonEnergy');
        if (!type) continue;
        const amount = t.store.getUsedCapacity(type);
        const effectiveAmount = getCarrierEffectiveAvailableAmount(reservedCapacityById, t.id, type, amount);
        if (effectiveAmount <= 0) continue;
        if (type === RESOURCE_ENERGY && amount < 100) continue;

        candidates.push({
            priority: 75,
            range: pos.getRangeTo(t),
            amount: effectiveAmount,
            plan: { id: t.id, kind: 'tombstone', resourceType: type, lockTtl: 5 }
        });
    }

    const ruins = room.find(FIND_RUINS, {
        filter: (r: Ruin) => r.store.getUsedCapacity() > 0
    });
    for (const r of ruins) {
        if (excludeId && r.id === excludeId) continue;
        if (isNoPath(room.name, r.id)) continue;
        const type = pickBestWithdrawTypeFromStore(creep, r.store, urgentEnergy ? 'energy' : 'nonEnergy');
        if (!type) continue;
        const amount = r.store.getUsedCapacity(type);
        const effectiveAmount = getCarrierEffectiveAvailableAmount(reservedCapacityById, r.id, type, amount);
        if (effectiveAmount <= 0) continue;
        if (type === RESOURCE_ENERGY && amount < 100) continue;

        candidates.push({
            priority: 70,
            range: pos.getRangeTo(r),
            amount: effectiveAmount,
            plan: { id: r.id, kind: 'ruin', resourceType: type, lockTtl: 5 }
        });
    }

    // 优先级3：link/container
    if (urgentEnergy || !hasStorage) {
        const links = (roomAny.link || []).filter((l: StructureLink) => l?.store[RESOURCE_ENERGY] > 0) as StructureLink[];
        for (const l of links) {
            if (excludeId && l.id === excludeId) continue;
            if (isNoPath(room.name, l.id)) continue;
            const effectiveAmount = getCarrierEffectiveAvailableAmount(
                reservedCapacityById,
                l.id,
                RESOURCE_ENERGY,
                l.store[RESOURCE_ENERGY] || 0
            );
            if (effectiveAmount <= 0) continue;
            candidates.push({
                priority: 55,
                range: pos.getRangeTo(l),
                amount: effectiveAmount,
                plan: { id: l.id, kind: 'link', resourceType: RESOURCE_ENERGY, lockTtl: 2 }
            });
        }
    }

    const containers = (roomAny.container || []).filter((c: StructureContainer) => c && c.store?.getUsedCapacity?.() > 0) as StructureContainer[];
    for (const c of containers) {
        if (excludeId && c.id === excludeId) continue;
        if (isNoPath(room.name, c.id)) continue;

        const traits = getContainerTraits(room, c);
        if (traits.isController) {
            // controller/source(mineral) 重叠箱也走这里：
            // 能量视为 controller buffer，不允许 carrier 拿走；
            // 非能量视为异常资源或矿物产出，允许清出来。
            const type = pickBestContaminantTypeFromContainer(creep, c);
            if (!type) continue;
            const amount = c.store.getUsedCapacity(type);
            const effectiveAmount = getCarrierEffectiveAvailableAmount(reservedCapacityById, c.id, type, amount);
            if (effectiveAmount <= 0) continue;

            candidates.push({
                priority: 65,
                range: pos.getRangeTo(c),
                amount: effectiveAmount,
                plan: { id: c.id, kind: 'container', resourceType: type, lockTtl: 3 }
            });
            continue;
        }

        if (traits.isCoreDepot) {
            // 中央仓占位 container 视作 storage/terminal，本身不是待清理的普通 container。
            if (isActiveCoreDepotPlaceholder(room, c)) continue;
            const type = pickBestContaminantTypeFromContainer(creep, c);
            if (!type) continue;
            const amount = c.store.getUsedCapacity(type);
            const effectiveAmount = getCarrierEffectiveAvailableAmount(reservedCapacityById, c.id, type, amount);
            if (effectiveAmount <= 0) continue;

            candidates.push({
                priority: 35,
                range: pos.getRangeTo(c),
                amount: effectiveAmount,
                plan: { id: c.id, kind: 'container', resourceType: type, lockTtl: 3 }
            });
            continue;
        }

        const prefer = urgentEnergy || !hasStorage ? 'energy' : 'nonEnergy';
        const type = pickBestWithdrawTypeFromStore(creep, c.store, prefer);
        if (!type) continue;

        const amount = c.store.getUsedCapacity(type);
        const effectiveAmount = getCarrierEffectiveAvailableAmount(reservedCapacityById, c.id, type, amount);
        if (effectiveAmount <= 0) continue;
        const minAmount = type === RESOURCE_ENERGY
            ? getCarrierContainerEnergyMinAmount(freeCap, urgentEnergy, hasStorage)
            : Math.max(
                1,
                Math.min(
                    Math.min(THRESHOLDS.ENERGY.PICKUP_LARGE * 0.666, freeCap),
                    THRESHOLDS.ENERGY.PICKUP_THRESHOLD * 0.5
                )
            );
        if (effectiveAmount < minAmount && effectiveAmount < freeCap) continue;

        candidates.push({
            priority: 45,
            range: pos.getRangeTo(c),
            amount: effectiveAmount,
            plan: { id: c.id, kind: 'container', resourceType: type, lockTtl: 3 }
        });
    }

    // 优先级4：从 storage/terminal 取能量（仅用于补能模式的兜底）
    if (urgentEnergy && freeCap > 0) {
        const source = getStorageOrTerminal(creep) as AnyStoreStructure | null;
        const minAmount = source?.structureType === STRUCTURE_CONTAINER ? THRESHOLDS.ENERGY.CONTAINER_MIN : THRESHOLDS.ENERGY.STORAGE_MIN;
        if (source && source.store.getUsedCapacity(RESOURCE_ENERGY) > minAmount) {
            if ((!excludeId || source.id !== excludeId) && !isNoPath(room.name, source.id)) {
                const effectiveAmount = getCarrierEffectiveAvailableAmount(
                    reservedCapacityById,
                    source.id,
                    RESOURCE_ENERGY,
                    source.store.getUsedCapacity(RESOURCE_ENERGY)
                );
                if (effectiveAmount > 0) {
                    candidates.push({
                        priority: 20,
                        range: pos.getRangeTo(source),
                        amount: effectiveAmount,
                        plan: { id: source.id, kind: source.structureType === STRUCTURE_TERMINAL ? 'terminal' : source.structureType === STRUCTURE_STORAGE ? 'storage' : 'container', resourceType: RESOURCE_ENERGY, lockTtl: 1 }
                    });
                }
            }
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort(compareWithdrawCandidate);
    return candidates[0].plan;
};

const cacheWithdrawPlan = (creep: Creep, plan: WithdrawPlan) => {
    const cache = getCarrierSourceCache(creep);
    // 新一趟取货开始时，上一趟的借货来源已经失效，避免跨趟误伤正常投递。
    clearCarrierAvoidReturnCache(cache);
    cache.sourceId = plan.id;
    cache.sourceKind = plan.kind;
    cache.resourceType = plan.resourceType;
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
    const sourceCache = getCarrierSourceCache(creep);

    const carryTypes = getCreepCarryTypesSorted(creep);
    if (carryTypes.length === 0) return { carryTypes, target: null as AnyStoreStructure | null, resourceType: undefined as ResourceConstant | undefined };
    if (
        sourceCache.avoidReturnResourceType &&
        creep.store.getUsedCapacity(sourceCache.avoidReturnResourceType) <= 0
    ) {
        clearCarrierAvoidReturnCache(sourceCache);
    }

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
        const sourceIdToAvoid = sourceCache.sourceId as Id<AnyStoreStructure> | undefined;
        const controllerContainer = getControllerContainer(room);
        const controllerLink = roomAny.link?.find((l: StructureLink) =>
            l.pos.inRangeTo(room.controller, 2));

        for (const t of carryTypes) {
            target = null;
            const avoidReturnTargetId = sourceCache.avoidReturnResourceType === t
                ? sourceCache.avoidReturnTargetId as Id<AnyStoreStructure> | undefined
                : undefined;

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

                if (!target) {
                    target = pickBestStoreTargetAvoiding(creep, RESOURCE_ENERGY, sourceIdToAvoid, avoidReturnTargetId);
                }
            } else {
                target = pickBestStoreTargetAvoiding(creep, t, sourceIdToAvoid, avoidReturnTargetId);
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
        if (shouldHoldBorrowedCargo(creep)) {
            clearCarrierTargetCache(cache);
            return false;
        }

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
            if (isStorageLikeWithdrawSource(room, storeTarget, cache.sourceKind)) {
                markCarrierAvoidReturnTarget(creep, storeTarget, resourceType);
            }
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
        if (shouldHoldBorrowedCargo(creep)) {
            // 这批资源刚从仓储型来源借出，但当前没有真正需要它的目标。
            // 直接塞回去只会制造“取一下又放回去”的空转，所以本 tick 保持等待。
            clearCarrierTargetCache(cache);
            return false;
        }

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
            const sourceCache = getCarrierSourceCache(creep);
            if (
                sourceCache.avoidReturnResourceType === resourceType &&
                creep.store.getUsedCapacity(resourceType) <= 0
            ) {
                clearCarrierAvoidReturnCache(sourceCache);
            }
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



const onSource = (creep: Creep): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.store.getFreeCapacity() === 0) {
        carry(creep);
        return WORK_EVENTS.TO_TARGET;
    }
    if (goGenerateSafeMode(creep)) return WORK_EVENTS.STAY;
    const result = withdraw(creep);
    if (result) return WORK_EVENTS.TO_TARGET;

    // 源侧暂时断流时，允许带着半仓资源先回去交付，避免卡在 source 态空转。
    if (creep.store.getUsedCapacity() > 0 && !getCarrierSourceCache(creep).sourceId) {
        carry(creep);
        return WORK_EVENTS.TO_TARGET;
    }

    return WORK_EVENTS.STAY;
};

const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.store.getUsedCapacity() === 0) {
        withdraw(creep);
        return WORK_EVENTS.TO_SOURCE;
    }
    if (checkAndFillNearbyExtensions(creep)) return WORK_EVENTS.STAY;
    return carry(creep) ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
};

// Carrier 主逻辑
const CarrierFunction = {
    run: (creep: Creep) => {
        runWorkLayer(creep, {
            onSource,
            onTarget,
        });
    }
};

export default CarrierFunction;

export { getStorageOrTerminal, selectWithdrawPlan };
