/**
 * BetterMove 的 avoidRooms / observer 状态同步与控制面。
 * @description
 * 这部分本质上是“读 Memory / Game.structures，同步到运行时状态”的边缘层，
 * 同时顺手收口对 avoidRooms / avoidExits 的运行时增删改查，
 * 让主文件不再混杂这类状态控制细节。
 */
type RoomFlagMap = Record<string, 1>;
type AvoidExitMap = Record<string, RoomFlagMap>;
type ObserverRuntime = {
    id: string;
    roomName: string;
    taskQueue: unknown[];
    taskHead: number;
};
type AvoidSyncDeps = {
    observers: ObserverRuntime[];
    avoidRooms: RoomFlagMap;
    avoidExits: AvoidExitMap;
    syncedBypassRooms: RoomFlagMap;
    parseRoomName: (roomName: string) => object | null;
    markAvoidRoomsChanged: () => void;
    markAvoidExitsChanged: () => void;
    getAvoidRoomsSyncTick: () => number;
    setAvoidRoomsSyncTick: (value: number) => void;
    getAvoidRoomsMemorySignature: () => string;
    setAvoidRoomsMemorySignature: (value: string) => void;
    getAvoidRoomsMemoryInitialized: () => boolean;
    setAvoidRoomsMemoryInitialized: (value: boolean) => void;
};

function isOwnedObserver(structure: Structure<StructureConstant>): structure is StructureObserver {
    return structure.structureType === STRUCTURE_OBSERVER && 'my' in structure && !!structure.my;
}

export function createAvoidSyncModule(deps: AvoidSyncDeps) {
    function syncAvoidRooms(bypassRooms: string[]) {
        const nextBypassRooms: RoomFlagMap = Object.create(null);
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

    function normalizeBypassRooms(rawBypassRooms: unknown): string[] {
        if (!Array.isArray(rawBypassRooms) || !rawBypassRooms.length) {
            return [];
        }

        const dedup: Record<string, 1> = Object.create(null);
        const normalized: string[] = [];
        for (let i = 0; i < rawBypassRooms.length; i++) {
            const roomName = rawBypassRooms[i];
            if (typeof roomName !== 'string' || !roomName || dedup[roomName]) continue;
            dedup[roomName] = 1;
            normalized.push(roomName);
        }
        normalized.sort();
        return normalized;
    }

    function isBypassRoomsStateConsistent(bypassRooms: string[]) {
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

        const bypassRooms = normalizeBypassRooms((Memory as { bypassRooms?: unknown }).bypassRooms);
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
        const newObservers: ObserverRuntime[] = [];

        for (const id in Game.structures) {
            const structure = Game.structures[id];
            if (isOwnedObserver(structure)) {
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

    // 返回运行时 avoidRooms 的实时映射，保持与旧 BetterMove 控制台接口一致。
    function bmGetAvoidRoomsMap() {
        return deps.avoidRooms;
    }

    // 返回运行时 avoidExits 的实时映射，供控制台排查出口避让状态。
    function bmGetAvoidExitsMap() {
        return deps.avoidExits;
    }

    function bmAddAvoidRooms(roomName) {
        if (!deps.parseRoomName(roomName)) {
            return ERR_INVALID_ARGS;
        }
        if (!(roomName in deps.avoidRooms)) {
            deps.avoidRooms[roomName] = 1;
            deps.markAvoidRoomsChanged();
        }
        return OK;
    }

    function bmDeleteAvoidRooms(roomName) {
        if (!deps.parseRoomName(roomName) || !deps.avoidRooms[roomName]) {
            return ERR_INVALID_ARGS;
        }
        delete deps.avoidRooms[roomName];
        deps.markAvoidRoomsChanged();
        return OK;
    }

    function bmClearAvoidExits(fromRoomName) {
        if (fromRoomName === undefined) {
            let changed = false;
            for (const key in deps.avoidExits) {
                delete deps.avoidExits[key];
                changed = true;
            }
            if (changed) {
                deps.markAvoidExitsChanged();
            }
            return OK;
        }

        if (!deps.parseRoomName(fromRoomName)) {
            return ERR_INVALID_ARGS;
        }
        if (!(fromRoomName in deps.avoidExits)) {
            return ERR_NOT_FOUND;
        }
        delete deps.avoidExits[fromRoomName];
        deps.markAvoidExitsChanged();
        return OK;
    }

    function bmAddAvoidExits(fromRoomName, toRoomName) {
        if (!deps.parseRoomName(fromRoomName) || !deps.parseRoomName(toRoomName)) {
            return ERR_INVALID_ARGS;
        }
        deps.avoidExits[fromRoomName]
            ? deps.avoidExits[fromRoomName][toRoomName] = 1
            : deps.avoidExits[fromRoomName] = { [toRoomName]: 1 } as RoomFlagMap;
        deps.markAvoidExitsChanged();
        return OK;
    }

    function bmDeleteAvoidExits(fromRoomName, toRoomName) {
        if (!deps.parseRoomName(fromRoomName) || !deps.parseRoomName(toRoomName)) {
            return ERR_INVALID_ARGS;
        }
        if (fromRoomName in deps.avoidExits && toRoomName in deps.avoidExits[fromRoomName]) {
            delete deps.avoidExits[fromRoomName][toRoomName];
        }
        deps.markAvoidExitsChanged();
        return OK;
    }

    return {
        syncAvoidRooms,
        ensureAvoidRoomsUpToDate,
        autoDiscoverObservers,
        bmGetAvoidRoomsMap,
        bmGetAvoidExitsMap,
        bmAddAvoidRooms,
        bmDeleteAvoidRooms,
        bmClearAvoidExits,
        bmAddAvoidExits,
        bmDeleteAvoidExits,
    };
}
