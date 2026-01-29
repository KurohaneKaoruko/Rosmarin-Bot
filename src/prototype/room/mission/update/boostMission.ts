import TransportMission from "./transportMission";
import { getLabAB, ensureBoostLabs } from '@/modules/utils/labReservations';

export default class BoostMission extends TransportMission {
    /**
     * 更新 Boost 任务池
     * @description
     * 1. 清理过期或无效的 Boost 预定
     * 2. 分配 Lab 进行 Boost (支持征用非底物 Lab)
     * 3. 生成 Transport 任务 (清理/填充)
     * 4. 回收不再需要的 Boost 资源
     */
    UpdateBoostMission(offset = 0) {
        // 1. 清理无效预定
        this.cleanInvalidBoostTasks();

        const botmem = Memory['StructControlData'][this.name];
        const { labAId, labBId } = getLabAB(this.name, this);
        if (!this.lab || this.lab.length === 0) return;
        // boostLabs：单表预留（task=任务临时征用，fixed=长期固定配置），并在这里完成旧字段迁移
        const boostLabs = ensureBoostLabs(this.name);

        // 2. 获取当前活跃的 Boost 任务
        const activeTasks = this.getAllMissionFromPool('boost') as Task[];
        if (!activeTasks || activeTasks.length === 0) {
            // 没有 boost 任务时：只清理 task 征用；fixed 仍要持续补能量/补矿以保证随时可用
            this.clearAllBoostData();
            for (const labId in boostLabs) {
                const entry = boostLabs[labId];
                if (!entry || entry.mode !== 'fixed') continue;
                this.manageBoostLab(Game.getObjectById(labId), entry.mineral, 3000);
            }
            return;
        }

        // 3. 收集需求与当前分配状态
        const neededMineralsMap: Record<string, number> = {};
        for (const task of activeTasks) {
            const data = task.data as BoostTask;
            if (data.totalAmount > 0) {
                neededMineralsMap[data.mineral] = (neededMineralsMap[data.mineral] || 0) + data.totalAmount;
            }
        }
        const neededMinerals = Object.keys(neededMineralsMap) as ResourceConstant[];
        const assignedLabs = new Set<string>(); // 本轮确认被占用的 Lab

        for (const labId in boostLabs) {
            const entry = boostLabs[labId];
            if (!entry) continue;
            const mineral = entry.mineral;
            if (!mineral) {
                delete boostLabs[labId];
                continue;
            }
            if (entry.mode === 'fixed') {
                assignedLabs.add(labId);
                this.manageBoostLab(Game.getObjectById(labId), mineral, 3000);
                continue;
            }
            if (neededMinerals.includes(mineral)) {
                assignedLabs.add(labId);
                this.manageBoostLab(Game.getObjectById(labId), mineral, neededMineralsMap[mineral]);

                const index = neededMinerals.indexOf(mineral);
                if (index > -1) neededMinerals.splice(index, 1);
            } else {
                delete boostLabs[labId];
            }
        }

        // 5. 为剩余的新需求分配 Lab
        if (neededMinerals.length > 0) {
            // 排除 A/B Lab
            const availableLabs = this.lab.filter(lab => 
                lab.id !== labAId && 
                lab.id !== labBId
            );

            for (const mineral of neededMinerals) {
                // 寻找最佳 Lab (排除已分配的)
                const targetLab = this.findBestLabForBoost(availableLabs, assignedLabs, mineral);
                
                if (targetLab) {
                    // 标记征用
                    boostLabs[targetLab.id] = { mineral, mode: 'task' };
                    assignedLabs.add(targetLab.id);
                    // 执行搬运逻辑
                    this.manageBoostLab(targetLab, mineral, neededMineralsMap[mineral]);
                }
            }
        }
    }

    /**
     * 寻找最佳的 Lab 用于 Boost
     * @param availableLabs 可用的候选 Lab 列表
     * @param assignedLabs 已经被分配的 Lab ID 集合
     * @param mineral 目标资源类型
     */
    private findBestLabForBoost(availableLabs: StructureLab[], assignedLabs: Set<string>, mineral: ResourceConstant): StructureLab | null {
        // 过滤掉已经被分配的 Lab
        const candidates = availableLabs.filter(l => !assignedLabs.has(l.id));
        if (candidates.length === 0) return null;

        // 优先级 1: 已经存有该资源的 Lab
        let target = candidates.find(l => l.mineralType === mineral);
        if (target) return target;

        // 优先级 2: 完全空闲的 Lab
        target = candidates.find(l => !l.mineralType);
        if (target) return target;

        // 优先级 3: 征用非空 Lab (非底物 Lab 已经在 availableLabs 筛选时排除了 A/B)
        // 优选资源量少的，或者资源类型不是当前合成产物的 (可选优化)
        // 这里简单选取第一个
        return candidates[0];
    }

    /**
     * 管理 Boost Lab 的资源搬运
     * @param lab 目标 Lab
     * @param mineral 目标资源
     * @param amount 目标数量 (总需求量)
     */
    private manageBoostLab(lab: StructureLab | null, mineral: ResourceConstant, amount: number) {
        if (!lab) return;

        // 1. 检查资源是否匹配
        if (lab.mineralType && lab.mineralType !== mineral) {
            // 资源不匹配，且有存量，需要清理
            if (lab.store[lab.mineralType] > 0) {
                const exist = this.checkSameMissionInPool('transport', 'transport', {
                    source: lab.id,
                    resourceType: lab.mineralType
                });
                if (!exist && this.storage) {
                    this.addTransportMission(this.TransportLevel('boost'), {
                        source: lab.id,
                        target: this.storage.id,
                        resourceType: lab.mineralType,
                        amount: lab.store[lab.mineralType],
                        pos: this.toPosNumber(lab.pos)
                    });
                }
            }
            // 正在清理中，无法填充
            return;
        }

        // 2. 资源匹配或为空，执行填充逻辑
        const currentAmount = lab.store[mineral] || 0;
        const freeSpace = lab.store.getFreeCapacity(mineral);
        
        // 目标是让 Lab 里有足够的资源满足 totalAmount，且不超过 Lab 容量 (3000)
        // 这里的 amount 是 boost 任务的总需求量，可能大于 3000
        const fillTarget = Math.min(3000, amount);

        if (currentAmount < fillTarget && freeSpace > 0) {
            const needed = Math.min(fillTarget - currentAmount, freeSpace);
            
            // 检查是否有足够的资源储备
            const stores = [this.storage, this.terminal];
            const source = stores.find(s => s && s.store[mineral] > 0);
            
            if (source) {
                // 检查是否已有相同的搬运任务
                const exist = this.checkSameMissionInPool('transport', 'transport', {
                    target: lab.id,
                    resourceType: mineral
                });

                if (!exist) {
                    this.addTransportMission(this.TransportLevel('boost'), {
                        source: source.id,
                        target: lab.id,
                        resourceType: mineral,
                        amount: Math.min(needed, source.store[mineral]),
                        pos: this.toPosNumber(lab.pos)
                    });
                }
            }
        }

        // 3. 补充能量 (Boost Lab 必须有能量)
        if (lab.store[RESOURCE_ENERGY] < 2000) {
            const existEnergy = this.checkSameMissionInPool('transport', 'transport', {
                target: lab.id,
                resourceType: RESOURCE_ENERGY
            });
            if (!existEnergy && this.storage && this.storage.store[RESOURCE_ENERGY] > 0) {
                this.addTransportMission(this.TransportLevel('boost'), {
                    source: this.storage.id,
                    target: lab.id,
                    resourceType: RESOURCE_ENERGY,
                    amount: 2000 - lab.store[RESOURCE_ENERGY],
                    pos: this.toPosNumber(lab.pos)
                });
            }
        }
    }

    /**
     * 清理无效的 Boost 任务
     */
    private cleanInvalidBoostTasks() {
        const boostTasks = this.getAllMissionFromPool('boost') as Task[];
        if (!boostTasks) return;

        for (const task of boostTasks) {
            const data = task.data as BoostTask;
            if (!data.owners) continue;

            let modified = false;
            for (const ownerId in data.owners) {
                const info = data.owners[ownerId];
                let isValid = true;

                // 超时检查 (3000 tick)
                if (Game.time - info.time > 3000) {
                    isValid = false;
                } 
                // Team 有效性检查
                else if (ownerId.startsWith('Team-')) {
                    const teamID = ownerId.slice(5);
                    if (Memory['TeamData'] && !Memory['TeamData'][teamID]) {
                        isValid = false;
                    }
                }

                if (!isValid) {
                    console.log(`[Boost] 清理无效预定: ${ownerId} (Resource: ${data.mineral}, Amount: ${info.amount})`);
                    data.totalAmount -= info.amount;
                    delete data.owners[ownerId];
                    modified = true;
                }
            }

            if (modified) {
                if (data.totalAmount <= 0) {
                    this.deleteMissionFromPool('boost', task.id);
                } else {
                    // 更新任务数据引用已生效
                }
            }
        }
    }

    /**
     * 清理所有 Boost 相关数据
     */
    private clearAllBoostData() {
        const botmem = Memory['StructControlData'][this.name];
        const boostLabs = botmem?.boostLabs;
        if (boostLabs) {
            for (const labId in boostLabs) {
                const entry = boostLabs[labId];
                if (!entry || entry.mode !== 'task') continue;
                const lab = Game.getObjectById(labId) as StructureLab | null;
                if (lab && lab.mineralType && this.storage) {
                    const exist = this.checkSameMissionInPool('transport', 'transport', {
                        source: lab.id,
                        resourceType: lab.mineralType
                    });
                    if (!exist) {
                        this.addTransportMission(this.TransportLevel('boost'), {
                            source: lab.id,
                            target: this.storage.id,
                            resourceType: lab.mineralType,
                            amount: lab.store[lab.mineralType],
                            pos: this.toPosNumber(lab.pos)
                        });
                    }
                }
            }
            for (const labId in boostLabs) {
                if (boostLabs[labId]?.mode === 'task') delete boostLabs[labId];
            }
        }
    }
}
