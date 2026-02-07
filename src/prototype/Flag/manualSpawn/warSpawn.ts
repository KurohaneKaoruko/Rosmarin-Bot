import { RoleData } from "@/constant/CreepConstant";
import { log } from "@/utils";
import { AIO_CONFIG, type BoostMap } from "./config";
import { getSpawnRoomOrRemove, parseFlagNumber, tickThrottle } from "../utils";

export default class WarSpawnFunction extends Flag {
    handleWarSpawnFlag(): boolean {
        const flagName = this.name
        if (Game.time % 10) return true
        if (flagName.startsWith('AIO/')) return this.handleAioFlag(flagName)
        if (flagName.startsWith('CLEAN/')) return this.handleCleanFlag(flagName)
        if (flagName.startsWith('ACLAIM/')) return this.handleAttackClaimFlag(flagName)
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
        room.SpawnMissionAdd('', '', -1, 'cleaner', { targetRoom })
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
}
