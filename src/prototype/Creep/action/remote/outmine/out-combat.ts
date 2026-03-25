import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import type { CreepRoleHandler } from '@/framework/ai/creepRole';

const ensureInTargetRoom = (creep: Creep, resetDontPullMe = false): boolean => {
    if (creep.room.name !== creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        if (resetDontPullMe) creep.memory.dontPullMe = false;
        creep.moveToRoom(creep.memory.targetRoom);
        return false;
    }
    return true;
};

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
            filter: (hostile) => hostile.owner.username === 'Source Keeper',
        }) as Creep[]
    );
    if (keeperLairs.length <= 0) return hostileCreeps;
    return hostileCreeps.filter((hostile) => keeperLairs.some((lair) => hostile.pos.inRangeTo(lair.pos, 5)));
};

const getNearestInjuredAlly = (creep: Creep): Creep | null => {
    const allies = getRoomTickCacheValue(creep.room, 'out_attack_damaged_allies', () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (ally) => ally.hits < ally.hitsMax && ally.id !== creep.id,
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

const runOutAttack = (creep: Creep) => {
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    if (!ensureInTargetRoom(creep)) return;

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
        const target = lairs.reduce((left, right) => left.ticksToSpawn < right.ticksToSpawn ? left : right);
        if (!creep.pos.isNearTo(target)) {
            creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
    }
};

const runOutRanged = (creep: Creep) => {
    if (!ensureInTargetRoom(creep)) return;

    const hostileCreeps = creep.room.findEnemyCreeps();
    if (creep.hits < creep.hitsMax) creep.heal(creep);

    if (hostileCreeps.length > 0) {
        const target = creep.pos.findClosestByRange(hostileCreeps);
        if (!target) return;

        if (creep.pos.isNearTo(target)) {
            creep.rangedMassAttack();
        } else if (creep.pos.inRangeTo(target, 3)) {
            creep.rangedAttack(target);
            creep.moveTo(target);
        } else {
            creep.moveTo(target);
        }
        return;
    }

    const myCreeps = getRoomTickCacheValue(creep.room, 'out_ranged_injured_mine', () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (ally) => ally.hits < ally.hitsMax
        }) as Creep[]
    );
    const injuredCreeps = myCreeps.filter((ally) => ally.hits < ally.hitsMax);
    if (injuredCreeps.length <= 0) return;

    const target = creep.pos.findClosestByRange(injuredCreeps);
    if (!target) return;
    if (creep.pos.isNearTo(target)) {
        creep.heal(target);
    } else {
        creep.moveTo(target);
    }
};

const runOutDefend = (creep: Creep) => {
    if (!ensureInTargetRoom(creep)) return;

    const hostileCreeps = getRoomTickCacheValue(creep.room, 'out_defend_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (hostile) => !Memory['whitelist']?.includes(hostile.owner.username)
        }) as Creep[]
    );
    let targets: Array<Creep | StructureInvaderCore> = hostileCreeps;
    if (targets.length === 0) {
        targets = getRoomTickCacheValue(creep.room, 'out_defend_invader_core', () =>
            creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => structure.structureType === STRUCTURE_INVADER_CORE
            }) as StructureInvaderCore[]
        );
    }

    if (targets.length > 0) {
        let target = targets.find((candidate: any) => candidate.getActiveBodyparts?.(HEAL) > 0) as Creep | StructureInvaderCore | undefined;
        if (!target) {
            target = creep.pos.findClosestByRange(targets);
        }
        if (!target) return;

        if (creep.getActiveBodyparts(ATTACK) > 0) {
            if (creep.pos.inRangeTo(target, 1)) {
                creep.attack(target);
                creep.rangedMassAttack();
            } else if (creep.pos.inRangeTo(target, 3)) {
                creep.rangedAttack(target);
                creep.moveTo(target);
            } else {
                creep.moveTo(target);
            }
        } else {
            if (creep.pos.inRangeTo(target, 1)) {
                creep.rangedMassAttack();
            } else if (creep.pos.inRangeTo(target, 3)) {
                creep.rangedAttack(target);
                creep.moveTo(target);
            } else {
                creep.moveTo(target);
            }
        }

        if (creep.hits < creep.hitsMax) {
            creep.heal(creep);
        }
        return;
    }

    const damagedCreeps = getRoomTickCacheValue(creep.room, 'out_defend_damaged_allies', () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (ally) => ally.hits < ally.hitsMax
        }) as Creep[]
    );
    if (damagedCreeps.length > 0) {
        const closestDamagedCreep = creep.pos.findClosestByRange(damagedCreeps);
        if (!closestDamagedCreep) return;

        const range = creep.pos.getRangeTo(closestDamagedCreep);
        if (range <= 1) {
            creep.heal(closestDamagedCreep);
        } else if (range <= 3) {
            creep.rangedHeal(closestDamagedCreep);
            creep.moveTo(closestDamagedCreep);
        } else {
            creep.moveTo(closestDamagedCreep);
        }
        return;
    }

    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { range: 5 });
};

const runOutInvader = (creep: Creep) => {
    if (!ensureInTargetRoom(creep, true)) return;

    const invaderCores = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType === STRUCTURE_INVADER_CORE
    }) as StructureInvaderCore[];
    let targets: Array<Creep | StructureInvaderCore> = [...invaderCores];

    if (targets.length === 0) {
        targets = getRoomTickCacheValue(creep.room, 'out_invader_hostile_creeps', () =>
            creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: (hostile) => !Memory['whitelist']?.includes(hostile.owner.username) && (
                    hostile.getActiveBodyparts(ATTACK) > 0 || hostile.getActiveBodyparts(RANGED_ATTACK) > 0
                )
            }) as Creep[]
        );
    }

    if (targets.length > 0) {
        const target = creep.pos.findClosestByRange(targets);
        if (!target) return;
        if (creep.pos.inRangeTo(target, 1)) {
            const result = creep.attack(target);
            creep.memory.dontPullMe = result === OK;
        } else {
            creep.memory.dontPullMe = false;
            creep.moveTo(target);
        }
        return;
    }

    creep.memory.dontPullMe = false;
    creep.memory['suicideCount'] = (creep.memory['suicideCount'] || 0) + 1;
    if (creep.memory['suicideCount'] >= 10) creep.suicide();
};

const outAttack: CreepRoleHandler = {
    run: runOutAttack
};

const outRanged: CreepRoleHandler = {
    run: runOutRanged
};

const outDefend: CreepRoleHandler = {
    run: runOutDefend
};

const outInvader: CreepRoleHandler = {
    run: runOutInvader
};

export { outAttack, outDefend, outInvader, outRanged };
