import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';

/**
 * 战斗搭档的绑定与跟随。
 *
 * @remarks
 * 成对的战斗角色（攻击手 + 治疗手、一体机的两个分身、双人队的攻/防手）需要互相认出对方。
 * 这套「认搭档」的逻辑原本被逐字抄进了 4 个角色文件里，改一处要改 4 处，
 * 而且各副本已经开始漂移（有的加了 `onMissing` 回调、有的没加）。
 * 统一收到这里：**「同伴绑定」从此只有一处语义**。
 *
 * 绑定记录是双向的（双方 `memory.bind` 互指），因此任何一方死亡都能被另一方察觉并解绑。
 */

/**
 * 取本 creep 已绑定的搭档。
 *
 * @param onMissing 搭档 id 已失效（对方死亡/被回收）时的回调，用于让角色做善后（如自杀、重新结伴）。
 * @returns 搭档；未绑定或已失效时返回 `null`（失效时会顺手清掉 `memory.bind`）。
 */
export const resolveBoundPartner = (creep: Creep, onMissing?: () => void): Creep | null => {
    if (!creep.memory.bind) return null;

    const partner = Game.getObjectById(creep.memory.bind as Id<Creep>);
    if (partner) return partner;

    delete creep.memory.bind;
    onMissing?.();
    return null;
};

/**
 * 取搭档，没有就现找一个最近的、同样没结伴的候选，并双向写绑定。
 *
 * @param cacheKey 房间 tick 缓存键；同一房间同一角色每 tick 只枚举一次 creep 列表。
 * @param filter 候选过滤（通常是「角色名 == 我的搭档角色」）。
 * @returns 搭档；房间内无可用候选时返回 `null`。
 *
 * @remarks
 * `filter` 只描述「谁有资格当我的搭档」，候选必须再满足「当前没被别人绑走」，
 * 否则两队会争同一个人。
 */
export const tryBindNearestPartner = (
    creep: Creep,
    cacheKey: string,
    filter: (candidate: Creep) => boolean
): Creep | null => {
    const boundPartner = resolveBoundPartner(creep);
    if (boundPartner) return boundPartner;

    const candidates = getRoomTickCacheValue(creep.room, cacheKey, () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (candidate) => candidate.id !== creep.id && filter(candidate as Creep),
        }) as Creep[]
    );
    const available = candidates.filter((candidate) => !candidate.memory.bind);
    if (available.length <= 0) return null;

    const partner = creep.pos.findClosestByRange(available);
    if (!partner) return null;

    creep.memory.bind = partner.id;
    partner.memory.bind = creep.id;
    return partner;
};

/**
 * 自愈与搭档治疗的自愈取舍方式。
 *
 * - `ifWorseThanPartner`：只有自己也比搭档更伤时才自愈（把 HEAL 留给更该救的人）；
 * - `always`：只要自己受伤就自愈，剩余治疗量再给搭档。
 */
export type CombatHealPriority = 'ifWorseThanPartner' | 'always';

export type HealAndFollowOptions = {
    /** 自愈取舍，默认 `ifWorseThanPartner`。 */
    selfHeal?: CombatHealPriority;
};

/**
 * 治疗搭档并跟上它：自愈 → 近身 `heal` → 3 格内 `rangedHeal` + 靠近 → 单纯跟随。
 *
 * @returns 本 tick 是否给自己回血了（调用方通常不需要，保留以便分支）。
 *
 * @remarks
 * 只负责「已确定搭档」之后的动作；「还没搭档 / 搭档刚死」的兜底由调用方自己处理，
 * 因为各角色的兜底策略并不一样（有的原地自愈、有的去救最近的伤兵、有的直接自杀）。
 */
export const runHealAndFollow = (
    creep: Creep,
    partner: Creep,
    options: HealAndFollowOptions = {}
): boolean => {
    const priority = options.selfHeal ?? 'ifWorseThanPartner';
    const injured = creep.hits < creep.hitsMax;
    const shouldSelfHeal = priority === 'always' ? injured : injured && creep.hits < partner.hits;

    let healed = false;
    if (shouldSelfHeal) {
        creep.heal(creep);
        healed = true;
    }

    if (!healed && creep.pos.isNearTo(partner)) {
        creep.heal(partner);
    } else if (!healed && creep.pos.inRangeTo(partner, 3)) {
        creep.rangedHeal(partner);
        creep.moveTo(partner);
    } else {
        creep.moveTo(partner);
    }

    return healed;
};
