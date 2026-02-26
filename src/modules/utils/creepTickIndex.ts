type TargetRoomCreepInfo = {
    ticksToLive: number | undefined
    spawning: boolean
    homeRoom: string | undefined
}

type TargetRoomRoleMap = Record<string, TargetRoomCreepInfo[]>
type RoleCountMap = Record<string, number>
type ExpandRoleCountMap = Record<string, RoleCountMap>
type MinRespawnGapMap = Record<string, number>

type CreepTickIndexCache = {
    time: number
    byTargetRoom: Record<string, TargetRoomRoleMap>
    teamCreeps: Creep[]
    allRoleCounts: RoleCountMap
    byHomeRoom: Record<string, RoleCountMap>
    downgradedLogisticsByHomeRoom: Record<string, RoleCountMap>
    byExpandPlan: ExpandRoleCountMap
    minRespawnGapByHomeRoomRole: Record<string, MinRespawnGapMap>
}

const EMPTY_TARGET_ROOM_ROLE_MAP: TargetRoomRoleMap = Object.freeze({}) as TargetRoomRoleMap
const EMPTY_ROLE_COUNT_MAP: RoleCountMap = Object.freeze({}) as RoleCountMap
const DOWNGRADED_LOGISTICS_ROLE_SET = new Set(['transport', 'carrier', 'manager'])

let tickCache: CreepTickIndexCache | undefined

function buildCache(): CreepTickIndexCache {
    // Single tick scan builds all shared creep indices.
    const byTargetRoom: Record<string, TargetRoomRoleMap> = {}
    const teamCreeps: Creep[] = []
    const allRoleCounts: RoleCountMap = {}
    const byHomeRoom: Record<string, RoleCountMap> = {}
    const downgradedLogisticsByHomeRoom: Record<string, RoleCountMap> = {}
    const byExpandPlan: ExpandRoleCountMap = {}
    const minRespawnGapByHomeRoomRole: Record<string, MinRespawnGapMap> = {}

    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName]
        const role = creep.memory.role
        if (!role) continue

        allRoleCounts[role] = (allRoleCounts[role] || 0) + 1

        if (role.startsWith('team')) {
            teamCreeps.push(creep)
        }

        const targetRoom = creep.memory.targetRoom
        if (targetRoom) {
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

        const expandId = (creep.memory as any).expandId as string | undefined
        if (expandId) {
            if (!byExpandPlan[expandId]) {
                byExpandPlan[expandId] = {}
            }
            byExpandPlan[expandId][role] = (byExpandPlan[expandId][role] || 0) + 1
        }

        const homeRoom = creep.memory.home || creep.memory.homeRoom || creep.room.name
        if (homeRoom && typeof creep.ticksToLive === 'number') {
            if (!minRespawnGapByHomeRoomRole[homeRoom]) {
                minRespawnGapByHomeRoomRole[homeRoom] = {}
            }
            const respawnGap = creep.ticksToLive - creep.body.length * 4
            const minRespawnGap = minRespawnGapByHomeRoomRole[homeRoom][role]
            if (minRespawnGap == null || respawnGap < minRespawnGap) {
                minRespawnGapByHomeRoomRole[homeRoom][role] = respawnGap
            }
        }

        const ttl = creep.ticksToLive
        if (typeof ttl === 'number' && ttl < creep.body.length * 3) continue

        if (homeRoom) {
            if (!byHomeRoom[homeRoom]) {
                byHomeRoom[homeRoom] = {}
            }
            byHomeRoom[homeRoom][role] = (byHomeRoom[homeRoom][role] || 0) + 1

            if (creep.memory.downgraded && DOWNGRADED_LOGISTICS_ROLE_SET.has(role)) {
                if (!downgradedLogisticsByHomeRoom[homeRoom]) {
                    downgradedLogisticsByHomeRoom[homeRoom] = {}
                }
                downgradedLogisticsByHomeRoom[homeRoom][role] =
                    (downgradedLogisticsByHomeRoom[homeRoom][role] || 0) + 1
            }
        }
    }

    return {
        time: Game.time,
        byTargetRoom,
        teamCreeps,
        allRoleCounts,
        byHomeRoom,
        downgradedLogisticsByHomeRoom,
        byExpandPlan,
        minRespawnGapByHomeRoomRole,
    }
}

function getCache(): CreepTickIndexCache {
    // Cache invalidates automatically every tick.
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

export function getCreepRoleCountsAll(): RoleCountMap {
    return getCache().allRoleCounts
}

export function getCreepNumByHomeRoom(homeRoom: string): RoleCountMap {
    const cache = getCache()
    if (!cache.byHomeRoom[homeRoom]) {
        cache.byHomeRoom[homeRoom] = {}
    }
    return cache.byHomeRoom[homeRoom]
}

export function getDowngradedLogisticsCountByHomeRoom(homeRoom: string): RoleCountMap {
    return getCache().downgradedLogisticsByHomeRoom[homeRoom] || EMPTY_ROLE_COUNT_MAP
}

export function getExpandCreepCountsByPlan(planId: string): RoleCountMap {
    return getCache().byExpandPlan[planId] || EMPTY_ROLE_COUNT_MAP
}

export function getExpandCreepCountsAll(): ExpandRoleCountMap {
    return getCache().byExpandPlan
}

export function hasSoonDeadCreepByHomeRoomRole(homeRoom: string, role: string, bufferTick = 10): boolean {
    const minRespawnGap = getCache().minRespawnGapByHomeRoomRole[homeRoom]?.[role]
    return typeof minRespawnGap === 'number' && minRespawnGap <= bufferTick
}

