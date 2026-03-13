import { parseShardRoomName } from '@/modules/utils/shardRoom';
import { THRESHOLDS } from '@/constant/Thresholds';

type AidBuildSourceCandidate = {
    id: string;
    assigned: number;
    walkable: number;
    distance: number;
    current?: boolean;
};

type AidBuildOccupantLike = {
    memory?: {
        targetSourceId?: Id<Source>;
        spawnFlag?: string;
        action?: string;
    };
    store?: StoreDefinition;
};

const AID_BUILD_WAITABLE_STRUCTURES = new Set<StructureConstant>([
    'road',
    'container',
    'rampart',
]);

export function chooseAidBuildSourceId(candidates: AidBuildSourceCandidate[]): string | null {
    const available = candidates.filter((candidate) => candidate.walkable > 0 && candidate.assigned < candidate.walkable);
    if (available.length <= 0) return null;

    const current = available.find((candidate) => candidate.current);
    if (current) {
        const minAssigned = Math.min(...available.map((candidate) => candidate.assigned));
        if (current.assigned <= minAssigned + 1) return current.id;
    }

    available.sort((a, b) => {
        const aLoad = a.assigned / Math.max(1, a.walkable);
        const bLoad = b.assigned / Math.max(1, b.walkable);
        if (aLoad !== bLoad) return aLoad - bLoad;
        if (a.assigned !== b.assigned) return a.assigned - b.assigned;
        if (a.walkable !== b.walkable) return b.walkable - a.walkable;
        return a.distance - b.distance;
    });

    return available[0]?.id || null;
}

export function shouldReserveAidBuildSource(occupant: AidBuildOccupantLike, focusFlag?: string): boolean {
    const memory = occupant?.memory;
    if (!memory?.targetSourceId) return false;
    if (focusFlag && memory.spawnFlag !== focusFlag) return false;

    const action = memory.action;
    if (action === 'harvest') return true;
    if (action !== 'stage') return false;

    const freeCapacity = occupant.store?.getFreeCapacity?.() ?? 0;
    const usedCapacity = occupant.store?.getUsedCapacity?.() ?? 0;
    return freeCapacity > 0 || usedCapacity === 0;
}

export function getAidBuildWaitSlotIndex(waiterNames: string[], creepName: string, slotCount: number): number {
    if (slotCount <= 0) return -1;
    const ordered = [...new Set([...waiterNames, creepName])].sort();
    const index = ordered.indexOf(creepName);
    return (index >= 0 ? index : 0) % slotCount;
}

const releaseAidBuildSource = (creep: Creep) => {
    if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
};

export const shouldForceAidBuildDowngradeUpgrade = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my) return false;
    const ttd = controller.ticksToDowngrade || 0;
    return ttd < THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TTD;
};

const getAidBuildEnergyState = (room: Room): NonNullable<RoomMemory['energyState']> => {
    return room.getEnergyState?.() || room.updateEnergyState?.(false) || room.memory?.energyState || 'NORMAL';
};

const getAidBuildTotalEnergy = (room: Room) => {
    const profile = room.getEnergyProfile?.();
    if (profile) return profile.totalEnergy;
    const containerEnergy = (room.container || []).reduce((sum, container) => sum + (container.store[RESOURCE_ENERGY] || 0), 0);
    const linkEnergy = (room.link || []).reduce((sum, link) => sum + (link.store[RESOURCE_ENERGY] || 0), 0);
    return ((room as any)[RESOURCE_ENERGY] || 0) + containerEnergy + linkEnergy;
};

const getAidBuildStoredEnergy = (room: Room) => {
    return (room.storage?.store[RESOURCE_ENERGY] || 0) + (room.terminal?.store[RESOURCE_ENERGY] || 0);
};

const getAidBuildUpgradeReserve = (room: Room) => {
    const level = room.controller?.level || room.level || 0;
    if (level >= 7) return 60000;
    if (level >= 6) return 40000;
    if (level >= 5) return 20000;
    return 10000;
};

const shouldAidBuildNormalUpgrade = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my || controller.level >= 8) return false;
    if (controller.level < 4) return true;

    const state = getAidBuildEnergyState(room);
    if (state === 'CRITICAL' || state === 'LOW') return false;

    const reserve = getAidBuildUpgradeReserve(room);
    const storedEnergy = getAidBuildStoredEnergy(room);
    if (storedEnergy >= reserve) return true;

    if (!room.storage) return false;

    return state === 'SURPLUS' && getAidBuildTotalEnergy(room) >= reserve;
};

const canAidBuildUpgrade = (room: Room) => {
    if (shouldForceAidBuildDowngradeUpgrade(room)) return true;
    return shouldAidBuildNormalUpgrade(room);
};

const getAidBuildStageStoreTarget = (creep: Creep) => {
    if (creep.room.storage?.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return creep.room.storage;
    if (creep.room.terminal?.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return creep.room.terminal;
    const containers = [...(creep.room.container || [])]
        .filter((container) => container.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    if (containers.length <= 0) return null;
    return creep.pos.findClosestByRange(containers) as StructureContainer | null;
};

const getAidBuildPosKey = (pos: RoomPosition) => `${pos.x}/${pos.y}/${pos.roomName}`;

const parseAidBuildPosKey = (key?: string): RoomPosition | null => {
    if (!key) return null;
    const [xRaw, yRaw, roomName] = key.split('/');
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !roomName) return null;
    return new RoomPosition(x, y, roomName);
};

const isBlockingAidBuildWaitPos = (pos: RoomPosition): boolean => {
    const structures = pos.lookFor(LOOK_STRUCTURES);
    if (structures.some((s) => !AID_BUILD_WAITABLE_STRUCTURES.has(s.structureType))) return true;

    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    if (sites.some((s) => !AID_BUILD_WAITABLE_STRUCTURES.has(s.structureType))) return true;

    return false;
};

const getAidBuildSpreadCandidates = (
    room: Room,
    anchorPos: RoomPosition,
    ranges: number[],
    avoidPos?: RoomPosition
): RoomPosition[] => {
    const terrain = room.getTerrain();
    const positions: RoomPosition[] = [];

    for (const range of ranges) {
        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== range) continue;
                const x = anchorPos.x + dx;
                const y = anchorPos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                if (avoidPos && avoidPos.roomName === room.name && avoidPos.x === x && avoidPos.y === y) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                const pos = new RoomPosition(x, y, room.name);
                if (isBlockingAidBuildWaitPos(pos)) continue;
                positions.push(pos);
            }
        }
    }

    return positions;
};

const getAidBuildAssignedTargetPos = (
    creep: Creep,
    anchorPos: RoomPosition,
    ranges: number[],
    avoidPos?: RoomPosition
): RoomPosition | null => {
    const candidates = getAidBuildSpreadCandidates(creep.room, anchorPos, ranges, avoidPos);
    if (candidates.length <= 0) return null;

    const queueMembers = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) =>
            c.memory.role === creep.memory.role &&
            c.memory.jumpMode === creep.memory.jumpMode &&
            c.memory.targetRoom === creep.memory.targetRoom &&
            c.memory.spawnFlag === creep.memory.spawnFlag
    });
    const slotIndex = getAidBuildWaitSlotIndex(queueMembers.map((c) => c.name), creep.name, candidates.length);

    for (let offset = 0; offset < candidates.length; offset++) {
        const candidate = candidates[(slotIndex + offset) % candidates.length];
        const creeps = candidate.lookFor(LOOK_CREEPS);
        const powerCreeps = candidate.lookFor(LOOK_POWER_CREEPS);
        const blockedByOther = creeps.some((c) => c.id !== creep.id) || powerCreeps.length > 0;
        if (!blockedByOther || creep.pos.isEqualTo(candidate)) return candidate;
    }

    return candidates[slotIndex] || null;
};

const getAidBuildWaitTargetPos = (
    creep: Creep,
    anchorPos: RoomPosition,
    preferTight: boolean,
    avoidPos?: RoomPosition
) => {
    return getAidBuildAssignedTargetPos(creep, anchorPos, preferTight ? [1, 2] : [2, 1], avoidPos);
};

const getAidBuildUpgradeTargetPos = (creep: Creep, controller: StructureController) => {
    return getAidBuildAssignedTargetPos(creep, controller.pos, [3, 2, 1]);
};

const getStableAidBuildUpgradeTargetPos = (creep: Creep, controller: StructureController): RoomPosition | null => {
    const cached = parseAidBuildPosKey((creep.memory.cache as any)?.upgradePos);
    if (
        cached &&
        cached.roomName === creep.room.name &&
        cached.inRangeTo(controller, 3) &&
        !isBlockingAidBuildWaitPos(cached)
    ) {
        return cached;
    }
    return getAidBuildUpgradeTargetPos(creep, controller);
};

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
                return;
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
        const controller = creep.room.controller;
        const isJumpMode = !!creep.memory.jumpMode;
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
            releaseAidBuildSource(creep);
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
                releaseAidBuildSource(creep);
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
            releaseAidBuildSource(creep);
            creep.memory.action = '';
            return;
        }
        if (!targetSource) {
            if (isJumpMode && !controller?.my) this.yieldJumpQueue(creep);
            return;
        }

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
        releaseAidBuildSource(creep);
        creep.memory.action = '';
    },

    build: function (creep: Creep) {
        releaseAidBuildSource(creep);
        const controller = creep.room.controller;
        const isJumpMode = !!creep.memory.jumpMode;
        const hasSpawn = creep.room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_SPAWN
        }).length > 0;
        const hasSpawnSite = creep.room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s) => s.structureType === STRUCTURE_SPAWN
        }).length > 0;
        const shouldForceSpawnFirst = isJumpMode && !hasSpawn && hasSpawnSite;

        if (shouldForceAidBuildDowngradeUpgrade(creep.room)) {
            creep.memory.action = 'upgrade';
            return;
        }

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

        const earlyRoomPriority = [
            STRUCTURE_SPAWN,
            STRUCTURE_EXTENSION,
            STRUCTURE_TOWER,
            STRUCTURE_CONTAINER,
            STRUCTURE_ROAD,
            STRUCTURE_STORAGE,
            STRUCTURE_TERMINAL
        ];
        const jumpPriority = [
            STRUCTURE_SPAWN,
            STRUCTURE_EXTENSION,
            STRUCTURE_TOWER,
            STRUCTURE_STORAGE,
            STRUCTURE_TERMINAL,
            STRUCTURE_CONTAINER,
            STRUCTURE_ROAD
        ];
        const defaultPriority = [
            STRUCTURE_SPAWN,
            STRUCTURE_STORAGE,
            STRUCTURE_TERMINAL,
            STRUCTURE_EXTENSION,
            STRUCTURE_TOWER,
            STRUCTURE_CONTAINER,
            STRUCTURE_ROAD
        ];
        const isEarlyOwnedRoom = !!controller?.my && controller.level <= 4;
        const buildPriority = shouldForceSpawnFirst
            ? jumpPriority
            : (isEarlyOwnedRoom ? earlyRoomPriority : (isJumpMode ? jumpPriority : defaultPriority));

        // 使用 findAndBuild 方法查找并建造
        if (!creep.findAndBuild({
            priority: buildPriority
        })) {
            creep.memory.action = '';
        }
    },

    repair: function (creep: Creep) {
        releaseAidBuildSource(creep);
        const controller = creep.room.controller;
        if (!controller?.my) {
            creep.memory.action = 'stage';
            return;
        }
        if (shouldForceAidBuildDowngradeUpgrade(creep.room)) {
            creep.memory.action = 'upgrade';
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
        releaseAidBuildSource(creep);
        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = '';
            return;
        }

        const controller = creep.room.controller;
        if (!controller?.my) {
            creep.memory.action = 'stage';
            return;
        }

        if (!canAidBuildUpgrade(creep.room)) {
            creep.memory.action = '';
            return;
        }

        if (!creep.memory.cache) creep.memory.cache = {};

        if (creep.pos.inRangeTo(controller, 3)) {
            (creep.memory.cache as any).upgradePos = getAidBuildPosKey(creep.pos);
            creep.upgradeController(controller);
            return;
        }

        const upgradePos = getStableAidBuildUpgradeTargetPos(creep, controller);
        if (upgradePos) {
            (creep.memory.cache as any).upgradePos = getAidBuildPosKey(upgradePos);
            creep.moveTo(upgradePos, { range: 0, maxRooms: 1, reusePath: 0 });
            return;
        }

        delete (creep.memory.cache as any).upgradePos;
        creep.moveTo(controller, { maxRooms: 1, range: 3 });
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
        const isJumpMode = !!creep.memory.jumpMode;
        const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
        if (creep.store[RESOURCE_ENERGY] > 0) {
            if (shouldForceAidBuildDowngradeUpgrade(creep.room)) {
                creep.memory.action = 'upgrade';
                return;
            }
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
            if (controller?.my && canAidBuildUpgrade(creep.room)) {
                creep.memory.action = 'upgrade';
                return;
            }
        }

        const storeTarget = getAidBuildStageStoreTarget(creep);
        const source = this.getBalancedSource(creep);
        const hasBuildSite = creep.room.find(FIND_CONSTRUCTION_SITES).length > 0;
        const canUpgrade = canAidBuildUpgrade(creep.room);
        const hasEnergySink = !!storeTarget || hasBuildSite || canUpgrade;

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

            if (storeTarget && !creep.pos.inRangeTo(storeTarget, 1)) {
                // 没有可采目标时，先靠近囤能点等待机会
                if (isJumpMode && !controller?.my) this.yieldJumpQueue(creep, storeTarget.pos);
                else creep.moveTo(storeTarget, { range: 1, maxRooms: 1 });
                return;
            }
            if (isJumpMode && !controller?.my) this.yieldJumpQueue(creep);
            return;
        }

        // 囤积阶段优先把自己采满，避免“采几下就去存”反复来回。
        if (creep.store.getFreeCapacity() > 0 && source && source.energy > 0) {
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { maxRooms: 1 });
            }
            return;
        }

        if (storeTarget) {
            if (creep.pos.inRangeTo(storeTarget, 1)) {
                creep.transfer(storeTarget, RESOURCE_ENERGY);
            } else {
                creep.moveTo(storeTarget, { range: 1, maxRooms: 1 });
            }
            return;
        }

        // 无容器时，允许落地囤积
        creep.drop(RESOURCE_ENERGY);
    },

    yieldJumpQueue: function (creep: Creep, avoidPos?: RoomPosition): boolean {
        let anchorPos: RoomPosition | null = null;
        let preferTight = false;
        if (avoidPos && avoidPos.roomName === creep.room.name && !avoidPos.isRoomEdge()) {
            anchorPos = avoidPos;
            preferTight = true;
        } else {
            const spawnFlagName = creep.memory.spawnFlag;
            const spawnFlag = spawnFlagName ? Game.flags[spawnFlagName] : null;
            if (spawnFlag?.pos.roomName === creep.room.name && !spawnFlag.pos.isRoomEdge()) {
                anchorPos = spawnFlag.pos;
            } else if (creep.room.controller && !creep.room.controller.pos.isRoomEdge()) {
                anchorPos = creep.room.controller.pos;
            } else {
                anchorPos = new RoomPosition(25, 25, creep.room.name);
            }
        }

        const queuePos = getAidBuildWaitTargetPos(creep, anchorPos, preferTight, avoidPos);
        if (queuePos) {
            if (!creep.pos.isEqualTo(queuePos)) {
                creep.moveTo(queuePos, { range: 0, maxRooms: 1, reusePath: 0 });
            }
            return true;
        }

        creep.moveTo(anchorPos, { range: 2, maxRooms: 1, reusePath: 0 });
        return true;
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
        const walkableSlots: Record<string, number> = {};
        const terrain = creep.room.getTerrain();
        for (const s of activeSources) counts[s.id] = 0;
        for (const source of activeSources) {
            let walkable = 0;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const x = source.pos.x + dx;
                    const y = source.pos.y + dy;
                    if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                    if (terrain.get(x, y) !== TERRAIN_MASK_WALL) walkable++;
                }
            }
            walkableSlots[source.id] = Math.max(1, walkable);
        }
        for (const c of sameRole) {
            if (!shouldReserveAidBuildSource(c as AidBuildOccupantLike, focusFlag)) continue;
            const sid = c.memory.targetSourceId as Id<Source> | undefined;
            if (!sid || counts[sid] == null) continue;
            counts[sid]++;
        }

        const selectedId = chooseAidBuildSourceId(activeSources.map((source) => ({
            id: source.id,
            assigned: counts[source.id] || 0,
            walkable: walkableSlots[source.id] || 1,
            distance: creep.pos.getRangeTo(source),
            current: !!current && current.id === source.id
        })));
        if (!selectedId) {
            delete creep.memory.targetSourceId;
            return null;
        }

        const pickedSource = activeSources.find((source) => source.id === selectedId);
        if (!pickedSource) {
            delete creep.memory.targetSourceId;
            return null;
        }
        creep.setBoundSourceId(pickedSource.id);
        return pickedSource;

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
        const owned = !!controller?.my;
        const canUpgrade = canAidBuildUpgrade(creep.room);
        const site = creep.room.find(FIND_CONSTRUCTION_SITES);
        const isJumpMode = !!creep.memory.jumpMode;

        if (!owned && site.length === 0) {
            creep.memory.action = 'stage';
            return;
        }

        if (creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.action = 'harvest';
            return;
        }

        if (!owned) {
            releaseAidBuildSource(creep);
            creep.memory.action = 'build';
            return;
        }

        if (shouldForceAidBuildDowngradeUpgrade(creep.room)) {
            releaseAidBuildSource(creep);
            creep.memory.action = 'upgrade';
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
                releaseAidBuildSource(creep);
                creep.memory.action = 'upgrade';
                return;
            }
        }

        if (site.length > 0) {
            releaseAidBuildSource(creep);
            creep.memory.action = 'build';
            return;
        }

        const repair = creep.room.find(FIND_STRUCTURES, {
            filter: (s) => s.hits < s.hitsMax * 0.8 &&
                s.structureType != STRUCTURE_ROAD &&
                s.structureType != STRUCTURE_CONTAINER
        })
        if (repair.length > 0) {
            releaseAidBuildSource(creep);
            creep.memory.action = 'repair';
            const repairTarget = repair.reduce((a, b) => a.hits < b.hits ? a : b);
            creep.memory.cache.repairTarget = repairTarget.id;
            return;
        }

        if (!canUpgrade) {
            releaseAidBuildSource(creep);
            creep.memory.action = 'stage';
            return;
        }

        releaseAidBuildSource(creep);
        creep.memory.action = 'upgrade';
    }
}
export default aid_build;
