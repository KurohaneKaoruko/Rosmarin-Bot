import { getRoomTickCacheValue } from '@/shared/roomTickCache';

const resolveBoundPartner = (creep: Creep, onMissing?: () => void): Creep | null => {
    if (!creep.memory.bind) return null;

    const partner = Game.getObjectById(creep.memory.bind);
    if (partner) return partner;

    delete creep.memory.bind;
    onMissing?.();
    return null;
};

const tryBindNearestPartner = (
    creep: Creep,
    cacheKey: string,
    filter: (candidate: Creep) => boolean
): Creep | null => {
    const boundPartner = resolveBoundPartner(creep);
    if (boundPartner) return boundPartner;

    const candidates = getRoomTickCacheValue(creep.room, cacheKey, () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (candidate) => candidate.id !== creep.id && filter(candidate as Creep)
        }) as Creep[]
    );
    const available = candidates.filter((candidate) => !candidate.memory.bind);
    if (available.length <= 0) return null;

    const partner = creep.pos.findClosestByRange(available);
    if (!partner) return null;

    creep.memory.bind = partner.id;
    partner.memory.bind = creep.id;
    return partner;
};

const noBindAction = (creep: Creep) => {
    const roomHostiles = getRoomTickCacheValue(creep.room, 'power_attack_room_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS) as Creep[]
    );
    const hostiles = roomHostiles.filter((hostile) => creep.pos.inRangeTo(hostile, 8));
    if (hostiles.length === 0) return;

    const healHostiles = hostiles.filter((hostile: any) => hostile.body.some((part: any) => part.type === HEAL));
    if (healHostiles.length > 0) {
        const hostile = creep.pos.findClosestByRange(healHostiles);
        if (!hostile) return;
        if (creep.pos.isNearTo(hostile)) creep.attack(hostile);
        creep.moveTo(hostile);
        return;
    }

    const attackHostiles = hostiles.filter((hostile: any) =>
        hostile.body.some((part: any) => part.type === ATTACK || part.type === RANGED_ATTACK)
    );
    if (attackHostiles.length <= 0) return;

    const hostile = creep.pos.findClosestByRange(attackHostiles);
    if (!hostile) return;
    if (creep.pos.isNearTo(hostile)) creep.attack(hostile);
    creep.moveTo(hostile);
};

const runPowerAttack = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    if (!creep.memory.boosted) {
        const boostLevel = creep.memory['boostLevel'];
        if (boostLevel === 1) {
            creep.memory.boosted = creep.goBoost({
                [ATTACK]: ['UH'],
                [TOUGH]: ['GO']
            }, { must: true }) === OK;
        } else if (boostLevel === 2) {
            creep.memory.boosted = creep.goBoost({
                [ATTACK]: ['UH2O'],
                [TOUGH]: ['GHO2']
            }, { must: true }) === OK;
        } else {
            creep.memory.boosted = true;
        }
        return;
    }

    if (!creep.memory.bind) {
        if (creep.room.name === creep.memory.targetRoom) {
            noBindAction(creep);
        }
        return;
    }

    resolveBoundPartner(creep);
    if (creep.doubleMoveToRoom(creep.memory.targetRoom, '#ff0000')) return;

    let powerBank = creep.room.powerBank?.[0];
    if (!powerBank) {
        creep.room.update(STRUCTURE_POWER_BANK);
        powerBank = creep.room.powerBank?.[0];
    }
    if (!powerBank) {
        if (Game.time % 5 === 0) {
            creep.suicide();
            resolveBoundPartner(creep)?.suicide();
        }
        return;
    }

    if (Game.time % 5 === 0 || !creep.memory['hostile']) {
        const roomHostiles = getRoomTickCacheValue(creep.room, 'power_attack_room_hostiles', () =>
            creep.room.find(FIND_HOSTILE_CREEPS) as Creep[]
        );
        const hostiles = roomHostiles.filter((hostile) =>
            creep.pos.inRangeTo(hostile, 8) && hostile.pos.inRangeTo(powerBank.pos, 8)
        );
        const attackHostiles = hostiles.filter((hostile: any) =>
            hostile.body.some((part: any) => part.type === ATTACK || part.type === RANGED_ATTACK)
        );
        const healHostiles = hostiles.filter((hostile: any) => hostile.body.some((part: any) => part.type === HEAL));
        const hostile = creep.pos.findClosestByRange([...healHostiles, ...attackHostiles]) ||
            creep.pos.findClosestByRange(hostiles, {
                filter: (candidate) => candidate.pos.inRangeTo(powerBank!.pos, 3) &&
                    candidate.body.some((part: any) => part.type === CARRY)
            });
        if (hostile) creep.memory['hostile'] = hostile.id;
    }

    if (creep.memory['hostile']) {
        const hostileId = creep.memory['hostile'] as Id<Creep> | undefined;
        const hostile = hostileId ? Game.getObjectById(hostileId) : null;
        if (hostile && hostile.pos.inRangeTo(powerBank.pos, 10)) {
            if (creep.pos.isNearTo(hostile)) {
                creep.attack(hostile);
            } else {
                const roomHostiles = getRoomTickCacheValue(creep.room, 'power_attack_non_whitelist_hostiles', () =>
                    creep.room.find(FIND_HOSTILE_CREEPS, {
                        filter: (candidate) => !Memory['whitelist'].includes(candidate.owner.username)
                    }) as Creep[]
                );
                const nearCreeps = roomHostiles.filter((candidate) => creep.pos.inRangeTo(candidate, 1));
                if (nearCreeps.length > 0) creep.attack(nearCreeps[0]);
            }
            if (!hostile.getActiveBodyparts(ATTACK)) {
                creep.doubleMoveTo(hostile.pos, '#ff0000');
            }
            return;
        }
        delete creep.memory['hostile'];
    }

    if (
        powerBank.hits < 50e3 &&
        powerBank.ticksToDecay > 1500 &&
        creep.ticksToLive > 100
    ) {
        const powerCarryCreeps = getRoomTickCacheValue(creep.room, 'power_attack_power_carries', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (candidate) => candidate.memory.role === 'power-carry'
            }) as Creep[]
        );
        if (!powerCarryCreeps.some((candidate) => creep.pos.inRangeTo(candidate, 10))) return;
    }

    if (creep.pos.isNearTo(powerBank)) {
        if (creep.hits >= creep.hitsMax / 2) creep.attack(powerBank);
    } else {
        creep.doubleMoveTo(powerBank.pos, '#aa0000', { ignoreCreeps: true });
    }
};

const runPowerHeal = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    if (!creep.memory.boosted) {
        const boostLevel = creep.memory['boostLevel'];
        if (boostLevel === 1) {
            creep.memory.boosted = creep.goBoost({ [HEAL]: ['LO'] }, { must: true }) === OK;
        } else {
            creep.memory.boosted = true;
        }
        return;
    }

    if (!creep.memory.bind) {
        tryBindNearestPartner(
            creep,
            'power_heal_attack_creeps',
            (candidate) => candidate.memory.role === 'power-attack' &&
                candidate.memory.targetRoom === creep.memory.targetRoom
        );
        return;
    }

    const bindcreep = resolveBoundPartner(creep, () => creep.suicide());
    if (!bindcreep) return;

    let healed = false;
    if (creep.hits < creep.hitsMax && creep.hits < bindcreep.hits) {
        creep.heal(creep);
        healed = true;
    }

    if (!healed && creep.pos.isNearTo(bindcreep)) {
        creep.heal(bindcreep);
    } else if (!healed && creep.pos.inRangeTo(bindcreep, 3)) {
        creep.rangedHeal(bindcreep);
        creep.moveTo(bindcreep);
    } else {
        creep.moveTo(bindcreep);
    }
};

const runPowerRanged = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();
    if (creep.room.name !== creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(creep.memory.targetRoom);
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        return;
    }

    let healOK = false;
    let rangedOK = false;
    let moveOK = false;

    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
        healOK = true;
    }

    const roomCombatHostiles = getRoomTickCacheValue(creep.room, 'power_ranged_combat_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (hostile) =>
                hostile.body.some((part) => part.type === HEAL || part.type === ATTACK || part.type === RANGED_ATTACK)
        }) as Creep[]
    );
    const hostileCreeps = roomCombatHostiles.filter((hostile) => creep.pos.inRangeTo(hostile, 8));
    if (hostileCreeps.length > 0) {
        const healer = hostileCreeps.find((hostile) => hostile.body.some((part) => part.type === HEAL));
        const attacker = hostileCreeps.find((hostile) => hostile.body.some((part) => part.type === ATTACK));
        const target = healer || attacker;
        if (target && !creep.pos.inRangeTo(target, 1)) {
            creep.moveTo(target, { ignoreCreeps: false, range: 1 });
            moveOK = true;
        }

        const range3hostiles = hostileCreeps.filter((hostile) => creep.pos.inRangeTo(hostile, 3));
        if (range3hostiles.length >= 10) {
            creep.rangedMassAttack();
            rangedOK = true;
        } else if (range3hostiles.filter((hostile) => creep.pos.inRangeTo(hostile, 2)).length >= 3) {
            creep.rangedMassAttack();
            rangedOK = true;
        } else if (range3hostiles.filter((hostile) => creep.pos.inRangeTo(hostile, 1)).length >= 1) {
            creep.rangedMassAttack();
            rangedOK = true;
        } else {
            const range3healer = range3hostiles.find((hostile) => hostile.body.some((part) => part.type === HEAL));
            const range3attacker = range3hostiles.find((hostile) => hostile.body.some((part) => part.type === ATTACK));
            const range3target = range3healer || range3attacker || range3hostiles[0];
            if (range3target) {
                creep.rangedAttack(range3target);
                rangedOK = true;
            }
        }
    }

    if (!healOK || !rangedOK || !moveOK) {
        const injuredMyCreeps = getRoomTickCacheValue(creep.room, 'power_ranged_injured_mine', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (ally) => ally.hits < ally.hitsMax
            }) as Creep[]
        );
        const myCreeps = injuredMyCreeps.filter((ally) =>
            ally.hits < ally.hitsMax && (creep.pos.inRangeTo(ally, 3) || ally.memory.role === 'power-ranged')
        );
        let healTarget = myCreeps.find((ally) => creep.pos.inRangeTo(ally, 1));
        if (healTarget) {
            if (!healOK) creep.heal(healTarget);
        } else if (myCreeps.length > 0) {
            healTarget = creep.pos.findClosestByRange(myCreeps);
            if (!healTarget) return;
            if (!moveOK) creep.moveTo(healTarget, { ignoreCreeps: false });
            if (!rangedOK && creep.pos.isNearTo(healTarget)) creep.rangedHeal(healTarget);
        }
    }

    if (rangedOK || moveOK || healOK) return;

    let powerBank = creep.room.powerBank?.[0];
    if (!powerBank) {
        creep.room.update(STRUCTURE_POWER_BANK);
        powerBank = creep.room.powerBank?.[0];
    }
    if (powerBank) {
        if (creep.pos.inRangeTo(powerBank, 3)) {
            creep.rangedAttack(powerBank);
            creep.heal(creep);
        } else {
            creep.moveTo(powerBank, { range: 3, ignoreCreeps: false });
        }
        return;
    }

    if (Game.time % 10 === 0) {
        creep.suicide();
    }
};

const powerAttack = {
    run: runPowerAttack
};

const powerHeal = {
    run: runPowerHeal
};

const powerRanged = {
    run: runPowerRanged
};

export { powerAttack, powerHeal, powerRanged };
