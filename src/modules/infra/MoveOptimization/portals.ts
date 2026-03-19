/**
 * BetterMove portal 注册与跨 shard 入口选择。
 */
type PortalRegistryEntry = {
    id: Id<StructurePortal>;
    roomName: string;
    x: number;
    y: number;
    destShard: string;
    destRoom: string;
    destX: number;
    destY: number;
    lastSeen: number;
};

type PortalRegistry = {
    v: number;
    list: PortalRegistryEntry[];
    updated: number;
};

export function createPortalModule() {
    let portalScanTick = -1;
    let portalPruneTick = -1;
    const PORTAL_SCAN_INTERVAL = 20;
    const PORTAL_ENTRY_TTL = 50000;

    function getPortalRegistry(): PortalRegistry {
        const globalState = globalThis as typeof globalThis & { _bmPortals?: PortalRegistry };
        if (!globalState._bmPortals || typeof globalState._bmPortals !== 'object') {
            globalState._bmPortals = { v: 1, list: [], updated: 0 };
        }
        if (!globalState._bmPortals.list || !Array.isArray(globalState._bmPortals.list)) {
            globalState._bmPortals.list = [];
        }
        return globalState._bmPortals;
    }

    function scanPortals(force: boolean) {
        if (!force) {
            if (portalScanTick !== -1 && (Game.time - portalScanTick) < PORTAL_SCAN_INTERVAL) return;
        }
        portalScanTick = Game.time;

        const reg = getPortalRegistry();
        const list = reg.list;
        const indexById: Record<string, PortalRegistryEntry> = Object.create(null);
        for (let i = list.length; i--;) {
            const it = list[i];
            if (it && it.id) indexById[it.id] = it;
        }

        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room) continue;
            const portals = room.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_PORTAL }) as StructurePortal[];
            if (!portals || !portals.length) continue;

            for (let i = portals.length; i--;) {
                const portal = portals[i];
                const id = portal.id;
                const dest = portal.destination;
                if (!dest) continue;
                const runtimeDest = dest as RoomPosition & {
                    shard?: string;
                    room?: string;
                    roomName?: string;
                    x?: number;
                    y?: number;
                };

                let destShard = Game.shard && Game.shard.name ? Game.shard.name : '';
                let destRoom = '';
                let destX = 25;
                let destY = 25;

                if (typeof runtimeDest.shard === 'string') destShard = runtimeDest.shard;
                if (typeof runtimeDest.room === 'string') destRoom = runtimeDest.room;
                else if (typeof runtimeDest.roomName === 'string') destRoom = runtimeDest.roomName;
                if (typeof runtimeDest.x === 'number') destX = runtimeDest.x;
                if (typeof runtimeDest.y === 'number') destY = runtimeDest.y;

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

    function pickPortalToShard(fromRoomName: string, targetShard: string, targetRoomName: string) {
        const reg = getPortalRegistry();
        const list = reg.list;
        if (!list || !list.length) return null;

        let best: PortalRegistryEntry | null = null;
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
