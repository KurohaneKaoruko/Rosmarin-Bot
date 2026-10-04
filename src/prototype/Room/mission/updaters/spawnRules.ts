import { RoleLevelData } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getDowngradedLogisticsCountByAssignedRoom, hasSoonDeadCreepByAssignedRoomRole } from '@/modules/shared/creepTickIndex';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { isRaceCompat } from '@/modules/shared/gameCapabilities';
import { getControllerCarryQuota } from '@/prototype/Creep/function/energyLogistics';
import {
    getRoomEnergyState,
    getRoomMode,
    isHighLikeMode,
    isUpgraderSpawnUrgent,
    getStoredEnergy,
    hasControllerEnergyBuffer,
    shouldDelayUpgraderForPrimaryBuild,
    getDowngradeUniversalTarget,
    getDowngradeUniversalSpawnMissing,
    getWorkerBuildTarget,
    getWorkerWallTarget,
    getWorkerUpgradeTarget,
    getWorkerPopulationCap,
    getUpgraderTarget,
    getUpgraderSuccessionNeeds,
    getDroppedPileEnergy,
    getDroppedPileWorkerBoost,
    getMyConstructionSites,
    getRushCarrierTarget,
    estimateRoomEnergyIncome,
} from '@/modules/shared/roomWorkforce';

// 存量符号再导出：spawnMission / spawnControl 等历史调用方仍从本模块取用
export {
    shouldDelayUpgraderForPrimaryBuild,
    getDowngradeUniversalTarget,
    getDowngradeUniversalSpawnMissing,
    getMyConstructionSites,
} from '@/modules/shared/roomWorkforce';

// 搬运任务生成阈值
const TRANSPORT_MIN = THRESHOLDS.TRANSPORT.MIN_AMOUNT;
const TRANSPORT_HIGH = THRESHOLDS.TRANSPORT.HIGH_AMOUNT;
// 单矿最大采集 work 上限
const HARVESTER_MAX_WORK_PER_SOURCE = Math.ceil(
    SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER
);
// 只有 transporter 允许在恢复期按“缩水物流”扣减 current；
// manager 是中心单点位，若扣减会把“已有缩水 manager”误判成缺口，导致反复补人堵路。
const RECOVERY_DOWNGRADED_CORRECTION_ROLE_SET = new Set(['transporter']);

const getEnergyState = getRoomEnergyState;

// 将已入队但应该被推迟的升级类任务清理掉，避免卡队列
export const pruneDelayedUpgraderSpawnMissions = (room: Room) => {
    if (!shouldDelayUpgraderForPrimaryBuild(room)) return 0;
    const tasks = (room.getAllMissionFromPool('spawn') || []) as Task[];
    let removed = 0;
    for (const task of tasks) {
        const taskData = task.data as SpawnTask
        const role = taskData?.memory?.role;
        if (role !== 'upgrader' && role !== 'up-upgrade') continue;
        room.deleteMissionFromPool?.('spawn', task.id);
        removed += 1;
    }
    return removed;
};



// 统计 source 周围可站位，用于估算 harvester 数量上限
const getWalkableSourceSlots = (room: Room, source: Source): number => {
    const terrain = room.getTerrain();
    let slots = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = source.pos.x + dx;
            const y = source.pos.y + dy;
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

            const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
            const blocked = structures.some((s: any) =>
                s.structureType !== STRUCTURE_ROAD &&
                s.structureType !== STRUCTURE_CONTAINER &&
                !(s.structureType === STRUCTURE_RAMPART && s.my)
            );
            if (blocked) continue;
            slots++;
        }
    }
    return slots;
};

const getWorkPartCount = (body: BodyPartConstant[]) => {
    let work = 0;
    for (const part of body) {
        if (part === WORK) work++;
    }
    return work;
};

// 用已建成的 spawn/extension 容量估算“实际可用等级”，避免 controller 刚升 4 但建筑未补齐时误判。
const getBuiltRoomLevel = (room: Room) => {
    return room.getEffectiveRoomLevel?.() ?? room.level;
};

// 低等级允许多采集位，高等级默认一矿一采。
// 这里必须看“已建成等级”而不是 controller 等级：
// controller 刚升 4 但 spawn/extension 还没补满时，harvester 体型仍可能偏小；
// 一旦房间已经具备完整 4 级产能，就不应该再让单矿超过 1 个 harvester。
const getHarvesterTargetBySource = (room: Room): number => {
    let target = 0;
    const builtLevel = getBuiltRoomLevel(room);
    const allowMultiHarvesterPerSource = builtLevel <= 3;
    const harvesterBody = room.GenerateBodys(room.GetRoleBodys('harvester'), 'harvester');
    const workPerHarvester = Math.max(1, getWorkPartCount(harvesterBody));
    const maxByWorkCap = Math.max(1, Math.ceil(HARVESTER_MAX_WORK_PER_SOURCE / workPerHarvester));
    for (const source of room.source || []) {
        const slots = getWalkableSourceSlots(room, source);
        if (slots <= 0) continue;
        const bySlot = allowMultiHarvesterPerSource ? slots : 1;
        target += Math.min(bySlot, maxByWorkCap);
    }
    return target;
};

// 产出就绪：采矿工满编（在岗数 ≥ 编制目标）。
// 开局序列（参考实现观察口径）：先矿工孵化到位、产出稳住，之后才放行升级/搬运扩张/外矿
export const isRoomProductionSecured = (room: Room): boolean => {
    const target = getHarvesterTargetBySource(room);
    if (target <= 0) return true;
    const alive = getRoomTickCacheValue(room, 'production_secured_harvesters', () =>
        room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) => c.memory?.role === 'harvester' && !c.spawning,
        }).length,
    );
    return alive >= target;
};

// 无缝换班：按每个 source 的实测路程判定接班需求。
// 返回需要额外孵化的接班者数量；路程尚未校准的 source 不参与（首次换班按原逻辑走）。
const getHarvesterSuccessionNeeds = (room: Room): number => {
    const timing = (room.memory as any).sourceTiming;
    if (!timing) return 0;
    const harvesters = getRoomTickCacheValue(room, 'succession_harvesters', () =>
        room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) => c.memory.role === 'harvester' && !!c.memory.targetSourceId
        }) as Creep[]
    );

    let needs = 0;
    for (const source of room.source || []) {
        const info = timing[source.id];
        const pathTime = info?.pathTime;
        if (typeof pathTime !== 'number') continue;
        const bound = harvesters.filter(h => h.memory.targetSourceId === source.id);
        if (bound.length === 0) continue;
        const incubation = Math.max(...bound.map(h => h.body.length * 3), 12);
        const covered = bound.some(h => (h.ticksToLive || 0) > pathTime + incubation + 10);
        if (!covered) needs += 1;
    }
    return needs;
};

// ==================== worker 定编 ====================
// 常规升级已并入 worker，三侧定编（建造/刷墙/升级）统一在 shared/roomWorkforce：
// - 升级吞吐按「采集收入 × 能量水平」动态缩放，
//   富余能量优先被控制器吃掉，不再出现“只进不出 → 能量堆地上腐烂”；
// - 孵化定编 = 建造侧 + 刷墙保底 + 升级侧（相加），
//   运行时由 worker 动作层的职责切分保证配额外的个体专职升级。

// 每个角色一个检查函数，保持结构清晰
export const RoleSpawnCheck: Record<string, (room: Room, current: number) => boolean> = {
    'harvester': (room: Room, current: number) => {
        if (room.memory.defend) return false;
        let baseTarget = getHarvesterTargetBySource(room);
        // CRITICAL 复苏：定编压到每 source 1 只——多矿位小爬群只会吃光能量，
        // 集中孵大体型主力才能爬出贫困陷阱
        if (getEnergyState(room) === 'CRITICAL') {
            baseTarget = Math.min(baseTarget, (room.source || []).length || 1);
        }
        if (baseTarget <= 0) return false;

        // 无缝换班：绑定爬 TTL 低于「实测路程 + 孵化期 + 缓冲」时，
        // 立即孵接班者——新爬在路上走的时候老爬还在挖，到场即无缝接班，矿位不空转。
        const successorNeeds = getHarvesterSuccessionNeeds(room);
        if (successorNeeds > 0 && current < baseTarget + successorNeeds) return true;

        let num = baseTarget;
        if (isHighLikeMode(getRoomMode(room)) && getBuiltRoomLevel(room) <= 3) {
            // high/rush 下，提前补一个临近到期的 harvester
            const shouldPreSpawn = hasSoonDeadCreepByAssignedRoomRole(room.name, 'harvester', 10);
            if (shouldPreSpawn) num += 1;
        }
        return current < num;
    },
    'transporter': (room: Room, current: number) => {
        const state = getEnergyState(room);
        const highMode = isHighLikeMode(getRoomMode(room));
        const storedEnergy = getStoredEnergy(room);
        const hasStorageLike = !!room.storage || !!room.terminal;
        let num = RoleLevelData['transporter'][room.level]['num'];

        // transporter 当前仍依赖 storage / terminal 体系与 transport mission 调度，
        // 因此在只有 container 的恢复期不能提前孵化，否则只会空转占位。
        if (!hasStorageLike) return false;

        if (highMode && state !== 'LOW' && state !== 'CRITICAL') {
            if (storedEnergy >= TRANSPORT_HIGH) num += 1;
            if (storedEnergy >= TRANSPORT_HIGH * 3 && hasControllerEnergyBuffer(room)) num += 1;
            num = Math.min(num, 3);
        }
        if (current >= num) return false;
        if (state === 'LOW' || state === 'CRITICAL') return true;
        if (storedEnergy < TRANSPORT_MIN) return false;
        return hasStorageLike;
    },
    'manager': (room: Room, current: number) => {
        const num = RoleLevelData['manager'][room.level]['num'];
        if (num == 0) return false;
        const center = room.getCenter();
        const storage = room.storage;
        const terminal = room.terminal;
        const link = room.link?.find(l => l.pos.inRangeTo(center, 1));
        return current < num && !!storage && !!(terminal || link);
    },
    'carrier': (room: Room, current: number) => {
        // 无源房短路（能力闸）：没有能量产出源的房间不需要搬运线
        if (!(room.source || []).length) return false;
        const num = RoleLevelData['carrier'][room.level]['num'];

        // 开局序列（race 兼容闸门）：采矿工满编产出稳住之前，搬运工不超矿工数
        // （防止开局出现 3 搬运工 : 1 矿工的倒挂，spawn 槽被物流爬吃光）
        if (isRaceCompat() && !isRoomProductionSecured(room)) {
            const harvestersAlive = getRoomTickCacheValue(room, 'carrier_gate_harvesters', () =>
                room.find(FIND_MY_CREEPS, { filter: (c: Creep) => c.memory?.role === 'harvester' && !c.spawning }).length,
            );
            if (current >= Math.max(1, harvestersAlive)) return false;
        }

        // 地面堆积 = 取力吞吐不足的真实信号：允许在编数之上小幅加编（上限 num+2）。
        // 「身上有货」不算忙碌——载货是搬运工的常态而非短缺证据，按负载率补员只会超编。
        const pile = getDroppedPileEnergy(room);
        let demand = num + (pile > 1000 ? 1 : 0) + (pile > 3000 ? 1 : 0);
        // rush：搬运定编改运力公式（速率×往返路程×2，见 getRushCarrierTarget），
        // 固定分级表只在路程未校准的开局兜底；控制器专线配额继续取大并入
        if (getRoomMode(room) === 'rush') {
            const quota = getControllerCarryQuota(room);
            demand = Math.max(demand, getRushCarrierTarget(room), quota > 0 ? quota + 2 : 0);
        }
        if (current < demand) return true;

        if (demand > 0) return false;

        // num 为 0 的低配房：仅在明确需求下保留 1 个 carrier
        if (current >= 1) return false;
        if (!room.storage && !room.terminal) {
            const creepNum = room.getCreepNum() || {};
            const hasHarvester = (creepNum['harvester'] || 0) > 0;
            if (hasHarvester && room.CheckSpawnAndTower()) return true;
        }

        if (room.mineral?.mineralAmount > 0) return true;
        if (room.container?.some((c) => c.store.getUsedCapacity() > 1000)) return true;
        return false;
    },
    // worker 同时承担建造/维修与常规升级：
    // 孵化目标 = 建造侧 + 刷墙保底 + 升级侧（相加），
    // 运行时按「建造配额 → 配额外专职升级」做职责切分（见 action/economy/worker.ts）。
    // 总人口受 getWorkerPopulationCap 硬上限约束——work 部件预算是为大体型升级工设计的，
    // 低 RCL 的 1-work 体型直接折算会孵出几十只。
    'worker': (room: Room, current: number) => {
        if (Memory['warmode']) return false;

        // 换班制（参考实现 manageBuild 口径）：基建工地存在 = worker 全员转建造
        // （升级侧归零，升级由固定升级岗 upgrader 承担）；工地清零 = 全员转回升级。
        // worker 在两班之间整体切换，不做建造/升级同时配编的折中
        const building = (room.memory as any).building === true;
        const buildTarget = getWorkerBuildTarget(room);
        const wallTarget = buildTarget > 0 ? 0 : getWorkerWallTarget(room);
        const upgradeTarget = building ? 0 : getWorkerUpgradeTarget(room);
        const total = building ? buildTarget + wallTarget : wallTarget + upgradeTarget;
        // 地面出现能量堆积时，允许临时突破人口硬上限加班消化
        const cap = getWorkerPopulationCap(room) + getDroppedPileWorkerBoost(room);
        return current < Math.min(total, cap);
    },
    // 专人升级工（upgrader）：编制完全由房间模式决定，策略与让位闸门都在
    // shared/roomWorkforce.getUpgraderTarget：
    //   low/main → 0（常规升级由 worker 兼任）
    //   high     → 按升级 work 需求折算（受控制器工位上限约束），同时把 worker 升级侧扣掉同等份额
    //   rush     → 按升级 work 需求折算（受冲级工位上限约束）；两者都先被按 RCL 的人口上限封顶，
    //              避免低 RCL 的 1-WORK 体型把一笔 work 预算折成几十只升级工
    // 这里只负责把缺口补齐，不重复任何策略判断。
    'upgrader': (room: Room, current: number) => {
        if (Memory['warmode']) return false;
        // 能量储备闸：spawn/extension 里的能量必须留足房间运作底仓（≈两次基础孵化），
        // 只用盈余孵升级工——rush 冲级也不许把开局能量无脑烧光。
        // 例外：净收入已超过在场升级火力（urgent 口径）时放行——否则低能量位
        // 「没升级工→能量没人花→能量一直低→永远不发升级单」死锁
        if (room.energyAvailable < room.energyCapacityAvailable * 0.6 && room.energyAvailable < 800
            && !isUpgraderSpawnUrgent(room)) return false;
        // 孵化节流（参考 UPGRADE_PRIORITY 口径）：净收入吃不满在编火力时不加编、只维持存量，
        // 防止升级端把采集端吃穿（开局收入爬坡期尤其致命）；存量归零后仍允许从 1 只起步
        if (isRaceCompat() && current > 0) {
            const fieldWork = getRoomTickCacheValue(room, 'upgrader_field_work', () =>
                room.find(FIND_MY_CREEPS, {
                    filter: (c: Creep) => c.memory?.role === 'upgrader' && !c.spawning,
                }).reduce((sum, c) => sum + c.getActiveBodyparts(WORK), 0),
            );
            if (estimateRoomEnergyIncome(room) <= fieldWork) return false;
        }
        // 升级岗不做产出就绪硬闸（参考实现口径：预算与孵化池优先级排序已足够——
        // harvester 单等级恒高于 upgrader，采集补员自然插队；硬闸只会拖慢升级岗上线）
        const target = getUpgraderTarget(room);
        if (target <= 0) return false;
        // 无缝替班：在编 upgrader 的 TTL 都覆盖不住「实测路程 + 孵化期 + 缓冲」时，
        // 立即预孵 1 只接班者（同 harvester 换班语义）——接班爬还在路上时
        // 前任仍在升级，控制器功率不出现死后空窗的锯齿。
        if (getUpgraderSuccessionNeeds(room) > 0 && current < target + 1) return true;
        return current < target;
    },
    'miner': (room: Room, current: number) => {
        const lv = room.level;
        if (lv < 6) return false;
        if (room.memory.defend) return false;
        if (!room.storage) return false;
        if (!room.extractor) return false;
        if (room.mineral.mineralAmount <= 0) return false;
        const mineralPos = room.mineral.pos;
        const sources = room.source || room.find(FIND_SOURCES);
        const hasMineralContainer = room.container?.some((c) => {
            if (!c.pos.isNearTo(mineralPos)) return false;
            const isSourceContainer = sources.some((s) => s && c.pos.isNearTo(s.pos));
            const isControllerContainer = !!room.controller && c.pos.inRangeTo(room.controller.pos, 1);
            return !isSourceContainer && !isControllerContainer;
        });
        if (!hasMineralContainer) return false;
        const store = room.storage.store;
        if (store.getUsedCapacity() > store.getCapacity() * 0.95) return false;
        if (store[room.mineral.mineralType] > 1e6) return false;
        const extMaxEnergyCapacity =
            CONTROLLER_STRUCTURES['spawn'][lv] * 300 +
            CONTROLLER_STRUCTURES['extension'][lv] * EXTENSION_ENERGY_CAPACITY[lv];
        if (room.energyCapacityAvailable < extMaxEnergyCapacity) return false;
        return current < 1 && lv >= 6;
    },
    'universal': (room: Room, current: number) => {
        // UNIV 仅在「真停摆」时孵化：采集端（矿工+搬运）场上活体归零，
        // 或控制器临近降级。判定只看活体——池内挂单可能永远付不起，
        // 把挂单算成补给会让停摆检测被幻影订单致盲（死锁实录）。
        // bootstrap LOW 态、外矿爬坡期、spawn 繁忙都是常态——不是停摆。
        const creepNum = room.getCreepNum() || {};
        const incomeAlive =
            (creepNum['harvester'] || 0) + (creepNum['carrier'] || 0);
        const downgradeUrgent = !!room.controller?.my
            && (room.controller.ticksToDowngrade || 1e9) < 3000
            && room.level < 8;

        // rush 开局经济只有定点矿工/搬运/升级：停摆由应急孵化补最小经济体，
        // UNIV 永不参与
        if (getRoomMode(room) === 'rush') return false;
        if (incomeAlive > 0) return false;   // 采集端在跑：永不孵 UNIV
        if (!downgradeUrgent && room.level > 1) return false;   // 无降级风险：不孵
        return current < 2;
    },
};

export type SpawnCheckContext = {
    room: Room;
    creepNum: Record<string, number>;
    spawnMissionNum: Record<string, number>;
    shouldRecover: boolean;
    downgradedCount: Record<string, number>;
};

// 统一构造孵化检查上下文：
// 把“当前数量 + 已入队数量 + 降级物流扣减”集中在这里，避免各处重复拼装。
export const createSpawnCheckContext = (
    room: Room,
    creepNum: Record<string, number>,
    spawnMissionNum: Record<string, number>,
): SpawnCheckContext => {
    const state = getEnergyState(room);
    const shouldRecover = state === 'NORMAL' || state === 'SURPLUS';
    return {
        room,
        creepNum,
        spawnMissionNum,
        shouldRecover,
        downgradedCount: shouldRecover ? getDowngradedLogisticsCountByAssignedRoom(room.name) : {},
    };
};

// 获取某个角色经过“恢复期物流扣减”后的有效当前数量。
export const getAdjustedSpawnRoleCurrent = (context: SpawnCheckContext, role: string): number => {
    const current = (context.creepNum[role] || 0) + (context.spawnMissionNum[role] || 0);
    if (!context.shouldRecover) return current;
    if (!RECOVERY_DOWNGRADED_CORRECTION_ROLE_SET.has(role)) return current;
    return Math.max(0, current - (context.downgradedCount[role] || 0));
};

// 统一角色孵化判定入口：
// 默认使用上下文中的当前数量，也允许外部显式传入 current 做单点判断。
export const shouldSpawnRole = (
    role: string,
    context: SpawnCheckContext,
    current = getAdjustedSpawnRoleCurrent(context, role),
): boolean => {
    if (role === 'universal') {
        return getDowngradeUniversalSpawnMissing(context.room, current) > 0 || RoleSpawnCheck[role]?.(context.room, current) === true;
    }

    const checker = RoleSpawnCheck[role];
    if (!checker) return false;
    return checker(context.room, current);
};

// ==================== rush 外矿受控让位 ====================

// 外矿链挂单角色（含预订）
const REMOTE_POOL_ROLES = new Set(['out-harvest', 'out-carry', 'out-build', 'out-defend', 'reserver']);
export { REMOTE_POOL_ROLES };
/** rush 期外矿挂单池上限（防孵化池灌爆事故复发） */
export const RUSH_REMOTE_POOL_CAP = 6;
/**
 * rush 期外矿挂单的优先级下限：数值 ≥ 该档即排在本矿经济（L1-3）、
 * 升级单（L5/L7）、worker（L8）之后——「受控让位」的排序落地。
 */
export const RUSH_REMOTE_LEVEL_FLOOR = 9;

/**
 * rush 期孵化池的外矿挂单治理：
 * - 本矿采集编制未满足（矿工未满编）→ 外矿/预订挂单全部清出（不进池口径的池内兜底）；
 * - 超过挂单上限 → 按优先级最低（level 最大）先裁，裁到上限内。
 * @returns 清除的挂单数
 */
export const pruneRushRemoteMissions = (room: Room, pool: Task[]): number => {
    const remote = (pool || []).filter(t => REMOTE_POOL_ROLES.has((t.data as any)?.memory?.role || ''));
    if (remote.length === 0) return 0;
    let removed = 0;
    // 阶段门：RCL1 禁开（spawn 只有 300 容量，任何外矿体型都挤占本矿）。
    // RCL2 起放行——旧「RCL4 禁开」补丁针对的「买不起的外矿单卡死队列头」
    // 已被两层根治：外矿单 rush 期恒压 L9（等待只挡 L11 scout）+ 体型按当前能量现算
    if (room.level < 2) {
        for (const task of remote) {
            room.deleteMissionFromPool?.('spawn', task.id);
            removed++;
        }
        return removed;
    }
    if (!isRoomProductionSecured(room)) {
        for (const task of remote) {
            room.deleteMissionFromPool?.('spawn', task.id);
            removed++;
        }
        return removed;
    }
    if (remote.length <= RUSH_REMOTE_POOL_CAP) return 0;
    const overflow = [...remote].sort((a, b) => b.level - a.level)
        .slice(0, remote.length - RUSH_REMOTE_POOL_CAP);
    for (const task of overflow) {
        room.deleteMissionFromPool?.('spawn', task.id);
        removed++;
    }
    return removed;
};

/**
 * 孵化选单的有效优先级：rush 期外矿挂单压到 RUSH_REMOTE_LEVEL_FLOOR 之下
 * （取 max 原档与下限），本矿单不受影响；非 rush 恒返回原档。
 */
export const effectiveSpawnLevel = (room: Room, task: Task): number => {
    if (getRoomMode(room) !== 'rush') return task.level;
    const role = (task.data as any)?.memory?.role || '';
    // reserver 豁免让位：预定决定外矿 source 容量（有预定 3000 / 无 1500），是收入倍增器；
    // 每房仅 1 只不会灌池，压到 L9 会在孵化繁忙期永久饿死（与 reserve 提级 L6 的设计冲突）
    if (role === 'reserver') return task.level;
    if (!REMOTE_POOL_ROLES.has(role)) return task.level;
    // 收入先行（参考实现 REMOTE_SOURCE 恒先于升级消费）：经济外矿（采集/搬运）恢复
    // 自然档 L4/L5——低于本矿采集 L3、高于升级 L7。旧「压 L9」针对的固定大体型
    // 买不起堵队列已被体型现算根治；防洪水仍由预算准入与每房挂单上限承担
    if (role === 'out-harvest' || role === 'out-carry') return task.level;
    return Math.max(task.level, RUSH_REMOTE_LEVEL_FLOOR);
};

/**
 * 房间孵化任务模块（spawn）
 * @description
 * - 根据房间状态与 RoleSpawnCheck 规则动态生成孵化任务
 * - 提供 SpawnMissionAdd 将孵化任务写入任务池，并失效 SpawnMissionNum 缓存
 */
