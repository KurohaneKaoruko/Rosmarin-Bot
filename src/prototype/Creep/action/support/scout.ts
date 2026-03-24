import { ensureMemoryCacheSection } from '@/prototype/Creep/function/cache';

type ScoutCache = {
    stompSiteId?: Id<ConstructionSite> | null;
};

const getStompSiteWeight = (site: ConstructionSite): number => {
    switch (site.structureType) {
        case STRUCTURE_SPAWN: return 1000;
        case STRUCTURE_TOWER: return 900;
        case STRUCTURE_EXTENSION: return 800;
        case STRUCTURE_STORAGE: return 760;
        case STRUCTURE_TERMINAL: return 740;
        case STRUCTURE_LAB: return 720;
        case STRUCTURE_LINK: return 700;
        case STRUCTURE_FACTORY: return 680;
        case STRUCTURE_POWER_SPAWN: return 660;
        case STRUCTURE_NUKER: return 640;
        case STRUCTURE_OBSERVER: return 620;
        case STRUCTURE_RAMPART: return 420;
        case STRUCTURE_ROAD: return 180;
        default: return 500;
    }
};

const getStompTarget = (creep: Creep): ConstructionSite | null => {
    const cache = ensureMemoryCacheSection<ScoutCache>(creep.memory, 'target');

    if (cache.stompSiteId) {
        const cached = Game.getObjectById(cache.stompSiteId);
        if (cached && !cached.my && !cached.pos.coverRampart()) return cached;
        cache.stompSiteId = null;
    }

    const sites = creep.room.find(FIND_HOSTILE_CONSTRUCTION_SITES, {
        filter: (site) => !site.pos.coverRampart()
    });
    if (!sites.length) return null;

    let best = sites[0];
    let bestScore = getStompSiteWeight(best) * 100 - creep.pos.getRangeTo(best);
    for (let i = 1; i < sites.length; i++) {
        const site = sites[i];
        const score = getStompSiteWeight(site) * 100 - creep.pos.getRangeTo(site);
        if (score > bestScore) {
            best = site;
            bestScore = score;
        }
    }

    cache.stompSiteId = best.id;
    return best;
};

const runStomp = (creep: Creep): boolean => {
    const shouldStomp = !!(creep.memory.stompSite || creep.memory.stompConstructionSite);
    if (!shouldStomp) return false;

    const target = getStompTarget(creep);
    if (!target) return false;

    if (!creep.pos.isEqualTo(target.pos)) {
        creep.moveTo(target, { range: 0, plainCost: 1, swampCost: 1, maxRooms: 1, reusePath: 3 });
    }
    return true;
};

// 判断是否处于房间边缘（不依赖 isRoomEdge 原型，便于测试）
const isEdgePos = (pos: RoomPosition): boolean =>
    pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49;

// 判定结构是否会阻塞 scout 驻足。
// 道路、container 与可通行 rampart 都允许站立，不应把它们当作障碍。
const isBlockingScoutStructure = (structure: AnyStructure) => {
    if (structure.structureType === STRUCTURE_ROAD) return false;
    if (structure.structureType === STRUCTURE_CONTAINER) return false;
    if (structure.structureType === STRUCTURE_RAMPART) {
        return !('my' in structure ? structure.my : false) && !('isPublic' in structure ? structure.isPublic : false);
    }
    return true;
};

// 判定某个格子是否可以驻足（避开墙、阻塞结构、施工点与单位）
const isWalkableTile = (room: Room, x: number, y: number): boolean => {
    if (x < 0 || x > 49 || y < 0 || y > 49) return false;
    if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
    if (room.lookForAt(LOOK_STRUCTURES, x, y).some((structure) => isBlockingScoutStructure(structure as AnyStructure))) return false;
    if (room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) return false;
    if (room.lookForAt(LOOK_CREEPS, x, y).length > 0) return false;
    if (room.lookForAt(LOOK_POWER_CREEPS, x, y).length > 0) return false;
    return true;
};

// 从边缘向内找一个可落脚点：先直线向内，再尝试对角点
const findInteriorPos = (creep: Creep): RoomPosition | null => {
    const { x, y } = creep.pos;
    const room = creep.room;

    if (!isEdgePos(creep.pos)) return null;

    const candidates: Array<[number, number]> = [];

    if (x <= 0) {
        candidates.push([x + 1, y]);
        candidates.push([x + 1, y - 1]);
        candidates.push([x + 1, y + 1]);
    } else if (x >= 49) {
        candidates.push([x - 1, y]);
        candidates.push([x - 1, y - 1]);
        candidates.push([x - 1, y + 1]);
    } else if (y <= 0) {
        candidates.push([x, y + 1]);
        candidates.push([x - 1, y + 1]);
        candidates.push([x + 1, y + 1]);
    } else if (y >= 49) {
        candidates.push([x, y - 1]);
        candidates.push([x - 1, y - 1]);
        candidates.push([x + 1, y - 1]);
    }

    for (const [cx, cy] of candidates) {
        if (isWalkableTile(room, cx, cy)) {
            return new RoomPosition(cx, cy, room.name);
        }
    }

    return null;
};

// 边缘驻足处理：仅在贴边时向内移动，避免无意义地强制回中心
const parkInRoom = (creep: Creep) => {
    const idlePos = findInteriorPos(creep);
    if (!idlePos) return;
    creep.moveTo(idlePos);
};

/**
 * 为无固定目标房间的 scout 选择下一个探索房间。
 *
 * @remarks
 * - 优先走 normal 状态房间；
 * - 避免在同一批房间中来回抖动（avoidRooms）；
 * - 若全部都访问过，则允许回环重走。
 */
const chooseNextExploreRoom = (creep: Creep): string | undefined => {
    const avoidRooms = new Set<string>(creep.memory['avoidRooms'] || []);
    const currentRoom = creep.room.name;
    if (!avoidRooms.has(currentRoom)) {
        creep.memory['avoidRooms'] = [...avoidRooms, currentRoom];
        avoidRooms.add(currentRoom);
    }

    const exits = Object.values(Game.map.describeExits(currentRoom) || {});
    if (exits.length === 0) return undefined;
    const normalExits = exits.filter((roomName) => Game.map.getRoomStatus(roomName).status === 'normal');
    const preferredPool = normalExits.length > 0 ? normalExits : exits;
    const unvisited = preferredPool.filter((roomName) => !avoidRooms.has(roomName));
    const pool = unvisited.length > 0 ? unvisited : preferredPool;
    if (pool.length === 0) return undefined;

    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
};

/**
 * 确保 scout 存在目标房间：
 * - 若已有 targetRoom，直接复用；
 * - 若没有 targetRoom，按巡航逻辑挑选一个出口房间。
 */
const ensureScoutTargetRoom = (creep: Creep): string | undefined => {
    if (creep.memory.targetRoom) return creep.memory.targetRoom;
    const nextRoom = chooseNextExploreRoom(creep);
    if (nextRoom) creep.memory.targetRoom = nextRoom;
    return creep.memory.targetRoom;
};

const hasFriendlyNonScoutInRoom = (creep: Creep): boolean => {
    if (typeof FIND_MY_CREEPS === 'undefined' || typeof creep.room.find !== 'function') return false;
    const creeps = creep.room.find(FIND_MY_CREEPS) as Creep[];
    return creeps.some((other) => other.name !== creep.name && other.memory?.role !== 'scout');
};

/**
 * scout 到达目标房间后的行为：
 * 1. 优先执行踩工地；
 * 2. 若配置了签名且文本不同，执行签名；
 * 3. 否则驻足到非边缘可站位，保持目标房视野。
 */
const runScoutInTargetRoom = (creep: Creep): void => {
    if (hasFriendlyNonScoutInRoom(creep)) {
        creep.suicide();
        return;
    }

    if (runStomp(creep)) return;

    const controller = creep.room.controller;
    if (controller && creep.memory['sign'] != undefined && creep.memory['sign'] !== controller.sign?.text) {
        creep.signControllerIfNeeded(creep.memory['sign'], {
            overwrite: true,
            moveOptions: { plainCost: 1, swampCost: 1, maxRooms: 1, range: 1 }
        });
        return;
    }

    parkInRoom(creep);
};

const Scout = {
    /**
     * scout 角色主循环（非状态机实现）。
     *
     * @remarks
     * scout 的核心行为是“单阶段任务驱动”：
     * - 先确保目标房间；
     * - 再执行跨房移动；
     * - 到房后做 stomp/sign/驻足。
     */
    run: function (creep: Creep) {
        creep.disableAttackNotificationsOnce?.();

        const targetRoom = ensureScoutTargetRoom(creep);
        if (!targetRoom) {
            parkInRoom(creep);
            return;
        }

        if (creep.room.name !== targetRoom) {
            creep.moveToRoom(targetRoom, { plainCost: 1, swampCost: 1 });
            return;
        }

        runScoutInTargetRoom(creep);
    }
};

export default Scout;
