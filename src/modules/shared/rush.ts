import { ROLES } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';

/**
 * rush 体型生成器：按能量预算现算体型，替代固定分级表。
 * 契约：任意预算下成本 ≤ 预算；预算 ≥ 各自下限即可孵化（多级下探防死锁）；
 * 预算低于下限返回 null（调用方跳过，不留死锁体型）。
 *
 * 口径：
 * - harvester：[W×n, M1] 定点矿工化（无 CARRY，掉落工作位由 carrier 收取），
 *   WORK 封顶单矿再生上限（5 W = 10 能量/tick）；
 * - carrier：[C,C,M] 路面组（150/组，1 MOVE 拖 2 CARRY 按有路网前提）；
 * - upgrader：[W×n, C×cn(≤4), M1]，WORK 优先、高预算补 CARRY 缓冲；
 * - worker：[W,C,M] 路面组（200/组，rush 早铺路网，1:1:1 配比）。
 */

/** 部件成本表（桩环境可能缺全局常量，走兜底） */
const PART_COST: Record<string, number> = {
    work: 100,
    carry: 50,
    move: 50,
    claim: 600,
    attack: 80,
    ranged_attack: 150,
    heal: 250,
    tough: 10,
};

const partCost = (part: string): number => PART_COST[part] ?? 100;

/** 全局常量兜底（桩环境可能缺全局；取值与参考实现一致） */
const HARVEST_POWER_V = (): number => (typeof HARVEST_POWER === 'number' ? HARVEST_POWER : 2);
const CARRY_CAPACITY_V = (): number => (typeof CARRY_CAPACITY === 'number' ? CARRY_CAPACITY : 50);
const MAX_CREEP_SIZE_V = (): number => (typeof MAX_CREEP_SIZE === 'number' ? MAX_CREEP_SIZE : 50);

/** 按参考实现的部件排布拼装（零计数分组省略） */
const assembleRushBody = (...groups: [BodyPartConstant, number][]): RushBody =>
    groups.filter(([, n]) => n > 0) as RushBody;

export type RushBody = ((BodyPartConstant | number)[])[];

const bodyCost = (body: RushBody): number =>
    body.reduce((sum, [part, n]) => sum + partCost(part as string) * Number(n), 0);

const workCount = (body: RushBody): number =>
    body.reduce((sum, [part, n]) => sum + (part === WORK ? Number(n) : 0), 0);

/** 单矿再生上限折算的采集 WORK 上限（SOURCE_ENERGY_CAPACITY/ENERGY_REGEN_TIME 兜底 10/tick） */
const maxHarvestWork = (): number => {
    const perTick = (typeof SOURCE_ENERGY_CAPACITY === 'number' ? SOURCE_ENERGY_CAPACITY : 3000) /
        (typeof ENERGY_REGEN_TIME === 'number' ? ENERGY_REGEN_TIME : 300);
    return Math.max(1, Math.floor(perTick / 2));
};

/** harvester 最低孵化预算：[W1,M1] = 150 */
export const RUSH_HARVESTER_MIN_BUDGET = 150;

/**
 * harvester 体型（参考实现 getMinerBody 口径）：
 * 1 MOVE 起步 → 预算内先堆 WORK（< 5 的低耗档且 < maxWork）→
 * 按 `move/work ≥ speed` 补 MOVE 消除移动疲劳（speed 默认 0.5，满速）→
 * `work ≥ 5` 后按 needCarry 补 CARRY 缓冲（4×work×HARVEST_POWER / CARRY_CAPACITY），
 * 非 needCarry 维持 1 个 CARRY 下限 → 最后受 maxWork 封顶。
 *
 * 排布沿用参考实现：WORK 组在前、收尾 1 个 WORK。
 */
export const buildRushHarvesterBody = (
    budget: number,
    options: { maxWork?: number; needCarry?: boolean; speed?: number } = {},
): RushBody | null => {
    const { maxWork, needCarry = false, speed = 0.5 } = options;
    if (budget < RUSH_HARVESTER_MIN_BUDGET) return null;
    const cap = maxWork ?? maxHarvestWork();

    let cost = 0;
    let work = 0;
    let move = 0;
    let carry = 0;

    move += 1;
    cost += partCost('move');
    if (needCarry) {
        carry += 1;
        cost += partCost('carry');
    }

    while (cost < budget && work + move + carry < MAX_CREEP_SIZE_V()) {
        if (work < 5 && work < cap && budget >= cost + partCost('work')) {
            work += 1;
            cost += partCost('work');
            continue;
        }

        if ((move === 0 || move / work < speed) && budget >= cost + partCost('move')) {
            move += 1;
            cost += partCost('move');
            continue;
        }

        const desiredCarry = needCarry
            ? Math.ceil((4 * work * HARVEST_POWER_V()) / CARRY_CAPACITY_V())
            : 1;

        if (work >= 5 && carry < desiredCarry && budget >= cost + partCost('carry')) {
            carry += 1;
            cost += partCost('carry');
            continue;
        }

        if (cap && work >= cap) break;

        if (budget >= cost + partCost('work')) {
            work += 1;
            cost += partCost('work');
            continue;
        }

        break;
    }

    return assembleRushBody([WORK, work - 1], [CARRY, carry], [MOVE, move], [WORK, 1]);
};

/** carrier 路面组大小：[C,C,M] = 150 */
const CARRIER_GROUP_COST = partCost('carry') * 2 + partCost('move');
/** carrier 最低孵化预算：单组 [C,C,M] = 150 */
export const RUSH_CARRIER_MIN_BUDGET = CARRIER_GROUP_COST;
/** carrier 组数上限（防极端高容量折出超编） */
const CARRIER_MAX_GROUPS = 12;

/**
 * @deprecated 已被 `GetRoleBodys` 的搬运动态体型特例取代（接力期 `maxCarry 4` 小体型快周转、
 * lv7+ 直运放开 32、`forRoad` 按路网覆盖率）——rush 孵化落点与搬运编制公式均已收口到那条口径
 * （见 `spawnMission.buildRushSpawnBody` / `roomWorkforce.getRushCarrierCarryParts`）。
 * 本函数与 `buildRushBody` 的 carrier 分支仅作历史保留，待收官批次（B6）核对无消费者后删除。
 */
export const buildRushCarrierBody = (budget: number): RushBody | null => {
    if (budget < RUSH_CARRIER_MIN_BUDGET) return null;
    const groups = Math.min(CARRIER_MAX_GROUPS, Math.floor(budget / CARRIER_GROUP_COST));
    return [[CARRY, groups * 2], [MOVE, groups]];
};

/**
 * upgrader 体型（参考实现 getUpgraderBody 口径）：
 * 1W1C1M（200）起步 →
 * CARRY 增长门为**容量比** `(CARRY_CAPACITY×carry)/work < carryRatio`
 * （carryRatio 默认 1：升级期基本维持 1 个 CARRY 缓冲）→
 * MOVE 增长门 `work/move ≥ 4`（最多 4 WORK 拖 1 MOVE）→
 * 其余预算全部转 WORK → WORK 达 maxWork（升级缺口）即停。
 *
 * 排布沿用参考实现：WORK 组在前、收尾 1 个 WORK。
 */
export const RUSH_UPGRADER_MIN_BUDGET = partCost('work') + partCost('carry') + partCost('move');

export const buildRushUpgraderBody = (
    budget: number,
    options: { maxWork?: number; carryRatio?: number } = {},
): RushBody | null => {
    const { maxWork, carryRatio = 1 } = options;
    if (budget < RUSH_UPGRADER_MIN_BUDGET) return null;

    const maxParts = MAX_CREEP_SIZE_V();
    let cost = partCost('work') + partCost('carry') + partCost('move');
    let work = 1;
    let move = 1;
    let carry = 1;

    while (budget > cost) {
        if ((CARRY_CAPACITY_V() * carry) / work < carryRatio && budget >= cost + partCost('carry')) {
            if (work + move + carry + 1 > maxParts) break;
            carry += 1;
            cost += partCost('carry');
            continue;
        }

        if ((move === 0 || work / move >= 4) && budget >= cost + partCost('move')) {
            if (work + move + carry + 1 > maxParts) break;
            move += 1;
            cost += partCost('move');
            continue;
        }

        if (maxWork && work >= maxWork) break;

        if (budget >= cost + partCost('work')) {
            if (work + move + carry + 1 > maxParts) break;
            work += 1;
            cost += partCost('work');
            continue;
        }

        break;
    }

    return assembleRushBody([WORK, work - 1], [CARRY, carry], [MOVE, move], [WORK, 1]);
};

/** worker（建造/维修兼升级）最低孵化预算：[W1,C1,M1] = 200 */
const WORKER_GROUP_COST = partCost('work') + partCost('carry') + partCost('move');
export const RUSH_WORKER_MIN_BUDGET = WORKER_GROUP_COST;

/**
 * worker 体型（参考实现 getBuilderBody 口径）：
 * 1W1C1M 起步 → 预算充足按 1:1:1 三件套整组扩展 →
 * 整组付不起时回退「WORK+MOVE」或「MOVE+CARRY」半组 →
 * 受 maxWork 与 MAX_CREEP_SIZE 约束。
 *
 * 排布沿用参考实现：WORK 组在前、收尾 WORK+MOVE。
 */
export const buildRushWorkerBody = (
    budget: number,
    options: { maxWork?: number } = {},
): RushBody | null => {
    const { maxWork } = options;
    if (budget < RUSH_WORKER_MIN_BUDGET) return null;

    const moveCost = partCost('move');
    const workCost = partCost('work');
    const carryCost = partCost('carry');
    const totalCost = moveCost + workCost + carryCost;
    const maxParts = MAX_CREEP_SIZE_V();

    let work = 1;
    let move = 1;
    let carry = 1;
    let energy = budget - totalCost;

    while (energy >= moveCost && work + move + carry + 2 <= maxParts) {
        if (maxWork && work >= maxWork) break;

        if (energy >= totalCost && work + move + carry + 3 <= maxParts) {
            work += 1;
            move += 1;
            carry += 1;
            energy -= totalCost;
            continue;
        }

        if (energy >= workCost + moveCost) {
            work += 1;
            move += 1;
            energy -= workCost + moveCost;
            continue;
        }

        if (energy >= moveCost + carryCost) {
            move += 1;
            carry += 1;
            energy -= moveCost + carryCost;
            continue;
        }

        break;
    }

    return assembleRushBody([WORK, work - 1], [CARRY, carry], [MOVE, move - 1], [WORK, 1], [MOVE, 1]);
};

/** 体型生成参数：按角色消费（harvester：maxWork/needCarry/speed；upgrader：maxWork/carryRatio；worker：maxWork） */
export type RushBodyOptions = {
    maxWork?: number;
    needCarry?: boolean;
    speed?: number;
    carryRatio?: number;
};

/** rush 各经济角色的容量现算体型统一入口（不在册角色返回 null 走原路径） */
export const buildRushBody = (role: string, budget: number, options: RushBodyOptions = {}): RushBody | null => {
    switch (role) {
        case ROLES.harvester:
            return buildRushHarvesterBody(budget, {
                maxWork: options.maxWork,
                needCarry: options.needCarry,
                speed: options.speed,
            });
        case ROLES.carrier: return buildRushCarrierBody(budget);
        case ROLES.upgrader:
            return buildRushUpgraderBody(budget, { maxWork: options.maxWork, carryRatio: options.carryRatio });
        case ROLES.worker: return buildRushWorkerBody(budget, { maxWork: options.maxWork });
        default: return null;
    }
};

export const getRushBodyCost = bodyCost;
export const getRushBodyWork = workCount;


/**
 * 冲级分段节奏评估：以 lv1 基线对照分段目标表，输出各段达成/预计/落后/判废状态；
 * 段超时判废该轮 attempt 并生成归因快照，供面板与落盘消费。
 */

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


/**
 * 冲级面板能量采样累加器：跨模块把「采集进账」汇入面板窗口采样。
 * 只做计数无逻辑——raceVisual 每个采样窗结算取走并归零。
 */
const minedAccum: Record<string, number> = {};

/** 记一笔源矿采集进账（harvest 成功后按 WORK×2 调用） */
export const raceEnergyMined = (roomName: string, amount: number): void => {
    minedAccum[roomName] = (minedAccum[roomName] || 0) + amount;
};

/** 取走自上次结算以来的进账累计（取走即归零） */
export const takeRaceEnergyMined = (roomName: string): number => {
    const v = minedAccum[roomName] || 0;
    delete minedAccum[roomName];
    return v;
};

