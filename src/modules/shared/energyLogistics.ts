import { ROLES } from '@/constant/CreepConstant';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { getUpgradeWorkTarget, getUpgraderPathTime } from '@/modules/shared/roomWorkforce';

const STANDARD_RESERVE_BY_LEVEL: Record<number, number> = {
    1: 10000,
    2: 10000,
    3: 10000,
    4: 20000,
    5: 40000,
    6: 80000,
    7: 160000,
    8: 320000,
};

const FUNNEL_SURPLUS_STEP = 1500;

/** 本级标准储量 */
export const getStandardReserve = (level: number): number => STANDARD_RESERVE_BY_LEVEL[level] ?? 10000;

/** 计算房间能量等级（storage + terminal 能量口径） */
export const getEnergyLevel = (room: Room): number => {
    const standard = getStandardReserve(room.level);
    const total = (room.storage?.store[RESOURCE_ENERGY] || 0) + (room.terminal?.store[RESOURCE_ENERGY] || 0);
    if (total < standard) return Math.floor((100 * total) / standard);
    return 100 + Math.round((total - standard) / FUNNEL_SURPLUS_STEP);
};

/**
 * 能量分配中枢（参考实现的集中物流核心：请求-匹配式分配）：
 *
 * 每 tick 生成「能量需求表」——孵化线(spawn/ext)、塔、控制器容器、断供的静态升级工，
 * 各带优先级（ext/spawn=1 → tower=2 → 控制容器/升级工=5）；
 * 满载搬运工按「到请求目标的距离」逐请求认领，冲突时高优先级/更近者抢走、
 * 被抢请求的容量回滚重分配。每个请求同一时刻只配一个搬运工——
 * 「全队涌向同一格」的拥挤在结构上不可能发生，不再需要任何补丁式上限。
 *
 * 断供升级工作为请求（priority 5）被手填，对应参考实现的待填名册机制——
 * 开局不再依赖控制器容器存在（link > 丢落堆 > container 的 depot 链整体退役）。
 */

const FILL_PRIORITY: Record<string, number> = {
    extension: 1,
    spawn: 1,
    tower: 1,
    container: 5,
    upgrader: 5,
};

const TOWER_FILL_THRESHOLD = 400;
/** 升级缓冲专线档位：控制器容器/断供升级工——仅次于孵化扩容与受威胁塔 */
export const UPGRADE_LINE_PRIORITY = 3;
/** 常态（无敌情）塔的补给档位：让位升级专线，仍高于仓储回流 */
const TOWER_IDLE_PRIORITY = 6;

type FillRequest = {
    id: string;
    target: AnyStoreStructure | Creep;
    priority: number;
    amount: number;
};

const barOf = (level: number): number => ({ 1: 200, 2: 45000, 3: 135000, 4: 405000 })[level] ?? 0;
void barOf;

/** 孵化线请求：房间未满员时 spawn/ext 全收（priority 1） */
const collectSpawnLineRequests = (room: Room, requests: FillRequest[]): void => {
    if (room.energyAvailable >= room.energyCapacityAvailable) return;
    const line = [...(room.spawn || []), ...(room.extension || [])];
    for (const structure of line) {
        const amount = structure.store.getFreeCapacity(RESOURCE_ENERGY);
        if (amount > 0) {
            requests.push({ id: structure.id, target: structure, priority: FILL_PRIORITY[structure.structureType] ?? 1, amount });
        }
    }
};

/** 塔请求：低于阈值即请求；受威胁（defend 态）与孵化扩容同档最高，常态让位升级专线 */
const collectTowerRequests = (room: Room, requests: FillRequest[]): void => {
    const threatened = (room.memory as any).defend === true;
    for (const tower of room.tower || []) {
        const current = tower.store[RESOURCE_ENERGY] || 0;
        if (current < TOWER_FILL_THRESHOLD) {
            requests.push({
                id: tower.id,
                target: tower,
                priority: threatened ? FILL_PRIORITY.tower : TOWER_IDLE_PRIORITY,
                amount: TOWER_FILL_THRESHOLD - current,
            });
        }
    }
};

/** 控制器专线请求：cc 缓冲 + 断供静态升级工（空仓即请求，由搬运工手填），同为升级缓冲专线档 */
const collectControllerLineRequests = (room: Room, requests: FillRequest[]): void => {
    const controller = room.controller;
    const cc = controller ? (room.container || []).find(c => c.pos.inRangeTo(controller.pos, 3)) : undefined;
    if (cc) {
        const amount = cc.store.getFreeCapacity(RESOURCE_ENERGY);
        if (amount > 0) {
            requests.push({ id: cc.id, target: cc, priority: UPGRADE_LINE_PRIORITY, amount });
        }
    }

    for (const creep of Object.values(Game.creeps)) {
        if (creep.room.name !== room.name || creep.spawning) continue;
        if (creep.memory?.role !== ROLES.upgrader) continue;
        if ((creep.store[RESOURCE_ENERGY] || 0) > 0) continue;
        const amount = creep.store.getFreeCapacity(RESOURCE_ENERGY);
        if (amount <= 0) continue;
        requests.push({ id: creep.id, target: creep, priority: UPGRADE_LINE_PRIORITY, amount });
    }
};

export const buildFillRequests = (room: Room): FillRequest[] => {
    const requests: FillRequest[] = [];
    collectSpawnLineRequests(room, requests);
    collectTowerRequests(room, requests);
    collectControllerLineRequests(room, requests);
    return requests.filter(r => r.amount > 0);
};

const collectSuppliers = (room: Room): Creep[] => {
    const suppliers: Creep[] = [];
    for (const creep of Object.values(Game.creeps)) {
        if (creep.room.name !== room.name || creep.spawning) continue;
        const role = creep.memory?.role;
        if (role !== ROLES.carrier && role !== ROLES['out-carry']) continue;
        if ((creep.store[RESOURCE_ENERGY] || 0) <= 0) continue;
        suppliers.push(creep);
    }
    return suppliers;
};

type MatchResult = {
    /** creep id → 认领的请求 */
    assignment: Map<string, FillRequest>;
};

// 控制器专线配额：升级火力对口搬运数（2 × 升级W × 路程 / 50 = 所需 C 部件数，
// 按 C4 微型件折算：每车 4 C）。
// 保证升级端供能不被「离 spawn 更近的 ext 请求」吸干——对应参考实现的
// 控制器专职搬运数口径（controllerNumCarry）。

/**
 * 控制器专线搬运配额：升级火力对口搬运数（2 × 升级W × 路程 / 50 = 所需 C 部件数，
 * 按 C4 微型件折算：每车 4 C）。cc 缺位返回 0（手填闭环接管，无需专车）。
 */
export const getControllerCarryQuota = (room: Room): number => {
    const maxWork = getUpgradeWorkTarget(room);
    if (maxWork <= 0) return 0;
    const controller = room.controller;
    const cc = controller ? (room.container || []).find(c => c.pos.inRangeTo(controller.pos, 3)) : undefined;
    if (!cc) return 0;
    const distance = Math.max(10, getUpgraderPathTime(room) ?? 20);
    const carryParts = Math.ceil(2 * maxWork * distance / 50);
    return Math.max(1, Math.ceil(carryParts / 4));
};

const isUpgraderFillRequest = (request: FillRequest): boolean =>
    request.target instanceof Creep;

// 单阶段贪心匹配：每个有余量的请求弹出最近候选；
// 候选已被分配时按「优先级高者/同级更近者」抢夺，被抢请求容量回滚。
// assigned/remaining 由调用方在多阶段间共享（专线→通用的容量记账连续）
const matchRequestsToSuppliers = (
    phaseRequests: FillRequest[],
    phaseSuppliers: Creep[],
    assigned: Map<string, FillRequest>,
    remaining: Map<string, number>,
): void => {
    const candidateLists = new Map<string, Creep[]>();
    for (const request of phaseRequests) {
        candidateLists.set(
            request.id,
            phaseSuppliers
                .filter(s => (s.store[RESOURCE_ENERGY] || 0) > 0)
                .sort((a, b) => a.pos.getRangeTo(request.target) - b.pos.getRangeTo(request.target)),
        );
    }
    const pointers = new Map<string, number>(phaseRequests.map(r => [r.id, 0]));

    // 参考实现同款主循环：每个有余量的请求弹出最近候选；
    // 候选已被分配时按「优先级高者/同级更近者」抢夺，被抢请求容量回滚
    for (;;) {
        const free = phaseRequests.filter(r => (remaining.get(r.id) || 0) > 0);
        if (free.length === 0) break;

        let progressed = false;
        for (const request of free) {
            const candidates = candidateLists.get(request.id) || [];
            let pointer = pointers.get(request.id) || 0;

            while (pointer < candidates.length) {
                const hauler = candidates[pointer];
                pointer++;
                pointers.set(request.id, pointer);

                const before = assigned.get(hauler.id);
                if (!before) {
                    assigned.set(hauler.id, request);
                    remaining.set(request.id, Math.max(0, (remaining.get(request.id) ?? request.amount) - (hauler.store[RESOURCE_ENERGY] || 0)));
                    progressed = true;
                    break;
                }

                // 已有分配：高优先级/同级更近者抢夺
                if (before.priority < request.priority) continue;
                if (before.priority === request.priority && hauler.pos.getRangeTo(before.target) <= hauler.pos.getRangeTo(request.target)) continue;

                remaining.set(before.id, (remaining.get(before.id) || 0) + (hauler.store[RESOURCE_ENERGY] || 0));
                assigned.set(hauler.id, request);
                remaining.set(request.id, Math.max(0, (remaining.get(request.id) ?? request.amount) - (hauler.store[RESOURCE_ENERGY] || 0)));
                progressed = true;
                break;
            }
        }
        if (!progressed) break;
    }
};

/** 按请求来源分线：控制器专线（cc + 断供升级工手填）与通用线 */
const splitRequestsByLine = (room: Room, allRequests: FillRequest[]): { dedicatedRequests: FillRequest[]; generalRequests: FillRequest[] } => {
    const controller = room.controller;
    const dedicatedRequests = controller
        ? allRequests.filter(r => r.id === ccIdOf(room) || isUpgraderFillRequest(r))
        : [];
    const generalRequests = allRequests.filter(r => !dedicatedRequests.some(d => d.id === r.id));
    return { dedicatedRequests, generalRequests };
};

/**
 * 第一阶段：控制器专线（cc + 断供升级工手填）× 最近配额内搬运工。
 * ext 请求离 spawn 近、优先级又高（1 > 5），单阶段贪心会让专线被吸干——
 * 参考实现用专职搬运数兜住升级端供能，这里以两阶段匹配等价实现。
 * 返回专线占用的搬运工 id（未用满配额的回流通用分配）。
 */
const matchDedicatedPhase = (
    room: Room,
    dedicatedRequests: FillRequest[],
    suppliers: Creep[],
    assigned: Map<string, FillRequest>,
    remaining: Map<string, number>,
): Set<string> => {
    const used = new Set<string>();
    const controller = room.controller;
    if (!controller || dedicatedRequests.length === 0) return used;

    const quota = getControllerCarryQuota(room) + dedicatedRequests.filter(isUpgraderFillRequest).length;
    const sorted = [...suppliers].sort((a, b) => a.pos.getRangeTo(controller.pos) - b.pos.getRangeTo(controller.pos));
    matchRequestsToSuppliers(dedicatedRequests, sorted.slice(0, quota), assigned, remaining);
    for (const id of assigned.keys()) used.add(id);
    return used;
};

/** 第二阶段：通用线消费专线回流后的剩余搬运工（此前硬切 slice(quota)：配额虚高时全部载能车被「专线预留」却无人使用，spawn/ext/升级线集体断粮） */
const matchGeneralPhase = (
    generalRequests: FillRequest[],
    suppliers: Creep[],
    assigned: Map<string, FillRequest>,
    remaining: Map<string, number>,
    dedicatedUsed: Set<string>,
): void => {
    matchRequestsToSuppliers(generalRequests, suppliers.filter(s => !dedicatedUsed.has(s.id)), assigned, remaining);
};

const matchRoom = (room: Room, suppliers: Creep[]): MatchResult => {
    const allRequests = buildFillRequests(room);
    const remaining = new Map<string, number>(allRequests.map(r => [r.id, r.amount]));
    const assigned = new Map<string, FillRequest>();

    const { dedicatedRequests, generalRequests } = splitRequestsByLine(room, allRequests);
    const dedicatedUsed = matchDedicatedPhase(room, dedicatedRequests, suppliers, assigned, remaining);
    matchGeneralPhase(generalRequests.length ? generalRequests : allRequests, suppliers, assigned, remaining, dedicatedUsed);

    return { assignment: assigned };
};

const ccIdOf = (room: Room): string | null => {
    const controller = room.controller;
    if (!controller) return null;
    const cc = (room.container || []).find(c => c.pos.inRangeTo(controller.pos, 3));
    return cc?.id ?? null;
};

type RoomMatchCache = { tick: number; match: MatchResult };

const getMatchCache = (room: Room): MatchResult =>
    getRoomTickCacheValue(room, 'energy_logistics_match', (): MatchResult => {
        return matchRoom(room, collectSuppliers(room));
    });

/**
 * 满载搬运工的能量投递目标（集中匹配结果；无认领时返回 null，调用方走兜底）。
 * 每 tick 重算——位置/水位变化自动收敛，无需持久状态。
 */
export const getAssignedEnergyTarget = (creep: Creep): AnyStoreStructure | Creep | null => {
    const match = getMatchCache(creep.room);
    return match.assignment.get(creep.id)?.target ?? null;
};
