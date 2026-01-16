import RoomArray from './TeamRoomArray'
import TeamCalc from './TeamCalc';
import TeamVisual from './TeamVisual';

/**
 * 小队缓存
 */
export default class TeamCache {
    /**
     * 空房间数组，不要修改它
     */
    public static emptyRoomArray = new RoomArray()
    /**
     * 缓存各房间的塔伤信息
     */
    protected static cacheTowerRoomArray: { [roomName: string]: { time: number; value: RoomArray } } = {}
    /**
     * 缓存房间建筑信息
     */
    public static cacheStructs: {
        [roomName: string]: {
            pos: RoomPosition
            my?: boolean
            owner?: string
            structureType: string
            hits: number
        }[]
    } = {}

    /**
     * 创建塔伤分布图
     */
    protected static createTowerDamageMap(towerInfoList: any[]) {
        // 计算房间每个位置的防御塔总伤害
        const arr = new RoomArray()
        // 可以工作的防御塔
        const workTower = towerInfoList.filter((tower) => tower.work)

        arr.forEach((x, y) => {
            arr.set(
                x,
                y,
                workTower.reduce((sum, tower) => {
                    // 计算防御塔对该位置的伤害
                    const distance = Math.max(Math.abs(x - tower.x), Math.abs(y - tower.y))
                    // 伤害 = 基础伤害 * 强化倍率 * (1 - 0.1 * distance)
                    return sum + TeamCalc.calcTowerDamage(distance) * tower.effect
                }, 0),
            )
        })

        return arr
    }

    /**
     * 获取塔伤分布图
     */
    public static getTowerDamageMap(roomName: string) {
        // 当前 tick 计算过直接返回
        if (this.cacheTowerRoomArray[roomName] && this.cacheTowerRoomArray[roomName].time === Game.time) {
            return this.cacheTowerRoomArray[roomName].value
        }

        if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {} as RoomMemory
        Memory.rooms[roomName]['lastUpdate'] = Game.time

        const room = Game.rooms[roomName]
        // 看得见房间就重新计算，刷新缓存
        if (room) {
            // 注意，九房核心的 tower 的 isActive()是 false，所以这里不做判断
            const towers = room.controller ? room.tower.filter((tower) => tower.isActive()) : room.tower
            if (!towers.length) return this.emptyRoomArray

            // 获取塔的基本信息
            const towerInfos = towers.map((tower) => {
                // 计算强化效果
                const effect =
                    tower.effects?.reduce((sum, effect: PowerEffect) => {
                        // 增伤
                        if (effect.effect === PWR_OPERATE_TOWER) {
                            return sum * (1 + effect.level * 0.1)
                        }
                        // 减伤
                        if (effect.effect === PWR_DISRUPT_TOWER) {
                            return sum * (1 - effect.level * 0.1)
                        }
                        return sum
                    }, 1) || 1

                return {
                    id: tower.id,
                    x: tower.pos.x,
                    y: tower.pos.y,
                    work: tower.store.energy > 10,
                    effect: effect,
                }
            })

            const oldTowerInfos = Memory.rooms[roomName]['towerInfos']
            Memory.rooms[roomName]['towerInfos'] = towerInfos

            if (oldTowerInfos) {
                // 综合 id
                const ids = towerInfos.map((tower) => tower.id + tower.work + tower.effect)
                const oldIds = oldTowerInfos.map((tower) => tower.id + tower.work + tower.effect)
                const oldIdsSet = new Set(oldIds)
                // 如果数量不一样或者有不同的 id
                if (ids.length !== oldIds.length || !ids.every((id) => oldIdsSet.has(id))) {
                    // 重新计算
                    this.cacheTowerRoomArray[roomName] = {
                        time: Game.time,
                        value: this.createTowerDamageMap(towerInfos),
                    }
                }
            }

            if (!this.cacheTowerRoomArray[roomName]) {
                this.cacheTowerRoomArray[roomName] = {
                    time: Game.time,
                    value: this.createTowerDamageMap(towerInfos),
                }
            }

            return this.cacheTowerRoomArray[roomName].value
        }

        // 看不见房间尝试从内存中拿
        const towerInfos = Memory.rooms[roomName]['towerInfos']
        if (!towerInfos) return this.emptyRoomArray

        // 存在直接返回
        if (this.cacheTowerRoomArray[roomName]) {
            return this.cacheTowerRoomArray[roomName].value
        }

        // 否则重新计算并缓存
        return (this.cacheTowerRoomArray[roomName] = {
            time: Game.time,
            value: this.createTowerDamageMap(towerInfos),
        }).value
    }

    /**
     * 绘制塔伤分布图
     */
    public static drawTowerDamageMap(roomName: string) {
        const damageMap = this.getTowerDamageMap(roomName)

        TeamVisual.drawRoomArray(roomName, damageMap, '#ff0000')
    }

    /**
     * 获取房间建筑，房间不可见时从缓存中读
     */
    public static getStructures(roomName: string) {
        const room = Game.rooms[roomName]
        if (!room) {
            return this.cacheStructs[roomName] || []
        }

        const structures = room.find(FIND_STRUCTURES);
        const result = structures.map((s) => ({
            pos: s.pos,
            my: (s as any).my as boolean,
            owner: 'owner' in s ? s.owner?.username : '',
            structureType: s.structureType,
            hits: s.hits,
        }))
        return (this.cacheStructs[roomName] = result)
    }

    /**
     * 获取敌人防御性的建筑（rampart，constructedWall）
     */
    public static getDefensiveStructure(room: Room) {
        const structures = room.find(FIND_STRUCTURES)
        const defensiveStructures = structures.filter(
            (s) => (s.structureType === STRUCTURE_RAMPART && !s.my) || s.structureType === STRUCTURE_WALL,
        )
        return defensiveStructures
    }

    /**
     * 压缩洪水填充数组
     */
    public static compressFloodArray(floodArray: RoomArray) {
        const result = []
        for (let i = 0; i < 50; i++) {
            result[i] = ''
            for (let j = 0; j < 50; j++) {
                result[i] += floodArray.get(i, j)
            }
        }
        return result
    }

    /**
     * 获取洪水填充分布图（暂时只用于敌人房间）
     * 用于将敌人房间划分为不连通的区域，爬只能寻找自己区域内的对象
     */
    public static getFloodFillMap(room: Room, isFour = false) {
        if (!room) return

        const defensiveStructures = this.getDefensiveStructure(room)
        if (!room.memory) room.memory = {} as RoomMemory
        room.memory['lastUpdate'] = Game.time
        room.memory['defensiveStructuresLength'] = room.memory['defensiveStructuresLength'] || 0
        if (room.memory['defensiveStructuresLength'] !== defensiveStructures.length) {
            delete room.memory['floodFill']
            delete room.memory['floodFillTick']
        }

        if (room.memory['floodFill'] && room.memory['floodFillTick'] && Game.time - room.memory['floodFillTick'] < 100) {
            return room.memory['floodFill']
        }

        room.memory['boundaryWallCount'] = 0

        function floodFillSegment(_floodArray: RoomArray, i: number, j: number, value: number) {
            if (_floodArray.get(i, j) == 1) {
                _floodArray.set(i, j, value)
                if (i - 1 >= 0) floodFillSegment(_floodArray, i - 1, j, value)
                if (i + 1 <= 49) floodFillSegment(_floodArray, i + 1, j, value)
                if (j - 1 >= 0) floodFillSegment(_floodArray, i, j - 1, value)
                if (j + 1 <= 49) floodFillSegment(_floodArray, i, j + 1, value)

                if (i - 1 >= 0 && j - 1 >= 0) floodFillSegment(_floodArray, i - 1, j - 1, value)
                if (i + 1 <= 49 && j - 1 >= 0) floodFillSegment(_floodArray, i + 1, j - 1, value)
                if (i - 1 >= 0 && j + 1 <= 49) floodFillSegment(_floodArray, i - 1, j + 1, value)
                if (i + 1 <= 49 && j + 1 <= 49) floodFillSegment(_floodArray, i + 1, j + 1, value)
            }
            // 防御墙
            else if (_floodArray.get(i, j) == 0) {
                _floodArray.set(i, j, 3)
                room.memory['boundaryWallCount']!++
            }
        }

        if (defensiveStructures.length) {
            const floodArray = new RoomArray()
            const terrain = new Room.Terrain(room.name)
            // 内部防御墙 0，平原 1，自然墙 2，边缘防御墙 3
            for (let i = 0; i < 50; i++) {
                for (let j = 0; j < 50; j++) {
                    floodArray.set(i, j, terrain.get(i, j) & TERRAIN_MASK_WALL ? 2 : 1)
                }
            }

            for (const s of defensiveStructures) {
                floodArray.set(s.pos.x, s.pos.y, 0)
                if (isFour) {
                    floodArray.set(s.pos.x-1, s.pos.y-1, 0)
                    floodArray.set(s.pos.x-1, s.pos.y, 0)
                    floodArray.set(s.pos.x, s.pos.y-1, 0)
                }
            }

            let cnt = 0
            for (let i = 0; i < 50; i++) {
                if (floodArray.get(i, 0) == 1) {
                    floodFillSegment(floodArray, i, 0, 4)
                    cnt++
                }
            }
            for (let i = 0; i < 50; i++) {
                if (floodArray.get(49, i) == 1) {
                    floodFillSegment(floodArray, 49, i, 5)
                    cnt++
                }
            }
            for (let i = 0; i < 50; i++) {
                if (floodArray.get(i, 49) == 1) {
                    floodFillSegment(floodArray, i, 49, 6)
                    cnt++
                }
            }

            for (let i = 0; i < 50; i++) {
                if (floodArray.get(0, i) == 1) {
                    floodFillSegment(floodArray, 0, i, 7)
                    cnt++
                }
            }

            room.memory['blockCount'] = cnt
            room.memory['floodFill'] = this.compressFloodArray(floodArray)
            room.memory['floodFillTick'] = Game.time
        } else {
            room.memory['blockCount'] = 1
            delete room.memory['floodFill']
            delete room.memory['floodFillTick']
        }

        if (defensiveStructures.length) {
            room.memory['defensiveStructuresLength'] = defensiveStructures.length
        } else {
            room.memory['defensiveStructuresLength'] = 0
        }

        return room.memory['floodFill']
    }

    /**
     * 获取本区域内的可以攻击的建筑
     */
    public static getStructuresInFloodFill(creep: Creep, structures: Structure[], isFour = false) {
        if (!creep || !creep.room.controller) return structures

        // 假设房间内有控制器，否则不会调用本函数
        const room = creep.room
        const floodFill = this.getFloodFillMap(room, isFour)

        // 房间各区域连通
        if (!floodFill && room.memory['blockCount'] === 1) {
            // 先找裸露的建筑
            const exposedStructures = structures.filter((s) => {
                return 'owner' in s && s.structureType !== STRUCTURE_RAMPART && !s.pos.coverRampart()
            })
            if (exposedStructures.length) {
                return exposedStructures
            }

            // 找底下有建筑的 rampart
            // 先找塔
            const towersInRampart = structures.filter((s) => {
                return s.structureType === STRUCTURE_TOWER
            })
            if (towersInRampart.length) {
                return towersInRampart
            }

            // 再找 spawn
            const spawnsInRampart = structures.filter((s) => {
                return s.structureType === STRUCTURE_SPAWN
            })
            if (spawnsInRampart.length) {
                return spawnsInRampart
            }

            // 再找控制器周围的 rampart
            const controllerRamparts = structures.filter(
                (s) => s.structureType == STRUCTURE_RAMPART && room.controller!.pos.isNearTo(s),
            )
            if (controllerRamparts.length) return controllerRamparts

            // 再找有建筑的 rampart
            const otherInRamparts = structures.filter(
                (s) => s.structureType != STRUCTURE_RAMPART && s.pos.coverRampart(),
            )
            if (otherInRamparts.length) return otherInRamparts

            // 找没建筑的 rampart 打
            const exposedRamparts = structures.filter((s) => s.structureType == STRUCTURE_RAMPART)
            if (exposedRamparts.length) return exposedRamparts
        } else {
            if (!floodFill) return structures
            // 可达值
            const connectValue = floodFill[creep.pos.x][creep.pos.y]
            // 找到暴露的建筑
            const exposedStructures = structures.filter(
                (s) => floodFill[s.pos.x][s.pos.y] == connectValue && 'owner' in s,
            )
            const tower = exposedStructures.filter((s) => s.structureType == STRUCTURE_TOWER)
            if (tower.length) return tower

            const spawn = exposedStructures.filter((s) => s.structureType == STRUCTURE_SPAWN)
            if (spawn.length) return spawn

            if (exposedStructures.length) return exposedStructures

            // 找到底下有 tower 的 rampart
            const towersInRampart = structures.filter((s) => s.structureType == STRUCTURE_TOWER)
            const exposedTowersInRampart = towersInRampart.filter((s) => floodFill[s.pos.x][s.pos.y] == '3')
            if (exposedTowersInRampart.length) return exposedTowersInRampart

            // 找到底下有 spawn 的 rampart
            const spawnsInRampart = structures.filter((s) => s.structureType == STRUCTURE_SPAWN)
            const exposedSpawnsInRampart = spawnsInRampart.filter((s) => floodFill[s.pos.x][s.pos.y] == '3')
            if (exposedSpawnsInRampart.length) return exposedSpawnsInRampart

            const exposedWall = structures.filter(
                (s) =>
                    (s.structureType == STRUCTURE_RAMPART || s.structureType == STRUCTURE_WALL) &&
                    floodFill[s.pos.x][s.pos.y] == '3',
            )
            exposedWall.forEach((s) => (s['_nearValue'] = new Set(s.pos.nearPos(1).map((p) => +floodFill[p.x][p.y]))))
            const touchableWall = exposedWall.filter(
                (s) => (s['_nearValue']!.has(1) || s['_nearValue']!.has(0)) && s['_nearValue']!.has(+connectValue),
            )
            const bestWall = touchableWall.sort((a, b) => a.hits - b.hits).slice(0, 3)
            if (bestWall.length) return bestWall

            const controllerRamparts = structures.filter(
                (s) =>
                    (s.structureType == STRUCTURE_RAMPART || s.structureType == STRUCTURE_WALL) &&
                    // 不会真有人控制器旁边修三层墙吧？
                    room.controller!.pos.getRangeTo(s) < 2,
            )
            const exposedControllerRamparts = controllerRamparts.filter((s) => floodFill[s.pos.x][s.pos.y] == '3')
            if (exposedControllerRamparts.length) return exposedControllerRamparts

            // 有建筑的 rampart
            const otherInRamparts = structures.filter(
                (s) =>
                    floodFill[s.pos.x][s.pos.y] == '3' &&
                    s.structureType != STRUCTURE_RAMPART &&
                    s.structureType != STRUCTURE_WALL,
            )
            if (otherInRamparts.length) return otherInRamparts

            // 找没建筑的 rampart 打
            const exposedRamparts = structures.filter(
                (s) => floodFill[s.pos.x][s.pos.y] == '3' && s.structureType == STRUCTURE_RAMPART,
            )
            if (exposedRamparts.length) return exposedRamparts
        }

        return structures
    }

    /**
     * 获取本区域内的可以攻击的爬
     */
    public static getCreepsInFloodFill(creep: Creep, hostileCreeps: Creep[], isFour = false) {
        if (!creep || !creep.room.controller) return hostileCreeps

        const room = creep.room
        const floodFill = this.getFloodFillMap(room, isFour)

        // 房间各区域连通
        if (!floodFill && room.memory['blockCount'] === 1) {
            // 找到暴露的爬
            const exposedCreeps = hostileCreeps.filter((e) => !e.pos.coverRampart())
            if (exposedCreeps.length) return exposedCreeps

            return hostileCreeps
        } else {
            if (!floodFill) return hostileCreeps

            // 可达值
            const connectValue = floodFill[creep.pos.x][creep.pos.y]
            // 找到暴露的爬
            const exposedCreeps = hostileCreeps.filter((e) => floodFill[e.pos.x][e.pos.y] == connectValue)
            if (exposedCreeps.length) return exposedCreeps
        }

        return []
    }



}