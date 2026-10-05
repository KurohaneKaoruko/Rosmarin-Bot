/**
 * 冲级分段节奏评估：以 lv1 基线对照分段目标表，输出各段达成/预计/落后/判废状态；
 * 段超时判废该轮 attempt 并生成归因快照，供面板与落盘消费。
 */
import { ROLES } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';

export type SegmentStatus = {
    /** 目标等级 */
    level: number;
    /** 达成线（tick，相对 lv1 基线） */
    target: number;
    /** 合格线；无独立合格线的段与达成线同值 */
    pass: number;
    /** 达成耗时；未达成为 undefined */
    achievedAt?: number;
    /** 已流逝耗时；未达成为当前值 */
    elapsed?: number;
    /** 预计达成耗时；速率>0 且进度点已知才有值 */
    eta?: number;
    /** 落后标识：预计/实际耗时超过达成线（但未超合格线 → 合格档） */
    behind: boolean;
    /** 判废：耗时超过合格线（无合格线段即达成线） */
    failed: boolean;
};

export type RaceProgressInput = {
    /** lv1 基线绝对 tick */
    baseline: number;
    /** 当前绝对 tick */
    now: number;
    /** 当前控制器等级 */
    level: number;
    /** 当前级已积累进度点 */
    progress: number;
    /** 实测升级速率（点/tick） */
    rate: number;
    /** 各级达成绝对 tick */
    levels: Record<number, number>;
    /** 未达成目标等级 → 从当前位置到该级的剩余进度点（调用方按实测条+兜底表计算） */
    pointsToReach: Record<number, number>;
};

/** 分段目标表（等级升序；pass 缺省取 achieve，即无独立合格线） */
const SEGMENTS = Object.entries(THRESHOLDS.RUSH.SEGMENT_TARGETS)
    .map(([level, spec]) => {
        const s = spec as { achieve: number; pass?: number };
        return { level: Number(level), target: s.achieve, pass: s.pass ?? s.achieve };
    })
    .sort((a, b) => a.level - b.level);

export const RUSH_SEGMENT_LEVELS = SEGMENTS.map((s) => s.level);

/** 评估全部分段状态；未达成段「已流逝超合格线」同样判废（即使立刻达成也已超时） */
export const evaluateRaceSegments = (input: RaceProgressInput): SegmentStatus[] => {
    const { baseline, now, rate, levels, pointsToReach } = input;
    const elapsed = now - baseline;
    return SEGMENTS.map(({ level, target, pass }) => {
        const achievedTick = levels[level];
        if (achievedTick) {
            const achievedAt = Math.max(0, achievedTick - baseline);
            return {
                level,
                target,
                pass,
                achievedAt,
                behind: achievedAt > target,
                failed: achievedAt > pass,
            };
        }
        const remaining = pointsToReach[level];
        const eta = rate > 0 && remaining !== undefined
            ? elapsed + Math.ceil(remaining / rate)
            : undefined;
        const failed = elapsed > pass;
        const behind = failed || (eta !== undefined && eta > target);
        return { level, target, pass, elapsed, eta, behind, failed };
    });
};

/** 判废落账：仅在「首次判废或判废段变化」时写入快照，返回是否新判废 */
export const applySegmentVerdicts = (
    state: {
        failed?: boolean;
        failedSegment?: number;
        failSnapshot?: Record<string, unknown>;
    },
    statuses: SegmentStatus[],
    buildSnapshot: (segment: SegmentStatus) => Record<string, unknown>,
): boolean => {
    const firstFail = statuses.find((s) => s.failed);
    if (!firstFail) return false;
    if (state.failed && state.failedSegment === firstFail.level) return false;
    state.failed = true;
    state.failedSegment = firstFail.level;
    state.failSnapshot = buildSnapshot(firstFail);
    return true;
};

/** 判废归因快照： census/孵化池/升级火力/能量状态，一次性采集，成本不限 */
export const buildFailSnapshot = (room: Room, segment: SegmentStatus): Record<string, unknown> => {
    const census: Record<string, number> = {};
    let upgradeWork = 0;
    for (const creep of Object.values(Game.creeps)) {
        if (creep.room.name !== room.name) continue;
        const role = (creep.memory as any)?.role || '?';
        census[role] = (census[role] || 0) + 1;
        if (role === ROLES.upgrader) upgradeWork += creep.getActiveBodyparts(WORK);
    }
    const spawnPool: Record<string, number> = {};
    for (const task of ((room as any).getAllMissionFromPool?.('spawn') ?? []) as any[]) {
        const role = task?.data?.memory?.role || '?';
        spawnPool[role] = (spawnPool[role] || 0) + 1;
    }
    const controller = room.controller;
    const cc = ((room as any).container || []).find((c: Structure) =>
        controller && c.pos.inRangeTo(controller.pos, 3));
    return {
        time: Game.time,
        level: controller?.level,
        segment: segment.level,
        target: segment.target,
        elapsed: segment.elapsed ?? segment.achievedAt,
        energyState: (room.memory as any).energyState,
        building: (room.memory as any).building,
        upgradersStarved: (room.memory as any).upgradersStarved,
        upgradeWork,
        census,
        spawnPool,
        controllerBuffer: cc ? cc.store[RESOURCE_ENERGY] : -1,
    };
};
