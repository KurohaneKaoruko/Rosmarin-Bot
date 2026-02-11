import { log } from '@/utils';
import { compress, compressBatch, decompress } from '@/modules/utils/compress';
import LayoutVisual from '@/modules/feature/planner/layoutVisual';
import { autoPlanner } from '@/modules/feature/planner/dynamic/autoPlanner';
import { autoPlanner63 } from '@/modules/feature/planner/dynamic/63Planner';
import * as StaticPlanner from '@/modules/feature/planner/static';
import { getLayoutData, getRoomData } from '@/modules/utils/memory';

/**
 * 布局计算与可视化/落盘的通用模块
 * - 静态布局：根据 layoutType + center 生成结构点位，并自动连接道路（中心到 source/mineral/controller）
 * - 动态布局(auto/63auto)：复用对应 dynamic planner 的输出结构点位
 * - 缓存：同一 tick 段内“先可视化再构建”会复用计算结果，避免重复寻路/计算
 */
/**
 * 房间内的坐标对。
 * @public
 */
type XY = [number, number];

/**
 * 布局结构点位映射：structureType -> 坐标列表。
 * @public
 */
type LayoutStructMap = {
    [structureType: string]: XY[];
};

/**
 * 布局写入 Memory 的压缩格式：structureType -> 压缩后的 number[]。
 * @public
 */
type LayoutMemoryMap = {
    [structureType: string]: number[];
};

/**
 * 布局中心点（房间坐标）。
 * @public
 */
type LayoutCenter = { x: number; y: number };

/**
 * 一次布局计算结果（用于缓存/可视化/落盘）。
 * @public
 */
type CachedLayout = {
    key: string;
    roomName: string;
    layoutType: string;
    center: LayoutCenter;
    createdAt: number;
    expiresAt: number;
    structMap: LayoutStructMap;
    layoutMemory: LayoutMemoryMap;
};

/** 缓存有效期（tick） */
const CACHE_TTL = 50;

/**
 * 动态规划器（auto/63auto）computeManor 的可能返回结构（兼容不同版本）。
 * @internal
 */
type DynamicPlannerRawResult = {
    roomName?: string
    structMap?: LayoutStructMap
    centerPos?: { x: number; y: number }
    labPos?: { labX: number; labY: number }
    storageStructPos?: { x: number; y: number }
}

/**
 * 归一化动态规划器输出，提供统一的 center 与 structMap，避免调用方依赖具体 planner 版本。
 * @param roomName 房间名
 * @param layoutType 布局类型（auto / 63auto）
 * @param raw planner 原始返回
 * @returns 归一化后的结果；失败时返回 null（并输出日志）
 * @internal
 */
function normalizeDynamicPlannerResult(roomName: string, layoutType: string, raw: any): { center: LayoutCenter; structMap: LayoutStructMap } | null {
    if (!raw) {
        log('LayoutPlanner', `动态布局失败: ${roomName} ${layoutType} planner 返回空`);
        return null;
    }
    const data = raw as DynamicPlannerRawResult;
    const centerPos = data.centerPos ? { x: data.centerPos.x, y: data.centerPos.y } : null;

    if (!centerPos) {
        log('LayoutPlanner', `动态布局失败: ${roomName} ${layoutType} 缺少 centerPos`);
        return null;
    }
    if (!data.structMap) {
        log('LayoutPlanner', `动态布局失败: ${roomName} ${layoutType} 缺少 structMap`);
        return null;
    }
    return { center: centerPos, structMap: data.structMap };
}

/**
 * 根据房间等级（RCL）过滤某些结构类型的点位列表。
 * - road：低 RCL 限制道路数量（兼容部分静态布局的“分阶段修路”策略）
 * - rampart：低 RCL 不建 rampart
 * @param room 房间对象
 * @param structureType 结构类型
 * @param layoutArray 压缩点位数组（decompress 后为 XY）
 * @returns 对应 RCL 允许建造的点位子集（仍为压缩格式 number[]）
 * @internal
 */
function getLayoutPointsForRcl(room: Room, structureType: string, layoutArray: number[]): number[] {
    if (structureType === STRUCTURE_ROAD) {
        if (room.level < 3) return [];
        const layoutType = getRoomData()?.[room.name]?.layout;
        switch (layoutType) {
            case 'tea':
                if (room.level == 3) return layoutArray.slice(0, 11);
                if (room.level == 4) return layoutArray.slice(0, 24);
                if (room.level == 5) return layoutArray.slice(0, 37);
                break;
            case 'hoho':
                if (room.level == 3) return layoutArray.slice(0, 7);
                if (room.level == 4) return layoutArray.slice(0, 13);
                if (room.level == 5) return layoutArray.slice(0, 21);
                break;
            default:
                break;
        }
        return layoutArray;
    }
    if (structureType === STRUCTURE_RAMPART) {
        if (room.level < 4) return [];
    }
    return layoutArray;
}

/**
 * 判断某个位置是否应跳过创建工地（用于避免把工地压在不允许覆盖的结构上）。
 * @param room 房间对象
 * @param structureType 目标建造结构类型
 * @param lookStruct 该位置已有结构列表
 * @param pos 房间坐标
 * @returns true 表示跳过；false 表示允许尝试创建工地
 * @internal
 */
function shouldSkipBuildAtPos(
    room: Room,
    structureType: string,
    lookStruct: Structure<StructureConstant>[],
    pos: RoomPosition
): boolean {
    switch (structureType) {
        case STRUCTURE_RAMPART:
            if (!lookStruct.length) return false;
            if (lookStruct.some(o => o.structureType == STRUCTURE_RAMPART || o.structureType == STRUCTURE_WALL)) return true;
            break;
        case STRUCTURE_ROAD:
            if (!lookStruct.length) return false;
            if (lookStruct.some(o => o.structureType != STRUCTURE_RAMPART && o.structureType != STRUCTURE_CONTAINER)) return true;
            break;
        case STRUCTURE_CONTAINER:
            if (lookStruct.length && lookStruct.some(o => o.structureType != STRUCTURE_RAMPART && o.structureType != STRUCTURE_ROAD))
                return true;
            if (room.level <= 7) return false;
            if (pos.inRangeTo(room.controller, 2)) return true;
            break;
        default:
            if (!lookStruct.length) return false;
            if (lookStruct.some(o => o.structureType != STRUCTURE_RAMPART && o.structureType != STRUCTURE_ROAD)) return true;
            break;
    }
    return false;
}

/**
 * 获取 LayoutPlanner 的进程内缓存容器（存放在 global 上）。
 * @returns 缓存对象（byKey/lastKeyByRoomLayout/byDynamicSig）
 * @internal
 */
function getCacheStore(): { byKey: { [key: string]: CachedLayout }; lastKeyByRoomLayout: { [key: string]: string }; byDynamicSig: { [key: string]: string } } {
    const g = global as any;
    if (!g.__layoutPlannerCache) {
        g.__layoutPlannerCache = { byKey: {}, lastKeyByRoomLayout: {}, byDynamicSig: {} };
    }
    return g.__layoutPlannerCache;
}

/**
 * 生成静态布局缓存 key。
 * @param roomName 房间名
 * @param layoutType 布局类型
 * @param center 布局中心点
 * @returns 缓存 key
 * @internal
 */
function makeCacheKey(roomName: string, layoutType: string, center: LayoutCenter): string {
    return `${roomName}:${layoutType}:${center.x}:${center.y}`;
}

/**
 * 生成动态布局“输入签名”缓存 key。
 * @param roomName 房间名
 * @param layoutType 布局类型（auto / 63auto）
 * @param pointsSig controller/mineral/source 坐标签名
 * @param fixedCenter 固定中心（来自旗帜/外部指定）
 * @returns 输入签名 key
 * @internal
 */
function makeDynamicSigKey(
    roomName: string,
    layoutType: string,
    pointsSig: string,
    fixedCenter: LayoutCenter | null
): string {
    const c = fixedCenter ? `${fixedCenter.x},${fixedCenter.y}` : '-';
    return `${roomName}:${layoutType}:sig:${c}:${pointsSig}`;
}

/**
 * 深拷贝 structMap，避免外部修改污染缓存。
 * @param structMap 结构点位映射
 * @returns 深拷贝后的映射
 * @internal
 */
function cloneStructMap(structMap: LayoutStructMap): LayoutStructMap {
    const next: LayoutStructMap = {};
    for (const s in structMap) next[s] = structMap[s].map((p) => [p[0], p[1]]);
    return next;
}

/**
 * 深拷贝 layoutMemory，避免外部修改污染缓存。
 * @param layoutMemory 压缩点位映射
 * @returns 深拷贝后的映射
 * @internal
 */
function cloneLayoutMemory(layoutMemory: LayoutMemoryMap): LayoutMemoryMap {
    const next: LayoutMemoryMap = {};
    for (const s in layoutMemory) next[s] = layoutMemory[s].slice();
    return next;
}

/**
 * 按参数精确命中缓存（用于静态布局）。
 * @param roomName 房间名
 * @param layoutType 静态模板名
 * @param center 中心点
 * @returns 命中则返回缓存条目，否则返回 null
 * @internal
 */
function getCachedLayout(roomName: string, layoutType: string, center: LayoutCenter): CachedLayout | null {
    const store = getCacheStore();
    const key = makeCacheKey(roomName, layoutType, center);
    const cached = store.byKey[key];
    if (!cached) return null;
    if (cached.expiresAt < Game.time) {
        delete store.byKey[key];
        return null;
    }
    return cached;
}

/**
 * 写入缓存，并记录 room+layoutType 的最新 key；动态布局时可额外记录输入签名映射。
 * @param entry 缓存条目
 * @param options 可选：动态签名 key
 * @internal
 */
function setCachedLayout(entry: Omit<CachedLayout, 'createdAt' | 'expiresAt'>, options?: { dynamicSigKey?: string }): void {
    const store = getCacheStore();
    const cached: CachedLayout = { ...entry, createdAt: Game.time, expiresAt: Game.time + CACHE_TTL };
    store.byKey[entry.key] = cached;
    store.lastKeyByRoomLayout[`${entry.roomName}:${entry.layoutType}`] = entry.key;
    if (options?.dynamicSigKey) store.byDynamicSig[options.dynamicSigKey] = entry.key;
}

/**
 * 动态布局复用“最近一次”缓存（典型场景：先 visual 再 build）。
 * @param roomName 房间名
 * @param layoutType 动态布局类型（auto / 63auto）
 * @returns 命中则返回缓存条目，否则返回 null
 * @internal
 */
function getLastCachedByRoomLayout(roomName: string, layoutType: string): CachedLayout | null {
    const store = getCacheStore();
    const lastKey = store.lastKeyByRoomLayout[`${roomName}:${layoutType}`];
    if (!lastKey) return null;
    const cached = store.byKey[lastKey];
    if (!cached) return null;
    if (cached.expiresAt < Game.time) {
        delete store.byKey[lastKey];
        delete store.lastKeyByRoomLayout[`${roomName}:${layoutType}`];
        return null;
    }
    return cached;
}

/**
 * 动态布局按输入签名命中缓存（适合重复预览/批量 build）。
 * @param sigKey 输入签名 key
 * @returns 命中则返回缓存条目，否则返回 null
 * @internal
 */
function getCachedDynamicBySig(sigKey: string): CachedLayout | null {
    const store = getCacheStore();
    const key = store.byDynamicSig[sigKey];
    if (!key) return null;
    const cached = store.byKey[key];
    if (!cached) {
        delete store.byDynamicSig[sigKey];
        return null;
    }
    if (cached.expiresAt < Game.time) {
        delete store.byKey[key];
        delete store.byDynamicSig[sigKey];
        return null;
    }
    return cached;
}

/**
 * 解析布局中心点。
 * - 优先使用 Memory.RosmarinBot.RoomData[roomName].center\n
 * - 其次使用 storagePos/centerPos 旗帜\n
 * @param roomName 房间名
 * @returns 中心点；缺失返回 null
 * @internal
 */
function resolveCenter(roomName: string): LayoutCenter | null {
    const BotMemRooms = getRoomData();
    let center = BotMemRooms?.[roomName]?.center as LayoutCenter | undefined;
    const PosFlag = Game.flags.storagePos || Game.flags.centerPos;
    if (PosFlag && PosFlag.pos.roomName === roomName) {
        center = { x: PosFlag.pos.x, y: PosFlag.pos.y };
    }
    return center || null;
}

/**
 * 从静态布局模板初始化 structMap 结构。
 * @param layoutType 静态模板名（StaticPlanner 上的 key）
 * @returns 模板数据与初始化后的 structMap；不存在返回 null
 * @internal
 */
function initStructMapFromStaticTemplate(layoutType: string): { data: any; structMap: LayoutStructMap } | null {
    const data = (StaticPlanner as any)[layoutType];
    if (!data) return null;
    const structMap: LayoutStructMap = {};
    for (const s in data.buildings) structMap[s] = [];
    if (!structMap.road) structMap.road = [];
    if (!structMap.container) structMap.container = [];
    if (!structMap.link) structMap.link = [];
    if (!structMap.rampart) structMap.rampart = [];
    return { data, structMap };
}

/**
 * 将静态模板按 center 平移到房间坐标，并过滤墙体/越界。
 * @param roomName 房间名
 * @param layoutType 静态模板名
 * @param center 布局中心点
 * @returns 结构点位与边界盒；失败返回 null
 * @internal
 */
function applyStaticBuildings(roomName: string, layoutType: string, center: LayoutCenter): { structMap: LayoutStructMap; minX: number; maxX: number; minY: number; maxY: number } | null {
    const init = initStructMapFromStaticTemplate(layoutType);
    if (!init) return null;
    const { data, structMap } = init;
    const terrain = new Room.Terrain(roomName);

    let minX = 49;
    let maxX = 0;
    let minY = 49;
    let maxY = 0;

    for (const s in data.buildings) {
        const poss = data.buildings[s];
        if (!structMap[s]) structMap[s] = [];
        for (const pos of poss) {
            const x = center.x + pos.x;
            const y = center.y + pos.y;
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            if (terrain.get(x, y) == TERRAIN_MASK_WALL) continue;
            structMap[s].push([x, y]);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }

    return { structMap, minX, maxX, minY, maxY };
}

/**
 * 静态布局的 rampart 外圈（用于预览/构建保持一致）。
 * @param roomName 房间名
 * @param structMap 结构点位映射（会被原地修改）
 * @param bounds 静态模板边界盒
 * @internal
 */
function addStaticRampartRing(roomName: string, structMap: LayoutStructMap, bounds: { minX: number; maxX: number; minY: number; maxY: number }): void {
    const terrain = new Room.Terrain(roomName);
    let minX = bounds.minX - 3;
    let maxX = bounds.maxX + 3;
    let minY = bounds.minY - 3;
    let maxY = bounds.maxY + 3;

    if (!structMap.rampart) structMap.rampart = [];
    for (let i = minX; i <= maxX; i++) {
        for (let j = minY; j <= maxY; j++) {
            if ([0, 1, 48, 49].includes(i)) continue;
            if ([0, 1, 48, 49].includes(j)) continue;
            if (terrain.get(i, j) == TERRAIN_MASK_WALL) continue;
            if (i == minX || i == maxX || j == minY || j == maxY) {
                structMap.rampart.push([i, j]);
            }
        }
    }
}

/**
 * 将房间坐标编码成稳定 key。
 * @param x x
 * @param y y
 * @returns 形如 \"x:y\" 的字符串 key
 * @internal
 */
function xyKey(x: number, y: number): string {
    return `${x}:${y}`;
}

/**
 * 计算 Chebyshev 距离（max(|dx|,|dy|)）。
 * @param a 坐标 a
 * @param b 坐标 b
 * @returns Chebyshev 距离
 * @internal
 */
function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * 判断某个位置是否是墙体地形。
 * @param terrain RoomTerrain
 * @param x x
 * @param y y
 * @returns true=墙体
 * @internal
 */
function isWall(terrain: RoomTerrain, x: number, y: number): boolean {
    return terrain.get(x, y) === TERRAIN_MASK_WALL;
}

/**
 * 遍历 8 邻域（不含自身）。
 * @param x x
 * @param y y
 * @param fn 回调
 * @internal
 */
function forNear8(x: number, y: number, fn: (nx: number, ny: number) => void): void {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
            fn(nx, ny);
        }
    }
}

/**
 * 静态布局的采集基础设施规划
 * - 资源点：在 source/mineral 临近放置 container（尽量选靠近中心、非墙、非占用格；允许与 road 重叠）\n
 * - 资源点：在 source 的 container 临近放置 link（优先避开 road；无位可放时允许在 road 上）\n
 * - 道路：中心点连接到 container / controller，允许与 container 重叠，但避免在 link 上铺 road\n
 * 低开销策略：不做全房间 cost 填充，仅用 CostMatrix 标记障碍与已有 road=1；容器优先复用寻路末端格
 * @param room 房间对象
 * @param center 布局中心点
 * @param structMap 结构点位映射（会被原地修改）
 * @internal
 */
function planHarvestInfra(room: Room, center: LayoutCenter, structMap: LayoutStructMap): void {
    if (!structMap.road) structMap.road = [];
    if (!structMap.container) structMap.container = [];
    if (!structMap.link) structMap.link = [];

    const terrain = new Room.Terrain(room.name);

    const roadXy = new Set<string>();
    for (const p of structMap.road) roadXy.add(xyKey(p[0], p[1]));

    const containerXy = new Set<string>();
    for (const p of structMap.container) containerXy.add(xyKey(p[0], p[1]));

    const linkXy = new Set<string>();
    for (const p of structMap.link) linkXy.add(xyKey(p[0], p[1]));

    const rampartXy = new Set<string>();
    for (const p of structMap.rampart || []) rampartXy.add(xyKey(p[0], p[1]));

    const blockedXy = new Set<string>();
    for (const struct of OBSTACLE_OBJECT_TYPES) {
        const points = structMap[struct] || [];
        for (const p of points) blockedXy.add(xyKey(p[0], p[1]));
    }

    const costs = new PathFinder.CostMatrix();
    for (const k of blockedXy) {
        const [xs, ys] = k.split(':');
        costs.set(Number(xs), Number(ys), 255);
    }
    for (const k of roadXy) {
        const [xs, ys] = k.split(':');
        costs.set(Number(xs), Number(ys), 1);
    }
    for (const k of linkXy) {
        const [xs, ys] = k.split(':');
        costs.set(Number(xs), Number(ys), 255);
    }

    const isBlocked = (x: number, y: number): boolean => {
        const k = xyKey(x, y);
        if (blockedXy.has(k)) return true;
        if (linkXy.has(k)) return true;
        return false;
    };

    const canPlaceContainer = (x: number, y: number): boolean => {
        if (isWall(terrain, x, y)) return false;
        if (isBlocked(x, y)) return false;
        const k = xyKey(x, y);
        if (containerXy.has(k)) return false;
        if (linkXy.has(k)) return false;
        return true;
    };

    const canPlaceLink = (x: number, y: number, allowOnRoad = false): boolean => {
        if (isWall(terrain, x, y)) return false;
        if (isBlocked(x, y)) return false;
        const k = xyKey(x, y);
        if (containerXy.has(k)) return false;
        if (linkXy.has(k)) return false;
        if (!allowOnRoad && roadXy.has(k)) return false;
        return true;
    };

    const pickContainer = (target: RoomPosition, preferred?: RoomPosition): XY | null => {
        if (preferred && chebyshev(preferred, target) === 1 && canPlaceContainer(preferred.x, preferred.y)) {
            return [preferred.x, preferred.y];
        }

        let best: XY | null = null;
        let bestScore = Infinity;

        forNear8(target.x, target.y, (x, y) => {
            if (chebyshev({ x, y }, target) !== 1) return;
            if (!canPlaceContainer(x, y)) return;

            const dist = chebyshev({ x, y }, center);
            const swampPenalty = terrain.get(x, y) === TERRAIN_MASK_SWAMP ? 1 : 0;
            const rampartBonus = rampartXy.has(xyKey(x, y)) ? -2 : 0;
            const score = dist * 10 + swampPenalty + rampartBonus;

            if (score < bestScore) {
                bestScore = score;
                best = [x, y];
            }
        });

        return best;
    };

    const pickLinkNear = (container: XY): XY | null => {
        const pick = (allowOnRoad: boolean): XY | null => {
            let best: XY | null = null;
            let bestScore = Infinity;

            forNear8(container[0], container[1], (x, y) => {
                if (!canPlaceLink(x, y, allowOnRoad)) return;

                const k = xyKey(x, y);
                const rampartBonus = rampartXy.has(k) ? -100 : 0;
                const roadPenalty = roadXy.has(k) ? 1000 : 0;
                const score = roadPenalty + rampartBonus;

                if (score < bestScore) {
                    bestScore = score;
                    best = [x, y];
                }
            });

            return best;
        };

        return pick(false) || pick(true);
    };

    const addRoadPath = (path: RoomPosition[]): void => {
        for (const p of path) {
            if (costs.get(p.x, p.y) === 255) continue;
            const k = xyKey(p.x, p.y);
            if (linkXy.has(k)) continue;
            if (roadXy.has(k)) continue;
            roadXy.add(k);
            structMap.road.push([p.x, p.y]);
            costs.set(p.x, p.y, 1);
        }
    };

    const connect = (start: RoomPosition, target: RoomPosition, range: number): RoomPosition[] => {
        return PathFinder.search(start, { pos: target, range }, {
            plainCost: 2,
            swampCost: 4,
            maxRooms: 1,
            roomCallback: () => costs
        }).path;
    };

    const start = new RoomPosition(center.x, center.y, room.name);
    const sources = room.find(FIND_SOURCES);
    const mineral = room.find(FIND_MINERALS)[0];
    const controller = room.controller;
    if (!controller) return;

    const targets: Array<{ pos: RoomPosition; kind: 'source' | 'mineral' | 'controller' }> = [
        ...sources.map((s) => ({ pos: s.pos, kind: 'source' as const })),
        ...(mineral ? [{ pos: mineral.pos, kind: 'mineral' as const }] : []),
        { pos: controller.pos, kind: 'controller' as const }
    ];

    targets.sort((a, b) => chebyshev(a.pos, center) - chebyshev(b.pos, center));

    for (const t of targets) {
        if (t.kind === 'controller') {
            addRoadPath(connect(start, t.pos, 1));
            continue;
        }

        const toNearTarget = connect(start, t.pos, 1);
        const preferred = toNearTarget.length > 0 ? toNearTarget[toNearTarget.length - 1] : undefined;
        const container = pickContainer(t.pos, preferred);
        if (!container) {
            addRoadPath(toNearTarget);
            continue;
        }

        const containerKey = xyKey(container[0], container[1]);
        if (!containerXy.has(containerKey)) {
            structMap.container.push([container[0], container[1]]);
            containerXy.add(containerKey);
        }

        if (t.kind === 'source') {
            const link = pickLinkNear(container);
            if (link) {
                const linkKey = xyKey(link[0], link[1]);
                if (!linkXy.has(linkKey)) {
                    structMap.link.push([link[0], link[1]]);
                    linkXy.add(linkKey);
                    costs.set(link[0], link[1], 255);
                }
            }
        }

        if (preferred && preferred.x === container[0] && preferred.y === container[1]) {
            addRoadPath(toNearTarget);
        } else {
            addRoadPath(connect(start, new RoomPosition(container[0], container[1], room.name), 0));
        }
    }
}

/**
 * 将 structMap 压缩成可直接写入 Memory.RosmarinBot.LayoutData 的格式。
 * @param structMap 结构点位映射（XY 列表）
 * @returns 压缩后的映射（number[] 列表）
 * @internal
 */
function toLayoutMemory(structMap: LayoutStructMap): LayoutMemoryMap {
    const memory: LayoutMemoryMap = {};
    for (const s in structMap) {
        const pts = structMap[s];
        memory[s] = compressBatch(pts);
    }
    return memory;
}

/**
 * 计算静态布局（含缓存）。
 * @param roomName 房间名
 * @param layoutType 静态模板名
 * @param center 布局中心点
 * @returns 计算结果；失败返回 null（并输出日志）
 * @internal
 */
function computeStatic(roomName: string, layoutType: string, center: LayoutCenter): CachedLayout | null {
    const room = Game.rooms[roomName];
    if (!room) {
        log('LayoutPlanner', `静态布局失败: ${roomName} 房间不可见`);
        return null;
    }

    const cached = getCachedLayout(roomName, layoutType, center);
    if (cached) {
        log('LayoutPlanner', `命中缓存: static ${roomName} ${layoutType} center(${center.x},${center.y})`);
        return {
            ...cached,
            structMap: cloneStructMap(cached.structMap),
            layoutMemory: cloneLayoutMemory(cached.layoutMemory)
        };
    }

    const base = applyStaticBuildings(roomName, layoutType, center);
    if (!base) {
        log('LayoutPlanner', `静态布局失败: ${roomName} layout=${layoutType} 模板不存在或无有效建筑点`);
        return null;
    }
    const { structMap, minX, maxX, minY, maxY } = base;
    addStaticRampartRing(roomName, structMap, { minX, maxX, minY, maxY });
    planHarvestInfra(room, center, structMap);
    const layoutMemory = toLayoutMemory(structMap);

    const key = makeCacheKey(roomName, layoutType, center);
    setCachedLayout({ key, roomName, layoutType, center, structMap: cloneStructMap(structMap), layoutMemory: cloneLayoutMemory(layoutMemory) });

    return { key, roomName, layoutType, center, createdAt: Game.time, expiresAt: Game.time + CACHE_TTL, structMap, layoutMemory };
}

/**
 * 根据 layoutType 选择动态规划器实现。
 * @param layoutType 动态布局类型（auto / 63auto）
 * @returns 对应 planner 模块
 * @internal
 */
function pickDynamicPlanner(layoutType: string) {
    if (layoutType === '63auto') return autoPlanner63;
    return autoPlanner;
}

/**
 * 计算动态布局（含缓存）。
 * - 优先命中“最近一次缓存”（用于预览后立即 build）\n
 * - 其次命中“输入签名缓存”（用于批量/重复调用）\n
 * @param roomName 房间名
 * @param layoutType 动态布局类型（auto / 63auto）
 * @returns 计算结果；失败返回 null（并输出日志）
 * @internal
 */
function computeDynamic(roomName: string, layoutType: string): CachedLayout | null {
    const room = Game.rooms[roomName];
    if (!room) {
        log('LayoutPlanner', `动态布局失败: ${roomName} 房间不可见 layout=${layoutType}`);
        return null;
    }

    // Detect flag center
    const PosFlag = Game.flags.storagePos || Game.flags.centerPos;
    let flagCenter: LayoutCenter | null = null;
    if (PosFlag && PosFlag.pos.roomName === roomName) {
        flagCenter = { x: PosFlag.pos.x, y: PosFlag.pos.y };
    }

    const cached = getLastCachedByRoomLayout(roomName, layoutType);
    if (cached) {
        let valid = true;
        if (flagCenter && (cached.center.x !== flagCenter.x || cached.center.y !== flagCenter.y)) {
            valid = false;
        }

        if (valid) {
            log('LayoutPlanner', `命中缓存: dynamic ${roomName} ${layoutType} center(${cached.center.x},${cached.center.y})`);
            return {
                ...cached,
                structMap: cloneStructMap(cached.structMap),
                layoutMemory: cloneLayoutMemory(cached.layoutMemory)
            };
        } else {
             log('LayoutPlanner', `缓存失效: dynamic ${roomName} ${layoutType} center mismatch (flag: ${flagCenter?.x},${flagCenter?.y} vs cache: ${cached.center.x},${cached.center.y})`);
        }
    }

    if (Game.cpu.bucket < 100) {
        log('LayoutPlanner', `动态布局跳过: CPU bucket 不足 bucket=${Game.cpu.bucket} room=${roomName} layout=${layoutType}`);
        return null;
    }

    const pa = room.source?.[0]?.pos || room.find(FIND_SOURCES)[0]?.pos;
    const pb = room.source?.[1]?.pos || room.find(FIND_SOURCES)[1]?.pos || pa;
    const pm = room.mineral?.pos || room.find(FIND_MINERALS)[0]?.pos;
    const pc = room.controller?.pos;
    if (!pa || !pb || !pc || !pm) {
        log('LayoutPlanner', `动态布局失败: 缺少关键对象 room=${roomName} layout=${layoutType} (controller/mineral/source)`);
        return null;
    }

    const pointsSig = `${pc.x},${pc.y}|${pm.x},${pm.y}|${pa.x},${pa.y}|${pb.x},${pb.y}`;
    const sigKey = makeDynamicSigKey(roomName, layoutType, pointsSig, flagCenter);
    const sigCached = getCachedDynamicBySig(sigKey);
    if (sigCached) {
        log('LayoutPlanner', `命中缓存: dynamic(sig) ${roomName} ${layoutType} center(${sigCached.center.x},${sigCached.center.y})`);
        return {
            ...sigCached,
            structMap: cloneStructMap(sigCached.structMap),
            layoutMemory: cloneLayoutMemory(sigCached.layoutMemory)
        };
    }

    const storagePos = Game.flags.storagePos;
    if (storagePos && storagePos.pos.roomName !== roomName) storagePos.remove();

    const planner = pickDynamicPlanner(layoutType);
    const computeManor = planner.ManagerPlanner.computeManor;
    const roomStructsData = computeManor(pa.roomName, [pc, pm, pa, pb], flagCenter);
    const normalized = normalizeDynamicPlannerResult(roomName, layoutType, roomStructsData);
    if (!normalized) return null;

    const center = normalized.center;
    const structMap = normalized.structMap;
    const layoutMemory = toLayoutMemory(structMap);

    const key = makeCacheKey(roomName, layoutType, center);
    setCachedLayout(
        { key, roomName, layoutType, center, structMap: cloneStructMap(structMap), layoutMemory: cloneLayoutMemory(layoutMemory) },
        { dynamicSigKey: sigKey }
    );

    return { key, roomName, layoutType, center, createdAt: Game.time, expiresAt: Game.time + CACHE_TTL, structMap, layoutMemory };
}

/**
 * LayoutPlanner：静态/动态布局的统一入口。
 * - visual*：只在房间内显示点位，不写入 Memory\n
 * - build*：写入 Memory.RosmarinBot.LayoutData，供后续自动建造流程消费\n
 * - ByFlags：使用 pa/pb/pc/pm 旗帜即时预览（不落盘、不走缓存）\n
 * @public
 */
export const LayoutPlanner = {
    /**
     * 根据 layoutMemory 在房间内创建工地。
     * @param room 目标房间
     * @param layoutMemory Memory 中的压缩布局数据
     * @param options 可选：只创建某一种结构、限制最大工地数量
     * @returns 本次创建的工地数量（不是 Screeps 错误码）
     */
    plannerCreateSite(
        room: Room,
        layoutMemory: LayoutMemoryMap,
        options?: { structType?: string; maxSites?: number }
    ): number {
        const only = options?.structType;
        const allSite = room.find(FIND_CONSTRUCTION_SITES);

        const maxSites = options?.maxSites;
        const cap = typeof maxSites === 'number' ? maxSites : (typeof MAX_CONSTRUCTION_SITES === 'number' ? MAX_CONSTRUCTION_SITES : 100);
        const budget = Math.max(0, cap - allSite.length);
        if (budget <= 0) return 0;

        let created = 0;
        const keys = only ? [only] : Object.keys(layoutMemory);
        for (const s of keys) {
            if (created >= budget) break;
            const layoutArray = layoutMemory[s];
            if (!layoutArray || !layoutArray.length) continue;

            const buildMax = (CONTROLLER_STRUCTURES as any)?.[s]?.[room.level] ?? 0;
            if (!buildMax) continue;

            let structures = (room as any)[s] || room.find(FIND_STRUCTURES, { filter: (o) => o.structureType == s });
            if (!Array.isArray(structures)) structures = [structures];
            let count = structures.length;
            if (count >= buildMax) continue;

            const sites = allSite.filter(o => o.structureType == s);
            count += sites.length;
            if (count >= buildMax) continue;

            const points = getLayoutPointsForRcl(room, s, layoutArray);
            if (!points || points.length == 0) continue;
            for (const p of points) {
                if (created >= budget) break;
                if (count >= buildMax) break;
                const [x, y] = decompress(p);
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                const Pos = new RoomPosition(x, y, room.name);
                if (Pos.lookFor(LOOK_CONSTRUCTION_SITES).length) continue;
                const S = Pos.lookFor(LOOK_STRUCTURES);
                if (shouldSkipBuildAtPos(room, s, S, Pos)) continue;
                const result = room.createConstructionSite(x, y, s as any);
                if (result === OK) {
                    created++;
                    count++;
                }
                if (result == ERR_FULL) return created;
            }
        }
        return created;
    },
    /**
     * 静态布局可视化（不落盘）。
     * @param roomName 房间名
     * @param layoutType 静态模板名
     * @returns Screeps 错误码：OK/ERR_INVALID_ARGS/ERR_NOT_FOUND
     */
    visualStatic(roomName: string, layoutType: string): number {
        const center = resolveCenter(roomName);
        if (!center) {
            log('LayoutPlanner', `静态布局可视化失败: ${roomName} 缺少中心点(Memory.center 或 storagePos/centerPos 旗帜)`);
            return ERR_INVALID_ARGS;
        }
        const computed = computeStatic(roomName, layoutType, center);
        if (!computed) return ERR_NOT_FOUND;
        LayoutVisual.showRoomStructures(roomName, computed.structMap);
        log('LayoutPlanner', `静态布局可视化成功: ${roomName} layout=${layoutType} center(${center.x},${center.y})`);
        return OK;
    },

    /**
     * 静态布局构建：写入 Memory.RosmarinBot.LayoutData[roomName]。
     * @param roomName 房间名
     * @param layoutType 静态模板名
     * @returns Screeps 错误码：OK/ERR_INVALID_ARGS/ERR_NOT_FOUND
     */
    buildStatic(roomName: string, layoutType: string): number {
        const center = resolveCenter(roomName);
        if (!center) {
            log('LayoutPlanner', `静态布局构建失败: ${roomName} 缺少中心点(Memory.center 或 storagePos/centerPos 旗帜)`);
            return ERR_INVALID_ARGS;
        }
        const computed = computeStatic(roomName, layoutType, center);
        if (!computed) return ERR_NOT_FOUND;
        const layoutMemory = getLayoutData(roomName) as any;
        for (const k in layoutMemory) delete layoutMemory[k];
        Object.assign(layoutMemory, computed.layoutMemory as any);
        log('LayoutPlanner', `静态布局构建成功: ${roomName} layout=${layoutType} center(${center.x},${center.y})`);
        return OK;
    },

    /**
     * 动态布局(auto)可视化（不落盘）。
     * @param roomName 房间名
     * @returns Screeps 错误码：OK/ERR_NOT_FOUND
     */
    visualDynamic(roomName: string): number {
        const computed = computeDynamic(roomName, 'auto');
        if (!computed) return ERR_NOT_FOUND;
        LayoutVisual.showRoomStructures(roomName, computed.structMap);
        log('LayoutPlanner', `动态布局可视化成功: ${roomName} layout=auto center(${computed.center.x},${computed.center.y})`);
        return OK;
    },

    /**
     * 动态布局(auto)构建：写入 Memory.RosmarinBot.LayoutData[roomName] 并同步 RoomData.center/layout（若存在）。
     * @param roomName 房间名
     * @returns Screeps 错误码：OK/ERR_NOT_FOUND
     */
    buildDynamic(roomName: string): number {
        const computed = computeDynamic(roomName, 'auto');
        if (!computed) return ERR_NOT_FOUND;
        const rooms = getRoomData();
        if (rooms?.[roomName]) {
            rooms[roomName]['layout'] = 'auto';
            rooms[roomName]['center'] = computed.center;
        }
        const layoutMemory = getLayoutData(roomName) as any;
        for (const k in layoutMemory) delete layoutMemory[k];
        Object.assign(layoutMemory, computed.layoutMemory as any);
        log('LayoutPlanner', `动态布局构建成功: ${roomName} layout=auto center(${computed.center.x},${computed.center.y})`);
        return OK;
    },

    /**
     * 动态布局(auto)可视化：使用 pa/pb/pc/pm 旗帜输入（不落盘，不参与缓存）。
     * @returns Screeps 错误码：OK/ERR_INVALID_ARGS/ERR_NOT_FOUND/ERR_TIRED
     */
    visualDynamicByFlags(): number {
        if (Game.cpu.bucket < 100) {
            log('LayoutPlanner', `动态布局可视化失败: CPU bucket 不足 bucket=${Game.cpu.bucket}`);
            return ERR_TIRED;
        }
        const pa = Game.flags.pa?.pos;
        const pb = Game.flags.pb?.pos;
        const pc = Game.flags.pc?.pos;
        const pm = Game.flags.pm?.pos;
        if (!pa || !pb || !pc || !pm) {
            log('LayoutPlanner', `动态布局可视化失败: 缺少 pa/pb/pc/pm 旗帜`);
            return ERR_INVALID_ARGS;
        }
        if (pa.roomName != pb.roomName || pa.roomName != pc.roomName || pa.roomName != pm.roomName) {
            log('LayoutPlanner', `动态布局可视化失败: pa/pb/pc/pm 不在同一房间`);
            return ERR_INVALID_ARGS;
        }
        const roomName = pa.roomName;

        const storagePos = Game.flags.storagePos || Game.flags.centerPos;
        if (storagePos && storagePos.pos.roomName !== roomName) storagePos.remove();

        const computeManor = autoPlanner.ManagerPlanner.computeManor;
        const roomStructsData = computeManor(roomName, [pc, pm, pa, pb]);
        if (!roomStructsData) {
            log('LayoutPlanner', `动态布局可视化失败: planner 返回空 room=${roomName} layout=auto(flags)`);
            return ERR_NOT_FOUND;
        }

        LayoutVisual.showRoomStructures(roomName, roomStructsData.structMap);
        log('LayoutPlanner', `动态布局可视化成功: ${roomName} layout=auto(flags)`);
        return OK;
    },

    /**
     * 动态布局(63auto)可视化（不落盘）。
     * @param roomName 房间名
     * @returns Screeps 错误码：OK/ERR_NOT_FOUND
     */
    visualDynamic63(roomName: string): number {
        const computed = computeDynamic(roomName, '63auto');
        if (!computed) return ERR_NOT_FOUND;
        LayoutVisual.showRoomStructures(roomName, computed.structMap);
        log('LayoutPlanner', `动态布局可视化成功: ${roomName} layout=63auto center(${computed.center.x},${computed.center.y})`);
        return OK;
    },

    /**
     * 动态布局(63auto)构建：写入 Memory.RosmarinBot.LayoutData[roomName] 并同步 RoomData.center/layout（若存在）。
     * @param roomName 房间名
     * @returns Screeps 错误码：OK/ERR_NOT_FOUND
     */
    buildDynamic63(roomName: string): number {
        const computed = computeDynamic(roomName, '63auto');
        if (!computed) return ERR_NOT_FOUND;
        const BotMemRooms = getRoomData();
        if (BotMemRooms?.[roomName]) {
            BotMemRooms[roomName]['layout'] = '63auto';
            BotMemRooms[roomName]['center'] = computed.center;
        }
        const layoutMemory = getLayoutData(roomName) as any;
        for (const k in layoutMemory) delete layoutMemory[k];
        Object.assign(layoutMemory, computed.layoutMemory as any);
        log('LayoutPlanner', `动态布局构建成功: ${roomName} layout=63auto center(${computed.center.x},${computed.center.y})`);
        return OK;
    },

    /**
     * 动态布局(63auto)可视化：使用 pa/pb/pc/pm 旗帜输入（不落盘，不参与缓存）。
     * @returns Screeps 错误码：OK/ERR_INVALID_ARGS/ERR_NOT_FOUND/ERR_TIRED
     */
    visualDynamic63ByFlags(): number {
        if (Game.cpu.bucket < 100) {
            log('LayoutPlanner', `动态布局可视化失败: CPU bucket 不足 bucket=${Game.cpu.bucket}`);
            return ERR_TIRED;
        }
        const pa = Game.flags.pa?.pos;
        const pb = Game.flags.pb?.pos;
        const pc = Game.flags.pc?.pos;
        const pm = Game.flags.pm?.pos;
        if (!pa || !pb || !pc || !pm) {
            log('LayoutPlanner', `动态布局可视化失败: 缺少 pa/pb/pc/pm 旗帜`);
            return ERR_INVALID_ARGS;
        }
        if (pa.roomName != pb.roomName || pa.roomName != pc.roomName || pa.roomName != pm.roomName) {
            log('LayoutPlanner', `动态布局可视化失败: pa/pb/pc/pm 不在同一房间`);
            return ERR_INVALID_ARGS;
        }
        const roomName = pa.roomName;

        const storagePos = Game.flags.storagePos || Game.flags.centerPos;
        if (storagePos && storagePos.pos.roomName !== roomName) storagePos.remove();

        const computeManor = autoPlanner63.ManagerPlanner.computeManor;
        const roomStructsData = computeManor(roomName, [pc, pm, pa, pb]);
        if (!roomStructsData) {
            log('LayoutPlanner', `动态布局可视化失败: planner 返回空 room=${roomName} layout=63auto(flags)`);
            return ERR_NOT_FOUND;
        }

        LayoutVisual.showRoomStructures(roomName, roomStructsData.structMap);
        log('LayoutPlanner', `动态布局可视化成功: ${roomName} layout=63auto(flags)`);
        return OK;
    }
};

export default LayoutPlanner;
