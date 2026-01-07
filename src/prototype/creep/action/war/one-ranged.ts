const one_ranged = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
    
        creep.heal(creep);
    
        if (!creep.memory.boosted) {
            const boost = ['XGHO2', 'GHO2', 'GO','XLHO2', 'LHO2', 'LO',
                            'XKHO2', 'KHO2', 'KO','XZHO2', 'ZHO2', 'ZO'];
            creep.memory.boosted = creep.goBoost(boost);
            return
        }
    
        if(creep.ticksToLive < 100 && creep.room.my) {
            creep.unboost();
            return;
        }
    
        let moveOK = false;
        let rangedOK = false;
    
        const name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
        const moveflag = Game.flags[name + '-move'];
        if(moveflag) {
            if(creep.room.name !== moveflag.pos.roomName) {
                creep.memory.targetRoom = moveflag.pos.roomName;
            }
            creep.moveTo(moveflag.pos, {visualizePathStyle: {stroke: '#00ff00'}})
            moveOK = true;
        }
    
        if (creep.room.name !== creep.memory.targetRoom && !moveOK) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }
    
        const creepTarget = creep.room.find(FIND_HOSTILE_CREEPS);
        const structureTarget = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return !structure.room.my &&
                structure.structureType !== STRUCTURE_CONTROLLER &&
                structure.structureType !== STRUCTURE_CONTAINER &&
                structure.structureType !== STRUCTURE_STORAGE &&
                structure.structureType !== STRUCTURE_TERMINAL &&
                structure.structureType !== STRUCTURE_WALL &&
                structure.structureType !== STRUCTURE_RAMPART &&
                structure.structureType !== STRUCTURE_ROAD;
            }
        });
    
        let target = creep.pos.findClosestByRange([...creepTarget, ...structureTarget]) as any;
        if (target) {
            if (!creep.pos.inRangeTo(target, 1) && !moveOK) {
                creep.moveTo(target);
            }
            if (!rangedOK && creep.room.lookForAtArea(LOOK_STRUCTURES,
                    Math.max(creep.pos.y - 3, 0), Math.max(creep.pos.x - 3, 0),
                    Math.min(creep.pos.y + 3, 49), Math.min(creep.pos.x + 3, 49), true).filter(
                        (s: any) => s.structure &&
                        s.structure.structureType === STRUCTURE_STORAGE || s.structure.structureType === STRUCTURE_TERMINAL
                    ).length == 0 &&
                [...creepTarget, ...structureTarget].filter((t: any) => t.pos.inRangeTo(creep, 2)).length >= 3) {
                creep.rangedMassAttack();
            }
            else if (!rangedOK && creep.pos.inRangeTo(target, 3)) {
                creep.rangedAttack(target);
            }
        }
    }
}

export default one_ranged;