// 检查位置附近是否有危险的敌方creep
function hasHostileThreat(pos: RoomPosition): boolean {
    return pos.findInRange(FIND_HOSTILE_CREEPS, 8).some((c: Creep) =>
        !c.my && !c.isWhiteList() &&
        (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0)
    );
}

function AutoFindTarget(creep: Creep) {
    const room = creep.room;
    const allStructures = [
        ...room.rampart, ...room.constructedWall, ...room.extension,
        ...room.tower, ...room.spawn, ...room.lab,
        room.observer, room.factory, room.storage,
        room.terminal, room.nuker, room.powerSpawn,
    ].filter(Boolean) as Structure[];

    if (allStructures.length === 0) return;

    // 优先找一般建筑（非墙/城墙）
    const normalStructures = allStructures.filter(s =>
        s.structureType !== STRUCTURE_RAMPART &&
        s.structureType !== STRUCTURE_WALL &&
        (!('store' in s) || (s as AnyStoreStructure).store.getUsedCapacity() <= 3000) &&
        !hasHostileThreat(s.pos)
    );

    let targetStructure = creep.pos.findClosestByPath(normalStructures, {
        ignoreCreeps: false,
        maxRooms: 1, range: 1,
        plainCost: 1, swampCost: 1
    });

    // 找不到则找墙/城墙
    if (!targetStructure) {
        const wallStructures = allStructures.filter(s =>
            (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
            !hasHostileThreat(s.pos)
        );
        targetStructure = creep.pos.findClosestByPath(wallStructures, {
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
        visualizePathStyle: { stroke: '#ffff00' },
        maxRooms: 1, range: 1
    });
    if (result !== ERR_NO_PATH) {
        creep.memory['targetId'] = targetStructure.id;
    }
}

// 从creep名称中提取基础名
function getBaseName(creep: Creep): string {
    return creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
}

const dismantle = {
    run: function (creep: Creep) {
        // 初始化通知设置
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }

        // 处理boost
        if (!creep.memory.boosted) {
            if (creep.memory['boostmap']) {
                if (creep.Boost(creep.memory['boostmap']) === OK) {
                    creep.memory.boosted = true;
                }
            } else {
                const boostTypes = ['XZH2O', 'ZH2O', 'ZH', 'XZHO2', 'ZHO2', 'ZO'];
                creep.memory.boosted = creep.goBoost(boostTypes);
            }
            return;
        }

        const baseName = getBaseName(creep);

        // 处理移动旗帜
        const moveFlag = Game.flags[baseName + '-move'];
        if (moveFlag) {
            if (!creep.pos.isEqual(moveFlag.pos)) {
                creep.moveTo(moveFlag.pos, { maxRooms: 1, range: 0 });
            }
            return true;
        }

        // 处理拆除旗帜
        const disFlag = Game.flags[baseName + '-dis'] || Game.flags['dis-' + creep.room.name];
        if (disFlag) {
            const structures = disFlag.pos.lookFor(LOOK_STRUCTURES)
                .filter(s => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_CONTAINER);

            if (structures.length > 0) {
                // 优先拆墙/城墙
                const target = structures.find(s =>
                    s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART
                ) || structures[0];

                if (creep.pos.isNearTo(target)) {
                    creep.dismantle(target);
                } else {
                    creep.moveTo(target, { maxRooms: 1, range: 1 });
                }
                return true;
            }
        }

        // 移动到目标房间
        if (creep.room.name !== creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return;
        }

        // 不在自己房间才执行拆除
        if (creep.room.my) return false;

        // 获取缓存目标并执行拆除
        const target = Game.getObjectById(creep.memory['targetId']) as Structure;
        if (target) {
            if (creep.pos.isNearTo(target)) {
                creep.dismantle(target);
            } else {
                creep.moveTo(target, {
                    visualizePathStyle: { stroke: '#ffff00' },
                    maxRooms: 1, range: 1
                });
            }
            return;
        }

        creep.memory['targetId'] = null;
        AutoFindTarget(creep);
    }
}

export default dismantle;