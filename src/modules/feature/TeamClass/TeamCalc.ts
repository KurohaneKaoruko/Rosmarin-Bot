/**
 * 计算函数
 */
export default class TeamCalc {
    /**
     * 基础攻击力
     */
    public static BODY_POWER: { [part: string]: number } = {
        [WORK]: DISMANTLE_POWER,
        [RANGED_ATTACK]: RANGED_ATTACK_POWER,
        [ATTACK]: ATTACK_POWER,
        [HEAL]: HEAL_POWER,
    }

    /**
     * boost 资源对应的强化倍数
     */
    public static BOOST_POWER: { [boost: string]: number } = Object.values(BOOSTS)
        .map((e) => Object.entries(e).map((e) => [e[0], Object.values(e[1])[0]]))
        .reduce((a, b) => a.concat(b), [])
        .reduce((a, [boost, number]) => ({ ...a, [boost]: number }), {})


    /**
     * 计算塔伤
     */
     public static calcTowerDamage(distance: number) {
        if (distance <= 5) return 600
        else if (distance <= 20) return 750 - 30 * distance
        else return 150
    }

    /**
     * 计算爬的某种部件的伤害（抄的 63 的）
     *
     * @param creep 爬
     * @param partType 部件类型
     * @param distance 距离
     * @param massAttack 是否使用范围伤害
     * @param checkHits 是否检查 hits，不检查则认为是满血
     */
    public static calcPartTypeDamage(
        creep: Creep,
        partType: BodyPartConstant,
        distance = 1,
        massAttack = false,
        checkHits = false,
    ) {
        let power = this.BODY_POWER[partType]
        if (massAttack && distance > 1 && distance <= 3 && partType == RANGED_ATTACK) power = distance == 2 ? 4 : 1
        else if (massAttack && distance > 1 && distance <= 3 && partType == HEAL) power = RANGED_HEAL_POWER
        else if (distance > 1 && partType != RANGED_ATTACK) power = 0
        else if (distance > 3) power = 0

        if (checkHits) {
            return (
                power *
                _.sum(creep.body, (part) =>
                    part.type == partType && (part.hits || !checkHits)
                        ? part.boost
                            ? this.BOOST_POWER[part.boost]
                            : 1
                        : 0,
                )
            )
        }

        return (
            power *
            _.sum(creep.body, (part) =>
                part.type == partType ? (part.boost ? this.BOOST_POWER[part.boost] : 1) : 0,
            )
        )
    }

    /**
     * 计算爬 rangedAttack 部件的伤害
     */
    public static calcRangeDamage(creep: Creep, distance = 1, massAttack = false, checkHits = false) {
        return this.calcPartTypeDamage(creep, RANGED_ATTACK, distance, massAttack, checkHits)
    }

    /**
     * 计算爬 attack 部件的伤害
     */
    public static calcAttackDamage(creep: Creep, distance = 1, checkHits = false) {
        return this.calcPartTypeDamage(creep, ATTACK, distance, false, checkHits)
    }

    /**
     * 计算爬 work 部件的伤害
     */
    public static calcWorkDamage(creep: Creep, distance = 1, checkHits = false) {
        return this.calcPartTypeDamage(creep, WORK, distance, false, checkHits)
    }

    /**
     * 计算爬 heal 部件的治疗量
     *
     * @param checkHits 是否检查 hits，为数量时表示虚拟血量
     */
    public static calcHealDamage(creep: Creep, distance = 1, rangeHeal = false, checkHits: boolean | number = false) {
        if (typeof checkHits === 'number') {
            // 进入虚拟血量环节
            let power = distance > 3 ? 0 : HEAL_POWER
            if (distance > 1 && !rangeHeal) power = 0
            if (rangeHeal && distance > 1 && distance <= 3) power = RANGED_HEAL_POWER

            // 部件数
            checkHits = Math.ceil(checkHits / 100)

            return (
                power *
                _.sum([...creep.body].reverse().slice(0, checkHits), (part) =>
                    part.type == HEAL ? (part.boost ? this.BOOST_POWER[part.boost] : 1) : 0,
                )
            )
        }

        return this.calcPartTypeDamage(creep, HEAL, distance, rangeHeal, checkHits)
    }

    /**
     * 计算爬的总伤害
     */
    public static calcCreepDamage(creep: Creep, usedWork = true, distance = 1, massAttack = false, checkHits = false) {
        // 使用 work
        const work = usedWork ? this.calcWorkDamage(creep, distance, checkHits) : 0
        // 如果用了 work 就没办法用 attack了
        const atk = work ? 0 : this.calcAttackDamage(creep, distance, checkHits)
        return this.calcRangeDamage(creep, distance, massAttack, checkHits) + work + atk
    }

    /**
     * 计算爬受到的实际伤害
     *
     * @param creep 爬
     * @param damage 敌人的攻击力，由于会被 tough 减伤，所以并不是实际伤害
     */
    public static calcRealDamage(creep: Creep, damage: number) {
        let damageReduce = 0,
            damageEffective = damage

        if (_.any(creep.body, (i) => !!i.boost)) {
            for (let i = 0; i < creep.body.length; i++) {
                if (damageEffective <= 0) {
                    break
                }
                const bodyPart = creep.body[i]
                let damageRatio = 1
                if (
                    bodyPart.boost &&
                    // @ts-ignore
                    BOOSTS[bodyPart.type][bodyPart.boost] &&
                    // @ts-ignore
                    BOOSTS[bodyPart.type][bodyPart.boost].damage
                ) {
                    // @ts-ignore
                    damageRatio = BOOSTS[bodyPart.type][bodyPart.boost].damage
                }
                const bodyPartHitsEffective = bodyPart.hits / damageRatio
                damageReduce += Math.min(bodyPartHitsEffective, damageEffective) * (1 - damageRatio)
                damageEffective -= Math.min(bodyPartHitsEffective, damageEffective)
            }
        }

        damage -= Math.round(damageReduce)
        return damage
    }


    /**
     * 计算给定奶量的情况下，多少伤害会破盾。所谓破盾，可以简单理解是 tough 被击穿
     * 实际上指爬身体部件中间承伤程度最大的一段被打穿
     *
     * @param creep 爬
     * @param healPower 治疗量
     * @param checkHits 是否检查 hits，不检查则认为是满血，为数字时表示虚拟血量
     */
    public static calcHealHoldRealDamage(creep: Creep, healPower: number, checkHits: boolean | number = false): number {
        // 初始化双指针
        let left = 0 // 左指针
        let right = 0 // 右指针
        let maxDamage = 0 // 记录最大伤害
        let currentHeal = 0 // 当前累计的治疗量
        let currentDamage = 0 // 当前累计的伤害

        // 虚拟血量
        const virtualHits = typeof checkHits === 'number' ? new Array<number>(creep.body.length).fill(0) : null
        if (virtualHits && typeof checkHits === 'number') {
            for (let i = creep.body.length - 1; i >= 0; i--) {
                if (checkHits > 100) {
                    virtualHits[i] = 100
                    checkHits -= 100
                } else if (checkHits > 0) {
                    virtualHits[i] = checkHits
                    break
                }
            }
        }

        // 部件可以承受的伤害以及血量
        const partDamageAndHits = creep.body.map((part, index) => {
            const hits = checkHits === false ? 100 : virtualHits ? virtualHits[index] : part.hits
            return [part.type === TOUGH ? hits / (this.BOOST_POWER[part.boost!] || 1) : hits, hits]
        })

        // 遍历身体部件
        while (right < creep.body.length) {
            // 获取当前部件的伤害承受能力和血量
            const [partDamage, hits] = partDamageAndHits[right]

            // 如果当前累计的治疗量加上当前部件血量不超过总治疗量，则右移右指针
            if (currentHeal + hits <= healPower) {
                currentHeal += hits // 累加治疗量
                currentDamage += partDamage // 累加伤害
                right++ // 右移右指针
            } else if (left <= right) {
                // 否则，右移左指针，并减去左指针指向的部件的伤害承受能力
                const [leftPartDamage, leftHits] = partDamageAndHits[left]

                currentHeal -= leftHits
                currentDamage -= leftPartDamage
                left++ // 右移左指针
                continue
            } else {
                break
            }

            // 更新最大伤害
            maxDamage = Math.max(maxDamage, currentDamage)
        }

        return maxDamage
    }


    /**
     * 受到伤害时需要多少治疗量才能奶满血
     *
     * @example
     * 不考虑 boost，假设爬满血为 500，当前血量为 400，输入伤害 50，返回奶满需要的治疗量为 150
     *
     * @param creep 爬
     * @param damage 伤害
     * @param checkHits 是否检查 hits，不检查则认为是满血，为数字时表示虚拟血量
     *
     */
    public static calcDamageNeedHeal(creep: Creep, damage: number, checkHits: boolean | number = false) {
        if (damage <= 0) {
            return checkHits === false ? 0 : creep.hitsMax - (checkHits === true ? creep.hits : checkHits)
        }

        // 需要的奶量
        let needHeal = 0
        // 虚拟血量
        const virtualHits = typeof checkHits === 'number' ? new Array<number>(creep.body.length).fill(0) : null
        if (virtualHits && typeof checkHits === 'number') {
            for (let i = creep.body.length - 1; i >= 0; i--) {
                if (checkHits > 100) {
                    virtualHits[i] = 100
                    checkHits -= 100
                } else if (checkHits > 0) {
                    virtualHits[i] = checkHits
                    break
                }
            }
        }

        for (let i = 0; i < creep.body.length; i++) {
            const part = creep.body[i]
            const boost = part.type === TOUGH && part.boost ? this.BOOST_POWER[part.boost] : 1
            // 可以承受的伤害
            const partDamage = (checkHits === false ? 100 : virtualHits ? virtualHits[i] : part.hits) / boost

            if (damage > partDamage) {
                damage -= partDamage
                needHeal += 100
            } else if (damage > 0) {
                needHeal += damage * boost
                break
            }
        }

        return Math.round(needHeal)
    }

    /**
     * 计算爬的某种部件的能力
     */
    public static calcBodyEffectiveness(
        body: BodyPartDefinition[],
        bodyPartType: BodyPartConstant,
        methodName: string,
        basePower: number,
        checkHits: boolean,
    ) {
        let power = 0
        body.forEach((i) => {
            if ((!i.hits && checkHits) || i.type != bodyPartType) {
                return
            }
            let iPower = basePower
            // @ts-ignore
            if (i.boost && BOOSTS[bodyPartType][i.boost] && BOOSTS[bodyPartType][i.boost][methodName]) {
                // @ts-ignore
                iPower *= BOOSTS[bodyPartType][i.boost][methodName]
            }
            power += iPower
        })
        return power
    }


    /**
     * 爬是否有某种部件
     *
     * @param creep 爬
     * @param bodyPartType 部件类型
     * @param checkHits 是否检查 hits，不检查则认为是满血
     */
    public static hasBodyPart(creep: Creep, bodyPartType: BodyPartConstant, checkHits = false) {
        if (checkHits) {
            return creep.body.some((i) => i.type == bodyPartType && i.hits > 0)
        }

        return creep.body.some((i) => i.type == bodyPartType)
    }

}