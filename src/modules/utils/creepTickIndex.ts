type TargetRoomCreepInfo = {
    ticksToLive: number | undefined
    spawning: boolean
    homeRoom: string | undefined
}

type TargetRoomRoleMap = Record<string, TargetRoomCreepInfo[]>

type CreepTickIndexCache = {
    time: number
    byTargetRoom: Record<string, TargetRoomRoleMap>
    teamCreeps: Creep[]
}

const EMPTY_TARGET_ROOM_ROLE_MAP: TargetRoomRoleMap = Object.freeze({}) as TargetRoomRoleMap

let tickCache: CreepTickIndexCache | undefined

function buildCache(): CreepTickIndexCache {
    // 单 tick 一次扫描：同时构建 targetRoom->role 索引与 team creep 列表
    const byTargetRoom: Record<string, TargetRoomRoleMap> = {}
    const teamCreeps: Creep[] = []

    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName]
        const role = creep.memory.role
        if (!role) continue

        if (role.startsWith('team')) {
            teamCreeps.push(creep)
        }

        const targetRoom = creep.memory.targetRoom
        if (!targetRoom) continue

        if (!byTargetRoom[targetRoom]) {
            byTargetRoom[targetRoom] = {}
        }
        if (!byTargetRoom[targetRoom][role]) {
            byTargetRoom[targetRoom][role] = []
        }

        byTargetRoom[targetRoom][role].push({
            ticksToLive: creep.ticksToLive,
            spawning: creep.spawning,
            homeRoom: creep.memory.homeRoom,
        })
    }

    return { time: Game.time, byTargetRoom, teamCreeps }
}

function getCache(): CreepTickIndexCache {
    // 每 tick 自动失效，避免跨 tick 脏数据
    if (!tickCache || tickCache.time !== Game.time) {
        tickCache = buildCache()
    }
    return tickCache
}

export function getCreepByTargetRoom(targetRoom: string): TargetRoomRoleMap {
    return getCache().byTargetRoom[targetRoom] || EMPTY_TARGET_ROOM_ROLE_MAP
}

export function getTeamCreeps(): Creep[] {
    return getCache().teamCreeps
}
