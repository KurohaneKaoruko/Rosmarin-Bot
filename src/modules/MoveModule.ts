import { decompress } from '@/shared/compress';
import { AID_BUILD_LAYERS, AID_BUILD_JOB_STATES } from '@/prototype/Creep/action/expansion/aid-build';
import { HARVESTER_DELIVER_STATES, HARVESTER_FLOW_STATES, HARVESTER_LAYERS } from '@/prototype/Creep/action/economy/harvester';

type MoveWorkTileCandidate = {
    pos: RoomPosition;
    range: number;
};

type MoveWorkTileRuntimeSnapshot = {
    tick: number;
    candidates: MoveWorkTileCandidate[];
};

type CreepWithMoveWorkTileSnapshot = Creep & {
    __moveWorkTileRuntimeSnapshot?: MoveWorkTileRuntimeSnapshot;
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

const isSamePosition = (left: RoomPosition, right: RoomPosition): boolean => {
    return left.roomName === right.roomName && left.x === right.x && left.y === right.y;
};

const getManagerLockCenter = (room: Room): RoomPosition | null => {
    const centerPos = room.getCenter?.();
    const storage = room.storage;
    if (!centerPos || !room.controller?.my || !storage) return null;
    const hasManageLink = !!room.link?.some((link) =>
        link &&
        link.pos.inRangeTo(centerPos, 1) &&
        link.pos.inRangeTo(storage, 2)
    );
    return room.terminal || hasManageLink ? centerPos : null;
};

const addCandidate = (
    candidates: MoveWorkTileCandidate[],
    seen: Set<string>,
    pos: RoomPosition | null | undefined,
    range: number
) => {
    if (!pos) return;
    const key = `${pos.roomName}:${pos.x}:${pos.y}:${range}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ pos, range });
};

const resolveObjectPos = (id: Id<any> | null | undefined): RoomPosition | null => {
    if (!id) return null;
    const target = Game.getObjectById(id) as { pos?: RoomPosition } | null;
    return target?.pos || null;
};

const resolvePackedPos = (roomName: string, packed: number | null | undefined): RoomPosition | null => {
    if (typeof packed !== 'number') return null;
    const [x, y] = decompress(packed);
    return new RoomPosition(x, y, roomName);
};

const resolveSlashPackedPos = (value: string | null | undefined): RoomPosition | null => {
    if (!value) return null;
    const [xRaw, yRaw, roomName] = value.split('/');
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !roomName) return null;
    return new RoomPosition(x, y, roomName);
};

const addObjectIdCandidate = (
    candidates: MoveWorkTileCandidate[],
    seen: Set<string>,
    id: Id<any> | null | undefined,
    range: number
) => {
    addCandidate(candidates, seen, resolveObjectPos(id), range);
};

const addPackedCandidate = (
    candidates: MoveWorkTileCandidate[],
    seen: Set<string>,
    roomName: string,
    packed: number | null | undefined,
    range: number
) => {
    addCandidate(candidates, seen, resolvePackedPos(roomName, packed), range);
};

const addSlashPackedCandidate = (
    candidates: MoveWorkTileCandidate[],
    seen: Set<string>,
    value: string | null | undefined,
    range: number
) => {
    addCandidate(candidates, seen, resolveSlashPackedPos(value), range);
};

const isPositionInCandidate = (pos: RoomPosition, candidate: MoveWorkTileCandidate): boolean => {
    return candidate.pos.roomName === pos.roomName && candidate.pos.getRangeTo(pos) <= candidate.range;
};

const isPositionInCandidates = (pos: RoomPosition, candidates: MoveWorkTileCandidate[]): boolean => {
    return candidates.some((candidate) => isPositionInCandidate(pos, candidate));
};

const isCompatHardLockTile = (creep: Creep, pos: RoomPosition): boolean => {
    if (!creep.memory?.dontPullMe) return false;
    return isSamePosition(creep.pos, pos);
};

const getMoveWorkTileRuntimeSnapshot = (
    creep: CreepWithMoveWorkTileSnapshot,
    resolver: () => MoveWorkTileCandidate[]
): MoveWorkTileRuntimeSnapshot => {
    const cached = creep.__moveWorkTileRuntimeSnapshot;
    if (cached && cached.tick === Game.time) return cached;

    const snapshot: MoveWorkTileRuntimeSnapshot = {
        tick: Game.time,
        candidates: resolver(),
    };
    creep.__moveWorkTileRuntimeSnapshot = snapshot;
    return snapshot;
};

const hasExplicitBuildOrRepairTarget = (cacheTarget: any): boolean => {
    return !!(
        cacheTarget?.task?.target ||
        cacheTarget?.buildRampartId ||
        cacheTarget?.repairId ||
        cacheTarget?.wallPos ||
        cacheTarget?.posInfo ||
        cacheTarget?.tasktype === 'build' ||
        cacheTarget?.tasktype === 'repair'
    );
};

const isSourceWorkState = (creep: Creep, role: string): boolean => {
    if (role === 'harvester') {
        const flowState = creep.memory.fsm?.[HARVESTER_LAYERS.FLOW] || '';
        const deliverState = creep.memory.fsm?.[HARVESTER_LAYERS.DELIVER] || '';
        return flowState === HARVESTER_FLOW_STATES.COLLECT || deliverState === HARVESTER_DELIVER_STATES.BUILD;
    }
    if (role === 'out-harvest') {
        return !creep.memory.working;
    }
    return false;
};

const isMineralWorkState = (creep: Creep): boolean => !creep.memory.working;

const getProjectMoveWorkTileCandidates = (creep: Creep): MoveWorkTileCandidate[] => {
    const snapshot = getMoveWorkTileRuntimeSnapshot(
        creep as CreepWithMoveWorkTileSnapshot,
        () => {
            const candidates: MoveWorkTileCandidate[] = [];
            const seen = new Set<string>();
            const cache = (creep.memory.cache || {}) as any;
            const cacheTarget = (creep.memory.cacheTarget || {}) as any;
            const role = creep.memory.role || '';
            const working = !!creep.memory.working;

            const boundSource = creep.getBoundSource?.();
            if (boundSource && SOURCE_WORK_ROLES.has(role) && isSourceWorkState(creep, role)) {
                addCandidate(candidates, seen, boundSource.pos, 1);
            }

            addObjectIdCandidate(candidates, seen, cacheTarget?.task?.target, 3);
            addObjectIdCandidate(candidates, seen, cacheTarget?.buildRampartId, 3);
            addObjectIdCandidate(candidates, seen, cacheTarget?.repairId, 3);
            addPackedCandidate(candidates, seen, creep.room.name, cacheTarget?.wallPos, 3);
            addPackedCandidate(candidates, seen, creep.room.name, cacheTarget?.posInfo, 3);

            switch (role) {
                case 'up-repair':
                    addObjectIdCandidate(candidates, seen, cacheTarget?.targetId, 3);
                    break;
                case 'out-build':
                    addObjectIdCandidate(candidates, seen, cacheTarget?.targetId, 3);
                    addObjectIdCandidate(candidates, seen, cacheTarget?.repairId, 3);
                    break;
                case 'aid-build':
                    addObjectIdCandidate(candidates, seen, cache?.repairTarget, 3);
                    addSlashPackedCandidate(candidates, seen, cache?.upgradePos, 1);
                    break;
                default:
                    break;
            }

            if (role === 'manager') {
                const centerPos = getManagerLockCenter(creep.room);
                if (centerPos && isSamePosition(creep.pos, centerPos)) {
                    addCandidate(candidates, seen, centerPos, 0);
                }
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

            if (
                role === 'aid-build' &&
                creep.room.controller?.my &&
                creep.memory.fsm?.[AID_BUILD_LAYERS.JOB] === AID_BUILD_JOB_STATES.UPGRADE
            ) {
                addCandidate(candidates, seen, creep.room.controller.pos, 3);
            }

            if (MINERAL_WORK_ROLES.has(role) && isMineralWorkState(creep)) {
                const mineral = creep.room.mineral || creep.room.find(FIND_MINERALS)[0];
                if (mineral) addCandidate(candidates, seen, mineral.pos, 1);
            }

            if (
                role === 'harvester' &&
                creep.memory.fsm?.[HARVESTER_LAYERS.DELIVER] === HARVESTER_DELIVER_STATES.BUILD &&
                creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
            ) {
                addObjectIdCandidate(candidates, seen, cacheTarget?.targetId, 1);
            }

            return candidates;
        }
    );

    return snapshot.candidates;
};

/**
 * 判断某个位置是否应被视为该 creep 的工位保护格。
 *
 * @remarks
 * 这里保持与 `超级移动优化 1.0.1` 一致的接入方式：
 * - 默认在这里直接解析 creep 当前的工作范围；
 * - 不在工作态时应返回 `true`，避免误伤正常让路；
 * - `dontPullMe` 仅作为项目内兼容硬锁，显式要求“只允许留在原地”。
 */
function isProjectWorkTile(creep: Creep | PowerCreep, pos: RoomPosition): boolean {
    if (!(creep instanceof Creep)) return true;

    if (isCompatHardLockTile(creep, pos)) return true;
    if (creep.memory?.dontPullMe) return false;
    const candidates = getProjectMoveWorkTileCandidates(creep);
    return candidates.length === 0 || isPositionInCandidates(pos, candidates);
}

/**
 * BetterMove 运行时接入模块：
 * - `start` 重置每 tick 的移动意图状态；
 * - `end` 在工位保护约束下统一结算移动。
 */
const MoveModule: RuntimeModule = {
    start: () => {
        global.BetterMove.preTickBetterMove();
    },
    end: () => {
        global.BetterMove.endTickResolve(isProjectWorkTile);
    }
};

export { MoveModule };
