import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import type { CreepRoleHandler } from '../../types';

const resolveBoundPartner = (creep: Creep, onMissing?: () => void): Creep | null => {
    if (!creep.memory.bind) return null;

    const partner = Game.getObjectById(creep.memory.bind as Id<Creep>) as Creep | null;
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

const runDepositAttack = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();
    if (!resolveBoundPartner(creep)) return;
    if (creep.doubleMoveToRoom(creep.memory.targetRoom, '#ff0000')) return;

    const combatHostiles = getRoomTickCacheValue(creep.room, 'deposit_attack_combat_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (hostile) =>
                !Memory['whitelist'].includes(hostile.owner.username) &&
                hostile.body.some((part) =>
                    part.type === ATTACK ||
                    part.type === RANGED_ATTACK ||
                    part.type === HEAL ||
                    part.type === WORK
                )
        }) as Creep[]
    );
    const deposits = getRoomTickCacheValue(creep.room, 'deposit_attack_deposits', () =>
        creep.room.find(FIND_DEPOSITS) as Deposit[]
    );
    const hostileNearDeposit = getRoomTickCacheValue(creep.room, 'deposit_attack_hostile_near_deposit', () => {
        const result: Record<string, true> = {};
        for (const hostile of combatHostiles) {
            if (deposits.some((deposit) => deposit.pos.inRangeTo(hostile.pos, 5))) result[hostile.id] = true;
        }
        return result;
    });
    const hostiles = combatHostiles.filter((hostile) => hostileNearDeposit[hostile.id] || hostile.pos.inRangeTo(creep, 3));
    if (hostiles.length <= 0) return;

    const hostile = creep.pos.findClosestByRange(hostiles);
    if (!hostile) return;
    if (creep.pos.isNearTo(hostile)) {
        creep.attack(hostile);
    } else {
        creep.doubleMoveTo(hostile.pos, '#ff0000');
    }
};

const runDepositHeal = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    let healed = false;
    if (!creep.memory.bind) {
        tryBindNearestPartner(
            creep,
            'deposit_heal_attackers',
            (candidate) => candidate.memory.role === 'deposit-attack'
        );
    }

    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
        healed = true;
    }

    const bindcreep = resolveBoundPartner(creep);
    if (!bindcreep) return;

    if (!healed) {
        if (creep.pos.isNearTo(bindcreep)) {
            creep.heal(bindcreep);
        } else if (creep.pos.inRangeTo(bindcreep, 3)) {
            creep.rangedHeal(bindcreep);
            creep.moveTo(bindcreep);
        } else {
            creep.moveTo(bindcreep);
        }
    }
};

const runDepositRanged = (creep: Creep) => {
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

    const combatHostiles = getRoomTickCacheValue(creep.room, 'deposit_ranged_combat_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (hostile) => !Memory['whitelist'].includes(hostile.owner.username) &&
                hostile.body.some((part) =>
                    part.type === ATTACK ||
                    part.type === RANGED_ATTACK ||
                    part.type === HEAL ||
                    part.type === WORK ||
                    part.type === CARRY
                )
        }) as Creep[]
    );
    const deposits = getRoomTickCacheValue(creep.room, 'deposit_ranged_deposits', () =>
        creep.room.find(FIND_DEPOSITS) as Deposit[]
    );
    const hostileCreeps = combatHostiles.filter((hostile) =>
        hostile.pos.inRangeTo(creep, 3) || deposits.some((deposit) => deposit.pos.inRangeTo(hostile.pos, 5))
    );

    if (hostileCreeps.length > 0) {
        const healer = hostileCreeps.find((hostile) => hostile.body.some((part) => part.type === HEAL));
        const attacker = hostileCreeps.find((hostile) =>
            hostile.body.some((part) => part.type === ATTACK || part.type === RANGED_ATTACK)
        );
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
        const damagedAllies = getRoomTickCacheValue(creep.room, 'deposit_ranged_damaged_allies', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (ally) => ally.hits < ally.hitsMax &&
                    ally.memory.role !== 'deposit-attack' &&
                    ally.memory.role !== 'deposit-heal'
            }) as Creep[]
        );
        const myCreeps = damagedAllies.filter((ally) => creep.pos.inRangeTo(ally, 3));
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

    const deposit = creep.pos.findClosestByRange(FIND_DEPOSITS);
    if (deposit && !creep.pos.inRangeTo(deposit, 5)) {
        creep.moveTo(deposit, { range: 5, ignoreCreeps: false });
    }
};

const depositAttack: CreepRoleHandler = {
    run: runDepositAttack
};

const depositHeal: CreepRoleHandler = {
    run: runDepositHeal
};

const depositRanged: CreepRoleHandler = {
    run: runDepositRanged
};

export { depositAttack, depositHeal, depositRanged };
