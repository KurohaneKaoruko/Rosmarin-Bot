import { writeMoveWorkTileCandidates } from '@/modules/shared/moveWork';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';
import { isArrivedInRoom } from '@/prototype/Creep/shared/movement';
import { runWorkLayer, WORK_EVENTS, WorkEvent } from '@/prototype/Creep/family/flow/workLayer';
import { ROLES } from '@/constant/CreepConstant';

const NEAR_RANGE = 2;
const STAY_BUILD_RANGE = 3;

/** 同步 source 工作位候选（供 BetterMove 的移动规划引用） */
const syncMoveWork = (creep: Creep, source: Source | null): void => {
    writeMoveWorkTileCandidates(creep, source ? [{ pos: source.pos, range: 1 }] : []);
};

/** 原地建造附近工地 */
const stayAndBuildNearby = (creep: Creep): boolean => {
    if (creep.store[RESOURCE_ENERGY] === 0) return false;
    const sites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, STAY_BUILD_RANGE);
    const target = creep.pos.findClosestByRange(sites);
    if (!target) return false;
    creep.build(target);
    return true;
};

/** 边采边填：相邻 extension 有空位就顺手补能——采集与转移同一 tick 不冲突（模式无关的通用行为） */
const fillAdjacentExtension = (creep: Creep): void => {
    if ((creep.store[RESOURCE_ENERGY] || 0) <= 0) return;
    const ext = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
        filter: (s: AnyOwnedStructure) =>
            s.structureType === STRUCTURE_EXTENSION &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    })[0];
    if (ext) creep.transfer(ext as StructureExtension, RESOURCE_ENERGY);
};

/**
 * harvester：绑定 source 的专职采集。
 *
 * 默认身体 [[WORK,2],[MOVE,2]] 无 CARRY：站上工作位持续采集，
 * 能量掉落在工作位，由 carrier / transporter 收取。
 * 有 CARRY 的体型走**采/建状态迟滞**：采满（free === 0）才进入建造/交付态，
 * 卸空（used === 0）才回采集态——采集与建造严格分相，不贴阈值来回抖动。
 *
 * 顺序逻辑，无状态机框架：相位由仓库余量直接判定，天然免疫状态失联。
 */
// ==================== 外矿采集工作位（按 sourceRoom/targetRoom 参数化）====================
// memory.sourceRoom + targetRoom 任务绑定时走外矿驻守采集：驻工作位采集 →
// 满载直递同源线搬运工（或填容器）；家内源线工作不含本段字段，互不干扰。

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

// 尝试把能量就近交给外矿搬运工，避免卡在容器满溢上
const transferToNearbyCarrier = (creep: Creep): boolean => {
    const carriers = getRoomTickCacheValue(creep.room, 'out_harvest_nearby_carriers', () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (c) =>
                c.memory.role === ROLES.carrier &&
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
    if (!(isArrivedInRoom(creep, creep.memory.targetRoom))) {
        creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
        return false;
    }

    if (!creep.memory.targetSourceId) {
        const closestSource = creep.room.closestSource(creep);
        if (!closestSource) {
            creep.say('No source');
            // 工位全满（孵化超额/换班重叠）：限时等待后自我回收，避免永久站桩占人口
            const roleCache = creep.getRoleCache();
            if (!roleCache.noSourceSince) roleCache.noSourceSince = Game.time;
            if (Game.time - roleCache.noSourceSince > 200) creep.suicide();
            return false;
        }
        creep.memory.targetSourceId = closestSource.id;
        delete creep.getRoleCache().noSourceSince;
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


// 外矿采集入口
const runRemoteOutHarvest = (creep: Creep): void => {
    runWorkLayer(creep, {
        onSource,
        onTarget,
    });
};

export default {
    run: function (creep: Creep) {
        // 外矿工作位：sourceRoom+targetRoom 任务绑定（外矿孵化侧写入）——统一角色按位置参数化
        if (creep.memory.sourceRoom && creep.memory.targetRoom) {
            runRemoteOutHarvest(creep);
            return;
        }
        if (!creep.moveHomeRoom()) return;

        // 绑定 source：未绑定时按优先级挑一个（无可用 source 则等待）
        let source = creep.getBoundSource();
        if (!source) {
            source = creep.resolveSourceByPriority(creep.room.closestSource(creep));
            if (!source) return;
            creep.setBoundSourceId(source.id);
        }

        const carryCapacity = creep.store.getCapacity();
        const free = creep.store.getFreeCapacity();
        const used = creep.store.getUsedCapacity();

        // ── 采/建状态迟滞：采满再建，建完再采 ──
        // - 采集态：采满（free === 0）或源枯竭（无可可采）才进入建造/交付态（带多少算多少）；
        // - 建造/交付态：卸空（used === 0）才回采集态；
        // 无仓体型（carryCapacity === 0）不适用，始终采集，能量落地由搬运收取。
        let gathering = carryCapacity === 0 || !creep.memory.working;
        if (carryCapacity > 0) {
            if (creep.memory.working) {
                if (used === 0) {
                    creep.memory.working = false;
                    delete creep.memory.targetSourceId;
                    gathering = true;
                } else {
                    gathering = false;
                }
            } else if (free === 0 || source.energy === 0) {
                if (used > 0) {
                    creep.memory.working = true;
                    delete creep.memory.targetSourceId;
                    gathering = false;
                }
            }
        }

        // ── 采集态 ──
        if (gathering) {
            // 源枯竭且空仓：**有地方放才捡**容器余量——
            // 出口仅限「相邻有空位的 ext（当场填）」与「相邻有空位的源旁 link（下 tick 送走）」；
            // 容器本身不算出口，否则 withdraw ↔ transfer 原地回灌，捡起又放下循环到 source 再生为止
            if (source.energy === 0 && used === 0) {
                const container = creep.getNearbySourceContainer(1);
                if (container && creep.pos.isNearTo(container) && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    const extOutlet = creep.pos.findInRange(FIND_STRUCTURES, 1, {
                        filter: (s: Structure) =>
                            s.structureType === STRUCTURE_EXTENSION &&
                            (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0
                    })[0] as StructureExtension | undefined;
                    const link = creep.getNearbySourceLink(2);
                    const linkOutlet = !!link && creep.pos.isNearTo(link) &&
                        link.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

                    if (extOutlet || linkOutlet) {
                        creep.withdraw(container, RESOURCE_ENERGY);
                        if (extOutlet) creep.transfer(extOutlet, RESOURCE_ENERGY);
                    }
                }
                syncMoveWork(creep, source);
                return;
            }

            if (source.energy > 0) {
                if (!creep.moveToSourceWorkTile(source)) {
                    syncMoveWork(creep, source);
                    return;
                }
                // 首次到场：实测「出生 → 工作位」路程，供孵化系统无缝换班
                if (!creep.getRoleCache().calibrated) {
                    const roomMem = creep.room.memory as any;
                    roomMem.sourceTiming ??= {};
                    const timing = roomMem.sourceTiming[source.id] ?? (roomMem.sourceTiming[source.id] = {});
                    timing.pathTime = Math.max(10, Math.min(500, Game.time - (creep.memory.spawnTick ?? Game.time)));
                    creep.getRoleCache().calibrated = true;
                }
                creep.goHaverst(source);
                // 边采边填：顺手把身上的能量补进相邻 ext（rush 特殊子模式 / mini 迷你房的核心补给链）
                fillAdjacentExtension(creep);
                syncMoveWork(creep, source);
                return;
            }

            // 无仓体型：源枯竭时原地等待再生（能量已掉落在工作位，由搬运收取）
            syncMoveWork(creep, source);
            return;
        }

        // ── 建造/交付态（卸空才回采集态）──
        if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
        if (used === 0) {
            syncMoveWork(creep, source);
            return;
        }

        // 1) 相邻 link / container 交付
        if (creep.transferToSourceStructure()) return;

        // 2) 相邻有空位的 ext 直填
        fillAdjacentExtension(creep);
        if (creep.store.getUsedCapacity() === 0) return;

        // 3) 源旁有 link/container（交付结构满或不相邻）：先建附近工地，无处可建则掉落保采集位
        const hasDeliveryNearSource =
            !!creep.getNearbySourceLink(NEAR_RANGE) || !!creep.getNearbySourceContainer(NEAR_RANGE);
        if (hasDeliveryNearSource) {
            if (stayAndBuildNearby(creep)) return;
            creep.drop(RESOURCE_ENERGY);
            syncMoveWork(creep, source);
            return;
        }

        // 4) 无 link 无 container：维护容器工地（修理 / 建造容器工地）
        const maintain = creep.maintainSourceContainer();
        if (maintain === 'acted') return;
        if (maintain === 'blocked') {
            if (!stayAndBuildNearby(creep)) creep.drop(RESOURCE_ENERGY);
            return;
        }
        if (stayAndBuildNearby(creep)) return;

        // 5) 无处可放：掉落卸空，回采集态（脚下的 container / carrier 会接住）
        creep.drop(RESOURCE_ENERGY);
        syncMoveWork(creep, source);
    },
};
