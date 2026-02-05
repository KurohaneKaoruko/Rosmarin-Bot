/** 双人小队 防御小队 */
import { pickDefenseAnchorRampart } from '@/modules/utils/defenseUtils';

const double_defender = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        if (!creep.memory.boosted) {
            creep.memory.boosted = creep.goBoost({
                [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
                [ATTACK]: ['XUH2O', 'UH2O', 'UH'],
                [MOVE]: ['XZHO2', 'ZHO2', 'ZO']
            }, { must: true }) === OK;
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
    
        const costCallback = creep.room.getDefenseCreepCostCallback(creep.name);

        const mem = creep.room.memory['defenseRamparts'];
        const minHits = (mem && mem.minHits) ? mem.minHits : (creep.room.memory['breached'] ? 1e5 : 1e6);
        const anchor = pickDefenseAnchorRampart(creep.room, 'melee', creep.name, minHits);

        // 两人距离拉开时不要继续打/追：先合体，否则奶位容易“裸奔穿火线”被秒。
        if (!creep.pos.isNear(bindcreep.pos)) {
            creep.moveTo(bindcreep.pos, { range: 1, costCallback } as any);
            return;
        }

        const state = creep.room.memory['defenseState'];
        const hasRamparts = Array.isArray(creep.room[STRUCTURE_RAMPART]) && creep.room[STRUCTURE_RAMPART].length > 0;

        // 血线过低优先撤退：双人队的胜利条件是“活着持续输出”，不是换血硬拼。
        const needRetreat =
            creep.hits < creep.hitsMax * 0.55 ||
            bindcreep.hits < bindcreep.hitsMax * 0.55;
        if (needRetreat) {
            if (anchor) {
                creep.doubleMoveTo(anchor.pos, '#ffaa00', { range: 0, costCallback } as any);
            } else {
                creep.doubleFlee();
            }
            return;
        }
    
        const focusId = creep.room.memory['_towerFocus']?.id as Id<Creep | PowerCreep> | undefined;
        const focus = focusId ? (Game.getObjectById(focusId) as any) : null;

        const hostiles = creep.findHostileCreeps() as Creep[];
        const hostile = (focus && focus.pos?.roomName === creep.room.name ? focus : null) || creep.pos.findClosestByRange(hostiles);
        if (!hostile) return;

        // 未破口且有工事时：守点不追击，靠塔集火点杀。
        if (state !== 'breached' && hasRamparts && anchor) {
            if (!creep.pos.isEqualTo(anchor.pos)) {
                creep.doubleMoveTo(anchor.pos, '#ff0000', { range: 0, costCallback } as any);
                creep.room.CallTowerAttack(hostile);
                return;
            }
            creep.room.CallTowerAttack(hostile);
            if (creep.pos.inRangeTo(hostile, 1)) {
                creep.attack(hostile);
            }
            return;
        }

        // 破口/无工事时允许短追击，但不要离核心过远，避免被风筝送死。
        const corePos = creep.room.storage?.pos || new RoomPosition(25, 25, creep.room.name);
        if (hostile.pos.getRangeTo(corePos) > 16 && anchor) {
            creep.doubleMoveTo(anchor.pos, '#ffaa00', { range: 0, costCallback } as any);
            creep.room.CallTowerAttack(hostile);
            return;
        }

        creep.room.CallTowerAttack(hostile);
        if (creep.pos.inRangeTo(hostile, 1)) {
            creep.attack(hostile);
        } else {
            creep.doubleMoveTo(hostile.pos, '#ff0000', { range: 1, costCallback } as any);
        }
    }
}

export default double_defender
