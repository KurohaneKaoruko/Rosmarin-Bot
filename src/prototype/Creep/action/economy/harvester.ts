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

/**
 * harvester：绑定 source 的专职采集。
 *
 * 默认身体 [[WORK,2],[MOVE,2]] 无 CARRY：站上工作位持续采集，
 * 能量掉落在工作位，由 carrier / transporter 收取。
 * 有 CARRY 的体型满仓后自行交付：link > container > 建容器工地 > 丢弃。
 *
 * 顺序逻辑，无状态机：采集与交付由仓库余量直接判定，天然免疫状态失联。
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
        const income = creep.calculateHarvestIncomePerTick();
        // 交付判定：满仓 / 本 tick 再采就满 / 源枯竭但身上有货
        const shouldDeliver = carryCapacity > 0 && (free === 0 || free <= income || source.energy === 0);

        // ── 采集：有空间且源有能量 ──
        if (source.energy > 0 && !shouldDeliver) {
            if (!creep.moveToSourceWorkTile(source)) {
                syncMoveWork(creep, source);
                return;
            }
            creep.goHaverst(source);
            // 快满时同 tick 顺带进入交付，避免“采一跳卡满”原地空转
            if (carryCapacity === 0 || creep.store.getFreeCapacity() > income) {
                syncMoveWork(creep, source);
                return;
            }
        }

        // 无仓体型：能量已掉落在工作位，到此为止
        if (carryCapacity === 0) {
            syncMoveWork(creep, source);
            return;
        }

        // 源枯竭且空仓：顺手吸干旁边容器的余量，然后等待再生
        if (creep.store[RESOURCE_ENERGY] === 0 && source.energy === 0) {
            const container = creep.getNearbySourceContainer(1);
            if (container && creep.pos.isNearTo(container) && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                creep.withdraw(container, RESOURCE_ENERGY);
            }
            syncMoveWork(creep, source);
            return;
        }

        // ── 交付：相邻 link/container → 原地建造 → 兜底 ──
        if (creep.transferToSourceStructure()) return;

        const hasDeliveryNearSource =
            !!creep.getNearbySourceLink(NEAR_RANGE) || !!creep.getNearbySourceContainer(NEAR_RANGE);
        if (hasDeliveryNearSource) {
            // 交付结构满 / 不相邻：先建附近工地；cargo 快满时丢能量保采集
            if (stayAndBuildNearby(creep)) return;
            if (creep.store.getFreeCapacity() <= income) creep.drop(RESOURCE_ENERGY);
            syncMoveWork(creep, source);
            return;
        }

        // 无 link 无 container：维护容器工地（修理 / 建造布局给的工地）
        const maintain = creep.maintainSourceContainer();
        if (maintain === 'acted') return;
        if (maintain === 'blocked') {
            if (!stayAndBuildNearby(creep)) creep.drop(RESOURCE_ENERGY);
            return;
        }
        if (stayAndBuildNearby(creep)) return;
        if (!creep.pos.inRangeTo(source, 1)) creep.moveTo(source);
        syncMoveWork(creep, source);
    },
};
