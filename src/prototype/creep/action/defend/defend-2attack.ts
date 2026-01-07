
/** 双人小队 防御小队 */
const double_defender = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        if (!creep.memory.boosted) {
            const boosts = ['XGHO2', 'GHO2', 'GO', 'XUH2O', 'UH2O', 'UH', 'XZHO2', 'ZHO2', 'ZO'];
            creep.memory.boosted = creep.goBoost(boosts);
            return
        }
    
        // 等待绑定
        if(!creep.memory.bind) return;
    
        // 获取绑定的另一个creep
        const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
        if(!bindcreep) {
            delete creep.memory.bind;
            return;
        }
    
        if(!bindcreep.memory.boosted) return;
    
        // 如果heal不在身边，让它过来
        if (!creep.pos.isNear(bindcreep.pos)) {
            bindcreep.moveTo(creep.pos);
            return;
        }
    
        // 攻击敌人
        let Hostiles = (global.Hostiles?.[creep.room.name] || [])
                        .map((id: Id<Creep>) => Game.getObjectById(id))
                        .filter((c: Creep) => c) as Creep[];
        if(Hostiles.length > 0) {
            const hostile = creep.pos.findClosestByRange(Hostiles);
            if(creep.pos.inRangeTo(hostile, 1)) {
                creep.attack(hostile);
            } else {
                creep.doubleMoveTo(hostile.pos, '#ff0000');
            }
        }
    }
}

export default double_defender