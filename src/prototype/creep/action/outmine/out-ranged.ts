import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';

const outRanged = {
    run: function (creep: Creep) {
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }
    
        let hostileCreeps = creep.room.findEnemyCreeps();

        if(creep.hits < creep.hitsMax) creep.heal(creep);

        if (hostileCreeps.length > 0) {
            let target = creep.pos.findClosestByRange(hostileCreeps);
            if (target) {
                if (creep.pos.isNearTo(target)) {
                    creep.rangedMassAttack();
                } else if (creep.pos.inRangeTo(target, 3)) {
                    creep.rangedAttack(target);
                    creep.moveTo(target);
                } else {
                    creep.moveTo(target);
                }
            }
        } else {
            const myCreeps = getRoomTickCacheValue(creep.room, 'out_ranged_injured_mine', () =>
                creep.room.find(FIND_MY_CREEPS, {
                    filter: (c) => c.hits < c.hitsMax
                }) as Creep[]
            );

            const injuredCreeps = myCreeps.filter((c) => c.hits < c.hitsMax);
            if (injuredCreeps.length > 0) {
                let target = creep.pos.findClosestByRange(injuredCreeps);
                if (target) {
                    if (creep.pos.isNearTo(target)) {
                        creep.heal(target);
                    } else {
                        creep.moveTo(target);
                    }
                }
            }
        }
    }
}

export default outRanged;
