/** 双人小队 heal */
const double_heal = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        if(!creep.memory.boosted) {
            if (creep.memory['boostmap']) {
                let result = creep.Boost(creep.memory['boostmap']);
                if (result === OK) {
                    creep.memory.boosted = true;
                }
            } else {
                creep.memory.boosted = creep.goBoost([
                    'XGHO2', 'GHO2', 'GO',
                    'XLHO2', 'LHO2', 'LO',
                    'XKHO2', 'KHO2', 'KO']
                );
            }
            return;
        }
        
        if(creep.ticksToLive < 100 && creep.room.my) {
            creep.unboost();
            return;
        }
    
        let healed = false;
    
        if(!creep.memory.bind) {
            const creeps = creep.room.find(FIND_MY_CREEPS,
                {filter: (c) => !c.memory.bind && c.memory.role != 'double-heal' &&
                                 c.memory.squad == creep.memory.squad });
            if(creeps.length) {
                const squadCreep = creep.pos.findClosestByRange(creeps);
                creep.memory.bind = squadCreep.id;
                squadCreep.memory.bind = creep.id;
            }
        }
    
        if(!creep.memory.bind) {
            if (creep.hits < creep.hitsMax) creep.heal(creep);
            let needHeal = creep.pos.findClosestByPath(FIND_MY_CREEPS,{
                filter: (creep: Creep) => creep.hitsMax-creep.hits>100
            });
            if(needHeal) {
                if (creep.pos.isNearTo(needHeal)) {
                    creep.heal(needHeal);
                } else if (creep.pos.inRangeTo(needHeal, 3)) {
                    creep.rangedHeal(needHeal);
                } if (!creep.pos.isNearTo(needHeal)) {
                    creep.moveTo(needHeal);
                }
            }
            return;
        };
    
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

        if (!healed && creep.pos.isNearTo(bindcreep)) {
            creep.heal(bindcreep);
        } else if (!healed && creep.pos.inRangeTo(bindcreep, 3)) {
            creep.rangedHeal(bindcreep);
            creep.moveTo(bindcreep);
        } else creep.moveTo(bindcreep);
    }
}

export default double_heal