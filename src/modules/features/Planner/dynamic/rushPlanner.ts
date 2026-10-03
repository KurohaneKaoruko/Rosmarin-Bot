/**
 * rush 动态布局（rushauto）：以控制器为锚点程序化生成。
 *
 * 与冲级强绑定的布局约束：
 * - 仓库（storage）落在控制器 3 格内，且邻格保留可站位（冲级升级工位的前提，
 *   见 roomWorkforce.getRushUpgradeSlotList）；
 * - terminal 贴仓库（RCL6 增量）、link 落在控制器 2 格内（升级专线供能）；
 * - 道路全量入清单（RCL2 起铺：getLayoutPointsForRcl 对 rush 放开等级闸）；
 * - 容器只标源旁位（plannerCreateSite 的 RCL<6 源旁过滤 + 每源一个）；
 *   控制器容器不进布局（RoadBuilder.ensureControllerContainer 评分选址，避免工地竞争）。
 */
import { compress } from '@/modules/shared/compress';

type XY = [number, number];

export type RushLayoutResult = {
    center: { x: number; y: number };
    structMap: { [structureType: string]: XY[] };
} | null;

const key = (x: number, y: number) => `${x},${y}`;

const inBoard = (x: number, y: number) => x >= 1 && x <= 48 && y >= 1 && y <= 48;

const chebyshev = (x1: number, y1: number, x2: number, y2: number) =>
    Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

/** 生成一条 (x1,y1)→(x2,y2) 的 L 形线（先横后纵），不含端点已占用格由调用方过滤 */
const lineCells = (x1: number, y1: number, x2: number, y2: number): XY[] => {
    const cells: XY[] = [];
    const sx = Math.sign(x2 - x1);
    const sy = Math.sign(y2 - y1);
    let x = x1;
    let y = y1;
    while (x !== x2) { x += sx; cells.push([x, y]); }
    while (y !== y2) { y += sy; cells.push([x, y]); }
    return cells;
};

export function buildRushLayout(room: Room): RushLayoutResult {
    const controller = room.controller;
    if (!controller?.my) return null;

    const terrain = room.getTerrain();
    const sources = (room.source || []) as Source[];
    const occupied = new Set<string>();
    for (const s of room.find(FIND_STRUCTURES) as Structure[]) occupied.add(key(s.pos.x, s.pos.y));
    for (const s of room.find(FIND_CONSTRUCTION_SITES) as ConstructionSite[]) occupied.add(key(s.pos.x, s.pos.y));
    for (const s of sources) occupied.add(key(s.pos.x, s.pos.y));
    if (room.mineral) occupied.add(key(room.mineral.pos.x, room.mineral.pos.y));
    occupied.add(key(controller.pos.x, controller.pos.y));

    const isWall = (x: number, y: number) => terrain.get(x, y) === TERRAIN_MASK_WALL;
    const free = (x: number, y: number) => inBoard(x, y) && !isWall(x, y) && !occupied.has(key(x, y));
    const take = (x: number, y: number) => { occupied.add(key(x, y)); return [x, y] as XY; };

    const cx = controller.pos.x;
    const cy = controller.pos.y;
    const ringCells = (range: number): XY[] => {
        const cells: XY[] = [];
        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                if (chebyshev(dx, dy, 0, 0) > range) continue;
                cells.push([cx + dx, cy + dy]);
            }
        }
        return cells;
    };
    const standableNeighbors = (x: number, y: number) => {
        let open = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (!free(nx, ny)) continue;
                if (chebyshev(nx, ny, cx, cy) > 3) continue;
                open++;
            }
        }
        return open;
    };

    // ── 仓库：控制器 3 格内「邻格可站最多」的可建位（冲级工位容量最大化） ──
    let storage: XY | null = null;
    let bestScore = -1;
    for (const [x, y] of ringCells(3)) {
        if (!free(x, y)) continue;
        const score = standableNeighbors(x, y) * 4 - chebyshev(x, y, cx, cy);
        if (score > bestScore) { bestScore = score; storage = [x, y]; }
    }
    if (!storage) return null;
    const [sx, sy] = take(storage[0], storage[1]);

    const near = (x: number, y: number, preferRange: number, preferCx: number, preferCy: number): XY | null => {
        let pick: XY | null = null;
        let best = -1;
        for (let dx = -preferRange; dx <= preferRange; dx++) {
            for (let dy = -preferRange; dy <= preferRange; dy++) {
                const nx = x + dx;
                const ny = y + dy;
                if (!free(nx, ny)) continue;
                if (chebyshev(nx, ny, cx, cy) > 3) continue;
                const score = -chebyshev(nx, ny, preferCx, preferCy);
                if (score > best) { best = score; pick = [nx, ny]; }
            }
        }
        return pick;
    };

    // ── terminal 贴仓库（仍留控制器 3 内）、link 落控制器 2 内、factory 贴仓库 ──
    const terminal = near(sx, sy, 2, cx, cy);
    const terminalXY = terminal ? take(terminal[0], terminal[1]) : null;
    const linkCandidates = ringCells(2).filter(([x, y]) => free(x, y));
    let link: XY | null = null;
    let linkBest = -1;
    for (const [x, y] of linkCandidates) {
        const score = -chebyshev(x, y, sx, sy);
        if (score > linkBest) { linkBest = score; link = [x, y]; }
    }
    const linkXY = link ? take(link[0], link[1]) : null;
    const factory = near(sx, sy, 2, terminalXY ? terminalXY[0] : cx, terminalXY ? terminalXY[1] : cy);
    const factoryXY = factory ? take(factory[0], factory[1]) : null;

    // ── spawn ×2：仓库外圈（3~6 格）朝房间中心一侧的可建位 ──
    const centerX = 25;
    const centerY = 25;
    const spawns: XY[] = [];
    {
        const candidates: Array<{ x: number; y: number; score: number }> = [];
        for (let dx = -6; dx <= 6; dx++) {
            for (let dy = -6; dy <= 6; dy++) {
                const x = sx + dx;
                const y = sy + dy;
                if (!free(x, y)) continue;
                const dCore = chebyshev(x, y, sx, sy);
                if (dCore < 3 || dCore > 6) continue;
                candidates.push({ x, y, score: -chebyshev(x, y, centerX, centerY) });
            }
        }
        candidates.sort((a, b) => b.score - a.score);
        for (const c of candidates) {
            if (spawns.length >= 2) break;
            if (spawns.some(([ex, ey]) => chebyshev(ex, ey, c.x, c.y) < 3)) continue;
            spawns.push(take(c.x, c.y));
        }
    }

    // ── tower ×6：核心邻域（前两个偏控制器侧） ──
    const towers: XY[] = [];
    {
        const candidates: Array<{ x: number; y: number; score: number }> = [];
        for (let dx = -5; dx <= 5; dx++) {
            for (let dy = -5; dy <= 5; dy++) {
                const x = sx + dx;
                const y = sy + dy;
                if (!free(x, y)) continue;
                const dCore = chebyshev(x, y, sx, sy);
                if (dCore < 2 || dCore > 5) continue;
                candidates.push({ x, y, score: -chebyshev(x, y, cx, cy) });
            }
        }
        candidates.sort((a, b) => b.score - a.score);
        for (const c of candidates) {
            if (towers.length >= 6) break;
            if (towers.some(([ex, ey]) => chebyshev(ex, ey, c.x, c.y) < 2)) continue;
            towers.push(take(c.x, c.y));
        }
    }

    // ── 冲级工位保留区：仓库邻格 ∩ 控制器 3（ext/tower 不许占） ──
    const rushSlots = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = sx + dx;
            const y = sy + dy;
            if (chebyshev(x, y, cx, cy) <= 3) rushSlots.add(key(x, y));
        }
    }
    const blockedForEconomy = (x: number, y: number) =>
        rushSlots.has(key(x, y)) || chebyshev(x, y, cx, cy) <= 3;

    // ── ext ×60：从核心向外螺旋；不进冲级工位保留区与控制器 3 圈 ──
    const extensions: XY[] = [];
    {
        const candidates: Array<{ x: number; y: number; d: number }> = [];
        for (let dx = -9; dx <= 9; dx++) {
            for (let dy = -9; dy <= 9; dy++) {
                const x = sx + dx;
                const y = sy + dy;
                if (!free(x, y)) continue;
                if (blockedForEconomy(x, y)) continue;
                candidates.push({ x, y, d: chebyshev(x, y, sx, sy) });
            }
        }
        candidates.sort((a, b) => a.d - b.d);
        for (const c of candidates) {
            if (extensions.length >= 60) break;
            if (extensions.some(([ex, ey]) => chebyshev(ex, ey, c.x, c.y) < 2)) continue;
            extensions.push(take(c.x, c.y));
        }
    }

    // ── lab ×10 / observer / nuker / powerSpawn：外圈 ──
    const labs: XY[] = [];
    const extras: Record<string, XY | null> = { observer: null, nuker: null, powerSpawn: null };
    {
        const candidates: Array<{ x: number; y: number; d: number }> = [];
        for (let dx = -11; dx <= 11; dx++) {
            for (let dy = -11; dy <= 11; dy++) {
                const x = sx + dx;
                const y = sy + dy;
                if (!free(x, y)) continue;
                if (blockedForEconomy(x, y)) continue;
                candidates.push({ x, y, d: chebyshev(x, y, sx, sy) });
            }
        }
        candidates.sort((a, b) => a.d - b.d);
        for (const c of candidates) {
            if (labs.length < 10) { labs.push(take(c.x, c.y)); continue; }
            if (!extras.observer) { extras.observer = take(c.x, c.y); continue; }
            if (!extras.nuker) { extras.nuker = take(c.x, c.y); continue; }
            if (!extras.powerSpawn) { extras.powerSpawn = take(c.x, c.y); }
            break;
        }
    }

    // ── 道路：仓库→各源 / 仓库→控制器 / 仓库→spawn 位（寻路可用则走实路，否则 L 形线） ──
    const roads: XY[] = [];
    const addRoadLine = (from: XY, to: XY) => {
        let cells: XY[] | null = null;
        if (typeof room.findPath === 'function') {
            try {
                const path = room.findPath(
                    new RoomPosition(from[0], from[1], room.name),
                    new RoomPosition(to[0], to[1], room.name),
                    { ignoreCreeps: true },
                );
                if (path && path.length > 0) cells = path.map(p => [p.x, p.y] as XY);
            } catch { /* 桩环境/寻路异常走 L 形线 */ }
        }
        if (!cells) cells = lineCells(from[0], from[1], to[0], to[1]);
        for (const [x, y] of cells) {
            if (!inBoard(x, y) || isWall(x, y)) continue;
            if (roads.some(([rx, ry]) => rx === x && ry === y)) continue;
            roads.push([x, y]);
        }
    };
    for (const s of sources) addRoadLine([sx, sy], [s.pos.x, s.pos.y]);
    addRoadLine([sx, sy], [cx, cy]);
    for (const sp of spawns) addRoadLine([sx, sy], sp);

    // ── 源旁容器：每源 1 个（最近可建位） ──
    const containers: XY[] = [];
    for (const s of sources) {
        let pick: XY | null = null;
        let best = -1;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = s.pos.x + dx;
                const y = s.pos.y + dy;
                if (!free(x, y)) continue;
                const score = -chebyshev(x, y, sx, sy);
                if (score > best) { best = score; pick = [x, y]; }
            }
        }
        if (pick) containers.push(take(pick[0], pick[1]));
    }

    const structMap: { [structureType: string]: XY[] } = {};
    structMap[STRUCTURE_STORAGE] = [[sx, sy]];
    if (terminalXY) structMap[STRUCTURE_TERMINAL] = [terminalXY];
    if (linkXY) structMap[STRUCTURE_LINK] = [linkXY];
    if (factoryXY) structMap[STRUCTURE_FACTORY] = [factoryXY];
    structMap[STRUCTURE_SPAWN] = spawns;
    structMap[STRUCTURE_TOWER] = towers;
    structMap[STRUCTURE_EXTENSION] = extensions;
    structMap[STRUCTURE_LAB] = labs;
    if (extras.observer) structMap[STRUCTURE_OBSERVER] = [extras.observer];
    if (extras.nuker) structMap[STRUCTURE_NUKER] = [extras.nuker];
    if (extras.powerSpawn) structMap[STRUCTURE_POWER_SPAWN] = [extras.powerSpawn];
    structMap[STRUCTURE_ROAD] = roads;
    structMap[STRUCTURE_CONTAINER] = containers;

    return { center: { x: sx, y: sy }, structMap };
}

/** rush 布局的 Memory 压缩格式（structureType → compress(x,y)[]） */
export function rushLayoutMemory(room: Room): { center: { x: number; y: number }; memory: { [type: string]: number[] } } | null {
    const result = buildRushLayout(room);
    if (!result) return null;
    const memory: { [type: string]: number[] } = {};
    for (const type in result.structMap) {
        const pts = result.structMap[type];
        if (pts.length) memory[type] = pts.map(([x, y]) => compress(x, y));
    }
    return { center: result.center, memory };
}
