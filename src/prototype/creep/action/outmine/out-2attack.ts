/** 双人小队 进攻小队 */
const out_double_attack = {
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
        
        const enemies = creep.room.findEnemyCreeps()
            .filter((enemy) => 
                (enemy.getActiveBodyparts(ATTACK) > 0 ||
                enemy.getActiveBodyparts(RANGED_ATTACK) > 0 ||
                enemy.getActiveBodyparts(HEAL) > 0) &&
                enemy.owner.username !== 'Source Keeper'
            )

        if (enemies.length > 0) {
            const targetEnemy = creep.pos.findClosestByRange(enemies);
            if(creep.pos.inRangeTo(targetEnemy, 1)) {
                creep.rangedMassAttack();
                creep.attack(targetEnemy);
            } else {
                if (creep.pos.inRangeTo(targetEnemy, 3)) {
                    creep.rangedAttack(targetEnemy);
                }
                creep.doubleMoveTo(targetEnemy.pos, '#ff0000', { maxRoom: 1});
            }
        } else {
            if (creep.pos.x < 5 || creep.pos.x > 45 || creep.pos.y < 5 || creep.pos.y > 45) {
                creep.doubleMoveTo(new RoomPosition(25, 25, creep.room.name), '#ff0000')
            }
        }
    }
}

export default out_double_attack