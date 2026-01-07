const deposit_attack = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
    
        // 等待绑定
        if(!creep.memory.bind) return;
    
        // 获取绑定的另一个creep
        const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
        if(!bindcreep) {
            delete creep.memory.bind;
            return;
        }
    
        // 移动到目标房间.未到达房间不继续行动
        if (creep.doubleMoveToRoom(creep.memory.targetRoom, '#ff0000')) return;
    
        let hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (c) => !Memory['whitelist'].includes(c.owner.username) &&
            c.body.some(part => part.type == ATTACK || part.type == RANGED_ATTACK || part.type == HEAL || part.type == WORK) &&
            (c.pos.findInRange(FIND_DEPOSITS, 5).length || c.pos.inRangeTo(creep, 3))
        });
    

        if (hostiles.length) {
            let hostile = creep.pos.findClosestByRange(hostiles);
            if (creep.pos.isNearTo(hostile)) {
                creep.attack(hostile);
            } else {
                creep.doubleMoveTo(hostile.pos, '#ff0000');
            }
        }
        // else {
        //     let healTarget = creep.pos.findClosestByRange(FIND_MY_CREEPS, {filter: (c) => c.hits < c.hitsMax});
        //     if (healTarget) {
        //         if (creep.pos.inRangeTo(healTarget, 1)) {
        //             if (bindcreep.pos.inRangeTo(healTarget, 1)) {
        //                 bindcreep.heal(healTarget);
        //             } else {
        //                 bindcreep.moveTo(healTarget.pos, {visualizePathStyle: {stroke: '#00ff00'}});
        //             }
        //         } else {
        //             creep.doubleMoveTo(healTarget.pos, '#ff0000');
        //         }
        //     }
        // }
    }
}

export default deposit_attack;