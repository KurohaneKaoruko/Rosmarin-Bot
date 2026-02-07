import { RoleData } from "@/constant/CreepConstant";
import { log } from "@/utils";
import { AIO_CONFIG, LOOT_CONFIG, type BoostMap } from "./config";
import { getSpawnRoomOrRemove, parseFlagNumber, tickThrottle } from "../utils";

export default class WarSpawnFunction extends Flag {
    handleWarSpawnFlag(): boolean {
        const flagName = this.name
        if (Game.time % 10) return true
        if (flagName.startsWith('AIO/')) return this.handleAioFlag(flagName)
        if (flagName.startsWith('CLEAN/')) return this.handleCleanFlag(flagName)
        if (flagName.startsWith('ACLAIM/')) return this.handleAttackClaimFlag(flagName)
        if (flagName.startsWith('DIS/')) return this.handleDismantleFlag(flagName)
        if (flagName.startsWith('LOOT/')) return this.handleLootFlag(flagName)
        return false
    }

    private handleAioFlag(flagName: string): boolean {
        const spawnInterval = parseFlagNumber(flagName, 'T', 1000)
        if (!tickThrottle(this, spawnInterval)) return true
        const room = getSpawnRoomOrRemove(this)
        if (!room) return true
        const targetRoom = this.pos.roomName

        let bodys: [BodyPartConstant, number][] = []
        let boostmap: BoostMap = (RoleData['aio'].boostmap || {}) as BoostMap

        const B = flagName.match(/AIO\/(\w+)/)?.[1] as any
        if (AIO_CONFIG[B]) {
            bodys = AIO_CONFIG[B].bodypart || bodys
            boostmap = AIO_CONFIG[B].boostmap || boostmap
        }

        const boostBody = bodys.length == 0 ? RoleData['aio'].bodypart : bodys
        if (boostmap && !room.CheckBoostRes(boostBody, boostmap)) {
            console.log(flagName, '没有足够的boost资源')
            this.remove()
            return true
        }

        const boostOwnerId = `${flagName}:${Game.time}`
        const spawnRet = room.SpawnMissionAdd('', bodys, -1, 'aio', {
            targetRoom: targetRoom,
            boostmap: boostmap,
            boostOwnerId,
        } as any)
        if (spawnRet !== OK) return true
        room.AssignBoostTaskByBody(boostBody, boostmap, boostOwnerId)

        const flagMemory = this.memory as any
        flagMemory['spawnCount'] = (flagMemory['spawnCount'] || 0) + 1
        console.log(flagName, '已添加孵化任务.')

        let spawnCount = parseFlagNumber(flagName, 'N', 0)
        if (flagMemory['spawnCount'] >= spawnCount) {
            console.log(flagName, '孵化数量已满')
            this.remove()
        }

        return true
    }

    // 清扫房间 (用于防御薄弱的房间)
    private handleCleanFlag(flagName: string): boolean {
        const spawnInterval = parseFlagNumber(flagName, 'T', 500)
        if (!tickThrottle(this, spawnInterval)) return true
        const room = getSpawnRoomOrRemove(this)
        if (!room) return true
        const targetRoom = this.pos.roomName
        // 拆除策略由 creep.memory.dismantleMode 驱动，便于后续扩展与精细控制
        room.SpawnMissionAdd('', '', -1, 'cleaner', { targetRoom, dismantleMode: 'clean' } as any)
        return true
    }

    // 攻击控制器
    private handleAttackClaimFlag(flagName: string): boolean {
        const spawnInterval = parseFlagNumber(flagName, 'T', 1000) || 500
        if (!tickThrottle(this, spawnInterval)) return true
        const room = getSpawnRoomOrRemove(this)
        if (!room) return true

        const targetRoom = this.pos.roomName
        const num = parseFlagNumber(flagName, 'N', 1)
        for (let i = 0; i < num; i++) {
            room.SpawnMissionAdd('', '', num, 'attack-claimer', { targetRoom, num })
        }
        log('CLAIM', `${room.name} 孵化了 ${num} 个 attack-claimer 来攻击 ${targetRoom}`)
        return true
    }

    // 战争指令常见是“一次性触发”，默认 N=0 表示成功派发一次后自动删旗，避免忘关导致重复孵化
    private handleDismantleFlag(flagName: string): boolean {
        const spawnInterval = parseFlagNumber(flagName, 'T', 1000)
        if (!tickThrottle(this, spawnInterval)) return true
        const room = getSpawnRoomOrRemove(this)
        if (!room) return true

        const targetRoom = this.pos.roomName
        const bodys = RoleData['dismantle'].bodypart as any
        const boostmap = (RoleData['dismantle'].boostmap || {}) as BoostMap

        if (boostmap && !room.CheckBoostRes(bodys, boostmap)) {
            console.log(flagName, '没有足够的boost资源')
            this.remove()
            return true
        }

        const boostOwnerId = `${flagName}:${Game.time}`
        // 拆除策略由 creep.memory.dismantleMode 驱动，避免仅靠 role 绑定策略导致歧义
        const spawnRet = room.SpawnMissionAdd('', bodys, -1, 'dismantle', {
            targetRoom,
            boostmap,
            boostOwnerId,
            dismantleMode: 'route',
        } as any)
        if (spawnRet !== OK) return true
        room.AssignBoostTaskByBody(bodys, boostmap, boostOwnerId)

        const flagMemory = this.memory as any
        flagMemory['spawnCount'] = (flagMemory['spawnCount'] || 0) + 1
        console.log(flagName, '已添加孵化任务.')

        const spawnCount = parseFlagNumber(flagName, 'N', 0)
        if (flagMemory['spawnCount'] >= spawnCount) {
            console.log(flagName, '孵化数量已满')
            this.remove()
        }
        return true
    }

    // 把旗帜所在房间当作 sourceRoom，把孵化房当作 targetRoom：用于战后/拆迁后的资源回收
    private handleLootFlag(flagName: string): boolean {
        const spawnInterval = parseFlagNumber(flagName, 'T', 500)
        if (!tickThrottle(this, spawnInterval)) return true
        const room = getSpawnRoomOrRemove(this)
        if (!room) return true

        const tier = flagName.match(/\/B-(T[0-3])(?:\/|$)/)?.[1] || flagName.match(/^LOOT\/(T[0-3])\//)?.[1] || 'T0'
        const config = LOOT_CONFIG[tier] || LOOT_CONFIG['T0']

        const sourceRoom = this.pos.roomName
        const source = Game.rooms[sourceRoom]
        if (source && !this.hasLootableResources(source)) {
            this.remove()
            return true
        }
        const targetRoom = room.name
        const bodys = config.bodypart as any

        if (config.boostmap && !room.CheckBoostRes(bodys, config.boostmap)) {
            console.log(flagName, '没有足够的boost资源')
            this.remove()
            return true
        }

        const spawnRet = room.SpawnMissionAdd('', bodys, -1, 'logistic', {
            sourceRoom,
            targetRoom,
            boostmap: config.boostmap,
        } as any)
        if (spawnRet !== OK) return true

        return true
    }

    private hasLootableResources(room: Room): boolean {
        const dropped = room.find(FIND_DROPPED_RESOURCES, { filter: r => r.amount > 500 })
        if (dropped.length) return true

        const ruins = room.find(FIND_RUINS, { filter: r => r.store.getUsedCapacity() > 0 })
        if (ruins.length) return true

        const tombstones = room.find(FIND_TOMBSTONES, { filter: t => t.store.getUsedCapacity() > 0 })
        if (tombstones.length) return true

        if (room.storage && room.storage.store.getUsedCapacity() > 0) return true
        if (room.terminal && room.terminal.store.getUsedCapacity() > 0) return true

        const containers = room.find(FIND_STRUCTURES, {
            filter: (s): s is StructureContainer =>
                s.structureType === STRUCTURE_CONTAINER && (s as StructureContainer).store.getUsedCapacity() > 0,
        })
        return containers.length > 0
    }
}
