import { resolveBoundPartner } from '@/prototype/Creep/function/boundPartner';

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

const out2Attack = {
    run: runOut2Attack
};

export { out2Attack };
