/**
 * controller 容器（cc）生命周期：RCL2 起尝试放置、唯一 cc 口径（旁最多一个，低耐久走维修不放假胎）、
 * 升级线换 link 后销毁；容器 id 登记到房间堆（物流/升级取能的锚点）。
 * 放置选址沿用本地评分口径（相邻可升级站位×4 − 距 spawn），每 150t 例行调用。
 */
import { getRushRoomHeap } from './roomState';

/** cc 判定半径（controller 旁 3 格） */
const CC_RANGE = 3;

const inRange3 = (controller: StructureController, x: number, y: number): boolean =>
    Math.max(Math.abs(x - controller.pos.x), Math.abs(y - controller.pos.y)) <= CC_RANGE;

/**
 * cc 生命周期主入口（rush 房每 150t 调用）。
 * 链接期（RCL5+ 且 controller 旁有 link）：升级供给已切 link，销毁 cc 收尾；
 * 否则：无容器无工地时按评分放置，已有容器登记堆 id。
 */
export const manageControllerContainer = (room: Room): void => {
    const controller = room.controller;
    if (!controller?.my) return;
    const rcl = controller.level;
    if (rcl < 2) return;
    // 无源房短路：cc 服务升级线补给，无产出源不需要
    if (!((room as any).source || []).length) return;

    const heap = getRushRoomHeap(room.name);

    const existingContainers = room.find(FIND_STRUCTURES, {
        filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER && s.pos.inRangeTo(controller.pos, CC_RANGE),
    }) as StructureContainer[];

    // 链接期：升级供能切 link，销毁 cc（同点位让位口径的功能等价：供给链切换即收尾）
    if (rcl >= 5 && ((room as any).link || []).some((l: StructureLink) => l.pos.inRangeTo(controller.pos, CC_RANGE))) {
        for (const container of existingContainers) {
            container.destroy();
        }
        delete heap.controllerContainerId;
        return;
    }

    // 唯一 cc 口径：已有容器 → 登记后收尾（低耐久走维修既有链路）
    if (existingContainers.length > 0) {
        heap.controllerContainerId = existingContainers[0].id;
        return;
    }

    const hasSite = room
        .find(FIND_MY_CONSTRUCTION_SITES, {
            filter: (s: ConstructionSite) =>
                s.structureType === STRUCTURE_CONTAINER && s.pos.inRangeTo(controller.pos, CC_RANGE),
        })
        .some((site) => {
            heap.controllerContainerId = `site:${site.id}`;
            return true;
        });
    if (hasSite) return;

    // 选址：相邻可升级站位数×4 − 距 spawn 距离
    const terrain = room.getTerrain();
    const spawn = ((room as any).spawn || [])[0] as StructureSpawn | undefined;
    const occupied = new Set<string>();
    for (const s of room.find(FIND_STRUCTURES)) occupied.add(`${s.pos.x},${s.pos.y}`);
    for (const s of room.find(FIND_CONSTRUCTION_SITES)) occupied.add(`${s.pos.x},${s.pos.y}`);

    const standable = (x: number, y: number): boolean =>
        x >= 1 &&
        x <= 48 &&
        y >= 1 &&
        y <= 48 &&
        !occupied.has(`${x},${y}`) &&
        terrain.get(x, y) !== TERRAIN_MASK_WALL &&
        inRange3(controller, x, y);

    const spotScore = (x: number, y: number): number => {
        let open = 0;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                if (ox === 0 && oy === 0) continue;
                if (standable(x + ox, y + oy)) open++;
            }
        }
        return open * 4 - (spawn ? Math.max(Math.abs(x - spawn.pos.x), Math.abs(y - spawn.pos.y)) : 0);
    };

    let best: { x: number; y: number; score: number } | undefined;
    for (let dx = -CC_RANGE; dx <= CC_RANGE; dx++) {
        for (let dy = -CC_RANGE; dy <= CC_RANGE; dy++) {
            const x = controller.pos.x + dx;
            const y = controller.pos.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
            if (occupied.has(`${x},${y}`)) continue;
            const score = spotScore(x, y);
            if (!best || score > best.score) best = { x, y, score };
        }
    }

    if (best) {
        room.createConstructionSite(best.x, best.y, STRUCTURE_CONTAINER);
    }
};
