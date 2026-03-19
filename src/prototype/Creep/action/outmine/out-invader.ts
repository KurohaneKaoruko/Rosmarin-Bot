import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep
type OutInvaderContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<OutInvaderContext>();

const OUT_INVADER_BT_SLOTS = {
    MAIN: 'main'
} as const;

const runLegacy = (creep: Creep) => {
    if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(creep.memory.targetRoom);
        return;
    }

    const invaderCores = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType === STRUCTURE_INVADER_CORE
    });

    let targets: Array<Creep | StructureInvaderCore> = [...invaderCores];
    if (targets.length === 0) {
        const hostileCreeps = getRoomTickCacheValue(creep.room, 'out_invader_hostile_creeps', () =>
            creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: (c: Creep) => !Memory['whitelist']?.includes(c.owner.username) && (
                    c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0
                )
            }) as Creep[]
        );
        targets = hostileCreeps;
    }

    if (targets.length > 0) {
        const target = creep.pos.findClosestByRange(targets);
        if (!target) return;
        if (creep.pos.inRangeTo(target, 1)) {
            creep.attack(target);
        } else {
            creep.moveTo(target);
        }
        return;
    }

    if (targets.length === 0) {
        creep.memory['suicideCount'] = (creep.memory['suicideCount'] || 0) + 1;
        if (creep.memory['suicideCount'] >= 10) creep.suicide();
    }
};

const mainNode = leaf<OutInvaderContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, OUT_INVADER_BT_SLOTS.MAIN, mainNode)
    )
);

const outInvader = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default outInvader;
