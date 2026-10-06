/**
 * 要塞服指挥旗自动落位：小队进房后把 Team-xxxx 指挥旗移到目标建筑群外沿安全点。
 *
 * 口径：
 * - 安全点 = 阻挡建筑（非 road / 非己方 rampart）外沿 1 格内、自身无阻挡、上下左右阻挡 <2 的开阔位
 * - 以旗位为参照就近选点（方向自适应）；多队锚点间距 ≥3
 * - 旗位已是安全点则不动；建筑群被拆后自动重选更深点位（逐层推进）
 * - 仅处理已入目标房且结束集结的队伍；无视野不动旗
 */
import { getTeamData } from '@/modules/shared/memory';

/** 同 tick 安全点缓存（key = roomName） */
let spotCacheTick = -1;
const spotCache: Record<string, Set<string>> = {};

/** 阻挡建筑判定：非 road 且非己方 rampart */
const isBlocked = (s: Structure): boolean => {
    if (s.structureType === STRUCTURE_ROAD) return false;
    if (s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my) return false;
    return true;
};

/** 计算房间建筑群外沿安全点集合（坐标字符串 x/y） */
const collectSpots = (room: Room): Set<string> => {
    const blocked = new Uint8Array(2500);   // 自身是否阻挡
    const near = new Uint8Array(2500);      // 3x3 内阻挡计数
    for (const s of room.find(FIND_STRUCTURES)) {
        if (!isBlocked(s)) continue;
        blocked[s.pos.y * 50 + s.pos.x] = 1;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const x = s.pos.x + dx, y = s.pos.y + dy;
                if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                near[y * 50 + x]++;
            }
        }
    }

    const spots = new Set<string>();
    for (let y = 1; y <= 48; y++) {
        for (let x = 1; x <= 48; x++) {
            const i = y * 50 + x;
            if (blocked[i] || !near[i]) continue;
            // 开阔度：上下左右阻挡 <2（站位稳定，方阵可展开）
            const ortho = blocked[i - 50] + blocked[i + 50] + blocked[i - 1] + blocked[i + 1];
            if (ortho >= 2) continue;
            spots.add(`${x}/${y}`);
        }
    }
    return spots;
};

/** 取房间安全点集合（同 tick 复用） */
const getSpots = (room: Room): Set<string> => {
    if (spotCacheTick !== Game.time) {
        spotCacheTick = Game.time;
        for (const key in spotCache) delete spotCache[key];
    }
    return (spotCache[room.name] ??= collectSpots(room));
};

/** 互斥约束下选离参照点最近的安全点 */
const pickSpot = (
    spots: Set<string>,
    taken: { x: number; y: number }[],
    from: RoomPosition,
): { x: number; y: number } | undefined => {
    let best: { x: number; y: number } | undefined;
    let bestDist = Infinity;
    for (const key of spots) {
        const [x, y] = key.split('/').map(Number);
        if (taken.some(t => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) < 3)) continue;
        const dist = Math.max(Math.abs(from.x - x), Math.abs(from.y - y));
        if (dist < bestDist) { bestDist = dist; best = { x, y }; }
    }
    return best;
};

/** 单 tick 落位主逻辑 */
const runAnchor = (): void => {
    if (Game.time % 10) return;
    const teams = getTeamData() as unknown as Record<string, TeamMemory>;
    if (!teams) return;

    const taken: { x: number; y: number }[] = [];
    const pending: { flag: Flag; room: Room }[] = [];

    for (const teamID in teams) {
        const team = teams[teamID];
        const flag = Game.flags[`Team-${teamID}`];
        if (!flag || !team?.targetRoom || team.status === 'ready') continue;
        // 未入目标房 / 旗不在目标房 / 无视野：不动旗
        if (team.roomName !== team.targetRoom) continue;
        if (flag.pos.roomName !== team.targetRoom) continue;
        const room = Game.rooms[team.targetRoom];
        if (!room) continue;

        const spots = getSpots(room);
        if (spots.has(`${flag.pos.x}/${flag.pos.y}`)) {
            taken.push({ x: flag.pos.x, y: flag.pos.y });
            continue;
        }
        pending.push({ flag, room });
    }

    // 互斥约束下各自就近选点（遍历顺序稳定，间距 ≥3）
    for (const { flag, room } of pending) {
        const spot = pickSpot(getSpots(room), taken, flag.pos);
        if (!spot) continue;
        flag.setPosition(new RoomPosition(spot.x, spot.y, room.name));
        taken.push(spot);
    }
};

/**
 * 要塞服锚点落位模块。
 *
 * @remarks
 * - tick 阶段运行（TeamController 之后）：旗位更新于下一 tick 被队伍状态机消费为推进锚点。
 */
const StrongholdAnchorModule = {
    start: () => {},
    tick: () => runAnchor(),
};

export { StrongholdAnchorModule };
