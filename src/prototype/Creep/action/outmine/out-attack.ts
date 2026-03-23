import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep
type OutAttackContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<OutAttackContext>();

const OUT_ATTACK_BT_SLOTS = {
    MAIN: 'main'
} as const;

const getTrackedKeeperLairs = (creep: Creep): StructureKeeperLair[] => {
    if (creep.room.name !== creep.memory.targetRoom) return [];
    const memory = creep.memory as CreepMemory & { keeperLairIds?: string[] };
    const tracked = (memory.keeperLairIds || [])
        .map((id) => Game.getObjectById(id as Id<StructureKeeperLair>))
        .filter((lair): lair is StructureKeeperLair => !!lair);
    if (tracked.length > 0) return tracked;
    if (typeof STRUCTURE_KEEPER_LAIR === 'undefined') return [];

    const lairs = getRoomTickCacheValue(creep.room, 'out_attack_keeper_lairs', () =>
        creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType === STRUCTURE_KEEPER_LAIR,
        }) as StructureKeeperLair[]
    );
    if (lairs.length <= 0) return [];

    const resources: { pos: RoomPosition }[] = [];
    try {
        resources.push(...((creep.room.find(FIND_SOURCES) || []) as Source[]));
    }
    catch { }
    if (typeof FIND_MINERALS !== 'undefined') {
        try {
            resources.push(...((creep.room.find(FIND_MINERALS) || []) as Mineral[]));
        }
        catch { }
    }

    const relevantLairs = resources.length > 0
        ? lairs.filter((lair) => resources.some((resource) => {
            if (resource.pos && typeof resource.pos.inRangeTo === 'function') {
                return resource.pos.inRangeTo(lair.pos, 5);
            }
            if (lair.pos && typeof lair.pos.getRangeTo === 'function') {
                return lair.pos.getRangeTo(resource.pos) <= 5;
            }
            return false;
        }))
        : lairs;
    memory.keeperLairIds = relevantLairs.map((lair) => lair.id);
    return relevantLairs;
};

const getTrackedSourceKeepers = (creep: Creep, keeperLairs: StructureKeeperLair[]): Creep[] => {
    const hostileCreeps = getRoomTickCacheValue(creep.room, 'out_attack_source_keeper', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (c) => c.owner.username === 'Source Keeper',
        }) as Creep[]
    );
    if (keeperLairs.length <= 0) return hostileCreeps;
    return hostileCreeps.filter((hostile) => keeperLairs.some((lair) => hostile.pos.inRangeTo(lair.pos, 5)));
};

const getNearestInjuredAlly = (creep: Creep): Creep | null => {
    const allies = getRoomTickCacheValue(creep.room, 'out_attack_damaged_allies', () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.hits < c.hitsMax && c.id !== creep.id,
        }) as Creep[]
    );
    const injured = allies.filter((ally) => ally.getActiveBodyparts(HEAL) === 0);
    if (injured.length <= 0) return null;
    return creep.pos.findClosestByRange(injured);
};

const getNextWaitingLair = (keeperLairs: StructureKeeperLair[]): StructureKeeperLair | null => {
    let nextLair: StructureKeeperLair | null = null;
    let minTicks = Infinity;
    for (const lair of keeperLairs) {
        const ticks = typeof lair.ticksToSpawn === 'number' ? lair.ticksToSpawn : Infinity;
        if (ticks < minTicks) {
            minTicks = ticks;
            nextLair = lair;
        }
    }
    return nextLair;
};

const runLegacy = (creep: Creep) => {
    if (creep.hits < creep.hitsMax) creep.heal(creep);

    if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(creep.memory.targetRoom);
        return;
    }

    const keeperLairs = getTrackedKeeperLairs(creep);
    const hostileCreeps = getTrackedSourceKeepers(creep, keeperLairs);
    if (hostileCreeps.length > 0) {
        const target = creep.pos.findClosestByRange(hostileCreeps);
        if (!target) return;
        if (!creep.pos.isNearTo(target)) {
            creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
        } else if (target.body.every((part) => part.type !== ATTACK)) {
            creep.attack(target);
            creep.moveTo(target);
            return;
        } else {
            creep.attack(target);
        }
        return;
    }

    const injuredAlly = getNearestInjuredAlly(creep);
    if (injuredAlly) {
        if (creep.pos.inRangeTo(injuredAlly, 1)) {
            creep.heal(injuredAlly);
        } else {
            creep.moveTo(injuredAlly, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
        return;
    }

    const nextLair = getNextWaitingLair(keeperLairs);
    if (nextLair) {
        if (!creep.pos.inRangeTo(nextLair, 1)) {
            creep.moveTo(nextLair, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
        return;
    }

    const lairs = getRoomTickCacheValue(creep.room, 'out_attack_lairs', () =>
        creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType === STRUCTURE_KEEPER_LAIR,
        }) as StructureKeeperLair[]
    );
    if (lairs.length > 0) {
        const target = lairs.reduce((l, r) => l.ticksToSpawn < r.ticksToSpawn ? l : r);
        if (!creep.pos.isNearTo(target)) {
            creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
    }
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
