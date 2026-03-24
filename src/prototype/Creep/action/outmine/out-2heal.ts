import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep
type OutDoubleHealContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<OutDoubleHealContext>();

const OUT_DOUBLE_HEAL_BT_SLOTS = {
    MAIN: 'main'
} as const;

// 外矿双人小队治疗逻辑
const runLegacy = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    let healed = false;

    if (!creep.memory.bind) {
        const roleCreeps = getRoomTickCacheValue(creep.room, 'out_2heal_attackers', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.memory.role == 'out-2attack'
            }) as Creep[]
        );
        const squadCreeps = roleCreeps.filter((c) => !c.memory.bind);
        if (squadCreeps.length) {
            const squadCreep = creep.pos.findClosestByRange(squadCreeps);
            creep.memory.bind = squadCreep.id;
            squadCreep.memory.bind = creep.id;
        }
    }

    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
        healed = true;
    }

    const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;

    if (!bindcreep) {
        delete creep.memory.bind;
        return;
    }

    if (!healed && creep.pos.isNearTo(bindcreep)) {
        creep.heal(bindcreep);
    } else if (!healed && creep.pos.inRangeTo(bindcreep, 3)) {
        creep.rangedHeal(bindcreep);
        creep.moveTo(bindcreep);
    } else creep.moveTo(bindcreep);
};

const mainNode = leaf<OutDoubleHealContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, OUT_DOUBLE_HEAL_BT_SLOTS.MAIN, mainNode)
    )
);

const out_double_heal = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default out_double_heal;
