import { pickDefenseAnchorRampart } from '@/shared/defenseUtils';
import { tryBindNearestPartner } from '@/prototype/Creep/function/boundPartner';

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

    // 与 defend-single 保持一致的血量下限：内存候选缺省时按破防状态取 1e5/1e6
    const defenseMem = creep.room.memory['defenseRamparts'];
    const minHits = (defenseMem && defenseMem.minHits) ? defenseMem.minHits : (creep.room.memory['breached'] ? 1e5 : 1e6);
    const targetRampart = pickDefenseAnchorRampart(creep.room, 'melee', creep.name, minHits);
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
        creep.moveTo(bindcreep, {
            range: 1,
            costCallback: creep.room.getDefenseCreepCostCallback(creep.name)
        });
    }
};

const defend2AttackPrepare = (creep: Creep) => {
    return creep.ensureBoosted(creep.memory['boostmap']);
};

const defend2Attack = {
    prepare: defend2AttackPrepare,
    run: runDefend2Attack
};

export { defend2Attack };
