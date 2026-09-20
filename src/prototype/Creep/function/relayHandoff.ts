/**
 * 外矿搬运接力（记忆交换式）。
 *
 * 两个相向而行的 out-carry 相邻时：
 * 1. 满载方把 cargo 整体转给空载方；
 * 2. 交换双方在 Memory.creeps 中的 memory 对象——模式缓存、路线状态随 memory 互换，
 *    双方零重算地接管对方剩余的路程（满载方原地转为返程，空载方原地转为外出）。
 *
 * 核心规则只有一条：「同路线 + 相邻 + 载荷互补 + 同容量 + TTL 达标 + 本 tick 未接力」。
 * 同 tick 标记防止 A→B→C 链式接力与 A↔B 振荡。
 */

const RELAY_MIN_TTL = 50;
const RELAY_MARK = 'relayedTick';

const hasCargo = (creep: Creep): boolean => creep.store.getUsedCapacity() > 0;

const isRelayableHauler = (creep: Creep): boolean =>
    !creep.spawning &&
    !creep.memory.retreat &&
    (creep.ticksToLive || 0) > RELAY_MIN_TTL;

const hasRelayedThisTick = (creep: Creep): boolean => {
    const mem = Memory.creeps[creep.name] as any;
    return mem?.[RELAY_MARK] === Game.time;
};

const markRelayed = (creep: Creep): void => {
    const mem = Memory.creeps[creep.name] as any;
    if (mem) mem[RELAY_MARK] = Game.time;
};

/**
 * 尝试与相邻的同路线搬运 creep 完成一次接力：
 * 满载方整体转移 cargo 给空载方，然后交换双方 memory，
 * 双方各自接管对方剩余的路程。
 *
 * @returns `true` 表示接力已完成（本 tick 的移动/采集意图已被接力取代）。
 */
export const tryOutCarryRelayHandoff = (creep: Creep): boolean => {
    if (hasRelayedThisTick(creep)) return false;
    if (creep.spawning || creep.pos.isRoomEdge()) return false;

    const mem = Memory.creeps[creep.name] as any;
    const sourceRoom = creep.memory.sourceRoom;
    const targetRoom = creep.memory.targetRoom;
    if (!mem || !sourceRoom || !targetRoom) return false;

    const capacity = creep.store.getCapacity();
    if (capacity <= 0) return false;

    // 相邻的同路线搬运者：同角色、同路线、同容量、TTL 达标、本 tick 未接力、不在房间边缘
    const partners = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (other: Creep) =>
            other.id !== creep.id &&
            other.memory.role === creep.memory.role &&
            other.memory.sourceRoom === sourceRoom &&
            other.memory.targetRoom === targetRoom &&
            !other.spawning &&
            !other.pos.isRoomEdge() &&
            other.store.getCapacity() === capacity &&
            (other.ticksToLive || 0) > RELAY_MIN_TTL &&
            !hasRelayedThisTick(other),
    }) as Creep[];
    if (partners.length === 0) return false;

    // 载荷互补：我有货对方空仓（我交付），或我空仓对方有货（我接货）
    const partner = hasCargo(creep)
        ? partners.find((other) => other.store.getUsedCapacity() === 0)
        : partners.find((other) => hasCargo(other));
    if (!partner) return false;

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
    markRelayed(creep);
    markRelayed(partner);
    return true;
};
