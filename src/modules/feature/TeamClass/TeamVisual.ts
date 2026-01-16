import RoomArray from './TeamRoomArray'

/**
 * 战斗绘制
 */
export default class TeamVisual {
    /**
     * 绘制房间所有点位数据
     */
    public static drawRoomArray(roomName: string, roomArray: CostMatrix | RoomArray, color?: string) {
        const visual = new RoomVisual(roomName)
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                const value = roomArray.get(x, y)
                visual.text(value.toString(), x, y, { font: 0.35, color })
            }
        }
    }

    /**
     * 绘制小队状态
     */
    public static drawTeamStatus(team: Team) {
        const colors: { [status in Exclude<typeof team.status, undefined>]: string } = {
            // 攻击绿色
            attack: '#9af893',
            // 逃跑红色
            flee: '#e62e1b',
            // 躲避黄色
            avoid: '#f9e50a',
            // 休眠蓝色
            sleep: '#abd4ed',
            // 准备灰色
            ready: '#8a8a8a',
        }

        team.creeps.forEach((creep) => {
            const status = team.status
            if (status) {
                creep.room.visual.circle(creep.pos.x, creep.pos.y, { fill: colors[status], opacity: 0.4, radius: 0.5 })
            }
        })
    }

    /**
     * 绘制小队每个爬需要的治疗量
     */
    public static drawCreepHealNeed(team: Team) {
        team.creeps.forEach((creep) => {
            if (!creep['_heal_need']) {
                return
            }
            creep.room.visual.text((creep['_heal_need'] | 0).toString(), creep.pos.x, creep.pos.y + 0.8, {
                font: 0.38,
                stroke: '#1b1b1b',
                strokeWidth: 0.02,
                color: '#00ff00',
            })
        })
    }

    /**
     * 绘制目标位置
     */
    public static drawTargets(team: Team) {
        team['_targets']?.forEach((target) => {
            target.room?.visual.circle(target.pos.x, target.pos.y, { fill: '#6141cc', radius: 0.5 })
        })
    }

    /**
     * 绘制需要避让的位置
     */
    public static drawAvoidObjs(team: Team) {
        team['_avoidObjs']?.forEach(({ pos }) => {
            const visual = new RoomVisual(pos.roomName)
            visual.circle(pos.x, pos.y, { fill: '#ff0000', radius: 0.5 })
        })
    }
}

