import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep
type OutRangedContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<OutRangedContext>();

const OUT_RANGED_BT_SLOTS = {
    MAIN: 'main'
} as const;

const runLegacy = (creep: Creep) => {
    if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(creep.memory.targetRoom);
        return;
    }

    const hostileCreeps = creep.room.findEnemyCreeps();

    if (creep.hits < creep.hitsMax) creep.heal(creep);

    if (hostileCreeps.length > 0) {
        const target = creep.pos.findClosestByRange(hostileCreeps);
        if (target) {
            if (creep.pos.isNearTo(target)) {
                creep.rangedMassAttack();
            } else if (creep.pos.inRangeTo(target, 3)) {
                creep.rangedAttack(target);
                creep.moveTo(target);
            } else {
                creep.moveTo(target);
            }
        }
    } else {
        const myCreeps = getRoomTickCacheValue(creep.room, 'out_ranged_injured_mine', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.hits < c.hitsMax
            }) as Creep[]
        );

        const injuredCreeps = myCreeps.filter((c) => c.hits < c.hitsMax);
        if (injuredCreeps.length > 0) {
            const target = creep.pos.findClosestByRange(injuredCreeps);
            if (target) {
                if (creep.pos.isNearTo(target)) {
                    creep.heal(target);
                } else {
                    creep.moveTo(target);
                }
            }
        }
    }
};

const mainNode = leaf<OutRangedContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, OUT_RANGED_BT_SLOTS.MAIN, mainNode)
    )
);

const outRanged = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default outRanged;
