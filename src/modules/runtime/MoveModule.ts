import { decompress } from '@/modules/utils/compress';

type WorkTileCandidate = {
    pos: RoomPosition;
    range: number;
};

const CONTROLLER_WORK_ROLES = new Set([
    'upgrader',
    'worker',
    'aid-upgrade',
    'up-upgrade',
]);

function addCandidate(
    candidates: WorkTileCandidate[],
    seen: Set<string>,
    pos: RoomPosition | null | undefined,
    range: number
) {
    if (!pos) return;
    const key = `${pos.roomName}:${pos.x}:${pos.y}:${range}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ pos, range });
}

function resolveObjectPos(id: Id<any> | null | undefined): RoomPosition | null {
    if (!id) return null;
    const target = Game.getObjectById(id) as { pos?: RoomPosition } | null;
    return target?.pos || null;
}

function resolvePackedPos(roomName: string, packed: number | null | undefined): RoomPosition | null {
    if (typeof packed !== 'number') return null;
    const [x, y] = decompress(packed);
    return new RoomPosition(x, y, roomName);
}

function hasExplicitBuildOrRepairTarget(cacheTarget: any): boolean {
    return !!(
        cacheTarget?.task?.target ||
        cacheTarget?.buildRampartId ||
        cacheTarget?.repairId ||
        cacheTarget?.wallPos ||
        cacheTarget?.posInfo ||
        cacheTarget?.tasktype === 'build' ||
        cacheTarget?.tasktype === 'repair'
    );
}

function collectWorkTileCandidates(creep: Creep): WorkTileCandidate[] {
    const candidates: WorkTileCandidate[] = [];
    const seen = new Set<string>();
    const cache = (creep.memory.cache || {}) as any;
    const cacheSource = (creep.memory.cacheSource || {}) as any;
    const cacheTarget = (creep.memory.cacheTarget || {}) as any;
    const role = creep.memory.role || '';

    const boundSource = creep.getBoundSource?.();
    if (boundSource) addCandidate(candidates, seen, boundSource.pos, 1);

    addCandidate(candidates, seen, resolveObjectPos(cache?.takeTarget?.id), 1);
    addCandidate(candidates, seen, resolveObjectPos(cacheSource?.sourceId), 1);
    addCandidate(candidates, seen, resolveObjectPos(cacheSource?.targetId), 1);
    addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.sourceId), 1);

    addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.task?.target), 3);
    addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.buildRampartId), 3);
    addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.repairId), 3);
    addCandidate(candidates, seen, resolvePackedPos(creep.room.name, cacheTarget?.wallPos), 3);
    addCandidate(candidates, seen, resolvePackedPos(creep.room.name, cacheTarget?.posInfo), 3);

    if (role === 'up-repair') {
        addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.targetId), 3);
    } else {
        addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.targetId), 1);
    }

    if (
        creep.room.controller?.my &&
        CONTROLLER_WORK_ROLES.has(role) &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
        (role !== 'worker' || !hasExplicitBuildOrRepairTarget(cacheTarget))
    ) {
        addCandidate(candidates, seen, creep.room.controller.pos, 3);
    }

    if (role === 'mineral' || role === 'out-mineral') {
        const mineral = creep.room.mineral || creep.room.find(FIND_MINERALS)[0];
        if (mineral) addCandidate(candidates, seen, mineral.pos, 1);
    }

    return candidates;
}

function isProjectWorkTile(creep: Creep | PowerCreep, pos: RoomPosition): boolean {
    if (!(creep instanceof Creep)) return true;

    const candidates = collectWorkTileCandidates(creep);
    if (candidates.length === 0) return true;

    return candidates.some((candidate) =>
        candidate.pos.roomName === pos.roomName && candidate.pos.getRangeTo(pos) <= candidate.range
    );
}

const MoveModule: RuntimeModule = {
    end: () => {
        global.BetterMove?.endTickResolve?.(isProjectWorkTile);
    }
};

export { MoveModule };
