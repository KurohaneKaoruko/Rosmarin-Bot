/**
 * 孵化请求侧工具：优先级公式、请求构造、入队与产能预检。
 * 优先级口径：任务类型 * 1e5 + 任务优先级 * 100 + 角色序（同任务类型内角色表顺序）。
 */
import { ROLES, TASK_PRIORITY } from './constants';
import { getRushTickState } from './roomState';
import type { RushSpawnRequest } from './types';

export type RushSpawnOptions = {
    memory?: any;
    name?: string;
    /** 跨房请求时显式指定登记房；缺省为发起房 */
    roomName?: string;
    /** 同任务类型内的细分优先级（默认 0） */
    taskPriority?: number;
};

/** 任务类型 → 角色 → 角色序（未登记角色为 0） */
const ROLE_PRIORITY: Record<string, Record<string, number>> = {};
for (const [taskType, roles] of Object.entries(ROLES)) {
    const priority: Record<string, number> = {};
    Object.keys(roles).forEach((role, index) => {
        priority[role] = index;
    });
    ROLE_PRIORITY[taskType] = priority;
}

export const getRolePriority = (taskType: string, role: string): number =>
    ROLE_PRIORITY[taskType]?.[role] ?? 0;

/** 组装孵化请求（纯数据，不入队） */
export const createSpawnRequest = (
    room: Room,
    body: BodyPartConstant[],
    role: string,
    taskType: string,
    options: RushSpawnOptions = {},
): RushSpawnRequest => {
    const { memory = {}, name, roomName, taskPriority = 0 } = options;

    memory.role = role;

    const request: RushSpawnRequest = {
        body,
        name,
        memory,
        taskType,
        roomName: roomName ?? room.name,
        priority: 0,
    };

    request.priority =
        (TASK_PRIORITY[taskType] ?? 0) * 100000 + taskPriority * 100 + getRolePriority(taskType, role);

    return request;
};

/** 发起孵化请求：无空闲 spawn 时直接不入队（本 tick 白送，管理器下 tick 重发） */
export const requestCreep = (
    room: Room,
    body: BodyPartConstant[],
    role: string,
    taskType: string,
    options: RushSpawnOptions = {},
): void => {
    const request = createSpawnRequest(room, body, role, taskType, options);
    const state = getRushTickState(room);

    if (state.freeSpawns.length === 0) return;

    state.spawnQueue.insert(request);
};

/**
 * miner 体型（参数化渐堆）：1M 起步 → work 堆到 min(5, maxWork) → move/work<speed 补 M →
 * needCarry 时 carry 补到 ceil(4*work*采集力/载量) → work 继续堆到 maxWork。
 */
export const getMinerBody = (
    energyCapacity: number,
    maxWork: number,
    needCarry: boolean,
    speed = 0.5,
): BodyPartConstant[] => {
    let cost = 0;
    let work = 0;
    let move = 0;
    let carry = 0;

    move += 1;
    cost += BODYPART_COST[MOVE];

    if (needCarry) {
        carry += 1;
        cost += BODYPART_COST[CARRY];
    }

    while (cost < energyCapacity && work + move + carry < MAX_CREEP_SIZE) {
        if (work < 5 && work < maxWork && energyCapacity >= cost + BODYPART_COST[WORK]) {
            work++;
            cost += BODYPART_COST[WORK];
            continue;
        }

        if ((move === 0 || move / work < speed) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
            move++;
            cost += BODYPART_COST[MOVE];
            continue;
        }

        const desiredCarry = needCarry ? Math.ceil((4 * work * HARVEST_POWER) / CARRY_CAPACITY) : 1;

        if (work >= 5 && carry < desiredCarry && energyCapacity >= cost + BODYPART_COST[CARRY]) {
            carry++;
            cost += BODYPART_COST[CARRY];
            continue;
        }

        if (maxWork && work >= maxWork) {
            break;
        }

        if (energyCapacity >= cost + BODYPART_COST[WORK]) {
            work++;
            cost += BODYPART_COST[WORK];
            continue;
        }

        break;
    }

    const body: BodyPartConstant[] = [];

    for (let i = 0; i < work - 1; i++) body.push(WORK);
    for (let i = 0; i < carry; i++) body.push(CARRY);
    for (let i = 0; i < move; i++) body.push(MOVE);

    body.push(WORK);

    return body;
};

/**
 * hauler 体型：路面组 [C,C,M]×N（≤16 组）或越野组 [C,M]×N（≤25 组），组数由容量与 maxCarry 封顶。
 */
export const getHaulerBody = (
    energyCapacity: number,
    options: { forRoad?: boolean; maxCarry?: number } = {},
): BodyPartConstant[] => {
    const { forRoad = false, maxCarry = 32 } = options;

    let iterationCost: number;
    let maxIteration: number;
    let bodyComponent: BodyPartConstant[];

    if (forRoad) {
        iterationCost = 150;
        maxIteration = Math.min(16, Math.floor(maxCarry / 2));
        bodyComponent = [CARRY, CARRY, MOVE];
    } else {
        iterationCost = 100;
        maxIteration = Math.min(25, maxCarry);
        bodyComponent = [CARRY, MOVE];
    }

    const body: BodyPartConstant[] = [...bodyComponent];

    const numIteration = Math.min(Math.floor(energyCapacity / iterationCost), maxIteration) - 1;

    for (let i = 0; i < numIteration; i++) {
        body.push(...bodyComponent);
    }

    return body;
};

/**
 * upgrader 体型（参数化渐堆）：200 基础 1W1C1M → carry/work<carryRatio 补 C → work/move≥4 补 M → work 堆到 maxWork。
 * 冲级期 carryRatio=1（满配快取能），常态 4。
 */
export const getUpgraderBody = (
    energyCapacity: number,
    maxWork?: number,
    carryRatio = 4,
): BodyPartConstant[] => {
    let cost = 200;
    let work = 1;
    let move = 1;
    let carry = 1;

    while (energyCapacity > cost) {
        if (CARRY_CAPACITY * carry / work < carryRatio && energyCapacity >= cost + BODYPART_COST[CARRY]) {
            if (work + move + carry + 1 > MAX_CREEP_SIZE) break;
            carry++;
            cost += BODYPART_COST[CARRY];
            continue;
        }

        if ((move === 0 || work / move >= 4) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
            if (work + move + carry + 1 > MAX_CREEP_SIZE) break;
            move++;
            cost += BODYPART_COST[MOVE];
            continue;
        }

        if (maxWork && work >= maxWork) {
            break;
        }

        if (energyCapacity >= cost + BODYPART_COST[WORK]) {
            if (work + move + carry + 1 > MAX_CREEP_SIZE) break;
            work++;
            cost += BODYPART_COST[WORK];
            continue;
        }
        break;
    }

    const body: BodyPartConstant[] = [];

    for (let i = 0; i < work - 1; i++) body.push(WORK);
    for (let i = 0; i < carry; i++) body.push(CARRY);
    for (let i = 0; i < move; i++) body.push(MOVE);

    body.push(WORK);

    return body;
};

/**
 * builder 体型：1W1C1M 基础 → 整组 [W,M,C] 优先 → 半组 (W,M) / (M,C) 凑容。
 */
export const getBuilderBody = (energyCapacity: number, maxWork?: number): BodyPartConstant[] => {
    let work = 1;
    let move = 1;
    let carry = 1;

    const moveCost = BODYPART_COST[MOVE];
    const workCost = BODYPART_COST[WORK];
    const carryCost = BODYPART_COST[CARRY];

    const totalCost = moveCost + workCost + carryCost;

    energyCapacity -= totalCost;

    while (energyCapacity >= moveCost && work + move + carry + 2 <= MAX_CREEP_SIZE) {
        if (work >= maxWork || work + move + carry + 2 > MAX_CREEP_SIZE) {
            break;
        }

        if (energyCapacity >= totalCost && work + move + carry + 3 <= MAX_CREEP_SIZE) {
            work++;
            move++;
            carry++;
            energyCapacity -= totalCost;
            continue;
        }

        if (energyCapacity >= workCost + moveCost) {
            work++;
            move++;
            energyCapacity -= workCost + moveCost;
            continue;
        }

        if (energyCapacity >= moveCost + carryCost) {
            move++;
            carry++;
            energyCapacity -= moveCost + carryCost;
            continue;
        }

        break;
    }

    const body: BodyPartConstant[] = [];

    for (let i = 0; i < work - 1; i++) body.push(WORK);
    for (let i = 0; i < carry; i++) body.push(CARRY);
    for (let i = 0; i < move - 1; i++) body.push(MOVE);

    body.push(WORK, MOVE);

    return body;
};

/** 本房型 builder 体型最大 work 数（每 tick 缓存） */
export const getBuilderMaxNumWork = (room: Room): number => {
    const state = getRushTickState(room);
    if (state.builderMaxNumWork !== undefined) return state.builderMaxNumWork;

    const body = getBuilderBody(room.energyCapacityAvailable);
    return (state.builderMaxNumWork = body.filter((part) => part === WORK).length);
};

/** 本房型 upgrader 体型最大 work 数（每 tick 缓存） */
export const getUpgraderMaxNumWork = (room: Room): number => {
    const state = getRushTickState(room);
    if (state.upgraderMaxNumWork !== undefined) return state.upgraderMaxNumWork;

    const body = getUpgraderBody(room.energyCapacityAvailable);
    return (state.upgraderMaxNumWork = body.filter((part) => part === WORK).length);
};

