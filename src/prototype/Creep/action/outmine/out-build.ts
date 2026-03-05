const BUILD_PRIORITY = [STRUCTURE_CONTAINER, STRUCTURE_ROAD] as StructureConstant[];
const ENERGY_DROP_MIN = 20;
const ENERGY_CONTAINER_MIN = 50;
const REPAIR_RATIO = 0.8;

const outBuild = {
    inTargetRoom: function (creep: Creep): boolean {
        return creep.room.name === creep.memory.targetRoom && !creep.pos.isRoomEdge();
    },

    moveToTargetRoom: function (creep: Creep): void {
        creep.memory.dontPullMe = false;
        creep.moveToRoom(creep.memory.targetRoom, { plainCost: 2, swampCost: 10 });
    },

    isRoadPos: function (pos: RoomPosition): boolean {
        const structures = pos.lookFor(LOOK_STRUCTURES) as Structure[];
        return structures.some((s) => s.structureType === STRUCTURE_ROAD);
    },

    stepAsideFromRoad: function (creep: Creep): boolean {
        if (creep.fatigue > 0) return false;
        if (!this.isRoadPos(creep.pos)) return false;

        const terrain = creep.room.getTerrain();
        let bestPos: RoomPosition | null = null;
        let bestScore = Infinity;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = creep.pos.x + dx;
                const y = creep.pos.y + dy;
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                const pos = new RoomPosition(x, y, creep.room.name);
                if ((pos.lookFor(LOOK_CREEPS) as Creep[]).length > 0) continue;
                if ((pos.lookFor(LOOK_POWER_CREEPS) as PowerCreep[]).length > 0) continue;

                // 优先站到非道路，其次保持就近。
                const score = (this.isRoadPos(pos) ? 100 : 0) + creep.pos.getRangeTo(pos);
                if (score < bestScore) {
                    bestScore = score;
                    bestPos = pos;
                }
            }
        }

        if (!bestPos) return false;
        // 让路时保持可对穿，避免自己成为卡点。
        creep.memory.dontPullMe = false;
        creep.move(creep.pos.getDirectionTo(bestPos));
        return true;
    },

    findBuildTarget: function (creep: Creep): ConstructionSite | null {
        const cache = (creep.memory.cacheTarget ||= {}) as any;
        if (cache.targetId) {
            const cached = Game.getObjectById(cache.targetId as Id<ConstructionSite>) as ConstructionSite | null;
            if (cached && cached.my && (cached.structureType === STRUCTURE_ROAD || cached.structureType === STRUCTURE_CONTAINER)) {
                return cached;
            }
            delete cache.targetId;
        }

        const sites = creep.room.find(FIND_CONSTRUCTION_SITES, {
            filter: (site) =>
                site.my &&
                (site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER)
        });
        if (sites.length <= 0) return null;

        let target: ConstructionSite | null = null;
        for (const type of BUILD_PRIORITY) {
            const typed = sites.filter((s) => s.structureType === type);
            if (typed.length <= 0) continue;
            target = creep.pos.findClosestByRange(typed);
            if (target) break;
        }
        if (!target) target = creep.pos.findClosestByRange(sites);
        if (target) cache.targetId = target.id;
        return target;
    },

    findRepairTarget: function (creep: Creep): Structure | null {
        const cache = (creep.memory.cacheTarget ||= {}) as any;
        if (cache.repairId) {
            const cached = Game.getObjectById(cache.repairId as Id<Structure>) as Structure | null;
            if (
                cached &&
                (cached.structureType === STRUCTURE_ROAD || cached.structureType === STRUCTURE_CONTAINER) &&
                cached.hits < cached.hitsMax * REPAIR_RATIO
            ) {
                return cached;
            }
            delete cache.repairId;
        }

        const targets = creep.room.find(FIND_STRUCTURES, {
            filter: (s) =>
                (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_CONTAINER) &&
                s.hits < s.hitsMax * REPAIR_RATIO
        });
        if (targets.length <= 0) return null;

        const target = creep.pos.findClosestByRange(targets);
        if (target) cache.repairId = target.id;
        return target;
    },

    tryWithdrawEnergy: function (creep: Creep): boolean {
        // 优先捡地上的能量，避免明明有地能却去抢容器/矿点。
        if (creep.collectDroppedResource(RESOURCE_ENERGY, ENERGY_DROP_MIN)) return true;
        if (creep.collectFromTombstone(RESOURCE_ENERGY, ENERGY_DROP_MIN)) return true;
        if (creep.collectFromRuin(RESOURCE_ENERGY)) return true;
        if (creep.collectFromContainer(ENERGY_CONTAINER_MIN, RESOURCE_ENERGY, false)) return true;
        return false;
    },

    harvest: function (creep: Creep): void {
        if (!this.inTargetRoom(creep)) {
            this.moveToTargetRoom(creep);
            return;
        }
        creep.memory.dontPullMe = false;

        if (this.tryWithdrawEnergy(creep)) return;

        const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE) || creep.pos.findClosestByRange(FIND_SOURCES);
        if (source) {
            const result = creep.harvest(source);
            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, {
                    visualizePathStyle: { stroke: '#ffaa00' },
                    maxRooms: 1,
                    range: 1,
                    plainCost: 2,
                    swampCost: 10
                });
                return;
            }
        }

        // 没有可拿资源时让路，避免在外矿道路上和搬运工反复对穿。
        this.stepAsideFromRoad(creep);
    },

    build: function (creep: Creep): void {
        if (!this.inTargetRoom(creep)) {
            this.moveToTargetRoom(creep);
            return;
        }
        creep.memory.dontPullMe = false;

        // 建造阶段也顺手捡脚下附近地能，提升工地转化效率。
        if (creep.store.getFreeCapacity() > 0) {
            creep.collectDroppedResource(RESOURCE_ENERGY, ENERGY_DROP_MIN, 3);
        }

        const buildTarget = this.findBuildTarget(creep);
        if (buildTarget) {
            const result = creep.build(buildTarget);
            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(buildTarget, {
                    visualizePathStyle: { stroke: '#ffaa00' },
                    maxRooms: 1,
                    range: 3,
                    plainCost: 2,
                    swampCost: 10
                });
            }
            return;
        }

        const repairTarget = this.findRepairTarget(creep);
        if (repairTarget) {
            const result = creep.repair(repairTarget);
            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(repairTarget, {
                    visualizePathStyle: { stroke: '#ffaa00' },
                    maxRooms: 1,
                    range: 3,
                    plainCost: 2,
                    swampCost: 10
                });
            }
            return;
        }

        // 没有工地时把能量回灌，避免满能量长期占道。
        const nearContainer = creep.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (s: Structure) =>
                s.structureType === STRUCTURE_CONTAINER &&
                (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > 0
        })[0] as StructureContainer | undefined;
        if (nearContainer && creep.store[RESOURCE_ENERGY] > 0) {
            creep.transfer(nearContainer, RESOURCE_ENERGY);
            return;
        }

        const nearCarrier = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
            filter: (c: Creep) =>
                (c.memory.role === 'out-carry' || c.memory.role === 'out-car') &&
                c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        })[0];
        if (nearCarrier && creep.store[RESOURCE_ENERGY] > 0) {
            creep.transfer(nearCarrier, RESOURCE_ENERGY);
            return;
        }

        this.stepAsideFromRoad(creep);
    },

    target: function (creep: Creep): boolean {
        this.build(creep);
        if (creep.store.getUsedCapacity() === 0) {
            creep.say('SRC');
            return true;
        }
        return false;
    },

    source: function (creep: Creep): boolean {
        this.harvest(creep);
        if (creep.store.getFreeCapacity() === 0) {
            creep.say('BLD');
            return true;
        }
        return false;
    }
};

export default outBuild;
