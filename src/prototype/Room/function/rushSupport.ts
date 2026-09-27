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

/**
 * rush 冲级辅助（spawn 位于控制器 3 格内时）：
 * ① source 附近补 1-2 个 extension 工地——采集工直接填能量，省掉跑 spawn 的往返；
 * ② 自爆拉能快递：spawn 满仓时孵 CARRY 快递员，从 spawn 取能后自爆，
 *    墓碑能量落在控制器旁给 upgrader 就近拾取——把 spawn 的盈余能量转运到升级端。
 *
 * 发车闸门（房间运作是最基本的底线）：
 * ① 防御态/紧急状态不发车；② spawn 忙碌（基础孵化占用中）不发车；
 * ③ 控制器旁无工作 upgrader 不发车；④ spawn 满仓才发车；⑤ 总能量在运作线（60%）之上。
 * 房内有 link 后整个机制自动停止（正规供能链接管）。
 */
export function rushBoost(room: Room): void {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || !room.controller?.my) return;
    if (spawn.pos.getRangeTo(room.controller.pos) > 3) return;

    // ── ② 自爆拉能快递 ──
    const hasLink = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0;
    if (!hasLink) {
        // 闸门①：防御态（紧急状态）不发车
        if (room.memory.defend) return;
        // 闸门②：spawn 忙碌（基础孵化占用中）不发车
        if (spawn.spawning) return;

        const courier = room.find(FIND_MY_CREEPS, { filter: c => c.memory.role === 'rush-courier' })[0];
        if (courier) {
            if (courier.spawning) return;
            // 还有空位：继续从 spawn 取能（出生格就贴着 spawn，无需移动）
            if (courier.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                if (courier.withdraw(spawn, RESOURCE_ENERGY) === OK) return;
            }
            // 取满（或 spawn 没能量可给）：就地自爆，墓碑能量给旁的 upgrader
            courier.suicide();
            return;
        }

        // 闸门③：墓碑能量必须有消费者——控制器旁有在工作/待命的 upgrader 才发车
        const hasConsumer = room.find(FIND_MY_CREEPS, { filter: c =>
            c.memory.role === 'upgrader' && !c.spawning && c.pos.getRangeTo(room.controller.pos) <= 4
        }).length > 0;
        if (!hasConsumer) return;

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
        const dir = directionTo(spawn.pos, room.controller.pos);
        spawn.spawnCreep(body, 'rc' + Game.time, { memory: { role: 'rush-courier' }, directions: [dir] });
        return;
    }

    // ── ① source 附近补 extension 工地（全房最多 2 个未完工的）──
    const extSites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_EXTENSION });
    if (extSites.length >= 2) return;
    let placed = 0;
    for (const source of room.find(FIND_SOURCES)) {
        for (let dx = -2; dx <= 2 && placed < 2 - extSites.length; dx++) {
            for (let dy = -2; dy <= 2 && placed < 2 - extSites.length; dy++) {
                const x = source.pos.x + dx, y = source.pos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                const pos = new RoomPosition(x, y, room.name);
                if (pos.getRangeTo(source.pos) < 2) continue;
                if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) continue;
                if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) continue;
                if (pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType !== STRUCTURE_ROAD)) continue;
                if (room.createConstructionSite(x, y, STRUCTURE_EXTENSION) === OK) placed++;
            }
        }
    }
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
