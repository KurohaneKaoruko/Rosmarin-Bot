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

// 房间名 → 连续世界坐标（W0 位于 W1 与 E0 之间，与地理一致）
const parseRoomAxis = (roomName: string): { x: number; y: number } | null => {
    const m = /^([WE])(\d+)([NS])(\d+)$/.exec(roomName);
    if (!m) return null;
    const x = m[1] === 'W' ? -1 - Number(m[2]) : Number(m[2]);
    const y = m[3] === 'N' ? Number(m[4]) : -1 - Number(m[4]);
    return { x, y };
};

const axisCache: Record<string, { dx: number; dy: number }> = {};

// 路线正方向轴（母房 → 外矿）
const getRouteAxis = (sourceRoom: string, targetRoom: string): { dx: number; dy: number } => {
    const key = sourceRoom + '>' + targetRoom;
    let axis = axisCache[key];
    if (!axis) {
        const a = parseRoomAxis(sourceRoom);
        const b = parseRoomAxis(targetRoom);
        axis = a && b ? { dx: b.x - a.x, dy: b.y - a.y } : { dx: 0, dy: 0 };
        axisCache[key] = axis;
    }
    return axis;
};

const worldPosOf = (creep: Creep): { x: number; y: number } | null => {
    const axis = parseRoomAxis(creep.pos.roomName);
    if (!axis) return null;
    return { x: axis.x * 50 + creep.pos.x, y: axis.y * 50 + creep.pos.y };
};

// 方向闸门：供给方必须位于接收方的「外矿侧」。
// 满足时交换后货物向母房推进；不满足（交叉/反向相遇）时交换会让货物倒退，直接拒绝，
// 双方自然错开继续各自的路线。
const isForwardPair = (sourceRoom: string, targetRoom: string, supplier: Creep, fetcher: Creep): boolean => {
    const axis = getRouteAxis(sourceRoom, targetRoom);
    if (!axis || (axis.dx === 0 && axis.dy === 0)) return true;
    const s = worldPosOf(supplier);
    const f = worldPosOf(fetcher);
    if (!s || !f) return true;
    return (s.x - f.x) * axis.dx + (s.y - f.y) * axis.dy >= 0;
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

    // 配对：我有货 → 找仍有容纳空间的伙伴（全部倒入）；我空/半载 → 找有货的伙伴（尽量接满）。
    // 不要求接收方完全空仓——部分载货的相遇同样接力，否则车流会互相穿行浪费运力。
    const myUsed = creep.store.getUsedCapacity();
    let supplier: Creep | undefined;
    let fetcher: Creep | undefined;
    if (myUsed > 0) {
        supplier = creep;
        fetcher = partners.find((other) => other.store.getFreeCapacity() > 0);
    } else {
        fetcher = creep;
        supplier = partners.find((other) => hasCargo(other));
    }
    if (!supplier || !fetcher) return false;

    const partner = supplier === creep ? fetcher : supplier;

    // 同对冷却：刚和这位接力过，先各自分开走，冷却结束前不再互接（双向核查）
    if (isPairCoolingDown(creep, partner.name)) return false;
    if (isPairCoolingDown(partner, creep.name)) return false;

    // 方向闸门：供给方必须在接收方的「外矿侧」，货物交接只会向母房推进；
    // 反向（交叉后）相遇不接力，双方自然错开，杜绝能量倒退与反复对穿。
    if (!isForwardPair(sourceRoom, targetRoom, supplier, fetcher)) return false;

    const resourceType = Object.keys(supplier.store).find(
        (resource) => (supplier.store as any)[resource] > 0
    ) as ResourceConstant | undefined;
    if (!resourceType) return false;

    // 转移量 = 双方容量取短板；接收方装满后供应商仍有剩余 → 半载补给，
    // 此时双方方向不变，不换 memory、不作废移动意图。
    const amount = Math.min(supplier.store.getUsedCapacity(resourceType), fetcher.store.getFreeCapacity());
    if (amount <= 0) return false;
    const fullHandoff = amount >= supplier.store.getUsedCapacity(resourceType);

    if (supplier.transfer(fetcher, resourceType, amount) !== OK) return false;

    if (fullHandoff) {
        // 完全交接：记忆交换，双方零重算接管对方的路程
        const memPartner = Memory.creeps[partner.name];
        Memory.creeps[creep.name] = memPartner;
        Memory.creeps[partner.name] = mem;
    }

    // 标记必须在交换之后写：relayedPartner 要落在交换后各自身上的 memory 里，
    // 同对冷却才能在下一周期正确配对阻断。
    markRelayed(creep, partner.name);
    markRelayed(partner, creep.name);
    markRelayInitiator(creep);

    if (fullHandoff) {
        // 方向反转：旧的移动意图全部作废。
        // 发起方由本 tick 的「接力后续跑」重登记；
        // 伙伴若已跑过本轮（lastRunTick == Game.time），此处立即代为重登记——
        // 不重登记的话旧方向意图会在 tick 末执行，双方对穿后位置颠倒。
        cancelPendingMoveIntent(creep);
        cancelPendingMoveIntent(partner);
        const betterMove = (global as any).BetterMove;
        const reissue = (global as any).__outCarryReissue;
        if ((partner.memory as any).lastRunTick === Game.time && reissue) {
            reissue(partner);
        }
    }
    return true;
};
