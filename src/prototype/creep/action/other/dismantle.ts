type DismantleMode = 'clean' | 'route';

type DismantleMemory = CreepMemory & {
    dismantleMode?: DismantleMode;
    targetRoom?: string;
    targetId?: Id<Structure> | null;
    idleUntil?: number;
    noPathIds?: Id<Structure>[];
    routeProgress?: {
        storage?: boolean;
        terminal?: boolean;
    };
    boosted?: boolean;
    boostRetryAt?: number;
    boostmap?: any;
};

const isEdge = (pos: RoomPosition) => pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49;

const getMode = (creep: Creep, mem: DismantleMemory): DismantleMode => {
    if (mem.dismantleMode) return mem.dismantleMode;
    if (mem.role === 'cleaner') return 'clean';
    return 'route';
};

const ensureNotified = (creep: Creep, mem: DismantleMemory) => {
    if (mem.notified) return;
    creep.notifyWhenAttacked(false);
    mem.notified = true;
};

const ensureCommonMemory = (mem: DismantleMemory) => {
    if (!mem.noPathIds) mem.noPathIds = [];
    if (!mem.routeProgress) mem.routeProgress = {};
};

const ensureInTargetRoom = (creep: Creep, mem: DismantleMemory): boolean => {
    if (!mem.targetRoom) return false;
    if (creep.room.name !== mem.targetRoom || isEdge(creep.pos)) {
        creep.moveToRoom(mem.targetRoom);
        return false;
    }
    return true;
};

const ensureBoostIfNeeded = (creep: Creep, mem: DismantleMemory, mode: DismantleMode): boolean => {
    if (mode !== 'route') return true;
    if (mem.boosted) return true;

    const retryAt = typeof mem.boostRetryAt === 'number' ? mem.boostRetryAt : 0;
    if (Game.time < retryAt) return false;

    // route 模式需要尽快拆通路，否则搬运/推进会拖太久，所以优先抢 boost
    const boostmap = mem.boostmap || {
        [WORK]: ['XZH2O', 'ZH2O', 'ZH'],
        [MOVE]: ['XZHO2', 'ZHO2', 'ZO'],
    };
    const ret = creep.goBoost(boostmap);
    if (ret === OK) {
        mem.boosted = true;
        return true;
    }

    mem.boostRetryAt = Game.time + 50;
    return false;
};

const digCostFromHits = (hits: number): number => {
    if (!hits || hits <= 0) return 5;
    const scaled = Math.floor(hits / 50000);
    return Math.min(60, 5 + scaled);
};

const isBlockingOnTile = (s: Structure): boolean => {
    if (s.structureType === STRUCTURE_ROAD) return false;
    if (s.structureType === STRUCTURE_CONTAINER) return false;
    if (s.structureType === STRUCTURE_RAMPART) {
        const r = s as StructureRampart;
        return !r.my && !r.isPublic;
    }
    return true;
};

const pickBestOnTile = (list: Structure[]): Structure | undefined => {
    const rampart = list.find(s => s.structureType === STRUCTURE_RAMPART) as StructureRampart | undefined;
    if (rampart) return rampart;
    let best: Structure | undefined;
    let bestHits = Infinity;
    for (const s of list) {
        if (s.hits < bestHits) {
            bestHits = s.hits;
            best = s;
        }
    }
    return best;
};

const findNextObstacleToward = (creep: Creep, goal: RoomPosition, range: number): Structure | undefined => {
    const search = PathFinder.search(
        creep.pos,
        { pos: goal, range },
        {
            maxRooms: 1,
            plainCost: 2,
            swampCost: 10,
            roomCallback: (roomName: string) => {
                if (roomName !== creep.room.name) return false;

                const costs = new PathFinder.CostMatrix();
                for (const s of creep.room.find(FIND_STRUCTURES)) {
                    if (s.structureType === STRUCTURE_ROAD) {
                        costs.set(s.pos.x, s.pos.y, 1);
                        continue;
                    }
                    if (s.structureType === STRUCTURE_CONTAINER) {
                        costs.set(s.pos.x, s.pos.y, 1);
                        continue;
                    }
                    if (s.structureType === STRUCTURE_RAMPART) {
                        const r = s as StructureRampart;
                        if (r.my || r.isPublic) {
                            costs.set(s.pos.x, s.pos.y, 1);
                        } else {
                            costs.set(s.pos.x, s.pos.y, digCostFromHits(s.hits));
                        }
                        continue;
                    }
                    costs.set(s.pos.x, s.pos.y, digCostFromHits(s.hits));
                }
                return costs;
            },
        }
    );

    if (!search.path || search.path.length === 0) return undefined;

    // 为了逐段推进，选择路径上离自己最近的那一个“阻挡结构”先拆
    for (const step of search.path) {
        const structures = step.lookFor(LOOK_STRUCTURES) as Structure[];
        const blocking = structures.filter(isBlockingOnTile);
        const best = pickBestOnTile(blocking);
        if (best) return best;
    }

    return undefined;
};

const pickCleanTarget = (creep: Creep, mem: DismantleMemory): Structure | undefined => {
    const room = creep.room;
    const structures = room.find(FIND_STRUCTURES) as Structure[];
    if (!structures.length) return undefined;

    let best: Structure | undefined;
    let bestScore = Infinity;

    const storage = room.storage;
    const terminal = room.terminal;

    for (const s of structures) {
        if (mem.noPathIds!.includes(s.id)) continue;
        if (s.structureType === STRUCTURE_CONTROLLER) continue;

        const range = creep.pos.getRangeTo(s.pos);
        let penalty = 0;

        // 先拆“好拆的”，把大血量的拆除留到后面，提升整体推进效率
        if (s.structureType === STRUCTURE_ROAD) penalty += 5_000_000;
        if (s.structureType === STRUCTURE_CONTAINER) penalty += 4_000_000;
        if (storage && s.id === storage.id && storage.store.getUsedCapacity() > 0) penalty += 3_000_000;
        if (terminal && s.id === terminal.id && terminal.store.getUsedCapacity() > 0) penalty += 3_000_000;

        const score = penalty + range * 5_000 + s.hits;
        if (score < bestScore) {
            bestScore = score;
            best = s;
        }
    }
    return best;
};

const dismantle = {
    run: function (creep: Creep) {
        const mem = creep.memory as DismantleMemory;
        ensureNotified(creep, mem);
        ensureCommonMemory(mem);

        if (!ensureInTargetRoom(creep, mem)) return;
        if (creep.room.my) return;

        if (mem.idleUntil && Game.time < mem.idleUntil) return;

        const mode = getMode(creep, mem);
        if (!ensureBoostIfNeeded(creep, mem, mode)) return;

        if (mode === 'route') {
            const room = creep.room;
            const storage = room.storage;
            const terminal = room.terminal;
            const terminalHasRes = !!terminal && terminal.store.getUsedCapacity() > 0;

            // 先拆通到 storage/terminal 的路，才能让后续搬运快速进场回收资源
            if (storage && !mem.routeProgress!.storage) {
                const obstacle = findNextObstacleToward(creep, storage.pos, 1);
                if (obstacle) {
                    mem.targetId = obstacle.id;
                } else {
                    const onStorage = storage.pos.lookFor(LOOK_STRUCTURES) as Structure[];
                    const rampartOnStorage = onStorage.find(s => s.structureType === STRUCTURE_RAMPART && isBlockingOnTile(s)) as Structure | undefined;
                    if (rampartOnStorage) mem.targetId = rampartOnStorage.id;
                    else mem.routeProgress!.storage = true;
                }
            }

            if (terminalHasRes && terminal && mem.routeProgress!.storage && !mem.routeProgress!.terminal) {
                const obstacle = findNextObstacleToward(creep, terminal.pos, 1);
                if (obstacle) {
                    mem.targetId = obstacle.id;
                } else {
                    const onTerminal = terminal.pos.lookFor(LOOK_STRUCTURES) as Structure[];
                    const rampartOnTerminal = onTerminal.find(s => s.structureType === STRUCTURE_RAMPART && isBlockingOnTile(s)) as Structure | undefined;
                    if (rampartOnTerminal) mem.targetId = rampartOnTerminal.id;
                    else mem.routeProgress!.terminal = true;
                }
            }
        }

        let target = mem.targetId ? (Game.getObjectById(mem.targetId) as Structure | null) : null;
        if (!target) {
            mem.targetId = null;
            target = pickCleanTarget(creep, mem) || null;
            if (target) mem.targetId = target.id;
        }

        if (!target) {
            mem.idleUntil = Game.time + 10;
            return;
        }

        if (creep.pos.isNearTo(target)) {
            creep.dismantle(target);
            return;
        }

        const moveRet = creep.moveTo(target, { maxRooms: 1, range: 1, ignoreCreeps: true });
        if (moveRet === ERR_NO_PATH) {
            mem.noPathIds!.push(target.id);
            mem.targetId = null;
            mem.idleUntil = Game.time + 1;
        }
    }
};

export default dismantle;
