import { THRESHOLDS } from '@/constant/Thresholds';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

type UniversalTargetKind = 'spawn_ext' | 'tower' | 'controller_buffer' | 'power_spawn';

type UniversalTargetCache = {
    targetId?: Id<AnyStoreStructure> | null;
    targetKind?: UniversalTargetKind;
    targetStall?: number;
    lastTargetId?: string;
    lastPosKey?: string;
};

const getUniversalTargetCache = (creep: Creep): UniversalTargetCache => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    return (cache.target && typeof cache.target === 'object' ? cache.target : (cache.target = {})) as UniversalTargetCache;
};

const isUrgentRefill = (room: Room) => room.CheckSpawnAndTower();
const hasMyConstructionSites = (room: Room) => room.find(FIND_CONSTRUCTION_SITES).some(site => (site as any).my);

export const shouldForceUpgrade = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my) return false;
    if (room.level < 2) return true;
    const ttd = controller.ticksToDowngrade || 0;
    return ttd < THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TTD;
};

const getEnergy = function (creep: Creep) {
    const urgent = isUrgentRefill(creep.room);
    const lowLevel = creep.room.level <= 2;
    const minContainerAmount = urgent ? 80 : (lowLevel ? 120 : 250);
    const minDroppedAmount = urgent ? 20 : (lowLevel ? 35 : 60);

    // 1) 先尝试回收已有能源，减少采矿位拥堵。
    // UNIV 不允许把 controller buffer 当作取能来源，否则会出现
    // “从控制器箱拿能 -> 工作态又补回控制器箱”的假死循环。
    if (
        creep.collectDroppedResource(RESOURCE_ENERGY, minDroppedAmount) ||
        creep.collectFromTombstone(RESOURCE_ENERGY) ||
        creep.collectFromRuin(RESOURCE_ENERGY) ||
        creep.collectFromContainer(minContainerAmount, RESOURCE_ENERGY, true) ||
        creep.collectFromStorage(RESOURCE_ENERGY)
    ) {
        delete creep.memory.targetSourceId;
        return;
    }

    // 2) 无可回收能源时再转采矿。
    const currentSource = creep.getBoundSource();
    const source = creep.resolveSourceByPriority(currentSource) || creep.room.closestSource(creep);

    if (source) {
        creep.goHaverst(source);
    } else {
        delete creep.memory.targetSourceId;
        if (currentSource) creep.yieldSourcePosition(currentSource);
    }
};

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
        const target = Game.getObjectById(cache.targetId as Id<AnyStoreStructure>);
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

const runWorkTasks = (creep: Creep, urgent: boolean, forceUpgrade: boolean) => {
    const cache = getUniversalTargetCache(creep);

    if (forceUpgrade) {
        clearTargetCache(cache);
        // 自有房间签名由 universal 负责维护：走 runControllerUpgrade 可在升级流程中统一处理签名。
        creep.runControllerUpgrade({ pickupDropped: false });
        return;
    }

    const hasBuildSite = hasMyConstructionSites(creep.room);

    // 有工地且不处于补能紧急态时，优先建造，避免被控制器缓冲补能长期占用。
    if (hasBuildSite && !urgent) {
        const buildPriority = [
            STRUCTURE_SPAWN,
            STRUCTURE_EXTENSION,
            STRUCTURE_TOWER,
            STRUCTURE_STORAGE,
            STRUCTURE_TERMINAL,
            STRUCTURE_CONTAINER,
            STRUCTURE_ROAD,
            STRUCTURE_RAMPART
        ];
        if (creep.findAndBuild({ priority: buildPriority, range: 3 })) return;
    }

    const transferTask = resolveTransferTarget(creep, cache);
    if (transferTask) {
        creep.goTransfer(transferTask.target, RESOURCE_ENERGY);
        trackAndHandleTargetStall(creep, cache);
        return;
    }

    const buildPriority = [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER,
        STRUCTURE_STORAGE,
        STRUCTURE_TERMINAL,
        STRUCTURE_CONTAINER,
        STRUCTURE_ROAD,
        STRUCTURE_RAMPART
    ];
    if (creep.findAndBuild({ priority: buildPriority, range: 3 })) return;

    if (creep.findAndRepair({
        maxHitsRatio: 0.35,
        excludeTypes: [STRUCTURE_WALL, STRUCTURE_RAMPART],
        range: 3
    })) {
        return;
    }

    // 无其他更高优先级工作时，进入控制器升级流程并顺带维护本房签名。
    creep.runControllerUpgrade({ pickupDropped: false });
};

const getMinWorkPayload = (cap: number, urgent: boolean, forceUpgrade: boolean) => {
    return forceUpgrade
        ? 1
        : urgent
            ? Math.min(cap, Math.max(50, Math.floor(cap * 0.5)))
            : cap;
};

const shouldGatherBeforeWork = (creep: Creep, urgent: boolean, forceUpgrade: boolean) => {
    const used = creep.store.getUsedCapacity();
    const free = creep.store.getFreeCapacity();
    const cap = creep.store.getCapacity();
    const minWorkPayload = getMinWorkPayload(cap, urgent, forceUpgrade);
    return used === 0 || (free > 0 && used < minWorkPayload);
};

// 通用机不再走“管道框架”，直接按顺序执行 Screeps 场景所需的判断。
const runUniversal = (creep: Creep) => {
    if (!creep.moveHomeRoom()) return;
    if (creep.handleRoomEdge()) return;

    delete creep.memory.working;
    const urgent = isUrgentRefill(creep.room);
    const forceUpgrade = shouldForceUpgrade(creep.room);

    if (shouldGatherBeforeWork(creep, urgent, forceUpgrade)) {
        getEnergy(creep);
        return;
    }

    if (creep.memory.targetSourceId) {
        delete creep.memory.targetSourceId;
    }
    runWorkTasks(creep, urgent, forceUpgrade);
};

const UniversalFunction = {
    run: runUniversal
};

export default UniversalFunction;
