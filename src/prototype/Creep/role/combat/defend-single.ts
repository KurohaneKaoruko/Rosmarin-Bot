import {
    isDefenseRampartLockActive,
    isDefenseRampartValid,
    isPosOccupiedByOtherCreep,
    pickDefenseAnchorRampart,
    scoreRampart,
    shouldSwitchDefenseRampart
} from '@/modules/shared/defenseUtils';

const DEFENSE_RAMPART_LOCK_TTL = 25;
const DEFEND_ATTACK_SWITCH_THRESHOLD = 2;
const DEFEND_RANGED_SWITCH_THRESHOLD = 0.6;

type DefenseMode = 'melee' | 'ranged';

const clearDefenseRampartLock = (creep: Creep) => {
    delete creep.memory['defenseRampartId'];
    delete creep.memory['defenseRampartLockUntil'];
    creep.memory['defenseRampartBlockedTicks'] = 0;
};

const lockDefenseRampart = (creep: Creep, rampart: StructureRampart) => {
    creep.memory['defenseRampartId'] = rampart.id;
    creep.memory['defenseRampartLockUntil'] = Game.time + DEFENSE_RAMPART_LOCK_TTL;
    creep.memory['defenseRampartBlockedTicks'] = 0;
};

const selectDefenseRampart = (
    creep: Creep,
    hostileCreeps: Creep[],
    mode: DefenseMode,
    switchThreshold: number
): StructureRampart | null => {
    const mem = creep.room.memory['defenseRamparts'];
    const minHits = (mem && mem.minHits) ? mem.minHits : (creep.room.memory['breached'] ? 1e5 : 1e6);
    let targetRampart: StructureRampart | null = null;

    const lockUntil = creep.memory['defenseRampartLockUntil'] as number | undefined;
    const lockActive = isDefenseRampartLockActive(lockUntil);
    const lockedRampartId = creep.memory['defenseRampartId'] as Id<StructureRampart> | undefined;

    if (lockActive && lockedRampartId) {
        const rampart = Game.getObjectById(lockedRampartId);
        if (rampart && isDefenseRampartValid(creep.room, rampart, minHits)) {
            if (creep.pos.isEqualTo(rampart.pos) || !isPosOccupiedByOtherCreep(creep.room, rampart.pos, creep.name)) {
                targetRampart = rampart;
            } else {
                creep.memory['defenseRampartBlockedTicks'] = ((creep.memory['defenseRampartBlockedTicks'] as number) || 0) + 1;
                clearDefenseRampartLock(creep);
            }
        } else {
            clearDefenseRampartLock(creep);
        }
    }

    if (!targetRampart) {
        targetRampart = pickDefenseAnchorRampart(creep.room, mode, creep.name, minHits);
    }

    if (!targetRampart) {
        const ramparts = creep.room.rampart.filter((rampart) => {
            if (!isDefenseRampartValid(creep.room, rampart, minHits)) return false;
            if (!creep.pos.isEqualTo(rampart.pos) && isPosOccupiedByOtherCreep(creep.room, rampart.pos, creep.name)) return false;
            return true;
        });

        let best: StructureRampart | null = null;
        let bestScore = -Infinity;
        for (const rampart of ramparts) {
            const score = scoreRampart(rampart.pos, hostileCreeps as any, mode);
            if (score > bestScore) {
                bestScore = score;
                best = rampart;
            }
        }

        const currentId = creep.memory['defenseRampartId'] as Id<StructureRampart> | undefined;
        const current = currentId ? Game.getObjectById(currentId) : null;
        if (current && isDefenseRampartValid(creep.room, current, minHits)) {
            if (creep.pos.isEqualTo(current.pos)) {
                targetRampart = current;
            } else if (best) {
                const currentScore = scoreRampart(current.pos, hostileCreeps as any, mode);
                targetRampart = shouldSwitchDefenseRampart(currentScore, bestScore, switchThreshold) ? best : current;
            } else {
                targetRampart = current;
            }
        } else {
            targetRampart = best;
        }
    }

    if (targetRampart && creep.memory['defenseRampartId'] !== targetRampart.id) {
        lockDefenseRampart(creep, targetRampart);
    }

    return targetRampart;
};

const runDefendAttack = (creep: Creep) => {
    const hostileCreeps = creep.findHostileCreeps() as Creep[];
    if (hostileCreeps.length === 0) return;

    const targetRampart = selectDefenseRampart(creep, hostileCreeps, 'melee', DEFEND_ATTACK_SWITCH_THRESHOLD);
    if (targetRampart && !creep.pos.isEqualTo(targetRampart.pos)) {
        creep.moveTo(targetRampart.pos, {
            visualizePathStyle: { stroke: '#ff0000' },
            range: 0,
            costCallback: creep.room.getDefenseCreepCostCallback(creep.name)
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
        clearDefenseRampartLock(creep);
        creep.moveTo(target, {
            visualizePathStyle: { stroke: '#ff0000' },
            range: 1,
            costCallback: creep.room.getDefenseCreepCostCallback(creep.name)
        });
        creep.room.CallTowerAttack(target);
        return;
    }

    creep.room.CallTowerAttack(target);
};

const runDefendRanged = (creep: Creep) => {
    const hostileCreeps = creep.findHostileCreeps() as Creep[];
    if (hostileCreeps.length === 0) return;

    const targetRampart = selectDefenseRampart(creep, hostileCreeps, 'ranged', DEFEND_RANGED_SWITCH_THRESHOLD);
    if (targetRampart && !creep.pos.isEqualTo(targetRampart.pos)) {
        creep.moveTo(targetRampart.pos, {
            visualizePathStyle: { stroke: '#ff0000' },
            range: 0,
            costCallback: creep.room.getDefenseCreepCostCallback(creep.name)
        });
        const movingTarget = creep.pos.findClosestByRange(hostileCreeps);
        if (movingTarget) creep.room.CallTowerAttack(movingTarget);
        return;
    }

    const focusId = creep.room.memory['_towerFocus']?.id as Id<Creep | PowerCreep> | undefined;
    const focus = focusId ? Game.getObjectById(focusId) : null;
    const target = (focus && focus.pos?.roomName === creep.room.name ? focus : null) || creep.pos.findClosestByRange(hostileCreeps);
    if (!target) return;

    const range = creep.pos.getRangeTo(target);
    if (range > 3) {
        const state = creep.room.memory['defenseState'];
        const hasRamparts = Array.isArray(creep.room[STRUCTURE_RAMPART]) && creep.room[STRUCTURE_RAMPART].length > 0;
        if (state === 'breached' || !hasRamparts) {
            clearDefenseRampartLock(creep);
            creep.moveTo(target, {
                visualizePathStyle: { stroke: '#ff0000' },
                range: 1,
                costCallback: creep.room.getDefenseCreepCostCallback(creep.name)
            });
            creep.room.CallTowerAttack(target);
            return;
        }
    }

    if (range <= 3) {
        if (
            range <= 2 &&
            creep.hits < creep.hitsMax * 0.6 &&
            !creep.pos.lookFor(LOOK_STRUCTURES).some((structure) => structure.structureType === STRUCTURE_RAMPART)
        ) {
            if (creep.fleeFromHostiles(4)) return;
        }
        const result = creep.rangedAttack(target);
        if (result === OK) creep.room.CallTowerAttack(target);
    }
};

const getDefendAttackBoost = (creep: Creep) => {
    const must = !!creep.memory['mustBoost'];
    return {
        must,
        boostmap: must ? {
            [ATTACK]: ['XUH2O'],
            [MOVE]: ['XZHO2'],
        } : {
            [ATTACK]: ['XUH2O', 'UH2O', 'UH'],
            [MOVE]: ['XZHO2', 'ZHO2', 'ZO'],
        }
    };
};

const getDefendRangedBoost = (creep: Creep) => {
    const must = !!creep.memory['mustBoost'];
    return {
        must,
        boostmap: must ? {
            [RANGED_ATTACK]: ['XKHO2'],
            [MOVE]: ['XZHO2'],
        } : {
            [RANGED_ATTACK]: ['XKHO2', 'KHO2', 'KO'],
            [MOVE]: ['XZHO2', 'ZHO2', 'ZO'],
        }
    };
};

const defendAttack = {
    prepare: (creep) => {
        if (creep.memory.boosted) return true;
        const { must, boostmap } = getDefendAttackBoost(creep);
        if (!boostmap || Object.keys(boostmap).length === 0) {
            creep.memory.boosted = true;
            return true;
        }
        const result = creep.goBoost(boostmap, { must });
        const ok = result === OK;
        if (ok) creep.memory.boosted = true;
        return ok;
    },
    run: runDefendAttack
};

const defendRanged = {
    prepare: (creep) => {
        if (creep.memory.boosted) return true;
        const { must, boostmap } = getDefendRangedBoost(creep);
        if (!boostmap || Object.keys(boostmap).length === 0) {
            creep.memory.boosted = true;
            return true;
        }
        const result = creep.goBoost(boostmap, { must });
        const ok = result === OK;
        if (ok) creep.memory.boosted = true;
        return ok;
    },
    run: runDefendRanged
};

export { defendAttack, defendRanged };
