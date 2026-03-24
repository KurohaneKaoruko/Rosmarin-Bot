import { CREEP_TICK_ACTION, hasCreepTickAction, markCreepTickAction } from './tickActionFunction';
import { ensureMemoryCache } from './cacheFunction';

const OUT_CARRY_RELAY_EMPTY_RATIO = 0.2;
// 接力后是否值得“立刻返程”，统一按 out-carry 的半仓滞回判断。
const OUT_CARRY_RELAY_RETURN_RATIO = 0.5;
const OUT_CARRY_RELAY_MIN_TTL = 50;
const OUT_CARRY_RELAY_ROLES = new Set(['out-carry', 'out-car']);

type CarryCache = {
    outCarryMode?: string;
    lastStepDirection?: DirectionConstant;
    lastPosTick?: number;
    lastPosX?: number;
    lastPosY?: number;
    lastPosRoomName?: string;
    backtrackTick?: number;
    backtrackX?: number;
    backtrackY?: number;
    backtrackRoomName?: string;
    moveOriginTick?: number;
    moveOriginX?: number;
    moveOriginY?: number;
    moveOriginRoomName?: string;
};

type RelayIntentPos = {
    tick: number;
    x: number;
    y: number;
    roomName: string;
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
    resourceType: ResourceConstant;
    score: number;
    transferAmount: number;
    fullHandoff: boolean;
    supplierTurnsBack: boolean;
    selfForwardDirection: DirectionConstant | 0;
    selfFallbackDirection: DirectionConstant;
    otherFallbackDirection: DirectionConstant;
};

type RelayMemoryBlock = Record<string, any>;

type RelayIntentCreep = Creep & {
    __outCarryRelayIntentPos?: RelayIntentPos;
    __outCarryRelayReexecTick?: number;
};

/**
 * 确保并返回外矿搬运的通用缓存分区。
 *
 * @param creep 目标 creep。
 * @returns 可读写的搬运缓存对象。
 */
const ensureCarryCache = (creep: Creep): CarryCache => {
    return ensureMemoryCache(creep.memory) as CarryCache;
};

const ensureCarrySectionCache = <T extends Record<string, any>>(creep: Creep, key: 'source' | 'target'): T => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    return (cache[key] && typeof cache[key] === 'object' ? cache[key] : (cache[key] = {})) as T;
};

/**
 * 确保并返回外矿搬运「取货态」缓存分区。
 *
 * @param creep 目标 creep。
 * @returns 可读写的 source 缓存对象。
 */
const ensureCarrySourceCache = (creep: Creep): CarrySourceCache => {
    return ensureCarrySectionCache<CarrySourceCache>(creep, 'source');
};

/**
 * 确保并返回外矿搬运「送货态」缓存分区。
 *
 * @param creep 目标 creep。
 * @returns 可读写的 target 缓存对象。
 */
const ensureCarryTargetCache = (creep: Creep): CarryTargetCache => {
    return ensureCarrySectionCache<CarryTargetCache>(creep, 'target');
};

const cloneRelayMemoryBlock = (block: RelayMemoryBlock | undefined): RelayMemoryBlock | undefined => {
    if (!block) return undefined;
    return { ...block };
};

const replaceRelayMemoryBlock = (
    creep: Creep,
    key: 'source' | 'target' | '_moveToRoomState',
    block: RelayMemoryBlock | undefined,
) => {
    if (block && Object.keys(block).length > 0) {
        if (key === '_moveToRoomState') {
            creep.memory._moveToRoomState = block;
            return;
        }
        ensureMemoryCache(creep.memory)[key] = block;
        return;
    }

    if (key === '_moveToRoomState') {
        delete creep.memory._moveToRoomState;
        return;
    }

    delete ensureMemoryCache(creep.memory)[key];
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
 * 在 8 方向常量上做环形旋转。
 *
 * @param direction 基准方向。
 * @param offset 顺时针为正、逆时针为负。
 * @returns 旋转后的方向常量。
 */
const rotateDirection = (direction: DirectionConstant, offset: number): DirectionConstant => {
    const normalized = ((direction - 1 + offset) % 8 + 8) % 8;
    return (normalized + 1) as DirectionConstant;
};

/**
 * 返回某个前进方向对应的“前方三格”方向集合。
 *
 * @param direction 当前前进方向。
 * @returns 左前 / 正前 / 右前三个方向。
 */
const getForwardArcDirections = (direction: DirectionConstant): DirectionConstant[] => {
    return [rotateDirection(direction, -1), direction, rotateDirection(direction, 1)];
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

const isSameRoomPosition = (left: RoomPosition, right: RoomPosition): boolean => (
    left.x === right.x &&
    left.y === right.y &&
    left.roomName === right.roomName
);

const getDirectionToward = (from: RoomPosition, to: RoomPosition): DirectionConstant | null => {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
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

const getAdjacentPosByDirection = (from: RoomPosition, direction: DirectionConstant): RoomPosition | null => {
    const offsetMap: Record<DirectionConstant, [number, number]> = {
        [TOP]: [0, -1],
        [TOP_RIGHT]: [1, -1],
        [RIGHT]: [1, 0],
        [BOTTOM_RIGHT]: [1, 1],
        [BOTTOM]: [0, 1],
        [BOTTOM_LEFT]: [-1, 1],
        [LEFT]: [-1, 0],
        [TOP_LEFT]: [-1, -1]
    };

    const [dx, dy] = offsetMap[direction];
    const x = from.x + dx;
    const y = from.y + dy;
    if (x < 0 || x > 49 || y < 0 || y > 49) return null;
    return new RoomPosition(x, y, from.roomName);
};

const getRelayReturnThreshold = (capacity: number): number => {
    return Math.ceil(Math.max(1, capacity) * OUT_CARRY_RELAY_RETURN_RATIO);
};

const getRelayIntentHolder = (creep: Creep): RelayIntentCreep => creep as RelayIntentCreep;

const requestRelayReexec = (creep: Creep) => {
    getRelayIntentHolder(creep).__outCarryRelayReexecTick = Game.time;
};

export const clearOutCarryRelayIntent = (creep: Creep) => {
    delete getRelayIntentHolder(creep).__outCarryRelayIntentPos;
};

export const rememberOutCarryRelayIntentPos = (creep: Creep, pos: RoomPosition | null) => {
    if (!pos) {
        clearOutCarryRelayIntent(creep);
        return;
    }

    getRelayIntentHolder(creep).__outCarryRelayIntentPos = {
        tick: Game.time,
        x: pos.x,
        y: pos.y,
        roomName: pos.roomName
    };
};

export const rememberOutCarryRelayIntentDirection = (creep: Creep, direction: DirectionConstant | 0) => {
    if (!direction) {
        clearOutCarryRelayIntent(creep);
        return;
    }

    rememberOutCarryRelayIntentPos(creep, getAdjacentPosByDirection(creep.pos, direction));
};

export const rememberOutCarryRelayIntentTowards = (creep: Creep, target: RoomPosition | { pos: RoomPosition } | null | undefined) => {
    if (!target) {
        clearOutCarryRelayIntent(creep);
        return;
    }

    const targetPos = 'pos' in target ? target.pos : target;
    if (targetPos.roomName !== creep.room.name) {
        clearOutCarryRelayIntent(creep);
        return;
    }

    const direction = getDirectionToward(creep.pos, targetPos);
    rememberOutCarryRelayIntentDirection(creep, direction || 0);
};

const getOutCarryRelayIntentPos = (creep: Creep): RoomPosition | null => {
    const intent = getRelayIntentHolder(creep).__outCarryRelayIntentPos;
    if (!intent || intent.tick !== Game.time) return null;
    return new RoomPosition(intent.x, intent.y, intent.roomName);
};

const canUseRelayAsSupplier = (creep: Creep): boolean => {
    return typeof creep.ticksToLive !== 'number' || creep.ticksToLive > OUT_CARRY_RELAY_MIN_TTL;
};

const getFirstStoredResource = (creep: Creep): ResourceConstant | null => {
    return Object.keys(creep.store).find((resource) => creep.store[resource as ResourceConstant] > 0) as ResourceConstant | null;
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
        if (direction) {
            cache.lastStepDirection = direction;
            cache.backtrackX = previousPos.x;
            cache.backtrackY = previousPos.y;
            cache.backtrackRoomName = previousPos.roomName;
            cache.backtrackTick = Game.time;
        } else {
            delete cache.lastStepDirection;
            delete cache.backtrackTick;
            delete cache.backtrackX;
            delete cache.backtrackY;
            delete cache.backtrackRoomName;
        }
    } else {
        delete cache.lastStepDirection;
        delete cache.backtrackTick;
        delete cache.backtrackX;
        delete cache.backtrackY;
        delete cache.backtrackRoomName;
    }

    cache.lastPosX = creep.pos.x;
    cache.lastPosY = creep.pos.y;
    cache.lastPosRoomName = creep.room.name;
    cache.lastPosTick = Game.time;
};

/**
 * 解析接力候选是否位于返程方“前方三格”，并给出双方接力后的回头方向兜底值。
 *
 * @remarks
 * - 常规路径：返程方存在移动方向时，允许正前 / 左前 / 右前三格；
 * - 兜底路径：返程方缺失方向时，仍要求对方上一 tick 正在朝当前 creep 靠近；
 * - 接力后的第一步优先走各自记录的来路，下面返回的方向只作为 trace 缺失时的保底。
 *
 * @param selfPos 当前 creep 位置。
 * @param selfMoveDirection 当前 creep 上 tick 的移动方向。
 * @param otherPos 候选 creep 位置。
 * @param otherMoveDirection 候选 creep 上 tick 的移动方向。
 * @returns 成功时返回双方回头兜底方向与评分，否则返回 `null`。
 */
const resolveRelayCandidate = (
    selfPos: RoomPosition,
    selfMoveDirection: DirectionConstant | 0,
    otherPos: RoomPosition,
    otherMoveDirection: DirectionConstant | 0,
    otherIntentPos: RoomPosition | null
): { score: number; selfFallbackDirection: DirectionConstant; otherFallbackDirection: DirectionConstant } | null => {
    const adjacentDirection = getAdjacentDirection(selfPos, otherPos);
    if (!adjacentDirection) return null;
    const otherIntentDirection = otherIntentPos ? getAdjacentDirection(otherPos, otherIntentPos) : null;
    const otherTargetsSelf = !!otherIntentPos && isSameRoomPosition(otherIntentPos, selfPos);

    // 返程方有方向时，放宽成“前方三格”都可接力。
    if (selfMoveDirection) {
        const forwardArc = getForwardArcDirections(selfMoveDirection);
        if (!forwardArc.includes(adjacentDirection) && !otherTargetsSelf) return null;
        const score = adjacentDirection === selfMoveDirection ? 2 : 1;
        return {
            score,
            selfFallbackDirection: getOppositeDirection(selfMoveDirection),
            otherFallbackDirection: otherMoveDirection
                ? getOppositeDirection(otherMoveDirection)
                : (otherIntentDirection ? getOppositeDirection(otherIntentDirection) : selfMoveDirection)
        };
    }

    // 返程方方向缺失时，允许按来车方向反推，但仍要求对方正在朝当前 creep 移动。
    if (otherMoveDirection === getOppositeDirection(adjacentDirection)) {
        return {
            score: 0,
            selfFallbackDirection: getOppositeDirection(adjacentDirection),
            otherFallbackDirection: getOppositeDirection(otherMoveDirection)
        };
    }

    if (!otherTargetsSelf || !otherIntentDirection) return null;
    return {
        score: 0,
        selfFallbackDirection: getOppositeDirection(adjacentDirection),
        otherFallbackDirection: getOppositeDirection(otherIntentDirection)
    };
};

/**
 * 让 creep 优先沿“上一 tick 的实际来路”回头。
 *
 * @param creep 目标 creep。
 * @param fallbackDirection 当 trace 丢失时使用的保底方向。
 * @returns `true` 表示本 tick 已下发移动意图。
 */
const moveBackAlongTrace = (creep: Creep, fallbackDirection: DirectionConstant): boolean => {
    const cache = ensureCarryCache(creep);
    if (
        cache.backtrackTick === Game.time &&
        cache.backtrackRoomName === creep.room.name &&
        typeof cache.backtrackX === 'number' &&
        typeof cache.backtrackY === 'number'
    ) {
        const backtrackPos = new RoomPosition(cache.backtrackX, cache.backtrackY, creep.room.name);
        const backtrackDirection = getAdjacentDirection(creep.pos, backtrackPos);
        if (backtrackDirection) {
            rememberOutCarryRelayIntentDirection(creep, backtrackDirection);
            creep.move(backtrackDirection);
            return true;
        }
    }

    if (
        cache.moveOriginTick === Game.time - 1 &&
        cache.moveOriginRoomName === creep.room.name &&
        typeof cache.moveOriginX === 'number' &&
        typeof cache.moveOriginY === 'number'
    ) {
        const moveOriginPos = new RoomPosition(cache.moveOriginX, cache.moveOriginY, creep.room.name);
        const originDirection = getDirectionToward(creep.pos, moveOriginPos);
        if (originDirection) {
            rememberOutCarryRelayIntentDirection(creep, originDirection);
            creep.move(originDirection);
            return true;
        }
    }

    rememberOutCarryRelayIntentDirection(creep, fallbackDirection);
    creep.move(fallbackDirection);
    return true;
};

/**
 * 让 creep 沿当前已知前进方向继续前进。
 *
 * @remarks
 * 仅用于“部分接力”场景：
 * - 接收方吃满后掉头返程；
 * - 给出方仍有剩余能量，不应再与接收方对穿，而应继续沿原返程方向前进。
 *
 * @param creep 目标 creep。
 * @param direction 当前已知的前进方向。
 * @returns `true` 表示本 tick 已下发移动意图。
 */
const moveForwardWithDirection = (creep: Creep, direction: DirectionConstant | 0): boolean => {
    if (direction) {
        rememberOutCarryRelayIntentDirection(creep, direction);
        creep.move(direction);
        return true;
    }
    return false;
};

const moveTowardRouteRoom = (creep: Creep, roomName: string | undefined): boolean => {
    if (!roomName || creep.room.name === roomName || creep.pos.isRoomEdge()) return false;

    const route = Game.map.findRoute(creep.room.name, roomName);
    if (!Array.isArray(route) || route.length <= 0) return false;

    const exitDirection = route[0].exit as DirectionConstant;
    const exits = creep.room.find(route[0].exit) as RoomPosition[];
    const exitPos = Array.isArray(exits) ? creep.pos.findClosestByRange(exits) : null;
    if (exitPos) {
        rememberOutCarryRelayIntentTowards(creep, exitPos);
        creep.moveTo(exitPos, {
            maxRooms: 1,
            range: 0,
            ignoreCreeps: false,
            plainCost: 2,
            swampCost: 10,
            reusePath: 0
        });
        return true;
    }

    rememberOutCarryRelayIntentDirection(creep, exitDirection);
    creep.move(exitDirection);
    return true;
};

const getImmediateHomeDeliverTarget = (creep: Creep): RoomPosition | { pos: RoomPosition } | null => {
    if (creep.room.terminal && creep.room.terminal.store[RESOURCE_ENERGY] < 10000) {
        return creep.room.terminal;
    }

    if (creep.room.terminal && creep.room.terminal.store.getFreeCapacity() > 50000) {
        return creep.room.terminal;
    }

    if (creep.room.storage && creep.room.storage.store.getFreeCapacity() > 10000) {
        return creep.room.storage;
    }

    if (creep.room.storage) return creep.room.storage;
    if (creep.room.controller && creep.room.controller.level < 8) return creep.room.controller;
    return creep.room.getCenter?.() || null;
};

/**
 * 接力成功后立刻给双方补一条“正确方向”的移动指令，
 * 避免后续 `run()` 再去猜测当前应该朝哪边走。
 */
const moveAfterRelayRoleSwitch = (
    creep: Creep,
    mode: string,
    collectMode: string,
    fallbackDirection: DirectionConstant
): boolean => {
    if (mode === collectMode) {
        if (moveTowardRouteRoom(creep, creep.memory.targetRoom)) return true;
        return moveBackAlongTrace(creep, fallbackDirection);
    }

    if (moveTowardRouteRoom(creep, creep.memory.sourceRoom)) return true;

    if (creep.room.name === creep.memory.sourceRoom) {
        const target = getImmediateHomeDeliverTarget(creep);
        if (!target) return false;
        const targetPos = 'pos' in target ? target.pos : target;
        if (creep.pos.inRangeTo(targetPos, 1)) return true;

        rememberOutCarryRelayIntentTowards(creep, target);
        creep.moveTo(target, {
            maxRooms: 1,
            range: 1,
            ignoreCreeps: false,
            plainCost: 2,
            swampCost: 10,
            reusePath: 0
        });
        return true;
    }

    return moveBackAlongTrace(creep, fallbackDirection);
};

const completeRelayHandoff = (
    supplier: Creep,
    receiver: Creep,
    resourceType: ResourceConstant,
    transferAmount: number,
    collectMode: string,
    deliverMode: string,
    fullHandoff: boolean,
    supplierTurnsBack: boolean,
    supplierForwardDirection: DirectionConstant | 0,
    supplierFallbackDirection: DirectionConstant,
    receiverFallbackDirection: DirectionConstant
): boolean => {
    if (supplier.transfer(receiver, resourceType, transferAmount) !== OK) return false;

    const supplierNextMode = supplierTurnsBack ? collectMode : deliverMode;
    applyRelayMemorySwitch(supplier, receiver, collectMode, deliverMode, supplierTurnsBack);
    supplier.memory.dontPullMe = false;
    receiver.memory.dontPullMe = false;

    markCreepTickAction(supplier, CREEP_TICK_ACTION.RELAY_GIVE);
    markCreepTickAction(receiver, CREEP_TICK_ACTION.RELAY_RECEIVE);
    if (!fullHandoff && !supplierTurnsBack) requestRelayReexec(supplier);

    if (!moveAfterRelayRoleSwitch(supplier, supplierNextMode, collectMode, supplierFallbackDirection)) {
        if (supplierTurnsBack) moveBackAlongTrace(supplier, supplierFallbackDirection);
        else moveForwardWithDirection(supplier, supplierForwardDirection);
    }
    if (!fullHandoff && supplierTurnsBack && supplierForwardDirection) {
        moveForwardWithDirection(receiver, supplierForwardDirection);
    } else {
        moveAfterRelayRoleSwitch(receiver, deliverMode, collectMode, receiverFallbackDirection);
    }
    return true;
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
    if (!canUseRelayAsSupplier(creep)) return null;

    const selfMoveDirection = (ensureCarryCache(creep).lastStepDirection || 0) as DirectionConstant | 0;
    const candidates = creep.room.find(FIND_MY_CREEPS, {
        filter: (other: Creep) => {
            if (!other || other.id === creep.id || other.spawning) return false;
            if (hasRelayActionThisTick(other)) return false;
            if (!OUT_CARRY_RELAY_ROLES.has(other.memory.role)) return false;
            if (other.memory.sourceRoom !== sourceRoom) return false;
            if (other.memory.targetRoom !== creep.memory.targetRoom) return false;
            if (!creep.pos.isNearTo(other)) return false;
            const otherCap = Math.max(1, other.store.getCapacity());
            const otherUsed = other.store.getUsedCapacity();
            if (otherUsed > Math.floor(otherCap * OUT_CARRY_RELAY_EMPTY_RATIO)) return false;
            if (!isLikelyCollecting(other)) return false;
            if (other.store.getFreeCapacity(resourceType) <= 0) return false;
            return true;
        }
    });

    let best: RelayCandidate | null = null;
    for (const other of candidates) {
        const otherMoveDirection = (ensureCarryCache(other).lastStepDirection || 0) as DirectionConstant | 0;
        const otherIntentPos = getOutCarryRelayIntentPos(other);
        const resolved = resolveRelayCandidate(creep.pos, selfMoveDirection, other.pos, otherMoveDirection, otherIntentPos);
        if (!resolved) continue;

        const otherCap = Math.max(1, other.store.getCapacity());
        const otherFree = other.store.getFreeCapacity(resourceType);
        const otherUsed = other.store.getUsedCapacity(resourceType);
        const transferAmount = Math.min(amount, Math.max(0, otherFree));
        if (transferAmount <= 0) continue;

        const fullHandoff = transferAmount >= amount;
        const receiverUsedAfter = otherUsed + transferAmount;
        const receiverReadyToReturn = receiverUsedAfter >= getRelayReturnThreshold(otherCap);
        if (!receiverReadyToReturn) continue;

        const selfCap = Math.max(1, creep.store.getCapacity());
        const selfUsedAfter = Math.max(0, creep.store.getUsedCapacity(resourceType) - transferAmount);
        const supplierTurnsBack = fullHandoff || selfUsedAfter <= getRelayReturnThreshold(selfCap);

        // 体型不一致时允许“部分接力”：
        // - 小车被直接喂到接近满载后返程；
        // - 大车继续沿原返程方向送剩余能量；
        // 这样可以避免大小车迎面时只发生对穿而不发生能量交换。
        if (!fullHandoff && !selfMoveDirection) continue;

        const candidate: RelayCandidate = {
            creep: other,
            resourceType,
            score: resolved.score + (fullHandoff ? 10 : 0),
            transferAmount,
            fullHandoff,
            supplierTurnsBack,
            selfForwardDirection: selfMoveDirection,
            selfFallbackDirection: resolved.selfFallbackDirection,
            otherFallbackDirection: resolved.otherFallbackDirection
        };

        if (!best || candidate.score > best.score) {
            best = candidate;
        }
    }

    return best;
};

const pickRelaySupplierCandidate = (
    creep: Creep,
    sourceRoom: string,
    isLikelyCollecting: (creep: Creep) => boolean
): RelayCandidate | null => {
    const receiverIntentPos = getOutCarryRelayIntentPos(creep);
    if (!receiverIntentPos) return null;

    const receiverMoveDirection = (ensureCarryCache(creep).lastStepDirection || 0) as DirectionConstant | 0;
    const candidates = creep.room.find(FIND_MY_CREEPS, {
        filter: (other: Creep) => {
            if (!other || other.id === creep.id || other.spawning) return false;
            if (hasRelayActionThisTick(other)) return false;
            if (!OUT_CARRY_RELAY_ROLES.has(other.memory.role)) return false;
            if (other.memory.sourceRoom !== sourceRoom) return false;
            if (other.memory.targetRoom !== creep.memory.targetRoom) return false;
            if (!creep.pos.isNearTo(other)) return false;
            if (!canUseRelayAsSupplier(other)) return false;
            if (isLikelyCollecting(other)) return false;
            return true;
        }
    });

    let best: RelayCandidate | null = null;
    for (const other of candidates) {
        const resourceType = getFirstStoredResource(other);
        if (!resourceType) continue;
        if (creep.store.getFreeCapacity(resourceType) <= 0) continue;

        const supplierMoveDirection = (ensureCarryCache(other).lastStepDirection || 0) as DirectionConstant | 0;
        const resolved = resolveRelayCandidate(other.pos, supplierMoveDirection, creep.pos, receiverMoveDirection, receiverIntentPos);
        if (!resolved) continue;

        const otherCap = Math.max(1, creep.store.getCapacity());
        const otherFree = creep.store.getFreeCapacity(resourceType);
        const otherUsed = creep.store.getUsedCapacity(resourceType);
        const transferAmount = Math.min(other.store[resourceType] || 0, Math.max(0, otherFree));
        if (transferAmount <= 0) continue;

        const fullHandoff = transferAmount >= (other.store[resourceType] || 0);
        const receiverUsedAfter = otherUsed + transferAmount;
        const receiverReadyToReturn = receiverUsedAfter >= getRelayReturnThreshold(otherCap);
        if (!receiverReadyToReturn) continue;

        const supplierCap = Math.max(1, other.store.getCapacity());
        const supplierUsedAfter = Math.max(0, other.store.getUsedCapacity(resourceType) - transferAmount);
        const supplierTurnsBack = fullHandoff || supplierUsedAfter <= getRelayReturnThreshold(supplierCap);
        if (!fullHandoff && !supplierMoveDirection) continue;

        const candidate: RelayCandidate = {
            creep: other,
            resourceType,
            score: resolved.score + (fullHandoff ? 10 : 0),
            transferAmount,
            fullHandoff,
            supplierTurnsBack,
            selfForwardDirection: supplierMoveDirection,
            selfFallbackDirection: resolved.selfFallbackDirection,
            otherFallbackDirection: resolved.otherFallbackDirection
        };

        if (!best || candidate.score > best.score) {
            best = candidate;
        }
    }

    return best;
};

const tryCollectEnergyAlongRelayIntent = (creep: Creep): boolean => {
    const intentPos = getOutCarryRelayIntentPos(creep);
    if (!intentPos) return false;
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return false;

    const tombstone = creep.room.lookForAt(LOOK_TOMBSTONES, intentPos.x, intentPos.y)[0] as Tombstone | undefined;
    if (tombstone && (tombstone.store[RESOURCE_ENERGY] || 0) > 0) {
        return creep.withdraw(tombstone, RESOURCE_ENERGY) === OK;
    }

    const resource = creep.room.lookForAt(LOOK_RESOURCES, intentPos.x, intentPos.y)[0] as Resource | undefined;
    if (resource && resource.resourceType === RESOURCE_ENERGY && resource.amount > 0) {
        return creep.pickup(resource) === OK;
    }

    return false;
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
    deliverMode: string,
    supplierTurnsBack: boolean
) => {
    const fromCache = ensureCarryCache(from);
    const toCache = ensureCarryCache(to);
    const fromTargetCache = cloneRelayMemoryBlock(ensureCarryTargetCache(from) as RelayMemoryBlock);
    const toSourceCache = cloneRelayMemoryBlock(ensureCarrySourceCache(to) as RelayMemoryBlock);
    const fromMoveToRoomState = cloneRelayMemoryBlock(from.memory._moveToRoomState as RelayMemoryBlock | undefined);
    const toMoveToRoomState = cloneRelayMemoryBlock(to.memory._moveToRoomState as RelayMemoryBlock | undefined);

    fromCache.outCarryMode = supplierTurnsBack ? collectMode : deliverMode;
    toCache.outCarryMode = deliverMode;

    if (supplierTurnsBack) {
        replaceRelayMemoryBlock(from, 'source', toSourceCache);
        replaceRelayMemoryBlock(from, 'target', undefined);
        replaceRelayMemoryBlock(from, '_moveToRoomState', toMoveToRoomState);

        replaceRelayMemoryBlock(to, 'source', undefined);
        replaceRelayMemoryBlock(to, 'target', fromTargetCache);
        replaceRelayMemoryBlock(to, '_moveToRoomState', fromMoveToRoomState);
        return;
    }

    replaceRelayMemoryBlock(to, 'source', undefined);
    replaceRelayMemoryBlock(to, 'target', fromTargetCache);
    replaceRelayMemoryBlock(to, '_moveToRoomState', fromMoveToRoomState);
};

/**
 * 在返程过程中尝试将当前资源整包接力给迎面空仓搬运 creep。
 *
 * @param creep 当前处于返程态的搬运 creep。
 * @param isLikelyCollecting 用于判断候选目标是否仍处于“来取货”态。
 * @param collectMode 接力后当前 creep 要切入的 collect 模式标识。
 * @param deliverMode 接力后目标 creep 要切入的 deliver 模式标识。
 * @returns `true` 表示本 tick 已完成接力和接力后的回头移动。
 */
export const tryOutCarryRelayHandoff = (
    creep: Creep,
    isLikelyCollecting: (creep: Creep) => boolean,
    collectMode: string,
    deliverMode: string
): boolean => {
    if (hasRelayActionThisTick(creep)) return false;

    const sourceRoom = creep.memory.sourceRoom;
    if (!sourceRoom) return false;
    if (creep.pos.isRoomEdge()) return false;

    const resourceType = Object.keys(creep.store).find((resource) => creep.store[resource as ResourceConstant] > 0) as ResourceConstant | undefined;
    if (!resourceType) return false;

    const amount = creep.store[resourceType] || 0;
    if (amount <= 0) return false;

    const relay = pickRelayCandidate(creep, sourceRoom, resourceType, amount, isLikelyCollecting);
    if (!relay) return false;

    return completeRelayHandoff(
        creep,
        relay.creep,
        relay.resourceType,
        relay.transferAmount,
        collectMode,
        deliverMode,
        relay.fullHandoff,
        relay.supplierTurnsBack,
        relay.selfForwardDirection,
        relay.selfFallbackDirection,
        relay.otherFallbackDirection
    );
};

export const tryOutCarryRelayCollectStep = (
    creep: Creep,
    isLikelyCollecting: (creep: Creep) => boolean,
    collectMode: string,
    deliverMode: string
): boolean => {
    if (hasRelayActionThisTick(creep)) return false;
    if (tryCollectEnergyAlongRelayIntent(creep)) return true;

    const sourceRoom = creep.memory.sourceRoom;
    if (!sourceRoom) return false;
    if (creep.pos.isRoomEdge()) return false;

    const relay = pickRelaySupplierCandidate(creep, sourceRoom, isLikelyCollecting);
    if (!relay) return false;

    return completeRelayHandoff(
        relay.creep,
        creep,
        relay.resourceType,
        relay.transferAmount,
        collectMode,
        deliverMode,
        relay.fullHandoff,
        relay.supplierTurnsBack,
        relay.selfForwardDirection,
        relay.selfFallbackDirection,
        relay.otherFallbackDirection
    );
};

/**
 * 兼容旧测试/旧调用点的接力重执行入口。
 *
 * @remarks
 * 部分接力后，giver 需要在同 tick 再跑一次统一入口，
 * 才能按剩余载荷重新解析 collect / deliver 模式。
 */
export const consumeRelayReexecRequest = (creep: Creep): boolean => {
    const holder = getRelayIntentHolder(creep);
    if (holder.__outCarryRelayReexecTick !== Game.time) return false;
    delete holder.__outCarryRelayReexecTick;
    return true;
};
