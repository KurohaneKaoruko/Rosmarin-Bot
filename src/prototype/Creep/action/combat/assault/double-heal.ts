import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { createBoostedRole } from '@/framework/ai/creepRole';
/** 双人小队 heal */

const runLegacy = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    if (creep.ticksToLive < 100 && creep.room.my) {
        creep.unBoost();
        return;
    }

    let healed = false;

    if (!creep.memory.bind) {
        const roleCreeps = getRoomTickCacheValue(creep.room, 'double_heal_squad_candidates', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (myCreep) =>
                    myCreep.memory.role != 'double-heal' &&
                    myCreep.memory.squad == creep.memory.squad
            }) as Creep[]
        );
        const creeps = roleCreeps.filter((myCreep) => !myCreep.memory.bind);
        if (creeps.length) {
            const squadCreep = creep.pos.findClosestByRange(creeps);
            creep.memory.bind = squadCreep.id;
            squadCreep.memory.bind = creep.id;
        }
    }

    if (!creep.memory.bind) {
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        const needHealTargets = getRoomTickCacheValue(creep.room, 'double_heal_need_targets', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (myCreep: Creep) => myCreep.hitsMax - myCreep.hits > 100
            }) as Creep[]
        );
        const needHeal = creep.pos.findClosestByPath(needHealTargets);
        if (needHeal) {
            if (creep.pos.isNearTo(needHeal)) {
                creep.heal(needHeal);
            } else if (creep.pos.inRangeTo(needHeal, 3)) {
                creep.rangedHeal(needHeal);
            }
            if (!creep.pos.isNearTo(needHeal)) {
                creep.moveTo(needHeal);
            }
        }
        return;
    }

    const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
    if (!bindcreep) {
        delete creep.memory.bind;
        return;
    }

    creep.memory.dontPullMe = !creep.room.my;

    if ((creep.hits < creep.hitsMax) &&
        (creep.hits < bindcreep.hits)) {
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

const double_heal = createBoostedRole({
    boost: (creep) => creep.memory['boostmap'] || {
        [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
        [HEAL]: ['XLHO2', 'LHO2', 'LO'],
        [RANGED_ATTACK]: ['XKHO2', 'KHO2', 'KO'],
    },
    run: runLegacy
})

export default double_heal
