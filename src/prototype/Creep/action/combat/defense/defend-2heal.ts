/** 双人小队 heal */
import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, selector, sequence, hotSwap, fail } from '@/framework/ai/behaviorTree';

type DefendCtx = { creep: Creep };

// 行为树注册表：支持双人治疗逻辑热插拔
export const defend2HealRegistry = new BehaviorTreeRegistry<DefendCtx>();

// boost 逻辑节点：未完成时返回 Running，完成后返回 Success
const ensureBoost = leaf<DefendCtx>(({ creep }) => {
    if (creep.memory.boosted) return BtStatus.Success;
    if (creep.memory['boostmap']) {
        const result = creep.goBoost(creep.memory['boostmap']);
        if (result === OK) {
            creep.memory.boosted = true;
            return BtStatus.Success;
        }
        return BtStatus.Running;
    }
    const ok = creep.goBoost({
        [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
        [HEAL]: ['XLHO2', 'LHO2', 'LO'],
        [MOVE]: ['XZHO2', 'ZHO2', 'ZO']
    }, { must: true }) === OK;
    if (ok) creep.memory.boosted = true;
    return ok ? BtStatus.Success : BtStatus.Running;
});

// 主治疗节点：执行一次即可，保持 Running 让行为树持续驱动
const runHeal = leaf<DefendCtx>(({ creep }) => {
    creep.disableAttackNotificationsOnce();
    if (creep.ticksToLive < 100 && creep.room.my) {
        creep.unBoost();
        return BtStatus.Running;
    }

    if (!creep.memory.bind) {
        const attackCreeps = getRoomTickCacheValue(creep.room, 'defend_2heal_attack_creeps', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.memory.role == 'defend-2attack'
            }) as Creep[]
        );
        const attackCreep = attackCreeps.find((c) => !c.memory.bind);
        if (attackCreep) {
            creep.memory.bind = attackCreep.id;
            attackCreep.memory.bind = creep.id;
        }
        return BtStatus.Running;
    }

    const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
    if (!bindcreep) {
        delete creep.memory.bind;
        return BtStatus.Running;
    }
    if (!bindcreep.memory.boosted) return BtStatus.Running;

    // 非己方房间不允许被 pull：避免在外矿/敌房被拖拽导致路径混乱与卡边。
    creep.memory.dontPullMe = !creep.room.my;

    const costCallback = creep.room.getDefenseCreepCostCallback(creep.name);

    const needSelfCritical = creep.hits < creep.hitsMax * 0.35;
    const needRetreat =
        creep.hits < creep.hitsMax * 0.55 ||
        bindcreep.hits < bindcreep.hitsMax * 0.55;

    // 濒死优先自救并拉开距离：否则治疗位倒下会导致整队必死。
    if (needSelfCritical && creep.hits < creep.hitsMax) {
        creep.heal(creep);
        if (creep.pos.isNearTo(bindcreep)) {
            creep.doubleFlee();
        } else {
            creep.moveTo(bindcreep, { range: 1, costCallback } as any);
        }
        return BtStatus.Running;
    }

    const shouldSaveBind =
        bindcreep.hits < bindcreep.hitsMax &&
        (bindcreep.hits < bindcreep.hitsMax * 0.75 || bindcreep.hits < creep.hits);

    // 高压时撤退由奶位触发也可以：双人移动会 pull，同步拉回安全区。
    if (needRetreat && creep.pos.isNearTo(bindcreep)) {
        if (shouldSaveBind) creep.heal(bindcreep);
        else if (creep.hits < creep.hitsMax) creep.heal(creep);
        creep.doubleFlee();
        return BtStatus.Running;
    }

    if (shouldSaveBind) {
        if (creep.pos.isNearTo(bindcreep)) {
            creep.heal(bindcreep);
        } else if (creep.pos.inRangeTo(bindcreep, 3)) {
            creep.rangedHeal(bindcreep);
        }
    } else if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }

    // 治疗位只负责安全跟随：不要为了“赶路”单独穿火线贴攻击位。
    if (!creep.pos.isNearTo(bindcreep)) {
        creep.moveTo(bindcreep, { range: 1, costCallback } as any);
    }
    return BtStatus.Running;
});

// 行为树：可被 hotSwap 替换根节点，默认执行 boost -> 治疗
const tree = new BehaviorTree<DefendCtx>(
    selector(
        hotSwap(defend2HealRegistry, 'root', fail()),
        sequence(ensureBoost, runHeal)
    )
);

const double_heal = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
}

export default double_heal
