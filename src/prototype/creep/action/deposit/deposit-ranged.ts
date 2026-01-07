const deposit_ranged = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            if(creep.hits < creep.hitsMax) creep.heal(creep);
            return;
        }

        let healOK = false;
        let rangedOK = false;
        let moveOK = false;

        if (creep.hits < creep.hitsMax) {
            creep.heal(creep);
            healOK = true;
        }

        const hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: (c) => !Memory['whitelist'].includes(c.owner.username) &&
                c.body.some(part => part.type == ATTACK || part.type == RANGED_ATTACK ||
                    part.type == HEAL || part.type == WORK || part.type == CARRY) &&
                (c.pos.inRangeTo(creep, 3) || c.pos.findInRange(FIND_DEPOSITS, 5).length)
            });

        if (hostileCreeps.length > 0) {
            const healer = hostileCreeps.find(c => c.body.some(p => p.type == HEAL));
            const attacker = hostileCreeps.find(c => c.body.some(p => p.type == ATTACK || p.type == RANGED_ATTACK));
            const target = healer || attacker;
            if(target && !creep.pos.inRangeTo(target, 1)) {
                creep.moveTo(target, {ignoreCreeps: false,range:1});
                moveOK = true;
            }
            const range3hostiles = hostileCreeps.filter(c => creep.pos.inRangeTo(c, 3));
            if (range3hostiles.length >= 10) {
                creep.rangedMassAttack();
                rangedOK = true;
            } else if (range3hostiles.filter(c => creep.pos.inRangeTo(c, 2)).length >= 3) {
                creep.rangedMassAttack();
                rangedOK = true;
            } else if (range3hostiles.filter(c => creep.pos.inRangeTo(c, 1)).length >= 1) {
                creep.rangedMassAttack();
                rangedOK = true;
            } else {
                const range3healer = range3hostiles.find(c => c.body.some(p => p.type == HEAL));
                const range3attacker = range3hostiles.find(c => c.body.some(p => p.type == ATTACK));
                const range3target = range3healer || range3attacker || range3hostiles[0];
                if(range3target) {
                    creep.rangedAttack(range3target);
                    rangedOK = true;
                }
            }
        }

        if (!healOK || !rangedOK || !moveOK) {
            const myCreeps = creep.room.find(FIND_MY_CREEPS, 
                {filter: (c) => c.hits < c.hitsMax &&
                creep.pos.inRangeTo(c, 3) && 
                c.memory.role !== 'deposit-attack' &&
                c.memory.role !== 'deposit-heal'});
            let healTarget = myCreeps.find(c => creep.pos.inRangeTo(c, 1));
            if (healTarget) {
                if(!healOK) creep.heal(healTarget);
            } else if (myCreeps.length > 0){
                let healTarget = creep.pos.findClosestByRange(myCreeps);
                if(!moveOK) creep.moveTo(healTarget,{ignoreCreeps: false});
                if(!rangedOK && creep.pos.isNearTo(healTarget)) creep.rangedHeal(healTarget);
            }
        }

        if (rangedOK || moveOK || healOK) return;

        const deposit = creep.pos.findClosestByRange(FIND_DEPOSITS);
        if (deposit) {
            if (!creep.pos.inRangeTo(deposit, 5)) {
                creep.moveTo(deposit, {range: 5, ignoreCreeps: false});
            }
        }



        // let hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
        //     filter: (c) => !Memory['whitelist'].includes(c.owner.username) &&
        //     c.body.some(part => part.type == ATTACK || part.type == RANGED_ATTACK ||
        //         part.type == HEAL || part.type == WORK || part.type == CARRY) &&
        //     (c.pos.inRangeTo(creep, 3) || c.pos.findInRange(FIND_DEPOSITS, 3).length)
        // });
    
        // if (hostiles.length) {
        //     let hostile = creep.pos.findClosestByRange(hostiles);
        //     if (creep.pos.isNearTo(hostile)) {
        //         creep.rangedMassAttack();
        //         creep.heal(creep);
        //     } else if (creep.pos.inRangeTo(hostile, 3)) {
        //         creep.rangedAttack(hostile);
        //         creep.heal(creep);
        //         creep.moveTo(hostile, { reusePath: 0, ignoreCreeps: false });
        //     } else {
        //         creep.moveTo(hostile, { reusePath: 0, ignoreCreeps: false });
        //     }
        // }
        // if (creep.hits < creep.hitsMax) {
        //     creep.heal(creep);
        // } else {
        //     let healTarget = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
        //         filter: (c) => c.hits < c.hitsMax && 
        //         c.memory.role !== 'deposit-attack' &&
        //         c.memory.role !== 'deposit-heal'
        //     });
        //     if (healTarget) {
        //         if (creep.pos.inRangeTo(healTarget, 1)) {
        //             creep.heal(healTarget);
        //         } else {
        //             creep.moveTo(healTarget, { ignoreCreeps: false });
        //         }
        //     } else {
        //         let deposit = creep.pos.findClosestByRange(FIND_DEPOSITS);
        //         if (!deposit) return;
        //         if (creep.pos.inRangeTo(deposit, 5)) {
        //             creep.harvest(deposit);
        //         } else {
        //             creep.moveTo(deposit, { range: 5, ignoreCreeps: false });
        //         }
        //     }
        // }
    }
}

export default deposit_ranged;