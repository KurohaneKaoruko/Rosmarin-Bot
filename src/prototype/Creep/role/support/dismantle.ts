type DismantleMode = 'clean' | 'route';

// 孵化配置与框架字段：留在 memory 顶层
type DismantleMemory = CreepMemory & {
    dismantleMode?: DismantleMode;
    targetRoom?: string;
    boosted?: boolean;
    boostmap?: any;
};

// 角色私有执行态：统一写 cache.role
type DismantleState = {
    notified?: boolean;
    targetId?: Id<Structure> | null;
    idleUntil?: number;
    noPathIds?: Id<Structure>[];
    routeProgress?: {
        storage?: boolean;
        terminal?: boolean;
    };
    boostRetryAt?: number;
};

const isEdge = (pos: RoomPosition) => pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49;

const getMode = (_creep: Creep, mem: DismantleMemory): DismantleMode => {
    if (mem.dismantleMode) return mem.dismantleMode;
    if (mem.role === 'cleaner') return 'clean';
    return 'route';
};

const ensureNotified = (creep: Creep, state: DismantleState) => {
    if (state.notified) return;
    creep.disableAttackNotificationsOnce();
    state.notified = true;
};

const ensureCommonMemory = (state: DismantleState) => {
    if (!state.noPathIds) state.noPathIds = [];
    if (!state.routeProgress) state.routeProgress = {};
};

const ensureInTargetRoom = (creep: Creep, mem: DismantleMemory): boolean => {
    if (!mem.targetRoom) return false;
    if (creep.room.name !== mem.targetRoom || isEdge(creep.pos)) {
        creep.moveToRoom(mem.targetRoom);
        return false;
    }
    return true;
};

const ensureBoostIfNeeded = (creep: Creep, mem: DismantleMemory, state: DismantleState, mode: DismantleMode): boolean => {
    if (mode !== 'route') return true;
    if (mem.boosted) return true;

    const retryAt = typeof state.boostRetryAt === 'number' ? state.boostRetryAt : 0;
    if (Game.time < retryAt) return false;

    // route 模式需要尽快拆通路，所以优先抢 boost
    const boosted = creep.ensureBoosted(
        mem.boostmap ?? { [WORK]: ['XZH2O', 'ZH2O', 'ZH'], [MOVE]: ['XZHO2', 'ZHO2', 'ZO'] }
    );
    if (boosted) return true;

    state.boostRetryAt = Game.time + 50;
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

const pickCleanTarget = (creep: Creep, state: DismantleState): Structure | undefined => {
    const room = creep.room;
    const structures = room.find(FIND_STRUCTURES) as Structure[];
    if (!structures.length) return undefined;

    let best: Structure | undefined;
    let bestScore = Infinity;

    const storage = room.storage;
    const terminal = room.terminal;

    for (const s of structures) {
        if (state.noPathIds!.includes(s.id)) continue;
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

// route 模式：优先打通到 storage/terminal 的路线
const updateRouteTarget = (creep: Creep, state: DismantleState) => {
    const room = creep.room;
    const storage = room.storage;
    const terminal = room.terminal;
    const terminalHasRes = !!terminal && terminal.store.getUsedCapacity() > 0;

    if (storage && !state.routeProgress!.storage) {
        const obstacle = findNextObstacleToward(creep, storage.pos, 1);
        if (obstacle) {
            state.targetId = obstacle.id;
        } else {
            const onStorage = storage.pos.lookFor(LOOK_STRUCTURES) as Structure[];
            const rampartOnStorage = onStorage.find(s => s.structureType === STRUCTURE_RAMPART && isBlockingOnTile(s)) as Structure | undefined;
            if (rampartOnStorage) state.targetId = rampartOnStorage.id;
            else state.routeProgress!.storage = true;
        }
    }

    if (terminalHasRes && terminal && state.routeProgress!.storage && !state.routeProgress!.terminal) {
        const obstacle = findNextObstacleToward(creep, terminal.pos, 1);
        if (obstacle) {
            state.targetId = obstacle.id;
        } else {
            const onTerminal = terminal.pos.lookFor(LOOK_STRUCTURES) as Structure[];
            const rampartOnTerminal = onTerminal.find(s => s.structureType === STRUCTURE_RAMPART && isBlockingOnTile(s)) as Structure | undefined;
            if (rampartOnTerminal) state.targetId = rampartOnTerminal.id;
            else state.routeProgress!.terminal = true;
        }
    }
};

// 统一执行拆除目标
const resolveTargetAndDismantle = (creep: Creep, state: DismantleState) => {
    let target = state.targetId ? Game.getObjectById(state.targetId) : null;
    if (!target) {
        state.targetId = null;
        target = pickCleanTarget(creep, state) || null;
        if (target) state.targetId = target.id;
    }

    if (!target) {
        state.idleUntil = Game.time + 10;
        return;
    }

    if (creep.pos.isNearTo(target)) {
        creep.dismantle(target);
        return;
    }

    const moveRet = creep.moveTo(target, { maxRooms: 1, range: 1, ignoreCreeps: true });
    if (moveRet === ERR_NO_PATH) {
        state.noPathIds!.push(target.id);
        state.targetId = null;
        state.idleUntil = Game.time + 1;
    }
};

const runDismantleMode = (creep: Creep, mem: DismantleMemory, state: DismantleState, mode: DismantleMode) => {
    if (mode === 'route') {
        updateRouteTarget(creep, state);
    }
    resolveTargetAndDismantle(creep, state);
};

const dismantle = {
    run: function (creep: Creep) {
        const mem = creep.memory as DismantleMemory;
        const state = creep.getRoleCache() as DismantleState;
        ensureNotified(creep, state);
        ensureCommonMemory(state);

        if (!ensureInTargetRoom(creep, mem)) return;
        if (creep.room.my) return;

        if (state.idleUntil && Game.time < state.idleUntil) return;

        const mode = getMode(creep, mem);
        if (!ensureBoostIfNeeded(creep, mem, state, mode)) return;
        runDismantleMode(creep, mem, state, mode);
    }
};

export default dismantle;
