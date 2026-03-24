/** 双人小队 防御小队 */
import { pickDefenseAnchorRampart } from '@/shared/defenseUtils';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, selector, sequence, hotSwap, fail } from '@/framework/ai/behaviorTree';

type DefendCtx = { creep: Creep };

// 行为树注册表：支持双人近战防御热插拔
export const defend2AttackRegistry = new BehaviorTreeRegistry<DefendCtx>();

// boost 逻辑节点：未完成时返回 Running，完成后返回 Success
const ensureBoost = leaf<DefendCtx>(({ creep }) => {
    if (creep.memory.boosted) return BtStatus.Success;
    const ok = creep.goBoost({
        [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
        [ATTACK]: ['XUH2O', 'UH2O', 'UH'],
        [MOVE]: ['XZHO2', 'ZHO2', 'ZO']
    }, { must: true }) === OK;
    if (ok) creep.memory.boosted = true;
    return ok ? BtStatus.Success : BtStatus.Running;
});

// 主防御节点：执行一次即可，保持 Running 让行为树持续驱动
const runDefend = leaf<DefendCtx>(({ creep }) => {
    creep.disableAttackNotificationsOnce();

    // 等待绑定
    if (!creep.memory.bind) return BtStatus.Running;

    // 获取绑定的另一个 creep
    const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
    if (!bindcreep) {
        delete creep.memory.bind;
        return BtStatus.Running;
    }

    if (!bindcreep.memory.boosted) return BtStatus.Running;

    const costCallback = creep.room.getDefenseCreepCostCallback(creep.name);

    const mem = creep.room.memory['defenseRamparts'];
    const minHits = (mem && mem.minHits) ? mem.minHits : (creep.room.memory['breached'] ? 1e5 : 1e6);
    const anchor = pickDefenseAnchorRampart(creep.room, 'melee', creep.name, minHits);

    // 两人距离拉开时不要继续打/追：先合体，否则奶位容易“裸奔穿火线”被秒。
    if (!creep.pos.isNear(bindcreep.pos)) {
        creep.moveTo(bindcreep.pos, { range: 1, costCallback } as any);
        return BtStatus.Running;
    }

    const state = creep.room.memory['defenseState'];
    const hasRamparts = Array.isArray(creep.room[STRUCTURE_RAMPART]) && creep.room[STRUCTURE_RAMPART].length > 0;

    // 血线过低优先撤退：双人队的胜利条件是“活着持续输出”，不是换血硬拼。
    const needRetreat =
        creep.hits < creep.hitsMax * 0.55 ||
        bindcreep.hits < bindcreep.hitsMax * 0.55;
    if (needRetreat) {
        if (anchor) {
            creep.doubleMoveTo(anchor.pos, '#ffaa00', { range: 0, costCallback } as any);
        } else {
            creep.doubleFlee();
        }
        return BtStatus.Running;
    }

    const focusId = creep.room.memory['_towerFocus']?.id as Id<Creep | PowerCreep> | undefined;
    const focus = focusId ? (Game.getObjectById(focusId) as any) : null;

    const hostiles = creep.findHostileCreeps() as Creep[];
    const hostile = (focus && focus.pos?.roomName === creep.room.name ? focus : null) || creep.pos.findClosestByRange(hostiles);
    if (!hostile) return BtStatus.Running;

    // 未破口且有工事时：守点不追击，靠塔集火点杀。
    if (state !== 'breached' && hasRamparts && anchor) {
        if (!creep.pos.isEqualTo(anchor.pos)) {
            creep.doubleMoveTo(anchor.pos, '#ff0000', { range: 0, costCallback } as any);
            creep.room.CallTowerAttack(hostile);
            return BtStatus.Running;
        }
        creep.room.CallTowerAttack(hostile);
        if (creep.pos.inRangeTo(hostile, 1)) {
            creep.attack(hostile);
        }
        return BtStatus.Running;
    }

    // 破口/无工事时允许短追击，但不要离核心过远，避免被风筝送死。
    const corePos = creep.room.storage?.pos || new RoomPosition(25, 25, creep.room.name);
    if (hostile.pos.getRangeTo(corePos) > 16 && anchor) {
        creep.doubleMoveTo(anchor.pos, '#ffaa00', { range: 0, costCallback } as any);
        creep.room.CallTowerAttack(hostile);
        return BtStatus.Running;
    }

    creep.room.CallTowerAttack(hostile);
    if (creep.pos.inRangeTo(hostile, 1)) {
        creep.attack(hostile);
    } else {
        creep.doubleMoveTo(hostile.pos, '#ff0000', { range: 1, costCallback } as any);
    }
    return BtStatus.Running;
});

// 行为树：可被 hotSwap 替换根节点，默认执行 boost -> 防御
const tree = new BehaviorTree<DefendCtx>(
    selector(
        hotSwap(defend2AttackRegistry, 'root', fail()),
        sequence(ensureBoost, runDefend)
    )
);

const double_defender = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
}

export default double_defender
