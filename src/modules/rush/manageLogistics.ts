/**
 * 能量物流：配送请求-匹配中枢。
 * 口径：固定优先级表（spawn/ext=1 > tower/lab=2 > builder=3 > rampartRepairer=4 >
 * container/upgrader=5 > terminal=6 > factory=7 > nuker=8 > storage=10）；
 * matchHaulers 高优者赢、同级近者赢、被抢方容量回滚（含 useRate 途中损耗修正）；
 * 无单闲量搬运工先记 spawnBalance 加码，再沉淀到 controller 容器位（无 controller link 时）。
 * relay 接力（3.2）与 porter 取能链路（3.5）在对应批次补齐。
 */
import { RushMinHeap } from './minHeap';
import { getRushCreepHeap, getRushRoomHeap, swapRushCreepHeap } from './roomState';
import { getCreepsByRole, markSpawnBalanceAdded } from './spawnManager';
import { getControllerLink } from './manageUpgrade';
import { shouldRelay } from './manageSource';
import { requestCreep, getHaulerBody } from './spawnUtils';

/** 配送优先级（越小越优先） */
export const ENERGY_FILL_PRIORITY: Record<string, number> = {
    extension: 1,
    spawn: 1,
    tower: 2,
    lab: 2,
    builder: 3,
    rampartRepairer: 4,
    container: 5,
    upgrader: 5,
    terminal: 6,
    factory: 7,
    nuker: 8,
    nukeRepairer: 9,
    storage: 10,
};

/** 取能点优先级 */
export const ENERGY_DEPOSIT_PRIORITY: Record<string, number> = {
    container: 3,
    factory: 4,
    storage: 5,
    terminal: 6,
};

/** porter 兼职角色集合 */
export const PORTER_ROLE_SET = new Set(['porter', 'courier', 'mineralHauler']);

/** 常规填充的结构类型（spawn/extension 由孵化能量状态单独触发） */
const STRUCTURE_TYPES_TO_FILL = [STRUCTURE_TOWER, STRUCTURE_STORAGE, STRUCTURE_LAB];

/** 填充阈值（freeCapacity 超过才发单） */
const THRESHOLD_TO_FILL: Partial<Record<StructureConstant, number>> = {
    [STRUCTURE_TOWER]: 400,
};

export type LogisticsTarget = Structure | Creep | Resource;

/** 配送请求（target 的 freeCapacity 缺口） */
export type LogisticsRequest = {
    id: string;
    priority: number;
    amount: number;
    requestedAmount: number;
    /** 单位途中消耗（upgrader/builder 的 work 速率），匹配距离修正用 */
    useRate?: number;
    target: LogisticsTarget;
    haulers?: RushMinHeap<Creep>;
};

/** 取能点 */
export type EnergyDeposit = {
    id: string;
    priority: number;
    amount: number;
    isResource: boolean;
    target: AnyStoreStructure | Resource | Ruin | Tombstone;
    fetchers?: RushMinHeap<Creep>;
};

/** Chebyshev 距离 */
export const getRange = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const isStructure = (target: LogisticsTarget): target is Structure => target instanceof Structure;

const isCreep = (target: LogisticsTarget): target is Creep => target instanceof Creep;

/** 构造配送请求 */
export const createRequest = (target: LogisticsTarget): LogisticsRequest => {
    const priority = isStructure(target)
        ? ENERGY_FILL_PRIORITY[target.structureType]
        : isCreep(target)
            ? ENERGY_FILL_PRIORITY[target.memory.role]
            : undefined;

    const amount = (target as any).store.getFreeCapacity(RESOURCE_ENERGY);

    const request: LogisticsRequest = {
        id: target.id,
        priority: priority ?? Infinity,
        amount,
        requestedAmount: amount,
        target,
    };

    if (isCreep(target)) {
        request.useRate = (target as any).useRate || 0;
    }

    return request;
};

/** 构造取能点 */
export const createEnergyDeposit = (
    target: AnyStoreStructure | Resource | Ruin | Tombstone,
): EnergyDeposit => ({
    id: target.id,
    amount: ((target as any).amount as number | undefined) || ((target as any).store ? (target as any).store[RESOURCE_ENERGY] : 0),
    isResource: target instanceof Resource,
    priority:
        ENERGY_DEPOSIT_PRIORITY[(target as AnyStoreStructure).structureType] ||
        ((target as any).destroyTime ? 2 : 1),
    target,
});

/** controller 容器（堆 id 由容器管理方 3.4 写入；未落地前为空） */
export const getControllerContainer = (room: Room): StructureContainer | undefined => {
    const id = getRushRoomHeap(room.name).controllerContainerId as string | undefined;
    return id ? (Game.getObjectById<StructureContainer>(id) ?? undefined) : undefined;
};

/** 结构填充请求收集（按类型，过阈值） */
const getFillRequestsByType = (room: Room, structureType: StructureConstant): LogisticsRequest[] => {
    const threshold = THRESHOLD_TO_FILL[structureType] || 0;
    const result: LogisticsRequest[] = [];

    for (const structure of room.find(FIND_STRUCTURES, { filter: { structureType } })) {
        const request = createRequest(structure);
        if (request.amount > threshold) {
            result.push(request);
        }
    }

    return result;
};

/**
 * 配送请求收集：
 * 孵化能量未满时 spawn/extension 最先；tower/storage/lab 常规；controller 容器常供；
 * creepsToFill（upgrader/builder 等就地取能单位）追加以让搬运工送上门。
 */
export const getFillRequests = (room: Room, creepsToFill: Creep[]): Record<string, LogisticsRequest> => {
    const result: Record<string, LogisticsRequest> = {};

    if (room.energyAvailable < room.energyCapacityAvailable) {
        for (const request of getFillRequestsByType(room, STRUCTURE_SPAWN)) result[request.id] = request;
        for (const request of getFillRequestsByType(room, STRUCTURE_EXTENSION)) result[request.id] = request;
    }

    for (const structureType of STRUCTURE_TYPES_TO_FILL) {
        for (const request of getFillRequestsByType(room, structureType)) result[request.id] = request;
    }

    const controllerContainer = getControllerContainer(room);
    if (controllerContainer) {
        const request = createRequest(controllerContainer);
        if (request.amount > 0) {
            result[controllerContainer.id] = request;
        }
    }

    for (const creep of creepsToFill) {
        const request = createRequest(creep);
        result[request.id] = request;
    }

    return result;
};

/**
 * 搬运工匹配：
 * 每个请求维护按距离排序的候选堆；循环抢占直到无可用请求。
 * 已有单的搬运工被更高优（或同级更近）请求抢走，原请求回滚容量（含 useRate 途中修正）；
 * 目标已销毁的旧单直接清除。
 */
export const matchHaulers = (
    requests: Record<string, LogisticsRequest>,
    haulers: Creep[],
    porterPriorityThreshold: number,
    isTimeLimitedDeposits: boolean,
): void => {
    const requestArray = Object.values(requests);

    for (const request of requestArray) {
        request.haulers = new RushMinHeap<Creep>((hauler) => getRange(request.target.pos, hauler.pos));

        for (const hauler of haulers) {
            if (
                !isTimeLimitedDeposits &&
                PORTER_ROLE_SET.has(hauler.memory.role) &&
                (hauler as any).ticksToLive >= 20 &&
                request.priority >= porterPriorityThreshold
            ) {
                continue;
            }

            request.haulers.insert(hauler);
        }
    }

    while (true) {
        const freeRequests = requestArray.filter(
            (request) => request.amount > 0 && request.haulers && request.haulers.getSize() > 0,
        );

        if (freeRequests.length === 0) {
            break;
        }

        for (const request of freeRequests) {
            const bestHauler = request.haulers!.remove();

            // 候选堆已被同轮其他请求耗尽：下轮过滤自然剔除
            if (!bestHauler) continue;

            const heap = getRushCreepHeap(bestHauler.name);
            const requestBefore = heap.targetRequest as LogisticsRequest | undefined;

            if (requestBefore) {
                // 旧单 target 可能已销毁，按 id 重解析
                const previousTarget = Game.getObjectById<LogisticsTarget>(requestBefore.id);

                if (!previousTarget) {
                    delete heap.targetRequest;
                } else {
                    if (requestBefore.priority < request.priority) {
                        continue;
                    }

                    if (
                        requestBefore.priority === request.priority &&
                        getRange(bestHauler.pos, previousTarget.pos) <= getRange(bestHauler.pos, request.target.pos)
                    ) {
                        continue;
                    }

                    // 更高优或更近：抢走，原请求回滚
                    requestBefore.amount += (bestHauler as any).amount;
                    if (requestBefore.useRate) {
                        requestBefore.amount -= requestBefore.useRate * getRange(previousTarget.pos, bestHauler.pos);
                    }
                }
            }

            request.amount -= (bestHauler as any).amount;
            if (request.useRate) {
                request.amount += request.useRate * getRange(request.target.pos, bestHauler.pos);
            }

            heap.targetRequest = request;
        }
    }
};

/** 供货执行：邻位 transfer（每 creep 每 tick 一笔，防 relay 双发），远位移动 */
export const runSupplier = (hauler: Creep, request: LogisticsRequest): ScreepsReturnCode => {
    const target = request.target;

    if (getRange(hauler.pos, target.pos) > 1) {
        hauler.moveTo(target.pos, { range: 1, maxRooms: 1 });
        return OK;
    }

    if ((hauler as any)._transfered) {
        return ERR_BUSY;
    }

    (hauler as any)._transfered = true;

    return hauler.transfer(target as AnyStoreStructure, RESOURCE_ENERGY);
};

/** 记录本 tick 移动意图（执行器发 move 时调用；relay 对穿判定输入） */
export const markRushIntent = (creep: Creep, x: number, y: number): void => {
    const heap = getRushCreepHeap(creep.name);
    heap.intent = { x, y };
    heap.intentTick = Game.time;
};

/**
 * relay 接力：对穿的两名 hauler 相向换货并交换记忆（身份互换）。
 * 门：本 tick 未接力过、非撤退、互为对方意图格、等容量颗粒、供方 TTL>50；
 * 附带：取能途中顺路捡墓碑/掉落；意图格站着 miner 时 pull 搭车。
 */
export const getRelayTarget = (creep: Creep): Creep | undefined => {
    const heap = getRushCreepHeap(creep.name);
    if (heap.relayed === Game.time || (creep.memory as any).retreat) {
        return undefined;
    }

    if (heap.intentTick !== Game.time) {
        return undefined;
    }
    const intendedCoord = heap.intent as { x: number; y: number };

    if (!(creep.memory as any).supplying) {
        const tombstone = creep.room.lookForAt(LOOK_TOMBSTONES, intendedCoord.x, intendedCoord.y)[0] as
            | Tombstone
            | undefined;
        if (tombstone && tombstone.store.getUsedCapacity(RESOURCE_ENERGY) && creep.withdraw(tombstone, RESOURCE_ENERGY) === OK) {
            return undefined;
        }

        const resource = creep.room.lookForAt(LOOK_RESOURCES, intendedCoord.x, intendedCoord.y)[0] as
            | Resource
            | undefined;
        if (resource && resource.resourceType === RESOURCE_ENERGY && creep.pickup(resource) === OK) {
            return undefined;
        }
    }

    const other = creep.room.lookForAt(LOOK_CREEPS, intendedCoord.x, intendedCoord.y)[0] as Creep | undefined;

    if (other && other.my && other.memory.role === 'miner') {
        other.pull(creep);
        (creep as any)._bePulled = true;
        return undefined;
    }

    if (!other || !other.my || other.memory.role !== 'hauler') {
        return undefined;
    }

    const otherHeap = getRushCreepHeap(other.name);
    if (otherHeap.relayed === Game.time || (other.memory as any).retreat) {
        return undefined;
    }
    if ((creep.memory as any).supplying === (other.memory as any).supplying) {
        if (!(creep.memory as any).supplying && (other as any)._bePulled) {
            other.pull(creep);
            (creep as any)._bePulled = true;
            return undefined;
        }
    }

    const otherIntent = otherHeap.intent as { x: number; y: number } | undefined;
    if (!otherIntent || otherIntent.x !== creep.pos.x || otherIntent.y !== creep.pos.y) {
        return undefined;
    }

    const supplier = (creep.memory as any).supplying ? creep : other;
    const fetcher = (creep.memory as any).supplying ? other : creep;

    if (supplier.store.getCapacity(RESOURCE_ENERGY) !== fetcher.store.getCapacity(RESOURCE_ENERGY)) {
        return undefined;
    }

    if ((supplier.ticksToLive ?? CREEP_LIFE_TIME) <= 50) {
        return undefined;
    }

    if (supplier.transfer(fetcher, RESOURCE_ENERGY) === OK) {
        // 换向：记忆与堆一起对换（供/取身份互换后状态跟着走）
        const mem1 = Memory.creeps[creep.name];
        const mem2 = Memory.creeps[other.name];
        Memory.creeps[creep.name] = mem2;
        Memory.creeps[other.name] = mem1;

        swapRushCreepHeap(creep.name, other.name);

        getRushCreepHeap(creep.name).relayed = Game.time;
        getRushCreepHeap(other.name).relayed = Game.time;

        return other;
    }

    return undefined;
};

/**
 * 物流主流程（relay/porter 取能批次随后补齐）：
 * 已挂单搬运工继续供货；闲量搬运工先记加码信号，
 * 无 controller link 时沉淀到 controller 容器位（就地为升级供给）。
 */
export const manageLogistics = (room: Room, haulers: Creep[], creepsToFill: Creep[] = []): void => {
    const requests = getFillRequests(room, creepsToFill);

    // porter 取能链路（fetchers/matchFetchers）见 3.5；补员先行接入
    managePorterSpawn(room);

    const idlers: Creep[] = [];

    for (const hauler of haulers) {
        if (hauler.memory.role === 'hauler' && !(hauler.memory as any).startSupplying) {
            continue;
        }

        (hauler as any).amount = hauler.store.getUsedCapacity(RESOURCE_ENERGY);

        const heap = getRushCreepHeap(hauler.name);
        const targetRequest = heap.targetRequest
            ? (requests[(heap.targetRequest as LogisticsRequest).id] as LogisticsRequest | undefined)
            : undefined;

        if (!targetRequest) {
            delete heap.targetRequest;
            idlers.push(hauler);
            continue;
        }

        targetRequest.amount -= (hauler as any).amount;

        if (runSupplier(hauler, targetRequest) === OK) {
            (hauler as any).amount -= Math.min((hauler as any).amount, targetRequest.requestedAmount);
            delete heap.targetRequest;
            if ((hauler as any).amount > 0) {
                idlers.push(hauler);
            }
        } else if (hauler.memory.role === 'hauler' && shouldRelay(room)) {
            const relayTarget = getRelayTarget(hauler);
            const relayRequest =
                relayTarget && getRushCreepHeap(relayTarget.name).targetRequest
                    ? (requests[(getRushCreepHeap(relayTarget.name).targetRequest as LogisticsRequest).id] as
                        | LogisticsRequest
                        | undefined)
                    : undefined;
            if (relayTarget && relayRequest) {
                // 取能半程由 hauler 执行器承接（source 链批次接入）
                runSupplier(relayTarget, relayRequest);
            }
        }
    }

    if (idlers.length === 0) {
        return;
    }

    if (Object.keys(requests).length === 0) {
        markSpawnBalanceAdded(room);
    }

    const porterPriorityThreshold = room.storage
        ? ENERGY_FILL_PRIORITY[STRUCTURE_STORAGE]
        : ENERGY_FILL_PRIORITY[STRUCTURE_CONTAINER];

    matchHaulers(requests, idlers, porterPriorityThreshold, false);

    const controllerContainer = getControllerContainer(room);

    for (const hauler of idlers) {
        const heap = getRushCreepHeap(hauler.name);
        if (heap.targetRequest) {
            if (runSupplier(hauler, heap.targetRequest as LogisticsRequest) === OK) {
                delete heap.targetRequest;
            } else if (hauler.memory.role === 'hauler' && shouldRelay(room)) {
                const relayTarget = getRelayTarget(hauler);
                const relayRequest =
                    relayTarget && getRushCreepHeap(relayTarget.name).targetRequest
                        ? (requests[(getRushCreepHeap(relayTarget.name).targetRequest as LogisticsRequest).id] as
                            | LogisticsRequest
                            | undefined)
                        : undefined;
                if (relayTarget && relayRequest) {
                    runSupplier(relayTarget, relayRequest);
                }
            }
            continue;
        }

        if (PORTER_ROLE_SET.has(hauler.memory.role)) {
            // porter 供取状态翻转见 3.5
            continue;
        }

        markSpawnBalanceAdded(room);

        if (getControllerLink(room)) {
            continue;
        }

        if (!controllerContainer) {
            continue;
        }

        if (getRange(hauler.pos, controllerContainer.pos) > 0) {
            hauler.moveTo(controllerContainer.pos, { range: 0 });
            continue;
        }

        hauler.drop(RESOURCE_ENERGY);
    }
};

/** porter 编制需求（RCL4+ storage 后启用，见 3.5） */
export const getPorterMaxCarry = (room: Room): number => {
    let result = 0;

    const basic = room.controller.level >= 7 ? 15 : 6;

    for (const _spawn of room.find(FIND_MY_SPAWNS)) {
        result += basic * ((room.memory as any).spawnUsage || 0);
    }

    if (!getControllerLink(room)) {
        result += (room.memory as any).controllerNumCarry || 0;
    }

    return result;
};

/** porter 补员（storage + RCL4 门控；取能链路见 3.5） */
export const managePorterSpawn = (room: Room): void => {
    if (!room.storage || room.controller.level < 4) return;
    if (!(room.memory as any).canSpawn) return;

    let numCarry = 0;
    for (const creep of getCreepsByRole(room, 'porter')) {
        if ((creep.ticksToLive || CREEP_LIFE_TIME) > creep.body.length * CREEP_SPAWN_TIME) {
            numCarry += creep.getActiveBodyparts(CARRY);
        }
    }

    if (numCarry < getPorterMaxCarry(room)) {
        const body = getHaulerBody(room.energyAvailable, { forRoad: true });
        requestCreep(room, body, 'porter', 'logistics');
    }
};
