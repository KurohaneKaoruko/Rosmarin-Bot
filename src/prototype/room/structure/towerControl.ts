import { compress } from '@/utils';

export default class TowerControl extends Room {
    /** 
     * 呼叫全体tower对目标发起攻击
     * @param target 要攻击的目标
     */
    CallTowerAttack(target: any) {
        this.tower.forEach(tower => {
            if (tower.store['energy'] < 10) return;
            tower.attack(target);
            tower['attacked'] = true;
        });
    }

    /**
     * 呼叫全体tower对目标治疗
     * @param target 要治疗的目标
     */
    CallTowerHeal(target: any) {
        this.tower.forEach(tower => {
            if (tower.store['energy'] < 10) return;
            tower.heal(target);
            tower['healed'] = true;
        });
    }

    /**
     * 呼叫全体tower对目标维修
     * /@param target 要维修的目标
     */
    CallTowerRepair(target: any, energy: number = 10) {
        this.tower.forEach(tower => {
            if (tower.store['energy'] < energy) return;
            tower.repair(target);
            tower['repaired'] = true;
        });
    }

    /**
     * 计算Tower的伤害
     * @param dist 攻击距离
     * @returns 伤害值
     */
    TowerDamage(dist: number) {
        if (dist <= 5) return 600;
        else if (dist <= 20) return 600 - (dist - 5) * 30;
        else return 150;
    }

    /**
     * 计算全部tower对某一点的伤害总值
     * @param {RoomPosition} pos 要计算伤害的点
     * @returns 伤害值
     */
    TowerTotalDamage(pos: RoomPosition) {
        if(this.name != pos.roomName) return 0;
        return _.sum(this.tower, tower => {
            if (tower.store.energy < 10) return 0;
            let ratio = 1;
            if (tower.effects && tower.effects.length) {
                tower.effects.forEach(effect => {
                    if (effect.effect !== PWR_OPERATE_TOWER) return;
                    ratio = POWER_INFO[effect.effect].effect[effect.level];
                });
            }
            return this.TowerDamage(tower.pos.getRangeTo(pos)) * ratio;
        });
    }

    /**
     * 计算全部Tower对某个creep可能造成的实际伤害
     * @param {Creep} creep 要计算伤害的creep
     * @returns 实际伤害值
     */
    TowerDamageToCreep(creep: Creep) {
        if(this.name != creep.room.name) return 0;
        if (creep['_towerDamage']) return creep['_towerDamage'];
        // tower伤害
        let towerDamage = this.TowerTotalDamage(creep.pos) || 0;
        if (this.my && this.controller.safeMode) return towerDamage;
        // tough减伤后的伤害
        let realDamage = 0; // 实际伤害
        creep.body?.forEach(part => {
            if (towerDamage <= 0 || part.hits <= 0) return;
            // 对该部件造成的伤害
            let partDamage = 0;
            if (part.type == TOUGH && part.boost) {
                partDamage = Math.min(Math.floor(towerDamage * BOOSTS[TOUGH][part.boost].damage), part.hits);
            } else {
                partDamage = Math.min(towerDamage, part.hits);
            }
            // 造成该伤害, 需要消耗多少原伤害
            if (part.type == TOUGH && part.boost) {
                towerDamage -=  Math.ceil(part.hits / BOOSTS[TOUGH][part.boost].damage)
            } else {
                towerDamage -= partDamage;
            }
            realDamage += partDamage
        });
        if (towerDamage > 0) realDamage += towerDamage;
        // 治疗量
        const healers = creep.pos.findInRange(FIND_CREEPS, 1, {
            filter: c => creep.owner.username == c.owner.username && c.body.some(b => b.type == HEAL)
        }) || [];
        let totalHeal = 0;
        const BOOST_POWER = {
            'LO': 2,
            'LHO2': 3,
            'XLHO2': 4,
        }
        healers.forEach(c => {
            if (c['_heal']) {
                totalHeal += c['_heal'];
                return;
            }
            let h = 0;
            c.body.forEach(part => {
                if (part.type !== HEAL || part.hits <= 0) return;
                else if (!part.boost) h += 12
                else h += 12 * BOOST_POWER[part.boost];
            })
            c['_heal'] = h
            totalHeal += h;
        })
        creep['_towerDamage'] = realDamage - totalHeal;
        this.visual.text(
            `${creep['_towerDamage']}`,
            creep.pos,
            {
                color: creep['_towerDamage'] > 0 ? 'red' : 'green',
                align: 'center',
                stroke: '#2a2a2a',
                strokeWidth: 0.05,
                font: '0.3 inter',
            }
        );
        return creep['_towerDamage'];
    }


    // 治疗己方单位
    TowerHealCreep() {
        if (!global.cache.towerHealTargets) global.cache.towerHealTargets = {};
        if (Game.time % 10 == 0) {
            const targets = global.cache.towerHealTargets[this.name] = [];
            targets.push(...this.find(FIND_POWER_CREEPS, {
                filter: c => c.hits < c.hitsMax && (c.my || c.isWhiteList())
                }).map(c => c.id));
            targets.push(...this.find(FIND_CREEPS, {
                filter: c => c.hits < c.hitsMax && (c.my || c.isWhiteList())
            }).map(c => c.id));
        }
        const healTarget = (global.cache.towerHealTargets[this.name]||[])
                .map((id: Id<Creep>) => Game.getObjectById(id))
                .filter((c: Creep | null) => c && c.hits < c.hitsMax) as any[];
        if (healTarget.length > 0) {
            // 战力单位优先
            const attackerCreeps = healTarget.filter(c => c?.body &&
                c.body.some((bodyPart: BodyPartConstant) => 
                    bodyPart == ATTACK || bodyPart == RANGED_ATTACK));
            if (attackerCreeps.length > 0) {
                this.tower.forEach(tower => {
                    let index = Math.floor(Math.random() * attackerCreeps.length);
                    tower.heal(attackerCreeps[index]);
                })
            } else {
                this.tower.forEach(tower => {
                    let index = Math.floor(Math.random() * healTarget.length);
                    tower.heal(healTarget[index]);
                })
            }
            return true;
        }
        return false;
    }

    // 攻击NPC单位
    TowerAttackNPC() {
        if (!global.cache.towerAttackNPC) global.cache.towerAttackNPC = {};
        if (Game.time % 10 == 0) {
            global.cache.towerAttackNPC[this.name] = this.find(FIND_HOSTILE_CREEPS, {
                filter: c => c.owner.username == 'Source Keeper' || c.owner.username == 'Invader'
            }).map(c => c.id);
        }
        let Hostiles = (global.cache.towerAttackNPC[this.name]||[])
                    .map((id: Id<Creep>) => Game.getObjectById(id))
                    .filter((c:Creep) => c && this.TowerDamageToCreep(c) > 0);
        if (Hostiles.length > 0) {
            this.tower.forEach(tower => {
                let index = Math.floor(Math.random() * Hostiles.length);
                tower.attack(Hostiles[index]);
            })
            return true;
        }
        return false;
    }

    // 攻击敌人
    TowerAttackEnemy() {
        // 搜寻敌人
        if (!global.cache.towerTargets) global.cache.towerTargets = {};
        if (Game.time % 10 == 0) {
            global.cache.towerTargets[this.name] = 
                [
                    ...this.find(FIND_HOSTILE_CREEPS, {
                        filter: c => !c.isWhiteList()
                    }).map(c => c.id),
                    ...this.find(FIND_HOSTILE_POWER_CREEPS,{
                        filter: c => !c.isWhiteList()
                    }).map(c => c.id)
                ]
        }
        if (!global.cache.towerTargets[this.name] ||
            global.cache.towerTargets[this.name].length == 0) return false;
        
        // 筛选敌人
        let Hostiles = (global.cache.towerTargets[this.name]||[])
                        .map((id: Id<Creep> | Id<PowerCreep>) => Game.getObjectById(id))
                        .filter((c: Creep | PowerCreep) => c) as Creep[] | PowerCreep[];
        if (Hostiles.length == 0) return false;

        // 算伤, 找到能造成伤害最高的
        let hostiles = [];
        let maxDamege = -Infinity;
        
        Hostiles.forEach((c: Creep | PowerCreep) => {
            let d = this.TowerDamageToCreep(c as any);
            if (d > maxDamege) {
                maxDamege = d;
                hostiles = [c];
            } else if (d == maxDamege) {
                hostiles.push(c);
            } else return;
        })

        let random = (hs: (Creep | PowerCreep)[]) => Math.floor(Math.random() * hs.length);
        let randomHostile = (hs: (Creep | PowerCreep)[]) => hs.length > 1 ? hs[random(hs)] : hs[0];

        // 集火攻击
        if (maxDamege > 0) {
            let hostile = randomHostile(hostiles);
            this.CallTowerAttack(hostile);
        } else {
            if (Game.time % 20 >= 2) return false;
            let hostile = randomHostile(hostiles);
            this.tower.forEach(tower => {
                // 如果本tick已经攻击过, 那么不处理
                if (tower['attacked']) return;
                tower.attack(hostile);
            })
        }
        
        return true;
    
    }

    // 处理普通修复任务, 修复建筑物
    TowerTaskRepair() {
        if (Game.cpu.bucket < 1000) return false;
        if (!global.cache.towerRepairTarget)
            global.cache.towerRepairTarget = {};
        let targetCache = global.cache.towerRepairTarget;
        if (Game.time % 20 == 0) {
            targetCache[this.name] = null;
            if (this.checkMissionInPool('repair')) {
                const center = Memory['RoomControlData'][this.name]?.center
                const posInfo = compress(center?.x||25, center?.y||25);
                const hits = this[RESOURCE_ENERGY] > 200000 ? 1e6 : this[RESOURCE_ENERGY] > 100000 ? 3e5 : 3e4;
                const task = this.getMissionFromPool('repair', posInfo,
                    (t) => (Game.getObjectById(t.data.target) as any)?.hits <= hits
                );
                if(!task) return false;
                const target = Game.getObjectById(task.data.target) as Structure;
                if(!target) return false;
                if (target.hits >= task.data.hits) {
                    this.deleteMissionFromPool('repair', task.id);
                    return false;
                }
                targetCache[this.name] = target.id;
            }
        }
        const target = Game.getObjectById(targetCache[this.name]) as Structure;
        if(target) {
            this.tower.forEach(t => {
                // 如果塔的能量不足，则不执行修复逻辑
                if(t.store[RESOURCE_ENERGY] < 500) return;
                t.repair(target);
            });
            return true;
        }
        return false;
    }
}
