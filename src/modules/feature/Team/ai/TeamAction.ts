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
        if (team.creeps.length <= 1) return;

        if (team.formation == 'line' || team.creeps.length < 3) {
            let creeps: Creep[] = []
            if (team.creeps.length === 4) {
                creeps = [team.creeps[0], team.creeps[2], team.creeps[1], team.creeps[3]]
            } else if (team.creeps.length === 3) {
                creeps = [team.creeps[0], team.creeps[2], team.creeps[1]]
            } else {
                creeps = team.creeps
            }

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

            for (let i = 1; i < creeps.length; i++) {
                if (creeps[i].pos.isNearTo(creeps[i - 1].pos)) continue;
                creeps[i].moveTo(creeps[i - 1]);
            }
            return true;
        }
        if (team.formation == 'quad') {
            let [ A1, A2, B1, B2 ] = team.creeps;
            // 确定每个爬应该站的位置
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
            // 找到集结点
            const pos = LT ? LT.pos : new RoomPosition(RT.pos.x - 1, RT.pos.y, RT.pos.roomName);
            const room = Game.rooms[pos.roomName];
            const terrain = room.getTerrain();
            // 如果集结点周围空间不足就不集结
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
            // 集结点贴边时，向内收敛并尝试在附近寻找可用的 2x2 区域，避免边缘打散后直接卡死
            const clamp = (v: number) => Math.min(47, Math.max(2, v));
            const basePos = (pos.x < 2 || pos.y < 2 || pos.x > 47 || pos.y > 47)
                ? new RoomPosition(clamp(pos.x), clamp(pos.y), pos.roomName)
                : pos;
            let gatherPos: RoomPosition | null = null;
            if (isValidQuadArea(basePos)) {
                gatherPos = basePos;
            } else {
                const searchRadius = 4;
                for (let r = 1; !gatherPos && r <= searchRadius; r++) {
                    for (let dx = -r; dx <= r && !gatherPos; dx++) {
                        for (let dy = -r; dy <= r; dy++) {
                            const nx = clamp(basePos.x + dx);
                            const ny = clamp(basePos.y + dy);
                            const p = new RoomPosition(nx, ny, basePos.roomName);
                            if (isValidQuadArea(p)) {
                                gatherPos = p;
                                break;
                            }
                        }
                    }
                }
            }
            if (!gatherPos) return false;
            // 各个爬移动到对应位置
            const LT_TARGET = gatherPos;
            const RT_TARGET = new RoomPosition(gatherPos.x + 1, gatherPos.y, gatherPos.roomName);
            const LB_TARGET = new RoomPosition(gatherPos.x, gatherPos.y + 1, gatherPos.roomName);
            const RB_TARGET = new RoomPosition(gatherPos.x + 1, gatherPos.y + 1, gatherPos.roomName);
            if (LT && !LT.pos.isEqualTo(LT_TARGET)) LT.moveTo(LT_TARGET);
            if (RT && !RT.pos.isEqualTo(RT_TARGET)) RT.moveTo(RT_TARGET);
            if (LB && !LB.pos.isEqualTo(LB_TARGET)) LB.moveTo(LB_TARGET);
            if (RB && !RB.pos.isEqualTo(RB_TARGET)) RB.moveTo(RB_TARGET);
            return true;
        }
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
        const targetPos = this.focusTarget(team, originPos)?.pos || team.flag.pos

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

        // 在对角线上就不管
        if (adx === ady) {
            return false
        }

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
``
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
            allGoals.push({ pos: goal.pos, range: goal['_range'] })
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
                if (goal.pos.isRoomEdge()) {
                    return
                }

                for (const item of [
                    [0, 0],
                    [-1, 0],
                    [0, -1],
                    [-1, -1],
                ]) {
                    const pos = new RoomPosition(goal.pos.x + item[0], goal.pos.y + item[1], goal.pos.roomName)
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

                // 生成缓存键：房间名 + 避让对象的简要Hash
                // 只有当避让对象在这个房间时才影响Hash，否则不同队伍在同一房间的CostMatrix应该是通用的
                let avoidHash = '';
                if (team['_avoidObjs'] && team['_avoidObjs'].length > 0) {
                    const objsInRoom = team['_avoidObjs'].filter(o => o.pos.roomName === roomName);
                    if (objsInRoom.length > 0) {
                        avoidHash = '_' + objsInRoom.length + objsInRoom[0].pos.x; // 简单的Hash，可优化
                    }
                }
                const cacheKey = `${roomName}${avoidHash}`;
                const cached = TeamCache.globalCostMatrixCache[cacheKey];
                
                // 缓存有效期 5 tick，或者如果是目标房间且可见则每 tick 更新
                const isTargetRoom = team.flag.pos.roomName === roomName;
                const isVisible = !!Game.rooms[roomName];
                
                if (cached && (Game.time - cached.tick < (isVisible ? 1 : 5))) {
                    return cached.matrix;
                }

                const costs = this.getMoveAbleCostMatrix(
                    roomName,
                    creeps,
                    team['_avoidObjs'],
                    team['_max_damage'],
                    rangePlus,
                    creeps.length >= 3,
                    needAvoid ? 50 : 5,
                    team.cache.structHitLimit || this.structHitLimit,
                    team.cache.isSpawnDanger,
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

        // candidates：当前 tick 可推进/可攻击的有效目标（排除 flag），用于判断当前 targetPos 是否仍有效
        const candidates = ((team['_targets'] || []) as any[]).filter((t) => t && 'hits' in t && t.pos) as {
            pos: RoomPosition
        }[]
        const candidatePosSet = new Set<number>(candidates.map((t) => t.pos?.hashCode()).filter((v) => v !== undefined) as number[])

        if (!currentTargetPos || (hasAttackTargets && !currentTargetPos.isEqualTo(focusPos))) {
            TeamUtils.setCachePos(team, 'targetPos', focusPos)
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
