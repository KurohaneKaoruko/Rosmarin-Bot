import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep
type OutAttackContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<OutAttackContext>();

const OUT_ATTACK_BT_SLOTS = {
    MAIN: 'main'
} as const;

const runLegacy = (creep: Creep) => {
    if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(creep.memory.targetRoom);
        return;
    }

    const hostileCreeps = getRoomTickCacheValue(creep.room, 'out_attack_source_keeper', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (c) => c.owner.username == 'Source Keeper'
        }) as Creep[]
    );
    if (hostileCreeps.length > 0) {
        const target = creep.pos.findClosestByRange(hostileCreeps);
        if (!creep.pos.isNearTo(target)) {
            creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
        } else if (target.body.every((part) => part.type !== ATTACK)) {
            creep.attack(target);
            creep.moveTo(target);
            return;
        }
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        return;
    }

    const damagedAllies = getRoomTickCacheValue(creep.room, 'out_attack_damaged_allies', () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.hits < c.hitsMax &&
                c.memory.role != 'out-carry' && c.memory.role != 'out-car'
        }) as Creep[]
    );
    const myCreeps = damagedAllies.filter((c) => c.id !== creep.id);
    if (myCreeps.length > 0) {
        const target = creep.pos.findClosestByRange(myCreeps);
        if (creep.pos.inRangeTo(target, 1)) {
            creep.heal(target);
        } else {
            if (creep.hits < creep.hitsMax) creep.heal(creep);
            creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
        return;
    }

    const lairs = getRoomTickCacheValue(creep.room, 'out_attack_lairs', () =>
        creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType === STRUCTURE_KEEPER_LAIR
        }) as StructureKeeperLair[]
    );
    if (lairs.length > 0) {
        const target = lairs.reduce((l, r) => l.ticksToSpawn < r.ticksToSpawn ? l : r);
        if (!creep.pos.isNearTo(target)) {
            creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        return;
    }

    if (creep.hits < creep.hitsMax) creep.heal(creep);
};

const mainNode = leaf<OutAttackContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, OUT_ATTACK_BT_SLOTS.MAIN, mainNode)
    )
);

const outAttack = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default outAttack;
