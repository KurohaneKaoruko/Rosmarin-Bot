import { compress } from '@/modules/utils/compress';
import { pickTowerFocusTarget } from '@/modules/utils/defenseUtils';
import { THRESHOLDS } from '@/constant/Thresholds';

export default class TowerControl extends Room {
    // 处理 Tower 防御和修复逻辑
    TowerWork() {
        // 没有tower时不处理
        if (!this.tower || this.tower.length == 0) return;

        // 攻击敌人
        if (this.TowerAttackEnemy()) return;

        // 攻击NPC
        if (this.TowerAttackNPC()) return;

        // 治疗己方单位
        if (this.TowerHealCreep()) return;

        // 修复建筑物
        if (this.TowerTaskRepair()) return;
    }
    
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

    private TowerPowerScale(tower: StructureTower): number {
        let scale = 1;
        const effects = (tower.effects || []) as any[];
        for (const effect of effects) {
            const power = effect?.power ?? effect?.effect;
            if (power !== PWR_OPERATE_TOWER && power !== PWR_DISRUPT_TOWER) continue;
            const list = (POWER_INFO as any)[power]?.effect;
            if (!Array.isArray(list) || list.length === 0) continue;
            const level = Math.max(1, Number(effect.level || 1));
            const idx = Math.min(list.length - 1, level - 1);
            let mult = list[idx];
            if (effect.ticksRemaining === 1) mult = (1 + mult) / 2;
            scale *= mult;
        }
        return scale;
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
            const ratio = this.TowerPowerScale(tower);
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
        const healers = creep.pos.findInRange(FIND_CREEPS, 3, {
            filter: c => creep.owner.username == c.owner.username && c.getActiveBodyparts(HEAL) > 0
        }) || [];
        let totalHeal = 0;
        const BOOST_POWER = {
            'LO': 2,
            'LHO2': 3,
            'XLHO2': 4,
        }
        healers.forEach(c => {
            const range = c.pos.getRangeTo(creep.pos);
            const base = range <= 1 ? 12 : (range <= 3 ? 4 : 0);
            if (base <= 0) return;
            let h = 0;
            c.body.forEach(part => {
                if (part.type !== HEAL || part.hits <= 0) return;
                if (!part.boost) h += base;
                else h += base * (BOOST_POWER as any)[part.boost];
            });
            totalHeal += h;
        });
        creep['_towerDamage'] = realDamage - totalHeal;
        // 可视化仅用于调试：默认不画，避免每 tick 多目标评估时产生额外 CPU/视图开销。
        if (Game.flags[`${this.name}/TD`]) {
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
        }
        return creep['_towerDamage'];
    }


    // 治疗己方单位
    TowerHealCreep() {
        if (!global.towerHealTargets) global.towerHealTargets = {};
        if (Game.time % 10 == 0) {
            const targets = global.towerHealTargets[this.name] = [];
            targets.push(...this.find(FIND_POWER_CREEPS, {
                filter: c => c.hits < c.hitsMax && (c.my || c.isWhiteList())
                }).map(c => c.id));
            targets.push(...this.find(FIND_CREEPS, {
                filter: c => c.hits < c.hitsMax && (c.my || c.isWhiteList())
            }).map(c => c.id));
        }
        const healTarget = (global.towerHealTargets[this.name]||[])
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
        if (!global.towerAttackNPC) global.towerAttackNPC = {};
        if (Game.time % 10 == 0) {
            global.towerAttackNPC[this.name] = this.find(FIND_HOSTILE_CREEPS, {
                filter: c => c.owner.username == 'Source Keeper' || c.owner.username == 'Invader'
            }).map(c => c.id);
        }
        let Hostiles = (global.towerAttackNPC[this.name]||[])
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
        if (!global.towerTargets) global.towerTargets = {};
        const cache = global.towerTargets;
        if (Game.time % 10 == 0) {
            cache[this.name] = 
                [
                    ...this.find(FIND_HOSTILE_CREEPS, {
                        filter: c => !c.isWhiteList()
                    }).map(c => c.id),
                    ...this.find(FIND_HOSTILE_POWER_CREEPS,{
                        filter: c => !c.isWhiteList()
                    }).map(c => c.id)
                ]
        }
        if (!cache[this.name] || cache[this.name].length == 0) return false;
        
        // 筛选敌人
        let Hostiles = (cache[this.name]||[])
                        .map((id: Id<Creep> | Id<PowerCreep>) => Game.getObjectById(id))
                        .filter((c: Creep | PowerCreep) => c) as Creep[] | PowerCreep[];
        if (Hostiles.length == 0) return false;

        const pick = pickTowerFocusTarget(this, Hostiles as any);
        if (!pick) return false;
        const hostile = Game.getObjectById(pick.id) as any;
        if (!hostile) return false;

        // 集火攻击：优先选择“可击杀且 TTk 更短”的目标，并保持短期粘性，避免频繁换目标打不死。
        if (pick.netDamage > 0) {
            this.CallTowerAttack(hostile);
            return true;
        }

        // 打不动的目标不要每 tick 浪费 tower 能量：低频点射用于逼退/打断（ 有些极限 boost 需要等防御兵到位）。
        if (Game.time % 20 >= 5) return false;
        this.tower.forEach(tower => {
            if (tower['attacked']) return;
            tower.attack(hostile);
        });
        
        return true;
    
    }

    // 处理普通修复任务, 修复建筑物
    TowerTaskRepair() {
        if (Game.cpu.bucket < 1000) return false;
        if (typeof this.memory['towerRepairSleep'] !== 'number') this.memory['towerRepairSleep'] = 0;
        if (this.memory['towerRepairSleep'] > 0) {
            this.memory['towerRepairSleep'] -= 1;
            return false;
        }

        if (!global.towerRepairTarget) global.towerRepairTarget = {};
        let targetCache = global.towerRepairTarget;
        if (Game.time % 20 == 0) {
            targetCache[this.name] = null;
            if (this.checkMissionInPool('repair')) {
                const centerPos = this.getCenter();
                const posInfo = compress(centerPos.x, centerPos.y);
                const hits = this[RESOURCE_ENERGY] > 200000 ? 1e6 : this[RESOURCE_ENERGY] > 100000 ? 3e5 : 3e4;
                const task = this.getMissionFromPool('repair', posInfo,
                    (t) => {
                        const repairData = t.data as RepairTask;
                        if (!repairData || !(repairData as any).target) return false;
                        const obj = Game.getObjectById((repairData as any).target);
                        return (obj as Structure)?.hits <= hits;
                    }
                );
                if (task) {
                    const repairData = task.data as RepairTask;
                    if (repairData && (repairData as any).target) {
                        const target = Game.getObjectById((repairData as any).target) as Structure | null;
                        if (!target) return false;
                        if ((repairData as any).hits != null && target.hits >= (repairData as any).hits) {
                            this.deleteMissionFromPool('repair', task.id);
                            return false;
                        }
                        targetCache[this.name] = target.id;
                        // 选定目标后继续走后续统一的 tower repair 执行逻辑
                    }
                }

                const NORMAL_STRUCTURE_THRESHOLD = THRESHOLDS.REPAIR.NORMAL_STRUCTURE;
                const URGENT_STRUCTURE_THRESHOLD = THRESHOLDS.REPAIR.URGENT_STRUCTURE;
                const all = (this as any).structures || this.find(FIND_STRUCTURES);
                let best: Structure | null = null;
                let bestScore = Infinity;
                for (const s of all) {
                    if (!s || s.hits >= s.hitsMax) continue;
                    if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) continue;
                    if (s.hits > hits) continue;

                    let pri = 0;
                    if (s.structureType === STRUCTURE_ROAD && s.hits < 3000) pri = 0.5;
                    else if (s.hits < s.hitsMax * URGENT_STRUCTURE_THRESHOLD) pri = 0;
                    else if (s.hits < s.hitsMax * NORMAL_STRUCTURE_THRESHOLD) pri = 1;
                    else continue;

                    const dist = centerPos.getRangeTo(s.pos);
                    const ratio = s.hitsMax > 0 ? s.hits / s.hitsMax : 1;
                    const score = pri * 100 + ratio * 10 + dist;
                    if (score < bestScore) {
                        bestScore = score;
                        best = s;
                    }
                }
                if (best) {
                    targetCache[this.name] = best.id;
                }
            }
        }
        const target = Game.getObjectById(targetCache[this.name]) as Structure;
        if(target) {
            const towerEnergyCap = _.sum(this.tower, t => t.store.getCapacity(RESOURCE_ENERGY) || 0);
            const towerEnergy = _.sum(this.tower, t => t.store[RESOURCE_ENERGY] || 0);
            const ratio = towerEnergyCap > 0 ? towerEnergy / towerEnergyCap : 0;
            if (this.memory.defend && ratio < 0.8) {
                this.memory['towerRepairSleep'] = 10;
                return false;
            }
            if (!this.memory.defend && ratio < 0.6) {
                this.memory['towerRepairSleep'] = 10;
                return false;
            }

            this.tower.forEach(t => {
                // 如果塔的能量不足，则不执行修复逻辑
                if (t.store[RESOURCE_ENERGY] < (t.store.getCapacity(RESOURCE_ENERGY) || 0) * 0.75) return;
                t.repair(target);
            });
            this.memory['towerRepairSleep'] = 5 + Math.min(50, this.level * this.level);
            return true;
        }
        return false;
    }
}
