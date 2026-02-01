import TeamCache from '../infra/TeamCache'
import RoomArray from '../infra/RoomArray'
import TeamUtils from '../core/TeamUtils'

const ENABLE_TEAM_MOVE_VISUAL = true

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
     * 绘制塔伤分布图
     */
    public static drawTowerDamageMap(roomName: string) {
        const damageMap = TeamCache.getTowerDamageMap(roomName)
        this.drawRoomArray(roomName, damageMap, '#ff0000')
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
            if (team.cache?.blockedReorientTick === Game.time) {
                creep.room.visual.text('BR', creep.pos.x, creep.pos.y - 0.6, { font: 0.4, color: '#00ffff' })
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
            if (!target?.pos) return
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

    /**
     * 绘制推进目标点（targetPos）
     */
    public static drawTargetPos(team: Team) {
        const tp = team.cache?.targetPos
        if (!tp) return
        const pos = new RoomPosition(tp.x, tp.y, tp.roomName)
        const visual = new RoomVisual(pos.roomName)
        visual.circle(pos.x, pos.y, { stroke: '#00ffff', radius: 0.7, fill: 'transparent' })
        visual.text(team.name, pos.x, pos.y - 0.6, { font: 0.4, color: '#00ffff' })
    }

    /**
     * 绘制队伍本 tick 的移动方向（含跨房穿边的 Hold 状态）。
     *
     * @remarks
     * - 方向来自 team.cache.lastMoveDirection/lastMoveHold，由 TeamAction.move 在本 tick 写入。\n
     * - 仅当存在 flag `teamMoveShow` 或 `teamMoveShow-${team.name}` 时绘制，避免常驻刷屏。\n
     * - 若 lastMoveHold 为 true：表示本 tick 选择停 1 tick 等待边界传送，以保持 quad 阵型。\n
     * - 为了在跨房边界也能看清方向，箭头绘制为“短箭头”（不跨房连线）。
     */
    public static drawMoveDirection(team: Team) {
        if (!ENABLE_TEAM_MOVE_VISUAL) return

        const lastTick = team.cache?.lastMoveTick
        if (lastTick !== Game.time) return

        const direction = team.cache?.lastMoveDirection as DirectionConstant | undefined
        const hold = !!team.cache?.lastMoveHold
        const creepDirections = team.cache?.lastCreepMoveDirections as Record<string, DirectionConstant> | undefined
        if (!direction && !creepDirections) return

        const dirDelta: Record<number, { dx: number; dy: number; arrow: string }> = {
            1: { dx: 0, dy: -1, arrow: '↑' },
            2: { dx: 1, dy: -1, arrow: '↗' },
            3: { dx: 1, dy: 0, arrow: '→' },
            4: { dx: 1, dy: 1, arrow: '↘' },
            5: { dx: 0, dy: 1, arrow: '↓' },
            6: { dx: -1, dy: 1, arrow: '↙' },
            7: { dx: -1, dy: 0, arrow: '←' },
            8: { dx: -1, dy: -1, arrow: '↖' },
        }

        const statusColors: { [status in Exclude<typeof team.status, undefined>]: string } = {
            attack: '#9af893',
            flee: '#e62e1b',
            avoid: '#f9e50a',
            sleep: '#abd4ed',
            ready: '#8a8a8a',
        }

        const color = hold ? '#00ffff' : (team.status ? statusColors[team.status] : '#00ffff')
        const arrowOffsetY = 0

        team.creeps.forEach((creep) => {
            const creepDir = creepDirections?.[creep.id] || direction
            if (!creepDir) return
            const dd = dirDelta[creepDir]
            if (!dd) return
            const x = creep.pos.x
            const y = creep.pos.y - arrowOffsetY
            const label = hold ? `H${dd.arrow}` : dd.arrow
            creep.room.visual.text(label, x, y, { font: 0.55, color, stroke: '#1b1b1b', strokeWidth: 0.06 })
        })

        if (hold && direction) {
            const dd = dirDelta[direction]
            if (!dd) return
            const pos = TeamUtils.getTeamPos(team)
            const visual = new RoomVisual(pos.roomName)
            visual.text(`HOLD ${dd.arrow}`, pos.x, pos.y - 1.2, { font: 0.5, color, stroke: '#1b1b1b', strokeWidth: 0.05 })
        }
    }
}
