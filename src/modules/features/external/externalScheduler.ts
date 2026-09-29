/**
 * 外矿补员调度的纯决策层。
 *
 * 只放「不需要 Screeps 运行时」的判断：派单排序、额度计数、跨房重平衡评分。
 * 取数（`Game.map` / 任务池 / 房间视野）留在 `externalMine.ts` 的适配层，
 * 这样决策本身可以直接被单测覆盖，也便于日后复用。
 */

// 外矿采集工 / 搬运工的角色集合。
// 两者分别设额度：采集工定编小（单源 1 个）且是搬运的前置，绝不能被搬运队列堵住；
// 搬运工体型最大、孵化最久，才是真正需要限流的一方。
export const OUTMINE_HARVEST_ROLE_SET: ReadonlySet<string> = new Set(['out-harvest']);
export const OUTMINE_CARRY_ROLE_SET: ReadonlySet<string> = new Set(['out-carry', 'out-car']);
// 并集：用于「本房整体挂了多少外矿经济任务」的派单排序。
export const OUTMINE_PENDING_ECONOMY_ROLE_SET: ReadonlySet<string> = new Set([
    ...OUTMINE_HARVEST_ROLE_SET,
    ...OUTMINE_CARRY_ROLE_SET,
]);

/** 单个外矿目标房的派单参考量。 */
export type OutMineSpawnTargetStat = {
    roomName: string;
    /** 源房 → 目标房的线性距离（越小越近）。 */
    distance: number;
    /** 该目标房已排在 spawn 池里的外矿经济任务数（采集 + 搬运）。 */
    pending: number;
};

/**
 * 统计一批孵化任务里、发往某目标房、且角色落在给定集合内的任务数。
 *
 * @param memories 任务池中已解析出的 creep memory（无效项会被忽略）。
 * @param sourceRoomName 发起孵化的源房名；任务的 `sourceRoom` 与之不符时不计入。
 * @param targetRoomName 目标房名。
 * @param roleSet 计入的角色集合。
 * @returns 计入额度的任务条数。
 */
export const countPendingMissions = (
    memories: ReadonlyArray<{ role?: string; targetRoom?: string; sourceRoom?: string } | null | undefined>,
    sourceRoomName: string,
    targetRoomName: string,
    roleSet: ReadonlySet<string>,
): number => {
    let count = 0;
    for (const memory of memories) {
        const role = memory?.role;
        if (!role || !roleSet.has(role)) continue;
        if ((memory?.targetRoom || '') !== targetRoomName) continue;
        const missionSourceRoom = memory?.sourceRoom;
        if (missionSourceRoom && missionSourceRoom !== sourceRoomName) continue;
        count++;
    }
    return count;
};

/**
 * 统计一批孵化任务里、发往某目标房的外矿经济任务数（采集 + 搬运）。
 *
 * @param memories 任务池中已解析出的 creep memory（无效项会被忽略）。
 * @param sourceRoomName 发起孵化的源房名。
 * @param targetRoomName 目标房名。
 * @returns 计入挂单额度的任务条数。
 */
export const countPendingEconomyMissions = (
    memories: ReadonlyArray<{ role?: string; targetRoom?: string; sourceRoom?: string } | null | undefined>,
    sourceRoomName: string,
    targetRoomName: string,
): number => countPendingMissions(memories, sourceRoomName, targetRoomName, OUTMINE_PENDING_ECONOMY_ROLE_SET);

// 「每次规划重算」的外矿孵化角色集合：采集 / 搬运 / 建造 / 矿物。
// 这些任务是按当前需求算出来的，不含一次性任务（防御、侦查、预定）。
export const OUTMINE_PLANNED_ROLE_SET: ReadonlySet<string> = new Set([
    ...OUTMINE_PENDING_ECONOMY_ROLE_SET,
    'out-build',
    'out-mineral',
]);

/**
 * 判断一条孵化任务是否该在下一轮派单前清掉。
 *
 * @remarks
 * 外矿经济任务每轮都按当前需求重算，所以上一轮的残留一律作废。只追加不清空有两个
 * 致命后果（线上都实际发生过）：
 * 1. 残留任务永远占着队头 —— 「先近后远」只作用于新任务的追加位置，实际孵化顺序
 *    仍旧是几天前写下的旧顺序；
 * 2. 残留任务把「单房挂单额度」占满 —— 新任务永远排不进去，外矿补员被整个冻结。
 *
 * @param memory 任务的 creep memory（无效项返回 false，不动非外矿任务）。
 * @param sourceRoomName 发起孵化的源房名；任务记录的 `sourceRoom` 与之不符时不清理。
 * @returns 需要删除时返回 true。
 */
export const shouldDropPlannedMission = (
    memory: { role?: string; sourceRoom?: string } | null | undefined,
    sourceRoomName: string,
): boolean => {
    const role = memory?.role;
    if (!role || !OUTMINE_PLANNED_ROLE_SET.has(role)) return false;
    const missionSourceRoom = memory?.sourceRoom;
    return !missionSourceRoom || missionSourceRoom === sourceRoomName;
};

/**
 * 外矿补员派单顺序：先近后远 + 负载均衡。
 *
 * @remarks
 * - 主键：线性距离升序（近房收益回收更快，先派）；
 * - 次键：该目标房已挂单数升序（挂单少的先派，配合挂单上限实现多房轮转）；
 * - 末键：房名字典序，保证顺序稳定可复现（同一状态永远得到同一顺序）。
 *
 * @param stats 各目标房的派单参考量。
 * @returns 排好序的目标房名列表。
 */
export const sortOutMineSpawnTargets = (stats: readonly OutMineSpawnTargetStat[]): string[] => {
    return [...stats]
        .sort((left, right) => {
            const distanceDiff = left.distance - right.distance;
            if (distanceDiff !== 0) return distanceDiff;
            const pendingDiff = left.pending - right.pending;
            if (pendingDiff !== 0) return pendingDiff;
            return left.roomName.localeCompare(right.roomName);
        })
        .map((stat) => stat.roomName);
};

/** 跨房搬运重平衡的候选房参考量。 */
export type CarryRoomCandidateStat = {
    roomName: string;
    /** 该房当前可用积压（已扣除在场搬运工的预定量）。 */
    available: number;
    /** 源房 → 候选房的线性距离。 */
    distance: number;
    /** 搬运 creep 是否已经站在该房里（站在里面视为在途，不收距离惩罚）。 */
    creepInRoom: boolean;
    /** 该房当前在册的搬运工数量（含在途与孵化中，不含濒死返程的）。 */
    assigned: number;
};

// 候选房必须比当前房「好」这么多才值得改目标房，抑制来回横跳。
export const CARRY_ROOM_SWITCH_MARGIN = 0.25;
// 每格线性距离折算的评分惩罚，保留就近倾向。
export const CARRY_ROOM_DISTANCE_PENALTY = 0.01;
// 「够装一趟」积压项的权重（同人数候选房之间比积压）。
export const CARRY_BACKLOG_WEIGHT = 0.5;
// 超出一次载量的过剩积压权重（只为过剩积压长途折返不划算）。
export const CARRY_SURPLUS_WEIGHT = 0.1;
/** 外矿搬运工的濒死 TTL：低于它的搬运工只回程交付、不再接新单。 */
export const OUT_CARRY_DYING_TTL = 80;

/**
 * 给单个候选房打分（人数优先，同人数时比积压）。
 *
 * @remarks
 * 主项是「在册搬运数取负」：每少一人 +1，严格压过其余所有小项——
 * 这保证负载均衡永远先看人数（各外矿房搬运数趋平），积压与距离只在同人数时起作用：
 * - 积压项：「这一趟能不能装满」（0..1），超出一次载量的积压只给小加成，
 *   避免搬运工全挤在一个刚好够装的房、而放任另一个房无人问津；
 * - 距离项：只对还没站在房里的候选收取，保留就近倾向。
 */
export const scoreCarryRoomCandidate = (stat: CarryRoomCandidateStat, carryNeed: number): number => {
    let score = -Math.max(0, stat.assigned);
    const need = Math.max(1, carryNeed);
    score += (Math.min(stat.available, need) / need) * CARRY_BACKLOG_WEIGHT;
    score += (Math.min(need, Math.max(0, stat.available - need)) / need) * CARRY_SURPLUS_WEIGHT;
    if (!stat.creepInRoom) score -= Math.max(1, stat.distance) * CARRY_ROOM_DISTANCE_PENALTY;
    return score;
};

/**
 * 从候选房里挑一个更值得跑的（搬运工动态选房）。
 *
 * @param currentTarget 当前目标房名。
 * @param carryNeed 搬运 creep 这一趟最多能装多少。
 * @param stats 候选房参考量（调用方已按同类目标房过滤）。
 * @returns 建议的目标房名；维持现状、数据不足或收益不足时返回 `null`。
 */
export const pickBestCarryRoomName = (
    currentTarget: string,
    carryNeed: number,
    stats: readonly CarryRoomCandidateStat[],
): string | null => {
    if (stats.length <= 1) return null;

    let bestRoom: string | null = null;
    let bestScore = -Infinity;
    let currentScore = -Infinity;

    for (const stat of stats) {
        const score = scoreCarryRoomCandidate(stat, carryNeed);
        if (stat.roomName === currentTarget) currentScore = score;
        if (score > bestScore) {
            bestScore = score;
            bestRoom = stat.roomName;
        }
    }

    if (!bestRoom || bestRoom === currentTarget) return null;
    // 当前房没被算到分（例如目标房无视野）时不换，避免无谓抖动。
    if (!Number.isFinite(currentScore)) return null;
    if (bestScore < currentScore + CARRY_ROOM_SWITCH_MARGIN) return null;
    return bestRoom;
};
