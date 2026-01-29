/** 双人小队 heal */
const double_heal = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        if(!creep.memory.boosted) {
            if (creep.memory['boostmap']) {
                let result = creep.goBoost(creep.memory['boostmap']);
                if (result === OK) {
                    creep.memory.boosted = true;
                }
            } else {
                creep.memory.boosted = creep.goBoost({
                    [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
                    [HEAL]: ['XLHO2', 'LHO2', 'LO'],
                    [MOVE]: ['XZHO2', 'ZHO2', 'ZO']
                }, { must: true }) === OK;
            }
            return;
        }
        
        if(creep.ticksToLive < 100 && creep.room.my) {
            creep.unBoost();
            return;
        }
    
        let healed = false;
    
        if(!creep.memory.bind) {
            const attackCreep = creep.room.find(FIND_MY_CREEPS,
                {filter: (c) => c.memory.role == 'defend-2attack' && !c.memory.bind});
            if (attackCreep.length > 0) {
                creep.memory.bind = attackCreep[0].id;
                attackCreep[0].memory.bind = creep.id;
            }
            return;
        }
    
        const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
    
        if(!bindcreep) {
            delete creep.memory.bind;
            return;
        }

        creep.memory.dontPullMe = !creep.room.my;

        if ((creep.hits < creep.hitsMax) &&
            (creep.hits < bindcreep.hits)) {
            creep.heal(creep);
            healed = true;
        }
    
        if(healed) return;

        if (creep.pos.isNearTo(bindcreep)) {
            creep.heal(bindcreep);
        } else if (creep.pos.inRangeTo(bindcreep, 3)) {
            creep.rangedHeal(bindcreep);
            creep.moveTo(bindcreep);
        } else creep.moveTo(bindcreep);
    }
}

export default double_heal
