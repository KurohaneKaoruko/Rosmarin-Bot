function AutoFindTarget(creep: Creep) {
    let room = creep.room;
    const enemiesStructures = [
        ...room.rampart, ...room.constructedWall, ...room.extension, ...room.tower, ...room.spawn, ...room.lab,
        room.observer, room.factory, room.storage, room.terminal, room.nuker, room.powerSpawn,
    ];
    if(enemiesStructures.length == 0) return;

    // 找一般建筑
    let Structures = enemiesStructures.filter((s: any) => s &&
        s.structureType != STRUCTURE_RAMPART && s.structureType != STRUCTURE_WALL &&
        (!s.store || s.store.getUsedCapacity() <= 3000) &&
        s.pos.findInRange(FIND_HOSTILE_CREEPS, 8)
        .filter((c: Creep) => !c.my && !c.isWhiteList() &&
        (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0)).length == 0
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
            s.pos.findInRange(FIND_HOSTILE_CREEPS, 8)
            .filter((c: Creep) => !c.my && !c.isWhiteList() &&
            (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0)).length == 0
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

    const result = creep.moveTo(targetStructure, {
        visualizePathStyle: {stroke: '#ffff00'},
        maxRooms: 1, range: 1
    });
    if (result == ERR_NO_PATH) return;
    creep.memory['targetId'] = targetStructure.id;
}

const dismantle = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        if (!creep.memory.boosted) {
            if (creep.memory['boostmap']) {
                let result = creep.Boost(creep.memory['boostmap'])
                if (result == OK) {
                    creep.memory.boosted = true
                }
            } else {
                const boost = ['XZH2O', 'ZH2O', 'ZH', 'XZHO2', 'ZHO2', 'ZO'];
                creep.memory.boosted = creep.goBoost(boost);
            }
            return
        }
        
        let name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
        const moveflag = Game.flags[name + '-move'];
        if(moveflag && !creep.pos.isEqual(moveflag.pos)) {
            creep.moveTo(moveflag.pos, {
                maxRooms: 1,
                range: 0,
            })
        }
        if (moveflag) return true;
        
        name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
        const disflag = Game.flags[name + '-dis'] || Game.flags['dis-' + creep.room.name];
        if(disflag) {
            const enemiesStructures = disflag.pos.lookFor(LOOK_STRUCTURES);
            if(enemiesStructures.length > 0) {
                const Structures = enemiesStructures.filter((s) => s && s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_CONTAINER);
                const targetStructure = Structures.find((s) => s && s.structureType === STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART) ||
                                        Structures[0];
                if(creep.pos.isNearTo(targetStructure)) creep.dismantle(targetStructure);
                else creep.moveTo(targetStructure,{
                    maxRooms: 1,
                    range: 0,
                });
                return true;
            }
        }

        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return
        }

        if(creep.room.my) return false;

        // 获取缓存的目标
        const target = Game.getObjectById(creep.memory['targetId']) as Structure;
        // 目标存在则行动
        if (target) {
            if (creep.pos.isNearTo(target)) {
                creep.dismantle(target);
            } else {
                creep.moveTo(target, {
                    visualizePathStyle: {stroke: '#ffff00'},
                    maxRooms: 1, range: 1
                })
            }
            return;
        } else {
            creep.memory['targetId'] = null;
        }

        AutoFindTarget(creep);
    }
}

export default dismantle;