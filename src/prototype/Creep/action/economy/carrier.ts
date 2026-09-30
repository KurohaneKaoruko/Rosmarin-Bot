import { THRESHOLDS } from '@/constant/Thresholds';
import { createFsmStorage, createLayeredRunner, ensureFsmBucket } from '@/framework/ai/adapters';
import { StateMachine } from '@/framework/ai/stateMachine';
import {
    getCoreDepotContainer,
    getCoreDepotKindAtPos,
    getCoreDepotTarget,
    hasCoreDepotTarget,
    isCoreDepotContainer,
    isCoreDepotContainerDraining
} from '@/modules/shared/coreDepot';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

type CarrierWithdrawTarget = Resource | Tombstone | Ruin | AnyStoreStructure;

type CarrierCache = {
    sourceId?: Id<CarrierWithdrawTarget>;
    sourceKind?: 'dropped' | 'tombstone' | 'ruin' | 'container' | 'link' | 'storage' | 'terminal';
    targetId?: Id<AnyStoreStructure>;
    resourceType?: ResourceConstant;
    /**
     * 记录当前载荷是从哪个“仓储型目标”借出来的，
     * 用于避免 carrier 在中心仓/中央 container 上出现“取一下又放回去”的空转。
     */
    avoidReturnTargetId?: Id<AnyStoreStructure>;
    avoidReturnResourceType?: ResourceConstant;
};

type CarrierCacheFieldMap = Partial<Record<keyof CarrierCache, string>>;

const SOURCE_CACHE_FIELDS: CarrierCacheFieldMap = {
    sourceId: 'carrierSourceId',
    sourceKind: 'carrierSourceKind',
    resourceType: 'carrierSourceResourceType',
    avoidReturnTargetId: 'carrierAvoidReturnTargetId',
    avoidReturnResourceType: 'carrierAvoidReturnResourceType',
};

const TARGET_CACHE_FIELDS: CarrierCacheFieldMap = {
    targetId: 'carrierTargetId',
    resourceType: 'carrierTargetResourceType',
};

const isCarrierCacheObject = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const migrateCarrierCacheSection = (
    root: Record<string, any>,
    legacyKey: 'source' | 'target',
    fields: CarrierCacheFieldMap
) => {
    const legacy = isCarrierCacheObject(root[legacyKey]) ? root[legacyKey] as Record<string, any> : null;
    if (!legacy) return;

    for (const [field, flatKey] of Object.entries(fields)) {
        if (!flatKey) continue;
        if (root[flatKey] === undefined && legacy[field] !== undefined) {
            root[flatKey] = legacy[field];
        }
    }

    delete root[legacyKey];
};

const createCarrierCacheView = (
    root: Record<string, any>,
    fields: CarrierCacheFieldMap
): CarrierCache => {
    const view = {} as CarrierCache;

    for (const [field, flatKey] of Object.entries(fields)) {
        if (!flatKey) continue;
        Object.defineProperty(view, field, {
            configurable: true,
            enumerable: true,
            get: () => root[flatKey],
            set: (value) => {
                if (value === undefined) delete root[flatKey];
                else root[flatKey] = value;
            }
        });
    }

    return view;
};

const getCarrierSourceCache = (creep: Creep): CarrierCache => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    migrateCarrierCacheSection(cache, 'source', SOURCE_CACHE_FIELDS);
    return createCarrierCacheView(cache, SOURCE_CACHE_FIELDS);
};

const getCarrierTargetCache = (creep: Creep): CarrierCache => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    migrateCarrierCacheSection(cache, 'target', TARGET_CACHE_FIELDS);
    return createCarrierCacheView(cache, TARGET_CACHE_FIELDS);
};

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
                const sourceCache = getCarrierSourceCache(creep);
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
    let target = creep.findStoreTarget(resourceType, firstExclude);
    if (!target) return null;

    if (
        secondaryExcludeId &&
        secondaryExcludeId !== primaryExcludeId &&
        target.id === secondaryExcludeId
    ) {
        target = creep.findStoreTarget(resourceType, secondaryExcludeId);
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
    return !!creep.findStoreTarget(resourceType, excludeTargetId);
};

const getCreepCarryTypesSorted = (
    creep: Creep,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
): ResourceConstant[] => {
    const types = getPositiveStoreTypes(creep.store);
    if (types.length <= 1) return types;

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
const getStorageOrTerminal = (
    creep: Creep,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
) => {
    const { storage, terminal, link, controller } = creep.room as any;
    const storageFallback = storage || getCoreDepotContainer(creep.room, 'storage');
    const terminalFallback = terminal || getCoreDepotContainer(creep.room, 'terminal');
    if (!storageFallback && !terminalFallback) return null;
    
    const controllerContainer = controller ? getControllerContainer(creep.room) : null;
    const controllerLink = link?.find((l: StructureLink) => l.pos.inRangeTo(controller, 2));
    
    const needEnergy = urgentEnergy ||
                       (!controllerLink && controllerContainer?.store.getFreeCapacity(RESOURCE_ENERGY) > THRESHOLDS.ENERGY.CONTAINER_MIN);
    
    const storageEnergy = storageFallback?.store[RESOURCE_ENERGY] || 0;
    const terminalEnergy = terminalFallback?.store[RESOURCE_ENERGY] || 0;
    const getMinEnergy = (target: AnyStoreStructure | null) =>
        target?.structureType === STRUCTURE_CONTAINER ? THRESHOLDS.ENERGY.CONTAINER_MIN : THRESHOLDS.ENERGY.STORAGE_MIN;
    
    if (needEnergy) {
        // 优先从「排空换位中」的占位容器取：存入侧已停，取一点少一点，
        // 加速占位排空让真建筑尽快落位（阈值豁免——排空目标就是要清零）
        if (storageFallback && isCoreDepotContainerDraining(creep.room, storageFallback) && storageEnergy > 0) {
            return storageFallback;
        }
        if (terminalFallback && isCoreDepotContainerDraining(creep.room, terminalFallback) && terminalEnergy > 0) {
            return terminalFallback;
        }

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
const checkAndFillNearbyExtensions = (
    creep: Creep,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
) => {
    const { pos, room, store, memory } = creep;
    const energyAvailable = store[RESOURCE_ENERGY];
    
    if (energyAvailable <= 50) {
        return false;
    }

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
        const ext = Game.getObjectById(extensions[i]);
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
    id: Id<CarrierWithdrawTarget>;
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

const isDroppedResourceTarget = (target: _HasId): target is Resource =>
    'amount' in target && 'resourceType' in target;

const isTombstoneTarget = (target: _HasId): target is Tombstone =>
    'deathTime' in target && 'store' in target;

const isRuinTarget = (target: _HasId): target is Ruin =>
    'destroyTime' in target && 'store' in target;

const isStoreStructureTarget = (target: _HasId | null | undefined): target is AnyStoreStructure =>
    !!target && 'store' in target && 'structureType' in target;

const getFallbackWithdrawPlan = (
    creep: Creep,
    target: CarrierWithdrawTarget,
    urgentEnergy: boolean
): WithdrawPlan => {
    if (isDroppedResourceTarget(target)) {
        const resource = target;
        return { id: resource.id, kind: 'dropped', resourceType: resource.resourceType, lockTtl: 3 };
    }

    if (isTombstoneTarget(target)) {
        const tombstone = target;
        const type = pickBestWithdrawTypeFromStore(creep, tombstone.store, urgentEnergy ? 'energy' : 'nonEnergy');
        return { id: tombstone.id, kind: 'tombstone', resourceType: type || RESOURCE_ENERGY, lockTtl: 5 };
    }

    if (isRuinTarget(target)) {
        const ruin = target;
        const type = pickBestWithdrawTypeFromStore(creep, ruin.store, urgentEnergy ? 'energy' : 'nonEnergy');
        return { id: ruin.id, kind: 'ruin', resourceType: type || RESOURCE_ENERGY, lockTtl: 5 };
    }

    const structure = target;
    const kind: CarrierCache['sourceKind'] =
        structure.structureType === STRUCTURE_STORAGE ? 'storage' :
        structure.structureType === STRUCTURE_TERMINAL ? 'terminal' :
        structure.structureType === STRUCTURE_LINK ? 'link' :
        'container';
    const type = pickBestWithdrawTypeFromStore(creep, structure.store, urgentEnergy ? 'energy' : 'nonEnergy');
    return { id: structure.id, kind, resourceType: type || RESOURCE_ENERGY, lockTtl: 3 };
};

const selectWithdrawPlan = (
    creep: Creep,
    excludeId?: Id<any>,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
): WithdrawPlan | null => {
    const { room, pos, store } = creep;
    const roomAny = room as any;

    cleanupRoomCarrierNoPath(room.name);

    const reservedCapacityById = getReservedWithdrawCapacityByCarrier(room.name);

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
        const source = getStorageOrTerminal(creep, urgentEnergy) as AnyStoreStructure | null;
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

    if (candidates.length === 0) {
        const fallback = creep.findWithdrawTarget();
        if (!fallback || (excludeId && fallback.id === excludeId) || isNoPath(room.name, fallback.id)) {
            return null;
        }
        return getFallbackWithdrawPlan(creep, fallback, urgentEnergy);
    }
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

const moveToNextWithdrawTarget = (
    creep: Creep,
    excludeId?: Id<any>,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
) => {
    const cache = getCarrierSourceCache(creep);
    clearCarrierSourceCache(cache);
    const plan = selectWithdrawPlan(creep, excludeId, urgentEnergy);
    if (!plan) return false;

    cacheWithdrawPlan(creep, plan);
    const nextTarget = Game.getObjectById(plan.id);
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

const resolveCarryTarget = (
    creep: Creep,
    forceRetarget: boolean = false,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
) => {
    const { store, room, pos } = creep;
    const roomAny = room as any;
    const cache = getCarrierTargetCache(creep)
    const sourceCache = getCarrierSourceCache(creep);

    const carryTypes = getCreepCarryTypesSorted(creep, urgentEnergy);
    if (carryTypes.length === 0) return { carryTypes, target: null as AnyStoreStructure | null, resourceType: undefined as ResourceConstant | undefined };
    if (
        sourceCache.avoidReturnResourceType &&
        creep.store.getUsedCapacity(sourceCache.avoidReturnResourceType) <= 0
    ) {
        clearCarrierAvoidReturnCache(sourceCache);
    }

    const currentType = !forceRetarget && cache.resourceType && store[cache.resourceType] > 0 ? cache.resourceType : undefined;
    const currentTarget = !forceRetarget && cache.targetId ? Game.getObjectById(cache.targetId) : null;
    const currentStoreTarget = isStoreStructureTarget(currentTarget) ? currentTarget : null;

    const needNewTarget =
        forceRetarget ||
        !currentType ||
        !currentStoreTarget ||
        currentStoreTarget.store.getFreeCapacity(currentType) <= 0;

    let target: AnyStoreStructure | null = currentStoreTarget;
    let resourceType: ResourceConstant = currentType || carryTypes[0];

    if (needNewTarget) {
        clearCarrierTargetCache(cache);

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

const moveToNextCarryTarget = (
    creep: Creep,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
) => {
    const { room, pos } = creep;
    const roomAny = room as any;
    const cache = getCarrierTargetCache(creep);
    const { carryTypes, target } = resolveCarryTarget(creep, true, urgentEnergy);
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
const withdraw = (
    creep: Creep,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
) => {
    const cache = getCarrierSourceCache(creep)
    const { pos, store, room } = creep;

    const targetId = cache.sourceId;
    if (targetId && !Game.getObjectById(targetId)) {
        clearCarrierSourceCache(cache);
    }

    if (!cache.sourceId) {
        const plan = selectWithdrawPlan(creep, undefined, urgentEnergy);
        if (!plan) return false;

        cacheWithdrawPlan(creep, plan);
    }

    const target = Game.getObjectById(cache.sourceId);
    if (!target) {
        clearCarrierSourceCache(cache);
        return false;
    }

    if (isDroppedResourceTarget(target)) {
        const res = target;
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
                moveToNextWithdrawTarget(creep, res.id, urgentEnergy);
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

    if (!isTombstoneTarget(target) && !isRuinTarget(target) && !isStoreStructureTarget(target)) {
        clearCarrierSourceCache(cache);
        return false;
    }

    // 此处 target 已收窄为 AnyStoreStructure | Ruin | Tombstone，统一按带 store 的目标处理（Ruin/Tombstone 运行时兼容）
    const storeTarget = target as AnyStoreStructure;
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
            moveToNextWithdrawTarget(creep, storeTarget.id, urgentEnergy);
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
const carry = (
    creep: Creep,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
) => {
    const { store, room, pos } = creep;
    const roomAny = room as any;
    const cache = getCarrierTargetCache(creep)

    const { carryTypes, target, resourceType } = resolveCarryTarget(creep, false, urgentEnergy);
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
            moveToNextCarryTarget(creep, urgentEnergy);
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



const shouldSwitchToCarry = (creep: Creep) => (
    creep.store.getFreeCapacity() === 0 ||
    (creep.store.getUsedCapacity() > 0 && !getCarrierSourceCache(creep).sourceId)
);

const shouldSwitchToWithdraw = (creep: Creep) => creep.store.getUsedCapacity() === 0;

const runCarrierSourceState = (
    creep: Creep,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
) => {
    if (!creep.moveHomeRoom()) return false;
    if (creep.store.getFreeCapacity() === 0) {
        carry(creep, urgentEnergy);
        return true;
    }
    if (goGenerateSafeMode(creep)) return false;

    const filled = withdraw(creep, urgentEnergy);
    if (filled) return true;

    if (creep.store.getUsedCapacity() > 0 && !getCarrierSourceCache(creep).sourceId) {
        carry(creep, urgentEnergy);
        return true;
    }

    return false;
};

const runCarrierTargetState = (
    creep: Creep,
    urgentEnergy: boolean = creep.room.CheckSpawnAndTower()
) => {
    if (!creep.moveHomeRoom()) return false;
    if (creep.store.getUsedCapacity() === 0) {
        withdraw(creep, urgentEnergy);
        return true;
    }
    if (checkAndFillNearbyExtensions(creep, urgentEnergy)) return false;
    return !!carry(creep, urgentEnergy);
};

const shouldUseUrgentEnergyMode = (creep: Creep) => creep.room.CheckSpawnAndTower();

export const CARRIER_LAYERS = {
    PRIORITY: 'carrier:priority',
    FLOW: 'carrier:flow',
} as const;

export const CARRIER_STATES = {
    PRIORITY: {
        URGENT: 'urgent',
        NORMAL: 'normal',
    },
    FLOW: {
        WITHDRAW: 'withdraw',
        CARRY: 'carry',
    }
} as const;

export const CARRIER_EVENTS = {
    PRIORITY: {
        URGENT: 'urgent',
        NORMAL: 'normal',
    },
    FLOW: {
        FULL: 'full',
        EMPTY: 'empty',
    }
} as const;

type CarrierPriorityState = typeof CARRIER_STATES.PRIORITY[keyof typeof CARRIER_STATES.PRIORITY];
type CarrierPriorityEvent = typeof CARRIER_EVENTS.PRIORITY[keyof typeof CARRIER_EVENTS.PRIORITY];
type CarrierFlowState = typeof CARRIER_STATES.FLOW[keyof typeof CARRIER_STATES.FLOW];
type CarrierFlowEvent = typeof CARRIER_EVENTS.FLOW[keyof typeof CARRIER_EVENTS.FLOW];

type CarrierContext = {
    creep: Creep;
    urgentMode: boolean;
};

const getCarrierPriorityState = (creep: Creep): CarrierPriorityState =>
    (creep.memory.fsm?.[CARRIER_LAYERS.PRIORITY] as CarrierPriorityState | undefined) || CARRIER_STATES.PRIORITY.NORMAL;

const getCarrierFlowState = (creep: Creep): CarrierFlowState =>
    (creep.memory.fsm?.[CARRIER_LAYERS.FLOW] as CarrierFlowState | undefined) ||
    (creep.memory.working ? CARRIER_STATES.FLOW.CARRY : CARRIER_STATES.FLOW.WITHDRAW);

const seedCarrierStates = (creep: Creep) => {
    const fsm = ensureFsmBucket(creep);
    if (!fsm[CARRIER_LAYERS.PRIORITY]) {
        fsm[CARRIER_LAYERS.PRIORITY] = shouldUseUrgentEnergyMode(creep)
            ? CARRIER_STATES.PRIORITY.URGENT
            : CARRIER_STATES.PRIORITY.NORMAL;
    }
    if (!fsm[CARRIER_LAYERS.FLOW]) {
        fsm[CARRIER_LAYERS.FLOW] = creep.memory.working
            ? CARRIER_STATES.FLOW.CARRY
            : CARRIER_STATES.FLOW.WITHDRAW;
    }
};

const syncCarrierWorkingState = (creep: Creep) => {
    creep.memory.working = getCarrierFlowState(creep) === CARRIER_STATES.FLOW.CARRY;
};

const createCarrierPriorityMachine = (creep: Creep) =>
    new StateMachine<CarrierContext, CarrierPriorityState, CarrierPriorityEvent, never>({
        initial: CARRIER_STATES.PRIORITY.NORMAL,
        states: {
            [CARRIER_STATES.PRIORITY.URGENT]: {
                onTick: (ctx) => {
                    ctx.urgentMode = true;
                    if (!shouldUseUrgentEnergyMode(ctx.creep)) {
                        return [CARRIER_EVENTS.PRIORITY.NORMAL];
                    }
                }
            },
            [CARRIER_STATES.PRIORITY.NORMAL]: {
                onTick: (ctx) => {
                    ctx.urgentMode = false;
                    if (shouldUseUrgentEnergyMode(ctx.creep)) {
                        return [CARRIER_EVENTS.PRIORITY.URGENT];
                    }
                }
            }
        },
        transitions: [
            { from: CARRIER_STATES.PRIORITY.NORMAL, event: CARRIER_EVENTS.PRIORITY.URGENT, to: CARRIER_STATES.PRIORITY.URGENT },
            { from: CARRIER_STATES.PRIORITY.URGENT, event: CARRIER_EVENTS.PRIORITY.NORMAL, to: CARRIER_STATES.PRIORITY.NORMAL },
        ]
    }, createFsmStorage<CarrierPriorityState>(creep, CARRIER_LAYERS.PRIORITY));

const createCarrierFlowMachine = (creep: Creep) =>
    new StateMachine<CarrierContext, CarrierFlowState, CarrierFlowEvent, never>({
        initial: CARRIER_STATES.FLOW.WITHDRAW,
        states: {
            [CARRIER_STATES.FLOW.WITHDRAW]: {
                onTick: (ctx) => {
                    if (runCarrierSourceState(ctx.creep, ctx.urgentMode)) {
                        return [CARRIER_EVENTS.FLOW.FULL];
                    }
                }
            },
            [CARRIER_STATES.FLOW.CARRY]: {
                onTick: (ctx) => {
                    if (runCarrierTargetState(ctx.creep, ctx.urgentMode)) {
                        return [CARRIER_EVENTS.FLOW.EMPTY];
                    }
                }
            }
        },
        transitions: [
            { from: CARRIER_STATES.FLOW.WITHDRAW, event: CARRIER_EVENTS.FLOW.FULL, to: CARRIER_STATES.FLOW.CARRY },
            { from: CARRIER_STATES.FLOW.CARRY, event: CARRIER_EVENTS.FLOW.EMPTY, to: CARRIER_STATES.FLOW.WITHDRAW },
        ]
    }, createFsmStorage<CarrierFlowState>(creep, CARRIER_LAYERS.FLOW));

const CarrierRole = {
    run: (creep: Creep) => {
        seedCarrierStates(creep);

        const ctx: CarrierContext = {
            creep,
            urgentMode: getCarrierPriorityState(creep) === CARRIER_STATES.PRIORITY.URGENT,
        };

        const runner = createLayeredRunner<CarrierContext>({
            [CARRIER_LAYERS.PRIORITY]: createCarrierPriorityMachine(creep),
            [CARRIER_LAYERS.FLOW]: createCarrierFlowMachine(creep),
        });

        runner.step(ctx, {
            [CARRIER_LAYERS.PRIORITY]: { reenter: true },
            [CARRIER_LAYERS.FLOW]: { reenter: true },
        });

        syncCarrierWorkingState(creep);
    }
};

export default CarrierRole;

export { selectWithdrawPlan };
