import { pickDefenseAnchorRampart } from '@/shared/defenseUtils';
import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, selector, sequence, hotSwap, fail } from '@/framework/ai/behaviorTree';

type DefendCtx = { creep: Creep };

const resolveBoundPartner = (creep: Creep, onMissing?: () => void): Creep | null => {
    if (!creep.memory.bind) return null;

    const partner = Game.getObjectById(creep.memory.bind as Id<Creep>) as Creep | null;
    if (partner) return partner;

    delete creep.memory.bind;
    onMissing?.();
    return null;
};

const tryBindNearestPartner = (
    creep: Creep,
    cacheKey: string,
    filter: (candidate: Creep) => boolean
): Creep | null => {
    const boundPartner = resolveBoundPartner(creep);
    if (boundPartner) return boundPartner;

    const candidates = getRoomTickCacheValue(creep.room, cacheKey, () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (candidate) => candidate.id !== creep.id && filter(candidate as Creep)
        }) as Creep[]
    );
    const available = candidates.filter((candidate) => !candidate.memory.bind);
    if (available.length <= 0) return null;

    const partner = creep.pos.findClosestByRange(available);
    if (!partner) return null;

    creep.memory.bind = partner.id;
    partner.memory.bind = creep.id;
    return partner;
};

const createDefenseRole = (
    registry: BehaviorTreeRegistry<DefendCtx>,
    ensureBoost: any,
    runDefense: (creep: Creep) => void
) => {
    const runNode = leaf<DefendCtx>(({ creep }) => {
        runDefense(creep);
        return BtStatus.Running;
    });
    const tree = new BehaviorTree<DefendCtx>(
        selector(
            hotSwap(registry, 'root', fail()),
            sequence(ensureBoost, runNode)
        )
    );

    return {
        run(creep: Creep) {
            tree.tick({ creep });
        }
    };
};

const ensureDoubleAttackBoost = leaf<DefendCtx>(({ creep }) => {
    if (creep.memory.boosted) return BtStatus.Success;
    const ok = creep.goBoost({
        [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
        [ATTACK]: ['XUH2O', 'UH2O', 'UH'],
        [MOVE]: ['XZHO2', 'ZHO2', 'ZO']
    }, { must: true }) === OK;
    if (ok) creep.memory.boosted = true;
    return ok ? BtStatus.Success : BtStatus.Running;
});

const ensureDoubleHealBoost = leaf<DefendCtx>(({ creep }) => {
    if (creep.memory.boosted) return BtStatus.Success;
    if (creep.memory['boostmap']) {
        const result = creep.goBoost(creep.memory['boostmap']);
        if (result === OK) {
            creep.memory.boosted = true;
            return BtStatus.Success;
        }
        return BtStatus.Running;
    }
    const ok = creep.goBoost({
        [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
        [HEAL]: ['XLHO2', 'LHO2', 'LO'],
        [MOVE]: ['XZHO2', 'ZHO2', 'ZO']
    }, { must: true }) === OK;
    if (ok) creep.memory.boosted = true;
    return ok ? BtStatus.Success : BtStatus.Running;
});

const runDefend2Attack = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    const bindcreep = resolveBoundPartner(creep);
    if (!bindcreep || !bindcreep.memory.boosted) return;

    const costCallback = creep.room.getDefenseCreepCostCallback(creep.name);
    const mem = creep.room.memory['defenseRamparts'];
    const minHits = (mem && mem.minHits) ? mem.minHits : (creep.room.memory['breached'] ? 1e5 : 1e6);
    const anchor = pickDefenseAnchorRampart(creep.room, 'melee', creep.name, minHits);

    if (!creep.pos.isNear(bindcreep.pos)) {
        creep.moveTo(bindcreep.pos, { range: 1, costCallback } as any);
        return;
    }

    const state = creep.room.memory['defenseState'];
    const hasRamparts = Array.isArray(creep.room[STRUCTURE_RAMPART]) && creep.room[STRUCTURE_RAMPART].length > 0;
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
};

const runDefend2Heal = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();
    if (creep.ticksToLive < 100 && creep.room.my) {
        creep.unBoost();
        return;
    }

    if (!creep.memory.bind) {
        tryBindNearestPartner(
            creep,
            'defend_2heal_attack_creeps',
            (candidate) => candidate.memory.role === 'defend-2attack'
        );
        return;
    }

    const bindcreep = resolveBoundPartner(creep);
    if (!bindcreep || !bindcreep.memory.boosted) return;

    creep.memory.dontPullMe = !creep.room.my;

    const costCallback = creep.room.getDefenseCreepCostCallback(creep.name);
    const needSelfCritical = creep.hits < creep.hitsMax * 0.35;
    const needRetreat =
        creep.hits < creep.hitsMax * 0.55 ||
        bindcreep.hits < bindcreep.hitsMax * 0.55;

    if (needSelfCritical && creep.hits < creep.hitsMax) {
        creep.heal(creep);
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

    if (needRetreat && creep.pos.isNearTo(bindcreep)) {
        if (shouldSaveBind) creep.heal(bindcreep);
        else if (creep.hits < creep.hitsMax) creep.heal(creep);
        creep.doubleFlee();
        return;
    }

    if (shouldSaveBind) {
        if (creep.pos.isNearTo(bindcreep)) {
            creep.heal(bindcreep);
        } else if (creep.pos.inRangeTo(bindcreep, 3)) {
            creep.rangedHeal(bindcreep);
        }
    } else if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }

    if (!creep.pos.isNearTo(bindcreep)) {
        creep.moveTo(bindcreep, { range: 1, costCallback } as any);
    }
};

export const defend2AttackRegistry = new BehaviorTreeRegistry<DefendCtx>();
export const defend2HealRegistry = new BehaviorTreeRegistry<DefendCtx>();

const defend2Attack = createDefenseRole(defend2AttackRegistry, ensureDoubleAttackBoost, runDefend2Attack);
const defend2Heal = createDefenseRole(defend2HealRegistry, ensureDoubleHealBoost, runDefend2Heal);

export { defend2Attack, defend2Heal };
