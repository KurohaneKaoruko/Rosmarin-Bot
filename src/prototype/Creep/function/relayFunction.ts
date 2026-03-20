import { getCreepSourceRoom } from '@/modules/utils/creepMemory';
import { CREEP_TICK_ACTION, hasCreepTickAction, markCreepTickAction } from './tickActionFunction';

const OUT_CARRY_RELAY_EMPTY_RATIO = 0.2;
const OUT_CARRY_RELAY_ROLES = new Set(['out-carry', 'out-car']);

type CarryCache = {
    outCarryMode?: string;
    lastStepDirection?: DirectionConstant;
    lastPosTick?: number;
    lastPosX?: number;
    lastPosY?: number;
    lastPosRoomName?: string;
};

type CarrySourceCache = {
    targetId?: string;
    targetType?: string;
    waitUntil?: number;
    partialLeaveWait?: number;
};

type CarryTargetCache = {
    targetId?: string;
};

type RelayCandidate = {
    creep: Creep;
    direction: DirectionConstant;
};

/**
 * 确保并返回外矿搬运的通用缓存分区。
 *
 * @param creep 目标 creep。
 * @returns 可读写的搬运缓存对象。
 */
const ensureCarryCache = (creep: Creep): CarryCache => {
    creep.memory.cache = creep.memory.cache || {};
    return creep.memory.cache as CarryCache;
};

/**
 * 确保并返回外矿搬运「取货态」缓存分区。
 *
 * @param creep 目标 creep。
 * @returns 可读写的 source 缓存对象。
 */
const ensureCarrySourceCache = (creep: Creep): CarrySourceCache => {
    creep.memory.cacheSource = creep.memory.cacheSource || {};
    return creep.memory.cacheSource as CarrySourceCache;
};

/**
 * 确保并返回外矿搬运「送货态」缓存分区。
 *
 * @param creep 目标 creep。
 * @returns 可读写的 target 缓存对象。
 */
const ensureCarryTargetCache = (creep: Creep): CarryTargetCache => {
    creep.memory.cacheTarget = creep.memory.cacheTarget || {};
    return creep.memory.cacheTarget as CarryTargetCache;
};

/**
 * 判断 creep 本 tick 是否已经参与过接力动作。
 *
 * @param creep 目标 creep。
 * @returns `true` 表示本 tick 已经接力给出或接收过能量。
 */
const hasRelayActionThisTick = (creep: Creep): boolean => {
    return hasCreepTickAction(creep, CREEP_TICK_ACTION.RELAY_GIVE) ||
        hasCreepTickAction(creep, CREEP_TICK_ACTION.RELAY_RECEIVE);
};

/**
 * 计算某个移动方向的反向方向。
 *
 * @param direction 当前方向常量。
 * @returns 与当前方向相反的方向常量。
 */
const getOppositeDirection = (direction: DirectionConstant): DirectionConstant => {
    const oppositeMap: Record<DirectionConstant, DirectionConstant> = {
        [TOP]: BOTTOM,
        [TOP_RIGHT]: BOTTOM_LEFT,
        [RIGHT]: LEFT,
        [BOTTOM_RIGHT]: TOP_LEFT,
        [BOTTOM]: TOP,
        [BOTTOM_LEFT]: TOP_RIGHT,
        [LEFT]: RIGHT,
        [TOP_LEFT]: BOTTOM_RIGHT
    };
    return oppositeMap[direction];
};

/**
 * 计算相邻两个坐标之间的方向常量。
 *
 * @param from 起点坐标。
 * @param to 终点坐标。
 * @returns 若两点相邻则返回方向，否则返回 `null`。
 */
const getAdjacentDirection = (from: RoomPosition, to: RoomPosition): DirectionConstant | null => {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    if (Math.abs(to.x - from.x) > 1 || Math.abs(to.y - from.y) > 1) return null;
    if (dx === 0 && dy === 0) return null;

    if (dx === 0 && dy === -1) return TOP;
    if (dx === 1 && dy === -1) return TOP_RIGHT;
    if (dx === 1 && dy === 0) return RIGHT;
    if (dx === 1 && dy === 1) return BOTTOM_RIGHT;
    if (dx === 0 && dy === 1) return BOTTOM;
    if (dx === -1 && dy === 1) return BOTTOM_LEFT;
    if (dx === -1 && dy === 0) return LEFT;
    return TOP_LEFT;
};

/**
 * 更新外矿搬运 creep 最近一步的实际移动方向。
 *
 * @remarks
 * 接力方向判断基于 creep 真实行进方向。这里记录 creep 上一 tick 的位置与方向，
 * 下一 tick 用于判定是否是迎面来车。
 *
 * @param creep 当前外矿搬运 creep。
 */
export const updateOutCarryMoveTrace = (creep: Creep) => {
    const cache = ensureCarryCache(creep);
    const lastTick = Number(cache.lastPosTick || 0);

    if (
        lastTick === Game.time - 1 &&
        cache.lastPosRoomName === creep.room.name &&
        typeof cache.lastPosX === 'number' &&
        typeof cache.lastPosY === 'number'
    ) {
        const previousPos = new RoomPosition(cache.lastPosX, cache.lastPosY, creep.room.name);
        const direction = getAdjacentDirection(previousPos, creep.pos);
        if (direction) cache.lastStepDirection = direction;
        else delete cache.lastStepDirection;
    } else {
        delete cache.lastStepDirection;
    }

    cache.lastPosX = creep.pos.x;
    cache.lastPosY = creep.pos.y;
    cache.lastPosRoomName = creep.room.name;
    cache.lastPosTick = Game.time;
};

/**
 * 解析接力方向：
 * - 常规路径：双方都有移动方向，且满足严格对穿关系；
 * - 兜底路径：当前返程方缺失方向时，依据来车方向反推。
 *
 * @param selfPos 当前 creep 位置。
 * @param selfMoveDirection 当前 creep 上 tick 的移动方向。
 * @param otherPos 候选 creep 位置。
 * @param otherMoveDirection 候选 creep 上 tick 的移动方向。
 * @returns 成功时返回接力方向，否则返回 `null`。
 */
const resolveRelayDirection = (
    selfPos: RoomPosition,
    selfMoveDirection: DirectionConstant | 0,
    otherPos: RoomPosition,
    otherMoveDirection: DirectionConstant | 0
): DirectionConstant | null => {
    const adjacentDirection = getAdjacentDirection(selfPos, otherPos);
    if (!adjacentDirection) return null;

    // 返程方有方向时严格校验双向对穿。
    if (selfMoveDirection) {
        if (!otherMoveDirection) return null;
        if (adjacentDirection !== selfMoveDirection) return null;
        if (otherMoveDirection !== getOppositeDirection(selfMoveDirection)) return null;
        return selfMoveDirection;
    }

    // 返程方方向缺失时，允许按来车方向反推，但仍要求对方正在朝当前 creep 移动。
    if (!otherMoveDirection) return null;
    if (otherMoveDirection !== getOppositeDirection(adjacentDirection)) return null;
    return adjacentDirection;
};

/**
 * 从邻近 creep 中挑选可执行接力的候选对象。
 *
 * @param creep 当前返程 creep。
 * @param sourceRoom 外矿来源房间。
 * @param resourceType 计划接力的资源类型。
 * @param amount 计划接力的资源数量。
 * @param isLikelyCollecting 用于判断候选 creep 是否处于取货态。
 * @returns 可接力对象与方向；没有则返回 `null`。
 */
const pickRelayCandidate = (
    creep: Creep,
    sourceRoom: string,
    resourceType: ResourceConstant,
    amount: number,
    isLikelyCollecting: (creep: Creep) => boolean
): RelayCandidate | null => {
    const selfMoveDirection = (ensureCarryCache(creep).lastStepDirection || 0) as DirectionConstant | 0;
    const candidates = creep.room.find(FIND_MY_CREEPS, {
        filter: (other: Creep) => {
            if (!other || other.id === creep.id || other.spawning) return false;
            if (hasRelayActionThisTick(other)) return false;
            if (!OUT_CARRY_RELAY_ROLES.has(other.memory.role)) return false;
            if (getCreepSourceRoom(other.memory) !== sourceRoom) return false;
            if (other.memory.targetRoom !== creep.memory.targetRoom) return false;
            if (!creep.pos.isNearTo(other)) return false;
            if (other.store.getFreeCapacity(resourceType) < amount) return false;
            const otherCap = Math.max(1, other.store.getCapacity());
            const otherUsed = other.store.getUsedCapacity();
            if (otherUsed > Math.floor(otherCap * OUT_CARRY_RELAY_EMPTY_RATIO)) return false;
            if (!isLikelyCollecting(other)) return false;
            return true;
        }
    });

    for (const other of candidates) {
        const otherMoveDirection = (ensureCarryCache(other).lastStepDirection || 0) as DirectionConstant | 0;
        const direction = resolveRelayDirection(creep.pos, selfMoveDirection, other.pos, otherMoveDirection);
        if (!direction) continue;
        return { creep: other, direction };
    }

    return null;
};

/**
 * 接力成功后同步切换双方内存状态：
 * - 给出方切回 collect；
 * - 接收方切到 deliver；
 * - 清理双方与旧状态相关的缓存目标。
 *
 * @param from 给出方 creep。
 * @param to 接收方 creep。
 * @param collectMode 给出方要切换到的模式标识。
 * @param deliverMode 接收方要切换到的模式标识。
 */
const applyRelayMemorySwitch = (
    from: Creep,
    to: Creep,
    collectMode: string,
    deliverMode: string
) => {
    const fromCache = ensureCarryCache(from);
    const fromTargetCache = ensureCarryTargetCache(from);
    const toCache = ensureCarryCache(to);
    const toSourceCache = ensureCarrySourceCache(to);

    fromCache.outCarryMode = collectMode;
    delete fromTargetCache.targetId;

    toCache.outCarryMode = deliverMode;
    delete toSourceCache.targetId;
    delete toSourceCache.targetType;
    delete toSourceCache.waitUntil;
    delete toSourceCache.partialLeaveWait;
};

/**
 * 在返程过程中尝试将当前资源整包接力给迎面空仓搬运 creep。
 *
 * @param creep 当前处于返程态的搬运 creep。
 * @param isLikelyCollecting 用于判断候选目标是否仍处于“来取货”态。
 * @param collectMode 接力后当前 creep 要切入的 collect 模式标识。
 * @param deliverMode 接力后目标 creep 要切入的 deliver 模式标识。
 * @returns `true` 表示本 tick 已完成接力和对穿移动。
 */
export const tryOutCarryRelayHandoff = (
    creep: Creep,
    isLikelyCollecting: (creep: Creep) => boolean,
    collectMode: string,
    deliverMode: string
): boolean => {
    if (hasRelayActionThisTick(creep)) return false;

    const sourceRoom = getCreepSourceRoom(creep.memory);
    if (!sourceRoom) return false;
    if (creep.pos.isRoomEdge()) return false;

    const resourceType = Object.keys(creep.store).find((resource) => creep.store[resource as ResourceConstant] > 0) as ResourceConstant | undefined;
    if (!resourceType) return false;

    const amount = creep.store[resourceType] || 0;
    if (amount <= 0) return false;

    const relay = pickRelayCandidate(creep, sourceRoom, resourceType, amount, isLikelyCollecting);
    if (!relay) return false;

    if (creep.transfer(relay.creep, resourceType) !== OK) return false;

    applyRelayMemorySwitch(creep, relay.creep, collectMode, deliverMode);
    creep.memory.dontPullMe = false;
    relay.creep.memory.dontPullMe = false;

    markCreepTickAction(creep, CREEP_TICK_ACTION.RELAY_GIVE);
    markCreepTickAction(relay.creep, CREEP_TICK_ACTION.RELAY_RECEIVE);

    creep.move(getOppositeDirection(relay.direction));
    relay.creep.move(relay.direction);
    return true;
};
