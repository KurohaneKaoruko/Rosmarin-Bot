import { ROLES } from '@/constant/CreepConstant';
const runClaimer = (creep: Creep) => {
    if (!creep.memory.targetRoom) {
        creep.say('🚨 无目标');
        return;
    }

    if (creep.getActiveBodyparts(HEAL) > 0 && creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }

    const name = creep.name.match(/_(\w+)/)?.[1];
    const moveflag = Game.flags[name + '-move'];
    if (moveflag) {
        if (creep.room.name !== moveflag.pos.roomName) {
            creep.memory.targetRoom = moveflag.pos.roomName;
        }
        creep.moveTo(moveflag.pos, { visualizePathStyle: { stroke: '#00ff00' } });
        return;
    }

    if (!creep.moveToTargetRoom()) return;

    const controller = creep.room.controller;
    if (!controller) return;

    if (controller.reservation && controller.reservation.username !== creep.owner.username) {
        if (creep.pos.isNearTo(controller)) {
            creep.attackController(controller);
        } else {
            creep.moveTo(controller, {
                visualizePathStyle: { stroke: '#ffffff' },
                range: 1,
                maxRooms: 1
            });
        }
        return;
    }

    if (controller.my) return;

    if (creep.pos.isNearTo(controller)) {
        const result = creep.claimController(controller);
        if (creep.memory['sign']) {
            creep.signControllerIfNeeded(creep.memory['sign'], { overwrite: true });
        }
        if (result !== OK) {
            creep.reserveController(controller);
        }
        return;
    }

    creep.moveTo(controller, {
        visualizePathStyle: { stroke: '#ffffff' },
        range: 1,
        maxRooms: 1
    });
};

const runAttackClaimer = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();
    if (creep.room.name !== creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(creep.memory.targetRoom);
        return;
    }

    const controller = creep.room.controller;
    if (!controller || controller.level === 0) {
        creep.room.find(FIND_FLAGS, {
            filter: (flag) => flag.name.startsWith('ACLAIM/')
        }).forEach((flag) => flag.remove());
        creep.suicide();
        return;
    }

    if ((controller.upgradeBlocked || 0) > creep.ticksToLive) {
        creep.suicide();
        return;
    }

    if (creep.pos.isNearTo(controller)) {
        creep.memory.dontPullMe = true;
        const area = [controller.pos.y - 1, controller.pos.x - 1, controller.pos.y + 1, controller.pos.x + 1]
            .map((value) => Math.max(0, Math.min(value, 49)));
        const creeps = creep.room.lookForAtArea(LOOK_CREEPS, area[0], area[1], area[2], area[3], true)
            .filter((result) => result.creep.my && result.creep.memory.role === ROLES['attack-claimer']);
        if (creeps.length < creep.memory['num'] && creep.ticksToLive > 10) return;
        if (creep.ticksToLive <= 10) {
            creeps.forEach((result) => result.creep.attackController(controller));
        } else {
            creep.attackController(controller);
        }
        return;
    }

    creep.moveTo(controller, { range: 1 });
};

const claimer = {
    run: runClaimer
};

const attackClaimer = {
    run: runAttackClaimer
};

export { attackClaimer, claimer };
