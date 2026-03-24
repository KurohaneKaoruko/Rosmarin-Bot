import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';
import type { CreepRoleHandler } from '../../types';

type SimpleBehaviorContext = { creep: Creep };

const createSimpleBehaviorRole = (run: (creep: Creep) => void): CreepRoleHandler => {
    const registry = new BehaviorTreeRegistry<SimpleBehaviorContext>();
    const mainNode = leaf<SimpleBehaviorContext>(({ creep }) => {
        run(creep);
        return BtStatus.Running;
    });
    const tree = new BehaviorTree(
        sequence(
            hotSwap(registry, 'main', mainNode)
        )
    );

    return {
        run(creep: Creep) {
            tree.tick({ creep });
        }
    };
};

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

const runOut2Attack = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();
    if (!resolveBoundPartner(creep)) return;
    if (creep.doubleMoveToRoom(creep.memory.targetRoom, '#ff0000')) return;

    const enemies = creep.room.findEnemyCreeps()
        .filter((enemy) =>
            (enemy.getActiveBodyparts(ATTACK) > 0 ||
                enemy.getActiveBodyparts(RANGED_ATTACK) > 0 ||
                enemy.getActiveBodyparts(HEAL) > 0) &&
            enemy.owner.username !== 'Source Keeper'
        );

    if (enemies.length > 0) {
        const targetEnemy = creep.pos.findClosestByRange(enemies);
        if (!targetEnemy) return;

        if (creep.pos.inRangeTo(targetEnemy, 1)) {
            creep.rangedMassAttack();
            creep.attack(targetEnemy);
        } else {
            if (creep.pos.inRangeTo(targetEnemy, 3)) {
                creep.rangedAttack(targetEnemy);
            }
            creep.doubleMoveTo(targetEnemy.pos, '#ff0000', { maxRooms: 1 });
        }
        return;
    }

    if (creep.pos.x < 5 || creep.pos.x > 45 || creep.pos.y < 5 || creep.pos.y > 45) {
        creep.doubleMoveTo(new RoomPosition(25, 25, creep.room.name), '#ff0000');
    }
};

const runOut2Heal = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    let healed = false;
    if (!creep.memory.bind) {
        tryBindNearestPartner(
            creep,
            'out_2heal_attackers',
            (candidate) => candidate.memory.role === 'out-2attack'
        );
    }

    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
        healed = true;
    }

    const bindcreep = resolveBoundPartner(creep);
    if (!bindcreep) return;

    if (!healed && creep.pos.isNearTo(bindcreep)) {
        creep.heal(bindcreep);
    } else if (!healed && creep.pos.inRangeTo(bindcreep, 3)) {
        creep.rangedHeal(bindcreep);
        creep.moveTo(bindcreep);
    } else {
        creep.moveTo(bindcreep);
    }
};

const out2Attack = createSimpleBehaviorRole(runOut2Attack);
const out2Heal = createSimpleBehaviorRole(runOut2Heal);

export { out2Attack, out2Heal };
