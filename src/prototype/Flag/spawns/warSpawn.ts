import { RoleData, RoleDefinition } from "@/constant/CreepConstant";
import { log } from "@/modules/utils";
import { AIO_CONFIG, LOOT_CONFIG, type BoostMap } from "./config";
import { getSpawnRoomOrRemove, parseFlagNumber, tickThrottle } from "../utils";

/** 战争族旗前缀（新增战争旗在此加一行即可） */
const WAR_FLAG_PREFIXES = ['AIO/', 'CLEAN/', 'ACLAIM/', 'DIS/', 'LOOT/'] as const;

type SpawnMemoryMatcher = (memory: any) => boolean;

const matchesFlagSpawnMemory = (
    memory: any,
    flagName: string,
    role: string,
    legacyMatch: SpawnMemoryMatcher
) => {
    if (!memory || memory.role !== role) return false;
    if (memory.spawnFlag) return memory.spawnFlag === flagName;
    return legacyMatch(memory);
};

const getFlagSpawnLoad = (
    spawnRoom: Room,
    flagName: string,
    role: string,
    legacyMatch: SpawnMemoryMatcher
) => {
    let live = 0;
    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        if (matchesFlagSpawnMemory(creep?.memory, flagName, role, legacyMatch)) {
            live++;
        }
    }

    let queued = 0;
    const tasks = spawnRoom.getAllMissionFromPool('spawn') || [];
    for (const task of tasks as any[]) {
        if (matchesFlagSpawnMemory(task?.data?.memory, flagName, role, legacyMatch)) {
            queued++;
        }
    }

    return {
        live,
        queued,
        total: live + queued,
    };
};

export default class WarSpawnFunction extends Flag {
    handleWarSpawnFlag(): boolean {
        const flagName = this.name
        // 战争族旗共享 10t 节流（每旗独立计时）；非战争旗直接放行，不劫持旗链
        if (!WAR_FLAG_PREFIXES.some(p => flagName.startsWith(p))) return false
        if (!tickThrottle(this, 10, 'warScanTick')) return true
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
        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'aio',
            (memory) => memory.targetRoom === targetRoom
        )
        if (spawnLoad.total > 0) return true

        let bodys: [BodyPartConstant, number][] = []
        let boostmap: BoostMap = ((RoleData['aio'] as RoleDefinition).boostmap || {}) as BoostMap

        const B = flagName.match(/AIO\/(\w+)/)?.[1] as any
        if (AIO_CONFIG[B]) {
            bodys = AIO_CONFIG[B].bodypart || bodys
            boostmap = AIO_CONFIG[B].boostmap || boostmap
        }

        const boostBody = bodys.length == 0 ? RoleData['aio'].bodypart : bodys
        // boost 资源不足：不删旗弃单——跳过 boost 任务按原体型孵化，
        // creep 端 ensureBoosted 等 80t 后自动退化无 boost 出击（与 aidSpawn 同口径）。
        // 无限能量等特殊规则服没有 boost 产能，删旗会导致战争旗永久不可用
        const boostable = !boostmap || room.CheckBoostRes(boostBody, boostmap)
        if (!boostable) console.log(flagName, 'boost 资源不足，降级为无 boost 孵化')

        const flagMemory = this.memory as any
        // N-0 = 无限孵化（数量上限正常使用不可能为 0）；N 缺省 = 单次
        const spawnLimit = parseFlagNumber(flagName, 'N', -1)
        const maxSpawnCount = spawnLimit === 0 ? Infinity : Math.max(1, spawnLimit)
        if ((flagMemory['spawnCount'] || 0) >= maxSpawnCount) {
            console.log(flagName, '孵化数量已满')
            this.remove()
            return true
        }

        const boostOwnerId = `${flagName}:${Game.time}`
        const spawnRet = room.SpawnMissionAdd('', bodys, -1, 'aio', {
            homeRoom: room.name,
            targetRoom: targetRoom,
            boostmap: boostable ? boostmap : {},
            boostOwnerId,
            spawnFlag: flagName,
        } as any)
        if (spawnRet !== OK) return true
        if (boostable) room.AssignBoostTaskByBody(boostBody, boostmap, boostOwnerId)

        flagMemory['spawnCount'] = (flagMemory['spawnCount'] || 0) + 1
        console.log(flagName, '已添加孵化任务.')

        if (flagMemory['spawnCount'] >= maxSpawnCount) {
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
        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'cleaner',
            (memory) => memory.targetRoom === targetRoom && memory.dismantleMode === 'clean'
        )
        if (spawnLoad.total >= 1) return true
        // 拆除策略由 creep.memory.dismantleMode 驱动，便于后续扩展与精细控制
        room.SpawnMissionAdd('', '', -1, 'cleaner', { homeRoom: room.name, targetRoom, dismantleMode: 'clean', spawnFlag: flagName } as any)
        return true
    }

    // 攻击控制器
    private handleAttackClaimFlag(flagName: string): boolean {
        const spawnInterval = parseFlagNumber(flagName, 'T', 1000) || 500
        if (!tickThrottle(this, spawnInterval)) return true
        const room = getSpawnRoomOrRemove(this)
        if (!room) return true

        const targetRoom = this.pos.roomName
        // N-0 = 无限补员（数量参数正常使用不可能为 0）；每轮最多补 2 单防无限循环
        const rawNum = parseFlagNumber(flagName, 'N', -1)
        const num = rawNum === 0 ? Infinity : Math.max(1, rawNum)
        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'attack-claimer',
            (memory) => memory.targetRoom === targetRoom
        )
        const missing = Math.max(0, num - spawnLoad.total)
        const batch = Number.isFinite(num) ? missing : Math.min(missing, 2)
        // memory.num 需 JSON 安全（Infinity 序列化为 null），无限用 999 哨兵
        const memNum = Number.isFinite(num) ? num : 999
        for (let i = 0; i < batch; i++) {
            room.SpawnMissionAdd('', '', memNum, 'attack-claimer', { homeRoom: room.name, targetRoom, num: memNum, spawnFlag: flagName })
        }
        if (missing > 0) {
            log('CLAIM', `${room.name} 补充了 ${missing} 个 attack-claimer 来攻击 ${targetRoom}`)
        }
        return true
    }

    // 战争指令常见是“一次性触发”，默认 N=0 表示成功派发一次后自动删旗，避免忘关导致重复孵化
    private handleDismantleFlag(flagName: string): boolean {
        const spawnInterval = parseFlagNumber(flagName, 'T', 1000)
        if (!tickThrottle(this, spawnInterval)) return true
        const room = getSpawnRoomOrRemove(this)
        if (!room) return true

        const targetRoom = this.pos.roomName
        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'dismantle',
            (memory) => memory.targetRoom === targetRoom && memory.dismantleMode === 'route'
        )
        if (spawnLoad.total > 0) return true
        const bodys = RoleData['dismantle'].bodypart as any
        const boostmap = (RoleData['dismantle'].boostmap || {}) as BoostMap

        // boost 资源不足降级无 boost 孵化（与 AIO 同口径，见 handleAioFlag）
        const boostable = !boostmap || room.CheckBoostRes(bodys, boostmap)
        if (!boostable) console.log(flagName, 'boost 资源不足，降级为无 boost 孵化')

        const flagMemory = this.memory as any
        // N-0 = 无限孵化（数量上限正常使用不可能为 0）；N 缺省 = 单次
        const spawnCount = parseFlagNumber(flagName, 'N', -1)
        const maxSpawnCount = spawnCount === 0 ? Infinity : Math.max(1, spawnCount)
        if ((flagMemory['spawnCount'] || 0) >= maxSpawnCount) {
            console.log(flagName, '孵化数量已满')
            this.remove()
            return true
        }

        const boostOwnerId = `${flagName}:${Game.time}`
        // 拆除策略由 creep.memory.dismantleMode 驱动，避免仅靠 role 绑定策略导致歧义
        const spawnRet = room.SpawnMissionAdd('', bodys, -1, 'dismantle', {
            homeRoom: room.name,
            targetRoom,
            boostmap: boostable ? boostmap : {},
            boostOwnerId,
            dismantleMode: 'route',
            spawnFlag: flagName,
        } as any)
        if (spawnRet !== OK) return true
        if (boostable) room.AssignBoostTaskByBody(bodys, boostmap, boostOwnerId)

        flagMemory['spawnCount'] = (flagMemory['spawnCount'] || 0) + 1
        console.log(flagName, '已添加孵化任务.')

        if (flagMemory['spawnCount'] >= maxSpawnCount) {
            console.log(flagName, '孵化数量已满')
            this.remove()
        }
        return true
    }

    // 把旗帜所在房间当作 sourceRoom，把孵化房记到 homeRoom，再把资源送回 targetRoom
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
        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'logistic',
            (memory) => memory.sourceRoom === sourceRoom && memory.targetRoom === targetRoom
        )
        if (spawnLoad.total >= 1) return true
        const bodys = config.bodypart as any

        if (config.boostmap && !room.CheckBoostRes(bodys, config.boostmap)) {
            console.log(flagName, '没有足够的boost资源')
            this.remove()
            return true
        }

        const spawnRet = room.SpawnMissionAdd('', bodys, -1, 'logistic', {
            homeRoom: room.name,
            sourceRoom,
            targetRoom,
            boostmap: config.boostmap,
            spawnFlag: flagName,
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
