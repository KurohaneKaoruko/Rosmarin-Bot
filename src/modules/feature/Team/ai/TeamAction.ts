import TeamUtils from '../core/TeamUtils';
import TeamCache from '../infra/TeamCache';
import TeamCalc from '../infra/TeamCalc';
import TeamVisual from '../debug/TeamVisual';
import RoomArray from '../infra/RoomArray'
import { creepPosBipartiteMatch } from '@/utils'

const emptyCostMatrix = new PathFinder.CostMatrix()
const tempRoomArray = new RoomArray()

/**
 * 小队行动
 */
export default class TeamAction {
    /**
     * 位置掩码映射
     */
    public static POS_MARK_MAP = {
        ['↖']: [0, 0],
        ['↗']: [1, 0],
        ['↙']: [0, 1],
        ['↘']: [1, 1],
    }

    /**
     * 低于多少血量的建筑视为可以通行
     */
    public static structHitLimit = 10e3;


    // 调整朝向
    /**
     * 根据 team.toward 对四角位做“微调归位”。
     *
     * @param team 队伍实例
     * @returns 是否尝试执行了调整（满足前置才会返回 true）
     *
     * @remarks
     * - 该方法依赖 TeamUtils.isQuad 与 TeamUtils.inSameRoom，要求队伍已经是可行动矩阵。\n
     * - 仅做角位的微调（move 1 步），不负责集结成矩阵；队形打散时应由 Gather 负责重组。\n
     * - 返回值用于 TeamClass.moved 标记：避免在不满足条件时“空转占用本 tick 的移动机会”。
     */
    public static AdjustToward(team: Team): boolean {
        if (team.creeps.length < 3) return false;
        if (!TeamUtils.isQuad(team)) return false;
        if (!TeamUtils.inSameRoom(team)) return false;

        if (!team.cache) team.cache = {}
        team.cache.lastMoveTick = Game.time
        team.cache.lastMoveDirection = undefined
        team.cache.lastMoveHold = false
        team.cache.lastCreepMoveDirections = {}

        const { minX, maxX, minY, maxY } = TeamUtils.getPosRange(team);
        let [ A1, A2, B1, B2 ] = team.creeps;

        let LT = new RoomPosition(minX, minY, A1.room.name);
        let RT = new RoomPosition(maxX, minY, A1.room.name);
        let LB = new RoomPosition(minX, maxY, A1.room.name);
        let RB = new RoomPosition(maxX, maxY, A1.room.name);

        const setMove = (creep: Creep | undefined, target: RoomPosition) => {
            if (!creep) return
            if (creep.pos.isEqual(target)) return
            const dir = creep.pos.getDirection(target) as DirectionConstant
            if (dir) {
                team.cache.lastCreepMoveDirections[creep.id] = dir
                creep.move(dir)
            }
        }

        switch (team.toward) {
            case '↑':
                setMove(A1, LT)
                setMove(A2, RT)
                setMove(B1, LB)
                setMove(B2, RB)
                break;
            case '↓':
                setMove(A1, RB)
                setMove(A2, LB)
                setMove(B1, RT)
                setMove(B2, LT)
                break;
            case '←':
                setMove(A1, LB)
                setMove(A2, LT)
                setMove(B1, RB)
                setMove(B2, RT)
                break;
            case '→':
                setMove(A1, RT)
                setMove(A2, RB)
                setMove(B1, LT)
                setMove(B2, LB)
                break;
        }
        // 这里不需要精确判断每个 creep 是否真的动了：只要满足前置，说明本 tick 尝试纠偏
        return true;
    }

    // 成员集结
    /**
     * 队伍集结/归位（line/quad 通用）。
     *
     * @param team 队伍实例
     * @returns 是否发出了移动指令（true 表示本 tick 做了集结行为）
     *
     * @remarks
     * - line：队首先走，其余成员跟随前一个成员，必要时可朝目标点集合。\n
     * - quad：计算左上角集结点，检查 2x2 周围地形/建筑/creep，满足条件则各自 moveTo 对应角位。\n
     * - 靠边/空间不足时会返回 false，避免硬集结导致堵边或撞墙。
     */
    public static Gather(team: Team): boolean {
        // 0/1 人队伍不需要集结
        if (team.creeps.length <= 1) return false
        // 线性队形（或人数不足以构成 quad）走 line 集结逻辑
        if (team.formation == 'line') return this.GatherLine(team);
        // 矩阵队形走 quad 集结逻辑
        if (team.formation == 'quad') return this.GatherQuad(team);
        
        // 其他队形不处理
        return false;
    }

    /**
     * line 队形集结/归位（包含 2/3/4 人“跟随队首”的统一处理）。
     *
     * @remarks
     * - 优先响应 TeamGater 旗帜（用于调试/集结点）。\n
     * - 在 homeRoom 内会尝试向旗帜/目标房/出口方向收敛，以便从安全区出发。\n
     * - 其余情况：队首不动/由外层驱动，后续成员跟随前一名成员归位。\n
     */
    public static GatherLine(team: Team): boolean {
        // 3/4 人队伍内部顺序重排：保证“队首→队尾”的跟随链更稳定
        let creeps: Creep[] = []
        if (team.creeps.length === 4) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1], team.creeps[3]]
        } else if (team.creeps.length === 3) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1]]
        } else {
            creeps = team.creeps
        }

        // 优先按 TeamGater 旗帜集结（仅在 homeRoom 生效）
        let GaterFlag = Game.flags['TeamGater']?.pos.roomName === team.homeRoom ? Game.flags['TeamGater'] : null;
        if (GaterFlag) {
            const pos = GaterFlag.pos;
            if (!creeps[0].pos.isEqual(pos))
                creeps[0].moveTo(pos);
            for (let i = 1; i < creeps.length; i++) {
                if (creeps[i].pos.isNearTo(creeps[i - 1].pos)) continue;
                creeps[i].moveTo(creeps[i - 1]);
            }
            return true;
        }

        // 队首的“自驱动”：到目标房后靠旗帜收敛；在 homeRoom 时往目标房中心/出口靠拢
        let head = creeps[0];
        if (team.flag && head.room.name == team.targetRoom) {
            head.moveTo(team.flag);
        } else if (head.room.name == team.homeRoom &&
            head.pos.x > 4 && head.pos.y > 4 && head.pos.x < 45 && head.pos.y < 45
        ) {
            let tarPos = team.flag ? team.flag.pos :
                        team.targetRoom ?
                        new RoomPosition(25, 25, team.targetRoom) :
                        head.room.find(FIND_EXIT)[0];
            head.moveTo(tarPos);
            for (let i = 1; i < creeps.length; i++) {
                if (creeps[i].pos.inRangeTo(tarPos, 2)) continue;
                creeps[i].moveTo(tarPos);
            }
            return true;
        } 

        // 通用跟随：后续成员尽量贴近前一名成员
        for (let i = 1; i < creeps.length; i++) {
            if (creeps[i].pos.isNearTo(creeps[i - 1].pos)) continue;
            creeps[i].moveTo(creeps[i - 1]);
        }
        return true;
    }

    /**
     * quad 队形集结/归位：优先保证“能 1 tick 恢复就 1 tick 恢复”，避免高 CPU 的全量搜索。
     *
     * @remarks
     * - 先在少量高价值候选点中检查：是否存在 1 tick 以内即可恢复 quad 的方案。\n
     * - 若存在：优先精确占位（与 toward 一致），否则选择任意占位先恢复 quad（占位由 AdjustToward 纠偏）。\n
     * - 若不存在：退化为在最近可用 2x2 点上做一次“精确 vs 任意”的步数比较（仅对单个点），避免全局最优搜索。\n
     */
    public static GatherQuad(team: Team): boolean {
        let [ A1, A2, B1, B2 ] = team.creeps;
        // 根据 team.toward 推导“精确占位”时每个角位应该由哪个 creep 承担（不改变 creeps 数组顺序）
        let LT = A1, RT = A2,
            LB = B1, RB = B2;
        switch (team.toward) {
        case '←':
            LT = A2, RT = B2,
            LB = A1, RB = B1;
            break;
        case '→':
            LT = B1, RT = A1,
            LB = B2, RB = A2;
            break;
        case '↓':
            LT = B2, RT = B1,
            LB = A2, RB = A1;
            break;
        }
        // 选一个锚点：优先用推导出的 LT 成员位置；缺失时用 RT 往左一格作为近似锚点
        const pos = LT ? LT.pos : new RoomPosition(RT.pos.x - 1, RT.pos.y, RT.pos.roomName);
        const room = Game.rooms[pos.roomName];
        const terrain = room.getTerrain();

        // 2x2 合法性判定：墙/阻挡建筑/其他 creep/PC 视为不可用
        let structCheck = (s: LookAtResultWithPos) => 
            s.structure.structureType !== STRUCTURE_ROAD &&
            s.structure.structureType !== STRUCTURE_CONTAINER &&
            s.structure.structureType !== STRUCTURE_RAMPART;
        let creepCheck = (c: LookAtResultWithPos) => 
            team.creeps.every(creep => creep.id !== c.creep.id);
        const isValidQuadArea = (p: RoomPosition) => {
            if (p.x < 2 || p.y < 2 || p.x > 47 || p.y > 47) return false;
            if (terrain.get(p.x, p.y) == TERRAIN_MASK_WALL) return false;
            if (terrain.get(p.x, p.y + 1) == TERRAIN_MASK_WALL) return false;
            if (terrain.get(p.x + 1, p.y) == TERRAIN_MASK_WALL) return false;
            if (terrain.get(p.x + 1, p.y + 1) == TERRAIN_MASK_WALL) return false;
            const area = [p.y, p.x, p.y + 1, p.x + 1]
            if (room.lookForAtArea(LOOK_STRUCTURES, area[0], area[1], area[2], area[3], true).filter(structCheck).length) return false;
            if (room.lookForAtArea(LOOK_CREEPS, area[0], area[1], area[2], area[3], true).filter(creepCheck).length) return false;
            if (room.lookForAtArea(LOOK_POWER_CREEPS, area[0], area[1], area[2], area[3], true).length) return false;
            return true;
        }

        // 锚点贴边时向内收敛到 [2..47]，保证候选 top-left 不会越界
        const clamp = (v: number) => Math.min(47, Math.max(2, v));
        const basePos = (pos.x < 2 || pos.y < 2 || pos.x > 47 || pos.y > 47)
            ? new RoomPosition(clamp(pos.x), clamp(pos.y), pos.roomName)
            : pos;

        // Chebyshev 距离：用于估算 “恢复到目标阵形所需 tick（最大者）”
        const getRange = (a: RoomPosition, b: RoomPosition) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

        // 有效成员集合（3/4 人）
        const allCreeps = team.creeps.filter(Boolean) as Creep[]

        // 给定 top-left，生成对应 2x2 的四个角位坐标（TL/TR/BL/BR）
        const quadTargets = (p: RoomPosition) => [
            p,
            new RoomPosition(p.x + 1, p.y, p.roomName),
            new RoomPosition(p.x, p.y + 1, p.roomName),
            new RoomPosition(p.x + 1, p.y + 1, p.roomName),
        ]

        const moveToTarget = (creep: Creep, target: RoomPosition) => {
            if (creep.pos.isEqualTo(target)) return
            if (typeof (creep as any).move === 'function' && typeof creep.pos.getDirectionTo === 'function') {
                const dir = creep.pos.getDirectionTo(target) as DirectionConstant | 0
                if (dir) {
                    ;(creep as any).move(dir)
                    return
                }
            }
            creep.moveTo(target)
        }

        const moveExact = (p: RoomPosition) => {
            const [tl, tr, bl, br] = quadTargets(p)
            if (LT) moveToTarget(LT, tl)
            if (RT) moveToTarget(RT, tr)
            if (LB) moveToTarget(LB, bl)
            if (RB) moveToTarget(RB, br)
        }

        const computeStepsExact = (p: RoomPosition) => {
            const [tl, tr, bl, br] = quadTargets(p)
            let steps = 0
            if (LT) steps = Math.max(steps, getRange(LT.pos, tl))
            if (RT) steps = Math.max(steps, getRange(RT.pos, tr))
            if (LB) steps = Math.max(steps, getRange(LB.pos, bl))
            if (RB) steps = Math.max(steps, getRange(RB.pos, br))
            return steps
        }

        const computeStepsQuadAndAssign = (p: RoomPosition) => {
            const targets = quadTargets(p)
            const n = allCreeps.length
            let bestSteps = Infinity
            let bestAssign: Array<[Creep, RoomPosition]> = []

            const patterns = n === 4 ? TeamUtils.QUAD_ASSIGN_PATTERNS_4 : TeamUtils.QUAD_ASSIGN_PATTERNS_3
            for (let pi = 0; pi < patterns.length; pi++) {
                const pattern = patterns[pi]
                let steps = 0
                for (let i = 0; i < n; i++) {
                    steps = Math.max(steps, getRange(allCreeps[i].pos, targets[pattern[i]]))
                    if (steps >= bestSteps) break
                }
                if (steps >= bestSteps) continue
                bestSteps = steps
                bestAssign = allCreeps.map((c, i) => [c, targets[pattern[i]]])
                if (bestSteps <= 1) break
            }

            return { steps: bestSteps, assign: bestAssign }
        }

        // 在锚点附近收集所有可用 2x2 区域作为候选集结点（top-left）
        const searchRadius = 4
        const candidates: RoomPosition[] = []
        const candidateSet = new Set<number>()
        const pushCandidateIfValid = (x: number, y: number) => {
            const nx = clamp(x)
            const ny = clamp(y)
            const p = new RoomPosition(nx, ny, basePos.roomName)
            const h = nx * 50 + ny
            if (candidateSet.has(h)) return
            candidateSet.add(h)
            if (!isValidQuadArea(p)) return
            candidates.push(p)
        }

        pushCandidateIfValid(basePos.x, basePos.y)
        allCreeps.forEach((c) => {
            const cx = c.pos.x
            const cy = c.pos.y
            pushCandidateIfValid(cx, cy)
            pushCandidateIfValid(cx - 1, cy)
            pushCandidateIfValid(cx, cy - 1)
            pushCandidateIfValid(cx - 1, cy - 1)
        })

        if (!candidates.length) {
            for (let r = 1; r <= searchRadius; r++) {
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        pushCandidateIfValid(basePos.x + dx, basePos.y + dy)
                    }
                }
                if (candidates.length) break
            }
        }
        if (!candidates.length) return false

        // 优先：能 1 tick 精确占位就直接精确占位
        for (let i = 0; i < candidates.length; i++) {
            const p = candidates[i]
            if (computeStepsExact(p) <= 1) {
                moveExact(p)
                return true
            }
        }

        // 次优：能 1 tick 恢复 quad（任意占位）就直接恢复 quad
        for (let i = 0; i < candidates.length; i++) {
            const p = candidates[i]
            const quad = computeStepsQuadAndAssign(p)
            if (quad.steps <= 1) {
                quad.assign.forEach(([creep, target]) => moveToTarget(creep, target))
                return true
            }
        }

        // 兜底：在有限候选点内做一次“近似最优”选择，避免全量最优搜索
        // - 只评估少量 topK（按离 basePos 的 Chebyshev 距离排序）
        // - 仍保留“步数相同优先精确占位”的偏好
        const topK = Math.min(6, candidates.length)
        candidates.sort((a, b) => getRange(a, basePos) - getRange(b, basePos))

        let bestPos: RoomPosition | null = null
        let bestUseExact = true
        let bestSteps = Infinity
        let bestAssign: Array<[Creep, RoomPosition]> = []

        for (let i = 0; i < topK; i++) {
            const p = candidates[i]
            const exactSteps = computeStepsExact(p)
            const quad = computeStepsQuadAndAssign(p)
            const useExact = exactSteps <= quad.steps
            const chosenSteps = useExact ? exactSteps : quad.steps

            if (chosenSteps > bestSteps) continue
            if (chosenSteps === bestSteps && bestUseExact && !useExact) continue

            bestPos = p
            bestSteps = chosenSteps
            bestUseExact = useExact
            bestAssign = quad.assign
        }

        if (!bestPos) bestPos = candidates[0]
        if (bestUseExact) {
            moveExact(bestPos)
            return true
        }
        bestAssign.forEach(([creep, target]) => moveToTarget(creep, target))
        return true;
    }

    /**
     * 线性队形组成四人队形
     */
    public static formLineToQuad(team: Team) {
        if (team.creeps.length < 3) return false;
        if (!TeamUtils.isLinear(team)) return false;
        let creeps = team.creeps;
        // 获取中间两个爬，即：有两个相邻爬的爬
        // o-o-o-o or o-o-o
        const middleCreeps = creeps.filter((creep) => {
            const nearCreeps = creeps.filter((other) => creep !== other && creep.pos.isNearTo(other))
            return nearCreeps.length === 2
        })

        // 3 个爬时可能小于 2，这时候把队首加进去
        if (middleCreeps.length < 2) {
            middleCreeps.push(creeps[0])
        }
        const [middlePos1, middlePos2] = middleCreeps.map((creep) => creep.pos)
        const creepPosHashSet = new Set(creeps.map((creep) => creep.pos.hashCode()))

        // 中间的两个爬只有 6 种姿势，设 o 为爬，- 为空位
        // 1. o-   2. -o   3. oo  4. --  5. o-   6. -o
        //    -o      o-      --     oo     o-      -o
        // 我们要做的就是判断是哪种情况，然后把其他的爬填入空位（使用二分匹配）

        // 生成四个坐标
        const genRoomPositions = (x1: number, y1: number, x2: number, y2: number) => {
            return [
                middlePos1,
                middlePos2,
                new RoomPosition(x1, y1, middlePos1.roomName),
                new RoomPosition(x2, y2, middlePos2.roomName),
            ]
        }

        // 二分匹配
        const bipartiteMatch = (creeps: Creep[], pos: RoomPosition[]) => {
            // 检查后两个位置是否有效
            if (pos.find((p) => !creepPosHashSet.has(p.hashCode()) && !p.walkable(true))) return {}

            return creepPosBipartiteMatch(creeps, pos)
        }

        let result: Record<string, RoomPosition> = {}
        // 情况 5,6
        if (middlePos1.x === middlePos2.x) {
            const minY = Math.min(middlePos1.y, middlePos2.y)

            // 情况 5
            result = bipartiteMatch(creeps, genRoomPositions(middlePos1.x + 1, minY, middlePos1.x + 1, minY + 1))
            if (Object.keys(result).length !== creeps.length) {
                // 情况 6
                result = bipartiteMatch(creeps, genRoomPositions(middlePos1.x - 1, minY, middlePos1.x - 1, minY + 1))
            }
        }
        // 情况 3,4
        else if (middlePos1.y === middlePos2.y) {
            const minX = Math.min(middlePos1.x, middlePos2.x)

            // 情况 3
            result = bipartiteMatch(creeps, genRoomPositions(minX, middlePos1.y + 1, minX + 1, middlePos1.y + 1))
            if (Object.keys(result).length !== creeps.length) {
                // 情况 4
                result = bipartiteMatch(creeps, genRoomPositions(minX, middlePos1.y - 1, minX + 1, middlePos1.y - 1))
            }
        }
        // 情况 1,2
        else {
            const minX = Math.min(middlePos1.x, middlePos2.x)
            const minY = Math.min(middlePos1.y, middlePos2.y)
            const roomName = middlePos1.roomName

            // 情况 3
            result = bipartiteMatch(creeps, [
                new RoomPosition(minX, minY, roomName),
                new RoomPosition(minX, minY + 1, roomName),
                new RoomPosition(minX + 1, minY, roomName),
                new RoomPosition(minX + 1, minY + 1, roomName),
            ])
        }

        if (Object.keys(result).length !== creeps.length) {
            return false
        }

        creeps.forEach((creep) => {
            const targetPos = result[creep.name]
            if (!creep.pos.isEqualTo(targetPos)) {
                creep.move(creep.pos.getDirectionTo(targetPos))
            }
        })
        return true
    }

    // 线性队形移动到目标
    /**
     * 线性队形推进（队首 moveTo，队尾跟随）。
     *
     * @param team 队伍实例
     * @param pos 目标位置（默认队伍指挥旗）
     * @param reverse 是否反向（用于特殊场景：以队尾为“头”推进）
     *
     * @remarks
     * - 当队形已线性相连时，后续成员用 move(directionTo(prev)) 追随，降低 moveTo 的 CPU。\n
     * - 队首处于边界时允许直接 moveTo 目标，用于跨房/出入口通过。\n
     * - 内部会在同房且已到达/疲劳时早退，避免无意义移动。
     */
    public static LinearMove(team: Team, pos: RoomPosition = team.flag.pos, reverse = false): void {
        if (team.creeps.length == 0) return;
        if (!pos) pos = team.flag.pos;
        if (!pos) return;

        // 单个creep直接移动
        if (team.creeps.length == 1) {
            let creep = team.creeps[0];
            if (creep.pos.isEqualTo(pos)) return;
            creep.moveTo(pos);
            return;
        }

        let creeps: Creep[] = []
        if (team.creeps.length === 4) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1], team.creeps[3]]
        } else if (team.creeps.length === 3) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1]]
        } else {
            creeps = team.creeps
        }

        if (reverse) creeps.reverse();

        if (!team.cache) team.cache = {}
        team.cache.lastMoveTick = Game.time
        const headDirection = creeps[0]?.pos?.getDirectionTo(pos) as DirectionConstant | 0
        team.cache.lastMoveDirection = headDirection ? headDirection : undefined
        team.cache.lastMoveHold = false
        delete team.cache.lastCreepMoveDirections

        // 队伍是否保持直形
        const isLine = TeamUtils.isLinear(team);
        // 到达目标或有creep疲劳则停止
        if (TeamUtils.inSameRoom(team) && isLine &&
            creeps.some(c => c.pos.isEqualTo(pos) || c.fatigue > 0)) {
            return;
        }

        let headMove = isLine || creeps[0].pos.isRoomEdge();
        for (let i = 1; !headMove && (i < creeps.length); i++) {
            if (creeps[i].pos.isNearTo(creeps[i-1])) {
                headMove = creeps[i].pos.isRoomEdge();
            } else break;
        }

        let moved = [false, false, false, false];
        if (headMove) {
            creeps[0].moveTo(pos, { ignoreCreeps: false });
            moved[0] = true;
        }

        for (let i = 1; i < creeps.length; i++) {
            let creep = creeps[i];
            let prevCreep = creeps[i - 1];

            if (isLine) {
                creep.move(creep.pos.getDirectionTo(prevCreep));
                continue;
            }

            if (!creep.pos.isNearTo(prevCreep)) {
                creep.moveTo(prevCreep, { ignoreCreeps: false });
                moved[i] = true;
            } else if (moved[i - 1]) {
                creep.move(creep.pos.getDirectionTo(prevCreep));
                moved[i] = true;
            }
        }
    }


    // 方阵移动
    /**
     * 矩阵队形推进（按方向整体移动）。
     *
     * @remarks
     * - 多人队伍（>=3）跨房穿边时优先保持同向同步移动，以保证治疗覆盖与承伤分摊。\n
     * - 但当“移动会导致下一 tick 阵型打散，而停 1 tick 可以保持 quad”时，会选择停 1 tick 等待边界传送完成。\n
     * - 2 人队伍在无方向时会尝试把边界上的成员挪到内侧空位，减少“贴边抖动”。\n
     * - 有 fatigue 时直接停止，避免队形撕裂。
     */
    public static move(team: Team, direction: DirectionConstant): void {
        // 存在疲劳的creep则停止
        if (TeamUtils.hasCreepFatigue(team)) return;

        /**
         * 运行期调试字段：记录队伍在本 tick 的“移动决策”，供可视化模块读取。
         * - lastMoveTick：写入的 tick（仅当等于 Game.time 时可视化才会绘制）
         * - lastMoveDirection：本 tick 计算出的方向（可能为 undefined，表示无方向）
         * - lastMoveHold：是否决定“停 1 tick 等待边界传送”，用于跨房穿边过渡态保持阵型
         */
        if (!team.cache) team.cache = {}
        team.cache.lastMoveTick = Game.time
        team.cache.lastMoveDirection = direction
        team.cache.lastMoveHold = false
        delete team.cache.lastCreepMoveDirections

        const creeps = team.creeps;
        // 没有方向
        if (!direction) {
            if (creeps.length !== 2) return
            // 2 人小队看一下第二个爬是否在边界，如果是就移动到周围不是边界的空位
            if (creeps[0].pos.isNearTo(creeps[1]) && creeps[1].pos.isRoomEdge()) {
                this.moveOuterBorder(creeps[1], creeps[0])
            }
            return
        }

        // 多人小队穿边：保持同步同向移动，尽量维持 quad 紧密度，减少边缘承伤导致治疗覆盖不足
        if (creeps.length >= 3) {
            if (
                creeps.some(
                    (creep) => creep.pos.isRoomEdge() && creep.pos.getDirectPos(direction).roomName != creep.pos.roomName,
                )
            ) {
                // 穿边时可能出现“队伍被拆成两房”的过渡态：如果继续移动会打散 quad，而站桩 1 tick 能保持 quad，
                // 则本 tick 不下发 move，等待边界传送把队伍合回同一侧后再继续推进。
                const holdQuad = TeamUtils.willTeamBeQuadNextTick(team, undefined)
                const moveQuad = TeamUtils.willTeamBeQuadNextTick(team, direction)
                if (holdQuad && !moveQuad) {
                    team.cache.lastMoveHold = true
                    return
                }
                creeps.forEach((creep) => creep.move(direction))
                return
            }
        }

        if (creeps.length >= 3) {
            creeps.forEach((creep) => creep.move(direction))
        } else if (creeps.length === 1) {
            creeps[0].move(direction)
        } else {
            // 二人小队，如果是躲避或者逃跑，反过来移动
            if (team.status === 'avoid' || team.status === 'flee') {
                creeps[1].move(direction)
                if (creeps[0]) {
                    creeps[0].move(creeps[0].pos.getDirectionTo(creeps[1]))
                }
            } else {
                creeps[0].move(direction)
                if (creeps[1]) {
                    creeps[1].move(creeps[1].pos.getDirectionTo(creeps[0]))
                }
            }
        }
        return;
    }

    // 方阵移动到目标
    /**
     * quad 队形朝目标点移动（内部先算方向再调用 move）。
     *
     * @param team 队伍实例
     * @param targetPos 目标位置
     */
    public static QuadMoveTo(team: Team, targetPos: RoomPosition): void {
        // 获取移动方向
        let d = this.getTeamMoveDirection(team, [{pos:targetPos}]);
        return this.move(team, d);
    }


    /**
     * 计算 tick 步内能否走到目标指定范围内
     * 用于 tick 较小的场景
     */
    public static touchableNTickInRange(
        creep: Creep,
        targetPos: RoomPosition,
        tick: number,
        range: number,
        plainCost = 1,
    ) {
        if (tick > 100) throw new Error(`tick 数量过大，可能会导致性能问题`)
        if (tick === 0) return creep.pos.inRangeTo(targetPos, range)

        const username = creep.owner.username
        const goal = { pos: targetPos, range }
        const result = PathFinder.search(creep.pos, [goal], {
            maxCost: tick,
            plainCost,
            swampCost: plainCost * 5,
            roomCallback: (roomName) => {
                const room = Game.rooms[roomName]
                if (!room) return emptyCostMatrix

                if (!Game['_username_costs']) Game['_username_costs'] = {}
                const id = roomName + username

                if (!Game['_username_costs'][id]) {
                    const costs = new PathFinder.CostMatrix()

                    const structures = TeamCache.getStructures(roomName);
                    structures.forEach((struct) => {
                        if (struct.structureType === STRUCTURE_ROAD) {
                            const cost = Math.max(1, costs.get(struct.pos.x, struct.pos.y));
                            costs.set(struct.pos.x, struct.pos.y, cost)
                        } else if (struct.structureType !== STRUCTURE_RAMPART || !struct.my) {
                            costs.set(struct.pos.x, struct.pos.y, 255)
                        }
                    })
                    

                    Game['_username_costs'][id] = costs
                }

                return Game['_username_costs'][id]
            },
        })

        return !result.incomplete
    }

    /**
     * 锁定目标位置
     */
    public static focusTarget(team: Team, originPos: RoomPosition) {
        let targets: (Creep | Structure)[] = []
        if (team['_attackTargets']?.length) {
            targets = team['_attackTargets']
        } else if (team['_targets']?.length) {
            targets = team['_targets'].filter((s) => 'hits' in s) as (Creep | Structure)[]
        }
        return originPos.findClosestByRange(targets)
    }


     /**
     * 四人小队变换队形，使得攻击力最大的两个爬朝向目标
     *
     * @returns 是否变换过队形
     */
     public static switchTeam4Pos(team: Team) {
        if (team.status === 'flee') return false

        const creeps = team.creeps
        if (creeps.length <= 2) return false

        const originPos = TeamUtils.getTeamPos(team)!
        const cachedTargetPos = TeamUtils.getCachePos(team, 'targetPos')
        const targetPos = cachedTargetPos || this.focusTarget(team, originPos)?.pos || team.flag.pos

        if (!targetPos) return false

        // 目标位置相对于左上角的坐标
        const { x, y } = targetPos.crossRoomSubPos(originPos)
        // 目标位置相对于四人小队中心的坐标
        const dx = x - 0.5
        const dy = y - 0.5
        // 绝对值
        const adx = Math.abs(dx)
        const ady = Math.abs(dy)

        // 过远不管
        if (adx >= 5 || ady >= 5) return false

        // 在对角线附近会因为抖动反复切朝向：加一层阈值，只有主轴明显占优才允许切换
        if (Math.abs(adx - ady) <= 1) {
            return false
        }

        const lastSwitchTick = team.cache?.lastTowardSwitchTick || 0
        if (Game.time - lastSwitchTick < 2) return false

        // 是否交换了位置
        let switched = false

        // 小队在右边，攻击爬调到左边
        if (dx < 0 && adx > ady) {
            switched = team.toward != '←'
            team.toward = '←';
            
        }
        // 小队在左边，攻击爬调到右边
        else if (dx > 0 && adx > ady) {
            switched = team.toward != '→'
            team.toward = '→';
        }
        // 小队在下边，攻击爬调到上边
        else if (dy < 0 && adx < ady) {
            switched = team.toward != '↑'
            team.toward = '↑';
        }
        // 小队在上边，攻击爬调到下边
        else if (dy > 0 && adx < ady) {
            switched = team.toward != '↓'
            team.toward = '↓';
        }

        if (switched) {
            if (!team.cache) team.cache = {}
            team.cache.lastTowardSwitchTick = Game.time
        }
        return switched
    }

    /**
     * 根据缓存路径返回方向
     */
    public static getDirectionByCachePath(team: Team) {
        const originPos = TeamUtils.getTeamPos(team)!
        const path = TeamCache.cacheTeamPath[team.name]

        if (!path || !path.length) return undefined

        let nextPos = path[0]
        let direction = originPos.getDirectionTo(nextPos)
        path.shift()
        if (!direction && path.length) {
            // 边界
            nextPos = path[0]
            direction = originPos.getDirectionTo(nextPos)
            path.shift()
        }

        if (this.hasObstacleInPath(team.creeps, nextPos)) {
            return undefined
        }

        return direction
    }

    /**
     * 是否有东西挡在路径上
     */
    public static hasObstacleInPath(creeps: Creep[], nextPos: RoomPosition) {
        if (!nextPos) return true

        const directions = [RIGHT, BOTTOM_RIGHT, BOTTOM]
        const isFourTeam = creeps.length >= 3
        const posList = isFourTeam ? directions.map((dir) => nextPos.getDirectPos(dir)) : []
        posList.push(nextPos)

        const creepsPosSet = new Set(creeps.map((creep) => creep.pos.hashCode()))

        return !!posList.find((pos) => !creepsPosSet.has(pos.hashCode()) && !pos.walkable(true))
    }

    /**
     * 相邻移动，小队中只有一个爬与目标相邻时，通过该方法获取下一步的移动方向使得攻击姿态最佳（有两个爬相邻）
     *
     * @return 返回移动的方向
     */
    public static getSamllMoveDirection(team: Team, targetPos: RoomPosition) {
        const creeps = team.creeps;
        // 左上角坐标
        const originPos = TeamUtils.getTeamPos(team)!

        // 检查指定方向小队是否可以移动
        const checkTeamMoveAble = (direction: DirectionConstant) => {
            // 移动后的左上角坐标
            const pos = originPos.getDirectPos(direction)
            // 移动后的小队位置
            const nextTeamPos = Object.values(this.POS_MARK_MAP).map(([x, y]) => {
                return new RoomPosition(pos.x + x, pos.y + y, pos.roomName)
            })
            // 移动后需要检查的小队位置，如果有位置等于现有的爬的位置则不用检查
            const nextCheckPos = nextTeamPos.filter((pos) => !creeps.some((creep) => creep.pos.isEqualTo(pos)))
            // 需要考虑其他爬
            return nextCheckPos.every((pos) => pos.walkable(true))
        }

        const diffX = targetPos.x - originPos.x
        const diffY = targetPos.y - originPos.y
        if (diffX == -1 && diffY == -1) {
            // 左上角
            if (checkTeamMoveAble(LEFT)) return LEFT
            if (checkTeamMoveAble(TOP)) return TOP
        } else if (diffX == 2 && diffY == -1) {
            // 右上角
            if (checkTeamMoveAble(TOP)) return TOP
            if (checkTeamMoveAble(RIGHT)) return RIGHT
        } else if (diffX == 2 && diffY == 2) {
            // 右下角
            if (checkTeamMoveAble(RIGHT)) return RIGHT
            if (checkTeamMoveAble(BOTTOM)) return BOTTOM
        } else if (diffX == -1 && diffY == 2) {
            // 左下角
            if (checkTeamMoveAble(BOTTOM)) return BOTTOM
            if (checkTeamMoveAble(LEFT)) return LEFT
        }

        return undefined
    }

    /**
     * 获取 CostMatrix
     *
     * @param roomName 房间名
     * @param myCreeps 我的爬
     * @param avoidObjects 需要避开的对象
     * @param damageLimit 伤害阈值
     * @param damageRangePlus 伤害范围增加
     * @param isFourTeam 是否是四人小队
     * @param swampCost 沼泽消耗
     * @param structHitLimit 建筑血量阈值，低于该值的建筑不会被视为障碍物
     * @param isSpawnDanger spawn 是否危险，即 spawn 周围 1 格是否禁止通行
     */
    public static getMoveAbleCostMatrix(
        roomName: string,
        myCreeps: Creep[],
        avoidObjects?: { pos: RoomPosition; range: number }[],
        damageLimit = 0,
        damageRangePlus = 0,
        isFourTeam = false,
        swampCost = 5,
        structHitLimit = this.structHitLimit,
        isSpawnDanger = false,
    ) {
        const costs = new PathFinder.CostMatrix()
        const terrain = new Room.Terrain(roomName)
        const room = Game.rooms[roomName]
        const towerDamageMap =
            damageLimit > 0 && (!room || room.my)
                ? TeamCache.getTowerDamageMap(roomName)
                : TeamCache.emptyRoomArray

        // 设置地形数据，同时避开塔伤会导致破防的地方
        towerDamageMap.forEach((x, y, damage) => {
            const terrainType = terrain.get(x, y)
            costs.set(
                x,
                y,
                terrainType === TERRAIN_MASK_WALL ? 255 : terrainType === TERRAIN_MASK_SWAMP ? swampCost : 1,
            )
            // 超过伤害阈值的地方设置为无法通过
            if (damage > damageLimit && terrainType !== TERRAIN_MASK_WALL) {
                costs.set(x, y, 254)
            }
        })

        const structures = TeamCache.getStructures(roomName)

        structures.forEach((struct) => {
            if (struct.structureType === STRUCTURE_ROAD) {
                costs.set(struct.pos.x, struct.pos.y, 1)
            }
        })

        // 不能行走的建筑
        structures.forEach((struct) => {
            if (
                struct.structureType !== STRUCTURE_ROAD &&
                struct.structureType !== STRUCTURE_CONTAINER &&
                (struct.structureType !== STRUCTURE_RAMPART || !struct.my)
            ) {
                if (!struct.hits || struct.hits >= structHitLimit) {
                    costs.set(struct.pos.x, struct.pos.y, 255)
                } else {
                    costs.set(struct.pos.x, struct.pos.y, 100)
                }
            }

            if (isSpawnDanger && struct.structureType === STRUCTURE_SPAWN) {
                struct.pos.nearPos().forEach((pos) => {
                    costs.set(pos.x, pos.y, 249)
                })
            }
        })

        const myCreepsIdSet = new Set(myCreeps.map((creep) => creep.id))
        let init = false

        if (room) {
            // 房间存在的话，避开房间中的非小队 creep，暂时不考虑 pc（不会真有 pc 直接撞上来吧？）
            room.find(FIND_CREEPS).forEach((creep) => {
                if (!myCreepsIdSet.has(creep.id)) {
                    costs.set(creep.pos.x, creep.pos.y, 255)
                }

                if (creep.my) return;
                // 敌人单位要计算周围伤害
                const atkDamage = TeamCalc.calcAttackDamage(creep)
                const rangeDamage = TeamCalc.calcRangeDamage(creep)

                if (atkDamage + rangeDamage > 0 && !init) {
                    init = true
                    tempRoomArray.fill(0)
                }

                // 如果敌人疲劳, 则缩短范围
                const rangeMinus = creep.fatigue > 80 ? 1 : 0;

                if (atkDamage > 0) {
                    tempRoomArray.forNear(creep.pos.x, creep.pos.y, 2 + damageRangePlus - rangeMinus, (x, y, val) => {
                        tempRoomArray.set(x, y, val + atkDamage)
                    })
                }

                if (rangeDamage > 0) {
                    tempRoomArray.forNear(creep.pos.x, creep.pos.y, 4 + damageRangePlus - rangeMinus, (x, y, val) => {
                        tempRoomArray.set(x, y, val + rangeDamage)
                    })
                    tempRoomArray.forNear(creep.pos.x, creep.pos.y, 2 + damageRangePlus - rangeMinus, (x, y, val) => {
                        // 对四人小队的多余伤害：1 + 0.4 + 0.4 = 1.8
                        tempRoomArray.set(x, y, val + rangeDamage * 1.8)
                    })
                }
            })
        }

        if (init) {
            tempRoomArray.forEach((x, y, val) => {
                const damage = towerDamageMap.get(x, y) + val
                // 超过伤害阈值的地方设置为几乎无法通过
                if (damage > damageLimit && costs.get(x, y) < 249) {
                    costs.set(x, y, 249)
                }
            })
        }

        if (avoidObjects?.length) {
            avoidObjects.forEach((e) => {
                if (e.pos.roomName !== roomName) return

                tempRoomArray.forNear(e.pos.x, e.pos.y, e.range, (x, y, _) => {
                    if (costs.get(x, y) < 249) costs.set(x, y, 249)
                })
            })
        }

        let val: number
        for (let x = 0; x < 49; x++) {
            for (let y = 0; y < 49; y++) {
                val = costs.get(x, y)
                if (val < 250 && terrain.get(x, y) === TERRAIN_MASK_SWAMP) {
                    costs.set(x, y, val + 5)
                }
            }
        }

        if (isFourTeam) {
            // 如果是四人小队就调整一下
            for (let x = 0; x < 49; x++) {
                for (let y = 0; y < 49; y++) {
                    // 尽量不出房间
                    if (x == 0 || y == 0 || y == 48 || x == 48 || x == 49 || y == 49) {
                        costs.set(x, y, Math.max(costs.get(x, y), 50))
                    }

                    const c = Math.max(
                        costs.get(x, y),
                        costs.get(x + 1, y),
                        costs.get(x, y + 1),
                        costs.get(x + 1, y + 1),
                    )
                    costs.set(x, y, c)
                }
            }
        }

        return costs
    }

    /**
     * 获取小队移动方向
     */
    public static getTeamMoveDirection(team: Team, goals: {pos: RoomPosition}[], pathMode?: 'flee') {
        const creeps = team.creeps
        const originPos = TeamUtils.getTeamPos(team)!
        const status = pathMode || team.status
        const needAvoid = status === 'flee' || status === 'avoid'
        const isFlee = status === 'flee'
        const oldMoveMode = team.moveMode
        const isFourTeam = creeps.length >= 3
        const teamFlag = team.flag
        const safeGoals = (goals || []).filter((g: any) => g && g.pos) as { pos: RoomPosition }[]
        team.moveMode = status

        // 和上一 tick 的移动模式相同，并且不需要避让，则检查缓存并按缓存移动
        if (!needAvoid && status === oldMoveMode &&
            teamFlag && originPos.roomName !== teamFlag.pos.roomName &&
            this.checkCachePath(team)
        ) {
            return this.getDirectionByCachePath(team)
        } else {
            this.clearPathCache(team)
        }


        // 和爬相邻的目标
        const nearGoals = safeGoals.filter((goal) => creeps.find((creep) => creep.pos.isNearTo(goal.pos)))
        if (!needAvoid && nearGoals.length) {
            // 当第一个目标是旗帜，代表没有其他目标
            if (nearGoals[0] instanceof Flag) {
                return this.getSamllMoveDirection(team, nearGoals[0].pos)
            }

            // 找血量最少的那个
            const target = (nearGoals as (Creep | Structure)[]).reduce((min, cur) => (min.hits < cur.hits ? min : cur))
            if (isFourTeam) {
                return this.getSamllMoveDirection(team, target.pos)
            } else if (target instanceof Creep) {
                return originPos.getDirectionTo(target.pos)
            }
            
        }

        const allGoals: { pos: RoomPosition; range: number }[] = []
        // 修改范围，逃跑模式下避开有攻击力的爬
        safeGoals.forEach((goal: any) => {
            // 逃跑状态只避开爬和塔
            if (isFlee && !(goal instanceof Creep) && !(goal instanceof StructureTower)) return

            goal['_range'] =
                !isFlee
                    ? 1
                    : !(goal instanceof Creep)
                    ? 50
                    : goal.getActiveBodyparts(RANGED_ATTACK)
                    ? 5
                    : goal.getActiveBodyparts(ATTACK)
                    ? 3
                    : 1

            // 调整 spawn 的范围，避免被踩死
            if (goal instanceof StructureSpawn &&
                teamFlag &&
                !(goal.pos.isEqualTo(teamFlag.pos)) &&
                !(teamFlag.secondaryColor == COLOR_RED)) {
                goal['_range'] = 2
            }
            const allowEdgeChase = !needAvoid && goal && 'hits' in goal
            const pos = allowEdgeChase && goal.pos?.isRoomEdge?.() ? TeamUtils.pushInsideRoomPos(goal.pos, 1) : goal.pos
            allGoals.push({ pos, range: goal['_range'] })
        })

        if (isFlee) {
            allGoals.push(...(team['_avoidObjs'] || []))
            if (allGoals.length === 0) {
                let towers = Game.rooms[originPos.roomName]?.tower || [];
                allGoals.push(...towers.map((tower) => ({ pos: tower.pos, range: 50 })))
            }
            
            // 逃跑时尝试往家里跑，或者是最近的安全出口
            // 添加通往 homeRoom 的出口作为目标
            if (team.homeRoom && originPos.roomName !== team.homeRoom) {
                const route = Game.map.findRoute(originPos.roomName, team.homeRoom);
                if (route && route !== ERR_NO_PATH && route.length > 0) {
                    const exitDir = route[0].exit;
                    const exit = originPos.findClosestByRange(exitDir);
                    if (exit) {
                        // 设为极高优先级（range 很大，因为排序是 b.range - a.range）
                        // 但实际上 PathFinder 的 goal 是 range 越小越好到达，这里逻辑有点绕
                        // 上面代码是 allGoals.sort((a, b) => b.range - a.range)， range 大的排前面
                        // 而在 Flee 模式下，PathFinder 是远离 goals。
                        // 所以这里如果是为了"去"某个地方，不能直接加到 flee 的 goals 里。
                        // Flee 模式下的 PathFinder 只能用来"远离"危险。
                        // 如果要"去"安全的地方，应该把安全地点设为 PathFinder 的目标，并把 flee 设为 false。
                        // 但目前的架构限制了 getTeamMoveDirection 必须一次性决定。
                        
                        // 妥协方案：如果周围没有危险源，或者危险源很远，就切换回普通移动模式去安全点。
                        // 现有的逻辑是：只要 status 是 flee，就强制 flee。
                        const exitDirection = originPos.getDirectionTo(exit) as DirectionConstant | 0
                        if (exitDirection) {
                            const calcClearance = (pos: RoomPosition) => {
                                let min = Infinity
                                safeGoals.forEach((g: any) => {
                                    if (!g?.pos) return
                                    if (g.pos.roomName !== pos.roomName) return
                                    let dangerRange = 0
                                    if (g instanceof StructureTower) dangerRange = 20
                                    else if (g instanceof Creep) dangerRange = g['_range'] || 0
                                    else return
                                    min = Math.min(min, pos.getRangeTo(g.pos) - dangerRange)
                                })
                                ;(team['_avoidObjs'] || []).forEach((o: any) => {
                                    if (!o?.pos) return
                                    if (o.pos.roomName !== pos.roomName) return
                                    const dangerRange = o.range || 0
                                    min = Math.min(min, pos.getRangeTo(o.pos) - dangerRange)
                                })
                                return min
                            }

                            const curClearance = calcClearance(originPos)
                            const nextPos = originPos.getDirectPos(exitDirection)
                            const nextClearance = calcClearance(nextPos)
                            if ((curClearance >= 4 && nextClearance >= 0) || nextClearance >= curClearance) {
                                return exitDirection
                            }
                        }
                    }
                }
            }
        }

        const newGoals: { pos: RoomPosition; range: number }[] = []
        const visited = new Set<number>()
        const rangePlus = status === 'flee' ? 2 : status === 'avoid' ? 1 : 0

        allGoals.sort((a, b) => b.range - a.range)

        // 一体机或者二人小队模式
        if (!isFourTeam) {
            allGoals.forEach((goal) => {
                // 不考虑在房间边缘的目标
                if (goal.pos.isRoomEdge()) return;

                if (visited.has(goal.pos.hashCode())) return

                visited.add(goal.pos.hashCode())
                newGoals.push({ pos: goal.pos, range: goal.range + rangePlus })
            })
        } else {
            // 四人小队模式
            allGoals.forEach((goal) => {
                // 不考虑在房间边缘的目标
                if (goal.pos.isRoomEdge()) return

                for (const item of [
                    [0, 0],
                    [-1, 0],
                    [0, -1],
                    [-1, -1],
                ]) {
                    const raw = new RoomPosition(goal.pos.x + item[0], goal.pos.y + item[1], goal.pos.roomName)
                    const pos = TeamUtils.pushInsideRoomPos(raw, 1)
                    if (visited.has(pos.hashCode())) return

                    visited.add(pos.hashCode())
                    newGoals.push({ pos, range: goal.range + rangePlus })
                }
            })
        }

        // 调试
        const costMatrixFlag = Game.flags[`costMatrixShow`]

        const result = PathFinder.search(originPos, newGoals, {
            roomCallback: (roomName) => {
                if (Memory['bypassRooms'] && Memory['bypassRooms'].includes(roomName)) return false

                // 防止 costMatrix 缓存长期堆积：同 tick 内只会清理一次（内部有 tick 去重）
                TeamCache.cleanupGlobalCostMatrixCache(Game.time)

                // 生成稳定的避让对象哈希：只让“位于该房间的避让对象”影响 key，
                // 避免跨房间时避让对象变化导致缓存抖动，同时防止简单 key 撞车。
                let avoidHash = ''
                const avoidObjs = team['_avoidObjs'] as { pos: RoomPosition; range?: number }[] | undefined
                if (avoidObjs?.length) {
                    const objsInRoom = avoidObjs.filter((o) => o.pos.roomName === roomName)
                    if (objsInRoom.length) {
                        const signature = objsInRoom
                            .map((o) => `${o.pos.x},${o.pos.y},${o.range || 0}`)
                            .sort()
                            .slice(0, 12)
                            .join('|')
                        let hash = 0
                        for (let i = 0; i < signature.length; i++) hash = (hash * 31 + signature.charCodeAt(i)) | 0
                        avoidHash = `_${objsInRoom.length}_${(hash >>> 0).toString(36)}`
                    }
                }

                // 可见房间：CostMatrix 会把“非本队伍 creep”当成障碍（255），因此必须按队伍隔离缓存，
                // 否则多队伍同 tick 会互相复用矩阵，导致寻路失败/原地不动。
                const isVisible = !!Game.rooms[roomName]
                const structHitLimit = team.cache.structHitLimit || this.structHitLimit
                const isSpawnDanger = !!team.cache.isSpawnDanger
                const damageLimit = team['_max_damage'] || 0
                const swampCost = needAvoid ? 50 : 5
                const isFourTeam = creeps.length >= 3

                // 缓存 key 需要包含所有会改变矩阵的关键参数，避免“不同参数共用同一矩阵”带来矛盾：
                // - isFourTeam：4 人/3 人会用 2x2 逻辑抬高 cost
                // - rangePlus / swampCost：避伤/绕路策略差异
                // - structHitLimit / isSpawnDanger：通行建筑阈值与 spawn 周边禁行
                // - damageLimit：基于伤害阈值的禁行区域
                const paramKey = `p${isFourTeam ? 1 : 0}_${rangePlus}_${swampCost}_${structHitLimit}_${isSpawnDanger ? 1 : 0}_${damageLimit}`

                // 缓存有效期：可见房间 1 tick（及时反映 creep 占位变化），不可见房间 5 tick（降低 CPU）。
                const cacheKey = `${roomName}${avoidHash}_${paramKey}${isVisible ? `_t${team.name}` : ''}`
                const cached = TeamCache.globalCostMatrixCache[cacheKey]
                if (cached && Game.time - cached.tick < (isVisible ? 1 : 5)) return cached.matrix

                const costs = this.getMoveAbleCostMatrix(
                    roomName,
                    creeps,
                    team['_avoidObjs'],
                    damageLimit,
                    rangePlus,
                    isFourTeam,
                    swampCost,
                    structHitLimit,
                    isSpawnDanger,
                )

                // 更新缓存
                TeamCache.globalCostMatrixCache[cacheKey] = {
                    matrix: costs,
                    tick: Game.time
                };

                if (costMatrixFlag && costMatrixFlag.pos.roomName === roomName && costMatrixFlag.color === COLOR_RED) {
                    TeamVisual.drawRoomArray(roomName, costs)
                }

                return costs
            },
            flee: status === 'flee',
            maxRooms: originPos.roomName === team.flag.pos.roomName ? 2 : 20,
            maxOps: 8000,
        })

        // 没找到路径或者路径堵塞了
        if (!result.path.length || this.hasObstacleInPath(creeps, result.path[0])) {
            // 无其他目标
            if (goals[0] instanceof Flag) {
                // 休眠
                team.status = 'sleep'
            }
            return
        }

        TeamCache.cacheTeamPath[team.name] = result.path
        return originPos.getDirectionTo(result.path.shift()!)
    }


    /**
     * 检查缓存路径是否正确
     */
    public static checkCachePath(team: Team) {
        const originPos = TeamUtils.getTeamPos(team)
        
        return !!(
            TeamCache.cacheTeamPath[team.name] &&
            TeamCache.cacheTeamPath[team.name].length &&
            originPos?.isCrossRoomNearTo(TeamCache.cacheTeamPath[team.name][0])
        )
    }


    /**
     * 移出边界
     */
    public static moveOuterBorder(creep: Creep, nearCreep: Creep) {
        const targetPos = creep.pos.nearPos(1).find((pos) => pos.walkable(true) && nearCreep.pos.isNearTo(pos))
        if (targetPos) {
            creep.move(creep.pos.getDirectionTo(targetPos))
        }
    }

    /**
     * 删除寻路缓存
     */
    public static clearPathCache(team: Team) {
        delete TeamCache.cacheTeamPath[team.name]
    }
    
    /**
     * 更新队伍推进目标点（targetPos）：
     * - 有可攻击目标时，锁定当前焦点目标位置，减少目标频繁切换导致的来回抖动
     * - 到点但本 tick 没有可攻击目标时，尝试在当前 targets 列表里自动换点推进
     */
    public static updateTargetPos(team: Team) {
        if (!team.creeps?.length) return
        if (!team.flag) return

        const originPos = TeamUtils.getTeamPos(team)
        const focusTarget = TeamUtils.focusTarget(team, originPos)
        const focusPos = focusTarget?.pos || team.flag.pos

        const currentTargetPos = TeamUtils.getCachePos(team, 'targetPos')
        const hasAttackTargets = !!team['_attackTargets']?.length

        const lockTicks = 3
        const lockedUntil = team.cache?.focusTargetLockUntil || 0
        const lockedId = team.cache?.focusTargetId as Id<any> | undefined
        let lockedPos: RoomPosition | undefined
        if (hasAttackTargets && lockedId && Game.time < lockedUntil) {
            const lockedObj = Game.getObjectById(lockedId) as any
            if (lockedObj?.pos) lockedPos = lockedObj.pos
            else {
                delete team.cache.focusTargetId
                delete team.cache.focusTargetLockUntil
            }
        }
        let desiredPos = lockedPos || focusPos
        if (hasAttackTargets && desiredPos.isRoomEdge()) desiredPos = TeamUtils.pushInsideRoomPos(desiredPos, 1)
        const desiredId = lockedPos ? lockedId : ((focusTarget as any)?.id as Id<any> | undefined)

        // candidates：当前 tick 可推进/可攻击的有效目标（排除 flag），用于判断当前 targetPos 是否仍有效
        const candidates = ((team['_targets'] || []) as any[]).filter((t) => t && 'hits' in t && t.pos) as {
            pos: RoomPosition
        }[]
        const candidatePosSet = new Set<number>(candidates.map((t) => t.pos?.hashCode()).filter((v) => v !== undefined) as number[])

        if (!currentTargetPos) {
            TeamUtils.setCachePos(team, 'targetPos', desiredPos)
            if (hasAttackTargets && desiredId) {
                team.cache.focusTargetId = desiredId
                team.cache.focusTargetLockUntil = Game.time + lockTicks
            }
            delete team.cache.targetPosIndex
            return
        }

        if (hasAttackTargets && !currentTargetPos.isEqualTo(desiredPos)) {
            TeamUtils.setCachePos(team, 'targetPos', desiredPos)
            if (desiredId) {
                team.cache.focusTargetId = desiredId
                team.cache.focusTargetLockUntil = Game.time + lockTicks
            }
            delete team.cache.targetPosIndex
            return
        }

        if (!hasAttackTargets) {
            // 当 _targets 退化为 [flag] 或无可攻击目标时，强制回退到旗帜，避免追着历史 targetPos 跑
            if (!candidates.length) {
                if (!currentTargetPos.isEqualTo(team.flag.pos)) {
                    TeamUtils.setCachePos(team, 'targetPos', team.flag.pos)
                    delete team.cache.targetPosIndex
                }
                return
            }

            const currentInCandidates = candidatePosSet.has(currentTargetPos.hashCode())
            // 当前缓存不在候选集合内，说明目标已拆/切换或不可达，及时纠正到当前焦点，避免锁死到无效点
            if (currentTargetPos.isRoomEdge() || !currentInCandidates) {
                TeamUtils.setCachePos(team, 'targetPos', focusPos)
                delete team.cache.targetPosIndex
                return
            }
        }

        const reached =
            currentTargetPos.roomName === originPos.roomName &&
            originPos.getRangeTo(currentTargetPos) <= 1

        if (!reached || hasAttackTargets) return

        if (!candidates.length) {
            TeamUtils.setCachePos(team, 'targetPos', team.flag.pos)
            delete team.cache.targetPosIndex
            return
        }

        const posList = candidates.map((t) => t.pos).filter((p) => p && !p.isRoomEdge())
        const uniqPos: RoomPosition[] = []
        const visited = new Set<number>()
        posList.forEach((p) => {
            const h = p.hashCode()
            if (visited.has(h)) return
            visited.add(h)
            uniqPos.push(p)
        })

        if (!uniqPos.length) {
            // 目标都在房间边缘等场景会导致 uniqPos 为空，此时回退到焦点点，避免保留旧 targetPos 产生“锁死”
            TeamUtils.setCachePos(team, 'targetPos', focusPos)
            delete team.cache.targetPosIndex
            return
        }

        const nextIndex = ((team.cache.targetPosIndex || 0) + 1) % uniqPos.length
        team.cache.targetPosIndex = nextIndex
        TeamUtils.setCachePos(team, 'targetPos', uniqPos[nextIndex])
    }
}
