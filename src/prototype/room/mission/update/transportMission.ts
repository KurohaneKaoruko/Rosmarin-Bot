import { compress } from '@/modules/utils/compress';



type PosLike = RoomPosition | { pos: RoomPosition } | number;
type TransportLevelKey = 'boost' | 'ext' | 'tower' | 'labEnergy' | 'lab' | 'powerSpawn' | 'nuker';

const TransportLevelMap: Record<TransportLevelKey, number> = {
    boost: 0,
    ext: 1,
    tower: 1,
    labEnergy: 1,
    lab: 2,
    powerSpawn: 2,
    nuker: 3,
};

/**
 * 房间搬运任务模块（transport）
 * @description
 * - 生成 transport 任务：能量填充、lab 搬运/boost、powerSpawn、nuker 等
 * - 提供统一的任务写入与去重逻辑（TransportMissionAdd / addTransportMission）
 * - 提供任务池校验清理（TransportMissionCheck）
 */
export default class TransportMission extends Room {
    private static LAB_FILL_AMOUNT = 3000;
    private static LAB_TRIGGER_AMOUNT = 1000;
    private static LAB_MIN_CAPACITY = 100;

    /**
     * 将业务 key 映射为 transport 任务优先级
     * @param key - 优先级类别
     * @returns 优先级（数值越小越高）
     */
    TransportLevel(key: TransportLevelKey) {
        return TransportLevelMap[key];
    }

    /**
     * 将位置转换为压缩坐标
     * @param pos - RoomPosition / {pos: RoomPosition} / 压缩坐标
     * @returns 压缩坐标 number
     */
    toPosNumber(pos: PosLike): number {
        if (typeof pos === 'number') return pos;
        const p = 'pos' in pos ? pos.pos : pos;
        return compress(p.x, p.y);
    }

    /**
     * 以便捷参数形式添加 transport 任务
     * @param level - 优先级（数值越小越高）
     * @param params - 任务参数
     */
    addTransportMission(
        level: number,
        params: {
            pos: PosLike;
            source: Id<Structure>;
            target: Id<Structure>;
            resourceType: ResourceConstant;
            amount: number;
        }
    ) {
        if (!params.amount || params.amount <= 0) return;
        this.TransportMissionAdd(level, {
            pos: this.toPosNumber(params.pos),
            source: params.source,
            target: params.target,
            resourceType: params.resourceType,
            amount: params.amount,
        } as any);
    }

    /**
     * 添加/更新 transport 任务（按 source/target/resourceType 去重）
     * @param level - 优先级（数值越小越高）
     * @param data - transport 任务数据
     * @returns OK/false 等任务池写入结果
     */
    TransportMissionAdd(level: number, data: TransportTask) {
        let existingTaskId = this.checkSameMissionInPool('transport', 'transport',
                    {source:data.source, target:data.target, resourceType:data.resourceType});
        if (existingTaskId) {
            return this.updateMissionPool('transport', existingTaskId, {level, data});
        } else {
            return this.addMissionToPool('transport', 'transport', level, data);
        }
    }

    /**
     * transport 总更新入口
     * @description 依次更新能量、power、lab、boost、nuker 等子逻辑
     */
    UpdateTransportMission() {
        const storage = this.storage;
        if(!storage) return;

        this.UpdateEnergyMission();
        this.UpdatePowerMission();
        this.UpdateLabMission();
        this.UpdateLabBoostMission();
        this.UpdateNukerMission();
    }

    /**
     * 检查 transport 任务池有效性并清理无效任务
     * @description
     * - 释放丢失绑定 creep 的 lock
     * - source/target 不存在则删除
     * - target 无容量或 amount 无效则删除
     */
    TransportMissionCheck() {
        const checkFunc = (task: Task) => {
            if(task.lock) {
                const creep = Game.getObjectById(task.bindCreep) as Creep;
                const mission = creep?.memory?.mission;
                if(!creep || !mission || mission?.id !== task.id) {
                    task.lock = false;
                    task.bindCreep = null;
                }
            };
            const data = task.data as TransportTask
            const source = Game.getObjectById(data.source) as any;
            const target = Game.getObjectById(data.target) as any;;
            if(!source || !target) return false;
            return target.store.getFreeCapacity(data.resourceType) > 0 && data.amount > 0;
        }

        this.checkMissionPool('transport', checkFunc);
    }

    /**
     * 能量类搬运任务生成
     * @description
     * - spawn/extension 填充
     * - tower 填充
     * - lab 能量填充
     * - powerSpawn/nuker 能量填充（视布局与能量阈值）
     */
    UpdateEnergyMission() {
        const room = this;
        const storage = room.storage;
        const terminal = room.terminal;
        let energy = (storage?.store[RESOURCE_ENERGY]||0) + (terminal?.store[RESOURCE_ENERGY]||0);
        if(energy < 3000) return;

        let storageOrTerminal = null;

        if(terminal && storage) {
            storageOrTerminal = terminal.store[RESOURCE_ENERGY] > storage.store[RESOURCE_ENERGY] ? terminal : storage;
        } else {
            storageOrTerminal = storage || terminal;
        }

        if (!storageOrTerminal) return;

        if(room.spawn && room.spawn.length > 0 && room.energyAvailable < room.energyCapacityAvailable) {
            room.spawn.forEach((s) => {
                const amount = s.store.getFreeCapacity(RESOURCE_ENERGY);
                if (amount === 0) return;
                if (energy < amount) return;
                energy -= amount;
                this.addTransportMission(this.TransportLevel('ext'), {
                    pos: s,
                    source: storageOrTerminal.id,
                    target: s.id,
                    resourceType: RESOURCE_ENERGY,
                    amount,
                });
            })
            room.extension.forEach((e) => {
                const amount = e.store.getFreeCapacity(RESOURCE_ENERGY);
                if (amount === 0) return;
                if (energy < amount) return;
                energy -= amount;
                this.addTransportMission(this.TransportLevel('ext'), {
                    pos: e,
                    source: storageOrTerminal.id,
                    target: e.id,
                    resourceType: RESOURCE_ENERGY,
                    amount,
                });
            })
        }

        if(room.level >= 3 && room.tower && room.tower.length > 0) {
            const towers = room.tower
                .filter((t: StructureTower) => t && t.store.getFreeCapacity(RESOURCE_ENERGY) > 200);
            towers.forEach((t: StructureTower) => {
                const amount = t.store.getFreeCapacity(RESOURCE_ENERGY);
                if(energy < amount) return;
                energy -= amount;
                this.addTransportMission(this.TransportLevel('tower'), {
                    pos: t,
                    source: storageOrTerminal.id,
                    target: t.id,
                    resourceType: RESOURCE_ENERGY,
                    amount,
                });
            })
        }

        const state = room.memory.energyState || room.updateEnergyState?.(false);
        if (state === 'LOW' || state === 'CRITICAL') return;

        if(room.getResAmount(RESOURCE_ENERGY) < 10000) return;

        if (Game.time % 20 === 0 && room.level >= 6 && room.lab) {
            const labs = room.lab
                .filter((l: StructureLab) => l && l.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
            labs.forEach((l: StructureLab) => {
                const amount = l.store.getFreeCapacity(RESOURCE_ENERGY);
                if(energy < amount) return;
                energy -= amount;
                this.addTransportMission(this.TransportLevel('labEnergy'), {
                    pos: l,
                    source: storage.id,
                    target: l.id,
                    resourceType: RESOURCE_ENERGY,
                    amount,
                });
            })
        }

        let center = Memory['RoomControlData'][room.name].center;
        let centerPos: RoomPosition;
        if (center) centerPos = new RoomPosition(center.x, center.y, room.name);
        if (Game.time % 20 === 0 && room.level == 8 && room.powerSpawn &&
            (!centerPos || !room.powerSpawn.pos.inRangeTo(centerPos, 1))) {
            const powerSpawn = room.powerSpawn;
            const amount = powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY);
            if(powerSpawn && amount > 400 && energy >= amount) {
                energy -= amount;
                this.addTransportMission(this.TransportLevel('powerSpawn'), {
                    pos: powerSpawn,
                    source: storage.id,
                    target: powerSpawn.id,
                    resourceType: RESOURCE_ENERGY,
                    amount,
                });
            }
        }

        if(room.getResAmount(RESOURCE_ENERGY) < 100000) return;

        if(Game.time % 20 === 0 && room.level == 8 && room.nuker) {
            const nuker = room.nuker;
            const amount = Math.min(nuker.store.getFreeCapacity(RESOURCE_ENERGY), 3000);
            if(nuker && amount > 0 && energy >= amount) {
                energy -= amount;
                this.addTransportMission(this.TransportLevel('nuker'), {
                    pos: nuker,
                    source: storage.id,
                    target: nuker.id,
                    resourceType: RESOURCE_ENERGY,
                    amount,
                });
            }
        }

        return OK;
    }

    /**
     * PowerSpawn 资源搬运（POWER）
     * @description 当 powerSpawn 不在中心布局时，补充 power 到阈值
     */
    UpdatePowerMission() {
        const room = this;
        if(room.level < 8 || !room.powerSpawn) return;
        let center = Memory['RoomControlData'][room.name].center;
        let centerPos: RoomPosition;
        if (center) centerPos = new RoomPosition(center.x, center.y, room.name);
        if (centerPos && room.powerSpawn.pos.inRangeTo(centerPos, 1)) return;
    
        const storage = room.storage;
        const terminal = room.terminal;
        if(!storage && !terminal) return;
    
        const powerSpawn = room.powerSpawn;
        if(!powerSpawn) return;
        let neededAmount = 100 - powerSpawn.store[RESOURCE_POWER];
        if (neededAmount < 50) return;
    
        let target = [storage, terminal].reduce((a, b) => {
            if (!a && !b) return null;
            if (!a || !b) return a || b;
            if (a.store[RESOURCE_POWER] > b.store[RESOURCE_POWER]) return a;
            return b;
        }, null)
    
        if(!target || target.store[RESOURCE_POWER] <= 0) return;
    
        this.addTransportMission(this.TransportLevel('powerSpawn'), {
            pos: target,
            source: target.id,
            target: powerSpawn.id,
            resourceType: RESOURCE_POWER,
            amount: Math.min(neededAmount, target.store[RESOURCE_POWER]),
        });
    }

    /**
     * Nuker 资源搬运（GHODIUM）
     * @description 周期性检查 nuker 的 GHODIUM，不足则从 storage/terminal 补齐
     */
    UpdateNukerMission() {
        const room = this;
        if(Game.time % 50 !== 0) return;
        if(room.level < 8) return;
        if(!room.nuker) return;
        const storage = room.storage;
        const terminal = room.terminal;
        if(!storage && !terminal) return;
        
        const nuker = room.nuker;
        if(!nuker) return;
        if(nuker.store[RESOURCE_GHODIUM] === 5000) return;
    
        let amount = 5000 - nuker.store[RESOURCE_GHODIUM];
    
        let source: Id<Structure>;
        if (storage && storage.store[RESOURCE_GHODIUM] > 0) {
            source = storage.id;
            amount = Math.min(amount, storage.store[RESOURCE_GHODIUM])
        } else if (terminal && terminal.store[RESOURCE_GHODIUM] > 0) {
            source = terminal.id;
            amount = Math.min(amount, terminal.store[RESOURCE_GHODIUM])
        } else {
            return;
        }
    
        this.addTransportMission(this.TransportLevel('nuker'), {
            pos: nuker,
            source,
            target: nuker.id,
            resourceType: RESOURCE_GHODIUM,
            amount,
        });
    }

    /**
     * 判断 lab 是否为“特殊用途”
     * @description
     * - A/B 反应原料 lab
     * - boostRes/boostTypes 指定的 boost lab
     */
    private isSpecialLab(labId: Id<StructureLab>, botmem: any): boolean {
        if (labId === botmem.labA || labId === botmem.labB) return true;
        if (botmem['boostRes']?.[labId]) return true;
        if (botmem['boostTypes']?.[labId]) return true;
        return false;
    }

    /**
     * Lab 合成相关搬运
     * @description
     * - 合成关闭时：将普通 lab 的矿物搬回 storage
     * - 合成开启时：保持 A/B 原料正确，普通 lab 只保留产物并在容量不足时搬出
     */
    UpdateLabMission() {
        const room = this;
        const storage = room.storage;
        const terminal = room.terminal;
        if (!storage) return;
        if (!room.lab || room.lab.length === 0) return;

        const BotMemStructures = Memory['StructControlData'][room.name];
        if (!BotMemStructures['boostRes']) BotMemStructures['boostRes'] = {};
        if (!BotMemStructures['boostTypes']) BotMemStructures['boostTypes'] = {};

        const labAtype = BotMemStructures.labAtype;
        const labBtype = BotMemStructures.labBtype;
        const labA = Game.getObjectById(BotMemStructures.labA) as StructureLab;
        const labB = Game.getObjectById(BotMemStructures.labB) as StructureLab;

        const isShutDown = !BotMemStructures.lab || !labA || !labB || !labAtype || !labBtype;

        room.lab.forEach(lab => {
            if (isShutDown) {
                if (this.isSpecialLab(lab.id, BotMemStructures)) return;
                if (!lab.store[lab.mineralType] || lab.store[lab.mineralType] === 0) return;
                
                this.addTransportMission(this.TransportLevel('lab'), {
                    pos: lab,
                    source: lab.id,
                    target: storage.id,
                    resourceType: lab.mineralType,
                    amount: lab.store[lab.mineralType],
                });
                return;
            }

            if (lab.id === labA.id || lab.id === labB.id) {
                const type = (lab.id === labA.id) ? labAtype : labBtype;
                
                if (lab.mineralType && lab.mineralType !== type && lab.store[lab.mineralType] > 0) {
                    this.addTransportMission(this.TransportLevel('lab'), {
                        pos: lab,
                        source: lab.id,
                        target: storage.id,
                        resourceType: lab.mineralType,
                        amount: lab.store[lab.mineralType],
                    });
                    return;
                }

                if (lab.store.getFreeCapacity(type) >= TransportMission.LAB_TRIGGER_AMOUNT && room.getResAmount(type) >= TransportMission.LAB_TRIGGER_AMOUNT) {
                    const target = [storage, terminal].find(t => t && t.store[type] > 0);
                    if (target) {
                        this.addTransportMission(this.TransportLevel('lab'), {
                            pos: lab,
                            source: target.id,
                            target: lab.id,
                            resourceType: type,
                            amount: Math.min(lab.store.getFreeCapacity(type), target.store[type]),
                        } as any);
                    }
                }
                return;
            }

            if (this.isSpecialLab(lab.id, BotMemStructures)) return;

            const reactionProduct = REACTIONS[labAtype][labBtype];
            
            if (lab.mineralType && lab.mineralType !== reactionProduct && lab.store[lab.mineralType] > 0) {
                this.addTransportMission(this.TransportLevel('lab'), {
                    pos: lab,
                    source: lab.id,
                    target: storage.id,
                    resourceType: lab.mineralType,
                    amount: lab.store[lab.mineralType],
                });
                return;
            }

            if (lab.mineralType === reactionProduct && lab.store.getFreeCapacity(reactionProduct) < TransportMission.LAB_MIN_CAPACITY) {
                this.addTransportMission(this.TransportLevel('lab'), {
                    pos: lab,
                    source: lab.id,
                    target: storage.id,
                    resourceType: reactionProduct,
                    amount: lab.store[reactionProduct],
                });
            }
        });
    }

    /**
     * Lab Boost 搬运
     * @description 按 boostRes/boostTypes 配置向指定 lab 补充强化资源，并清理非法配置
     */
    UpdateLabBoostMission() {
        const room = this;
        const storage = room.storage;
        const terminal = room.terminal;
        if (!storage && !terminal) return;
        const storeTarget = storage || terminal;
        
        const botmem = Memory['StructControlData'][room.name];
        if (!botmem['boostRes']) return;
        if (!room.lab || room.lab.length === 0) return;

        if (!botmem['boostQueue']) botmem['boostQueue'] = {};
        if (Object.keys(botmem['boostQueue']).length) {
            room.lab.filter(lab => !this.isSpecialLab(lab.id, botmem))
                .forEach(lab => {
                    const mineral = Object.keys(botmem['boostQueue'])[0] as ResourceConstant;
                    if (!mineral) return;
                    
                    botmem['boostRes'][lab.id] = {
                        mineral: mineral,
                        amount: botmem['boostQueue'][mineral],
                    }
                    delete botmem['boostQueue'][mineral];
                })
        }

        room.lab.forEach(lab => {
            const boostConfig = botmem['boostRes'][lab.id];
            let mineral = boostConfig?.mineral || botmem['boostTypes']?.[lab.id];

            if (boostConfig && (!mineral || !RESOURCES_ALL.includes(mineral))) {
                delete botmem['boostRes'][lab.id];
                return;
            }
            
            if (boostConfig && (lab.id === botmem.labA || lab.id === botmem.labB)) {
                botmem['boostQueue'][mineral] = (botmem['boostQueue'][mineral] || 0) + boostConfig.amount;
                delete botmem['boostRes'][lab.id];
                return;
            }

            if (boostConfig && (boostConfig.amount || 0) <= 0) {
                delete botmem['boostRes'][lab.id];
                return;
            }

            if (!mineral) return;

            if (lab.mineralType && lab.mineralType !== mineral && lab.store[lab.mineralType] > 0) {
                this.addTransportMission(this.TransportLevel('boost'), {
                    pos: lab,
                    source: lab.id,
                    target: storeTarget.id,
                    resourceType: lab.mineralType,
                    amount: lab.store[lab.mineralType],
                });
                return;
            }

            const targetAmount = boostConfig ? Math.min(TransportMission.LAB_FILL_AMOUNT, boostConfig.amount) : TransportMission.LAB_FILL_AMOUNT;
            
            if (lab.store[mineral] < targetAmount) {
                const need = targetAmount - lab.store[mineral];
                const target = [storage, terminal].find(t => t && t.store[mineral] > 0);
                
                if (target) {
                    this.addTransportMission(this.TransportLevel('boost'), {
                        pos: lab,
                        source: target.id,
                        target: lab.id,
                        resourceType: mineral,
                        amount: Math.min(need, target.store[mineral]),
                    });
                }
            }
        });
    }
}
