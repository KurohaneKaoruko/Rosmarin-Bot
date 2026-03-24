import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep
type PowerHealContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<PowerHealContext>();

const POWER_HEAL_BT_SLOTS = {
    MAIN: 'main'
} as const;

// 复用原治疗逻辑
const runLegacy = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    if (!creep.memory.boosted) {
        const boostLevel = creep.memory['boostLevel'];
        if (boostLevel == 1) {
            creep.memory.boosted = creep.goBoost({ [HEAL]: ['LO'] }, { must: true }) === OK;
        } else {
            creep.memory.boosted = true;
        }
        return;
    }

    if (!creep.memory.bind) {
        const attackCreeps = getRoomTickCacheValue(creep.room, 'power_heal_attack_creeps', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.memory.role == 'power-attack' &&
                    c.memory.targetRoom == creep.memory.targetRoom
            }) as Creep[]
        );
        const attackCreep = attackCreeps.find((c) => !c.memory.bind);
        if (attackCreep) {
            creep.memory.bind = attackCreep.id;
            attackCreep.memory.bind = creep.id;
        }
        return;
    }

    const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
    if (!bindcreep) { creep.suicide(); return; }

    let healed = false;

    if ((creep.hits < creep.hitsMax) && (creep.hits < bindcreep.hits)) {
        creep.heal(creep);
        healed = true;
    }

    if (!healed && creep.pos.isNearTo(bindcreep)) {
        creep.heal(bindcreep);
    } else if (!healed && creep.pos.inRangeTo(bindcreep, 3)) {
        creep.rangedHeal(bindcreep);
        creep.moveTo(bindcreep);
    } else creep.moveTo(bindcreep);
};

const mainNode = leaf<PowerHealContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, POWER_HEAL_BT_SLOTS.MAIN, mainNode)
    )
);

const power_heal = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default power_heal;
