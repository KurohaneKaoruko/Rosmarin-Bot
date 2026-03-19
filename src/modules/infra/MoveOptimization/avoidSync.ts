// @ts-nocheck

/**
 * BetterMove 的 avoidRooms / observer 懒刷新。
 * @description
 * 这部分本质上是“读 Memory / Game.structures，同步到运行时状态”的边缘层，
 * 拆出来后主文件就不再混杂同步细节。
 */
export function createAvoidSyncModule(deps) {
    function syncAvoidRooms(bypassRooms) {
        const nextBypassRooms = Object.create(null);
        if (Array.isArray(bypassRooms)) {
            for (const roomName of bypassRooms) {
                if (typeof roomName !== 'string' || !roomName) continue;
                nextBypassRooms[roomName] = 1;
            }
        }

        let changed = false;

        for (const roomName in deps.syncedBypassRooms) {
            if (!(roomName in nextBypassRooms)) {
                delete deps.syncedBypassRooms[roomName];
                delete deps.avoidRooms[roomName];
                changed = true;
            }
        }

        for (const roomName in nextBypassRooms) {
            deps.syncedBypassRooms[roomName] = 1;
            if (!(roomName in deps.avoidRooms)) {
                deps.avoidRooms[roomName] = 1;
                changed = true;
            }
        }

        if (changed) {
            deps.markAvoidRoomsChanged();
        }
    }

    function normalizeBypassRooms(rawBypassRooms) {
        if (!Array.isArray(rawBypassRooms) || !rawBypassRooms.length) {
            return [];
        }

        const dedup = Object.create(null);
        const normalized = [];
        for (let i = 0; i < rawBypassRooms.length; i++) {
            const roomName = rawBypassRooms[i];
            if (typeof roomName !== 'string' || !roomName || dedup[roomName]) continue;
            dedup[roomName] = 1;
            normalized.push(roomName);
        }
        normalized.sort();
        return normalized;
    }

    function isBypassRoomsStateConsistent(bypassRooms) {
        let syncedCount = 0;
        for (const roomName in deps.syncedBypassRooms) {
            syncedCount++;
            if (!(roomName in deps.avoidRooms)) {
                return false;
            }
        }
        if (syncedCount !== bypassRooms.length) {
            return false;
        }
        for (let i = 0; i < bypassRooms.length; i++) {
            const roomName = bypassRooms[i];
            if (!(roomName in deps.syncedBypassRooms) || !(roomName in deps.avoidRooms)) {
                return false;
            }
        }
        return true;
    }

    function ensureAvoidRoomsUpToDate() {
        if (deps.getAvoidRoomsSyncTick() === Game.time) {
            return;
        }
        deps.setAvoidRoomsSyncTick(Game.time);

        const bypassRooms = normalizeBypassRooms(Memory['bypassRooms']);
        const nextSignature = bypassRooms.join('|');
        let needSync = !deps.getAvoidRoomsMemoryInitialized() || nextSignature !== deps.getAvoidRoomsMemorySignature();
        if (!needSync && !isBypassRoomsStateConsistent(bypassRooms)) {
            needSync = true;
        }
        if (!needSync) {
            return;
        }

        deps.setAvoidRoomsMemoryInitialized(true);
        deps.setAvoidRoomsMemorySignature(nextSignature);
        syncAvoidRooms(bypassRooms);
    }

    function autoDiscoverObservers() {
        const newObservers = [];

        for (const id in Game.structures) {
            const structure = Game.structures[id];
            if (structure.structureType === STRUCTURE_OBSERVER && structure.my) {
                const observer = structure;
                const existing = deps.observers.find((ob) => ob.id === id);
                if (existing) {
                    if (typeof existing.taskHead !== 'number') {
                        existing.taskHead = 0;
                    }
                    newObservers.push(existing);
                } else {
                    newObservers.push({ id, roomName: observer.room.name, taskQueue: [], taskHead: 0 });
                }
            }
        }

        deps.observers.length = 0;
        for (const obs of newObservers) {
            deps.observers.push(obs);
        }
    }

    return {
        syncAvoidRooms,
        ensureAvoidRoomsUpToDate,
        autoDiscoverObservers,
    };
}
