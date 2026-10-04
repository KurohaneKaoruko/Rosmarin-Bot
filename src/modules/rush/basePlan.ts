/**
 * 锚点适配器（布局保持本地 autoBuild，零改动）：
 * 从本地房态推导参考口径的 basePlan 锚点——startCoord（主 spawn）、
 * 各 source 的容器位（就近容器/工地，无则取最优邻格）、controller link 位。
 * 供 sourceInfos 引导与升级取能锚点使用；不生成、不下发建筑工地。
 */
import type { RushSourceInfo } from './types';

export type RushBasePlan = {
    startCoord: { x: number; y: number };
    /** sourceId → 容器位坐标（含工地；未落地时为规划锚点） */
    containers: Record<string, { x: number; y: number }>;
    links: { controller?: { x: number; y: number } };
};

const EIGHT = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

/** source 旁的容器锚点：已建/工地容器取最近；都没有时取可站立的相邻格（交付落点） */
const sourceContainerAnchor = (room: Room, source: Source): { x: number; y: number } | undefined => {
    const candidates = room.find(FIND_STRUCTURES, {
        filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER,
    }) as StructureContainer[];

    let best: { x: number; y: number } | undefined;
    let bestRange = Infinity;
    for (const container of candidates) {
        const range = Math.max(Math.abs(container.pos.x - source.pos.x), Math.abs(container.pos.y - source.pos.y));
        if (range <= 2 && range < bestRange) {
            best = { x: container.pos.x, y: container.pos.y };
            bestRange = range;
        }
    }
    if (best) return best;

    const siteCandidates = room.find(FIND_CONSTRUCTION_SITES, {
        filter: (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER,
    }) as ConstructionSite[];
    for (const site of siteCandidates) {
        const range = Math.max(Math.abs(site.pos.x - source.pos.x), Math.abs(site.pos.y - source.pos.y));
        if (range <= 2 && range < bestRange) {
            best = { x: site.pos.x, y: site.pos.y };
            bestRange = range;
        }
    }
    if (best) return best;

    // 兜底锚点：首个非墙相邻格（矿物落地交付点；autoBuild 后续容器落地自动对齐）
    const terrain = Game.map.getRoomTerrain(room.name);
    for (const delta of EIGHT) {
        const x = source.pos.x + delta.x;
        const y = source.pos.y + delta.y;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        return { x, y };
    }
    return undefined;
};

/** 推导 rush 锚点集（每 tick 缓存；无 spawn 的房返回 undefined） */
export const getRushBasePlan = (room: Room): RushBasePlan | undefined => {
    const spawn = room.find(FIND_MY_SPAWNS)[0];

    const containers: Record<string, { x: number; y: number }> = {};
    let missing = false;

    const controllerLink = room.find(FIND_MY_STRUCTURES, {
        filter: (s: Structure) => s.structureType === STRUCTURE_LINK,
    }) as StructureLink[];
    const links: { controller?: { x: number; y: number } } = {};
    if (room.controller) {
        const ctl = controllerLink.find((l) => l.pos.inRangeTo(room.controller!.pos, 2));
        if (ctl) links.controller = { x: ctl.pos.x, y: ctl.pos.y };
    }

    for (const source of room.find(FIND_SOURCES)) {
        const anchor = sourceContainerAnchor(room, source);
        if (!anchor) {
            missing = true;
            break;
        }
        containers[source.id] = anchor;
    }

    if (missing && !spawn) return undefined;

    return {
        startCoord: spawn ? { x: spawn.pos.x, y: spawn.pos.y } : { x: 25, y: 25 },
        containers,
        links,
    };
};

/** source 周围可站立邻格数（工作位口径：非墙即计） */
export const getSourceNumOpen = (room: Room, source: Source): number => {
    const terrain = Game.map.getRoomTerrain(room.name);
    let open = 0;
    for (const delta of EIGHT) {
        const x = source.pos.x + delta.x;
        const y = source.pos.y + delta.y;
        if (x < 0 || x > 49 || y < 0 || y > 49) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        open++;
    }
    return open;
};

export type { RushSourceInfo };
