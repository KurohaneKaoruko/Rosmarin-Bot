/**
 * 外矿搬运接力（记忆交换式）。
 *
 * 两个相向而行的 out-carry 相邻时：
 * 1. 满载方把 cargo 整体转给空载方；
 * 2. 交换双方在 Memory.creeps 中的 memory 对象——模式缓存、路线状态随 memory 互换，
 *    双方零重算地接管对方剩余的路程（满载方原地转为返程，空载方原地转为外出）。
 *
 * 核心规则：「同路线 + 相邻 + 载荷互补 + 同容量 + TTL 达标 + 冷却结束」。
 *
 * 防振荡 / 保吞吐的三层设计：
 * 1. 同 tick 标记（relayedTick）：一个 creep 每 tick 至多参与一次接力。
 *    阻断同 tick 连环传递——贴脸队形只允许传一次，
 *    其余人靠同 tick 的移动分开，而不是原地逐手倒货。
 * 2. 同对冷却（relayedPartner + relayedTick）：同一对 creep 在冷却窗口内不再互接，
 *    阻断跨 tick 振荡；但不影响与其他新伙伴的连续接力。
 * 3. 意图作废：接力后清掉双方本 tick 已登记的旧方向移动意图。
 *    BetterMove 的移动是延迟结算（endTickResolve），不清掉旧意图的话，
 *    接力双方会按旧方向在 tick 末互相穿行，位置关系颠倒后再次触发接力形成死锁。
 *
 * 配合 out-carry 的「接力后续跑」（relayedSelfTick 标记）：发起方在接力当 tick
 * 用交换后的新身份再决策一轮，转移与移动同 tick 完成，货物单 tick 前进两格。
 */

const RELAY_MIN_TTL = 50;
// 同对冷却：同一对 creep 接力后 N tick 内不再互相接力（防振荡），不限制新伙伴
const RELAY_PAIR_COOLDOWN_TICKS = 3;
const RELAY_MARK = 'relayedTick';
const RELAY_PARTNER_MARK = 'relayedPartner';
const RELAY_SELF_MARK = 'relayedSelfTick';

const hasCargo = (creep: Creep): boolean => creep.store.getUsedCapacity() > 0;

const isRelayableHauler = (creep: Creep): boolean =>
    !creep.spawning &&
    !creep.memory.retreat &&
    (creep.ticksToLive || 0) > RELAY_MIN_TTL;

const getCreepMem = (creep: Creep): Record<string, any> | undefined =>
    Memory.creeps[creep.name] as Record<string, any> | undefined;

const hasRelayedThisTick = (creep: Creep): boolean =>
    getCreepMem(creep)?.[RELAY_MARK] === Game.time;

// 最近一次接力对象就是 candidate 且仍在冷却窗口内
const isPairCoolingDown = (creep: Creep, candidateName: string): boolean => {
    const mem = getCreepMem(creep);
    return !!mem &&
        mem[RELAY_PARTNER_MARK] === candidateName &&
        typeof mem[RELAY_MARK] === 'number' &&
        Game.time - mem[RELAY_MARK] < RELAY_PAIR_COOLDOWN_TICKS;
};

const markRelayed = (creep: Creep, partnerName: string): void => {
    const mem = getCreepMem(creep);
    if (!mem) return;
    mem[RELAY_MARK] = Game.time;
    mem[RELAY_PARTNER_MARK] = partnerName;
};

// 发起方标记：out-carry 据此在同 tick 用新身份补一轮决策（接力后续跑）
const markRelayInitiator = (creep: Creep): void => {
    const mem = getCreepMem(creep);
    if (mem) mem[RELAY_SELF_MARK] = Game.time;
};

// 清掉 creep 本 tick 已登记的移动意图（兼容 BetterMove 延迟结算）。
// BetterMove 未加载或为旧版本（无此 API）时静默跳过。
const cancelPendingMoveIntent = (creep: Creep): void => {
    const betterMove = (global as any).BetterMove;
    if (betterMove && typeof betterMove.cancelMoveIntent === 'function') {
        betterMove.cancelMoveIntent(creep);
    }
};

/**
 * 尝试与相邻的同路线搬运 creep 完成一次接力：
 * 满载方整体转移 cargo 给空载方，然后交换双方 memory，
 * 双方各自接管对方剩余的路程。
 *
 * @returns `true` 表示接力已完成（发起方的移动/采集意图已被接力取代，
 *          其 run 流程会按 relayedSelfTick 用新身份补一轮决策；
 *          双方此前登记的移动意图也已被取消）。
 */
export const tryOutCarryRelayHandoff = (creep: Creep): boolean => {
    if (hasRelayedThisTick(creep)) return false;
    if (!isRelayableHauler(creep)) return false;
    if (creep.pos.isRoomEdge()) return false;

    const mem = Memory.creeps[creep.name] as any;
    const sourceRoom = creep.memory.sourceRoom;
    const targetRoom = creep.memory.targetRoom;
    if (!mem || !sourceRoom || !targetRoom) return false;

    const capacity = creep.store.getCapacity();
    if (capacity <= 0) return false;

    // 相邻的同路线搬运者：同角色、同路线、同容量、TTL 达标、
    // 本 tick 未接力、未与我处于同对冷却、不在房间边缘
    const partners = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (other: Creep) =>
            other.id !== creep.id &&
            other.memory.role === creep.memory.role &&
            other.memory.sourceRoom === sourceRoom &&
            other.memory.targetRoom === targetRoom &&
            isRelayableHauler(other) &&
            !other.pos.isRoomEdge() &&
            other.store.getCapacity() === capacity &&
            !hasRelayedThisTick(other) &&
            !isPairCoolingDown(other, creep.name),
    }) as Creep[];
    if (partners.length === 0) return false;

    // 载荷互补：我有货对方空仓（我交付），或我空仓对方有货（我接货）
    const partner = hasCargo(creep)
        ? partners.find((other) => other.store.getUsedCapacity() === 0)
        : partners.find((other) => hasCargo(other));
    if (!partner) return false;

    // 同对冷却：刚和这位接力过，先各自分开走，冷却结束前不再互接
    if (isPairCoolingDown(creep, partner.name)) return false;

    const supplier = hasCargo(creep) ? creep : partner;
    const fetcher = supplier === creep ? partner : creep;

    const resourceType = Object.keys(supplier.store).find(
        (resource) => (supplier.store as any)[resource] > 0
    ) as ResourceConstant | undefined;
    if (!resourceType) return false;

    if (supplier.transfer(fetcher, resourceType) !== OK) return false;

    // 记忆交换：双方零重算接管对方的路程
    const memPartner = Memory.creeps[partner.name];
    Memory.creeps[creep.name] = memPartner;
    Memory.creeps[partner.name] = mem;
    markRelayed(creep, partner.name);
    markRelayed(partner, creep.name);
    markRelayInitiator(creep);

    // 接力已取代双方此前登记的旧方向移动意图，
    // 防止 tick 末 BetterMove 结算时按旧意图互相穿行（接力振荡的根源）。
    cancelPendingMoveIntent(creep);
    cancelPendingMoveIntent(partner);
    return true;
};
