import TeamCalc from "./TeamCalc"
import TeamCache from "./TeamCache";
import TeamAction from "./TeamAction";

/**
 * 战斗类
 */
export default class TeamBattle {
    /**
     * 中立建筑
     */
    public static neutralStructures = new Set(['road', 'keeperLair', 'container'])

    /**
     * 蓝球贴近小队时造成的伤害倍数
     */
    public static rangeNearDamageRate: { [members: number]: number } = {
        1: 1,
        2: 2,
        3: 2.4,
        4: 2.8,
    }

    /**
     * n tick 内能否奶住
     * @returns true 表示能奶住，false 表示不能奶住
     *
     * TODO: 优化算伤策略，同时考虑会陷入沼泽的情况
     */
    public static canHealInNTick(team: Team, tick: number) {
        const creeps = team.creeps as any;

        // 搜索 n tick 后会攻击到自己的敌人
        creeps.forEach((creep) => {
            // 三格的蓝球敌人
            creep._ra_enemys = creep.room.find(FIND_HOSTILE_CREEPS).filter((e) => {
                return (
                    e.pos.inRangeTo(creep.pos, 3 + tick) &&
                    TeamCalc.hasBodyPart(e, RANGED_ATTACK) &&
                    TeamAction.touchableNTickInRange(e, creep.pos, tick, 3)
                )
            })

            // 一格的蓝球或者红球敌人
            creep._ra_atk_enemys = creep.room.find(FIND_HOSTILE_CREEPS).filter((e) => {
                return (
                    e.pos.inRangeTo(creep.pos, 1 + tick) &&
                    (TeamCalc.hasBodyPart(e, RANGED_ATTACK) || TeamCalc.hasBodyPart(e, ATTACK)) &&
                    TeamAction.touchableNTickInRange(e, creep.pos, tick, 1)
                )
            })

            // 被集火的伤害，即假设周围的爬都打到自己的伤害
            let maxCreepDamage = 0
            creep._ra_enemys.forEach((e) => {
                if (e._ra_damage === undefined) {
                    // rangedAttack 虽然是 3 格远，但是伤害和 1 格一样，同时不考虑敌人受伤（可能随时可能奶回来）
                    e._ra_damage = TeamCalc.calcRangeDamage(e, 1, false, false)
                }
                maxCreepDamage += e._ra_damage
            })
            creep._ra_atk_enemys.forEach((e) => {
                if (e._atk_damage === undefined) {
                    e._atk_damage = TeamCalc.calcAttackDamage(e, 1, false)
                }
                // 自己也有红球的话，打别人会造成反伤
                maxCreepDamage += e._atk_damage * (TeamCalc.hasBodyPart(creep, ATTACK) ? 2 : 1)
                // TODO: 一格以内的蓝球，对面肯定 mass，需要根据小队人数算出更大的伤害
                // maxCreepDamage += (e._ra_damage || 0) * BattleCore.rangeNearDamageRate[creeps.length]
            })

            // 塔伤分布图
            const towerDamageMap = creep.room.my
                ? TeamCache.emptyRoomArray
                : TeamCache.getTowerDamageMap(creep.room.name)
            // 集火伤害
            creep._fired_damage = maxCreepDamage + towerDamageMap.get(creep.pos.x, creep.pos.y)
            // 调试
            if (team.cache._virtual_damage) {
                creep._fired_damage = team.cache._virtual_damage
            }
        })

        let totalHeal = 0
        creeps.forEach((creep) => {
            if (creep._heal_power === undefined) {
                // 当前 tick 每个爬的真实治疗量
                creep._heal_power = TeamCalc.calcHealDamage(creep, 1, false, true)
            }
            totalHeal += creep._heal_power
        })

        creeps.forEach((creep) => {
            // 下一 tick 每个爬回满血需要的治疗量
            creep._need_heal_power = TeamCalc.calcDamageNeedHeal(creep, creep._fired_damage!, true)
            creep._heal_need = creep._need_heal_power
            // 当前 tick 对爬的破防伤害
            creep._break_damage = creep._break_damage ?? TeamCalc.calcHealHoldRealDamage(creep, totalHeal, true)
            // 不给治疗的话下一 tick 的虚拟血量
            creep._virtual_hits = creep.hitsMax - creep._need_heal_power
        })

        // 当前 tick 奶周围的爬（包括自己）
        creeps.forEach((creep) => {
            if (!creep._heal_power) return

            const needHealCreeps = creeps.filter((other) => other._need_heal_power! > 0 && creep.pos.isNearTo(other))
            if (!needHealCreeps.length) return

            // 找到周围破防伤害最小的爬
            const hurtCreeps = needHealCreeps.filter((c) => c.hits < c.hitsMax)
            let maxNeedHealCreep =
                hurtCreeps.length >= 1 &&
                hurtCreeps.reduce((pre, cur) => {
                    return pre._break_damage! < cur._break_damage! ? pre : cur
                })
            if (!maxNeedHealCreep) {
                // 找到周围需要奶量最大的爬
                maxNeedHealCreep = needHealCreeps.reduce((pre, cur) => {
                    return pre._need_heal_power! > cur._need_heal_power! ? pre : cur
                })
            }

            // tick 为 0 时才是真实情况，其他情况只是模拟未来的，而治疗需要根据真实情况
            if (tick === 0) {
                creep.heal(maxNeedHealCreep)
                maxNeedHealCreep._been_heal = true;
            }

            maxNeedHealCreep._need_heal_power! -= creep._heal_power!
            maxNeedHealCreep._virtual_hits! = Math.min(
                maxNeedHealCreep._virtual_hits! + creep._heal_power!,
                creep.hitsMax,
            )
        })

        if (creeps.every((creep) => !creep._fired_damage)) {
            return true
        }

        if (creeps.some((creep) => creep._virtual_hits! < 0 || creep.hits < creep.hitsMax * 0.6)) {
            // 第一 tick 就寄啦
            return false
        }

        // 下一 tick
        // 总奶量
        const totalNextTickHeal = creeps.reduce(
            (pre, cur) => pre + TeamCalc.calcHealDamage(cur, 1, false, cur._virtual_hits),
            0,
        )

        // 检查每个爬能否 hold 住
        if (
            creeps.find(
                (creep) =>
                    TeamCalc.calcHealHoldRealDamage(creep, totalNextTickHeal, creep._virtual_hits!) <
                    creep._fired_damage!,
            )
        ) {
            return false
        }

        return true
    }

    

    /**
     * 小队能承受的最大伤害，大于该值一定会破防，低于该值可能破防
     */
    public static maxBreakDamage(team: Team) {
        const creeps = team.creeps as any;
        // 取所有爬中最小的破防伤害
        this['_max_damage'] = creeps.reduce((pre, cur) =>(pre < cur._break_damage! ? pre : cur._break_damage), Infinity)
        return this['_max_damage'];
    }

    /**
     * 获取攻击目标，赶路的时候用，打爬以及低血量的建筑
     */
    public static getAttackTargets(creep: Creep) {
        const hostileCreeps = creep.room.findEnemyCreeps();
        const hostileStructures = creep.room
            .findEnemyStructures()
            .filter((s) => s.hits && s.hits < TeamAction.structHitLimit)
        return [...hostileCreeps, ...hostileStructures].filter((s) => creep.pos.inRangeTo(s, 3))
    }

    /**
     * 选取寻路目标
     */
    public static chooseTargets(team: Team) {
        if (!team.flag) return;
        const room = team.flag.room;
        // 旗帜是黄色表示专注建筑
        const isFocusStructure = team.flag.color === COLOR_YELLOW || 
            team.creeps.every((c) => !c.getActiveBodyparts(ATTACK) && !c.getActiveBodyparts(RANGED_ATTACK));
        // 是否先打爬
        const preferCreep = team.flag.color === COLOR_BLUE
        // 是否优先打旗帜下面的东西
        const preferFlag = team.flag.color === COLOR_RED

        const result: (Creep | Structure | Flag)[] = []
        const creep = team.creeps.find((c) => c.room.name === team.flag.pos.roomName)

        if (room && creep) {
            if (preferFlag) {
                const targets = [...team.flag.pos.lookFor(LOOK_STRUCTURES)].filter((s) => s.structureType !== STRUCTURE_ROAD)
                if (targets.length) {
                    team['_targets'] = [targets[0]]
                    return
                }
            }

            let canAttackStructures: Structure[] = []
            let canAttackCreeps: Creep[] = []

            const getCanAttackStructures = () => {
                const structures = room.findEnemyStructures()
                    .filter((s) => s.hits && !this.neutralStructures.has(s.structureType))
                    team['_attackable_structures'] = structures
                canAttackStructures = TeamCache.getStructuresInFloodFill(creep, structures, team.creeps.length >= 3)
            }

            const getCanAttackCreeps = () => {
                const creeps = room.findEnemyCreeps().filter((e) => e.owner.username !== 'Source Keeper')
                team['_attackable_creeps'] = creeps
                canAttackCreeps = TeamCache.getCreepsInFloodFill(creep, creeps, team.creeps.length >= 3)
            }

            if (isFocusStructure) {
                getCanAttackStructures()
            } else if (preferCreep) {
                getCanAttackCreeps()
                if (!canAttackCreeps.length) {
                    getCanAttackStructures()
                }
            } else {
                getCanAttackCreeps()
                getCanAttackStructures()
            }

            result.push(...canAttackStructures, ...canAttackCreeps)
        }

        if (result.length === 0) {
            result.push(team.flag)
        }
        team['_targets'] = result
    }


    /**
     * 自动攻击
     */
    public static autoAttack(team: Team) {
        let targets = team['_targets']?.filter((s) => 'hits' in s) as (Creep | Structure)[]
        team['_attackTargets'] = []

        const clearPathCache = (creep: Creep) => {
            if (creep.pos.isNearEdge(2)) return false
            TeamAction.clearPathCache(team)
            return true
        }


        team.creeps.forEach((creep) => {
            // 不是目标房间靠近就打
            if (creep.room.name !== team.targetRoom) {
                targets = this.getAttackTargets(creep)!
            }

            if (!targets?.length) return

            let expand = false
            let targetsInThreeRange = targets.filter((s) => creep.pos.inRangeTo(s, 3))
            if (!targetsInThreeRange.length) {
                targetsInThreeRange = [
                    ...(team['_attackable_creeps'] || []),
                    ...(team['_attackable_structures'] || []),
                ].filter((s) => creep.pos.inRangeTo(s, 3))
                expand = true
            }
            if (!targetsInThreeRange.length) {
                // 删除寻路缓存
                clearPathCache(creep)
                return
            }

            if (creep.getActiveBodyparts(RANGED_ATTACK)) {
                // 先找爬中生命最小的，再找建筑最近的
                let target: Creep | Structure
                const targetCreeps: Creep[] = []
                const targetStructures: Structure[] = []
                targetsInThreeRange.forEach((s) => {
                    if (s instanceof Creep) {
                        targetCreeps.push(s)
                    } else {
                        targetStructures.push(s)
                        s['_range'] = creep.pos.getRangeTo(s)
                    }
                })

                if (targetCreeps.length && !team.cache.forceStructure) {
                    target = targetCreeps.reduce((pre, cur) => (pre.hits < cur.hits ? pre : cur))
                } else {
                    target = targetStructures.reduce((pre, cur) => (pre['_range']! < cur['_range']! ? pre : cur))
                }

                // 与目标相邻且有 owner 属性
                if (creep.pos.isNearTo(target) && 'owner' in target) {
                    creep.rangedMassAttack()
                } else {
                    creep.rangedAttack(target)
                }
                team['_attackTargets'].push(target)
            }


            if (creep.getActiveBodyparts(ATTACK)) {
                
                let targetsInOneRange = targetsInThreeRange.filter((s) => creep.pos.inRangeTo(s, 1))

                if (!expand && !targetsInOneRange.length) {
                    targetsInOneRange = [
                        ...(team['_attackable_creeps'] || []),
                        ...(team['_attackable_structures'] || []),
                    ].filter((s) => creep.pos.inRangeTo(s, 1))
                }
                
                const attackableTargets = targetsInOneRange.filter((s) => {
                    if (s instanceof Creep && s.pos.coverRampart()) return false;
                    if (s instanceof Creep && s.getActiveBodyparts(ATTACK)) {
                        // 如果attack对撞伤害大于血量就不打
                        // 伤害倍率, 如果本tick被治疗则按正常倍率算, 否则按溢出算
                        const ratio = creep['_been_heal'] ? 2 : 2.5
                        const attackDamage = TeamCalc.calcPartTypeDamage(s, ATTACK, 1, false, true);
                        const realDamage = TeamCalc.calcRealDamage(creep, attackDamage*ratio);
                        return creep['_been_heal'] ? realDamage < creep.hits :
                                creep.hits - realDamage > creep.hitsMax * 0.4;
                    } else return true;
                })
                if (!attackableTargets.length) {
                    // 删除寻路缓存
                    clearPathCache(creep)
                    return
                }

                const target = attackableTargets.reduce((pre, cur) => (pre.hits < cur.hits ? pre : cur))
                creep.attack(target)
                team['_attackTargets']?.push(target)
            }

            if (creep.getActiveBodyparts(WORK)) {
                let targetInOneRange = targetsInThreeRange
                    .filter((s) => creep.pos.inRangeTo(s, 1))
                    .filter((s) => {
                        return s instanceof Structure
                    }) as Structure[]
                if (!expand && !targetInOneRange.length) {
                    targetInOneRange = [...(team['_attackable_structures'] || [])].filter((s) =>
                        creep.pos.inRangeTo(s, 1),
                    ) as Structure[]
                }
                if (!targetInOneRange.length) {
                    // 删除寻路缓存
                    clearPathCache(creep)
                    return
                }

                const target = targetInOneRange.reduce((pre, cur) => (pre.hits < cur.hits ? pre : cur))
                creep.dismantle(target)
                team['_attackTargets']?.push(target)
            }
        })
    }

    /**
     * 添加需要避让的物体
     */
    public static addAvoidObjs(team: Team, range = 1) {
        if (!team.flag) return;
        if (team.status === 'avoid' || team.status === 'flee') {
            team.cache.lastAvoidTime = Game.time
        }

        if (!team.cache.lastAvoidTime || team.cache.lastAvoidTime + 3 < Game.time) {
            return
        }

        const roomsSet = new Set(team.creeps.map((creep) => creep.room))
        if (team.flag.room) roomsSet.add(team.flag.room)
        const rooms = Array.from(roomsSet)
        const hostiles: Creep[] = []
        rooms.forEach((room) => {
            hostiles.push(
                ...room.findEnemyCreeps().filter((e) => {
                    if (!e.getActiveBodyparts(RANGED_ATTACK) && !e.getActiveBodyparts(ATTACK)) {
                        return false;
                    }
                    return team.creeps.every((c) => c.pos.crossRoomGetRangeTo(e.pos) <= range + 5)
                }),
            )
        })

        team['_avoidObjs'] = hostiles.map((e) => ({
            pos: e.pos,
            range: range + (e.getActiveBodyparts(RANGED_ATTACK) ? 3 : 1),
        }))
    }
}