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
}
