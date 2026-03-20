import { decompress } from '@/modules/utils/compress';
import { HARVESTER_LAYERS, HARVESTER_FLOW_STATES, HARVESTER_DELIVER_STATES } from '@/prototype/Creep/action/main/harvester';
import { AID_BUILD_LAYERS, AID_BUILD_JOB_STATES } from '@/prototype/Creep/action/aid/aid-build';

/**
 * 移动工位候选：
 * 用于告诉 MoveModule「这个 creep 正在保护哪些关键工位范围」。
 */
type MoveWorkTileCandidate = {
    pos: RoomPosition;
    range: number;
};

/**
 * `isMoveWorkTile` 的运行时快照。
 *
 * @remarks
 * `endTickResolve` 在同一 tick 内会多次询问同一个 creep 的工位判定，
 * 用快照缓存可以避免重复扫描 memory / 邻近 creep，降低对 CPU 的冲击。
 */
type MoveWorkTileRuntimeSnapshot = {
    tick: number;
    candidates: MoveWorkTileCandidate[];
    standingOnWorkTile: boolean;
    crowdedAroundWorkTile: boolean;
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

/**
 * 把候选点写入列表，并按 room/x/y/range 去重。
 */
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

/**
 * 通过对象 ID 读取坐标。
 */
const resolveObjectPos = (id: Id<any> | null | undefined): RoomPosition | null => {
    if (!id) return null;
    const target = Game.getObjectById(id) as { pos?: RoomPosition } | null;
    return target?.pos || null;
};

/**
 * 解析压缩坐标（number）为 RoomPosition。
 */
const resolvePackedPos = (roomName: string, packed: number | null | undefined): RoomPosition | null => {
    if (typeof packed !== 'number') return null;
    const [x, y] = decompress(packed);
    return new RoomPosition(x, y, roomName);
};

/**
 * 解析 `x/y/roomName` 字符串为 RoomPosition。
 */
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

/**
 * 判定坐标是否落在工位候选范围内。
 */
const isPositionInCandidate = (pos: RoomPosition, candidate: MoveWorkTileCandidate): boolean => {
    return candidate.pos.roomName === pos.roomName && candidate.pos.getRangeTo(pos) <= candidate.range;
};

/**
 * 判定坐标是否属于任一工位候选范围。
 */
const isPositionInCandidates = (pos: RoomPosition, candidates: MoveWorkTileCandidate[]): boolean => {
    return candidates.some((candidate) => isPositionInCandidate(pos, candidate));
};

/**
 * 判定候选位置是否“更靠近”至少一个工位中心。
 *
 * @remarks
 * 用于抑制“同层横移”造成的来回对穿抖动：
 * - 已在工位范围内时，默认只允许停留原地或向更优工位方向收敛；
 * - 若只是横向换位（与所有工位中心距离都不变），则判定为非必要让位。
 */
const canMoveCloserToAnyCandidate = (
    currentPos: RoomPosition,
    nextPos: RoomPosition,
    candidates: MoveWorkTileCandidate[]
): boolean => {
    for (const candidate of candidates) {
        if (!isPositionInCandidate(nextPos, candidate)) continue;
        if (nextPos.getRangeTo(candidate.pos) < currentPos.getRangeTo(candidate.pos)) return true;
    }
    return false;
};

/**
 * 读取（或构建）当前 tick 的工位判定快照。
 */
const getMoveWorkTileRuntimeSnapshot = (
    creep: CreepWithMoveWorkTileSnapshot,
    resolver: () => MoveWorkTileCandidate[]
): MoveWorkTileRuntimeSnapshot => {
    const cached = creep.__moveWorkTileRuntimeSnapshot;
    if (cached && cached.tick === Game.time) return cached;

    const candidates = resolver();
    const standingOnWorkTile = isPositionInCandidates(creep.pos, candidates);

    // 当本 creep 已经在工位范围内且附近存在同工位 creep 时，
    // 允许横向让位，避免“明明有空位却都挤在一个点位”。
    let crowdedAroundWorkTile = false;
    if (standingOnWorkTile && candidates.length > 0) {
        const nearbyAllies = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
            filter: (other: Creep) =>
                other.id !== creep.id && isPositionInCandidates(other.pos, candidates)
        });
        crowdedAroundWorkTile = nearbyAllies.length > 0;
    }

    const snapshot: MoveWorkTileRuntimeSnapshot = {
        tick: Game.time,
        candidates,
        standingOnWorkTile,
        crowdedAroundWorkTile
    };
    creep.__moveWorkTileRuntimeSnapshot = snapshot;
    return snapshot;
};

/**
 * worker 已经有明确建造/维修目标时，不额外把控制器工位加入保护范围。
 */
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

/**
 * source 类角色是否处于应保护采集工位的工作态。
 */
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

/**
 * mineral 类角色是否处于应保护矿点工位的工作态。
 */
const isMineralWorkState = (creep: Creep): boolean => !creep.memory.working;

/**
 * Creep 工位决策函数：
 * 把与角色相关的工位候选计算下沉到 creep 自身。
 */
export default class WorkTileFunction extends Creep {
    /**
     * 采集本 creep 本 tick 需要保护的工位候选。
     *
     * @returns 工位候选数组；空数组表示当前无需保护工位。
     */
    getMoveWorkTileCandidates(): Array<{ pos: RoomPosition; range: number }> {
        const candidates: MoveWorkTileCandidate[] = [];
        const seen = new Set<string>();
        const cache = (this.memory.cache || {}) as any;
        const cacheTarget = (this.memory.cacheTarget || {}) as any;
        const role = this.memory.role || '';
        const working = !!this.memory.working;

        // 1) 绑定 source 工位
        const boundSource = this.getBoundSource?.();
        if (boundSource && SOURCE_WORK_ROLES.has(role) && isSourceWorkState(this, role)) {
            addCandidate(candidates, seen, boundSource.pos, 1);
        }

        // 2) 通用缓存目标工位
        addObjectIdCandidate(candidates, seen, cacheTarget?.task?.target, 3);
        addObjectIdCandidate(candidates, seen, cacheTarget?.buildRampartId, 3);
        addObjectIdCandidate(candidates, seen, cacheTarget?.repairId, 3);
        addPackedCandidate(candidates, seen, this.room.name, cacheTarget?.wallPos, 3);
        addPackedCandidate(candidates, seen, this.room.name, cacheTarget?.posInfo, 3);

        // 3) 角色专用工位
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
                // AIDB 升级位原先是严格单点（range=0），在高压期会导致多人排队堵在同一点。
                // 这里放宽到 1 格：仍保持“围绕升级位工作”，但允许 move solver 做小范围疏散。
                addSlashPackedCandidate(candidates, seen, cache?.upgradePos, 1);
                break;
            default:
                break;
        }

        // 4) 控制器工位
        if (
            this.room.controller?.my &&
            CONTROLLER_WORK_ROLES.has(role) &&
            working &&
            this.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
            (role !== 'worker' || !hasExplicitBuildOrRepairTarget(cacheTarget))
        ) {
            addCandidate(candidates, seen, this.room.controller.pos, 3);
        }

        // 5) aid-build 升级态保护控制器
        if (
            role === 'aid-build' &&
            this.room.controller?.my &&
            this.memory.fsm?.[AID_BUILD_LAYERS.JOB] === AID_BUILD_JOB_STATES.UPGRADE
        ) {
            addCandidate(candidates, seen, this.room.controller.pos, 3);
        }

        // 6) 矿物工位
        if (MINERAL_WORK_ROLES.has(role) && isMineralWorkState(this)) {
            const mineral = this.room.mineral || this.room.find(FIND_MINERALS)[0];
            if (mineral) addCandidate(candidates, seen, mineral.pos, 1);
        }

        // 7) harvester 建造态工位
        if (
            role === 'harvester' &&
            this.memory.fsm?.[HARVESTER_LAYERS.DELIVER] === HARVESTER_DELIVER_STATES.BUILD &&
            this.store.getUsedCapacity(RESOURCE_ENERGY) > 0
        ) {
            addObjectIdCandidate(candidates, seen, cacheTarget?.targetId, 1);
        }

        return candidates;
    }

    /**
     * 判断某个位置是否属于当前 creep 的“工位保护范围”。
     *
     * @param pos 待判定的位置。
     * @returns `true` 表示该位置可被视为当前 creep 的工位保护格。
     */
    isMoveWorkTile(pos: RoomPosition): boolean {
        const snapshot = getMoveWorkTileRuntimeSnapshot(
            this as CreepWithMoveWorkTileSnapshot,
            () => this.getMoveWorkTileCandidates()
        );
        const candidates = snapshot.candidates;
        if (candidates.length === 0) return true;

        // 先做硬性范围判定：不在候选范围就不是工位。
        if (!isPositionInCandidates(pos, candidates)) return false;

        // 当前不在工位上（通常是过渡移动中）时，不施加防抖限制，避免误伤正常让路。
        if (!snapshot.standingOnWorkTile) return true;

        // 已在工位且目标还是原地，永远允许。
        if (pos.roomName === this.pos.roomName && pos.x === this.pos.x && pos.y === this.pos.y) return true;

        // 工位拥挤时允许横向分流，让位逻辑优先解决拥堵。
        if (snapshot.crowdedAroundWorkTile) return true;

        // 非拥挤状态下只允许“更靠近工位中心”的移动，抑制无意义来回对穿。
        return canMoveCloserToAnyCandidate(this.pos, pos, candidates);
    }
}
