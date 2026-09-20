type DoubleAttackTarget = Creep | Structure;

const isDoubleAttackTarget = (target: _HasId | null): target is DoubleAttackTarget =>
    !!target && 'pos' in target && (('owner' in target && 'body' in target) || ('structureType' in target && 'hits' in target));

const getCachedDoubleAttackTarget = (creep: Creep): DoubleAttackTarget | null => {
    const targetId = creep.memory['targetId'] as Id<Creep | Structure> | null | undefined;
    if (!targetId) return null;
    const target = Game.getObjectById(targetId);
    return isDoubleAttackTarget(target) ? target : null;
};

function isDoubleAttackDangerHostile(hostile: Creep, creep: Creep): boolean {
    return (!hostile.my &&
        !hostile.isWhiteList() &&
        hostile.getActiveBodyparts(ATTACK) >= 30 &&
        hostile.pos.inRangeTo(creep, 5)) ||
        hostile.getActiveBodyparts(RANGED_ATTACK) >= 30;
}

function FlagActionMove(creep: Creep) {
    const name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
    const moveflag = Game.flags[`2A-${name}-MOVE`];
    if(moveflag && !creep.pos.inRangeTo(moveflag.pos, 0)) {
        if(creep.room.name !== moveflag.pos.roomName) {
            creep.memory.targetRoom = moveflag.pos.roomName;
        }
        creep.doubleMoveTo(moveflag.pos, '#ffff00')
    }
    if (moveflag) return true;
}

function FlagActionAttack(creep: Creep) {
    const name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
    const aFlag = Game.flags[`2A-${name}-attack`];
    if (!aFlag) return false;

    if (creep.room.name !== aFlag.pos.roomName) {
        creep.doubleMoveTo(aFlag.pos, '#ff0000');
        return true;
    }

    const allEnemies = creep.findHostileCreeps();
    const enemies = allEnemies.filter(c => aFlag.pos.inRangeTo(c.pos, 5));

    if (enemies.length > 0) {
        const targetEnemy = creep.pos.findClosestByPath(enemies);
        if (targetEnemy) {
            creep.doubleToAttack(targetEnemy);
            return true;
        }
    }

    const structures = aFlag.pos.lookFor(LOOK_STRUCTURES);
    if(structures.length > 0) {
        const targetStructure = structures.find((s) => s.structureType == STRUCTURE_RAMPART) || structures[0];
        creep.doubleToAttack(targetStructure);
        return true;
    }
    return true;
}

function AutoFindTarget(creep: Creep) {
    let room = creep.room;

    const allEnemies = creep.findHostileCreeps();
    const dangerousEnemies = allEnemies.filter((hostile) => isDoubleAttackDangerHostile(hostile, creep));
    const enemies = allEnemies.filter((c) => !dangerousEnemies.some((hostile) => hostile.pos.inRangeTo(c.pos, 8)));
    if (enemies.length > 0) {
        const targetEnemy = creep.pos.findClosestByPath(enemies);
        if (targetEnemy) {
            const result = creep.moveTo(targetEnemy, {
                visualizePathStyle: {stroke: '#ffff00'},
                maxRooms: 1, range: 1
            });
            if (result !== ERR_NO_PATH) {
                creep.memory['targetId'] = targetEnemy.id;
                return true;
            }
        }
    }

    const enemiesStructures = [
        ...room.rampart, ...room.constructedWall, ...room.extension, ...room.tower, ...room.spawn, ...room.lab,
        room.observer, room.factory, room.storage, room.terminal, room.nuker, room.powerSpawn,
    ];
    if(enemiesStructures.length == 0) return;

    let Structures = enemiesStructures.filter((s: any) => s &&
        s.structureType != STRUCTURE_RAMPART && s.structureType != STRUCTURE_WALL &&
        (!s.store || s.store.getUsedCapacity() <= 3000) &&
        !dangerousEnemies.some((hostile) => hostile.pos.inRangeTo(s.pos, 6))
    );
    let targetStructure = creep.pos.findClosestByPath(Structures, {
        ignoreCreeps: false,
        maxRooms: 1, range: 1,
        plainCost: 1, swampCost: 1
    });

    if (!targetStructure) {
        Structures = enemiesStructures.filter((s: any) => s &&
            (s.structureType == STRUCTURE_RAMPART || s.structureType == STRUCTURE_WALL) &&
            !dangerousEnemies.some((hostile) => hostile.pos.inRangeTo(s.pos, 6))
        );
        targetStructure = creep.pos.findClosestByPath(Structures, {
            ignoreCreeps: true,
            maxRooms: 1, range: 1,
            plainCost: 1, swampCost: 1
        });
    }

    if (!targetStructure) {
        creep.say('NO TARGET');
        creep.memory['targetId'] = null;
        creep.memory['idle'] = Game.time + 10;
        return;
    }

    if (creep.pos.isNearTo(targetStructure)) {
        creep.memory['targetId'] = targetStructure.id;
        creep.attack(targetStructure);
        return;
    } else {
        const result = creep.doubleMoveTo(targetStructure.pos, '#ff0000', {maxRooms: 1, range: 1});
        if (result == ERR_NO_PATH) return;
        creep.memory['targetId'] = targetStructure.id;
    }
}

function AutoActionAttack(creep: Creep) {
    let target = getCachedDoubleAttackTarget(creep);

    if (target && 'owner' in target && Memory['whitelist']?.includes(target.owner.username)) {
        creep.memory['targetId'] = null;
        target = null;
    }

    const nearbyHostiles = creep.findHostileCreeps(6);
    const dangerousHostiles = nearbyHostiles.filter((c) =>
        (c.getActiveBodyparts(ATTACK) >= 30 && c.pos.inRangeTo(creep, 4)) ||
        (c.getActiveBodyparts(RANGED_ATTACK) >= 30 && c.pos.inRangeTo(creep, 6))
    );
    
    if (dangerousHostiles.length > 0) {
        let result = creep.doubleFlee();
        if (result === OK) return true;
    }

    if (target) {
        creep.doubleToAttack(target);
        return true;
    }
}

const runLegacy = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    if (!creep.memory.bind) return;

    const bindId = creep.memory.bind;
    if (!bindId) return;
    const bindcreep = Game.getObjectById(bindId);
    if (!bindcreep) {
        delete creep.memory.bind;
        return;
    }

    creep.memory.dontPullMe = !creep.room.my;

    if (FlagActionMove(creep)) return;

    if (!creep.memory['targetId'] &&
        creep.doubleMoveToRoom(creep.memory.targetRoom, '#ff0000')) return;
    if (creep.room.my || Game.time < (creep.memory.idle || 0)) return;

    if (FlagActionAttack(creep)) return;

    if (AutoActionAttack(creep)) return;

    AutoFindTarget(creep);

    if (!creep.pos.isNearTo(bindcreep)) {
        bindcreep.moveTo(creep);
    }
};

const double_attack = {
    prepare: (creep) => {
        return creep.ensureBoosted(creep.memory['boostmap']);
    },
    run: runLegacy
};

export default double_attack;
