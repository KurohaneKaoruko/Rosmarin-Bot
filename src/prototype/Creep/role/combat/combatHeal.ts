import { ROLES } from '@/constant/CreepConstant';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import {
    CombatHealPriority,
    resolveBoundPartner,
    runHealAndFollow,
    tryBindNearestPartner,
} from '@/prototype/Creep/function/boundPartner';

/**
 * 治疗型角色的统一实现。
 *
 * @remarks
 * `out-2heal` / `deposit-heal` / `defend-2heal` / `double-heal` 四个角色的行为是同一件事：
 * **认一个搭档、跟着它、给它回血**。差别只在「跟谁」「怎么自愈」「还没结上伴时干什么」——
 * 全是策略，不是逻辑。这四份实现原本各写一遍，改一处要改四处（且已经开始漂移：
 * 有的自愈是「只要受伤就治」，有的是「比搭档更惨才治」）。
 *
 * 分工用**角色 id 作为元数据**驱动：`makeCombatHealHandler(role)` 按角色 id 预绑定策略，
 * registry 为四个角色各注册一个处理器，运行时不再按 memory.role 查表分发。
 */

/** 还没结上搭档时的兜底行为。 */
type UnboundBehavior =
    /** 什么都不做（下一个 tick 再试结伴）。 */
    | 'none'
    /** 先把自己治好。 */
    | 'selfHeal'
    /** 自愈 + 去救最近的伤兵（双人队的治疗手在等搭档时也在干活）。 */
    | { kind: 'rescueNearest'; minDamage: number };

/** 一个治疗角色的分工描述。 */
type CombatHealPolicy = {
    /** 结伴：候选人筛选 + 房间 tick 缓存键。 */
    bind: {
        cacheKey: string;
        filter: (self: Creep, candidate: Creep) => boolean;
    };
    /** 自愈取舍，见 {@link CombatHealPriority}。 */
    selfHeal: CombatHealPriority;
    /** 还没结上搭档时干什么。 */
    unbound: UnboundBehavior;
    /** 是否锁定站位（战斗中不被物流拉扯）。 */
    lockPosition?: boolean;
    /** 寿命将尽时先卸 boost（回收矿物）再退役。 */
    unBoostWhenDying?: boolean;
    /** 出战前先完成 boost（用 `memory.boostmap`）。 */
    ensureBoosted?: boolean;
};

/** 按角色 id 分工：这是四种治疗角色的唯一配置点。 */
const COMBAT_HEAL_POLICIES: Record<string, CombatHealPolicy> = {
    // 外矿双人队的治疗手：只要自己受伤就先自愈，其余治疗量给搭档
    [ROLES['out-2heal']]: {
        bind: {
            cacheKey: 'out_2heal_attackers',
            filter: (_self, candidate) => candidate.memory.role === ROLES['out-2attack'],
        },
        selfHeal: 'always',
        unbound: 'selfHeal',
    },
    // 沉积物小队的治疗手：同上
    [ROLES['deposit-heal']]: {
        bind: {
            cacheKey: 'deposit_heal_attackers',
            filter: (_self, candidate) => candidate.memory.role === ROLES['deposit-attack'],
        },
        selfHeal: 'always',
        unbound: 'selfHeal',
    },
    // 母房守卫的治疗手：把 HEAL 优先留给更该救的搭档，且守住站位/退役回收 boost
    [ROLES['defend-2heal']]: {
        bind: {
            cacheKey: 'defend2_heal_candidates',
            filter: (_self, candidate) => candidate.memory.role === 'defend2-attack',
        },
        selfHeal: 'ifWorseThanPartner',
        unbound: 'selfHeal',
        lockPosition: true,
        unBoostWhenDying: true,
        ensureBoosted: true,
    },
    // 双人队的治疗手：只在小队内结伴；等搭档时顺手救最近的伤兵
    [ROLES['double-heal']]: {
        bind: {
            cacheKey: 'double_heal_squad_candidates',
            filter: (self, candidate) =>
                candidate.memory.role !== ROLES['double-heal'] && candidate.memory.squad === self.memory.squad,
        },
        selfHeal: 'ifWorseThanPartner',
        unbound: { kind: 'rescueNearest', minDamage: 100 },
        lockPosition: true,
        unBoostWhenDying: true,
        ensureBoosted: true,
    },
};

/** 伤兵判定门槛：这些角色按「掉了多少血」挑救援对象。 */
const rescueCacheKey = (role: string): string => `${role.replace(/-/g, '_')}_need_targets`;

const runUnboundFallback = (creep: Creep, role: string, unbound: UnboundBehavior): void => {
    if (unbound === 'none') return;

    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }
    if (unbound === 'selfHeal') return;

    // 还没结上伴也在干活：救最近的伤兵
    const needHealTargets = getRoomTickCacheValue(creep.room, rescueCacheKey(role), () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (myCreep: Creep) => myCreep.hitsMax - myCreep.hits > unbound.minDamage,
        }) as Creep[]
    );
    const needHeal = creep.pos.findClosestByPath(needHealTargets);
    if (!needHeal) return;

    if (creep.pos.isNearTo(needHeal)) {
        creep.heal(needHeal);
    } else if (creep.pos.inRangeTo(needHeal, 3)) {
        creep.rangedHeal(needHeal);
    }
    if (!creep.pos.isNearTo(needHeal)) {
        creep.moveTo(needHeal);
    }
};

const runCombatHeal = (creep: Creep, role: string, policy: CombatHealPolicy): void => {
    creep.disableAttackNotificationsOnce();

    if (policy.unBoostWhenDying && creep.ticksToLive < 100 && creep.room.my) {
        creep.unBoost();
        return;
    }

    if (!creep.memory.bind) {
        tryBindNearestPartner(creep, policy.bind.cacheKey, (candidate) =>
            policy.bind.filter(creep, candidate)
        );
    }

    const partner = resolveBoundPartner(creep);
    if (!partner) {
        runUnboundFallback(creep, role, policy.unbound);
        return;
    }

    if (policy.lockPosition) creep.memory.dontPullMe = !creep.room.my;

    runHealAndFollow(creep, partner, { selfHeal: policy.selfHeal });
};

/**
 * 按角色 id 构造治疗处理器：策略在注册时预绑定，运行时零查表。
 */
export const makeCombatHealHandler = (role: string) => {
    const policy = COMBAT_HEAL_POLICIES[role];
    return {
        prepare: (creep: Creep) => {
            if (!policy?.ensureBoosted) return true;
            return creep.ensureBoosted(creep.memory['boostmap']);
        },
        run: (creep: Creep) => {
            if (!policy) return;
            runCombatHeal(creep, role, policy);
        },
    };
};
