import { runWorkLayer } from '@/framework/ai/adapters';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';

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
    creep.memory.cacheTarget = creep.memory.cacheTarget || {};
    const cache = creep.memory.cacheTarget as ScoutCache;

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

const onTarget = (creep: Creep): WorkEvent => {
    if (creep.room.name !== creep.memory.targetRoom) {
        creep.moveToRoom(creep.memory.targetRoom, { plainCost: 1, swampCost: 1 });
        return WORK_EVENTS.STAY;
    }

    if (runStomp(creep)) {
        return WORK_EVENTS.STAY;
    }

    const controller = creep.room.controller;
    if (controller && creep.memory['sign'] != undefined && creep.memory['sign'] !== controller.sign?.text) {
        creep.signControllerIfNeeded(creep.memory['sign'], {
            overwrite: true,
            moveOptions: { plainCost: 1, swampCost: 1, maxRooms: 1, range: 1 }
        });
    } else {
        parkInRoom(creep);
    }

    return WORK_EVENTS.STAY;
};

const onSource = (): WorkEvent => {
    return WORK_EVENTS.TO_TARGET;
};

const Scout = {
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource: ({ creep }) => onSource(),
            onTarget: ({ creep }) => onTarget(creep),
        });
    }
}

export default Scout;
