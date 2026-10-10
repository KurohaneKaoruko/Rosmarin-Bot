// 家内能量搬运：
// 一只搬运工绑定一条源线，空载回我方容器取满（满载纪律：容器不足一车则在容器旁
// 捡散落并等待，不四处找货），满载按能量中枢的请求配送（spawn/ext/tower/cc/断供升级工，
// 两阶段匹配 + 专线回流）。无请求时持能原地待命——搬运工永远在两点之间，不自主游荡。
import { ROLES } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getAssignedEnergyTarget } from '@/modules/shared/energyLogistics';
import { createPendingLedger, evaluateHeadOnSwap, expectedOutputDelta, selectCarryDeposit } from '@/modules/shared/haulerStrategy';
import { ExternalMineAnalysis, ExternalMineSourceStat } from '@/modules/features/external/externalMine';
import { RoadMemory } from '@/modules/features/external/externalRoad';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';
import { isArrivedInRoom } from '@/prototype/Creep/shared/movement';

// 源旁掉落捡取的最低数量：避免为个位数能量反复蹲点
const SOURCE_DROP_PICKUP_MIN = 30;

/** 源线待运量：容器存量 + 源旁 2 格掉落（需求驱动的选线依据） */
const sourceLinePending = (room: Room, source: Source): number => {
    const container = (room.container || []).find((c) => c.pos.inRangeTo(source.pos, 2));
    const drops = source.pos.findInRange(FIND_DROPPED_RESOURCES, 2)
        .filter((r) => r.resourceType === RESOURCE_ENERGY);
    return (container?.store[RESOURCE_ENERGY] || 0) + drops.reduce((sum, r) => sum + r.amount, 0);
};

/** 已锁定的取货线（粘滞认领）：
 *  线还有待运能量就守住，线干了才解锁重选。 */
export const lockedSourceLine = (creep: Creep): Source | null => {
    const roleCache = creep.getRoleCache();
    const lockedId = roleCache._loadLineId as Id<Source> | undefined;
    if (!lockedId) return null;
    const locked = Game.getObjectById(lockedId) as Source | null;
    // 粘滞判据用原始待运量：预订账本（含别车预扣）只服务于初始选线，
    // 用它判自己的锁会让锁被别车的预扣顶掉 → 换线抖动
    if (locked && sourceLinePending(creep.room, locked) > 0) return locked;
    roleCache._loadLineId = null;
    return null;
};

/** 选线（需求驱动）：按待运量取最大者，同量就近。
 *  已锁定线优先（粘滞，不逐 tick 重选）；无锁或锁线干涸时按待运量选并锁至取满——
 *  旧「名字 hash 永久绑线」在批量孵化的名字序列上 hash 相关，整批同线，
 *  另一源容器/掉落无人搬、能量烂地。 */
export const pickSourceLineByDemand = (creep: Creep): Source | null => {
    const roleCache = creep.getRoleCache();
    const locked = lockedSourceLine(creep);
    if (locked) return locked;
    const sources = (creep.room.source || []) as Source[];
    if (sources.length === 0) return null;
    if (sources.length === 1) return sources[0];
    let best: Source | null = null;
    let bestPending = -1;
    for (const source of sources) {
        const pending = sourceLinePendingFor(creep, creep.room, source);
        const closer = pending === bestPending && best !== null
            && creep.pos.getRangeTo(source.pos) < creep.pos.getRangeTo(best.pos);
        if (pending > bestPending || closer) {
            best = source;
            bestPending = pending;
        }
    }
    pendingLedger.reserve(best.id, Game.time, creep.store.getCapacity(RESOURCE_ENERGY));
    roleCache._loadLineId = best.id;
    return best;
};

// 预期产量记账（在途运量先行记账）：
// 认领即预扣容量，待运量计入途中持续产出——多 carrier 不扎堆，远线不误判枯竭
const pendingLedger = createPendingLedger();

// 源旁采集力（WORK×HARVEST_POWER）按 tick 记忆化：同 tick 多 carrier 选线共享
let harvestPowerTick = -1;
const harvestPowerBySource = new Map<Id<Source>, number>();
const sourceHarvestPower = (room: Room, source: Source): number => {
    if (harvestPowerTick !== Game.time) {
        harvestPowerTick = Game.time;
        harvestPowerBySource.clear();
    }
    const cached = harvestPowerBySource.get(source.id);
    if (cached !== undefined) return cached;
    let power = 0;
    for (const c of source.pos.findInRange(FIND_MY_CREEPS, 1)) {
        if ((c.memory as any).role !== ROLES.harvester) continue;
        power += c.getActiveBodyparts(WORK) * HARVEST_POWER;
    }
    harvestPowerBySource.set(source.id, power);
    return power;
};

/** 选线口径：净待运量（扣除本 tick 已预订）+ 途中预期产出增量 */
const sourceLinePendingFor = (creep: Creep, room: Room, source: Source): number => {
    const current = Math.max(0, sourceLinePending(room, source) - pendingLedger.reservedOf(source.id, Game.time));
    const distance = creep.pos.getRangeTo(source.pos);
    return current + expectedOutputDelta({
        energy: source.energy,
        harvestPower: sourceHarvestPower(room, source),
        distance,
        regenTime: source.ticksToRegeneration || ENERGY_REGEN_TIME,
    });
};

/** 源线还有无可取能量：需求驱动选线下 = 任意源线有待运即可继续取（选线会自动流向堆积侧） */
const carrierSourceLineHasEnergy = (creep: Creep): boolean => {
    const sources = (creep.room.source || []) as Source[];
    return sources.some((source) => sourceLinePending(creep.room, source) > 0);
};

const getUsableEnergyIn = (room: Room, source: Source): { container?: StructureContainer; drops: Resource[] } => {
    const container = (room.container || []).find((c) => c.pos.inRangeTo(source.pos, 2)) as StructureContainer | undefined;
    const drops = source.pos.findInRange(FIND_DROPPED_RESOURCES, 2).filter((r) => r.resourceType === RESOURCE_ENERGY && r.amount > 0);
    return { container, drops };
};

// 顺路灌注：身边 ext/spawn（urgent 加 tower/powerSpawn）顺手补满（途经填充口径）
// 目标清单按格按 tick 记忆化，避免全房遍历
let adjacentFillCacheTick = -1;
const adjacentFillCache = new Map<string, Id<AnyStoreStructure>[]>();

const adjacentFillTargets = (creep: Creep, urgentEnergy: boolean): AnyStoreStructure[] => {
    if (adjacentFillCacheTick !== Game.time) {
        adjacentFillCacheTick = Game.time;
        adjacentFillCache.clear();
    }

    const key = `${urgentEnergy ? 'u' : 'n'}:${creep.room.name}:${creep.pos.x}:${creep.pos.y}`;
    let ids = adjacentFillCache.get(key);
    if (!ids) {
        const targets = [
            ...(creep.room.extension || []),
            ...(creep.room.spawn || []),
            ...(urgentEnergy ? (creep.room.tower || []) : []),
        ] as AnyStoreStructure[];
        ids = targets.filter(s => creep.pos.inRangeTo(s, 1)).map(s => s.id as Id<AnyStoreStructure>);
        adjacentFillCache.set(key, ids);
    }

    const result: AnyStoreStructure[] = [];
    for (const id of ids) {
        const structure = Game.getObjectById(id);
        if (structure && (structure.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > 0) result.push(structure);
    }
    return result;
};

const fillAdjacentSpawnStructures = (creep: Creep, urgentEnergy: boolean): boolean => {
    if ((creep.store[RESOURCE_ENERGY] || 0) <= 0) return false;
    for (const struct of adjacentFillTargets(creep, urgentEnergy)) {
        if (creep.transfer(struct, RESOURCE_ENERGY) === OK) return true;
    }
    return false;
};

// ── 取货（空载）：回源线取满。返回 true = 已满，转送货 ──
// ── 送货（载能）：按能量中枢匹配的请求配送。返回 true = 已送空，转取货 ──
// 时限沉积物（墓碑/废墟）：能量会随 tick 蒸发，无容器可用时作为取货兜底
const findTimeLimitedDeposit = (creep: Creep): Tombstone | Ruin | null => {
    const tombstones = creep.room.find(FIND_TOMBSTONES, { filter: (t: Tombstone) => (t.store[RESOURCE_ENERGY] || 0) >= 50 }) as Tombstone[];
    const ruins = creep.room.find(FIND_RUINS, { filter: (r: Ruin) => (r.store[RESOURCE_ENERGY] || 0) >= 50 }) as Ruin[];
    const all = [...tombstones, ...ruins] as (Tombstone | Ruin)[];
    return all.length ? creep.pos.findClosestByRange(all) : null;
};

/** 交付目标粘滞（整趟一次选定，持证跨 tick 有效）：
 *  整趟一次选定，只有目标消失或装满才重新认领——
 *  旧口径每 tick 重跑中枢匹配，等距候选/水位浮动会让搬运工反复改目标，来回走路空耗。 */
export const resolveDeliveryTarget = (creep: Creep): AnyStoreStructure | Creep | null => {
    const roleCache = creep.getRoleCache();
    const cachedId = roleCache._deliverTarget as Id<AnyStoreStructure | Creep> | undefined;
    if (cachedId) {
        const cached = Game.getObjectById(cachedId) as AnyStoreStructure | Creep | null;
        if (cached && (cached.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > 0) return cached;
        delete roleCache._deliverTarget;
    }
    const fresh = getAssignedEnergyTarget(creep) as AnyStoreStructure | Creep | null;
    if (fresh) roleCache._deliverTarget = fresh.id;
    return fresh;
};

/** 释放交付占领：卸空、目标装满后调用，下次交付再认领（占领记录直接删除，不设过期） */
export const clearDeliveryTarget = (creep: Creep): void => {
    delete creep.getRoleCache()._deliverTarget;
};

/** 源线取货（导出供测试）：返回 true = 已满转送货 */
export const runCarrierFetch = (creep: Creep): boolean => {
    const mem = creep.memory as any;
    // 空载起手释放交付占领（卸干净才重认领）；取货线锁由 lockedSourceLine 按干涸与否自行释放，
    // 不在此清除——否则空车每 tick 换线白走
    if ((creep.store[RESOURCE_ENERGY] || 0) === 0) clearDeliveryTarget(creep);
    const source = pickSourceLineByDemand(creep);
    if (!source) return false;
    const { container, drops } = getUsableEnergyIn(creep.room, source);
    const freeCap = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    if (freeCap <= 0) return true;
    (creep.memory as any)._fetchSrc = null;
    (creep.memory as any)._assign = null;

    // 容器有能量：满载纪律——容器 ≥ 空位直接取满；不足一车时在容器旁捡散落并等待
    if (container && (container.store[RESOURCE_ENERGY] || 0) > 0) {
        (creep.memory as any)._fetchSrc = '箱';
        if (!creep.pos.inRangeTo(container, 1)) {
            creep.moveTo(container, { visualizePathStyle: { stroke: '#ffaa00' } });
            return false;
        }
        if ((container.store[RESOURCE_ENERGY] || 0) >= freeCap) {
            creep.withdraw(container, RESOURCE_ENERGY);
            return creep.store.getFreeCapacity() === 0;
        }
        // 不足一车：捡散落凑，凑不满则原地等容器攒（站容器旁，不游荡找货）
        for (const r of creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1)) {
            if (r.resourceType !== RESOURCE_ENERGY) continue;
            if (creep.store.getFreeCapacity() === 0) break;
            creep.pickup(r);
        }
        return creep.store.getFreeCapacity() === 0;
    }

    // 容器未建/无能量：捡源旁掉落（≥ 门槛才值得动；小堆等它长大）
    const pickable = drops.filter((r) => r.amount >= SOURCE_DROP_PICKUP_MIN || creep.pos.inRangeTo(r, 1));
    const close = pickable.length ? creep.pos.findClosestByRange(pickable) : null;
    if (close) {
        (creep.memory as any)._fetchSrc = '堆';
        if (creep.pos.inRangeTo(close, 1)) {
            creep.pickup(close);
            return creep.store.getFreeCapacity() === 0;
        }
        creep.moveTo(close, { visualizePathStyle: { stroke: '#ffaa00' } });
        return false;
    }

    // 时限沉积物兜底：墓碑/废墟能量会蒸发，源线断供时优先回收
    const deposit = findTimeLimitedDeposit(creep);
    if (deposit) {
        (creep.memory as any)._fetchSrc = '墓';
        if (creep.pos.inRangeTo(deposit, 1)) {
            for (const t of Object.keys(deposit.store) as ResourceConstant[]) {
                if (creep.store.getFreeCapacity() === 0) break;
                if ((deposit.store[t] || 0) > 0) creep.withdraw(deposit, t);
            }
            return creep.store.getFreeCapacity() === 0;
        }
        creep.moveTo(deposit, { visualizePathStyle: { stroke: '#ffaa00' } });
        return false;
    }

    // 无货：站源旁 2 格等待产出（不自主游荡）
    if (creep.pos.getRangeTo(source) > 2) {
        creep.moveTo(source, { range: 2, visualizePathStyle: { stroke: '#ffaa00' } });
    }
    return false;
};

// ── 送货（载能）：按能量中枢匹配的请求配送。返回 true = 已送空，转取货 ──
/** 送货（导出供测试）：无认领时溢流沉淀到控制器旁 */
export const runCarrierDeliver = (creep: Creep, urgentEnergy: boolean): boolean => {
    // 持有非能量资源：就地丢掉（能量专线不捎带杂物）
    for (const resourceType of Object.keys(creep.store) as ResourceConstant[]) {
        if (resourceType !== RESOURCE_ENERGY && (creep.store[resourceType] || 0) > 0) {
            creep.drop(resourceType);
            break;
        }
    }

    // 顺路灌注：身边 ext/spawn（urgent 加 tower）顺手补
    if (fillAdjacentSpawnStructures(creep, urgentEnergy)) {
        if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return true;
    }

    const load = creep.store[RESOURCE_ENERGY] || 0;
    if (load <= 0) return true;

    // 中央匹配请求（spawn/ext/tower/cc/断供升级工，两阶段专线保护）——粘滞：整趟不改目标
    const assigned = resolveDeliveryTarget(creep);
    // 分配结果可视化：U=断供升级工 C=控制器容器 E=孵化线 T=塔 无=全满待命
    (creep.memory as any)._assign = assigned
        ? (assigned instanceof Creep ? 'U' : assigned.structureType === STRUCTURE_CONTAINER ? 'C' : assigned.structureType === STRUCTURE_TOWER ? 'T' : 'E')
        : null;
    if (assigned) {
        if (creep.pos.inRangeTo(assigned, 1)) {
            const free = assigned.store.getFreeCapacity(RESOURCE_ENERGY);
            if (free <= 0) {
                clearDeliveryTarget(creep); // 目标已满：释放占领，下 tick 重认领
                return false;
            }
            if (creep.transfer(assigned, RESOURCE_ENERGY) === ERR_FULL) clearDeliveryTarget(creep);
            return creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0;
        }
        creep.moveTo(assigned, { visualizePathStyle: { stroke: '#ffffff' } });
        return false;
    }

    // 无请求（孵化线/塔/容器全满）：溢流卸货闸——
    // 控制器容器能收 → 直接灌容器；容器缺位/已满但有升级工在场 → 卸在容器旁地面堆
    //（升级工取能链消费）；两者皆无 → 持能待命（爬体是零损耗移动仓储，
    // 没有消费者的地上堆只会腐烂）
    const controller = creep.room.controller;
    if (controller) {
        const cc = (creep.room.container || []).find(c => c.pos.inRangeTo(controller.pos, 3));
        if (cc && (cc.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > 0) {
            if (creep.pos.inRangeTo(cc, 1)) {
                creep.transfer(cc, RESOURCE_ENERGY);
                return creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0;
            }
            creep.moveTo(cc, { visualizePathStyle: { stroke: '#ffffff' } });
            return false;
        }
        const hasUpgrader = Object.values(Game.creeps).some(c =>
            c.room.name === creep.room.name && !c.spawning && (c.memory as any)?.role === ROLES.upgrader);
        if (!hasUpgrader) return false;
        const depot = cc ?? controller;
        if (creep.pos.inRangeTo(depot, 1)) {
            creep.drop(RESOURCE_ENERGY);
            return true;
        }
        creep.moveTo(depot, { range: 1, visualizePathStyle: { stroke: '#ffffff' } });
        return false;
    }
    return false;
};

// 紧急模式：spawn/塔告急时顺路灌注放开 tower
const shouldUseUrgentEnergyMode = (creep: Creep): boolean => creep.room.CheckSpawnAndTower();

// 接力开关：lv<7 恒接力，lv7+ 直运
const shouldRelayRoom = (room: Room): boolean => room.controller !== undefined && room.controller.level < 7;

// 意图坐标（对穿匹配用意图格）：
// 本 tick 朝目标方向要踏入的相邻格
const intendedCoordOf = (creep: Creep, toward: { x: number; y: number }): { x: number; y: number } => {
    const dx = Math.sign(toward.x - creep.pos.x);
    const dy = Math.sign(toward.y - creep.pos.y);
    return { x: creep.pos.x + dx, y: creep.pos.y + dy };
};

// 接力交接：
// 意图格上依次检查——空车的墓碑/掉落顺手收、矿工 pull 搭车、
// 相向对穿的同容量搬运工（对方意图格 = 我的位置）→ 供方 transfer 给需方，双方调头。
// 供方 TTL≤50 不接力（快死的能量不做半程交接）；_relayed 防同 tick 往复。
// 交接后 FSM 按新载量自然换向，无需显式转向
const tryRelayHandoff = (creep: Creep, toward: { x: number; y: number } | null): boolean => {
    if (!toward) return false;
    if (!shouldRelayRoom(creep.room)) return false;
    const mem = creep.memory as any;
    if (mem._relayed === Game.time) return false;
    const supplying = (creep.store[RESOURCE_ENERGY] || 0) > 0;
    const coord = intendedCoordOf(creep, toward);

    // 途中拾取：空车意图格上的墓碑/掉落顺手收
    if (!supplying) {
        const tomb = creep.room.lookForAt(LOOK_TOMBSTONES, coord.x, coord.y)[0] as Tombstone | undefined;
        if (tomb && (tomb.store[RESOURCE_ENERGY] || 0) > 0 && creep.pos.isNearTo(coord.x, coord.y)) {
            creep.withdraw(tomb, RESOURCE_ENERGY);
            mem._relayed = Game.time;
            return true;
        }
        const res = creep.room.lookForAt(LOOK_RESOURCES, coord.x, coord.y)[0] as Resource | undefined;
        if (res && res.resourceType === RESOURCE_ENERGY && creep.pos.isNearTo(coord.x, coord.y)) {
            creep.pickup(res);
            mem._relayed = Game.time;
            return true;
        }
    }

    const other = creep.room.lookForAt(LOOK_CREEPS, coord.x, coord.y)[0];
    if (!other || !other.my || (other.memory as any).role !== ROLES.carrier) return false;
    const otherMem = other.memory as any;
    if (otherMem._relayed === Game.time) return false;

    // 矿工 pull 搭车：空车意图格上是矿工 → 让矿工拉自己（省一步移动）
    if (!supplying && other.memory.role === ROLES.harvester && other.store[RESOURCE_ENERGY] > 0) {
        other.pull(creep);
        mem._relayed = Game.time;
        return true;
    }

    const otherSupplying = (other.store[RESOURCE_ENERGY] || 0) > 0;

    // 相向对穿判定：对方意图格 = 我的当前位置（正面对穿）
    const otherToward = otherSupplying
        ? ((otherMem._toward as { x: number; y: number } | undefined) ?? null)
        : pickSourceLineByDemand(other)?.pos ?? null;
    if (!otherToward) return false;
    const otherCoord = intendedCoordOf(other, otherToward);
    const coordsInterlocked = otherCoord.x === creep.pos.x && otherCoord.y === creep.pos.y;

    // 门槛判据：相位相反 + 容量相等 + 供方 TTL>50
    if (!evaluateHeadOnSwap({
        supplying,
        otherSupplying,
        otherRetreat: !!otherMem.retreat,
        otherRelayed: otherMem._relayed === Game.time,
        selfRelayed: mem._relayed === Game.time,
        coordsInterlocked,
        capacityEqual: other.store.getCapacity(RESOURCE_ENERGY) === creep.store.getCapacity(RESOURCE_ENERGY),
        supplierTtl: (supplying ? creep : other).ticksToLive || 1500,
    })) return false;

    const supplier = supplying ? creep : other;
    const fetcher = supplying ? other : creep;
    if (supplier.transfer(fetcher, RESOURCE_ENERGY) !== OK) return false;

    // 任务互换（memory/heap 整对象互换）：cache.role 整对象 + 协议字段
    // 随属主走——双方原地接管对方任务（源线锁/目标分配），无需走完全程
    const supplierCreep = supplying ? creep : other;
    const fetcherCreep = supplying ? other : creep;
    const supplierCache = supplierCreep.getRoleCache();
    const fetcherCache = fetcherCreep.getRoleCache();
    const supplierState = { ...supplierCache };
    for (const key of Object.keys(supplierCache)) delete supplierCache[key];
    Object.assign(supplierCache, fetcherCache);
    for (const key of Object.keys(fetcherCache)) delete fetcherCache[key];
    Object.assign(fetcherCache, supplierState);
    const tmpToward = mem._toward ?? null;
    mem._toward = otherMem._toward ?? null;
    otherMem._toward = tmpToward;
    const tmpAssign = mem._assign ?? null;
    mem._assign = otherMem._assign ?? null;
    otherMem._assign = tmpAssign;
    mem._relayed = Game.time;
    (otherMem as any)._relayed = Game.time;
    return true;
};

// ==================== 外矿搬运工作位（按 sourceRoom/targetRoom 参数化）====================
// memory.sourceRoom + targetRoom 任务绑定时走外矿搬运：源点取能 → 规划路线 → 母房交付，
// 相向接力与直递契约在同角色内通用；家内源线工作不含本段字段，互不干扰。

// ==================== 口径 ====================

const OUT_CARRY_STRATEGIES = {
    COLLECT: 'collect',
    DELIVER: 'deliver'
} as const;

type OutCarryMode = typeof OUT_CARRY_STRATEGIES[keyof typeof OUT_CARRY_STRATEGIES];

/** 源边落地能量的拾取下限：低于此值不值得专门走一步 */
const OUT_CARRY_PICKUP_MIN_AMOUNT = 50;
/** terminal 能量缓冲线：低于此线优先回补 terminal（交易/反应的运转水位） */
const OUT_CARRY_TERMINAL_ENERGY_LINE = 10000;
/** storage 参与承接主仓所需的最低能量空位 */
const OUT_CARRY_STORAGE_MIN_FREE = 10000;
/** ext/spawn 参与承接所需的最低能量空位（RCL2-6 的 ext 单格容量仅 50，阈值必须低于它） */
const OUT_CARRY_SPAWN_LINE_MIN_FREE = 25;

// ==================== 缓存根 ====================

// 外矿搬运统一只保留一个 cache 根，source / target 作为其中的分区使用。
const getOutCarryCache = (creep: Creep): Record<string, any> =>
    ensureMemoryCache(creep.memory) as Record<string, any>;

const getOutCarrySectionCache = (creep: Creep, key: 'source' | 'target'): Record<string, any> => {
    const cache = getOutCarryCache(creep);
    return (cache[key] && typeof cache[key] === 'object' ? cache[key] : (cache[key] = {})) as Record<string, any>;
};

const getOutCarrySourceCache = (creep: Creep): Record<string, any> =>
    getOutCarrySectionCache(creep, 'source');

const getOutCarryTargetCache = (creep: Creep): Record<string, any> =>
    getOutCarrySectionCache(creep, 'target');

// ==================== 移动 ====================

const routeExitCache: Record<string, { tick: number; exit: number | null }> = {};

const isSameRoomPosition = (left: RoomPosition, right: RoomPosition): boolean => (
    left.x === right.x &&
    left.y === right.y &&
    left.roomName === right.roomName
);

const moveOutCarryTo = (
    creep: Creep,
    target: RoomPosition | { pos: RoomPosition },
    opts?: MoveToOpts,
): ScreepsReturnCode => creep.moveTo(target, {
    maxRooms: 1,
    ignoreCreeps: false,
    plainCost: 2,
    swampCost: 10,
    reusePath: 3,
    ...opts,
});

const moveOutCarryToRoom = (
    creep: Creep,
    roomName: string,
    opts?: Record<string, any>,
) => creep.moveToRoom(roomName, opts);

// 跨房段沿规划路线走：先找本房路线最近可通行点，退化到 findRoute 出口方向
const getRouteExitDirection = (creep: Creep, targetRoom: string | undefined): number | null => {
    if (!targetRoom || creep.room.name === targetRoom) return null;

    const cacheKey = `${creep.room.name}->${targetRoom}`;
    const cached = routeExitCache[cacheKey];
    if (cached && cached.tick === Game.time) return cached.exit;

    let exit: number | null = null;
    const route = Game.map.findRoute(creep.room.name, targetRoom);
    if (Array.isArray(route) && route.length > 0) {
        exit = route[0].exit;
    }

    routeExitCache[cacheKey] = { tick: Game.time, exit };
    return exit;
};

/**
 * 判定单个规划道路格是否可通行（纯函数，供记忆化入口调用）。
 */
const computeWalkablePlannedRoadPos = (room: Room, pos: RoomPosition): boolean => {
    const terrain = room.getTerrain();
    if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;

    const structures = pos.lookFor(LOOK_STRUCTURES) as Structure[];
    for (const structure of structures) {
        if (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) continue;
        if (structure.structureType === STRUCTURE_RAMPART) {
            const rampart = structure as StructureRampart;
            if (rampart.my || rampart.isPublic) continue;
        }
        return false;
    }

    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for (const site of sites) {
        if (site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER || site.structureType === STRUCTURE_RAMPART) continue;
        return false;
    }

    return true;
};

let walkableRoadPosCacheTick = -1;
const walkableRoadPosCache = new Map<string, boolean>();

/**
 * 判定规划道路格是否可通行，按 tick 记忆化。
 *
 * @remarks
 * 同一 tick 内格子上有什么建筑/工地不会变，而中转中的搬运工每 tick 都要
 * 拿整条规划路线逐点判定，单次判定是两次 `lookFor`（各算一次房间查询）。
 * 不记忆化的话，「路线点数 × 同路线 creep 数」会把房间查询放大到每 tick 数千次。
 */
const isWalkablePlannedRoadPos = (room: Room, pos: RoomPosition): boolean => {
    if (pos.roomName !== room.name) return false;

    if (walkableRoadPosCacheTick !== Game.time) {
        walkableRoadPosCacheTick = Game.time;
        walkableRoadPosCache.clear();
    }

    const key = `${room.name}:${pos.x}:${pos.y}`;
    const cached = walkableRoadPosCache.get(key);
    if (cached !== undefined) return cached;

    const result = computeWalkablePlannedRoadPos(room, pos);
    walkableRoadPosCache.set(key, result);
    return result;
};

// 跨房重平衡的最小间隔：换房本身要重走一趟路，换得太勤净亏在路程上。
type TransitRoomEntry = { pos: RoomPosition; progress: number };

// 按 tick 缓存的「路线 → 房间 → 可通行点序列」，只取决于
// (源房, 目标房, 房间名, 行进方向, 路线版本)，与 creep 自身位置无关，
// 所以同一条路线上的所有中转 creep 直接共享这一份。
let transitRoomIndexTick = -1;
const transitRoomIndexForward = new Map<string, TransitRoomEntry[][]>();
const transitRoomIndexBackward = new Map<string, TransitRoomEntry[][]>();

/**
 * 取「各条路线在当前房间内的可通行点序列」，数组顺序与 `RoadMemory.getAllPaths` 的迭代顺序一致。
 *
 * @param sourceRoom 源头房间名。
 * @param targetRoom 目标房间名。
 * @param room 当前 creep 所在的房间（即可通行判定的房间）。
 * @param towardTaskTarget 是否朝目标房方向行进（false 表示返程）。
 * @returns 每条路线一份 `TransitRoomEntry[]`；该路线在本房没有可通行点时给空数组。
 */
const getTransitRoomEntries = (
    sourceRoom: string,
    targetRoom: string,
    room: Room,
    towardTaskTarget: boolean
): TransitRoomEntry[][] => {
    const version = RoadMemory.getRouteVersion(sourceRoom);
    if (transitRoomIndexTick !== Game.time) {
        transitRoomIndexTick = Game.time;
        transitRoomIndexForward.clear();
        transitRoomIndexBackward.clear();
    }

    const cache = towardTaskTarget ? transitRoomIndexForward : transitRoomIndexBackward;
    const cacheKey = `${sourceRoom}:${targetRoom}:${room.name}:${version}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const perRoute: TransitRoomEntry[][] = [];

    for (const path of RoadMemory.getAllPaths(sourceRoom, targetRoom).values()) {
        if (!Array.isArray(path) || path.length === 0) {
            perRoute.push([]);
            continue;
        }

        // progress 的口径依赖「本房内共有多少点」，所以先数一遍长度、再填点。
        let inRoomCount = 0;
        for (let idx = 0; idx < path.length; idx++) {
            const pos = towardTaskTarget ? path[idx] : path[path.length - 1 - idx];
            if (pos.roomName === room.name) inRoomCount++;
        }
        if (inRoomCount === 0) {
            perRoute.push([]);
            continue;
        }

        const entries: TransitRoomEntry[] = [];
        for (let idx = 0; idx < path.length; idx++) {
            const pos = towardTaskTarget ? path[idx] : path[path.length - 1 - idx];
            if (pos.roomName !== room.name) continue;
            if (!isWalkablePlannedRoadPos(room, pos)) continue;
            entries.push({ pos, progress: inRoomCount - idx });
        }

        perRoute.push(entries);
    }

    cache.set(cacheKey, perRoute);
    return perRoute;
};

// 中转目标按 creep 短缓存：跨房途中没必要每 tick 重扫全部路线点
// （路线数 × 点数 × getRangeTo），沿途 3 tick 内最近点基本不变。
// 到点 / 换房 / 超时立即失效，不会引入绕路。
const TRANSIT_REPLAN_INTERVAL_TICKS = 3;
type TransitPlanCacheEntry = { tick: number; roomName: string; target: RoomPosition };
const transitPlanCache = new Map<string, TransitPlanCacheEntry>();

const getPlannedTransitRoadTarget = (creep: Creep, nextRoomName: string | undefined): RoomPosition | null => {
    const sourceRoom = creep.memory.sourceRoom;
    const taskTargetRoom = creep.memory.targetRoom;
    if (!nextRoomName || !sourceRoom || !taskTargetRoom || sourceRoom === taskTargetRoom) return null;

    const cachedPlan = transitPlanCache.get(creep.id);
    if (
        cachedPlan &&
        Game.time - cachedPlan.tick < TRANSIT_REPLAN_INTERVAL_TICKS &&
        cachedPlan.roomName === creep.room.name &&
        !isSameRoomPosition(creep.pos, cachedPlan.target)
    ) {
        return cachedPlan.target;
    }

    const allPaths = RoadMemory.getAllPaths(sourceRoom, taskTargetRoom);
    if (!(allPaths instanceof Map) || allPaths.size === 0) return null;

    const towardTaskTarget = nextRoomName === taskTargetRoom;
    const perRoute = getTransitRoomEntries(sourceRoom, taskTargetRoom, creep.room, towardTaskTarget);

    let best: { pos: RoomPosition; range: number; progress: number } | null = null;

    for (const entries of perRoute) {
        if (entries.length === 0) continue;

        let nearestIndex = -1;
        let nearestRange = Infinity;
        for (let i = 0; i < entries.length; i++) {
            const range = creep.pos.getRangeTo(entries[i].pos);
            if (range < nearestRange || (range === nearestRange && i > nearestIndex)) {
                nearestRange = range;
                nearestIndex = i;
            }
        }
        if (nearestIndex < 0) continue;

        // 已经踩在最近点上就再往前一格，避免原地打转。
        let candidateIndex = nearestIndex;
        if (isSameRoomPosition(creep.pos, entries[nearestIndex].pos) && nearestIndex + 1 < entries.length) {
            candidateIndex = nearestIndex + 1;
        }

        const candidate = entries[candidateIndex];
        if (
            !best ||
            nearestRange < best.range ||
            (nearestRange === best.range && candidate.progress < best.progress)
        ) {
            best = { pos: candidate.pos, range: nearestRange, progress: candidate.progress };
        }
    }

    const plannedTarget = best?.pos || null;
    if (plannedTarget) {
        transitPlanCache.set(creep.id, { tick: Game.time, roomName: creep.room.name, target: plannedTarget });
    } else {
        transitPlanCache.delete(creep.id);
    }
    // 死亡 creep 的残留条目定期清一把，Map 不会无限长大。
    if (transitPlanCache.size > 500) {
        for (const [id, entry] of transitPlanCache) {
            if (Game.time - entry.tick >= TRANSIT_REPLAN_INTERVAL_TICKS) transitPlanCache.delete(id);
        }
    }
    return plannedTarget;
};

const moveAlongPlannedRoute = (creep: Creep, targetRoom: string | undefined): boolean => {
    if (!targetRoom) return false;
    if (creep.room.name === targetRoom) return false;
    if (creep.pos.isRoomEdge()) return false;

    const plannedRoadTarget = getPlannedTransitRoadTarget(creep, targetRoom);
    if (plannedRoadTarget && !isSameRoomPosition(creep.pos, plannedRoadTarget)) {
        moveOutCarryTo(creep, plannedRoadTarget, { range: 0 });
        return true;
    }

    const exitDirection = getRouteExitDirection(creep, targetRoom);
    if (!exitDirection) return false;

    const exits = creep.room.find(exitDirection as FindConstant);
    if (!exits || exits.length <= 0) return false;
    const exitPos = creep.pos.findClosestByRange(exits);
    if (!exitPos) return false;

    moveOutCarryTo(creep, exitPos, { range: 0 });
    return true;
};

// ==================== 收集点解析 ====================

const getPreferredCarrySource = (creep: Creep): ExternalMineSourceStat | null =>
    ExternalMineAnalysis.pickBestCarrySource(creep);

const clearAssignedSourceCache = (cache: Record<string, any> | undefined) => {
    if (!cache) return;
    delete cache.assignedSourceId;
    delete cache.assignedSourceKey;
};

const assignPreferredSourceCache = (cache: Record<string, any>, sourceStat: ExternalMineSourceStat | null) => {
    if (!sourceStat) {
        clearAssignedSourceCache(cache);
        return;
    }
    cache.assignedSourceId = sourceStat.sourceId;
    cache.assignedSourceKey = sourceStat.sourceKey;
};

type OutCarryCollectSite = {
    sourcePos: RoomPosition;
    container: StructureContainer | null;
    /** 调度评分结果；双房不同帧可见时为 null，走本地口径 */
    stat: ExternalMineSourceStat | null;
};

/**
 * 收集点解析：优先调度评分（需源/目标房同帧可见），否则退化为
 * 直递认领键 → 最近 source 的本地口径，容器按「源 range 1」就地识别。
 */
const resolveCollectSite = (creep: Creep): OutCarryCollectSite | null => {
    const stat = getPreferredCarrySource(creep);
    if (stat) return { sourcePos: stat.sourcePos, container: stat.container, stat };

    let sourcePos: RoomPosition | null = null;

    const assignedKey = getOutCarrySourceCache(creep).assignedSourceKey;
    if (typeof assignedKey === 'string' && assignedKey.includes(':')) {
        const [keyX, keyY] = assignedKey.split(':');
        const x = Number(keyX);
        const y = Number(keyY);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            const bound = creep.room.find(FIND_SOURCES).find(s => s.pos.x === x && s.pos.y === y);
            if (bound) sourcePos = bound.pos;
        }
    }
    if (!sourcePos) {
        sourcePos = creep.pos.findClosestByRange(FIND_SOURCES)?.pos ?? null;
    }
    if (!sourcePos) return null;

    const container = sourcePos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER,
    })[0] as StructureContainer | undefined ?? null;

    return { sourcePos, container, stat: null };
};

// 认领登记：供运力统计与多搬运工分流口径使用（无评分结果时保留既有认领）
const recordCollectBinding = (creep: Creep, stat: ExternalMineSourceStat | null): void => {
    if (!stat) return;
    assignPreferredSourceCache(getOutCarrySourceCache(creep), stat);
};

// 源边是否有采集体在产出（外矿采集/建造都会向搬运工直递）
const hasActiveMinerNear = (sourcePos: RoomPosition): boolean =>
    sourcePos.findInRange(FIND_MY_CREEPS, 3, {
        filter: (c: Creep) => c.memory.role === ROLES.harvester || c.memory.role === ROLES['out-build'],
    }).length > 0;

// ==================== 模式切换 ====================

const switchToDeliver = (creep: Creep): void => {
    getOutCarryCache(creep).outCarryMode = OUT_CARRY_STRATEGIES.DELIVER;
    delete getOutCarryTargetCache(creep).targetId;
};

/**
 * 粘滞两态：空仓回采、满载起运；矿点断供时的提前起运由收集态显式切换。
 * 字段挂在 cache 根上，直递方满载时可直接置 deliver 复用同一契约。
 */
const syncOutCarryMode = (creep: Creep): OutCarryMode => {
    const cache = getOutCarryCache(creep);
    let mode: OutCarryMode = cache.outCarryMode === OUT_CARRY_STRATEGIES.DELIVER
        ? OUT_CARRY_STRATEGIES.DELIVER
        : OUT_CARRY_STRATEGIES.COLLECT;

    if (mode === OUT_CARRY_STRATEGIES.DELIVER) {
        if (creep.store.getUsedCapacity() <= 0) mode = OUT_CARRY_STRATEGIES.COLLECT;
    } else if (creep.store.getFreeCapacity() <= 0) {
        mode = OUT_CARRY_STRATEGIES.DELIVER;
    }

    if (mode !== cache.outCarryMode) {
        cache.outCarryMode = mode;
        delete getOutCarryTargetCache(creep).targetId;
    }
    return mode;
};

// ==================== 危险撤退 ====================

// 危险判定（保守等价口径）：
// 非己方房间出现带攻击部件的敌对单位——情报体系就绪前先按视野实时判定
const isDangerRoomForOutCarry = (creep: Creep): boolean => {
    if (creep.room.my) return false;
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
        filter: (h: Creep) => h.getActiveBodyparts(ATTACK) > 0 || h.getActiveBodyparts(RANGED_ATTACK) > 0,
    }) as Creep[];
    return hostiles.length > 0;
};

/** 撤退回母房：途中保留载货；抵达后清空相位/源绑定/目标缓存，交给母房交付流程消化 */
const retreatToHome = (creep: Creep): boolean => {
    const sourceRoom = creep.memory.sourceRoom;
    if (!sourceRoom) return false;

    if (creep.room.name !== sourceRoom || creep.pos.isRoomEdge()) {
        if (!creep.pos.isRoomEdge() && moveAlongPlannedRoute(creep, sourceRoom)) return true;
        moveOutCarryToRoom(creep, sourceRoom, { plainCost: 2, swampCost: 10 });
        return true;
    }

    // 抵达母房：清空任务状态（有货转交付、无货全清）
    const cache = getOutCarryCache(creep);
    cache.outCarryMode = creep.store.getUsedCapacity() > 0
        ? OUT_CARRY_STRATEGIES.DELIVER
        : OUT_CARRY_STRATEGIES.COLLECT;
    delete getOutCarrySourceCache(creep).assignedSourceId;
    delete getOutCarrySourceCache(creep).assignedSourceKey;
    delete getOutCarryTargetCache(creep).targetId;
    delete (creep.memory as any).retreat;
    return false;
};

// ==================== 收集态 ====================

// 源边落地能量：掉落取最大堆，无掉落再取墓碑存量
const collectLooseEnergy = (creep: Creep, sourcePos: RoomPosition | null): boolean => {
    const drops = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount > OUT_CARRY_PICKUP_MIN_AMOUNT
            && (!sourcePos || r.pos.inRangeTo(sourcePos, 3)),
    });
    if (drops.length > 0) {
        const biggest = drops.reduce((a, b) => (b.amount > a.amount ? b : a));
        if (creep.pos.inRangeTo(biggest, 1)) creep.pickup(biggest);
        else moveOutCarryTo(creep, biggest.pos, { range: 1 });
        return true;
    }

    if (!sourcePos) return false;
    const tombstone = sourcePos.findInRange(FIND_TOMBSTONES, 3, {
        filter: (t: Tombstone) => (t.store[RESOURCE_ENERGY] || 0) > OUT_CARRY_PICKUP_MIN_AMOUNT,
    })[0];
    if (!tombstone) return false;

    if (creep.pos.inRangeTo(tombstone, 1)) creep.withdraw(tombstone, RESOURCE_ENERGY);
    else moveOutCarryTo(creep, tombstone.pos, { range: 1 });
    return true;
};

const runOutCarryCollect = (creep: Creep): void => {
    creep.memory.dontPullMe = false;
    const targetRoom = creep.memory.targetRoom;
    if (!targetRoom) return;

    if (creep.room.name !== targetRoom || creep.pos.isRoomEdge()) {
        if (creep.room.name !== targetRoom && !creep.pos.isRoomEdge() && moveAlongPlannedRoute(creep, targetRoom)) return;
        moveOutCarryToRoom(creep, targetRoom, { plainCost: 2, swampCost: 10 });
        return;
    }

    const site = resolveCollectSite(creep);
    if (!site) return;
    recordCollectBinding(creep, site.stat);

    // keeper 源点：source keeper 在场（源旁 5 格）时等待，不进取货
    if (typeof STRUCTURE_KEEPER_LAIR !== 'undefined' && site.sourcePos) {
        const keepers = site.sourcePos.findInRange(FIND_HOSTILE_CREEPS, 5, {
            filter: (h: any) => h.owner?.username === 'Source Keeper',
        });
        if (keepers.length > 0) return;
    }

    // ① 源边落地能量优先
    if (collectLooseEnergy(creep, site.sourcePos)) return;

    // ② 容器：整仓才取；存量不够整仓且有产出时原地等灌装，绝不满仓前起运
    if (site.container) {
        const stock = site.container.store[RESOURCE_ENERGY] || 0;
        if (stock > 0) {
            if (!creep.pos.inRangeTo(site.container.pos, 1)) {
                moveOutCarryTo(creep, site.container.pos, { range: 1 });
                return;
            }
            if (stock >= creep.store.getFreeCapacity()) {
                creep.withdraw(site.container, RESOURCE_ENERGY);
            } else if (!hasActiveMinerNear(site.sourcePos)) {
                // 不再产出：存量全取，半仓也运回家，避免站死
                creep.withdraw(site.container, RESOURCE_ENERGY);
            }
            return;
        }
    }

    // ③ 无容器/空容器：贴源待直递；矿点断供且有货才允许半载起运
    if (!creep.pos.inRangeTo(site.sourcePos, 2)) {
        moveOutCarryTo(creep, site.sourcePos, { range: 2 });
        return;
    }
    if (creep.store.getUsedCapacity() > 0 && !hasActiveMinerNear(site.sourcePos)) {
        switchToDeliver(creep);
    }
};

// ==================== 交付态 ====================

let remoteAdjacentFillCacheTick = -1;
const remoteAdjacentFillCache = new Map<string, Id<AnyStoreStructure>[]>();

// 身边（range 1）孵化线结构 id，按格按 tick 记忆化
const getAdjacentSpawnLineIds = (creep: Creep): Id<AnyStoreStructure>[] => {
    if (remoteAdjacentFillCacheTick !== Game.time) {
        remoteAdjacentFillCacheTick = Game.time;
        remoteAdjacentFillCache.clear();
    }

    const key = `${creep.room.name}:${creep.pos.x}:${creep.pos.y}`;
    let ids = remoteAdjacentFillCache.get(key);
    if (!ids) {
        const area = creep.room.lookForAtArea(
            LOOK_STRUCTURES,
            Math.max(0, creep.pos.y - 1),
            Math.max(0, creep.pos.x - 1),
            Math.min(49, creep.pos.y + 1),
            Math.min(49, creep.pos.x + 1),
            true,
        );
        ids = [];
        for (const item of area) {
            const type = item.structure.structureType;
            if (type !== STRUCTURE_EXTENSION && type !== STRUCTURE_SPAWN && type !== STRUCTURE_TOWER) continue;
            ids.push(item.structure.id as Id<AnyStoreStructure>);
        }
        remoteAdjacentFillCache.set(key, ids);
    }
    return ids;
};

// 回程顺路灌注：把身边（range 1）的 ext/spawn/tower 顺手补一手，不阻塞投递主流程
const fillAdjacentSpawnLine = (creep: Creep): boolean => {
    if ((creep.store[RESOURCE_ENERGY] || 0) <= 0) return false;

    for (const id of getAdjacentSpawnLineIds(creep)) {
        const structure = Game.getObjectById(id);
        if (!structure || (structure.store.getFreeCapacity(RESOURCE_ENERGY) || 0) <= 0) continue;
        return creep.transfer(structure, RESOURCE_ENERGY) === OK;
    }
    return false;
};

// 主仓选仓口径：storage 优先承接主仓，
// terminal 仅按止盈水位补线；都不可用时返回 null 走承接链
const resolveCarryDepositTarget = (creep: Creep, carried: ResourceConstant): StructureTerminal | StructureStorage | null => {
    const terminal = creep.room.terminal;
    const storage = creep.room.storage;

    const picked = selectCarryDeposit({
        storageFree: storage ? (storage.store.getFreeCapacity(carried) || 0) : -1,
        terminalEnergy: (terminal?.store[RESOURCE_ENERGY] || 0),
        terminalFree: terminal ? (terminal.store.getFreeCapacity(carried) || 0) : 0,
        storageMinFree: OUT_CARRY_STORAGE_MIN_FREE,
        terminalEnergyLine: OUT_CARRY_TERMINAL_ENERGY_LINE,
    });
    if (picked === 'storage' && storage) return storage;
    if (picked === 'terminal' && terminal) return terminal;
    return null;
};

// 主仓无位时的承接链：能量中枢认领 → 控制器容器 → ext/spawn → 家容器
const resolveChainDeliveryTarget = (creep: Creep, carried: ResourceConstant): AnyStoreStructure | Creep | null => {
    if (carried !== RESOURCE_ENERGY) return null;

    const assigned = getAssignedEnergyTarget(creep);
    if (assigned && (assigned.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > 0) return assigned;

    const containers = creep.room.container || [];
    const controller = creep.room.controller;
    if (controller) {
        const controllerContainer = creep.pos.findClosestByRange(containers.filter(c =>
            c.pos.inRangeTo(controller.pos, 3) &&
            (c.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > 0));
        if (controllerContainer) return controllerContainer;
    }

    const freeSpawnLine = [...(creep.room.extension || []), ...(creep.room.spawn || [])]
        .filter(s => (s.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > OUT_CARRY_SPAWN_LINE_MIN_FREE);
    const spawnLineTarget = creep.pos.findClosestByRange(freeSpawnLine);
    if (spawnLineTarget) return spawnLineTarget;

    const homeContainer = creep.pos.findClosestByRange(containers.filter(c =>
        (c.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > 0));
    if (homeContainer) return homeContainer;

    return null;
};

// 交付目标粘滞：整趟一次选定，只有目标消失/装不下才重选，杜绝逐 tick 重评估的来回横跳
const resolveStickyDeliveryTarget = (creep: Creep, carried: ResourceConstant): AnyStoreStructure | Creep | null => {
    const cache = getOutCarryTargetCache(creep);
    if (cache.targetId) {
        const cached = Game.getObjectById(cache.targetId as Id<AnyStoreStructure | Creep>);
        if (cached && (cached.store.getFreeCapacity(carried) || 0) > 0) return cached;
        delete cache.targetId;
    }

    const fresh = resolveCarryDepositTarget(creep, carried) ?? resolveChainDeliveryTarget(creep, carried);
    if (fresh) cache.targetId = fresh.id;
    return fresh;
};

// 全满兜底：仓库/控制器/房间中心就近落地，交给室内物流消化
const dropCarriedAtFallback = (creep: Creep, carried: ResourceConstant): void => {
    const spot = creep.room.storage?.pos ?? creep.room.controller?.pos ?? creep.room.getCenter();
    if (!spot) return;

    if (creep.pos.inRangeTo(spot, 1)) creep.drop(carried);
    else moveOutCarryTo(creep, spot, { range: 1 });
};

const runOutCarryDeliver = (creep: Creep): void => {
    const sourceRoom = creep.memory.sourceRoom;
    if (!sourceRoom) return;

    if (creep.room.name !== sourceRoom) {
        if (!creep.pos.isRoomEdge() && moveAlongPlannedRoute(creep, sourceRoom)) return;
        moveOutCarryToRoom(creep, sourceRoom, { plainCost: 2, swampCost: 10 });
        return;
    }
    if (creep.pos.isRoomEdge()) {
        moveOutCarryToRoom(creep, sourceRoom, { plainCost: 2, swampCost: 10 });
        return;
    }

    // 回程顺路灌注：倒空则本 tick 结束
    if (fillAdjacentSpawnLine(creep) && creep.store.getUsedCapacity() <= 0) return;

    const carried = Object.keys(creep.store)[0] as ResourceConstant | undefined;
    if (!carried) return;

    const target = resolveStickyDeliveryTarget(creep, carried);
    if (target) {
        if (creep.pos.inRangeTo(target, 1)) {
            if (creep.transfer(target, carried) === ERR_FULL) delete getOutCarryTargetCache(creep).targetId;
        } else {
            moveOutCarryTo(creep, target.pos, { range: 1 });
        }
        return;
    }

    dropCarriedAtFallback(creep, carried);
};

// ==================== 接力 ====================

// 接力交接：相向对穿（BetterMove.isSwapIntent）+ 一空一满 + 等容量的两只搬运工，
// 满载方整仓转给空载方后互换 Memory.creeps 身份——
// 货物单 tick 前进两格，没有任何身体掉头；relayedTick 防同 tick 连环接力。
const tryOutCarryRelayHandoff = (creep: Creep): Creep | null => {
    const memAny = creep.memory as any;
    if (memAny.relayedTick === Game.time) return null;
    // 撤退期不参与接力
    if (memAny.retreat) return null;
    const betterMove = (global as any).BetterMove;
    if (!betterMove?.isSwapIntent) return null;
    const supplying = creep.store.getUsedCapacity() > 0;
    const candidates = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (c: Creep) =>
            c.id !== creep.id &&
            c.memory.role === ROLES.carrier &&
            !(c.memory as any).retreat &&
            (c.memory as any).relayedTick !== Game.time,
    }) as Creep[];
    for (const other of candidates) {
        const otherSupplying = other.store.getUsedCapacity() > 0;
        if (supplying === otherSupplying) continue;
        if (!betterMove.isSwapIntent(creep, other)) continue;
        if (creep.store.getCapacity() !== other.store.getCapacity()) continue;
        const supplier = supplying ? creep : other;
        if ((supplier.ticksToLive ?? 1500) <= 50) continue;
        if (supplier.transfer(other, RESOURCE_ENERGY) !== OK) continue;
        const memA = Memory.creeps[creep.name] as any;
        const memB = Memory.creeps[other.name] as any;
        Memory.creeps[creep.name] = memB;
        Memory.creeps[other.name] = memA;
        memAny.relayedTick = Game.time;
        (other.memory as any).relayedTick = Game.time;
        return other;
    }
    return null;
};

// 接力后同 tick 双侧重跑：交接换身后，双方以新身份重登记本 tick 意图
const runWithRelay = (creep: Creep): void => {
    runModeCycle(creep);
    const partner = tryOutCarryRelayHandoff(creep);
    if (!partner) return;
    runModeCycle(creep);
    runModeCycle(partner);
};

// ==================== 入口 ====================

const runModeCycle = (creep: Creep): void => {
    if (syncOutCarryMode(creep) === OUT_CARRY_STRATEGIES.COLLECT) {
        runOutCarryCollect(creep);
        return;
    }
    runOutCarryDeliver(creep);
};


// 外矿搬运入口：危险撤退优先，之后两态 + 相向接力
const runRemoteOutCarry = (creep: Creep): void => {
    creep.memory.dontPullMe = false;
    const mem = creep.memory as any;

    if (!mem.retreat && isDangerRoomForOutCarry(creep)) mem.retreat = true;
    if (mem.retreat) {
        retreatToHome(creep);
        return;
    }

    runWithRelay(creep);
};

const CarrierRole = {
    run: (creep: Creep) => {
        const mem = creep.memory as any;
        // 外矿工作位：sourceRoom+targetRoom 任务绑定（外矿孵化侧写入）——统一角色按位置参数化
        if (mem.sourceRoom && mem.targetRoom) {
            runRemoteOutCarry(creep);
            return;
        }
        const urgentEnergy = shouldUseUrgentEnergyMode(creep);
        const supplying = (creep.store[RESOURCE_ENERGY] || 0) > 0;

        // 意图格落盘：送货目标（载能）或源线（空载），供相向对穿判定互查
        let toward: { x: number; y: number } | null = null;
        if (supplying) {
            const assigned = resolveDeliveryTarget(creep);
            if (assigned) {
                mem._assign = assigned instanceof Creep ? 'U' : assigned.structureType === STRUCTURE_CONTAINER ? 'C' : assigned.structureType === STRUCTURE_TOWER ? 'T' : 'E';
                toward = assigned.pos;
            }
        } else {
            const source = pickSourceLineByDemand(creep);
            const container = source ? (creep.room.container || []).find((c) => c.pos.inRangeTo(source.pos, 2)) : undefined;
            const drops = source ? source.pos.findInRange(FIND_DROPPED_RESOURCES, 2).filter((r) => r.resourceType === RESOURCE_ENERGY && r.amount > 0) : [];
            toward = drops.length ? creep.pos.findClosestByRange(drops)?.pos : (container && (container.store[RESOURCE_ENERGY] || 0) > 0 ? container.pos : source?.pos ?? null);
        }
        mem._toward = toward;

        // 接力交接优先：意图格 = 送货目标（载能）或源线（空载）
        if (tryRelayHandoff(creep, toward)) return;

        const load = creep.store[RESOURCE_ENERGY] || 0;
        if (load > 0) {
            // 满载纪律：源线还有能量且未取满 → 继续取（半车往返就是「到处乱走」的来源）
            if (load < creep.store.getCapacity(RESOURCE_ENERGY) && carrierSourceLineHasEnergy(creep)) {
                runCarrierFetch(creep);
                return;
            }
            if (runCarrierDeliver(creep, urgentEnergy)) return;
            // 送货途中未送空：继续送货（能量专一，不在半路改取货）
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) return;
        }

        if (runCarrierFetch(creep)) {
            runCarrierDeliver(creep, urgentEnergy);
        }
    },
};

export default CarrierRole;
