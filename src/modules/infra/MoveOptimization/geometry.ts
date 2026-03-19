// @ts-nocheck

/**
 * BetterMove 基础几何/房间名工具。
 * @description
 * 这一层只做“纯计算”与轻量缓存，不触碰寻路状态机与原型补丁，
 * 方便在跨房路由、路径缓存、移动解算等多个功能块之间复用。
 */

const HALF_WORLD_SIZE = 255 >> 1;

export const geometryCaches = {
    roomNameParseCache: Object.create(null),
    shardRoomNameParseCache: Object.create(null),
    tileToPosCache: new Map<number, RoomPosition>(),
};

/**
 * 解析房间名。
 * @returns {{ ew:'W'|'E', ewNum:number, ns:'N'|'S', nsNum:number, baseX:number, baseY:number } | null}
 */
export function parseRoomName(roomName: string): { ew: 'W' | 'E'; ewNum: number; ns: 'N' | 'S'; nsNum: number; baseX: number; baseY: number; } | null {
    const cached = geometryCaches.roomNameParseCache[roomName];
    if (cached !== undefined) return cached;
    const len = roomName.length;
    if (len < 4) {
        geometryCaches.roomNameParseCache[roomName] = null;
        return null;
    }

    const ewCode = roomName.charCodeAt(0);
    if (ewCode !== 69 && ewCode !== 87) {
        geometryCaches.roomNameParseCache[roomName] = null;
        return null;
    }

    let i = 1;
    let ewNum = 0;
    const ewStart = i;
    while (i < len) {
        const code = roomName.charCodeAt(i);
        if (code === 78 || code === 83) break;
        const digit = code - 48;
        if (digit < 0 || digit > 9) {
            geometryCaches.roomNameParseCache[roomName] = null;
            return null;
        }
        ewNum = ewNum * 10 + digit;
        i++;
    }
    if (i === ewStart || i >= len) {
        geometryCaches.roomNameParseCache[roomName] = null;
        return null;
    }

    const nsCode = roomName.charCodeAt(i);
    if (nsCode !== 78 && nsCode !== 83) {
        geometryCaches.roomNameParseCache[roomName] = null;
        return null;
    }
    i++;
    if (i >= len) {
        geometryCaches.roomNameParseCache[roomName] = null;
        return null;
    }

    let nsNum = 0;
    const nsStart = i;
    while (i < len) {
        const digit = roomName.charCodeAt(i) - 48;
        if (digit < 0 || digit > 9) {
            geometryCaches.roomNameParseCache[roomName] = null;
            return null;
        }
        nsNum = nsNum * 10 + digit;
        i++;
    }
    if (i === nsStart) {
        geometryCaches.roomNameParseCache[roomName] = null;
        return null;
    }

    const parsed = {
        ew: /** @type {'W'|'E'} */(ewCode === 87 ? 'W' : 'E'),
        ewNum,
        ns: /** @type {'N'|'S'} */(nsCode === 83 ? 'S' : 'N'),
        nsNum,
        baseX: (ewCode === 87 ? -ewNum : ewNum + 1) * 50,
        baseY: (nsCode === 83 ? nsNum + 1 : -nsNum) * 50
    };
    geometryCaches.roomNameParseCache[roomName] = parsed;
    return parsed;
}

/**
 * 统一到大地图坐标。
 */
export function formalize(pos) {
    if (!pos || !pos.roomName) return {};
    const parsed = parseRoomName(pos.roomName);
    if (!parsed) return {};
    return {
        x: parsed.baseX + pos.x,
        y: parsed.baseY + pos.y
    };
}

export function formalizeIntentPos(pos) {
    if (!pos || !pos.roomName) return {};
    const parsed = parseRoomName(pos.roomName);
    if (!parsed) return {};
    return {
        x: (parsed.ew === 'W' ? HALF_WORLD_SIZE - parsed.ewNum : HALF_WORLD_SIZE + parsed.ewNum + 1) * 50 + pos.x,
        y: (parsed.ns === 'S' ? HALF_WORLD_SIZE + parsed.nsNum + 1 : HALF_WORLD_SIZE - parsed.nsNum) * 50 + pos.y
    };
}

export function formalizeIntentMovePos(pos) {
    if (!pos || !pos.roomName) return {};
    const formalPos = formalizeIntentPos(pos);
    if (typeof formalPos.x !== 'number' || typeof formalPos.y !== 'number') {
        return formalPos;
    }
    if (pos.x === 0) {
        formalPos.x--;
    } else if (pos.x === 49) {
        formalPos.x++;
    } else if (pos.y === 0) {
        formalPos.y--;
    } else if (pos.y === 49) {
        formalPos.y++;
    }
    return formalPos;
}

export function packIntentTile(formalPos) {
    return (formalPos.y << 14) | formalPos.x;
}

export function tile2Pos(tile) {
    const cached = geometryCaches.tileToPosCache.get(tile);
    if (cached) {
        return cached;
    }
    const y = tile >> 14;
    const x = tile & 0x3fff;
    const rx = x / 50 | 0;
    const ry = y / 50 | 0;
    const roomName = (rx <= HALF_WORLD_SIZE ? 'W' + (HALF_WORLD_SIZE - rx) : 'E' + (rx - HALF_WORLD_SIZE - 1)) +
        (ry <= HALF_WORLD_SIZE ? 'N' + (HALF_WORLD_SIZE - ry) : 'S' + (ry - HALF_WORLD_SIZE - 1));
    const pos = new RoomPosition(x % 50, y % 50, roomName);
    geometryCaches.tileToPosCache.set(tile, pos);
    return pos;
}

export function getAdjacents(pos) {
    const posArray = [];
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            posArray.push({
                x: pos.x + i,
                y: pos.y + j
            });
        }
    }
    return posArray;
}

/**
 * 解析带 shard 前缀的房间名（格式：`shardX/W1N1`）。
 */
export function parseShardRoomName(roomName) {
    if (typeof roomName !== 'string') return { shard: null, room: roomName };
    const cached = geometryCaches.shardRoomNameParseCache[roomName];
    if (cached !== undefined) return cached;
    const idx = roomName.indexOf('/');
    if (idx === -1) {
        const parsed = { shard: null, room: roomName };
        geometryCaches.shardRoomNameParseCache[roomName] = parsed;
        return parsed;
    }
    const shard = roomName.slice(0, idx);
    const room = roomName.slice(idx + 1);
    const parsed = { shard: shard || null, room };
    geometryCaches.shardRoomNameParseCache[roomName] = parsed;
    return parsed;
}

export function isEqual(pos1, pos2) {
    return pos1.x == pos2.x && pos1.y == pos2.y && pos1.roomName == pos2.roomName;
}

export function isNear(pos1, pos2) {
    if (pos1.roomName == pos2.roomName) {
        return -1 <= pos1.x - pos2.x && pos1.x - pos2.x <= 1 && -1 <= pos1.y - pos2.y && pos1.y - pos2.y <= 1;
    } else if (pos1.roomName && pos2.roomName) {
        if (pos1.x + pos2.x != 49 && pos1.y + pos2.y != 49) return false;
        const parsed1 = parseRoomName(pos1.roomName);
        const parsed2 = parseRoomName(pos2.roomName);
        if (parsed1 && parsed2) {
            const formalizedEW = (parsed1.baseX + pos1.x) - (parsed2.baseX + pos2.x);
            const formalizedNS = (parsed1.baseY + pos1.y) - (parsed2.baseY + pos2.y);
            return -1 <= formalizedEW && formalizedEW <= 1 && -1 <= formalizedNS && formalizedNS <= 1;
        }
    }
    return false;
}

export function inRange(pos1, pos2, range) {
    if (pos1.roomName == pos2.roomName) {
        return -range <= pos1.x - pos2.x && pos1.x - pos2.x <= range && -range <= pos1.y - pos2.y && pos1.y - pos2.y <= range;
    }
    if (!pos1.roomName || !pos2.roomName) {
        return false;
    }
    const parsed1 = parseRoomName(pos1.roomName);
    const parsed2 = parseRoomName(pos2.roomName);
    if (!parsed1 || !parsed2) {
        return false;
    }
    const formalizedEW = (parsed1.baseX + pos1.x) - (parsed2.baseX + pos2.x);
    const formalizedNS = (parsed1.baseY + pos1.y) - (parsed2.baseY + pos2.y);
    return -range <= formalizedEW && formalizedEW <= range && -range <= formalizedNS && formalizedNS <= range;
}

export function getClosestExitPos(fromPos, toRoomName) {
    if (!fromPos || !toRoomName) {
        return null;
    }
    const room = Game.rooms[fromPos.roomName];
    if (!room) {
        return null;
    }
    const exitDir = room.findExitTo(toRoomName);
    if (typeof exitDir !== 'number') {
        return null;
    }
    const exits = room.find(exitDir);
    if (!exits || !exits.length) {
        return null;
    }
    return fromPos.findClosestByRange(exits);
}

/**
 * `fromPos` 和 `toPos` 都是 pathFinder 路径上的点，只可能是同房相邻点或跨房边界点。
 */
export function getDirection(fromPos, toPos) {
    const from = formalizeIntentPos(fromPos);
    const to = formalizeIntentPos(toPos);
    if (typeof from.x !== 'number' || typeof from.y !== 'number' || typeof to.x !== 'number' || typeof to.y !== 'number') {
        return 0;
    }

    const deltaX = Math.sign(to.x - from.x);
    const deltaY = Math.sign(to.y - from.y);

    if (deltaX > 0) {
        if (deltaY > 0) return BOTTOM_RIGHT;
        if (deltaY < 0) return TOP_RIGHT;
        return RIGHT;
    }

    if (deltaX < 0) {
        if (deltaY > 0) return BOTTOM_LEFT;
        if (deltaY < 0) return TOP_LEFT;
        return LEFT;
    }

    if (deltaY > 0) return BOTTOM;
    if (deltaY < 0) return TOP;
    return 0;
}

export function isNearExitDirection(pos, exitDir, range = 1) {
    switch (exitDir) {
        case FIND_EXIT_TOP:
            return pos.y <= range;
        case FIND_EXIT_RIGHT:
            return pos.x >= 49 - range;
        case FIND_EXIT_BOTTOM:
            return pos.y >= 49 - range;
        case FIND_EXIT_LEFT:
            return pos.x <= range;
        default:
            return false;
    }
}

/**
 * 检查是否是高速公路房。
 * @description
 * 只支持 1000 以内房间号；当前项目已足够。
 */
export function isHighWay(roomName) {
    if (roomName.charCodeAt(roomName.length - 1) === 48) return true;

    let code = roomName.charCodeAt(2);
    if (code === 78 || code === 83) return roomName.charCodeAt(1) === 48;

    code = roomName.charCodeAt(3);
    if (code === 78 || code === 83) return roomName.charCodeAt(2) === 48;

    code = roomName.charCodeAt(4);
    if (code === 78 || code === 83) return roomName.charCodeAt(3) === 48;

    return false;
}

export function isSameOps(path, ops) {
    return path.ignoreRoads == !!ops.ignoreRoads &&
        path.ignoreSwamps == !!ops.ignoreSwamps &&
        path.ignoreStructures == !!ops.ignoreDestructibleStructures;
}

export function getPathOpsSignature(ignoreRoads, ignoreSwamps, ignoreStructures) {
    let bits = 0;
    if (ignoreRoads) bits |= 1;
    if (ignoreSwamps) bits |= 2;
    if (ignoreStructures) bits |= 4;
    return bits;
}

export function buildPathVariantKey(ignoreRoads, ignoreSwamps, ignoreStructures, endRoomName) {
    const opsSig = getPathOpsSignature(!!ignoreRoads, !!ignoreSwamps, !!ignoreStructures);
    return `${opsSig}|${endRoomName || ""}`;
}

export function buildPathVariantKeyFromPath(path) {
    if (!path || !path.posArray || !path.posArray.length) return null;
    const endRoomName = path.posArray[path.posArray.length - 1].roomName || "";
    return buildPathVariantKey(path.ignoreRoads, path.ignoreSwamps, path.ignoreStructures, endRoomName);
}

export function buildPathVariantKeyFromQuery(ops, toRoomName) {
    return buildPathVariantKey(ops.ignoreRoads, ops.ignoreSwamps, ops.ignoreDestructibleStructures, toRoomName);
}

export function hasActiveBodypart(body, type) {
    if (!body) {
        return true;
    }

    for (let i = body.length - 1; i >= 0; i--) {
        if (body[i].hits <= 0) break;
        if (body[i].type === type) return true;
    }

    return false;
}
