import { decompress } from '@/modules/utils/compress';
import { HARVESTER_LAYERS, HARVESTER_FLOW_STATES, HARVESTER_DELIVER_STATES } from '@/prototype/Creep/action/main/harvester';
import { AID_BUILD_LAYERS, AID_BUILD_JOB_STATES } from '@/prototype/Creep/action/aid/aid-build';

// 工位候选：用于判断 creep 是否需要让位。
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

// 按 room/pos/range 去重，避免每 tick 候选列表过大。
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

// 通过 id 安全取对象，不存在则返回 null。
function resolveObjectPos(id: Id<any> | null | undefined): RoomPosition | null {
    if (!id) return null;
    const target = Game.getObjectById(id) as { pos?: RoomPosition } | null;
    return target?.pos || null;
}

// 将压缩坐标解码为 RoomPosition（见 compress.ts）。
function resolvePackedPos(roomName: string, packed: number | null | undefined): RoomPosition | null {
    if (typeof packed !== 'number') return null;
    const [x, y] = decompress(packed);
    return new RoomPosition(x, y, roomName);
}

// 解析 "x/y/roomName" 为 RoomPosition。
function resolveSlashPackedPos(value: string | null | undefined): RoomPosition | null {
    if (!value) return null;
    const [xRaw, yRaw, roomName] = value.split('/');
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !roomName) return null;
    return new RoomPosition(x, y, roomName);
}

function addObjectIdCandidate(
    candidates: WorkTileCandidate[],
    seen: Set<string>,
    id: Id<any> | null | undefined,
    range: number
) {
    addCandidate(candidates, seen, resolveObjectPos(id), range);
}

function addPackedCandidate(
    candidates: WorkTileCandidate[],
    seen: Set<string>,
    roomName: string,
    packed: number | null | undefined,
    range: number
) {
    addCandidate(candidates, seen, resolvePackedPos(roomName, packed), range);
}

function addSlashPackedCandidate(
    candidates: WorkTileCandidate[],
    seen: Set<string>,
    value: string | null | undefined,
    range: number
) {
    addCandidate(candidates, seen, resolveSlashPackedPos(value), range);
}

// 如果 creep 已有明确的建造/维修目标，则不再把控制器作为工位候选。
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

// source 相关角色的工作状态判定规则。
function isSourceWorkState(creep: Creep, role: string): boolean {
    if (role === 'harvester') {
        const flowState = creep.memory.fsm?.[HARVESTER_LAYERS.FLOW] || '';
        const deliverState = creep.memory.fsm?.[HARVESTER_LAYERS.DELIVER] || '';
        return flowState === HARVESTER_FLOW_STATES.COLLECT || deliverState === HARVESTER_DELIVER_STATES.BUILD;
    }
    if (role === 'out-harvest') {
        return !creep.memory.working;
    }
    return false;
}

// mineral 相关角色的工作状态判定规则。
function isMineralWorkState(creep: Creep): boolean {
    return !creep.memory.working;
}

// 收集应被视为“工位”的目标格子，避免移动优化把正在工作的 creep 挤出关键位置。
function collectWorkTileCandidates(creep: Creep): WorkTileCandidate[] {
    const candidates: WorkTileCandidate[] = [];
    const seen = new Set<string>();
    const cache = (creep.memory.cache || {}) as any;
    const cacheTarget = (creep.memory.cacheTarget || {}) as any;
    const role = creep.memory.role || '';
    const working = !!creep.memory.working;

    // 1) 绑定矿点/能量点的固定工位
    const boundSource = creep.getBoundSource?.();
    if (boundSource && SOURCE_WORK_ROLES.has(role) && isSourceWorkState(creep, role)) {
        addCandidate(candidates, seen, boundSource.pos, 1);
    }

    // 2) 通用缓存目标（build/repair/墙体/位置缓存）
    addObjectIdCandidate(candidates, seen, cacheTarget?.task?.target, 3);
    addObjectIdCandidate(candidates, seen, cacheTarget?.buildRampartId, 3);
    addObjectIdCandidate(candidates, seen, cacheTarget?.repairId, 3);
    addPackedCandidate(candidates, seen, creep.room.name, cacheTarget?.wallPos, 3);
    addPackedCandidate(candidates, seen, creep.room.name, cacheTarget?.posInfo, 3);

    // 3) 角色专用目标
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
            addSlashPackedCandidate(candidates, seen, cache?.upgradePos, 0);
            break;
        default:
            break;
    }

    // 4) 控制器工位（可选，避免抢占）
    if (
        creep.room.controller?.my &&
        CONTROLLER_WORK_ROLES.has(role) &&
        working &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
        (role !== 'worker' || !hasExplicitBuildOrRepairTarget(cacheTarget))
    ) {
        addCandidate(candidates, seen, creep.room.controller.pos, 3);
    }

    // 5) aid-build 在升级状态时保护控制器附近
    if (role === 'aid-build' && creep.room.controller?.my && creep.memory.fsm?.[AID_BUILD_LAYERS.JOB] === AID_BUILD_JOB_STATES.UPGRADE) {
        addCandidate(candidates, seen, creep.room.controller.pos, 3);
    }

    // 6) 矿物工位
    if (MINERAL_WORK_ROLES.has(role) && isMineralWorkState(creep)) {
        const mineral = creep.room.mineral || creep.room.find(FIND_MINERALS)[0];
        if (mineral) addCandidate(candidates, seen, mineral.pos, 1);
    }

    // 7) 采集工在建造状态下的目标工位
    if (
        role === 'harvester' &&
        creep.memory.fsm?.[HARVESTER_LAYERS.DELIVER] === HARVESTER_DELIVER_STATES.BUILD &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
        addObjectIdCandidate(candidates, seen, cacheTarget?.targetId, 1);
    }

    return candidates;
}

// 判断某个位置是否应被视为该 creep 的工位保护格。
// PowerCreep 默认放行，避免阻挡其行动。
function isProjectWorkTile(creep: Creep | PowerCreep, pos: RoomPosition): boolean {
    if (!(creep instanceof Creep)) return true;

    const candidates = collectWorkTileCandidates(creep);
    if (candidates.length === 0) return true;

    return candidates.some((candidate) =>
        candidate.pos.roomName === pos.roomName && candidate.pos.getRangeTo(pos) <= candidate.range
    );
}

// 将 BetterMove 接入运行时循环：
// - start：重置每 tick 的移动意图状态
// - end：带工位保护地结算移动意图
const MoveModule: RuntimeModule = {
    start: () => {
        global.BetterMove.preTickBetterMove();
    },
    end: () => {
        global.BetterMove.endTickResolve(isProjectWorkTile);
    }
};

export { MoveModule };
