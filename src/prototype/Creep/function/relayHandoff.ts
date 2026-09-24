/**
 * 外矿搬运接力（记忆交换式）。判定与执行整体照搬参考实现 ../参考实现 的 交接判定
 * （`参考实现集中物流`），**不自己发明几何条件**。核心只有三条：
 *
 * 1. **正面对穿**：我和相邻的同路线搬运工，互为对方本 tick 的移动意图目标格
 *    （BetterMove 的 `isSwapIntent`）。这是「谁挡着谁」的直接判据——引擎不允许两只 creep
 *    同 tick 交换位置，所以这种队形到 tick 末两边都走不动，接力就是把这个死结解开。
 *    并排同行、同向超越、反向相遇都天然不成立，**不需要另外写几何去排除**。
 * 2. **航向相反**：往母房走（deliver）的一方是供给方，往矿里走（collect）的一方是接收方。
 *    航向取自 out-carry 自己解析出来的模式，两者相同就不接。
 * 3. 货能一次装进接收方（整仓交空或一次填满，见下面「只接受两种结局」）。
 *
 * 命中后：供给方把货交给接收方；整仓交空时双方交换 `Memory.creeps` 对象，
 * 模式缓存、路线状态随之互换，双方零重算地接管对方剩余的路程；
 * 同时把方向锁写进双方 memory，让这一方当 tick 就按新身份上路。
 *
 * 「1 tick 前进两格」是怎么来的：
 * 交接当 tick，货物先从供给方落到接收方（沿路线向母房推进 1 格），
 * 双方方向随之互换、各自再走 1 格，于是这趟货一 tick 内推进两格；
 * 若只是照旧方向对穿过去，货物一 tick 只推进 1 格。
 *
 * ── 两处与 参考实现 的差异，都是本项目自己的约束造成的 ──
 *
 * **① 方向锁（relayDir）**：参考实现 的方向来自 `memory.supplying`，那个标记会随记忆交换易主，
 * 所以接收方换完记忆就自动知道自己该返程。本项目的 out-carry 反过来是「按载荷 + 半仓滞回」
 * 推导方向的（见 resolveOutCarryMode），而引擎的动作要到 tick 末才落账、tick 中间读到的
 * `creep.store` 还是交接前的快照——「谁接了货」从载荷上读不出来。
 * 所以这里把方向显式写进双方 memory，只对该 tick 有效，下 tick 载荷已是真值就交回常规判定。
 *
 * **② 半仓线**：同样是「方向按载荷推导」的后果。参考实现 那边接收方只要拿到货就一直是
 * supplying，而这里接收方下 tick 会重新按载荷判方向——若拿到不足半仓，会被滞回规则判回
 * 「还在外出」，把刚接到的能量原路背回外矿。所以整仓交空时要求接收方到手后必须够半仓。
 * 两种交接量同理：整仓交空（供给方空仓 → 确定外出）、或一次填满接收方（满载 → 确定返程）。
 *
 * 其余部分不做额外刹车：接头判据本身就只在「真被挡住」时成立，交接完双方背向离开，
 * 不可能原地反复。
 *
 * 配合 out-carry 的「接力后续跑」（relayedSelfTick 标记）：发起方在接力当 tick
 * 用交换后的新身份再决策一轮，转移与移动同 tick 完成，货物单 tick 前进两格。
 */

const RELAY_MIN_TTL = 50;
/**
 * 同对冷却窗口：同一对 creep 在这么多 tick 内不再互接。
 *
 * @remarks
 * 这是**在 参考实现 判据之上加的一道 CPU 刹车**，不是判据的一部分——
 * 判据（对穿 + 航向相反）在拥堵走廊里会连续命中同一对：两只 creep 换完方向被前后车队顶住，
 * 过两 tick 又被推成对穿，于是同一格反复对倒。吞吐不受影响（走廊本来就堵着），
 * 但每次接力都要交换记忆、作废并重登记双方移动意图，纯烧 CPU。
 * 冷却只锁「同一对」，新伙伴不受影响，所以解死结的能力不会掉。
 *
 * 记录必须放堆（`global`）而不是 Memory：完全交接会整体交换双方的 `Memory.creeps`，
 * 写在 memory 里的记录会随交换易主、换手一次就被抹掉（实测冷却会完全失效）。
 */
const RELAY_PAIR_COOLDOWN_TICKS = 6;
const RELAY_MARK = 'relayedTick';
const RELAY_SELF_MARK = 'relayedSelfTick';
const RELAY_DIR_MARK = 'relayDir';
const RELAY_DIR_TICK_MARK = 'relayDirTick';

/**
 * 半仓线。out-carry 的 collect / deliver 滞回与接力的交接判定共用同一条线：
 * 交接后落在返程侧的那一方必须够半仓，否则会被滞回规则判成外出，把刚接到的能量背回外矿。
 */
export const OUT_CARRY_HALF_LOAD_RATIO = 0.5;

const hasCargo = (creep: Creep): boolean => creep.store.getUsedCapacity() > 0;

const isRelayableHauler = (creep: Creep): boolean =>
    !creep.spawning &&
    !creep.memory.retreat &&
    (creep.ticksToLive || 0) > RELAY_MIN_TTL;

const getCreepMem = (creep: Creep): Record<string, any> | undefined =>
    Memory.creeps[creep.name] as Record<string, any> | undefined;

const hasRelayedThisTick = (creep: Creep): boolean =>
    getCreepMem(creep)?.[RELAY_MARK] === Game.time;

/**
 * 本 tick 是否已经登记过移动意图。
 *
 * @remarks
 * 接头判据要求双方都有意图，所以在「伙伴还没跑」时它必然为假——
 * 这天然决定了接力的发起方一定是这一对里**后跑**的那一个，不需要额外约束。
 */
const hasMoveIntent = (creep: Creep): boolean => {
    const betterMove = (global as any).BetterMove;
    return !!betterMove && typeof betterMove.hasMoveIntent === 'function' && betterMove.hasMoveIntent(creep);
};

/**
 * 双方是否正面对穿（互为对方本 tick 的移动意图目标格）。
 *
 * @remarks
 * 判据放在 BetterMove 里（它才知道每只 creep 本 tick 打算踏进哪一格）。
 * BetterMove 未加载时返回 false——宁可不错，也不要在没有意图信息时瞎判。
 */
const isSwapIntent = (a: Creep, b: Creep): boolean => {
    const betterMove = (global as any).BetterMove;
    return !!betterMove && typeof betterMove.isSwapIntent === 'function' && betterMove.isSwapIntent(a, b);
};

/**
 * creep 当前航向：`deliver` = 往母房走，`collect` = 往矿里走。
 *
 * @remarks
 * 取 out-carry 每 tick 解析并写进 `memory.cache.outCarryMode` 的模式。
 * 记忆交换式接力会让这个字段随记忆易主，所以交接后双方读到的就是**接管过来的那条路线**的航向。
 */
const getHeading = (creep: Creep): 'collect' | 'deliver' | undefined => {
    const cache = getCreepMem(creep)?.cache as Record<string, any> | undefined;
    const mode = cache?.outCarryMode;
    return mode === 'collect' || mode === 'deliver' ? mode : undefined;
};

const markRelayed = (creep: Creep): void => {
    const mem = getCreepMem(creep);
    if (mem) mem[RELAY_MARK] = Game.time;
};

const PAIR_COOLDOWN_KEY = '__relayPairCooldown';
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const getPairCooldown = (): Record<string, number> => ((global as any)[PAIR_COOLDOWN_KEY] ??= {});

const isPairCoolingDown = (a: string, b: string): boolean => {
    const at = getPairCooldown()[pairKey(a, b)];
    return typeof at === 'number' && Game.time - at < RELAY_PAIR_COOLDOWN_TICKS;
};

const markPairRelayed = (a: string, b: string): void => {
    const cooldown = getPairCooldown();
    for (const key of Object.keys(cooldown)) {
        if (Game.time - cooldown[key] >= RELAY_PAIR_COOLDOWN_TICKS) delete cooldown[key];
    }
    cooldown[pairKey(a, b)] = Game.time;
};

// 发起方标记：out-carry 据此在同 tick 用新身份补一轮决策（接力后续跑）
const markRelayInitiator = (creep: Creep): void => {
    const mem = getCreepMem(creep);
    if (mem) mem[RELAY_SELF_MARK] = Game.time;
};

/**
 * 交接当 tick 的方向锁（只对写入的那个 tick 有效）。
 *
 * @remarks
 * Screeps 的动作要到 tick 末才落账：中间阶段读到的位置、存量都是 tick 开始时的快照
 * （见官方「理解游戏循环」：main 处理的是 tick 开始时的不可变状态，改变状态的指令在结束阶段才生效）。
 * 因此交接当 tick 双方从 `creep.store` 读到的仍是**交接前**的载荷——
 * 「接了货的那方会往母房走」这件事推导不出来，必须由交接直接把方向写进 memory。
 * 记忆本身不受这个限制（本 tick 写入本 tick 可读），所以记忆交换式接力天然能承载方向。
 * 下个 tick 载荷已是真实值，方向锁自动失效，交回 out-carry 的常规判定。
 *
 * @param creep 目标 creep（调用时机必须在记忆交换之后，记录才会落到正确的宿主身上）。
 * @param dir 本 tick 锁定的方向。
 */
export const setRelayDirection = (creep: Creep, dir: 'collect' | 'deliver'): void => {
    const mem = getCreepMem(creep);
    if (!mem) return;
    mem[RELAY_DIR_MARK] = dir;
    mem[RELAY_DIR_TICK_MARK] = Game.time;
};

/**
 * 读取本 tick 的接力方向锁。
 *
 * @returns 仅当方向锁是**本 tick** 写入时返回该方向，否则返回 `undefined`（交回常规判定）。
 */
export const readRelayDirection = (creep: Creep): 'collect' | 'deliver' | undefined => {
    const mem = getCreepMem(creep);
    if (!mem || mem[RELAY_DIR_TICK_MARK] !== Game.time) return undefined;
    const dir = mem[RELAY_DIR_MARK];
    return dir === 'collect' || dir === 'deliver' ? dir : undefined;
};

// 清掉 creep 本 tick 已登记的移动意图（兼容 BetterMove 延迟结算）。
// BetterMove 未加载或为旧版本（无此 API）时静默跳过。
const cancelPendingMoveIntent = (creep: Creep): void => {
    const betterMove = (global as any).BetterMove;
    if (betterMove && typeof betterMove.cancelMoveIntent === 'function') {
        betterMove.cancelMoveIntent(creep);
    }
};

type RelayPlan = {
    partner: Creep;
    supplier: Creep;
    fetcher: Creep;
    resourceType: ResourceConstant;
    amount: number;
    fullHandoff: boolean;
};

/**
 * 为「正面对穿」的一对同路线搬运工定分工与交接量。
 *
 * @remarks
 * 分工只看**航向**：往母房走（deliver）的一方是供给方，往矿里走（collect）的一方是接收方。
 * 不看几何、也不看谁身上有货——
 * 几何（按两房间连线算谁在外矿侧）在路线不是直线时会判反，把货交给正在往矿里走的那一方，
 * 那才是真正的「错误传递」；按载荷定角色则会在两人都带货时判反。
 * 航向相同直接不接（同向没有交接的意义，并排同行的情形也一并被排除）。
 *
 * @returns 可执行的交接计划；`null` 表示这一对不该接、或条件不成立。
 */
const planRelay = (creep: Creep, partner: Creep): RelayPlan | null => {
    // ① 正面对穿：互为对方本 tick 的移动意图目标格（引擎不允许交换位置，两边都走不动）
    if (!isSwapIntent(creep, partner)) return null;

    // ② 航向相反：谁在返程谁是供给方
    const creepHeading = getHeading(creep);
    const partnerHeading = getHeading(partner);
    if (!creepHeading || !partnerHeading || creepHeading === partnerHeading) return null;
    const supplier = creepHeading === 'deliver' ? creep : partner;
    const fetcher = supplier === creep ? partner : creep;

    if (!hasCargo(supplier)) return null;
    if (fetcher.store.getFreeCapacity() <= 0) return null;

    const resourceType = Object.keys(supplier.store).find(
        (resource) => (supplier.store as any)[resource] > 0
    ) as ResourceConstant | undefined;
    if (!resourceType) return null;

    const capacity = supplier.store.getCapacity();
    if (capacity <= 0 || fetcher.store.getCapacity() !== capacity) return null;

    const supplierUsed = supplier.store.getUsedCapacity(resourceType);
    const amount = Math.min(supplierUsed, fetcher.store.getFreeCapacity());
    if (amount <= 0) return null;

    // 交接量由「谁被端到边界」决定，两种结局都让接收方落在确定的返程侧：
    // - 整仓交空：接收方接管全部货物——但它必须够半仓，否则会被滞回规则判成外出，
    //   把刚接到的能量原路背回外矿（这是接力最典型的传递错误，直接不做）；
    // - 填满接收方：接收方满载，滞回规则必然判成返程，无需求助半仓线；
    //   供给方剩下的余量无论多少都无害——不够半仓时它掉头回外矿补货，正是它该做的事。
    const halfLoad = Math.ceil(capacity * OUT_CARRY_HALF_LOAD_RATIO);
    const fullHandoff = amount >= supplierUsed;
    if (fullHandoff) {
        const fetcherAfter = fetcher.store.getUsedCapacity(resourceType) + amount;
        if (fetcherAfter < halfLoad) return null;
    }

    return { partner, supplier, fetcher, resourceType, amount, fullHandoff };
};

/**
 * 执行一次已定案的交接：转移货物、（整仓交空时）互换记忆、标记、作废旧方向意图。
 *
 * @param creep 发起方（当前正在跑的这一方）。
 * @param plan 由 {@link planRelay} 定案的分工与交接量。
 * @param mem 发起方在记忆交换前的 memory 对象。
 */
const executeRelay = (creep: Creep, plan: RelayPlan, mem: Record<string, any>): boolean => {
    const { partner, supplier, fetcher, resourceType, amount, fullHandoff } = plan;

    if (supplier.transfer(fetcher, resourceType, amount) !== OK) return false;

    if (fullHandoff) {
        // 完全交接：记忆交换，双方零重算接管对方的路程
        const memPartner = Memory.creeps[partner.name];
        Memory.creeps[creep.name] = memPartner;
        Memory.creeps[partner.name] = mem;
    }

    // 标记必须在交换之后写：这两个记录要落在交换后各自身上的 memory 里。
    markRelayed(creep);
    markRelayed(partner);
    markPairRelayed(creep.name, partner.name);
    markRelayInitiator(creep);

    // 方向随交接一起易主。
    // 交接当 tick 的动作要到 tick 末才落账，双方从 store 读到的还是交接前的旧载荷，
    // 「谁接了货谁返程」推导不出来——所以方向必须写进 memory 才能当 tick 掉头。
    // 记忆已经交换过，因此这两笔记录各自落到交换后的新主人身上。
    if (fullHandoff) {
        setRelayDirection(fetcher, 'deliver');   // 接管整批货物 → 返程
        setRelayDirection(supplier, 'collect');  // 交出全部货物 → 外出
    } else {
        setRelayDirection(fetcher, 'deliver');   // 被一次填满 → 返程（供给方方向不变）
    }

    // 方向反转：旧的移动意图全部作废。
    // 发起方由本 tick 的「接力后续跑」重登记；
    // 伙伴这里必须立即代为重登记——接头的判据就是「双方本 tick 都登记过意图」，
    // 所以走到这里伙伴一定已经跑过、也已经登记过按旧方向移动的意图，
    // 不作废并重登记的话，它会在 tick 末照旧方向走，双方对穿后位置关系颠倒。
    cancelPendingMoveIntent(creep);
    cancelPendingMoveIntent(partner);
    const reissue = (global as any).__outCarryReissue;
    if (reissue) reissue(partner);

    return true;
};

/**
 * 尝试与「正面对穿」的同路线搬运 creep 完成一次接力：
 * 供给方把本趟货交给接收方，整仓交空时交换双方 memory，
 * 双方各自接管对方剩余的路程。
 *
 * @remarks
 * 判据（对穿 + 航向相反）要求双方本 tick 都已登记移动意图，
 * 所以发起方一定是这一对里**后跑**的那一个，伙伴一定已经跑过。
 *
 * @returns `true` 表示接力已完成（双方的旧方向移动意图都已被接力取代）。
 */
export const tryOutCarryRelayHandoff = (creep: Creep): boolean => {
    if (hasRelayedThisTick(creep)) return false;
    if (!isRelayableHauler(creep)) return false;
    if (creep.pos.isRoomEdge()) return false;
    // 接头判据要读双方的移动意图，自己没登记过就无从谈起
    if (!hasMoveIntent(creep)) return false;

    const mem = getCreepMem(creep);
    const sourceRoom = creep.memory.sourceRoom;
    const targetRoom = creep.memory.targetRoom;
    if (!mem || !sourceRoom || !targetRoom) return false;

    const capacity = creep.store.getCapacity();
    if (capacity <= 0) return false;

    // 相邻的同角色搬运者：同路线、同容量、TTL 达标、本 tick 未接力、不在房间边缘
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
            !isPairCoolingDown(other.name, creep.name),
    }) as Creep[];
    if (partners.length === 0) return false;

    // 逐个候选试配：第一个候选未必是真正的接头对象（可能不是对穿、或航向相同、或已经装满），
    // 抓住第一个就定案会把后面那个合法候选一起丢掉。
    for (const partner of partners) {
        if (isPairCoolingDown(creep.name, partner.name)) continue;
        const plan = planRelay(creep, partner);
        if (plan) return executeRelay(creep, plan, mem);
    }

    return false;
};
