import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep
type PowerRangedContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<PowerRangedContext>();

const POWER_RANGED_BT_SLOTS = {
    MAIN: 'main'
} as const;

// 复用原远程逻辑
const runLegacy = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();
    if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(creep.memory.targetRoom);
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        return;
    }

    let healOK = false;
    let rangedOK = false;
    let moveOK = false;

    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
        healOK = true;
    }

    const roomCombatHostiles = getRoomTickCacheValue(creep.room, 'power_ranged_combat_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (c) =>
                c.body.some((p) => p.type == HEAL || p.type == ATTACK || p.type == RANGED_ATTACK)
        }) as Creep[]
    );
    const hostileCreeps = roomCombatHostiles.filter((c) => creep.pos.inRangeTo(c, 8));
    if (hostileCreeps.length > 0) {
        const healer = hostileCreeps.find(c => c.body.some(p => p.type == HEAL));
        const attacker = hostileCreeps.find(c => c.body.some(p => p.type == ATTACK));
        const target = healer || attacker;
        if (target && !creep.pos.inRangeTo(target, 1)) {
            creep.moveTo(target, { ignoreCreeps: false, range: 1 });
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
            if (range3target) {
                creep.rangedAttack(range3target);
                rangedOK = true;
            }
        }
    }

    if (!healOK || !rangedOK || !moveOK) {
        const injuredMyCreeps = getRoomTickCacheValue(creep.room, 'power_ranged_injured_mine', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.hits < c.hitsMax
            }) as Creep[]
        );
        const myCreeps = injuredMyCreeps.filter((c) =>
            c.hits < c.hitsMax && (creep.pos.inRangeTo(c, 3) || c.memory.role == 'power-ranged')
        );
        let healTarget = myCreeps.find(c => creep.pos.inRangeTo(c, 1));
        if (healTarget) {
            if (!healOK) creep.heal(healTarget);
        } else if (myCreeps.length > 0) {
            healTarget = creep.pos.findClosestByRange(myCreeps);
            if (!moveOK) creep.moveTo(healTarget, { ignoreCreeps: false });
            if (!rangedOK && creep.pos.isNearTo(healTarget)) creep.rangedHeal(healTarget);
        }
    }

    if (rangedOK || moveOK || healOK) return;

    let powerBank = creep.room.powerBank?.[0];
    if (!powerBank) {
        creep.room.update(STRUCTURE_POWER_BANK);
        powerBank = creep.room.powerBank?.[0];
    }
    if (powerBank) {
        if (creep.pos.inRangeTo(powerBank, 3)) {
            creep.rangedAttack(powerBank);
            creep.heal(creep);
        } else {
            creep.moveTo(powerBank, { range: 3, ignoreCreeps: false });
        }
        return;
    }

    if (Game.time % 10 == 0) {
        creep.suicide();
    }
};

const mainNode = leaf<PowerRangedContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, POWER_RANGED_BT_SLOTS.MAIN, mainNode)
    )
);

const power_ranged = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default power_ranged;
