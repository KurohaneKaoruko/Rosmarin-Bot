const deposit_heal = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
    
        let healed = false;
    
        if(!creep.memory.bind) {
            const squadCreeps = creep.room.find(FIND_MY_CREEPS,
                {filter: (c) => c.memory.role == 'deposit-attack' && !c.memory.bind});
            if(squadCreeps.length) {
                const squadCreep = creep.pos.findClosestByRange(squadCreeps);
                creep.memory.bind = squadCreep.id;
                squadCreep.memory.bind = creep.id;
            }
        }
    
        if(creep.hits < creep.hitsMax) {
            creep.heal(creep);
            healed = true;
        }
    
        const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
    
        if(!bindcreep) {
            delete creep.memory.bind;
            return;
        }
    
        if(bindcreep && !healed) {
            if (creep.pos.isNearTo(bindcreep)) {
                creep.heal(bindcreep);
                healed = true;
            } else if (creep.pos.inRangeTo(bindcreep, 3)) {
                creep.rangedHeal(bindcreep);
                creep.moveTo(bindcreep);
                healed = true;
            } else {
                creep.moveTo(bindcreep);
            }
        }
    }
}

export default deposit_heal;