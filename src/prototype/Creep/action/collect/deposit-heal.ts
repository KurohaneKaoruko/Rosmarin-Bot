import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep
type DepositHealContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<DepositHealContext>();

const DEPOSIT_HEAL_BT_SLOTS = {
    MAIN: 'main'
} as const;

// 复用原治疗逻辑：绑定 + 自疗/队友治疗
const runLegacy = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    let healed = false;

    if (!creep.memory.bind) {
        const roleCreeps = getRoomTickCacheValue(creep.room, 'deposit_heal_attackers', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.memory.role == 'deposit-attack'
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

    if (!healed) {
        if (creep.pos.isNearTo(bindcreep)) {
            creep.heal(bindcreep);
            healed = true;
        } else if (creep.pos.inRangeTo(bindcreep, 3)) {
            creep.rangedHeal(bindcreep);
            creep.moveTo(bindcreep);
            healed = true;
        } else {
            creep.moveTo(bindcreep);
        }
    }
};

const mainNode = leaf<DepositHealContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, DEPOSIT_HEAL_BT_SLOTS.MAIN, mainNode)
    )
);

const deposit_heal = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default deposit_heal;
