// 家内能量搬运（参考实现 hauler 口径的整体移植）：
// 一只搬运工绑定一条源线，空载回我方容器取满（满载纪律：容器不足一车则在容器旁
// 捡散落并等待，不四处找货），满载按能量中枢的请求配送（spawn/ext/tower/cc/断供升级工，
// 两阶段匹配 + 专线回流）。无请求时持能原地待命——搬运工永远在两点之间，不自主游荡。
import { ROLES } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getAssignedEnergyTarget } from '@/modules/shared/energyLogistics';

// 源旁掉落捡取的最低数量：避免为个位数能量反复蹲点
const SOURCE_DROP_PICKUP_MIN = 30;

/** 源线待运量：容器存量 + 源旁 2 格掉落（需求驱动的选线依据） */
const sourceLinePending = (room: Room, source: Source): number => {
    const container = (room.container || []).find((c) => c.pos.inRangeTo(source.pos, 2));
    const drops = source.pos.findInRange(FIND_DROPPED_RESOURCES, 2)
        .filter((r) => r.resourceType === RESOURCE_ENERGY);
    return (container?.store[RESOURCE_ENERGY] || 0) + drops.reduce((sum, r) => sum + r.amount, 0);
};

/** 选线（需求驱动，参考实现 matchHaulers 口径）：按待运量取最大者，同量就近。
 *  空载起手重选并锁定至取满；锁定线中途干涸则按待运量转场——
 *  旧「名字 hash 永久绑线」在批量孵化的名字序列上 hash 相关，整批同线，
 *  另一源容器/掉落无人搬、能量烂地。 */
const pickSourceLineByDemand = (creep: Creep): Source | null => {
    const mem = creep.memory as any;
    if (mem._loadLineId) {
        const locked = Game.getObjectById(mem._loadLineId as Id<Source>) as Source | null;
        if (locked && sourceLinePending(creep.room, locked) > 0) return locked;
        mem._loadLineId = null;
    }
    const sources = (creep.room.source || []) as Source[];
    if (sources.length === 0) return null;
    if (sources.length === 1) return sources[0];
    let best: Source | null = null;
    let bestPending = -1;
    for (const source of sources) {
        const pending = sourceLinePending(creep.room, source);
        const closer = pending === bestPending && best !== null
            && creep.pos.getRangeTo(source.pos) < creep.pos.getRangeTo(best.pos);
        if (pending > bestPending || closer) {
            best = source;
            bestPending = pending;
        }
    }
    if (best) mem._loadLineId = best.id;
    return best;
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

// 顺路灌注：身边 ext/spawn（urgent 加 tower/powerSpawn）顺手补满（参考实现途经填充口径）
const fillAdjacentSpawnStructures = (creep: Creep, urgentEnergy: boolean): boolean => {
    if ((creep.store[RESOURCE_ENERGY] || 0) <= 0) return false;
    const targets = [
        ...(creep.room.extension || []),
        ...(creep.room.spawn || []),
        ...(urgentEnergy ? (creep.room.tower || []) : []),
    ] as AnyStoreStructure[];
    for (const struct of targets) {
        if (creep.pos.inRangeTo(struct, 1) && (struct.store.getFreeCapacity(RESOURCE_ENERGY) || 0) > 0) {
            if (creep.transfer(struct, RESOURCE_ENERGY) === OK) return true;
        }
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

/** 源线取货（导出供测试）：返回 true = 已满转送货 */
export const runCarrierFetch = (creep: Creep): boolean => {
    const mem = creep.memory as any;
    // 空载起手清锁：按待运量重新选线（取货中途锁定不换线，满载纪律防游走）
    if ((creep.store[RESOURCE_ENERGY] || 0) === 0) mem._loadLineId = null;
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
    // 持有非能量资源：就地丢掉（能量专线不捎带杂物，参考实现 returnAll 口径）
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

    // 中央匹配请求（spawn/ext/tower/cc/断供升级工，两阶段专线保护）
    const assigned = getAssignedEnergyTarget(creep) as AnyStoreStructure | Creep | null;
    // 分配结果可视化：U=断供升级工 C=控制器容器 E=孵化线 T=塔 无=全满待命
    (creep.memory as any)._assign = assigned
        ? (assigned instanceof Creep ? 'U' : assigned.structureType === STRUCTURE_CONTAINER ? 'C' : assigned.structureType === STRUCTURE_TOWER ? 'T' : 'E')
        : null;
    if (assigned) {
        if (creep.pos.inRangeTo(assigned, 1)) {
            const free = assigned.store.getFreeCapacity(RESOURCE_ENERGY);
            if (free <= 0) return false; // 目标已满：本 tick 站定，下 tick 重匹配
            creep.transfer(assigned, RESOURCE_ENERGY);
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

// 接力开关（参考实现 shouldRelay 口径）：lv<7 恒接力，lv7+ 直运
const shouldRelayRoom = (room: Room): boolean => room.controller !== undefined && room.controller.level < 7;

// 意图坐标（参考实现 trafficManager.getIntendedCoord 的等价口径）：
// 本 tick 朝目标方向要踏入的相邻格
const intendedCoordOf = (creep: Creep, toward: { x: number; y: number }): { x: number; y: number } => {
    const dx = Math.sign(toward.x - creep.pos.x);
    const dy = Math.sign(toward.y - creep.pos.y);
    return { x: creep.pos.x + dx, y: creep.pos.y + dy };
};

// 接力交接（参考实现 getRelayTarget 整体移植）：
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

    // 途中拾取：空车意图格上的墓碑/掉落顺手收（参考实现 904-917 口径）
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
    if (supplying === otherSupplying) {
        // 双空：矿工占位 pull 已处理，其余无意义
        return false;
    }

    // 相向对穿判定：对方意图格 = 我的当前位置（正面对穿，参考实现 939-942 口径）
    const otherToward = otherSupplying
        ? ((otherMem._toward as { x: number; y: number } | undefined) ?? null)
        : pickSourceLineByDemand(other)?.pos ?? null;
    if (!otherToward) return false;
    const otherCoord = intendedCoordOf(other, otherToward);
    if (otherCoord.x !== creep.pos.x || otherCoord.y !== creep.pos.y) return false;

    // 容量相等才能对穿换向；供方 TTL>50 才做半程交接
    if (other.store.getCapacity(RESOURCE_ENERGY) !== creep.store.getCapacity(RESOURCE_ENERGY)) return false;
    const supplier = supplying ? creep : other;
    if ((supplier.ticksToLive || 1500) <= 50) return false;
    const fetcher = supplying ? other : creep;
    if (supplier.transfer(fetcher, RESOURCE_ENERGY) === OK) {
        mem._relayed = Game.time;
        (otherMem as any)._relayed = Game.time;
        return true;
    }
    return false;
};

const CarrierRole = {
    run: (creep: Creep) => {
        const urgentEnergy = shouldUseUrgentEnergyMode(creep);
        const mem = creep.memory as any;
        const supplying = (creep.store[RESOURCE_ENERGY] || 0) > 0;

        // 意图格落盘：送货目标（载能）或源线（空载），供相向对穿判定互查
        let toward: { x: number; y: number } | null = null;
        if (supplying) {
            const assigned = getAssignedEnergyTarget(creep) as AnyStoreStructure | Creep | null;
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
