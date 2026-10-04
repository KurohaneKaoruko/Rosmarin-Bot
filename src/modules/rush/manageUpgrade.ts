/**
 * 升级预算与升级单发放。
 * 口径：预算 = 净收入 × 反馈系数（spawnBalance/2+0.8，1~1.2），下限 upgradeNeeded 时 5，
 * 上限 link 几何封顶（无 link 对 90）；urgent = 收入 > 在岗火力（无仓期），
 * upgradeNeeded（TTD 过半）切防降级档；缺口小于半个 body 不孵。
 */
import { getFloodFillPositions } from './algorithm';
import { ENERGY_STANDARD, ENERGY_LEVEL } from './constants';
import { getControllerContainer, getRushRoomHeap, getRushTickState } from './roomState';
import { getCreepsByRole } from './spawnManager';
import { requestCreep, getUpgraderBody } from './spawnUtils';

declare global {
    interface Memory {
        /** 接力开关的 CPU 收紧标记（本地暂无维护方，兜底读取） */
        tightCpu?: boolean;
    }
}

/** 房内可调度能量总量（storage + factory + terminal） */
const getResourceAmount = (room: Room, resourceType: ResourceConstant): number => {
    let result = 0;
    if (room.storage) result += room.storage.store[resourceType] || 0;
    for (const factory of room.find(FIND_STRUCTURES, { filter: { structureType: STRUCTURE_FACTORY } })) {
        result += (factory as StructureFactory).store[resourceType] || 0;
    }
    if (room.terminal) result += room.terminal.store[resourceType] || 0;
    return result;
};

/** 能量水位：低于标准按比例（0~100），超出部分每 1500 记 1 */
export const getEnergyLevel = (room: Room): number => {
    const state = getRushTickState(room);
    if (state.energyLevel !== undefined) return state.energyLevel;

    const totalEnergy = getResourceAmount(room, RESOURCE_ENERGY);
    const standard = ENERGY_STANDARD[room.controller.level] ?? 10000;
    const unitAmount = 1500;

    if (totalEnergy < standard) {
        return (state.energyLevel = Math.floor(100 * (totalEnergy / standard)));
    }
    return (state.energyLevel = 100 + Math.round((totalEnergy - standard) / unitAmount));
};

/** controller 旁 link / storage link（堆 id 由 link 管理方写入；RCL6 前无 → 上限 90） */
export const getControllerLink = (room: Room): StructureLink | undefined => {
    const id = getRushRoomHeap(room.name).controllerLinkId as string | undefined;
    return id ? (Game.getObjectById(id) ?? undefined) : undefined;
};

export const getStorageLink = (room: Room): StructureLink | undefined => {
    const id = getRushRoomHeap(room.name).storageLinkId as string | undefined;
    return id ? (Game.getObjectById(id) ?? undefined) : undefined;
};

/** 升级火力上限：link 对几何封顶（每格运输损耗折算），缺 link 对为 90 */
export const getUpgradeCapacity = (room: Room): number => {
    const heap = getRushRoomHeap(room.name);
    if (heap.upgradeCapacity !== undefined) return heap.upgradeCapacity as number;

    const controllerLink = getControllerLink(room);
    const storageLink = getStorageLink(room);

    if (!controllerLink || !storageLink) {
        return 90;
    }

    const range = controllerLink.pos.getRangeTo(storageLink);
    const capacity = Math.floor(800 / (range + 1));
    heap.upgradeCapacity = capacity;
    return capacity;
};

/** 升级取能点：controller link > 容器位掉落 > controller 容器（就近秒取能口径） */
export const getUpgradeEnergyDepot = (
    room: Room,
): StructureLink | Resource | StructureContainer | undefined => {
    const link = getControllerLink(room);
    if (link) return link;

    const container = getControllerContainer(room);
    if (!container) return undefined;

    const dropped = container.pos.lookFor(LOOK_RESOURCES)[0];
    if (dropped) return dropped;

    return container;
};

/** 升级 work 预算（每 tick 缓存） */
export const getMaxWork = (room: Room): number => {
    const state = getRushTickState(room);
    if (state.maxWork !== undefined) return state.maxWork;

    const level = room.controller.level;
    const mem = room.memory as any;

    if (level < 2) {
        return (state.maxWork = 5);
    }

    const energyLevel = getEnergyLevel(room);
    const lowerLimit = mem.upgradeNeeded ? 5 : 0;
    const upperLimit = getUpgradeCapacity(room);

    if (room.terminal) {
        return (state.maxWork = clampNum(energyLevel - 90, lowerLimit, upperLimit));
    }

    const income = getRushRoomHeap(room.name).income || 0;

    if (room.storage) {
        if (energyLevel < 90) {
            return (state.maxWork = Math.ceil((income * energyLevel) / 100));
        }
        if (energyLevel > ENERGY_LEVEL.moreUpgraders) {
            return (state.maxWork = Math.ceil(income + energyLevel - 90));
        }
        return (state.maxWork = Math.ceil(income));
    }

    // 无仓期：预算 = 收入 × 反馈系数（搬运空闲加码 / 升级取能落空减码，EMA 平滑后的 spawnBalance）
    const multiplier = clampNum((mem.spawnBalance ?? 1) / 2 + 0.8, 1, 1.2);
    return (state.maxWork = Math.floor(clampNum(income * multiplier, lowerLimit, upperLimit)));
};

/** 升级缓冲不足即切防降级（TTD < 半阈值 − safemode 保留 + buffer） */
export const shouldUpgradeFirst = (room: Room, buffer = 1500): boolean => {
    const controller = room.controller!;
    return (
        controller.ticksToDowngrade <
        CONTROLLER_DOWNGRADE[controller.level] / 2 - CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD + buffer
    );
};

/** 升级线运力需求 = 2 × 预算 × 运距（主spawn→controller，房内缓存） */
export const getControllerMaxCarryPower = (room: Room): number => {
    const mem = room.memory as any;
    let distance = mem.controllerDistance;

    if (!distance) {
        const start = room.find(FIND_MY_SPAWNS)[0];
        if (!start) return 0;
        const result = PathFinder.search(start.pos, { pos: room.controller!.pos, range: 1 }, { heuristicWeight: 1 });
        mem.controllerDistance = result.path.length;
        distance = result.path.length;
    }

    return 2 * getMaxWork(room) * distance;
};

/**
 * 升级工位打包：controller 旁（Chebyshev ≤3、被 4 距环封闭）内、
 * 不比容器位更靠近主 spawn 的格位，按离容器（或 link）近优先排序；容器位自身剔除。
 */
export const getUpgradeArea = (room: Room): RoomPosition[] => {
    const heap = getRushRoomHeap(room.name);
    const mem = room.memory as any;

    const cached = heap.upgradeArea as { data: RoomPosition[]; time: number } | undefined;
    if (cached && (!mem.lastBuildTime || cached.time > mem.lastBuildTime)) {
        return cached.data;
    }

    const controller = room.controller;
    if (!controller) return [];

    // 容器位锚点：controller 容器（堆 id 由容器管理方写入）
    const containerId = heap.controllerContainerId as string | undefined;
    const container = containerId ? Game.getObjectById<StructureContainer>(containerId) : undefined;
    if (!container) return [];

    const costs = new PathFinder.CostMatrix();
    const terrain = Game.map.getRoomTerrain(room.name);
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) costs.set(x, y, 255);
        }
    }
    for (const coord of getCoordsAtRange(controller.pos, 4)) {
        costs.set(coord.x, coord.y, 255);
    }

    const start = room.find(FIND_MY_SPAWNS)[0];
    if (!start) return [];

    const flood = getFloodFillPositions(room.name, [start.pos], undefined, {
        returnCostMatrix: true,
    }) as CostMatrix;

    const anchor = container.pos;

    let area = getFloodFillPositions(room.name, [anchor], undefined, {
        costMatrix: costs,
        includeStartPositions: true,
    }) as RoomPosition[];

    const controllerLink = getControllerLink(room);
    const threshold = controllerLink ? 1 : 0;

    area = area
        .filter(
            (pos) => costs.get(pos.x, pos.y) < 255 && flood.get(pos.x, pos.y) >= flood.get(anchor.x, anchor.y) - threshold,
        )
        .sort((pos1, pos2) => {
            if (controllerLink) {
                return pos1.getRangeTo(controllerLink.pos) - pos2.getRangeTo(controllerLink.pos);
            }

            const manhattanDiff =
                Math.abs(pos1.x - anchor.x) + Math.abs(pos1.y - anchor.y) -
                (Math.abs(pos2.x - anchor.x) + Math.abs(pos2.y - anchor.y));

            if (manhattanDiff) {
                return manhattanDiff;
            }

            return (
                Math.min(Math.abs(pos1.x - anchor.x), Math.abs(pos1.y - anchor.y)) -
                Math.min(Math.abs(pos2.x - anchor.x), Math.abs(pos2.y - anchor.y))
            );
        });

    if (!controllerLink) {
        area.shift();
    }

    heap.upgradeArea = { data: area, time: Game.time };
    return area;
};

/**
 * 升级单发放（参考 manageUpgrade 的孵化侧）：
 * numWork 统计 → upgradeNeeded 双向切换 → building 冻结 → 闲量转职 →
 * 预算缺口打包 → 半身位门 → urgent 切档 → 按档位入队。
 */
export const manageUpgradeSpawn = (room: Room, upgraders: Creep[], builders: Creep[]): void => {
    const mem = room.memory as any;
    const state = getRushTickState(room);

    if (mem.upgradeNeeded) {
        upgraders.push(...builders);
    }

    if (!state.canSpawn) {
        return;
    }

    mem.numWork = 0;

    if (mem.emergency) {
        return;
    }

    for (const creep of upgraders) {
        if ((creep.ticksToLive || CREEP_LIFE_TIME) > creep.body.length * CREEP_SPAWN_TIME) {
            mem.numWork += creep.getActiveBodyparts(WORK);
        }
    }

    const level = room.controller!.level;

    if (!mem.upgradeNeeded && shouldUpgradeFirst(room)) {
        mem.upgradeNeeded = true;
    } else if (mem.upgradeNeeded && room.controller!.ticksToDowngrade >= CONTROLLER_DOWNGRADE[level]) {
        mem.upgradeNeeded = false;
    }

    const maxWork = getMaxWork(room);

    if (mem.building && !mem.upgradeNeeded) {
        mem.controllerNumCarry = 0;
        return;
    }

    // 升级线运力需求（车位数）
    mem.controllerNumCarry = Math.floor(getControllerMaxCarryPower(room) / 50);

    if (mem.numWork >= maxWork) {
        return;
    }

    let workNeeded = maxWork - mem.numWork;

    // 闲量转职：有手有兜的 idler 直接顶上
    for (const idler of getCreepsByRole(room, 'idler')) {
        if (idler.getActiveBodyparts(WORK) === 0) continue;
        if (idler.getActiveBodyparts(CARRY) === 0) continue;

        idler.memory.role = 'upgrader';

        workNeeded -= idler.getActiveBodyparts(WORK);

        if (workNeeded <= 0) {
            return;
        }
    }

    const carryRatio = room.controller!.level >= 6 && (Memory as any).tightCpu ? 5 : 1;

    const body = getUpgraderBody(room.energyCapacityAvailable, maxWork, carryRatio);
    const bodyNumWork = body.filter((part) => part === WORK).length;

    // 缺口小于半个 body 不孵
    if (!mem.upgradeNeeded && 2 * (maxWork - mem.numWork) < bodyNumWork) {
        return;
    }

    // urgent 切档：有仓期看水位（>workerFirst），无仓期看收入是否超在岗火力
    let urgent: boolean;
    if (room.storage || room.terminal) {
        urgent = getEnergyLevel(room) > ENERGY_LEVEL.workerFirst;
    } else {
        urgent = (getRushRoomHeap(room.name).income || 0) > mem.numWork;
    }

    requestCreep(
        room,
        body,
        'upgrader',
        mem.upgradeNeeded ? 'preventDowngrade' : urgent ? 'upgradePreference' : 'upgrade',
    );
};

const clampNum = (value: number, low: number, high: number): number =>
    value < low ? low : value > high ? high : value;

/** Chebyshev 距离恰为 range 的方环格位 */
const getCoordsAtRange = (pos: RoomPosition, range: number): { x: number; y: number }[] => {
    if (range === 0) return [{ x: pos.x, y: pos.y }];

    const result: { x: number; y: number }[] = [];
    const minX = pos.x - range;
    const maxX = pos.x + range;
    const minY = pos.y - range;
    const maxY = pos.y + range;

    if (minX >= 0 && minX <= 49) {
        for (let y = Math.max(0, minY); y <= Math.min(49, maxY); y++) result.push({ x: minX, y });
    }
    if (maxX >= 0 && maxX <= 49) {
        for (let y = Math.max(0, minY); y <= Math.min(49, maxY); y++) result.push({ x: maxX, y });
    }
    if (minY >= 0 && minY <= 49) {
        for (let x = Math.max(0, minX); x <= Math.min(49, maxX); x++) result.push({ x, y: minY });
    }
    if (maxY >= 0 && maxY <= 49) {
        for (let x = Math.max(0, minX); x <= Math.min(49, maxX); x++) result.push({ x, y: maxY });
    }
    return result;
};
