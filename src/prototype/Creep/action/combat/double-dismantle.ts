import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { createBoostedRole } from '@/framework/ai/creepRole';

const getCachedDoubleDismantleTarget = (creep: Creep): Structure | null => {
    const targetId = creep.memory['targetId'] as Id<Structure> | null | undefined;
    if (!targetId) return null;
    const target = Game.getObjectById(targetId);
    return target && 'structureType' in target && 'hits' in target ? target : null;
};

function FlagActionMove(creep: Creep) {
    const name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
    const moveflag = Game.flags[`2D-${name}-MOVE`];
    if(moveflag && !creep.pos.inRangeTo(moveflag.pos, 0)) {
        creep.doubleMoveTo(moveflag.pos, '#ffff00')
    }
    if (moveflag) return true;
}

function FlagActionDismantle(creep: Creep) {
    const name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
    const disflag = Game.flags[`2D-${name}-DIS`] || Game.flags['DIS-' + creep.memory.targetRoom];
    if (!disflag) return false;
    
    if (creep.room.name !== disflag.pos.roomName) {
        creep.doubleMoveTo(disflag.pos, '#ffff00');
        return true;
    }
    const structures = disflag.pos.lookFor(LOOK_STRUCTURES);
    if(structures.length > 0) {
        const targetStructure = structures.find((s) => s.structureType == STRUCTURE_RAMPART) || structures[0];
        creep.doubleToDismantle(targetStructure);
        return true;
    }
    return true;
}

function AutoFindTarget(creep: Creep) {
    let room = creep.room;
    const dangerousHostiles = creep.findHostileCreeps().filter((hostile) =>
        !hostile.my &&
        !hostile.isWhiteList() &&
        (hostile.getActiveBodyparts(ATTACK) > 0 || hostile.getActiveBodyparts(RANGED_ATTACK) > 0)
    );
    const enemiesStructures = [
        ...room.rampart, ...room.constructedWall, ...room.extension, ...room.tower, ...room.spawn, ...room.lab,
        room.observer, room.factory, room.storage, room.terminal, room.nuker, room.powerSpawn,
    ];
    if(enemiesStructures.length == 0) return;

    // 找一般建筑
    let Structures = enemiesStructures.filter((s: any) => s &&
        s.structureType != STRUCTURE_RAMPART && s.structureType != STRUCTURE_WALL &&
        (!s.store || s.store.getUsedCapacity() <= 3000) &&
        !dangerousHostiles.some((hostile) => hostile.pos.inRangeTo(s.pos, 8))
    );
    let targetStructure = creep.pos.findClosestByPath(Structures, {
        ignoreCreeps: false,
        maxRooms: 1, range: 1,
        plainCost: 1, swampCost: 1
    });

    // 找不到就找墙
    if (!targetStructure) {
        Structures = enemiesStructures.filter((s: any) => s &&
            (s.structureType == STRUCTURE_RAMPART || s.structureType == STRUCTURE_WALL) &&
            !dangerousHostiles.some((hostile) => hostile.pos.inRangeTo(s.pos, 8))
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
        creep.dismantle(targetStructure);
        return;
    } else {
        const result = creep.doubleMoveTo(targetStructure.pos, '#ffff00', {maxRooms: 1, range: 1});
        if (result == ERR_NO_PATH) return;
        creep.memory['targetId'] = targetStructure.id;
    }
}

function AutoActionDismantle(creep: Creep) {
    // 获取缓存的目标
    let target = getCachedDoubleDismantleTarget(creep);
    const roomHostiles = getRoomTickCacheValue(creep.room, 'double_dismantle_room_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS) as Creep[]
    );
    const targetDangerHostiles = target ? roomHostiles.filter((c) =>
        target.pos.inRangeTo(c, 6) &&
        ((!c.isWhiteList() &&
        c.getActiveBodyparts(ATTACK) > 0 && c.pos.inRangeTo(creep, 4)) ||
        (c.getActiveBodyparts(RANGED_ATTACK) > 0 && c.pos.inRangeTo(creep, 6)))
    ) : undefined;

    // 如果目标位于危险区域, 更换目标
    if (target && targetDangerHostiles) {
        creep.memory['targetId'] = null;
        AutoFindTarget(creep);
        target = getCachedDoubleDismantleTarget(creep);
    }

    // 规避
    const closeDangerHostiles = roomHostiles.filter((c) =>
        creep.pos.inRangeTo(c, 6) &&
        ((!c.isWhiteList() &&
        c.getActiveBodyparts(ATTACK) > 0 && c.pos.inRangeTo(creep, 5)) ||
        (c.getActiveBodyparts(RANGED_ATTACK) > 0 && c.pos.inRangeTo(creep, 6)))
    );
    if (closeDangerHostiles.length) {
        let result = creep.doubleFlee();
        if (result === OK) return true;
    }

    // 目标存在则行动
    if (target) {
        creep.doubleToDismantle(target);
        return true;
    }
}


const runLegacy = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    // 等待绑定
    if (!creep.memory.bind) return;

    // 获取绑定的另一个creep
    const bindId = creep.memory.bind;
    if (!bindId) return;
    const bindcreep = Game.getObjectById(bindId);
    if (!bindcreep) {
        delete creep.memory.bind;
        return;
    }

    creep.memory.dontPullMe = true;

    // 旗帜移动
    if (FlagActionMove(creep)) return;

    // 手动标记行动
    if (FlagActionDismantle(creep)) return;

    // 自动行动
    if (AutoActionDismantle(creep)) return;

    // 移动到目标房间, 未到达房间不继续行动
    if (creep.doubleMoveToRoom(creep.memory.targetRoom, '#ffff00')) return;
    if (creep.room.my || Game.time < (creep.memory.idle || 0)) return;

    // 自动寻找目标
    AutoFindTarget(creep);
};

const double_dismantle = createBoostedRole({
    boost: (creep) => creep.memory['boostmap'] || {
        [TOUGH]: ['XGHO2', 'GHO2', 'GO'],
        [WORK]: ['XZH2O', 'ZH2O', 'ZH']
    },
    run: runLegacy
})

export default double_dismantle;
