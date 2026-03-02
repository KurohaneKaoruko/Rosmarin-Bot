import { parseShardRoomName } from '@/modules/infra/shardRoom';

const aid_build = {
    run: function (creep: Creep) {
        if (!creep.memory.ready) {
            creep.memory.ready = this.prepare(creep);
            return;
        }

        switch (creep.memory.action) {
            case 'harvest':
                this.harvest(creep);
                return;
            case 'stage':
                this.stage(creep);
                return;
            case 'build':
                this.build(creep);
                return;
            case 'repair':
                this.repair(creep);
                return;
            case 'upgrade':
                this.upgrade(creep);
            default:
                this.switch(creep);
                return;
        }
    },

    prepare: function (creep: Creep) {
        if (creep.memory['boostmap']) {
            return creep.goBoost(creep.memory['boostmap']) === OK;
        } else {
            return creep.goBoost({ [WORK]: ['XLH2O', 'LH2O', 'LH'] }) === OK;
        }
        
    },

    harvest: function (creep: Creep) {
        const sourceRoom = creep.memory.sourceRoom || creep.memory.targetRoom;
        // 兼容仅配置 targetRoom（未配置 sourceRoom）的情况：默认在 targetRoom 获取能量
        if (sourceRoom) {
            const { roomName: localRoom, shard } = parseShardRoomName(sourceRoom);
            const arrived = (!shard || shard === Game.shard.name) && creep.room.name === localRoom && !creep.pos.isRoomEdge();
            if (!arrived) {
                creep.moveToRoom(sourceRoom);
                return;
            }
        }

        if (creep.store.getFreeCapacity() === 0) {
            creep.memory.action = '';
            return;
        }

        // 使用 smartCollect 方法收集资源
        // 优先级: 掉落资源 > 墓碑 > 废墟 > 容器 > 存储
        if (creep.smartCollect(RESOURCE_ENERGY, {
            includeDropped: true,
            includeTombstone: true,
            includeRuin: true,
            includeContainer: true,
            includeStorage: true,
            minDroppedAmount: 50,
            minContainerAmount: 0
        })) {
            // 检查是否收集完成
            const freeCapacity = creep.store.getFreeCapacity();
            if (freeCapacity === 0) {
                creep.memory.action = '';
            }
            return;
        }

        // 如果没有找到资源，尝试从 source 采集
        if (!creep.room.source) {
            if (Game.time % 10 !== 0) return;
            creep.room.update();
        }

        if (!creep.room.source) return;

        const targetSource = this.getBalancedSource(creep);
        if (!targetSource && creep.store[RESOURCE_ENERGY] > 0) {
            creep.memory.action = '';
            return;
        }
        if (!targetSource) return;

        let result = creep.goHaverst(targetSource);
        if (!result) return;
        let energy = 0;
        for (const part of creep.body) {
            if (part.type !== WORK) continue;
            if (part.hits === 0) continue;
            if (!part.boost) energy += 2;
            else energy += 2 * (BOOSTS.work[part.boost]['harvest'] || 1);
        }
        if (creep.store.getFreeCapacity() > energy) return;
        creep.memory.action = '';
    },

    build: function (creep: Creep) {
        const controller = creep.room.controller;
        const isJumpMode = !!creep.memory.jumpMode;
        const hasSpawn = creep.room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_SPAWN
        }).length > 0;
        const hasSpawnSite = creep.room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s) => s.structureType === STRUCTURE_SPAWN
        }).length > 0;
        const shouldForceSpawnFirst = isJumpMode && !hasSpawn && hasSpawnSite;

        if (controller?.my && controller.level < 2) {
            if (!shouldForceSpawnFirst) {
                creep.memory.action = 'upgrade';
                return;
            }
        }

        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = '';
            return;
        }

        const targetRoom = creep.memory.targetRoom;
        if (targetRoom) {
            const { roomName: localRoom, shard } = parseShardRoomName(targetRoom);
            const arrived = (!shard || shard === Game.shard.name) && creep.room.name === localRoom;
            if (!arrived) {
                creep.moveToRoom(targetRoom);
                return;
            }
        }

        if (creep.pos.isRoomEdge()) {
            creep.moveTo(creep.room.controller);
            return;
        }

        const buildPriority = isJumpMode
            ? [
                STRUCTURE_SPAWN,
                STRUCTURE_EXTENSION,
                STRUCTURE_TOWER,
                STRUCTURE_STORAGE,
                STRUCTURE_TERMINAL,
                STRUCTURE_CONTAINER,
                STRUCTURE_ROAD
            ]
            : [
                STRUCTURE_ROAD,
                STRUCTURE_SPAWN,
                STRUCTURE_STORAGE,
                STRUCTURE_TERMINAL,
                STRUCTURE_EXTENSION,
                STRUCTURE_TOWER
            ];

        // 使用 findAndBuild 方法查找并建造
        if (!creep.findAndBuild({
            priority: buildPriority
        })) {
            creep.memory.action = '';
        }
    },

    repair: function (creep: Creep) {
        const controller = creep.room.controller;
        if (!controller?.my) {
            creep.memory.action = 'stage';
            return;
        }
        if (controller.level < 2) {
            creep.memory.action = 'upgrade';
            return;
        }

        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = '';
            return;
        }

        const targetRoom = creep.memory.targetRoom;
        if (targetRoom) {
            const { roomName: localRoom, shard } = parseShardRoomName(targetRoom);
            const arrived = (!shard || shard === Game.shard.name) && creep.room.name === localRoom;
            if (!arrived) {
                creep.moveToRoom(targetRoom);
                return;
            }
        }

        if (creep.pos.isRoomEdge()) {
            creep.moveTo(creep.room.controller);
            return;
        }

        // 如果有缓存的维修目标，继续维修
        if (creep.memory.cache?.repairTarget) {
            const repairTarget = Game.getObjectById(creep.memory.cache.repairTarget as Id<Structure>)
            if (repairTarget) {
                if (repairTarget.hits === repairTarget.hitsMax) {
                    creep.memory.cache.repairTarget = '';
                    creep.memory.action = '';
                    return;
                }
                creep.goRepair(repairTarget);
                return;
            }
        }

        // 使用 findAndRepair 方法查找并维修
        if (!creep.findAndRepair({
            maxHitsRatio: 0.8
        })) {
            creep.memory.action = '';
        }
    },

    upgrade: function (creep: Creep) {
        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = '';
            return;
        }

        const controller = creep.room.controller;
        if (!controller?.my) {
            creep.memory.action = 'stage';
            return;
        }

        if (controller.level < 8) {
            if (creep.upgradeController(controller) == ERR_NOT_IN_RANGE) {
                creep.moveTo(controller, { maxRooms: 1 });
            }
            return;
        }
    },

    stage: function (creep: Creep) {
        const targetRoom = creep.memory.targetRoom;
        if (targetRoom) {
            const { roomName: localRoom, shard } = parseShardRoomName(targetRoom);
            const arrived = (!shard || shard === Game.shard.name) && creep.room.name === localRoom;
            if (!arrived) {
                creep.moveToRoom(targetRoom);
                return;
            }
        }

        if (creep.pos.isRoomEdge()) {
            const center = new RoomPosition(25, 25, creep.room.name);
            creep.moveTo(center, { maxRooms: 1 });
            return;
        }

        // stage is a temporary state: re-evaluate each tick to avoid getting stuck.
        const controller = creep.room.controller;
        const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
        if (creep.store[RESOURCE_ENERGY] > 0) {
            if (!controller?.my && sites.length > 0) {
                creep.memory.action = 'build';
                return;
            }
            if (controller?.my && controller.level < 2) {
                creep.memory.action = 'upgrade';
                return;
            }
            if (controller?.my && controller.level >= 2 && sites.length > 0) {
                creep.memory.action = 'build';
                return;
            }
        }

        const containers = [...(creep.room.container || [])];
        const container = creep.pos.findClosestByRange(
            containers.filter((c) => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
        ) as StructureContainer | null;
        const source = this.getBalancedSource(creep);
        const hasBuildSite = creep.room.find(FIND_CONSTRUCTION_SITES).length > 0;
        const canUpgrade = !!controller?.my && controller.level < 8;
        const hasEnergySink = !!container || hasBuildSite || canUpgrade;

        // 有容器但都满了：继续采集并落地囤积，不停止

        if (creep.store[RESOURCE_ENERGY] === 0) {
            // Avoid pickup->drop oscillation when there is nowhere to use energy.
            if (hasEnergySink) {
                const dropped = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 2, {
                    filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 30
                })[0];
                if (dropped) {
                    if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(dropped, { maxRooms: 1 });
                    }
                    return;
                }

                const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 2, {
                    filter: (t) => (t.store[RESOURCE_ENERGY] || 0) > 0
                })[0];
                if (tombstone) {
                    if (creep.withdraw(tombstone, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(tombstone, { maxRooms: 1 });
                    }
                    return;
                }

                const ruin = creep.pos.findInRange(FIND_RUINS, 2, {
                    filter: (r) => (r.store[RESOURCE_ENERGY] || 0) > 0
                })[0];
                if (ruin) {
                    if (creep.withdraw(ruin, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(ruin, { maxRooms: 1 });
                    }
                    return;
                }
            }

            if (source) {
                if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(source, { maxRooms: 1 });
                }
                return;
            }

            if (container && !creep.pos.inRangeTo(container, 1)) {
                // 没有可采目标时，先靠近容器等待机会
                creep.moveTo(container, { range: 1, maxRooms: 1 });
            }
            return;
        }

        // 囤积阶段优先把自己采满，避免“采几下就去存”反复来回。
        if (creep.store.getFreeCapacity() > 0 && source && source.energy > 0) {
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { maxRooms: 1 });
            }
            return;
        }

        if (container) {
            if (creep.pos.inRangeTo(container, 1)) {
                creep.transfer(container, RESOURCE_ENERGY);
            } else {
                creep.moveTo(container, { range: 1, maxRooms: 1 });
            }
            return;
        }

        // 无容器时，允许落地囤积
        creep.drop(RESOURCE_ENERGY);
    },

    getBalancedSource: function (creep: Creep): Source | null {
        const activeSources = [...(creep.room.source || creep.room.find(FIND_SOURCES))]
            .filter((s) => s.energy > 0);
        if (activeSources.length <= 0) {
            delete creep.memory.targetSourceId;
            return null;
        }

        const current = creep.getBoundSource();
        const focusFlag = creep.memory.spawnFlag;
        const sameRole = creep.room.find(FIND_MY_CREEPS, {
            filter: (c) =>
                c.id !== creep.id &&
                c.memory.role === creep.memory.role &&
                (!focusFlag || c.memory.spawnFlag === focusFlag)
        });

        const counts: Record<string, number> = {};
        for (const s of activeSources) counts[s.id] = 0;
        for (const c of sameRole) {
            const sid = c.memory.targetSourceId as Id<Source> | undefined;
            if (!sid || counts[sid] == null) continue;
            counts[sid]++;
        }

        let minCount = Infinity;
        for (const s of activeSources) {
            const cnt = counts[s.id] || 0;
            if (cnt < minCount) minCount = cnt;
        }

        if (current && current.energy > 0 && counts[current.id] != null) {
            const currentCount = counts[current.id] || 0;
            // 当前源没有明显过载则保持绑定，避免频繁抖动
            if (currentCount <= minCount + 1) return current;
        }

        activeSources.sort((a, b) => {
            const ca = counts[a.id] || 0;
            const cb = counts[b.id] || 0;
            if (ca !== cb) return ca - cb;
            return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
        });

        const selected = activeSources[0];
        creep.setBoundSourceId(selected.id);
        return selected;
    },

    switch: function (creep: Creep) {
        creep.memory.cache = {};

        const targetRoom = creep.memory.targetRoom;
        if (targetRoom) {
            const { roomName: localRoom, shard } = parseShardRoomName(targetRoom);
            const arrived = (!shard || shard === Game.shard.name) && creep.room.name === localRoom;
            if (!arrived) {
                creep.moveToRoom(targetRoom);
                return;
            }
        }

        const controller = creep.room.controller;
        const canUpgrade = !!controller?.my;
        const site = creep.room.find(FIND_CONSTRUCTION_SITES);
        const isJumpMode = !!creep.memory.jumpMode;

        if (!canUpgrade && site.length === 0) {
            creep.memory.action = 'stage';
            return;
        }

        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = 'harvest';
            return;
        }

        if (!canUpgrade) {
            creep.memory.action = 'build';
            return;
        }

        const hasSpawn = creep.room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_SPAWN
        }).length > 0;
        const hasSpawnSite = creep.room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s) => s.structureType === STRUCTURE_SPAWN
        }).length > 0;
        const shouldForceSpawnFirst = isJumpMode && !hasSpawn && hasSpawnSite;
        if (controller.level < 2) {
            if (!shouldForceSpawnFirst) {
                creep.memory.action = 'upgrade';
                return;
            }
        }

        if (site.length > 0) {
            creep.memory.action = 'build';
            return;
        }

        const repair = creep.room.find(FIND_STRUCTURES, {
            filter: (s) => s.hits < s.hitsMax * 0.8 &&
                s.structureType != STRUCTURE_ROAD &&
                s.structureType != STRUCTURE_CONTAINER
        })
        if (repair.length > 0) {
            creep.memory.action = 'repair';
            const repairTarget = repair.reduce((a, b) => a.hits < b.hits ? a : b);
            creep.memory.cache.repairTarget = repairTarget.id;
            return;
        }

        creep.memory.action = 'upgrade';
    }
}
export default aid_build;
