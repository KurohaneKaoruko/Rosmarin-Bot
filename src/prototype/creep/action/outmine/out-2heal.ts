/** 外矿防御 双人小队 heal */
const out_double_heal = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
    
        let healed = false;
    
        if(!creep.memory.bind) {
            const squadCreeps = creep.room.find(FIND_MY_CREEPS,
                {filter: (c) => c.memory.role == 'out-2attack' && !c.memory.bind});
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

        if (!healed && creep.pos.isNearTo(bindcreep)) {
            creep.heal(bindcreep);
        } else if (!healed && creep.pos.inRangeTo(bindcreep, 3)) {
            creep.rangedHeal(bindcreep);
            creep.moveTo(bindcreep);
        } else creep.moveTo(bindcreep);

        return;
    }
}

export default out_double_heal