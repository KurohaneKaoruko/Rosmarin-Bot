import { pickDefenseAnchorRampart } from '@/shared/defenseUtils';
import { getRoomTickCacheValue } from '@/shared/roomTickCache';

const resolveBoundPartner = (creep: Creep, onMissing?: () => void): Creep | null => {
    if (!creep.memory.bind) return null;
    const partner = Game.getObjectById(creep.memory.bind as Id<Creep>);
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

const getDefend2AttackBoost = () => ({
    [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
    [ATTACK]: ['XUH2O', 'UH2O', 'UH'],
    [MOVE]: ['XZHO2', 'ZHO2', 'ZO']
});

const defend2HealPrepare = (creep: Creep) => {
    if (creep.memory.boosted) return true;
    if (creep.memory['boostmap']) {
        const result = creep.goBoost(creep.memory['boostmap']);
        if (result === OK) {
            creep.memory.boosted = true;
            return true;
        }
        return false;
    }

    const result = creep.goBoost({
        [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
        [HEAL]: ['XLHO2', 'LHO2', 'LO'],
        [MOVE]: ['XZHO2', 'ZHO2', 'ZO'],
    });
    if (result === OK) {
        creep.memory.boosted = true;
        return true;
    }
    return false;
};

const runDefend2Heal = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    if (creep.ticksToLive < 100 && creep.room.my) {
        creep.unBoost();
        return;
    }

    const bindcreep = tryBindNearestPartner(creep, 'defend2_heal_candidates', (candidate) =>
        candidate.memory.role === 'defend2-attack'
    );

    if (!bindcreep) {
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        return;
    }

    creep.memory.dontPullMe = !creep.room.my;

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
    } else {
        creep.moveTo(bindcreep);
    }
};

const runDefend2Attack = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    if (creep.ticksToLive < 100 && creep.room.my) {
        creep.unBoost();
        return;
    }

    const bindcreep = tryBindNearestPartner(creep, 'defend2_attack_candidates', (candidate) =>
        candidate.memory.role === 'defend2-heal'
    );

    if (!bindcreep) return;

    creep.memory.dontPullMe = !creep.room.my;

    const hostileCreeps = creep.findHostileCreeps() as Creep[];
    if (hostileCreeps.length === 0) return;

    const targetRampart = pickDefenseAnchorRampart(creep.room, 'melee', creep.name);
    if (targetRampart && !creep.pos.isEqualTo(targetRampart.pos)) {
        const costCallback = creep.room.getDefenseCreepCostCallback(creep.name);
        creep.moveTo(targetRampart.pos, {
            visualizePathStyle: { stroke: '#ff0000' },
            range: 0,
            costCallback
        });
        const movingTarget = creep.pos.findClosestByRange(hostileCreeps);
        if (movingTarget) creep.room.CallTowerAttack(movingTarget);
        return;
    }

    const focusId = creep.room.memory['_towerFocus']?.id as Id<Creep | PowerCreep> | undefined;
    const focus = focusId ? Game.getObjectById(focusId) : null;
    const target = (focus && focus.pos?.roomName === creep.room.name ? focus : null) || creep.pos.findClosestByRange(hostileCreeps);
    if (!target) return;

    if (creep.pos.isNearTo(target)) {
        const result = creep.attack(target);
        if (result === OK) creep.room.CallTowerAttack(target);
        return;
    }

    const state = creep.room.memory['defenseState'];
    const hasRamparts = Array.isArray(creep.room[STRUCTURE_RAMPART]) && creep.room[STRUCTURE_RAMPART].length > 0;
    if (state === 'breached' || !hasRamparts) {
        creep.moveTo(target, {
            visualizePathStyle: { stroke: '#ff0000' },
            range: 1,
            costCallback: creep.room.getDefenseCreepCostCallback(creep.name)
        });
        creep.room.CallTowerAttack(target);
        return;
    }

    creep.room.CallTowerAttack(target);

    if (!creep.pos.isNearTo(bindcreep)) {
        creep.moveTo(bindcreep, { range: 1, costCallback } as any);
    }
};

const defend2AttackPrepare = (creep: Creep) => {
    if (creep.memory.boosted) return true;
    if (creep.memory['boostmap']) {
        const result = creep.goBoost(creep.memory['boostmap']);
        if (result === OK) {
            creep.memory.boosted = true;
            return true;
        }
        return false;
    }

    const result = creep.goBoost(getDefend2AttackBoost());
    if (result === OK) {
        creep.memory.boosted = true;
        return true;
    }
    return false;
};

const defend2Attack = {
    prepare: defend2AttackPrepare,
    run: runDefend2Attack
};

const defend2Heal = {
    prepare: defend2HealPrepare,
    run: runDefend2Heal
};

export { defend2Attack, defend2Heal };
