/**
 * 工具函数
 */
export default class TeamUtils {
    // 获取队伍坐标范围
    /**
     * 获取队伍在当前房间坐标系下的包围盒范围。
     *
     * @param team 队伍实例
     * @returns {minX,maxX,minY,maxY}；队伍为空时返回 undefined
     */
    public static getPosRange(team: Team): { minX: number; maxX: number; minY: number; maxY: number } | undefined {
        if (team.creeps.length == 0) return undefined;
        let creepPos = team.creeps.map((c: Creep) => c.pos);
        let minX = Math.min(...creepPos.map((p) => p.x));
        let maxX = Math.max(...creepPos.map((p) => p.x));
        let minY = Math.min(...creepPos.map((p) => p.y));
        let maxY = Math.max(...creepPos.map((p) => p.y));
        return { minX, maxX, minY, maxY };
    }

    // 获取队伍全局坐标范围
    /**
     * 获取队伍在全局坐标系（跨房）下的包围盒范围。
     *
     * @remarks
     * 主要用于跨房场景下的相对位置判断，避免房间边界导致的坐标不连续。
     */
    public static getGlobalPosRange(team: Team): { minX: number; maxX: number; minY: number; maxY: number } | undefined {
        if (team.creeps.length == 0) return undefined;
        let creepPos = team.creeps.map((c: Creep) => c.pos.toGlobal());
        let minX = Math.min(...creepPos.map((p) => p.x));
        let maxX = Math.max(...creepPos.map((p) => p.x));
        let minY = Math.min(...creepPos.map((p) => p.y));
        let maxY = Math.max(...creepPos.map((p) => p.y));
        return { minX, maxX, minY, maxY };
    }

    // 获取队伍左上角坐标
    /**
     * 获取队伍的“左上角”参考点（teamPos）。
     *
     * @remarks
     * - 3 人及以上：使用全局坐标 gp.x + gp.y 最小的 creep 作为左上角参考。\n
     * - flee/avoid 且仅 2 人：取队尾作为参考（倒着走）。\n
     * - 结果会按 tick 缓存到 team['pos']/team['posTick']。
     */
    public static getTeamPos(team: Team): RoomPosition {
        if (team['posTick'] === Game.time && team['pos']) return team['pos'];
        let teamPos = null;
        if (team.creeps.length >= 3) {
            let s = Infinity;
            team.creeps.forEach(c => {
                let gp = c.pos.toGlobal();
                if (gp.x + gp.y > s) return;
                s = gp.x + gp.y;
                teamPos = c.pos;
            });
        } else if (team.status === 'flee' || team.status === 'avoid') {
            // 二人小队逃跑时倒着走
            teamPos = team.creeps[team.creeps.length - 1].pos;
        } else teamPos = team.creeps[0].pos;
        
        team['pos'] = teamPos;
        team['posTick'] = Game.time;
        return teamPos;
    }

    // 检查小队成员位置是否构成方形
    /**
     * 判断队伍是否处于“矩阵（quad）可行动”状态。
     *
     * @remarks
     * - 这里的判定是“强邻近”：要求队伍内任意两名成员都互相相邻（含跨房邻近）。\n
     * - 结果会按 tick 缓存到 team['isQuad']/team['isQuadTick']，减少重复计算。\n
     * - 该结果用于队形保持/集结逻辑的分支选择（例如是否需要 Gather 归位）。
     */
    public static isQuad(team: Team): boolean {
        if (team['isQuadTick'] === Game.time) return !!team['isQuad'];

        // 跨房了不检查
        // if (new Set(creeps.map((creep) => creep.room.name)).size > 1) return

        // 检测每个爬是否与其余所有爬相邻
        for (let i = 0; i < team.creeps.length; i++) {
            const creep = team.creeps[i]
            for (let j = 0; j < team.creeps.length; j++) {
                if (i === j) continue
                if (!creep.pos.isCrossRoomNearTo(team.creeps[j].pos)) {
                    team['isQuad'] = false
                    team['isQuadTick'] = Game.time
                    return false
                }
            }
        }

        team['isQuad'] = true;
        team['isQuadTick'] = Game.time
        return true;
    }

    // 检查小队成员位置是否线性相连
    /**
     * 判断队伍是否线性相连（用于 line 队形推进与归位判断）。
     *
     * @remarks
     * 该判定会按特定顺序重排 3/4 人队伍的成员，以更贴近“队首→队尾”的链式相邻关系。
     */
    public static isLinear(team: Team): boolean {
        if (team.creeps.length < 2) return true;
        let creeps: Creep[] = []
        if (team.creeps.length === 4) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1], team.creeps[3]]
        } else if (team.creeps.length === 3) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1]]
        } else {
            creeps = team.creeps
        }
        let teamPos = creeps.map((c: Creep) => c.pos.toGlobal());
        for (let i = 1; i < creeps.length; i++) {
            let pos1 = teamPos[i - 1];
            let pos2 = teamPos[i];
            if (Math.abs(pos1.x - pos2.x) > 1 ||
                Math.abs(pos1.y - pos2.y) > 1) {
                return false;
            }
        }
        return true;
    }

    // 检查队伍是否均在同一房间
    /**
     * 判断队伍是否全部位于同一房间。
     */
    public static inSameRoom(team: Team): boolean {
        if (team.creeps.length == 0) return false;
        let roomName = team.creeps[0].room.name;
        return team.creeps.every((c: Creep) => c.room.name == roomName);
    }

    /**
     * 预测某个 creep 在“下一 tick（tick 边界之后）”会处于的位置。
     *
     * @param pos 当前坐标（x/y/roomName）
     * @param direction 本 tick 的移动方向（无方向/undefined 表示不移动）
     *
     * @returns 下一 tick 的位置（考虑房间边界传送后的 roomName 与坐标）
     *
     * @remarks
     * - Screeps 边界（0/49）：当 creep 在 tick 结束时位于边界格，会在 tick 边界自动被“传送”到相邻房间对应边界格。\n
     * - 往边界外移动：不会得到 room 内坐标（这里把越界 move 视为“坐标不变”，但随后仍会触发边界传送）。\n
     * - 该方法只用于队形/决策模拟，不做地形、障碍、对穿、疲劳等校验。
     */
    public static simulateCreepNextPos(
        pos: { x: number; y: number; roomName: string },
        direction: DirectionConstant | undefined
    ): { x: number; y: number; roomName: string } {
        const base = { x: pos.x, y: pos.y, roomName: pos.roomName }

        // 方向 → 坐标增量（1..8）
        const dirDelta: Record<number, { dx: number; dy: number }> = {
            1: { dx: 0, dy: -1 },
            2: { dx: 1, dy: -1 },
            3: { dx: 1, dy: 0 },
            4: { dx: 1, dy: 1 },
            5: { dx: 0, dy: 1 },
            6: { dx: -1, dy: 1 },
            7: { dx: -1, dy: 0 },
            8: { dx: -1, dy: -1 },
        }

        // 先模拟“本 tick 执行 move 后”的房间内坐标变化（direction 存在即视为尝试移动；不允许得到越界坐标）
        if (direction) {
            const d = dirDelta[direction]
            if (d) {
                const nx = base.x + d.dx
                const ny = base.y + d.dy
                if (nx >= 0 && nx <= 49 && ny >= 0 && ny <= 49) {
                    base.x = nx
                    base.y = ny
                }
            }
        }

        // 再模拟“tick 边界的房间传送”：只要此刻站在 0/49，就会在下一 tick 出现在相邻房间的对应边界
        const { rx, ry } = this.parseRoomCoord(base.roomName)
        let nrx = rx
        let nry = ry
        let x = base.x
        let y = base.y

        if (x === 0) {
            nrx -= 1
            x = 49
        } else if (x === 49) {
            nrx += 1
            x = 0
        }

        if (y === 0) {
            nry -= 1
            y = 49
        } else if (y === 49) {
            nry += 1
            y = 0
        }

        return { x, y, roomName: this.formatRoomCoord(nrx, nry) }
    }

    /**
     * 判断队伍在“下一 tick”是否仍保持 quad（强邻近）状态。
     *
     * @param team 队伍
     * @param direction 本 tick 的移动方向
     *
     * @returns true 表示下一 tick 任意两两成员仍互相相邻（含跨房邻近）
     *
     * @remarks
     * - 这里用全局坐标（roomCoord*50 + x/y）来实现跨房邻近判定。\n
     * - 判定标准使用 Chebyshev 距离（max(|dx|,|dy|) <= 1），与 Screeps 的相邻定义一致。\n
     * - 该方法用于“跨房穿边时是否需要停 1 tick 等待传送”的决策：如果不动能保持 quad，而动会打散，就不动。
     */
    public static willTeamBeQuadNextTick(team: Team, direction: DirectionConstant | undefined): boolean {
        if (!team.creeps?.length) return true
        if (team.creeps.length === 1) return true

        const sim = team.creeps.map((c) =>
            this.simulateCreepNextPos({ x: c.pos.x, y: c.pos.y, roomName: c.pos.roomName }, direction),
        )

        const globals = sim.map((p) => {
            const { rx, ry } = this.parseRoomCoord(p.roomName)
            return { gx: rx * 50 + p.x, gy: ry * 50 + p.y }
        })

        for (let i = 0; i < globals.length; i++) {
            for (let j = i + 1; j < globals.length; j++) {
                const dx = Math.abs(globals[i].gx - globals[j].gx)
                const dy = Math.abs(globals[i].gy - globals[j].gy)
                if (Math.max(dx, dy) > 1) return false
            }
        }
        return true
    }

    /**
     * 将房间名解析为“连续坐标系”的房间坐标（rx/ry）。
     *
     * @remarks
     * - 采用与 Screeps API 一致的约定：E0 与 W0 相邻；N0 与 S0 相邻。\n
     * - 这里使用映射：E{x} → +x，W{x} → -(x+1)；S{y} → +y，N{y} → -(y+1)。\n
     * - 该映射让房间坐标在数轴上连续，便于做跨房距离计算与“全局坐标”拼接。
     */
    private static parseRoomCoord(roomName: string): { rx: number; ry: number } {
        const m = roomName.match(/^([WE])(\d+)([NS])(\d+)$/)
        if (!m) return { rx: 0, ry: 0 }
        const ew = m[1]
        const ex = Number(m[2])
        const ns = m[3]
        const ny = Number(m[4])
        const rx = ew === 'E' ? ex : -ex - 1
        const ry = ns === 'S' ? ny : -ny - 1
        return { rx, ry }
    }

    /**
     * 将连续坐标系的房间坐标（rx/ry）反向格式化为 Screeps 房间名。
     */
    private static formatRoomCoord(rx: number, ry: number): string {
        const ew = rx >= 0 ? 'E' : 'W'
        const ns = ry >= 0 ? 'S' : 'N'
        const ex = rx >= 0 ? rx : -rx - 1
        const ny = ry >= 0 ? ry : -ry - 1
        return `${ew}${ex}${ns}${ny}`
    }

    // 检查队伍是否在目标房间
    /**
     * 判断队伍是否全部位于目标房间（team.targetRoom）。
     */
    public static inTargetRoom(team: Team): boolean {
        let targetRoom = team.targetRoom;
        if (!targetRoom) return true;
        if (team.creeps.length == 0) return false;
        return team.creeps.every((c: Creep) => c.room.name == targetRoom);
    }


    // 检查队伍是否符合设定的朝向
    /**
     * 检查矩阵队形是否符合设定的朝向（toward）。
     *
     * @remarks
     * - 该逻辑会以全局包围盒四角为基准校验 A1/A2/B1/B2 的角位归属。\n
     * - 当成员不足 4 时，角位会缺失（B2 可能为 undefined），因此此处只做“存在则校验”。\n
     * - 校验失败会触发 TeamAction.AdjustToward 做微调。
     */
    public static checkToward(team: Team): boolean {
        if (team.creeps.length == 0) return true;
        if (team.formation !== 'quad') return true;
        if (!this.isQuad(team)) return true;

        const posRange = this.getGlobalPosRange(team);
        if (!posRange) return true;
        const { minX, maxX, minY, maxY } = posRange;
        let [ A1, A2, B1, B2 ] = team.creeps;
        let A1POS = A1?.pos.toGlobal();
        let A2POS = A2?.pos.toGlobal();
        let B1POS = B1?.pos.toGlobal();
        let B2POS = B2?.pos.toGlobal();

        switch (team.toward) {
            case '↑':
                if (A1 && (A1POS.x != minX || A1POS.y != minY)) return false;
                if (A2 && (A2POS.x != maxX || A2POS.y != minY)) return false;
                if (B1 && (B1POS.x != minX || B1POS.y != maxY)) return false;
                if (B2 && (B2POS.x != maxX || B2POS.y != maxY)) return false;
                return true;
            case '↓':
                if (A1 && (A1POS.x != maxX || A1POS.y != maxY)) return false;
                if (A2 && (A2POS.x != minX || A2POS.y != maxY)) return false;
                if (B1 && (B1POS.x != maxX || B1POS.y != minY)) return false;
                if (B2 && (B2POS.x != minX || B2POS.y != minY)) return false;
                return true;
            case '←':
                if (A1 && (A1POS.x != minX || A1POS.y != maxY)) return false;
                if (A2 && (A2POS.x != minX || A2POS.y != minY)) return false;
                if (B1 && (B1POS.x != maxX || B1POS.y != maxY)) return false;
                if (B2 && (B2POS.x != maxX || B2POS.y != minY)) return false;
                return true;
            case '→':
                if (A1 && (A1POS.x != maxX || A1POS.y != minY)) return false;
                if (A2 && (A2POS.x != maxX || A2POS.y != maxY)) return false;
                if (B1 && (B1POS.x != minX || B1POS.y != minY)) return false;
                if (B2 && (B2POS.x != minX || B2POS.y != maxY)) return false;
                return true;
            default:
                return false;
        }
    }

    // 检查队伍是否到达指定位置
    /**
     * 判断队伍任意成员是否位于指定位置。
     */
    public static isEqual(team: Team, pos: RoomPosition): boolean {
        if (team.creeps.length == 0) return false;
        return team.creeps.some((c: Creep) => c.pos.isEqual(pos));
    }

    // 检查队伍是否与目标相邻
    /**
     * 判断队伍是否已“贴近”目标点。
     *
     * @remarks
     * - 单人：isNear\n
     * - 多人：至少 2 名成员 isNear
     */
    public static isNear(team: Team, pos: RoomPosition): boolean {
        if (team.creeps.length == 0) return false;
        if (team.creeps.length == 1) return team.creeps[0].pos.isNear(pos);
        return team.creeps.filter((c: Creep) => c.pos.isNear(pos)).length >= 2;
    }

    /**
     * 小队中是否有爬疲劳
     */
    public static hasCreepFatigue(team: Team): boolean{
        return team.creeps.some((creep) => creep.fatigue > 0)
    }

    /**
     * 小队中是否有爬在房间边缘
     */
    public static hasCreepOnEdge(team: Team): boolean{
        if (team.creeps.length == 0) return false;
        return team.creeps.some((creep) => creep.pos.isRoomEdge())
    }

    /**
     * 选择“最优攻击目标”（从缓存目标集合中取最近）。
     *
     * @remarks
     * 优先使用 team['_attackTargets']，否则从 team['_targets'] 里筛选可被攻击的对象。
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
     * 从 team.cache 中读取位置（以纯对象存储，运行时还原为 RoomPosition）
     */
    public static getCachePos(team: Team, key: string): RoomPosition | undefined {
        const data = team?.cache?.[key]
        if (!data) return undefined
        const { x, y, roomName } = data as { x: number; y: number; roomName: string }
        if (typeof x !== 'number' || typeof y !== 'number' || !roomName) return undefined
        return new RoomPosition(x, y, roomName)
    }

    /**
     * 写入位置到 team.cache（避免直接存 RoomPosition 导致 memory 序列化问题）
     */
    public static setCachePos(team: Team, key: string, pos: RoomPosition | undefined): void {
        if (!team.cache) team.cache = {}
        if (!pos) {
            delete team.cache[key]
            return
        }
        team.cache[key] = { x: pos.x, y: pos.y, roomName: pos.roomName }
    }

    /**
     * 将房间坐标“夹到房间内侧”，避免返回边缘坐标（x=0/49 或 y=0/49）。
     *
     * @remarks
     * 用途：
     * - 追击贴边目标时，把目标点推到内侧，避免被“忽略边缘目标”的逻辑过滤掉。\n
     * - 生成 quad 的候选推进点时，避免贴边导致的跨房抖动/阵型撕裂。\n
     *
     * @param pos 原始位置（同房间）
     * @param margin 内侧边距，默认 1 表示限制到 [1..48]
     */
    public static pushInsideRoomPos(pos: RoomPosition, margin = 1): RoomPosition {
        const x = Math.max(margin, Math.min(49 - margin, pos.x))
        const y = Math.max(margin, Math.min(49 - margin, pos.y))
        if (x === pos.x && y === pos.y) return pos
        return new RoomPosition(x, y, pos.roomName)
    }

    /**
     * 生成 values 的 k-排列（有序、不重复抽取 k 个元素）。
     *
     * @remarks
     * 例如 values=[0,1,2,3], k=3 会生成 P(4,3)=24 种序列。\n
     * 该函数用于预计算 quad 集结时的“角位分配方案”，运行时只需遍历结果，避免每 tick 递归生成。\n
     */
    private static kPermutations(values: number[], k: number): number[][] {
        const res: number[][] = []
        const used = new Array(values.length).fill(false)
        const cur: number[] = []
        const dfs = () => {
            if (cur.length === k) {
                res.push([...cur])
                return
            }
            for (let i = 0; i < values.length; i++) {
                if (used[i]) continue
                used[i] = true
                cur.push(values[i])
                dfs()
                cur.pop()
                used[i] = false
            }
        }
        dfs()
        return res
    }

    public static QUAD_ASSIGN_PATTERNS_4 = this.kPermutations([0, 1, 2, 3], 4)
    public static QUAD_ASSIGN_PATTERNS_3 = this.kPermutations([0, 1, 2, 3], 3)
}
