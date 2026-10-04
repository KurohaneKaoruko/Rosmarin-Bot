/**
 * 孵化消费循环：preTick 建立空闲 spawn 池 → 管理器发请求 → manageSpawn 按优先级弹出消费。
 * 口径：能量不足且超房型容量 → 请求丢弃；能量不足但房型可造 → 挂起等待；
 * spawnBalance 无仓期 EMA 平滑（搬运空闲 +1 / 升级取能落空 -1）；spawnUsage EMA（寿命窗口）。
 */
import { ROLES } from './constants';
import { getBodyCost } from './creepUtils';
import { GenCreepName } from '@/modules/utils';
import { clearRushCreepHeap, getRushTickState } from './roomState';
import type { RushSpawnRequest } from './types';

/** spawnUsage EMA 窗口（= creep 寿命） */
const CREEP_LIFE_TIME = 1500;
const SPAWN_USAGE_ALPHA = 2 / (CREEP_LIFE_TIME + 1);

/** spawnBalance 半衰 50 tick 的 EMA 系数 */
const SPAWN_BALANCE_RATIO = Math.pow(2, -1 / 50);

/**
 * 每 tick 预处理：重建空闲 spawn 池与花名册；无仓期保证 spawnBalance 存在、有仓期清除。
 * 在各管理器发请求之前调用。
 */
export const pretickSpawn = (room: Room): void => {
    const spawns = room.find(FIND_MY_SPAWNS);
    const state = getRushTickState(room);

    state.freeSpawns = [];
    state.numSpawns = spawns.length;
    state.canSpawn = false;

    const mem = room.memory as any;
    if (!room.storage) {
        mem.spawnBalance = mem.spawnBalance || 1;
    } else if (mem.spawnBalance) {
        delete mem.spawnBalance;
    }

    for (const spawn of spawns) {
        if (!spawn.spawning && spawn.isActive()) {
            state.freeSpawns.push(spawn);
            state.canSpawn = true;
        }
    }

    cacheCreeps(room);
};

/**
 * 孵化消费主循环：管理器全部发完请求后调用，每房一次。
 */
export const runSpawnManager = (room: Room): void => {
    const state = getRushTickState(room);
    const mem = room.memory as any;

    if (state.numSpawns === 0) return;

    if (!room.storage) {
        const target = (state.spawnBalanceAdded ? 1 : 0) - (state.spawnBalanceSubtracted ? 1 : 0);
        const alpha = 1 - SPAWN_BALANCE_RATIO;
        mem.spawnBalance = mem.spawnBalance * (1 - alpha) + target * alpha;
    }

    const queue = state.spawnQueue;

    outer: while (state.freeSpawns.length > 0 && queue.getSize() > 0) {
        const spawn = state.freeSpawns.pop()!;

        while (queue.getSize() > 0) {
            const nextRequest = queue.remove()!;

            const result = spawnByRequest(room, spawn, nextRequest);

            if (result === OK) {
                continue outer;
            }

            if (result === ERR_NOT_ENOUGH_ENERGY) {
                state.freeSpawns.push(spawn);
                break outer;
            }

            // 其他结果码：该请求本房型造不出或名字冲突等，直接丢弃不回队
            continue;
        }

        state.freeSpawns.push(spawn);
    }

    const currentSpawnUsage = 1 - state.freeSpawns.length / state.numSpawns;
    const existingSpawnUsage = mem.spawnUsage || 0;
    mem.spawnUsage = existingSpawnUsage * (1 - SPAWN_USAGE_ALPHA) + currentSpawnUsage * SPAWN_USAGE_ALPHA;
};

/** 记账信号：搬运空闲（spawnBalance 加码方向） */
export const markSpawnBalanceAdded = (room: Room): void => {
    getRushTickState(room).spawnBalanceAdded = true;
};

/** 记账信号：升级取能落空（spawnBalance 减码方向） */
export const markSpawnBalanceSubtracted = (room: Room): void => {
    getRushTickState(room).spawnBalanceSubtracted = true;
};

/**
 * 单次孵化执行：成功登记花名册；能量不足时按「超房型容量 → 丢弃」规则改写结果码。
 */
const spawnByRequest = (room: Room, spawn: StructureSpawn, request: RushSpawnRequest): ScreepsReturnCode => {
    const roleInitial = ROLES[request.taskType]?.[request.memory.role] ?? '?';

    const name = request.name || generateCreepName(roleInitial, room.name);

    let result = spawn.spawnCreep(request.body, name, { memory: request.memory });

    if (result === OK) {
        registerRequest(request, name);
    } else if (result === ERR_NOT_ENOUGH_ENERGY) {
        if (getBodyCost(request.body) > room.energyCapacityAvailable) {
            // 本房型造不出的体型：直接丢弃
            result = ERR_INVALID_TARGET;
        }
    }

    return result;
};

/** 生成唯一名：本地命名约定（GenCreepName），角色短码作类型代码 */
const generateCreepName = (roleInitial: string, _roomName: string): string => GenCreepName(roleInitial);

/** 登记到房间花名册（cacheCreeps 每 tick 重建在岗 roster 并清理亡者） */
const registerRequest = (request: RushSpawnRequest, name: string): void => {
    const mem = Memory.rooms[request.roomName] as any;
    if (!mem) return;
    mem.creepNames = mem.creepNames || [];
    mem.creepNames.push(name);
};

/** 重建角色花名册：过滤亡者（顺带清 Memory），按角色分组挂到每 tick 态 */
const cacheCreeps = (room: Room): void => {
    const state = getRushTickState(room);
    state.creeps = {};

    const mem = room.memory as any;
    if (!mem.creepNames) return;

    mem.creepNames = (mem.creepNames as string[]).filter((creepName) => {
        const creep = Game.creeps[creepName];

        if (!creep) {
            delete Memory.creeps[creepName];
            clearRushCreepHeap(creepName);
            return false;
        }

        const role = creep.memory.role || 'idler';

        state.creeps[role] = state.creeps[role] || [];
        state.creeps[role].push(creep);

        return true;
    });
};

/** 取某角色在岗 creep（preTick 后有效） */
export const getCreepsByRole = (room: Room, role: string): Creep[] => {
    return getRushTickState(room).creeps[role] || [];
};
