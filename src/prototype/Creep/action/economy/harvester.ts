import { writeMoveWorkTileCandidates } from '@/shared/moveWork';

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
export default {
    run: function (creep: Creep) {
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
                if (!creep.memory.calibrated) {
                    const roomMem = creep.room.memory as any;
                    roomMem.sourceTiming ??= {};
                    const timing = roomMem.sourceTiming[source.id] ?? (roomMem.sourceTiming[source.id] = {});
                    timing.pathTime = Math.max(10, Math.min(500, Game.time - (creep.memory.spawnTick ?? Game.time)));
                    creep.memory.calibrated = true;
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
