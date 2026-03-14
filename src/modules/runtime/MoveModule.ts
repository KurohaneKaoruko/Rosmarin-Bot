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

const SOURCE_WORK_ROLES = new Set([
    'harvester',
    'out-harvest',
]);

const MINERAL_WORK_ROLES = new Set([
    'mineral',
    'out-mineral',
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

function resolveSlashPackedPos(value: string | null | undefined): RoomPosition | null {
    if (!value) return null;
    const [xRaw, yRaw, roomName] = value.split('/');
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !roomName) return null;
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

function isSourceWorkState(creep: Creep, role: string): boolean {
    if (role === 'harvester') {
        const action = String(creep.memory.action || '');
        return action === 'harvest' || action === 'build';
    }
    if (role === 'out-harvest') {
        return !creep.memory.working;
    }
    return false;
}

function isMineralWorkState(creep: Creep): boolean {
    return !creep.memory.working;
}

function collectWorkTileCandidates(creep: Creep): WorkTileCandidate[] {
    const candidates: WorkTileCandidate[] = [];
    const seen = new Set<string>();
    const cache = (creep.memory.cache || {}) as any;
    const cacheTarget = (creep.memory.cacheTarget || {}) as any;
    const role = creep.memory.role || '';
    const working = !!creep.memory.working;

    const boundSource = creep.getBoundSource?.();
    if (boundSource && SOURCE_WORK_ROLES.has(role) && isSourceWorkState(creep, role)) {
        addCandidate(candidates, seen, boundSource.pos, 1);
    }

    addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.task?.target), 3);
    addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.buildRampartId), 3);
    addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.repairId), 3);
    addCandidate(candidates, seen, resolvePackedPos(creep.room.name, cacheTarget?.wallPos), 3);
    addCandidate(candidates, seen, resolvePackedPos(creep.room.name, cacheTarget?.posInfo), 3);

    if (role === 'up-repair') {
        addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.targetId), 3);
    } else if (role === 'out-build') {
        addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.targetId), 3);
        addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.repairId), 3);
    }

    if (role === 'aid-build') {
        addCandidate(candidates, seen, resolveObjectPos(cache?.repairTarget), 3);
        addCandidate(candidates, seen, resolveSlashPackedPos(cache?.upgradePos), 0);
    }

    if (
        creep.room.controller?.my &&
        CONTROLLER_WORK_ROLES.has(role) &&
        working &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
        (role !== 'worker' || !hasExplicitBuildOrRepairTarget(cacheTarget))
    ) {
        addCandidate(candidates, seen, creep.room.controller.pos, 3);
    }

    if (role === 'aid-build' && creep.room.controller?.my && String(creep.memory.action || '') === 'upgrade') {
        addCandidate(candidates, seen, creep.room.controller.pos, 3);
    }

    if (MINERAL_WORK_ROLES.has(role) && isMineralWorkState(creep)) {
        const mineral = creep.room.mineral || creep.room.find(FIND_MINERALS)[0];
        if (mineral) addCandidate(candidates, seen, mineral.pos, 1);
    }

    if (
        role === 'harvester' &&
        String(creep.memory.action || '') === 'build' &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
        addCandidate(candidates, seen, resolveObjectPos(cacheTarget?.targetId), 1);
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
    start: () => {
        global.BetterMove?.preTickBetterMove?.();
    },
    end: () => {
        global.BetterMove?.endTickResolve?.(isProjectWorkTile);
    }
};

export { MoveModule };
