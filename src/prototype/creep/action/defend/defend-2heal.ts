/** 双人小队 heal */
import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';

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
            const attackCreeps = getRoomTickCacheValue(creep.room, 'defend_2heal_attack_creeps', () =>
                creep.room.find(FIND_MY_CREEPS, {
                    filter: (c) => c.memory.role == 'defend-2attack'
                }) as Creep[]
            );
            const attackCreep = attackCreeps.find((c) => !c.memory.bind);
            if (attackCreep) {
                creep.memory.bind = attackCreep.id;
                attackCreep.memory.bind = creep.id;
            }
            return;
        }
    
        const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
    
        if(!bindcreep) {
            delete creep.memory.bind;
            return;
        }
        if (!bindcreep.memory.boosted) return;

        // 非己方房间不允许被 pull：避免在外矿/敌房被拖拽导致路径混乱与卡边。
        creep.memory.dontPullMe = !creep.room.my;

        const costCallback = creep.room.getDefenseCreepCostCallback(creep.name);

        const needSelfCritical = creep.hits < creep.hitsMax * 0.35;
        const needRetreat =
            creep.hits < creep.hitsMax * 0.55 ||
            bindcreep.hits < bindcreep.hitsMax * 0.55;

        // 濒死优先自救并拉开距离：否则治疗位倒下会导致整队必死。
        if (needSelfCritical && creep.hits < creep.hitsMax) {
            creep.heal(creep);
            healed = true;
            if (creep.pos.isNearTo(bindcreep)) {
                creep.doubleFlee();
            } else {
                creep.moveTo(bindcreep, { range: 1, costCallback } as any);
            }
            return;
        }

        const shouldSaveBind =
            bindcreep.hits < bindcreep.hitsMax &&
            (bindcreep.hits < bindcreep.hitsMax * 0.75 || bindcreep.hits < creep.hits);

        // 高压时撤退由奶位触发也可以：双人移动会 pull，同步拉回安全区。
        if (needRetreat && creep.pos.isNearTo(bindcreep)) {
            if (shouldSaveBind) creep.heal(bindcreep);
            else if (creep.hits < creep.hitsMax) creep.heal(creep);
            creep.doubleFlee();
            return;
        }

        if (shouldSaveBind) {
            if (creep.pos.isNearTo(bindcreep)) {
                creep.heal(bindcreep);
                healed = true;
            } else if (creep.pos.inRangeTo(bindcreep, 3)) {
                creep.rangedHeal(bindcreep);
                healed = true;
            }
        } else if (creep.hits < creep.hitsMax) {
            creep.heal(creep);
            healed = true;
        }

        // 治疗位只负责安全跟随：不要为了“赶路”单独穿火线贴攻击位。
        if (!creep.pos.isNearTo(bindcreep)) {
            creep.moveTo(bindcreep, { range: 1, costCallback } as any);
            return;
        }
    }
}

export default double_heal
