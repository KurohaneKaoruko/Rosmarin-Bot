import { compress, compressBatch, log } from '@/utils';
import HelperVisual from '@/modules/feature/planner/helperVisual';
import { autoPlanner63 } from '@/modules/feature/planner/dynamic/autoPlanner63';
import * as StaticPlanner from '@/modules/feature/planner/static';

/**
 * 布局计算与可视化/落盘的通用模块
 * - 静态布局：根据 layoutType + center 生成结构点位，并自动连接道路（中心到 source/mineral/controller）
 * - 动态布局(63auto)：复用 autoPlanner63 的输出结构点位
 * - 缓存：同一 tick 段内“先可视化再构建”会复用计算结果，避免重复寻路/计算
 */
type XY = [number, number];

type LayoutStructMap = {
    [structureType: string]: XY[];
};

type LayoutMemoryMap = {
    [structureType: string]: number[];
};

type LayoutCenter = { x: number; y: number };

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

/** 缓存存放在 global 上，避免写入 Memory 造成体积与反序列化开销 */
function getCacheStore(): { byKey: { [key: string]: CachedLayout }; lastKeyByRoomLayout: { [key: string]: string } } {
    const g = global as any;
    if (!g.__layoutPlannerCache) {
        g.__layoutPlannerCache = { byKey: {}, lastKeyByRoomLayout: {} };
    }
    return g.__layoutPlannerCache;
}

/** 静态布局缓存 key：同房间 + 同布局类型 + 同中心点 => 可复用 */
function makeCacheKey(roomName: string, layoutType: string, center: LayoutCenter): string {
    return `${roomName}:${layoutType}:${center.x}:${center.y}`;
}

/** 避免外部修改污染缓存（structMap 内部是数组嵌套） */
function cloneStructMap(structMap: LayoutStructMap): LayoutStructMap {
    const next: LayoutStructMap = {};
    for (const s in structMap) next[s] = structMap[s].map((p) => [p[0], p[1]]);
    return next;
}

/** 避免外部修改污染缓存（layoutMemory 内部是 number[]） */
function cloneLayoutMemory(layoutMemory: LayoutMemoryMap): LayoutMemoryMap {
    const next: LayoutMemoryMap = {};
    for (const s in layoutMemory) next[s] = layoutMemory[s].slice();
    return next;
}

/** 按参数精确命中缓存（用于静态布局） */
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

/** 写入缓存，同时记录该 room+layoutType 的最新一次 key（用于动态布局） */
function setCachedLayout(entry: Omit<CachedLayout, 'createdAt' | 'expiresAt'>): void {
    const store = getCacheStore();
    const cached: CachedLayout = { ...entry, createdAt: Game.time, expiresAt: Game.time + CACHE_TTL };
    store.byKey[entry.key] = cached;
    store.lastKeyByRoomLayout[`${entry.roomName}:${entry.layoutType}`] = entry.key;
}

/** 动态布局中心点是计算出来的，因此用“最近一次”的缓存来复用（预览后构建） */
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

/** 统一解析布局中心：优先 Memory['RoomControlData'][roomName].center，其次 storagePos/centerPos 旗帜 */
function resolveCenter(roomName: string): LayoutCenter | null {
    const BotMemRooms = Memory['RoomControlData'];
    let center = BotMemRooms?.[roomName]?.center as LayoutCenter | undefined;
    const PosFlag = Game.flags.storagePos || Game.flags.centerPos;
    if (PosFlag && PosFlag.pos.roomName === roomName) {
        center = { x: PosFlag.pos.x, y: PosFlag.pos.y };
    }
    return center || null;
}

/** 从静态布局模板初始化 structMap 结构 */
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

/** 将静态模板按 center 平移到房间坐标，并过滤墙体/越界 */
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

/** 静态布局的 rampart 外圈（用于预览/构建保持一致） */
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

function xyKey(x: number, y: number): string {
    return `${x}:${y}`;
}

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isWall(terrain: RoomTerrain, x: number, y: number): boolean {
    return terrain.get(x, y) === TERRAIN_MASK_WALL;
}

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

/** 将 structMap 压缩成可直接写入 Memory['LayoutData'] 的格式 */
function toLayoutMemory(structMap: LayoutStructMap): LayoutMemoryMap {
    const memory: LayoutMemoryMap = {};
    for (const s in structMap) {
        const pts = structMap[s];
        memory[s] = compressBatch(pts);
    }
    return memory;
}

/** 计算静态布局（含缓存）：返回用于可视化与落盘的统一结果 */
function computeStatic(roomName: string, layoutType: string, center: LayoutCenter): CachedLayout | null {
    const room = Game.rooms[roomName];
    if (!room) return null;

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
    if (!base) return null;
    const { structMap, minX, maxX, minY, maxY } = base;
    addStaticRampartRing(roomName, structMap, { minX, maxX, minY, maxY });
    planHarvestInfra(room, center, structMap);
    const layoutMemory = toLayoutMemory(structMap);

    const key = makeCacheKey(roomName, layoutType, center);
    setCachedLayout({ key, roomName, layoutType, center, structMap: cloneStructMap(structMap), layoutMemory: cloneLayoutMemory(layoutMemory) });

    return { key, roomName, layoutType, center, createdAt: Game.time, expiresAt: Game.time + CACHE_TTL, structMap, layoutMemory };
}

/** 计算动态布局 63auto（含缓存）：优先复用最近一次预览结果 */
function computeDynamic63(roomName: string): CachedLayout | null {
    const room = Game.rooms[roomName];
    if (!room) return null;

    const cached = getLastCachedByRoomLayout(roomName, '63auto');
    if (cached) {
        log('LayoutPlanner', `命中缓存: dynamic ${roomName} 63auto center(${cached.center.x},${cached.center.y})`);
        return {
            ...cached,
            structMap: cloneStructMap(cached.structMap),
            layoutMemory: cloneLayoutMemory(cached.layoutMemory)
        };
    }

    if (Game.cpu.bucket < 100) return null;

    const pa = room.source?.[0]?.pos || room.find(FIND_SOURCES)[0]?.pos;
    const pb = room.source?.[1]?.pos || room.find(FIND_SOURCES)[1]?.pos || pa;
    const pm = room.mineral?.pos || room.find(FIND_MINERALS)[0]?.pos;
    const pc = room.controller?.pos;
    if (!pa || !pb || !pc || !pm) return null;

    const storagePos = Game.flags.storagePos;
    if (storagePos && storagePos.pos.roomName !== roomName) storagePos.remove();

    const computeManor = autoPlanner63.ManagerPlanner.computeManor;
    const roomStructsData = computeManor(pa.roomName, [pc, pm, pa, pb]);
    if (!roomStructsData) return null;

    const center = { x: roomStructsData.storagePos.storageX, y: roomStructsData.storagePos.storageY };
    const structMap = roomStructsData.structMap as LayoutStructMap;
    const layoutMemory = toLayoutMemory(structMap);

    const key = makeCacheKey(roomName, '63auto', center);
    setCachedLayout({ key, roomName, layoutType: '63auto', center, structMap: cloneStructMap(structMap), layoutMemory: cloneLayoutMemory(layoutMemory) });

    return { key, roomName, layoutType: '63auto', center, createdAt: Game.time, expiresAt: Game.time + CACHE_TTL, structMap, layoutMemory };
}

export const LayoutPlanner = {
    /** 静态布局可视化 */
    visualStatic(roomName: string, layoutType: string): number {
        const center = resolveCenter(roomName);
        if (!center) return ERR_INVALID_ARGS;
        const computed = computeStatic(roomName, layoutType, center);
        if (!computed) return ERR_NOT_FOUND;
        HelperVisual.showRoomStructures(roomName, computed.structMap);
        return OK;
    },

    /** 静态布局构建 */
    buildStatic(roomName: string, layoutType: string): number {
        const center = resolveCenter(roomName);
        if (!center) return ERR_INVALID_ARGS;
        const computed = computeStatic(roomName, layoutType, center);
        if (!computed) return ERR_NOT_FOUND;
        Memory['LayoutData'][roomName] = computed.layoutMemory as any;
        return OK;
    },

    /** 动态布局(63auto)可视化 */
    visualDynamic63(roomName: string): number {
        const computed = computeDynamic63(roomName);
        if (!computed) return ERR_NOT_FOUND;
        HelperVisual.showRoomStructures(roomName, computed.structMap);
        return OK;
    },

    /** 动态布局(63auto)构建 */
    buildDynamic63(roomName: string): number {
        const computed = computeDynamic63(roomName);
        if (!computed) return ERR_NOT_FOUND;
        const BotMemRooms = Memory['RoomControlData'];
        if (BotMemRooms?.[roomName]) {
            BotMemRooms[roomName]['layout'] = '63auto';
            BotMemRooms[roomName]['center'] = computed.center;
        }
        Memory['LayoutData'][roomName] = computed.layoutMemory as any;
        return OK;
    },

    /** 动态布局(63auto)可视化：使用 pa/pb/pc/pm 旗帜输入（不落盘，不参与缓存） */
    visualDynamic63ByFlags(): Error | number {
        if (Game.cpu.bucket < 100) return new Error('CPU bucket 不足');
        const pa = Game.flags.pa?.pos;
        const pb = Game.flags.pb?.pos;
        const pc = Game.flags.pc?.pos;
        const pm = Game.flags.pm?.pos;
        if (!pa || !pb || !pc || !pm) return new Error('缺少 pa/pb/pc/pm 旗帜');
        if (pa.roomName != pb.roomName || pa.roomName != pc.roomName || pa.roomName != pm.roomName) return ERR_INVALID_ARGS;
        const roomName = pa.roomName;

        const storagePos = Game.flags.storagePos || Game.flags.centerPos;
        if (storagePos && storagePos.pos.roomName !== roomName) storagePos.remove();

        const computeManor = autoPlanner63.ManagerPlanner.computeManor;
        const roomStructsData = computeManor(roomName, [pc, pm, pa, pb]);
        if (!roomStructsData) return new Error('计算布局失败');

        HelperVisual.showRoomStructures(roomName, roomStructsData.structMap);
        return OK;
    }
};

export default LayoutPlanner;
