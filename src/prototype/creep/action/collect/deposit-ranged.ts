import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';

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

        const combatHostiles = getRoomTickCacheValue(creep.room, 'deposit_ranged_combat_hostiles', () =>
            creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: (c) => !Memory['whitelist'].includes(c.owner.username) &&
                c.body.some(part => part.type == ATTACK || part.type == RANGED_ATTACK ||
                    part.type == HEAL || part.type == WORK || part.type == CARRY)
            }) as Creep[]
        );
        const deposits = getRoomTickCacheValue(creep.room, 'deposit_ranged_deposits', () =>
            creep.room.find(FIND_DEPOSITS) as Deposit[]
        );
        const hostileCreeps = combatHostiles.filter((c) =>
            c.pos.inRangeTo(creep, 3) || deposits.some((d) => d.pos.inRangeTo(c.pos, 5))
        );

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
            const damagedAllies = getRoomTickCacheValue(creep.room, 'deposit_ranged_damaged_allies', () =>
                creep.room.find(FIND_MY_CREEPS,
                    {filter: (c) => c.hits < c.hitsMax &&
                    c.memory.role !== 'deposit-attack' &&
                    c.memory.role !== 'deposit-heal'}) as Creep[]
            );
            const myCreeps = damagedAllies.filter((c) => creep.pos.inRangeTo(c, 3));
            let healTarget = myCreeps.find(c => creep.pos.inRangeTo(c, 1));
            if (healTarget) {
                if(!healOK) creep.heal(healTarget);
            } else if (myCreeps.length > 0){
                healTarget = creep.pos.findClosestByRange(myCreeps);
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
    }
}

export default deposit_ranged;

