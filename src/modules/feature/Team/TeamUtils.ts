/**
 * 工具函数
 */
export default class TeamUtils {
    // 获取队伍坐标范围
    public static getPosRange(team: Team):{ minX: number, maxX: number, minY: number, maxY: number } {
        if (team.creeps.length == 0) return undefined;
        let creepPos = team.creeps.map((c: Creep) => c.pos);
        let minX = Math.min(...creepPos.map((p) => p.x));
        let maxX = Math.max(...creepPos.map((p) => p.x));
        let minY = Math.min(...creepPos.map((p) => p.y));
        let maxY = Math.max(...creepPos.map((p) => p.y));
        return { minX, maxX, minY, maxY };
    }

    // 获取队伍全局坐标范围
    public static getGlobalPosRange(team: Team): { minX: number, maxX: number, minY: number, maxY: number } {
        if (team.creeps.length == 0) return undefined;
        let creepPos = team.creeps.map((c: Creep) => c.pos.toGlobal());
        let minX = Math.min(...creepPos.map((p) => p.x));
        let maxX = Math.max(...creepPos.map((p) => p.x));
        let minY = Math.min(...creepPos.map((p) => p.y));
        let maxY = Math.max(...creepPos.map((p) => p.y));
        return { minX, maxX, minY, maxY };
    }

    // 获取队伍左上角坐标
    public static getTeamPos(team: Team): RoomPosition {
        if (team['pos']) return team['pos'];
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
        return teamPos;
    }

    // 检查小队成员位置是否构成方形
    public static isQuad(team: Team): boolean {
        if (team['isQuad']) return true;

        // 跨房了不检查
        // if (new Set(creeps.map((creep) => creep.room.name)).size > 1) return

        // 检测每个爬是否与其余所有爬相邻
        for (let i = 0; i < team.creeps.length; i++) {
            const creep = team.creeps[i]
            for (let j = 0; j < team.creeps.length; j++) {
                if (i === j) continue
                if (!creep.pos.isCrossRoomNearTo(team.creeps[j].pos)) return false
            }
        }

        return team['isQuad'] = true;
    }

    // 检查小队成员位置是否线性相连
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
    public static inSameRoom(team: Team): boolean {
        if (team.creeps.length == 0) return false;
        let roomName = team.creeps[0].room.name;
        return team.creeps.every((c: Creep) => c.room.name == roomName);
    }

    // 检查队伍是否在目标房间
    public static inTargetRoom(team: Team): boolean {
        let targetRoom = team.targetRoom;
        if (!targetRoom) return true;
        if (team.creeps.length == 0) return false;
        return team.creeps.every((c: Creep) => c.room.name == targetRoom);
    }


    // 检查队伍是否符合设定的朝向
    public static checkToward(team: Team): boolean {
        if (team.creeps.length == 0) return true;
        if (team.formation !== 'quad') return true;
        if (!this.isQuad(team)) return true;

        const { minX, maxX, minY, maxY } = this.getGlobalPosRange(team);
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
    public static isEqual(team: Team, pos: RoomPosition): boolean {
        if (team.creeps.length == 0) return false;
        return team.creeps.some((c: Creep) => c.pos.isEqual(pos));
    }

    // 检查队伍是否与目标相邻
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
}

