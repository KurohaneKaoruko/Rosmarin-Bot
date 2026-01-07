/**
 * 战斗功能类
 * 提供战斗相关方法的原型扩展
 */
export default class CombatFunction extends Creep {
    /**
     * 查找敌对 creep
     * @param range 搜索范围，默认为整个房间
     * @param options 过滤选项
     * @returns Creep[] 敌对 creep 数组
     */
    findHostileCreeps(
        range?: number,
        options?: {
            excludeWhitelist?: boolean;
            hasAttack?: boolean;
            hasRangedAttack?: boolean;
            hasHeal?: boolean;
        }
    ): Creep[] {
        const opts = {
            excludeWhitelist: true,
            hasAttack: false,
            hasRangedAttack: false,
            hasHeal: false,
            ...options
        };

        // 获取白名单
        const whiteList = new Set<string>(Memory['whitelist'] || []);

        const filter = (creep: Creep): boolean => {
            // 排除白名单玩家
            if (opts.excludeWhitelist && whiteList.has(creep.owner.username)) {
                return false;
            }
            // 过滤有攻击部件的
            if (opts.hasAttack && creep.getActiveBodyparts(ATTACK) === 0) {
                return false;
            }
            // 过滤有远程攻击部件的
            if (opts.hasRangedAttack && creep.getActiveBodyparts(RANGED_ATTACK) === 0) {
                return false;
            }
            // 过滤有治疗部件的
            if (opts.hasHeal && creep.getActiveBodyparts(HEAL) === 0) {
                return false;
            }
            return true;
        };

        if (range) {
            return this.pos.findInRange(FIND_HOSTILE_CREEPS, range, { filter });
        }
        return this.room.find(FIND_HOSTILE_CREEPS, { filter });
    }

    /**
     * 攻击最近的敌人
     * @returns ScreepsReturnCode
     */
    attackNearestHostile(): ScreepsReturnCode {
        // 检查是否有攻击部件
        if (this.getActiveBodyparts(ATTACK) === 0) {
            return ERR_NO_BODYPART;
        }

        const hostiles = this.findHostileCreeps();
        if (hostiles.length === 0) {
            return ERR_NOT_FOUND;
        }

        const target = this.pos.findClosestByRange(hostiles);
        if (!target) {
            return ERR_NOT_FOUND;
        }

        const result = this.attack(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, { visualizePathStyle: { stroke: '#ff0000' } });
        }
        return result;
    }

    /**
     * 远程攻击最近的敌人
     * @returns ScreepsReturnCode
     */
    rangedAttackNearestHostile(): ScreepsReturnCode {
        // 检查是否有远程攻击部件
        if (this.getActiveBodyparts(RANGED_ATTACK) === 0) {
            return ERR_NO_BODYPART;
        }

        const hostiles = this.findHostileCreeps();
        if (hostiles.length === 0) {
            return ERR_NOT_FOUND;
        }

        const target = this.pos.findClosestByRange(hostiles);
        if (!target) {
            return ERR_NOT_FOUND;
        }

        const result = this.rangedAttack(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, { visualizePathStyle: { stroke: '#ff6600' } });
        }
        return result;
    }

    /**
     * 自动攻击（根据身体部件和距离选择攻击方式）
     * @param target 目标，如果不提供则自动寻找最近的敌人
     * @returns ScreepsReturnCode
     */
    autoAttack(target?: Creep | Structure): ScreepsReturnCode {
        const hasAttack = this.getActiveBodyparts(ATTACK) > 0;
        const hasRangedAttack = this.getActiveBodyparts(RANGED_ATTACK) > 0;

        // 没有任何攻击部件
        if (!hasAttack && !hasRangedAttack) {
            return ERR_NO_BODYPART;
        }

        // 如果没有提供目标，自动寻找最近的敌人
        if (!target) {
            const hostiles = this.findHostileCreeps();
            if (hostiles.length === 0) {
                return ERR_NOT_FOUND;
            }
            target = this.pos.findClosestByRange(hostiles);
            if (!target) {
                return ERR_NOT_FOUND;
            }
        }

        const distance = this.pos.getRangeTo(target);

        // 距离为1且有近战攻击部件，使用近战攻击
        if (distance <= 1 && hasAttack) {
            return this.attack(target as Creep);
        }

        // 距离在3以内且有远程攻击部件，使用远程攻击
        if (distance <= 3 && hasRangedAttack) {
            return this.rangedAttack(target as Creep);
        }

        // 距离太远，移动靠近
        if (hasAttack) {
            // 有近战攻击，移动到目标旁边
            this.moveTo(target, { visualizePathStyle: { stroke: '#ff0000' } });
        } else if (hasRangedAttack) {
            // 只有远程攻击，移动到3格范围内
            if (distance > 3) {
                this.moveTo(target, { visualizePathStyle: { stroke: '#ff6600' } });
            }
        }

        return ERR_NOT_IN_RANGE;
    }

    /**
     * 逃离敌人
     * @param range 危险范围，默认为5
     * @returns boolean - true 表示正在逃跑，false 表示安全
     */
    fleeFromHostiles(range: number = 5): boolean {
        // 查找范围内有攻击能力的敌人
        const dangerousHostiles = this.findHostileCreeps(range, {
            excludeWhitelist: true
        }).filter(creep => 
            creep.getActiveBodyparts(ATTACK) > 0 ||
            creep.getActiveBodyparts(RANGED_ATTACK) > 0
        );

        if (dangerousHostiles.length === 0) {
            return false;
        }

        // 使用 PathFinder 计算逃跑路径
        const ret = PathFinder.search(
            this.pos,
            dangerousHostiles.map(c => ({ pos: c.pos, range: range + 2 })),
            {
                flee: true,
                plainCost: 2,
                swampCost: 10,
                roomCallback: (roomName) => {
                    const room = Game.rooms[roomName];
                    if (!room) return false;

                    const costs = new PathFinder.CostMatrix();

                    // 避开建筑
                    room.find(FIND_STRUCTURES).forEach(struct => {
                        if (struct.structureType === STRUCTURE_ROAD) {
                            costs.set(struct.pos.x, struct.pos.y, 1);
                        } else if (
                            struct.structureType !== STRUCTURE_CONTAINER &&
                            (struct.structureType !== STRUCTURE_RAMPART || !(struct as StructureRampart).my)
                        ) {
                            costs.set(struct.pos.x, struct.pos.y, 255);
                        }
                    });

                    return costs;
                }
            }
        );

        if (ret.path.length > 0) {
            this.move(this.pos.getDirectionTo(ret.path[0]));
            return true;
        }

        return false;
    }

    /**
     * 检查 boost 是否就绪
     * @param boostTypes boost 类型数组
     * @param must 是否必须 boost
     * @returns boolean - true 表示已就绪或不需要 boost
     */
    checkBoostReady(boostTypes?: string[], must: boolean = false): boolean {
        // 如果没有指定 boost 类型，直接返回 true
        if (!boostTypes || boostTypes.length === 0) {
            return true;
        }

        // 检查需要强化的部件是否都已经被强化
        const allRequiredPartsAreBoosted = this.body.every(part => 
            !boostTypes.some(boostType => BOOSTS[part.type] && boostType in BOOSTS[part.type]) || part.boost
        );

        if (allRequiredPartsAreBoosted) {
            return true;
        }

        // 如果不是必须 boost，检查是否有可用的 lab
        if (!must) {
            const labs = this.room.lab?.filter((lab) => 
                lab.mineralType &&
                boostTypes.includes(lab.mineralType) &&
                lab.store[lab.mineralType] >= 30
            ) || [];

            // 没有可用的 lab，返回 true（不需要 boost）
            if (labs.length === 0) {
                return true;
            }
        }

        return false;
    }
}
