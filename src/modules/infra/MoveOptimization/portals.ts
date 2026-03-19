// @ts-nocheck

/**
 * BetterMove portal 注册与跨 shard 入口选择。
 */
export function createPortalModule() {
    let portalScanTick = -1;
    let portalPruneTick = -1;
    const PORTAL_SCAN_INTERVAL = 20;
    const PORTAL_ENTRY_TTL = 50000;

    function getPortalRegistry() {
        if (!global._bmPortals || typeof global._bmPortals !== 'object') {
            global._bmPortals = { v: 1, list: [], updated: 0 };
        }
        if (!global._bmPortals.list || !Array.isArray(global._bmPortals.list)) {
            global._bmPortals.list = [];
        }
        return global._bmPortals;
    }

    function scanPortals(force) {
        if (!force) {
            if (portalScanTick !== -1 && (Game.time - portalScanTick) < PORTAL_SCAN_INTERVAL) return;
        }
        portalScanTick = Game.time;

        const reg = getPortalRegistry();
        const list = reg.list;
        const indexById = Object.create(null);
        for (let i = list.length; i--;) {
            const it = list[i];
            if (it && it.id) indexById[it.id] = it;
        }

        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room) continue;
            const portals = room.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_PORTAL });
            if (!portals || !portals.length) continue;

            for (let i = portals.length; i--;) {
                const portal = portals[i];
                const id = portal.id;
                const dest = portal.destination;
                if (!dest) continue;

                let destShard = Game.shard && Game.shard.name ? Game.shard.name : '';
                let destRoom = '';
                let destX = 25;
                let destY = 25;

                if (typeof dest.shard === 'string') destShard = dest.shard;
                if (typeof dest.room === 'string') destRoom = dest.room;
                else if (typeof dest.roomName === 'string') destRoom = dest.roomName;
                if (typeof dest.x === 'number') destX = dest.x;
                if (typeof dest.y === 'number') destY = dest.y;

                if (!destRoom) continue;

                let entry = indexById[id];
                if (!entry) {
                    entry = indexById[id] = {
                        id,
                        roomName: portal.pos.roomName,
                        x: portal.pos.x,
                        y: portal.pos.y,
                        destShard,
                        destRoom,
                        destX,
                        destY,
                        lastSeen: Game.time
                    };
                    list.push(entry);
                } else {
                    entry.roomName = portal.pos.roomName;
                    entry.x = portal.pos.x;
                    entry.y = portal.pos.y;
                    entry.destShard = destShard;
                    entry.destRoom = destRoom;
                    entry.destX = destX;
                    entry.destY = destY;
                    entry.lastSeen = Game.time;
                }
            }
        }

        reg.updated = Game.time;

        if (portalPruneTick === -1 || (Game.time - portalPruneTick) >= 1000) {
            portalPruneTick = Game.time;
            for (let i = list.length; i--;) {
                const it = list[i];
                if (!it || !it.lastSeen || (Game.time - it.lastSeen) > PORTAL_ENTRY_TTL) {
                    list.splice(i, 1);
                }
            }
        }
    }

    function pickPortalToShard(fromRoomName, targetShard, targetRoomName) {
        const reg = getPortalRegistry();
        const list = reg.list;
        if (!list || !list.length) return null;

        let best = null;
        let bestCost = Infinity;
        for (let i = list.length; i--;) {
            const p = list[i];
            if (!p || !p.destShard || p.destShard !== targetShard) continue;
            if (!p.roomName || !p.destRoom) continue;

            const a = Game.map.getRoomLinearDistance(fromRoomName, p.roomName);
            const b = Game.map.getRoomLinearDistance(p.destRoom, targetRoomName);
            const cost = a + b * 1.2;
            if (cost < bestCost) {
                bestCost = cost;
                best = p;
            }
        }
        return best;
    }

    function resetPortalScanState() {
        portalScanTick = -1;
        portalPruneTick = -1;
    }

    return {
        getPortalRegistry,
        scanPortals,
        pickPortalToShard,
        resetPortalScanState,
    };
}
