const power_heal = {
    run: function(creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }

        if(!creep.memory.boosted) {
            const boostLevel = creep.memory['boostLevel'];
            if (boostLevel == 1) {
                creep.memory.boosted = creep.goBoost(['LO'], true, true);
            } else {
                creep.memory.boosted = true;
            }
            return;
        }

        if(!creep.memory.bind) {
            const attackCreep = creep.room.find(FIND_MY_CREEPS,
                {filter: (c) => c.memory.role == 'power-attack' && !c.memory.bind &&
                                c.memory.targetRoom == creep.memory.targetRoom});
            if (attackCreep.length > 0) {
                creep.memory.bind = attackCreep[0].id;
                attackCreep[0].memory.bind = creep.id;
            }
            return;
        }

        const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
        if (!bindcreep) { creep.suicide(); return; }

        let healed = false;
        
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
        } else creep.moveTo(bindcreep);

        return false;
    }
}

export default power_heal;