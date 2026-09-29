import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { runWorkLayer } from '@/framework/ai/adapters';
import { writeMoveWorkTileCandidates } from '@/modules/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

// 迁移条件集中声明：采集满 -> 转交付，背包空 -> 转采集
const OUT_HARVEST_SWITCH = {
    TO_TARGET: (creep: Creep) => creep.store.getFreeCapacity() === 0,
    TO_SOURCE: (creep: Creep) => creep.store.getUsedCapacity() === 0
} as const;

const OUT_CARRY_DIRECT_TRANSFER_RETURN_FREE_RATIO = 0.2;

const shouldCarrierReturnAfterDirectTransfer = (carrier: Creep) => {
    const cap = Math.max(1, carrier.store.getCapacity());
    const free = carrier.store.getFreeCapacity();
    return free <= Math.ceil(cap * OUT_CARRY_DIRECT_TRANSFER_RETURN_FREE_RATIO);
};

const getOutHarvestSourceCache = (creep: Creep): Record<string, any> => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    return (cache.source && typeof cache.source === 'object' ? cache.source : (cache.source = {})) as Record<string, any>;
};

// 尝试把能量就近交给 out-carry，避免卡在容器满溢上
const transferToNearbyCarrier = (creep: Creep): boolean => {
    const carriers = getRoomTickCacheValue(creep.room, 'out_harvest_nearby_carriers', () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (c) =>
                (c.memory.role === 'out-carry' || c.memory.role === 'out-car') &&
                c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        }) as Creep[]
    );
    const nearbyCarrier = carriers.find((c) => creep.pos.inRangeTo(c, 1));
    if (!nearbyCarrier) return false;

    if (creep.transfer(nearbyCarrier, RESOURCE_ENERGY) === OK) {
        const sourceCache = getOutHarvestSourceCache(nearbyCarrier);
        const cache = ensureMemoryCache(nearbyCarrier.memory) as Record<string, any>;
        delete sourceCache.targetId;
        delete sourceCache.targetType;

        const boundSourceId = creep.memory.targetSourceId as Id<Source> | undefined;
        if (boundSourceId) {
            sourceCache.assignedSourceId = boundSourceId;
            const source = Game.getObjectById(boundSourceId);
            if (source) {
                sourceCache.assignedSourceKey = `${source.pos.x}:${source.pos.y}`;
            }
        }

        // 只有接近满载时才允许运输工同步转入返程。
        // 少量直递只是减少落地损耗，不应打断当前采集周期。
        if (shouldCarrierReturnAfterDirectTransfer(nearbyCarrier)) {
            cache.outCarryMode = 'deliver';
            const sourceRoom = nearbyCarrier.memory.sourceRoom;
            if (sourceRoom && nearbyCarrier.room.name !== sourceRoom) {
                const route = Game.map.findRoute(nearbyCarrier.room.name, sourceRoom);
                if (Array.isArray(route) && route.length > 0 && route[0].exit) {
                    const sourceDirection = route[0].exit as DirectionConstant;
                    nearbyCarrier.move(sourceDirection);
                }
            }
        }
        return true;
    }

    return false;
};

// 没有容器时仅负责施工：
// container 工地放置由 externalRoad 统一管理，这里只消费既有工地。
const buildContainerSite = (creep: Creep): boolean => {
    let site = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.my
    })[0];

    if (!site) return false;

    if (creep.pos.inRangeTo(site, 2)) {
        creep.build(site);
        return true;
    }

    creep.moveTo(site, { visualizePathStyle: { stroke: '#ffaa00' } });
    return false;
};

// 容器需要维修时优先维修
const repairContainer = (creep: Creep, container: StructureContainer) => {
    if (creep.pos.inRangeTo(container, 3)) {
        if (creep.repair(container) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 50, visualizePathStyle: { stroke: '#ffaa00' } });
        }
        return;
    }
    creep.moveTo(container);
};

// 容器满载时的处理：优先修理或临时丢弃
const handleFullContainer = (creep: Creep, container: StructureContainer) => {
    if (container.hits < container.hitsMax) {
        creep.repair(container);
        return;
    }
    if (!transferToNearbyCarrier(creep)) {
        creep.drop(RESOURCE_ENERGY);
    }
};

// 有容器的情况下执行交付逻辑
const handleWithContainer = (creep: Creep, container: StructureContainer) => {
    const source = Game.getObjectById(creep.memory.targetSourceId as Id<Source>);
    if (source && !creep.moveToSourceWorkTile(source)) return;

    if (container.hits < container.hitsMax * 0.8) {
        repairContainer(creep, container);
        return;
    }

    if (creep.pos.inRangeTo(container, 1)) {
        const result = creep.transfer(container, RESOURCE_ENERGY);
        if (result === ERR_FULL) handleFullContainer(creep, container);
        return;
    }

    creep.moveTo(container, { range: 1, reusePath: 0, visualizePathStyle: { stroke: '#ffaa00' } });
};

// 没有容器的情况下：回到采集位并施工已有 container 工地
const handleNoContainer = (creep: Creep) => {
    const source = Game.getObjectById(creep.memory.targetSourceId) as Source | null;
    creep.moveToSourceWorkTile(source);

    // container 工地存在时，先施工再立刻补 harvest，
    // 避免“满仓切 target -> 下一 tick 只 build 不 harvest”的停顿。
    const built = buildContainerSite(creep);
    if (built && source && source.energy > 0 && creep.pos.inRangeTo(source, 1) && creep.store.getFreeCapacity() > 0) {
        creep.harvest(source);
    }
};

// 目标态：把能量交给容器/运输
const runTargetPhase = (creep: Creep): boolean => {
    if (OUT_HARVEST_SWITCH.TO_SOURCE(creep)) return true;

    // 优先就近交给运输
    if (transferToNearbyCarrier(creep)) return OUT_HARVEST_SWITCH.TO_SOURCE(creep);

    let targetContainer: StructureContainer | undefined;
    const targetSource = Game.getObjectById(creep.memory.targetSourceId) as Source | null;
    if (!targetSource) {
        targetContainer = creep.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER
        })[0] as StructureContainer | undefined;
    } else {
        targetContainer = targetSource.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER
        })[0] as StructureContainer | undefined;
    }

    if (!targetContainer) handleNoContainer(creep);
    else handleWithContainer(creep, targetContainer);

    return OUT_HARVEST_SWITCH.TO_SOURCE(creep);
};

// 源态：前往采集点并采集
const runSourcePhase = (creep: Creep): boolean => {
    if (creep.room.name !== creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
        return false;
    }

    if (!creep.memory.targetSourceId) {
        const closestSource = creep.room.closestSource(creep);
        if (!closestSource) {
            creep.say('No source');
            // 工位全满（孵化超额/换班重叠）：限时等待后自我回收，避免永久站桩占人口
            const mem = creep.memory as any;
            if (!mem.noSourceSince) mem.noSourceSince = Game.time;
            if (Game.time - mem.noSourceSince > 200) creep.suicide();
            return false;
        }
        creep.memory.targetSourceId = closestSource.id;
        delete (creep.memory as any).noSourceSince;
    }

    let targetSource = Game.getObjectById(creep.memory.targetSourceId) as Source | null;
    if (!targetSource || targetSource.room.name !== creep.room.name) {
        delete creep.memory.targetSourceId;
        const rebound = creep.room.closestSource(creep);
        if (!rebound) return false;
        creep.memory.targetSourceId = rebound.id;
        targetSource = rebound;
    }

    if (creep.pos.isNear(targetSource.pos)) {
        if (!creep.moveToSourceWorkTile(targetSource)) {
            syncOutHarvestMoveWork(creep);
            return false;
        }
        // source 枯竭时不能提前 return，否则会跳过“满载切换 target”判定。
        if (targetSource.energy > 0) creep.harvest(targetSource);
    } else {
        const dangerousHostiles = getRoomTickCacheValue(creep.room, 'out_harvest_dangerous_hostiles', () =>
            creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: (c) =>
                    !c.isWhiteList() &&
                    (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0)
            }) as Creep[]
        );
        if (dangerousHostiles.some((h) => h.pos.inRangeTo(targetSource!.pos, 3))) {
            syncOutHarvestMoveWork(creep);
            return false;
        }
        creep.moveToSourceWorkTile(targetSource);
    }

    if (creep.store.getCapacity() === 0) return false;
    const shouldSwitch = OUT_HARVEST_SWITCH.TO_TARGET(creep);
    if (!shouldSwitch) syncOutHarvestMoveWork(creep);
    return shouldSwitch;
};

const onTarget = (creep: Creep): WorkEvent => {
    const shouldSwitch = runTargetPhase(creep);
    return shouldSwitch ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    const shouldSwitch = runSourcePhase(creep);
    return shouldSwitch ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
};

export const syncOutHarvestMoveWork = (creep: Creep) => {
    if (creep.memory.working) {
        writeMoveWorkTileCandidates(creep, []);
        return;
    }

    const targetSourceId = creep.memory.targetSourceId as Id<Source> | undefined;
    const targetSource = targetSourceId ? Game.getObjectById(targetSourceId) as Source | null : null;
    writeMoveWorkTileCandidates(creep, targetSource ? [{ pos: targetSource.pos, range: 1 }] : []);
};

const outHarvest = {
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource,
            onTarget
        });
    }
};

export default outHarvest;
