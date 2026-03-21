
import { parseShardRoomName } from '@/modules/utils/shardRoom';
import { THRESHOLDS } from '@/constant/Thresholds';
import { StateMachine } from '@/framework/ai/stateMachine';
import { createFsmStorage, createLayeredRunner, ensureFsmBucket } from '@/framework/ai/adapters';

// ==============================
//  Aid-Build 多层 FSM 状态常量
// ==============================

// 多层 FSM layer 标识：能量流转层 + 工程任务层
export const AID_BUILD_LAYERS = {
    FLOW: 'aid-build:flow',
    JOB: 'aid-build:job'
} as const;

// 能量流转层：只负责“采集 / 工作”切换
export const AID_BUILD_FLOW_STATES = {
    COLLECT: 'collect',
    WORK: 'work'
} as const;
type AidBuildFlowState = typeof AID_BUILD_FLOW_STATES[keyof typeof AID_BUILD_FLOW_STATES];

const AID_BUILD_FLOW_EVENTS = {
    READY_TO_WORK: 'ready_to_work',
    NEED_ENERGY: 'need_energy'
} as const;
type AidBuildFlowEvent = typeof AID_BUILD_FLOW_EVENTS[keyof typeof AID_BUILD_FLOW_EVENTS];

const AID_BUILD_FLOW_GUARDS = {
    READY_TO_WORK: 'ready_to_work',
    NEED_ENERGY: 'need_energy'
} as const;
type AidBuildFlowGuard = typeof AID_BUILD_FLOW_GUARDS[keyof typeof AID_BUILD_FLOW_GUARDS];

// 工程任务层：只负责 build / repair / upgrade / stage 的切换
export const AID_BUILD_JOB_STATES = {
    BUILD: 'build',
    REPAIR: 'repair',
    UPGRADE: 'upgrade',
    STAGE: 'stage'
} as const;
type AidBuildJobState = typeof AID_BUILD_JOB_STATES[keyof typeof AID_BUILD_JOB_STATES];

const AID_BUILD_JOB_EVENTS = {
    GO_BUILD: 'go_build',
    GO_REPAIR: 'go_repair',
    GO_UPGRADE: 'go_upgrade',
    GO_STAGE: 'go_stage'
} as const;
type AidBuildJobEvent = typeof AID_BUILD_JOB_EVENTS[keyof typeof AID_BUILD_JOB_EVENTS];

const AID_BUILD_JOB_GUARDS = {
    CAN_BUILD: 'can_build',
    CAN_REPAIR: 'can_repair',
    CAN_UPGRADE: 'can_upgrade',
    NEED_STAGE: 'need_stage'
} as const;
type AidBuildJobGuard = typeof AID_BUILD_JOB_GUARDS[keyof typeof AID_BUILD_JOB_GUARDS];

const AID_BUILD_JOB_EVENT_BY_STATE: Record<AidBuildJobState, AidBuildJobEvent> = {
    [AID_BUILD_JOB_STATES.BUILD]: AID_BUILD_JOB_EVENTS.GO_BUILD,
    [AID_BUILD_JOB_STATES.REPAIR]: AID_BUILD_JOB_EVENTS.GO_REPAIR,
    [AID_BUILD_JOB_STATES.UPGRADE]: AID_BUILD_JOB_EVENTS.GO_UPGRADE,
    [AID_BUILD_JOB_STATES.STAGE]: AID_BUILD_JOB_EVENTS.GO_STAGE
};

type AidBuildContext = {
    creep: Creep;
    // 是否已经准备进入“工作”状态（由采集层驱动）
    readyToWork: boolean;
    // 当前 tick 评估的工作任务
    jobDecision: AidBuildJobState;
};

export const ensureAidBuildMemory = (creep: Creep | null | undefined): creep is Creep => {
    if (!creep) return false;
    try {
        // 统一借助框架层初始化 fsm 容器。
        // 这里允许 creep.memory 为 null，由 ensureFsmBucket 负责修正根容器。
        ensureFsmBucket(creep);
        return true;
    } catch {
        // 极端脏数据（例如 memory getter/setter 直接抛错）时不要让整套 FSM 崩掉，
        // 外层会退回到内存外兜底存储，保证本 tick 仍可运行。
        return false;
    }
};

const createFallbackAidBuildStorage = <S extends string>(state: S) => {
    // 极端情况下（如传入无效 creep）提供内存外兜底存储，保证状态机可构建
    let current = state;
    return {
        get: () => current,
        set: (next: S) => {
            current = next;
        }
    };
};

/**
 * 为 aid-build 的每个 FSM layer 创建安全存储
 * @description 优先落到 creep.memory.fsm；若内存结构异常则回退到内存外临时存储
 */
export const createAidBuildLayerStorage = <S extends string>(
    creep: Creep,
    layerId: string,
    fallbackState: S
) => {
    if (!ensureAidBuildMemory(creep)) {
        return createFallbackAidBuildStorage<S>(fallbackState);
    }

    try {
        // 二次调用是有意为之：createFsmStorage 的 get/set 每次都会重新校验 bucket，
        // 这里仅在构建阶段先探测一次，确保后续运行期异常可回退。
        ensureFsmBucket(creep);
        return createFsmStorage<S>(creep, layerId);
    } catch {
        return createFallbackAidBuildStorage<S>(fallbackState);
    }
};
// ==============================
//  Source 选择与队列工具
// ==============================

type AidBuildSourceCandidate = {
    id: string;
    assigned: number;
    walkable: number;
    distance: number;
    current?: boolean;
};

type AidBuildOccupantLike = {
    memory?: {
        targetSourceId?: Id<Source>;
        spawnFlag?: string;
        action?: string;
        fsm?: Record<string, string>;
    };
    store?: StoreDefinition;
};

const isAidBuildFlowState = (state: unknown): state is AidBuildFlowState => {
    // 防御非法 memory 注入，确保只接受 flow 层声明过的状态值
    return typeof state === 'string' && Object.values(AID_BUILD_FLOW_STATES).includes(state as AidBuildFlowState);
};

const isAidBuildJobState = (state: unknown): state is AidBuildJobState => {
    // 防御非法 memory 注入，确保只接受 job 层声明过的状态值
    return typeof state === 'string' && Object.values(AID_BUILD_JOB_STATES).includes(state as AidBuildJobState);
};

const AID_BUILD_WAITABLE_STRUCTURES = new Set<StructureConstant>([
    'road',
    'container',
    'rampart',
]);

/**
 * 在多个 source 中做负载均衡选取
 * @description 按“已分配/可站位”权重排序，尽量避免同源拥堵
 */
export function chooseAidBuildSourceId(candidates: AidBuildSourceCandidate[]): string | null {
    const available = candidates.filter((candidate) => candidate.walkable > 0 && candidate.assigned < candidate.walkable);
    if (available.length <= 0) return null;

    const current = available.find((candidate) => candidate.current);
    if (current) {
        const minAssigned = Math.min(...available.map((candidate) => candidate.assigned));
        if (current.assigned <= minAssigned + 1) return current.id;
    }

    available.sort((a, b) => {
        const aLoad = a.assigned / Math.max(1, a.walkable);
        const bLoad = b.assigned / Math.max(1, b.walkable);
        if (aLoad !== bLoad) return aLoad - bLoad;
        if (a.assigned !== b.assigned) return a.assigned - b.assigned;
        if (a.walkable !== b.walkable) return b.walkable - a.walkable;
        return a.distance - b.distance;
    });

    return available[0]?.id || null;
}

/**
 * 判断某个 creep 是否应当“占用” source
 * @description 兼容旧 action + 新 FSM 状态
 */
export function shouldReserveAidBuildSource(occupant: AidBuildOccupantLike, focusFlag?: string): boolean {
    const memory = occupant?.memory;
    if (!memory?.targetSourceId) return false;
    if (focusFlag && memory.spawnFlag !== focusFlag) return false;

    // 先读取原始状态，再做白名单校验并回退默认值
    const rawFlowState = memory.fsm?.[AID_BUILD_LAYERS.FLOW];
    const rawJobState = memory.fsm?.[AID_BUILD_LAYERS.JOB];
    const flowState = isAidBuildFlowState(rawFlowState) ? rawFlowState : AID_BUILD_FLOW_STATES.COLLECT;
    const jobState = isAidBuildJobState(rawJobState) ? rawJobState : AID_BUILD_JOB_STATES.STAGE;

    if (flowState === AID_BUILD_FLOW_STATES.COLLECT) return true;
    if (jobState !== AID_BUILD_JOB_STATES.STAGE) return false;

    const freeCapacity = occupant.store?.getFreeCapacity?.() ?? 0;
    const usedCapacity = occupant.store?.getUsedCapacity?.() ?? 0;
    return freeCapacity > 0 || usedCapacity === 0;
}

/**
 * 统计 source 周围可站位数量
 * @description 八方向都应计入，仅跳过 source 自身所在格
 */
export const countAidBuildWalkableSourceSlots = (room: Room, source: Source): number => {
    const terrain = room.getTerrain();
    let walkable = 0;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = source.pos.x + dx;
            const y = source.pos.y + dy;
            if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
            if (terrain.get(x, y) !== TERRAIN_MASK_WALL) walkable++;
        }
    }

    return walkable;
};

/**
 * 队列站位索引：保证多个 creep 平均分布
 */
export function getAidBuildWaitSlotIndex(waiterNames: string[], creepName: string, slotCount: number): number {
    if (slotCount <= 0) return -1;
    const ordered = [...new Set([...waiterNames, creepName])].sort();
    const index = ordered.indexOf(creepName);
    return (index >= 0 ? index : 0) % slotCount;
}

const releaseAidBuildSource = (creep: Creep) => {
    if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
};

const hasAidBuildRangedThreat = (hostile: Creep): boolean => (
    hostile.getActiveBodyparts(RANGED_ATTACK) > 0
);

const hasAidBuildMeleeThreat = (hostile: Creep): boolean => (
    hostile.getActiveBodyparts(ATTACK) > 0
);

const getAidBuildTravelThreatRange = (hostile: Creep): number => {
    if (hasAidBuildRangedThreat(hostile)) return 6;
    if (hasAidBuildMeleeThreat(hostile)) return 4;
    return 0;
};

const getAidBuildImmediateFleeRange = (hostile: Creep): number => {
    if (hasAidBuildRangedThreat(hostile)) return 5;
    if (hasAidBuildMeleeThreat(hostile)) return 3;
    return 0;
};

const findAidBuildTravelThreats = (room: Room): Creep[] => {
    return room.find(FIND_HOSTILE_CREEPS, {
        filter: (hostile) =>
            !hostile.isWhiteList() &&
            (hostile.getActiveBodyparts(ATTACK) > 0 || hostile.getActiveBodyparts(RANGED_ATTACK) > 0)
    }) as Creep[];
};

const createAidBuildThreatCostCallback = () => {
    return (roomName: string, costs: CostMatrix): CostMatrix => {
        const room = Game.rooms[roomName];
        if (!room) return costs;

        const dangerousHostiles = findAidBuildTravelThreats(room);
        for (const hostile of dangerousHostiles) {
            const avoidRange = getAidBuildTravelThreatRange(hostile);
            for (let dx = -avoidRange; dx <= avoidRange; dx++) {
                for (let dy = -avoidRange; dy <= avoidRange; dy++) {
                    const x = hostile.pos.x + dx;
                    const y = hostile.pos.y + dy;
                    if (x < 0 || x > 49 || y < 0 || y > 49) continue;

                    const dist = Math.max(Math.abs(dx), Math.abs(dy));
                    if (dist > avoidRange) continue;

                    if (dist <= 1) {
                        costs.set(x, y, 255);
                        continue;
                    }

                    const currentCost = costs.get(x, y);
                    const nextCost = Math.max(currentCost, Math.min(254, 30 + (avoidRange - dist + 1) * 25));
                    costs.set(x, y, nextCost);
                }
            }
        }

        return costs;
    };
};

// Aid-build 在跨房前往目标房时应主动绕开带攻击能力的敌对 creep；
// 只有进入贴脸危险范围时才立刻 flee，其他情况依赖 path cost 绕行。
const avoidAidBuildTravelThreats = (creep: Creep): boolean => {
    const dangerousHostiles = findAidBuildTravelThreats(creep.room);
    if (dangerousHostiles.length <= 0) return false;

    const immediateThreats = dangerousHostiles
        .filter((hostile) => creep.pos.inRangeTo(hostile, getAidBuildImmediateFleeRange(hostile)))
        .map((hostile) => ({
            pos: hostile.pos,
            range: getAidBuildTravelThreatRange(hostile),
        }));

    if (immediateThreats.length <= 0) return false;

    const fleeResult = creep.flee(immediateThreats, {
        maxRooms: 1,
        plainCost: 2,
        swampCost: 10,
        costCallback: createAidBuildThreatCostCallback(),
    });
    return fleeResult === OK;
};

const moveAidBuildToTargetRoom = (creep: Creep): boolean => {
    const targetRoom = creep.memory.targetRoom;
    if (!targetRoom) return true;

    const { roomName: localRoom, shard } = parseShardRoomName(targetRoom);
    const arrived = (!shard || shard === Game.shard.name) && creep.room.name === localRoom;
    if (arrived) return true;

    if (avoidAidBuildTravelThreats(creep)) return false;
    creep.moveToRoom(targetRoom, {
        plainCost: 2,
        swampCost: 10,
        costCallback: createAidBuildThreatCostCallback(),
    });
    return false;
};
// ==============================
//  能量状态 / 升级策略
// ==============================

export const shouldForceAidBuildDowngradeUpgrade = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my) return false;
    const ttd = controller.ticksToDowngrade || 0;
    return ttd < THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TTD;
};

const getAidBuildEnergyState = (room: Room): NonNullable<RoomMemory['energyState']> => {
    return room.getEnergyState?.() || room.updateEnergyState?.(false) || room.memory?.energyState || 'NORMAL';
};

const getAidBuildTotalEnergy = (room: Room) => {
    const profile = room.getEnergyProfile?.();
    if (profile) return profile.totalEnergy;
    const containerEnergy = (room.container || []).reduce((sum, container) => sum + (container.store[RESOURCE_ENERGY] || 0), 0);
    const linkEnergy = (room.link || []).reduce((sum, link) => sum + (link.store[RESOURCE_ENERGY] || 0), 0);
    return ((room as any)[RESOURCE_ENERGY] || 0) + containerEnergy + linkEnergy;
};

const getAidBuildStoredEnergy = (room: Room) => {
    return (room.storage?.store[RESOURCE_ENERGY] || 0) + (room.terminal?.store[RESOURCE_ENERGY] || 0);
};

const getAidBuildUpgradeReserve = (room: Room) => {
    const level = room.controller?.level || room.level || 0;
    if (level >= 7) return 60000;
    if (level >= 6) return 40000;
    if (level >= 5) return 20000;
    return 10000;
};

const shouldAidBuildNormalUpgrade = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my || controller.level >= 8) return false;
    if (controller.level < 4) return true;

    const state = getAidBuildEnergyState(room);
    if (state === 'CRITICAL' || state === 'LOW') return false;

    const reserve = getAidBuildUpgradeReserve(room);
    const storedEnergy = getAidBuildStoredEnergy(room);
    if (storedEnergy >= reserve) return true;

    if (!room.storage) return false;

    return state === 'SURPLUS' && getAidBuildTotalEnergy(room) >= reserve;
};

const canAidBuildUpgrade = (room: Room) => {
    if (shouldForceAidBuildDowngradeUpgrade(room)) return true;
    return shouldAidBuildNormalUpgrade(room);
};
// ==============================
//  Stage 站位与目标辅助
// ==============================

const getAidBuildStageStoreTarget = (creep: Creep) => {
    if (creep.room.storage?.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return creep.room.storage;
    if (creep.room.terminal?.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return creep.room.terminal;
    const containers = [...(creep.room.container || [])]
        .filter((container) => container.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    if (containers.length <= 0) return null;
    return creep.pos.findClosestByRange(containers) as StructureContainer | null;
};

const getAidBuildPosKey = (pos: RoomPosition) => `${pos.x}/${pos.y}/${pos.roomName}`;

const parseAidBuildPosKey = (key?: string): RoomPosition | null => {
    if (!key) return null;
    const [xRaw, yRaw, roomName] = key.split('/');
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !roomName) return null;
    return new RoomPosition(x, y, roomName);
};

const isBlockingAidBuildWaitPos = (pos: RoomPosition): boolean => {
    const structures = pos.lookFor(LOOK_STRUCTURES);
    if (structures.some((s) => !AID_BUILD_WAITABLE_STRUCTURES.has(s.structureType))) return true;

    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    if (sites.some((s) => !AID_BUILD_WAITABLE_STRUCTURES.has(s.structureType))) return true;

    return false;
};

const getAidBuildSpreadCandidates = (
    room: Room,
    anchorPos: RoomPosition,
    ranges: number[],
    avoidPos?: RoomPosition
): RoomPosition[] => {
    const terrain = room.getTerrain();
    const positions: RoomPosition[] = [];

    for (const range of ranges) {
        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== range) continue;
                const x = anchorPos.x + dx;
                const y = anchorPos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                if (avoidPos && avoidPos.roomName === room.name && avoidPos.x === x && avoidPos.y === y) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                const pos = new RoomPosition(x, y, room.name);
                if (isBlockingAidBuildWaitPos(pos)) continue;
                positions.push(pos);
            }
        }
    }

    return positions;
};

const getAidBuildAssignedTargetPos = (
    creep: Creep,
    anchorPos: RoomPosition,
    ranges: number[],
    avoidPos?: RoomPosition
): RoomPosition | null => {
    const candidates = getAidBuildSpreadCandidates(creep.room, anchorPos, ranges, avoidPos);
    if (candidates.length <= 0) return null;

    const queueMembers = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) =>
            c.memory.role === creep.memory.role &&
            c.memory.jumpMode === creep.memory.jumpMode &&
            c.memory.targetRoom === creep.memory.targetRoom &&
            c.memory.spawnFlag === creep.memory.spawnFlag
    });
    const slotIndex = getAidBuildWaitSlotIndex(queueMembers.map((c) => c.name), creep.name, candidates.length);

    for (let offset = 0; offset < candidates.length; offset++) {
        const candidate = candidates[(slotIndex + offset) % candidates.length];
        const creeps = candidate.lookFor(LOOK_CREEPS);
        const powerCreeps = candidate.lookFor(LOOK_POWER_CREEPS);
        const blockedByOther = creeps.some((c) => c.id !== creep.id) || powerCreeps.length > 0;
        if (!blockedByOther || creep.pos.isEqualTo(candidate)) return candidate;
    }

    return candidates[slotIndex] || null;
};

const getAidBuildWaitTargetPos = (
    creep: Creep,
    anchorPos: RoomPosition,
    preferTight: boolean,
    avoidPos?: RoomPosition
) => {
    return getAidBuildAssignedTargetPos(creep, anchorPos, preferTight ? [1, 2] : [2, 1], avoidPos);
};

const getAidBuildUpgradeTargetPos = (creep: Creep, controller: StructureController) => {
    return getAidBuildAssignedTargetPos(creep, controller.pos, [3, 2, 1]);
};

const getStableAidBuildUpgradeTargetPos = (creep: Creep, controller: StructureController): RoomPosition | null => {
    const cached = parseAidBuildPosKey((creep.memory.cache as any)?.upgradePos);
    if (
        cached &&
        cached.roomName === creep.room.name &&
        cached.inRangeTo(controller, 3) &&
        !isBlockingAidBuildWaitPos(cached)
    ) {
        return cached;
    }
    return getAidBuildUpgradeTargetPos(creep, controller);
};
// ==============================
//  核心决策与执行逻辑
// ==============================

// 计算 aid-build 采集速率（用于判断是否接近满仓）
// boost 表缺项时回退到 1，避免异常 boost 数据把产能计算打成 NaN/运行时错误。
export const getAidBuildHarvestIncome = (creep: Creep) => {
    let energy = 0;
    for (const part of creep.body) {
        if (part.type !== WORK) continue;
        if (part.hits === 0) continue;
        if (!part.boost) energy += 2;
        else energy += 2 * (BOOSTS.work[part.boost]?.['harvest'] || 1);
    }
    return energy;
};

// 能量流转层判定：是否允许进入工作阶段
const shouldAidBuildSwitchToWork = (creep: Creep) => {
    if (creep.store.getFreeCapacity() === 0) return true;
    const source = creep.getBoundSource();
    if (!source) return false;
    if (source.energy === 0 && creep.store.getUsedCapacity() > 0) return true;
    const income = getAidBuildHarvestIncome(creep);
    return creep.store.getFreeCapacity() <= income;
};

// 能量流转层判定：是否需要回到采集阶段
const shouldAidBuildSwitchToCollect = (creep: Creep) => {
    return creep.store[RESOURCE_ENERGY] === 0;
};

const canAidBuildReadyToWork = (ctx: AidBuildContext) => {
    // guard 防御：上下文异常时禁止切入工作态
    if (!ctx) return false;
    if (!ctx.creep) return false;
    return !!ctx.readyToWork;
};

const shouldAidBuildNeedEnergy = (ctx: AidBuildContext) => {
    // guard 防御：上下文异常时保守回退到采集态
    if (!ctx) return true;
    if (!ctx.creep) return true;
    return shouldAidBuildSwitchToCollect(ctx.creep);
};

// 跳点/拥挤时的队列避让
const yieldJumpQueue = (creep: Creep, avoidPos?: RoomPosition): boolean => {
    let anchorPos: RoomPosition | null = null;
    let preferTight = false;
    if (avoidPos && avoidPos.roomName === creep.room.name && !avoidPos.isRoomEdge()) {
        anchorPos = avoidPos;
        preferTight = true;
    } else {
        const spawnFlagName = creep.memory.spawnFlag;
        const spawnFlag = spawnFlagName ? Game.flags[spawnFlagName] : null;
        if (spawnFlag?.pos.roomName === creep.room.name && !spawnFlag.pos.isRoomEdge()) {
            anchorPos = spawnFlag.pos;
        } else if (creep.room.controller && !creep.room.controller.pos.isRoomEdge()) {
            anchorPos = creep.room.controller.pos;
        } else {
            anchorPos = new RoomPosition(25, 25, creep.room.name);
        }
    }

    const queuePos = getAidBuildWaitTargetPos(creep, anchorPos, preferTight, avoidPos);
    if (queuePos) {
        if (!creep.pos.isEqualTo(queuePos)) {
            creep.moveTo(queuePos, { range: 0, maxRooms: 1, reusePath: 0 });
        }
        return true;
    }

    creep.moveTo(anchorPos, { range: 2, maxRooms: 1, reusePath: 0 });
    return true;
};

// 在同角色队列中平衡 source 占用
const getBalancedSource = (creep: Creep): Source | null => {
    const activeSources = [...(creep.room.source || creep.room.find(FIND_SOURCES))]
        .filter((s) => s.energy > 0);
    if (activeSources.length <= 0) {
        delete creep.memory.targetSourceId;
        return null;
    }

    const current = creep.getBoundSource();
    const focusFlag = creep.memory.spawnFlag;
    const sameRole = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) =>
            c.id !== creep.id &&
            c.memory.role === creep.memory.role &&
            (!focusFlag || c.memory.spawnFlag === focusFlag)
    });

    const counts: Record<string, number> = {};
    const walkableSlots: Record<string, number> = {};
    for (const s of activeSources) counts[s.id] = 0;
    for (const source of activeSources) {
        walkableSlots[source.id] = Math.max(1, countAidBuildWalkableSourceSlots(creep.room, source));
    }
    for (const c of sameRole) {
        if (!shouldReserveAidBuildSource(c as AidBuildOccupantLike, focusFlag)) continue;
        const sid = c.memory.targetSourceId as Id<Source> | undefined;
        if (!sid || counts[sid] == null) continue;
        counts[sid]++;
    }

    const selectedId = chooseAidBuildSourceId(activeSources.map((source) => ({
        id: source.id,
        assigned: counts[source.id] || 0,
        walkable: walkableSlots[source.id] || 1,
        distance: creep.pos.getRangeTo(source),
        current: !!current && current.id === source.id
    })));
    if (!selectedId) {
        delete creep.memory.targetSourceId;
        return null;
    }

    const pickedSource = activeSources.find((source) => source.id === selectedId);
    if (!pickedSource) {
        delete creep.memory.targetSourceId;
        return null;
    }
    creep.setBoundSourceId(pickedSource.id);
    return pickedSource;
};

// 选择维修目标（命中最低者优先）
const selectAidBuildRepairTarget = (creep: Creep) => {
    const repairTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => s.hits < s.hitsMax * 0.8 &&
            s.structureType != STRUCTURE_ROAD &&
            s.structureType != STRUCTURE_CONTAINER
    });
    if (repairTargets.length <= 0) return null;
    return repairTargets.reduce((a, b) => a.hits < b.hits ? a : b);
};

// 评估当前 tick 应执行的工程任务
export const decideAidBuildJob = (creep: Creep): AidBuildJobState => {
    const controller = creep.room.controller;
    const owned = !!controller?.my;
    const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
    const isJumpMode = !!creep.memory.jumpMode;
    const canUpgrade = canAidBuildUpgrade(creep.room);
    const cache = creep.memory.cache || (creep.memory.cache = {});
    const downgradeUpgradeLocked = !!(cache as any).downgradeUpgradeLatch;

    if (!owned && sites.length === 0) return AID_BUILD_JOB_STATES.STAGE;
    if (creep.store[RESOURCE_ENERGY] === 0) {
        delete (cache as any).downgradeUpgradeLatch;
        return AID_BUILD_JOB_STATES.STAGE;
    }

    if (!owned) return AID_BUILD_JOB_STATES.BUILD;
    if (shouldForceAidBuildDowngradeUpgrade(creep.room)) {
        (cache as any).downgradeUpgradeLatch = true;
        return AID_BUILD_JOB_STATES.UPGRADE;
    }
    if (downgradeUpgradeLocked) return AID_BUILD_JOB_STATES.UPGRADE;

    const hasSpawn = creep.room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_SPAWN
    }).length > 0;
    const hasSpawnSite = creep.room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_SPAWN
    }).length > 0;
    const shouldForceSpawnFirst = isJumpMode && !hasSpawn && hasSpawnSite;

    if (controller?.level && controller.level < 2 && !shouldForceSpawnFirst) {
        return AID_BUILD_JOB_STATES.UPGRADE;
    }

    if (sites.length > 0) return AID_BUILD_JOB_STATES.BUILD;
    if (selectAidBuildRepairTarget(creep)) return AID_BUILD_JOB_STATES.REPAIR;
    if (!canUpgrade) return AID_BUILD_JOB_STATES.STAGE;
    return AID_BUILD_JOB_STATES.UPGRADE;
};

// boost 准备阶段：保持与旧逻辑一致
const prepareAidBuild = (creep: Creep) => {
    if (creep.memory['boostmap']) {
        return creep.goBoost(creep.memory['boostmap']) === OK;
    }
    return creep.goBoost({ [WORK]: ['XLH2O', 'LH2O', 'LH'] }) === OK;
};

// 采集阶段：收集能量并判断是否进入工作阶段
const runAidBuildHarvest = (creep: Creep): boolean => {
    const sourceRoom = creep.memory.sourceRoom || creep.memory.targetRoom;
    const controller = creep.room.controller;
    const isJumpMode = !!creep.memory.jumpMode;

    if (sourceRoom) {
        const { roomName: localRoom, shard } = parseShardRoomName(sourceRoom);
        const arrived = (!shard || shard === Game.shard.name) && creep.room.name === localRoom && !creep.pos.isRoomEdge();
        if (!arrived) {
            creep.moveToRoom(sourceRoom);
            return false;
        }
    }

    if (creep.store.getFreeCapacity() === 0) {
        releaseAidBuildSource(creep);
        return true;
    }

    // 使用 smartCollect 方法收集资源
    // 优先级: 掉落资源 > 墓碑 > 废墟 > 容器 > 存储
    if (creep.smartCollect(RESOURCE_ENERGY, {
        includeDropped: true,
        includeTombstone: true,
        includeRuin: true,
        includeContainer: true,
        includeStorage: true,
        minDroppedAmount: 50,
        minContainerAmount: 0
    })) {
        const freeCapacity = creep.store.getFreeCapacity();
        if (freeCapacity === 0) {
            releaseAidBuildSource(creep);
            return true;
        }
        return false;
    }

    // 如果没有找到资源，尝试从 source 采集
    if (!creep.room.source) {
        if (Game.time % 10 !== 0) return false;
        creep.room.update();
    }

    if (!creep.room.source) return false;

    const targetSource = getBalancedSource(creep);
    if (!targetSource && creep.store[RESOURCE_ENERGY] > 0) {
        releaseAidBuildSource(creep);
        return true;
    }
    if (!targetSource) {
        if (isJumpMode && !controller?.my) yieldJumpQueue(creep);
        return false;
    }

    const result = creep.goHaverst(targetSource);
    if (!result) return false;

    const income = getAidBuildHarvestIncome(creep);
    if (creep.store.getFreeCapacity() > income) return false;

    releaseAidBuildSource(creep);
    return true;
};
// 建造阶段：专注施工，不再直接切换状态
const runAidBuildBuild = (creep: Creep) => {
    releaseAidBuildSource(creep);
    const controller = creep.room.controller;
    const isJumpMode = !!creep.memory.jumpMode;
    const hasSpawn = creep.room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_SPAWN
    }).length > 0;
    const hasSpawnSite = creep.room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_SPAWN
    }).length > 0;
    const shouldForceSpawnFirst = isJumpMode && !hasSpawn && hasSpawnSite;

    if (shouldForceAidBuildDowngradeUpgrade(creep.room)) return;
    if (controller?.my && controller.level < 2 && !shouldForceSpawnFirst) return;
    if (creep.store[RESOURCE_ENERGY] === 0) return;

    if (!moveAidBuildToTargetRoom(creep)) return;

    if (creep.pos.isRoomEdge()) {
        creep.moveTo(creep.room.controller);
        return;
    }

    const earlyRoomPriority = [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER,
        STRUCTURE_CONTAINER,
        STRUCTURE_ROAD,
        STRUCTURE_STORAGE,
        STRUCTURE_TERMINAL
    ];
    const jumpPriority = [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER,
        STRUCTURE_STORAGE,
        STRUCTURE_TERMINAL,
        STRUCTURE_CONTAINER,
        STRUCTURE_ROAD
    ];
    const defaultPriority = [
        STRUCTURE_SPAWN,
        STRUCTURE_STORAGE,
        STRUCTURE_TERMINAL,
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER,
        STRUCTURE_CONTAINER,
        STRUCTURE_ROAD
    ];
    const isEarlyOwnedRoom = !!controller?.my && controller.level <= 4;
    const buildPriority = shouldForceSpawnFirst
        ? jumpPriority
        : (isEarlyOwnedRoom ? earlyRoomPriority : (isJumpMode ? jumpPriority : defaultPriority));

    // 使用 findAndBuild 方法查找并建造
    creep.findAndBuild({
        priority: buildPriority
    });
};

// 维修阶段：优先维修缓存目标，其次扫描房间
const runAidBuildRepair = (creep: Creep) => {
    releaseAidBuildSource(creep);
    const controller = creep.room.controller;
    if (!controller?.my) return;
    if (shouldForceAidBuildDowngradeUpgrade(creep.room)) return;
    if (controller.level < 2) return;
    if (creep.store[RESOURCE_ENERGY] === 0) return;

    if (!moveAidBuildToTargetRoom(creep)) return;

    if (creep.pos.isRoomEdge()) {
        creep.moveTo(creep.room.controller);
        return;
    }

    // 如果有缓存的维修目标，继续维修
    if (creep.memory.cache?.repairTarget) {
        const repairTarget = Game.getObjectById(creep.memory.cache.repairTarget as Id<Structure>);
        if (repairTarget) {
            if (repairTarget.hits === repairTarget.hitsMax) {
                creep.memory.cache.repairTarget = '';
                return;
            }
            creep.goRepair(repairTarget);
            return;
        }
    }

    // 使用 findAndRepair 方法查找并维修
    creep.findAndRepair({
        maxHitsRatio: 0.8
    });
};

// 升级阶段：根据缓存站位保持输出
export const runAidBuildUpgrade = (creep: Creep) => {
    releaseAidBuildSource(creep);
    const cache = creep.memory.cache || (creep.memory.cache = {});
    if (creep.store[RESOURCE_ENERGY] === 0) {
        delete (cache as any).downgradeUpgradeLatch;
        return;
    }

    const controller = creep.room.controller;
    if (!controller?.my) {
        delete (cache as any).downgradeUpgradeLatch;
        return;
    }
    const downgradeUpgradeLocked = !!(cache as any).downgradeUpgradeLatch;
    if (!canAidBuildUpgrade(creep.room) && !downgradeUpgradeLocked) return;

    if (creep.pos.inRangeTo(controller, 3)) {
        (cache as any).upgradePos = getAidBuildPosKey(creep.pos);
        creep.upgradeController(controller);
        return;
    }

    const upgradePos = getStableAidBuildUpgradeTargetPos(creep, controller);
    if (upgradePos) {
        (cache as any).upgradePos = getAidBuildPosKey(upgradePos);
        creep.moveTo(upgradePos, { range: 0, maxRooms: 1, reusePath: 0 });
        return;
    }

    delete (cache as any).upgradePos;
    creep.moveTo(controller, { maxRooms: 1, range: 3 });
};

// stage 阶段：集中等待与能量暂存（不再负责采集）
const runAidBuildStage = (creep: Creep) => {
    if (!moveAidBuildToTargetRoom(creep)) return;

    if (creep.pos.isRoomEdge()) {
        const center = new RoomPosition(25, 25, creep.room.name);
        creep.moveTo(center, { maxRooms: 1 });
        return;
    }

    const controller = creep.room.controller;
    const isJumpMode = !!creep.memory.jumpMode;

    // 能量不足时交给采集层处理，这里只做站位/排队
    if (creep.store[RESOURCE_ENERGY] === 0) {
        if (isJumpMode && !controller?.my) yieldJumpQueue(creep);
        return;
    }

    const storeTarget = getAidBuildStageStoreTarget(creep);
    if (storeTarget) {
        if (creep.pos.inRangeTo(storeTarget, 1)) {
            creep.transfer(storeTarget, RESOURCE_ENERGY);
        } else {
            creep.moveTo(storeTarget, { range: 1, maxRooms: 1 });
        }
        return;
    }

    // 无容器时，允许落地囤积
    creep.drop(RESOURCE_ENERGY);
};
// ==============================
//  多层 FSM 构建
// ==============================

// 能量流转层 FSM
const createAidBuildFlowMachine = (creep: Creep) => {
    const storage = createAidBuildLayerStorage<AidBuildFlowState>(
        creep,
        AID_BUILD_LAYERS.FLOW,
        AID_BUILD_FLOW_STATES.COLLECT
    );
    return new StateMachine<AidBuildContext, AidBuildFlowState, AidBuildFlowEvent, AidBuildFlowGuard>(
        {
            initial: AID_BUILD_FLOW_STATES.COLLECT,
            states: {
                [AID_BUILD_FLOW_STATES.COLLECT]: {
                    onTick: (ctx) => {
                        if (!ctx.creep.memory.ready) return;
                        const ready = runAidBuildHarvest(ctx.creep);
                        ctx.readyToWork = ready || shouldAidBuildSwitchToWork(ctx.creep);
                        if (ctx.readyToWork) {
                            ctx.jobDecision = decideAidBuildJob(ctx.creep);
                            return [AID_BUILD_FLOW_EVENTS.READY_TO_WORK];
                        }
                    }
                },
                [AID_BUILD_FLOW_STATES.WORK]: {
                    onTick: (ctx) => {
                        if (shouldAidBuildSwitchToCollect(ctx.creep)) {
                            ctx.readyToWork = false;
                            return [AID_BUILD_FLOW_EVENTS.NEED_ENERGY];
                        }
                        ctx.readyToWork = true;
                    }
                }
            },
            transitions: [
                {
                    from: AID_BUILD_FLOW_STATES.COLLECT,
                    event: AID_BUILD_FLOW_EVENTS.READY_TO_WORK,
                    to: AID_BUILD_FLOW_STATES.WORK,
                    guard: AID_BUILD_FLOW_GUARDS.READY_TO_WORK
                },
                {
                    from: AID_BUILD_FLOW_STATES.WORK,
                    event: AID_BUILD_FLOW_EVENTS.NEED_ENERGY,
                    to: AID_BUILD_FLOW_STATES.COLLECT,
                    guard: AID_BUILD_FLOW_GUARDS.NEED_ENERGY
                }
            ],
            guards: {
                [AID_BUILD_FLOW_GUARDS.READY_TO_WORK]: canAidBuildReadyToWork,
                [AID_BUILD_FLOW_GUARDS.NEED_ENERGY]: shouldAidBuildNeedEnergy
            }
        },
        storage
    );
};

// 工程任务层 FSM
const createAidBuildJobMachine = (creep: Creep) => {
    const storage = createAidBuildLayerStorage<AidBuildJobState>(
        creep,
        AID_BUILD_LAYERS.JOB,
        AID_BUILD_JOB_STATES.STAGE
    );
    return new StateMachine<AidBuildContext, AidBuildJobState, AidBuildJobEvent, AidBuildJobGuard>(
        {
            initial: AID_BUILD_JOB_STATES.STAGE,
            states: {
                [AID_BUILD_JOB_STATES.BUILD]: {
                    onTick: (ctx) => {
                        if (ctx.jobDecision !== AID_BUILD_JOB_STATES.BUILD) {
                            return [AID_BUILD_JOB_EVENT_BY_STATE[ctx.jobDecision]];
                        }
                        if (!ctx.readyToWork) return;
                        runAidBuildBuild(ctx.creep);
                    }
                },
                [AID_BUILD_JOB_STATES.REPAIR]: {
                    onEnter: (ctx) => {
                        const target = selectAidBuildRepairTarget(ctx.creep);
                        if (target) {
                            if (!ctx.creep.memory.cache) ctx.creep.memory.cache = {};
                            ctx.creep.memory.cache.repairTarget = target.id;
                        }
                    },
                    onTick: (ctx) => {
                        if (ctx.jobDecision !== AID_BUILD_JOB_STATES.REPAIR) {
                            return [AID_BUILD_JOB_EVENT_BY_STATE[ctx.jobDecision]];
                        }
                        if (!ctx.readyToWork) return;
                        runAidBuildRepair(ctx.creep);
                    }
                },
                [AID_BUILD_JOB_STATES.UPGRADE]: {
                    onTick: (ctx) => {
                        if (ctx.jobDecision !== AID_BUILD_JOB_STATES.UPGRADE) {
                            return [AID_BUILD_JOB_EVENT_BY_STATE[ctx.jobDecision]];
                        }
                        if (!ctx.readyToWork) return;
                        runAidBuildUpgrade(ctx.creep);
                    }
                },
                [AID_BUILD_JOB_STATES.STAGE]: {
                    onTick: (ctx) => {
                        if (ctx.jobDecision !== AID_BUILD_JOB_STATES.STAGE) {
                            return [AID_BUILD_JOB_EVENT_BY_STATE[ctx.jobDecision]];
                        }
                        runAidBuildStage(ctx.creep);
                    }
                }
            },
            transitions: [
                {
                    from: AID_BUILD_JOB_STATES.STAGE,
                    event: AID_BUILD_JOB_EVENTS.GO_BUILD,
                    to: AID_BUILD_JOB_STATES.BUILD,
                    guard: AID_BUILD_JOB_GUARDS.CAN_BUILD
                },
                {
                    from: AID_BUILD_JOB_STATES.STAGE,
                    event: AID_BUILD_JOB_EVENTS.GO_REPAIR,
                    to: AID_BUILD_JOB_STATES.REPAIR,
                    guard: AID_BUILD_JOB_GUARDS.CAN_REPAIR
                },
                {
                    from: AID_BUILD_JOB_STATES.STAGE,
                    event: AID_BUILD_JOB_EVENTS.GO_UPGRADE,
                    to: AID_BUILD_JOB_STATES.UPGRADE,
                    guard: AID_BUILD_JOB_GUARDS.CAN_UPGRADE
                },
                {
                    from: AID_BUILD_JOB_STATES.BUILD,
                    event: AID_BUILD_JOB_EVENTS.GO_STAGE,
                    to: AID_BUILD_JOB_STATES.STAGE,
                    guard: AID_BUILD_JOB_GUARDS.NEED_STAGE
                },
                {
                    from: AID_BUILD_JOB_STATES.REPAIR,
                    event: AID_BUILD_JOB_EVENTS.GO_STAGE,
                    to: AID_BUILD_JOB_STATES.STAGE,
                    guard: AID_BUILD_JOB_GUARDS.NEED_STAGE
                },
                {
                    from: AID_BUILD_JOB_STATES.UPGRADE,
                    event: AID_BUILD_JOB_EVENTS.GO_STAGE,
                    to: AID_BUILD_JOB_STATES.STAGE,
                    guard: AID_BUILD_JOB_GUARDS.NEED_STAGE
                },
                {
                    from: AID_BUILD_JOB_STATES.BUILD,
                    event: AID_BUILD_JOB_EVENTS.GO_REPAIR,
                    to: AID_BUILD_JOB_STATES.REPAIR,
                    guard: AID_BUILD_JOB_GUARDS.CAN_REPAIR
                },
                {
                    from: AID_BUILD_JOB_STATES.BUILD,
                    event: AID_BUILD_JOB_EVENTS.GO_UPGRADE,
                    to: AID_BUILD_JOB_STATES.UPGRADE,
                    guard: AID_BUILD_JOB_GUARDS.CAN_UPGRADE
                },
                {
                    from: AID_BUILD_JOB_STATES.REPAIR,
                    event: AID_BUILD_JOB_EVENTS.GO_BUILD,
                    to: AID_BUILD_JOB_STATES.BUILD,
                    guard: AID_BUILD_JOB_GUARDS.CAN_BUILD
                },
                {
                    from: AID_BUILD_JOB_STATES.REPAIR,
                    event: AID_BUILD_JOB_EVENTS.GO_UPGRADE,
                    to: AID_BUILD_JOB_STATES.UPGRADE,
                    guard: AID_BUILD_JOB_GUARDS.CAN_UPGRADE
                },
                {
                    from: AID_BUILD_JOB_STATES.UPGRADE,
                    event: AID_BUILD_JOB_EVENTS.GO_BUILD,
                    to: AID_BUILD_JOB_STATES.BUILD,
                    guard: AID_BUILD_JOB_GUARDS.CAN_BUILD
                },
                {
                    from: AID_BUILD_JOB_STATES.UPGRADE,
                    event: AID_BUILD_JOB_EVENTS.GO_REPAIR,
                    to: AID_BUILD_JOB_STATES.REPAIR,
                    guard: AID_BUILD_JOB_GUARDS.CAN_REPAIR
                }
            ],
            guards: {
                [AID_BUILD_JOB_GUARDS.CAN_BUILD]: (ctx) => ctx.jobDecision === AID_BUILD_JOB_STATES.BUILD,
                [AID_BUILD_JOB_GUARDS.CAN_REPAIR]: (ctx) => ctx.jobDecision === AID_BUILD_JOB_STATES.REPAIR,
                [AID_BUILD_JOB_GUARDS.CAN_UPGRADE]: (ctx) => ctx.jobDecision === AID_BUILD_JOB_STATES.UPGRADE,
                [AID_BUILD_JOB_GUARDS.NEED_STAGE]: (ctx) => ctx.jobDecision === AID_BUILD_JOB_STATES.STAGE
            }
        },
        storage
    );
};

// ==============================
//  外部入口（run）
// ==============================

const aid_build = {
    run: function (creep: Creep) {
        if (!ensureAidBuildMemory(creep)) return;

        // 准备阶段：先完成 boost
        if (!creep.memory.ready) {
            creep.memory.ready = prepareAidBuild(creep);
            return;
        }

        const ctx: AidBuildContext = {
            creep,
            readyToWork: shouldAidBuildSwitchToWork(creep),
            jobDecision: decideAidBuildJob(creep)
        };

        const flowMachine = createAidBuildFlowMachine(creep);
        const jobMachine = createAidBuildJobMachine(creep);
        const runner = createLayeredRunner<AidBuildContext>({
            [AID_BUILD_LAYERS.FLOW]: flowMachine,
            [AID_BUILD_LAYERS.JOB]: jobMachine
        });

        // reenter: 状态切换后允许本 tick 继续执行新状态逻辑
        runner.step(ctx, {
            [AID_BUILD_LAYERS.FLOW]: { reenter: true },
            [AID_BUILD_LAYERS.JOB]: { reenter: true }
        });
    }
};

export default aid_build;
