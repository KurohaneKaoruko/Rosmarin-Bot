import { isSpecialRushActive } from '@/shared/roomMode';
import { getLayoutData } from '@/shared/memory';
import { decompressBatch } from '@/shared/compress';

function directionTo(from: RoomPosition, to: RoomPosition): DirectionConstant {
    const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
    if (dx === 0 && dy === -1) return TOP;
    if (dx === 1 && dy === -1) return TOP_RIGHT;
    if (dx === 1 && dy === 0) return RIGHT;
    if (dx === 1 && dy === 1) return BOTTOM_RIGHT;
    if (dx === 0 && dy === 1) return BOTTOM;
    if (dx === -1 && dy === 1) return BOTTOM_LEFT;
    if (dx === -1 && dy === 0) return LEFT;
    return TOP_LEFT;
}

// 快递爬空载且 spawn 断供时的放弃等待
const COURIER_IDLE_GIVE_UP_TICKS = 60;
// upgrader「能量不够消耗」的判定线：当前存量按 WORK 吞吐折算 < 150 tick
const UPGRADER_HUNGRY_TICKS = 150;

/**
 * 自爆拉能快递（rush 特殊子模式 / mini 迷你房，总闸见 shared/roomMode.isSpecialRushActive）。
 *
 * spawn 盈余时孵纯 CARRY 快递爬，取满后自爆，墓碑能量落在升级圈里给 upgrader 就近拾取——
 * 把 spawn 的盈余能量转运到升级端。发车闸门：
 * ① 防御态不发车；② spawn 忙碌或孵化队列有积压不发车；③ 控制器旁有在工作且快断能的
 * upgrader 才发车；④ spawn 满仓才发车；⑤ 总能量在运作线（60%）之上。
 *
 * 注：source 旁 ring-2 ext 的建造权已移交布局模块——
 * 见 layoutPlanner.plannerCreateSite 的「特殊冲级优先落位」。
 */
export function rushBoost(room: Room): void {
    if (!isSpecialRushActive(room)) return;
    const spawn = room.find(FIND_MY_SPAWNS)[0]!;
    dispatchRushCourier(room, spawn);
}

/** 发车决策：已有快递爬则驱动其取能/自爆，否则过闸门孵化新的 */
function dispatchRushCourier(room: Room, spawn: StructureSpawn): void {
    // 闸门①：防御态（紧急状态）不发车
    if (room.memory.defend) return;

    const courier = room.find(FIND_MY_CREEPS, { filter: c => c.memory.role === 'rush-courier' })[0];
    if (courier) {
        driveRushCourier(courier, spawn);
        return;
    }

    // 闸门②：spawn 忙碌 / 孵化队列有积压时不发车——快递绝不挤占基础孵化
    if (spawn.spawning) return;
    const pendingMissions = Object.values((room as any).getSpawnMissionNum?.() || {}) as number[];
    if (pendingMissions.reduce((a, b) => a + b, 0) > 0) return;

    // 闸门③：控制器旁有在工作且快断能的 upgrader 才发车（墓碑能量要有紧急消费者）
    const controller = room.controller!;
    const hasHungryUpgrader = room.find(FIND_MY_CREEPS, { filter: c => {
        if (c.memory.role !== 'upgrader' && c.memory.role !== 'up-upgrade') return false;
        if (c.pos.getRangeTo(controller.pos) > 4) return false;
        const work = c.getActiveBodyparts(WORK);
        if (work <= 0) return false;
        return c.store[RESOURCE_ENERGY] / work < UPGRADER_HUNGRY_TICKS;
    } }).length > 0;
    if (!hasHungryUpgrader) return;

    // 闸门④：spawn 满仓（真正盈余）才发车，只抽超出 150 底仓的部分
    if (spawn.store[RESOURCE_ENERGY] < spawn.store.getCapacity(RESOURCE_ENERGY)) return;

    // 闸门⑤：总能量运作线——抽完后房间总能量仍保有容量的 60%，基础孵化永不断档
    const opFloor = room.energyCapacityAvailable * 0.6;
    if (room.energyAvailable <= opFloor) return;

    const body: BodyPartConstant[] = [];
    let cost = 0;
    const budget = Math.min(spawn.store[RESOURCE_ENERGY] - 150, room.energyAvailable - opFloor);
    while (cost + BODYPART_COST[CARRY] <= budget) { body.push(CARRY); cost += BODYPART_COST[CARRY]; }
    if (body.length === 0) return;

    // 出生后朝控制器旁 container 方向跨出，让墓碑尽量落在 container 上（能量就近可收）
    const container = room.container?.find(c => c.pos.inRangeTo(controller.pos, 2));
    const dir = directionTo(spawn.pos, container ? container.pos : controller.pos);
    spawn.spawnCreep(body, 'rc' + Game.time, {
        memory: { role: 'rush-courier', home: room.name } as CreepMemory,
        directions: [dir],
    });
}

/** 快递爬的逐 tick 驱动：取满自爆；断供时带货就地交付，空载限时等待 */
function driveRushCourier(courier: Creep, spawn: StructureSpawn): void {
    const mem = courier.memory as unknown as Record<string, unknown>;

    if (courier.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (courier.withdraw(spawn, RESOURCE_ENERGY) === OK) {
            delete mem.waitStart;
            return;
        }
        // spawn 断供：身上有货就地交付（半载也值回票价）；空载免费等一会儿再放弃
        if (courier.store[RESOURCE_ENERGY] > 0) {
            courier.suicide();
            return;
        }
        if (!mem.waitStart) mem.waitStart = Game.time;
        if (Game.time - (mem.waitStart as number) > COURIER_IDLE_GIVE_UP_TICKS) courier.suicide();
        return;
    }

    // 满载：就地自爆，墓碑能量留给旁的 upgrader
    courier.suicide();
}

/**
 * spawn 错位重建（所有模式）：初始 spawn 不在布局点位时，（所有模式）：初始 spawn 不在布局点位时，
 * 建完第二个 spawn 后自动拆除旧 spawn、在布局位重建新 spawn。
 */
export function relocateOldSpawn(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length < 2) return;
    const layoutMemory = getLayoutData(room.name) as Record<string, number[]> | undefined;
    if (!layoutMemory) return;
    const packed = layoutMemory['spawn'];
    if (!packed || packed.length === 0) return;
    const spots = ((decompressBatch(packed) ?? []) as [number, number][]).map(p => ({ x: p[0], y: p[1] }));
    const onPlan = (pos: RoomPosition) => spots.some(p => p.x === pos.x && p.y === pos.y);
    const old = spawns.find(s => !onPlan(s.pos));
    if (!old) return;
    const freeSpot = spots.find(p => !spawns.some(s => s.pos.x === p.x && s.pos.y === p.y));
    if (!freeSpot) return;
    if (room.createConstructionSite(freeSpot.x, freeSpot.y, STRUCTURE_SPAWN) === OK) old.destroy();
}
