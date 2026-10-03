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

export const buildRushHarvesterBody = (budget: number): RushBody | null => {
    if (budget < RUSH_HARVESTER_MIN_BUDGET) return null;
    const cap = maxHarvestWork();
    const work = Math.max(1, Math.min(cap, Math.floor((budget - partCost('move')) / partCost('work'))));
    return [[WORK, work], [MOVE, 1]];
};

/** carrier 路面组大小：[C,C,M] = 150 */
const CARRIER_GROUP_COST = partCost('carry') * 2 + partCost('move');
/** carrier 最低孵化预算：单组 [C,C,M] = 150 */
export const RUSH_CARRIER_MIN_BUDGET = CARRIER_GROUP_COST;
/** carrier 组数上限（防极端高容量折出超编） */
const CARRIER_MAX_GROUPS = 12;

export const buildRushCarrierBody = (budget: number): RushBody | null => {
    if (budget < RUSH_CARRIER_MIN_BUDGET) return null;
    const groups = Math.min(CARRIER_MAX_GROUPS, Math.floor(budget / CARRIER_GROUP_COST));
    return [[CARRY, groups * 2], [MOVE, groups]];
};

/**
 * upgrader 体型（rush）：
 * 1 档 CARRY 随预算上浮到 4；WORK 按余量堆；
 * 预算不足时下探到 [W1,C1,M1]（200）；再低返回 null。
 */
export const RUSH_UPGRADER_MIN_BUDGET = partCost('work') + partCost('carry') + partCost('move');

export const buildRushUpgraderBody = (budget: number): RushBody | null => {
    if (budget < RUSH_UPGRADER_MIN_BUDGET) return null;
    const carryN = Math.min(4, Math.max(1, Math.floor(budget / 300)));
    const work = Math.max(1, Math.floor((budget - partCost('move') - partCost('carry') * carryN) / partCost('work')));
    if (budget - bodyCost([[WORK, work], [CARRY, carryN], [MOVE, 1]]) >= 0) {
        return [[WORK, work], [CARRY, carryN], [MOVE, 1]];
    }
    return [[WORK, 1], [CARRY, 1], [MOVE, 1]];
};

/** worker 路面组：[W,C,M] = 200 */
const WORKER_GROUP_COST = partCost('work') + partCost('carry') + partCost('move');
/** worker 最低孵化预算 */
export const RUSH_WORKER_MIN_BUDGET = WORKER_GROUP_COST;
/** worker WORK 上限（建造/维修够用，建造主力地位让给搬运供给节奏） */
const WORKER_MAX_WORK = 6;

export const buildRushWorkerBody = (budget: number): RushBody | null => {
    if (budget < RUSH_WORKER_MIN_BUDGET) return null;
    const work = Math.max(1, Math.min(WORKER_MAX_WORK, Math.floor(budget / WORKER_GROUP_COST)));
    return [[WORK, work], [CARRY, work], [MOVE, work]];
};

/** rush 各经济角色的容量现算体型统一入口（不在册角色返回 null 走原路径） */
export const buildRushBody = (role: string, budget: number): RushBody | null => {
    switch (role) {
        case 'harvester': return buildRushHarvesterBody(budget);
        case 'carrier': return buildRushCarrierBody(budget);
        case 'upgrader': return buildRushUpgraderBody(budget);
        case 'worker': return buildRushWorkerBody(budget);
        default: return null;
    }
};

export const getRushBodyCost = bodyCost;
export const getRushBodyWork = workCount;
