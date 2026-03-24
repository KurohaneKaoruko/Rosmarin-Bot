import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, selector, hotSwap, fail } from '@/framework/ai/behaviorTree';
/** 双人小队 heal */
type WarCtx = { creep: Creep };

// 行为树注册表：支持双人治疗逻辑热插拔
export const doubleHealRegistry = new BehaviorTreeRegistry<WarCtx>();

const runLegacy = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();
    if (!creep.memory.boosted) {
        if (creep.memory['boostmap']) {
            const result = creep.goBoost(creep.memory['boostmap']);
            if (result === OK) {
                creep.memory.boosted = true;
            }
        } else {
            creep.memory.boosted = creep.goBoost({
                [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
                [HEAL]: ['XLHO2', 'LHO2', 'LO'],
                [RANGED_ATTACK]: ['XKHO2', 'KHO2', 'KO'],
            }) === OK;
        }
        return;
    }

    if (creep.ticksToLive < 100 && creep.room.my) {
        creep.unBoost();
        return;
    }

    let healed = false;

    if (!creep.memory.bind) {
        const roleCreeps = getRoomTickCacheValue(creep.room, 'double_heal_squad_candidates', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (myCreep) =>
                    myCreep.memory.role != 'double-heal' &&
                    myCreep.memory.squad == creep.memory.squad
            }) as Creep[]
        );
        const creeps = roleCreeps.filter((myCreep) => !myCreep.memory.bind);
        if (creeps.length) {
            const squadCreep = creep.pos.findClosestByRange(creeps);
            creep.memory.bind = squadCreep.id;
            squadCreep.memory.bind = creep.id;
        }
    }

    if (!creep.memory.bind) {
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        const needHealTargets = getRoomTickCacheValue(creep.room, 'double_heal_need_targets', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (myCreep: Creep) => myCreep.hitsMax - myCreep.hits > 100
            }) as Creep[]
        );
        const needHeal = creep.pos.findClosestByPath(needHealTargets);
        if (needHeal) {
            if (creep.pos.isNearTo(needHeal)) {
                creep.heal(needHeal);
            } else if (creep.pos.inRangeTo(needHeal, 3)) {
                creep.rangedHeal(needHeal);
            }
            if (!creep.pos.isNearTo(needHeal)) {
                creep.moveTo(needHeal);
            }
        }
        return;
    }

    const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
    if (!bindcreep) {
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
    } else {
        creep.moveTo(bindcreep);
    }
};

const tree = new BehaviorTree<WarCtx>(
    selector(
        hotSwap(doubleHealRegistry, 'root', fail()),
        leaf<WarCtx>(({ creep }) => {
            runLegacy(creep);
            return BtStatus.Running;
        })
    )
);

const double_heal = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
}

export default double_heal
