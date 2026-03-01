import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';

type UniversalTargetKind = 'spawn_ext' | 'tower' | 'controller_buffer' | 'power_spawn';

type UniversalTargetCache = {
    targetId?: Id<AnyStoreStructure> | null;
    targetKind?: UniversalTargetKind;
    targetStall?: number;
    lastTargetId?: string;
    lastPosKey?: string;
};

const isUrgentRefill = (room: Room) => room.CheckSpawnAndTower();

const shouldForceUpgrade = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my) return false;
    if (room.level < 2) return true;
    const ttd = controller.ticksToDowngrade || 0;
    return ttd < (room.level <= 3 ? 5000 : 3000);
};

const getBoundSourceCounts = (room: Room) => {
    return getRoomTickCacheValue(room, 'universal_bound_source_counts', () => {
        const counts = new Map<string, number>();
        for (const source of room.source) counts.set(source.id, 0);
        const myCreeps = room.find(FIND_MY_CREEPS, {
            filter: c => c.memory.role === 'universal' && c.memory.targetSourceId
        }) as Creep[];
        for (const c of myCreeps) {
            const sid = c.memory.targetSourceId as string;
            if (counts.has(sid)) counts.set(sid, (counts.get(sid) || 0) + 1);
        }
        return counts;
    }) as Map<string, number>;
};

const getSourceWalkableMap = (room: Room) => {
    return getRoomTickCacheValue(room, 'universal_source_walkable', () => {
        const map = new Map<string, number>();
        const terrain = room.getTerrain();
        for (const source of room.source) {
            let walkable = 0;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const x = source.pos.x + dx;
                    const y = source.pos.y + dy;
                    if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                    if (terrain.get(x, y) !== TERRAIN_MASK_WALL) walkable++;
                }
            }
            map.set(source.id, Math.max(1, walkable));
        }
        return map;
    }) as Map<string, number>;
};

const selectBestSource = function (creep: Creep): Source | null {
    const sources = creep.room.source.filter(s => s.energy > 0);
    if (sources.length === 0) return null;

    const sourceCounts = getBoundSourceCounts(creep.room);
    const walkableMap = getSourceWalkableMap(creep.room);

    let best: Source | null = null;
    let bestScore = -Infinity;
    for (const source of sources) {
        const bound = sourceCounts.get(source.id) || 0;
        const walkable = walkableMap.get(source.id) || 1;
        const freeSpots = Math.max(0, walkable - bound);
        const energyRatio = source.energyCapacity > 0 ? source.energy / source.energyCapacity : 0;
        const distance = creep.pos.getRangeTo(source.pos);
        const score = energyRatio * 30 + freeSpots * 8 - bound * 18 - distance;
        if (score > bestScore) {
            best = source;
            bestScore = score;
        }
    }
    return best;
}

const getEnergy = function (creep: Creep) {
    const urgent = isUrgentRefill(creep.room);
    const lowLevel = creep.room.level <= 2;
    const minContainerAmount = urgent ? 80 : (lowLevel ? 120 : 250);
    const minDroppedAmount = urgent ? 20 : (lowLevel ? 35 : 60);

    // 1) 先尝试回收已有能源，减少采矿位拥堵。
    if (creep.smartCollect(RESOURCE_ENERGY, {
        minContainerAmount,
        minDroppedAmount
    })) {
        delete creep.memory.targetSourceId;
        return;
    }

    // 2) 无可回收能源时再转采矿。
    let sourceId = creep.memory.targetSourceId as Id<Source> | undefined;
    let source: Source | null = null;

    if (sourceId) {
        source = Game.getObjectById(sourceId);
        if (!source || source.energy === 0) {
            delete creep.memory.targetSourceId;
            source = null;
        }
    }

    if (!source) {
        source = selectBestSource(creep);
        if (source) {
            creep.memory.targetSourceId = source.id;
        }
    }

    if (source) {
        creep.goHaverst(source);
    } else {
        delete creep.memory.targetSourceId;
    }
}

const clearTargetCache = (cache: UniversalTargetCache) => {
    delete cache.targetId;
    delete cache.targetKind;
    delete cache.targetStall;
    delete cache.lastTargetId;
    delete cache.lastPosKey;
};

const isTargetValid = (target: AnyStoreStructure | null, kind: UniversalTargetKind | undefined, urgent: boolean) => {
    if (!target) return false;
    const free = Number(target.store?.getFreeCapacity?.(RESOURCE_ENERGY) || 0);
    if (free <= 0) return false;
    if (kind === 'tower' && !urgent && free <= 400) return false;
    return true;
};

const pushEnergyTarget = (
    candidates: Array<{ target: AnyStoreStructure; kind: UniversalTargetKind; score: number }>,
    creep: Creep,
    target: AnyStoreStructure | null | undefined,
    kind: UniversalTargetKind,
    base: number,
    minFree: number
) => {
    if (!target) return;
    const free = Number(target.store?.getFreeCapacity?.(RESOURCE_ENERGY) || 0);
    if (free < minFree) return;
    const distance = creep.pos.getRangeTo(target.pos);
    const score = base + Math.min(300, Math.floor(free / 10)) - distance * 4;
    candidates.push({ target, kind, score });
};

const chooseTransferTarget = (creep: Creep) => {
    const room = creep.room;
    const urgent = isUrgentRefill(room);
    const candidates: Array<{ target: AnyStoreStructure; kind: UniversalTargetKind; score: number }> = [];

    for (const spawn of room.spawn || []) {
        pushEnergyTarget(candidates, creep, spawn, 'spawn_ext', 1000, 1);
    }
    for (const ext of room.extension || []) {
        pushEnergyTarget(candidates, creep, ext, 'spawn_ext', 980, 1);
    }

    for (const tower of room.tower || []) {
        if (urgent) pushEnergyTarget(candidates, creep, tower, 'tower', 900, 150);
        else pushEnergyTarget(candidates, creep, tower, 'tower', 420, 500);
    }

    if (urgent && room.powerSpawn) {
        pushEnergyTarget(candidates, creep, room.powerSpawn, 'power_spawn', 680, 100);
    }

    if (!urgent) {
        const controller = room.controller;
        if (controller) {
            const controllerLink = (room.link || []).find(link => link.pos.inRangeTo(controller.pos, 2)) || null;
            const controllerContainer = (room.container || []).find(container => container.pos.inRangeTo(controller.pos, 3)) || null;
            pushEnergyTarget(candidates, creep, controllerLink, 'controller_buffer', 640, 100);
            pushEnergyTarget(candidates, creep, controllerContainer, 'controller_buffer', 620, 150);
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
};

const trackAndHandleTargetStall = (creep: Creep, cache: UniversalTargetCache) => {
    const currentId = String(cache.targetId || '');
    if (!currentId) return;
    const posKey = `${creep.pos.x}:${creep.pos.y}`;
    const sameTarget = cache.lastTargetId === currentId;
    const samePos = cache.lastPosKey === posKey;
    if (sameTarget && samePos) cache.targetStall = Number(cache.targetStall || 0) + 1;
    else cache.targetStall = 0;
    cache.lastTargetId = currentId;
    cache.lastPosKey = posKey;
    if (Number(cache.targetStall || 0) >= 5) clearTargetCache(cache);
};

const resolveTransferTarget = (creep: Creep, cache: UniversalTargetCache) => {
    const urgent = isUrgentRefill(creep.room);

    if (cache.targetId) {
        const target = Game.getObjectById(cache.targetId as Id<AnyStoreStructure>) as AnyStoreStructure | null;
        if (isTargetValid(target, cache.targetKind, urgent)) {
            return { target, kind: cache.targetKind as UniversalTargetKind };
        }
        clearTargetCache(cache);
    }

    const picked = chooseTransferTarget(creep);
    if (!picked) return null;
    cache.targetId = picked.target.id as Id<AnyStoreStructure>;
    cache.targetKind = picked.kind;
    cache.targetStall = 0;
    cache.lastTargetId = String(picked.target.id);
    cache.lastPosKey = `${creep.pos.x}:${creep.pos.y}`;
    return { target: picked.target, kind: picked.kind };
};

const doWork = function (creep: Creep) {
    creep.memory.cacheTarget = creep.memory.cacheTarget || {};
    const cache = creep.memory.cacheTarget as UniversalTargetCache;

    const transferTask = resolveTransferTarget(creep, cache);
    if (transferTask) {
        creep.goTransfer(transferTask.target, RESOURCE_ENERGY);
        trackAndHandleTargetStall(creep, cache);
        return;
    }

    if (shouldForceUpgrade(creep.room)) {
        creep.goUpgrade();
        return;
    }

    const buildPriority = creep.room.level <= 3
        ? [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_CONTAINER, STRUCTURE_TOWER, STRUCTURE_ROAD, STRUCTURE_RAMPART]
        : [STRUCTURE_EXTENSION, STRUCTURE_CONTAINER, STRUCTURE_TOWER, STRUCTURE_ROAD, STRUCTURE_RAMPART];
    if (creep.findAndBuild({ priority: buildPriority, range: 3 })) return;

    if (creep.findAndRepair({
        maxHitsRatio: 0.35,
        excludeTypes: [STRUCTURE_WALL, STRUCTURE_RAMPART],
        range: 3
    })) {
        return;
    }

    creep.goUpgrade();
}

const UniversalFunction = {
    prepare: function (creep: Creep) {
        if (!creep.room.source || creep.room.source.length === 0) return false;
        return true;
    },
    source: function (creep: Creep) {
        if (!creep.moveHomeRoom()) return;
        if (creep.handleRoomEdge()) return;
        
        getEnergy(creep);
        
        if (creep.store.getFreeCapacity() === 0) {
            delete creep.memory.targetSourceId;
            return true;
        }
        return false;
    },
    target: function (creep: Creep) {
        if (creep.memory.targetSourceId) {
            delete creep.memory.targetSourceId;
        }

        if (!creep.moveHomeRoom()) return;
        if (creep.handleRoomEdge()) return;

        doWork(creep);
        return creep.store.getUsedCapacity() === 0;
    }
};

export default UniversalFunction;
