import { normalizeRoleId } from '@/constant/CreepConstant'

type TargetRoomCreepInfo = {
    ticksToLive: number | undefined
    spawning: boolean
    sourceRoom: string | undefined
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
    byAssignedRoom: Record<string, RoleCountMap>
    downgradedLogisticsByAssignedRoom: Record<string, RoleCountMap>
    byExpandPlan: ExpandRoleCountMap
    minRespawnGapByAssignedRoomRole: Record<string, MinRespawnGapMap>
}

const EMPTY_TARGET_ROOM_ROLE_MAP: TargetRoomRoleMap = Object.freeze({}) as TargetRoomRoleMap
const EMPTY_ROLE_COUNT_MAP: RoleCountMap = Object.freeze({}) as RoleCountMap
// 只有 transporter 继续走“缩水体型补正”：
// - transporter 是纯吞吐位，恢复期补一只满体型通常是收益；
// - manager 是中心单点位，若把缩水 manager 当作“缺口”继续补，会在中心区叠出多只堵路。
const DOWNGRADED_LOGISTICS_ROLE_SET = new Set(['transporter'])

let tickCache: CreepTickIndexCache | undefined

function buildCache(): CreepTickIndexCache {
    // Single tick scan builds all shared creep indices.
    const byTargetRoom: Record<string, TargetRoomRoleMap> = {}
    const teamCreeps: Creep[] = []
    const allRoleCounts: RoleCountMap = {}
    const byAssignedRoom: Record<string, RoleCountMap> = {}
    const downgradedLogisticsByAssignedRoom: Record<string, RoleCountMap> = {}
    const byExpandPlan: ExpandRoleCountMap = {}
    const minRespawnGapByAssignedRoomRole: Record<string, MinRespawnGapMap> = {}

    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName]
        const role = normalizeRoleId(creep.memory.role)
        if (!role) continue
        if (creep.memory.role !== role) creep.memory.role = role

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
                sourceRoom: creep.memory.sourceRoom,
            })
        }

        const expandId = (creep.memory as any).expandId as string | undefined
        if (expandId) {
            if (!byExpandPlan[expandId]) {
                byExpandPlan[expandId] = {}
            }
            byExpandPlan[expandId][role] = (byExpandPlan[expandId][role] || 0) + 1
        }

        const assignedRoom = creep.memory.home || creep.memory.homeRoom || creep.memory.sourceRoom || creep.room.name
        if (assignedRoom && typeof creep.ticksToLive === 'number') {
            if (!minRespawnGapByAssignedRoomRole[assignedRoom]) {
                minRespawnGapByAssignedRoomRole[assignedRoom] = {}
            }
            const respawnGap = creep.ticksToLive - creep.body.length * 4
            const minRespawnGap = minRespawnGapByAssignedRoomRole[assignedRoom][role]
            if (minRespawnGap == null || respawnGap < minRespawnGap) {
                minRespawnGapByAssignedRoomRole[assignedRoom][role] = respawnGap
            }
        }

        const ttl = creep.ticksToLive
        if (typeof ttl === 'number' && ttl < creep.body.length * 3) continue

        if (assignedRoom) {
            if (!byAssignedRoom[assignedRoom]) {
                byAssignedRoom[assignedRoom] = {}
            }
            byAssignedRoom[assignedRoom][role] = (byAssignedRoom[assignedRoom][role] || 0) + 1

            if (creep.memory.downgraded && DOWNGRADED_LOGISTICS_ROLE_SET.has(role)) {
                if (!downgradedLogisticsByAssignedRoom[assignedRoom]) {
                    downgradedLogisticsByAssignedRoom[assignedRoom] = {}
                }
                downgradedLogisticsByAssignedRoom[assignedRoom][role] =
                    (downgradedLogisticsByAssignedRoom[assignedRoom][role] || 0) + 1
            }
        }
    }

    return {
        time: Game.time,
        byTargetRoom,
        teamCreeps,
        allRoleCounts,
        byAssignedRoom,
        downgradedLogisticsByAssignedRoom,
        byExpandPlan,
        minRespawnGapByAssignedRoomRole,
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

export function getCreepNumByAssignedRoom(assignedRoom: string): RoleCountMap {
    const cache = getCache()
    if (!cache.byAssignedRoom[assignedRoom]) {
        cache.byAssignedRoom[assignedRoom] = {}
    }
    return cache.byAssignedRoom[assignedRoom]
}

export function getDowngradedLogisticsCountByAssignedRoom(assignedRoom: string): RoleCountMap {
    return getCache().downgradedLogisticsByAssignedRoom[assignedRoom] || EMPTY_ROLE_COUNT_MAP
}

export function getExpandCreepCountsByPlan(planId: string): RoleCountMap {
    return getCache().byExpandPlan[planId] || EMPTY_ROLE_COUNT_MAP
}

export function getExpandCreepCountsAll(): ExpandRoleCountMap {
    return getCache().byExpandPlan
}

export function hasSoonDeadCreepByAssignedRoomRole(assignedRoom: string, role: string, bufferTick = 10): boolean {
    const minRespawnGap = getCache().minRespawnGapByAssignedRoomRole[assignedRoom]?.[role]
    return typeof minRespawnGap === 'number' && minRespawnGap <= bufferTick
}
