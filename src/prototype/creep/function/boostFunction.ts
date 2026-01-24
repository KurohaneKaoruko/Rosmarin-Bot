export default class BoostFunction extends Creep {
    /**
     * 根据给定配置boost, 返回OK表示完成
     * @param boostmap 需要强化的部件及其对应的资源
     * @param opts 选项 { must: 是否强制 }
     * @returns 0表示完成, 1表示下一tick还要继续, -1表示资源不足, -2表示找不到对应的LAB
     */
    Boost(boostmap: { [part: string]: string }, opts: { must?: boolean } = {}) {
        const { must = false } = opts;

        // Boost 期间允许被对穿，防止堵死 Lab 通道
        this.memory.dontPullMe = false;

        // 1. 检查是否已完成 Boost
        let bodypart = {}   // 需要强化的部件及其数量
        const done = this.body.every(part => {
            if (!boostmap[part.type]) return true;
            if (part.boost) return true;
            
            if (!bodypart[part.type]) {
                bodypart[part.type] = 1;
            } else {
                bodypart[part.type] += 1;
            }
            return false;
        })
        if (done) {
            delete this.memory.boostTargetId; // 清理缓存
            return 0;
        }

        // 2. 检查资源是否足够
        for (const part in bodypart) {
            if (this.room[boostmap[part]] < bodypart[part] * 30) {
                if (!must) {
                    delete this.memory.boostTargetId;
                    return 0; // 如果不是强制，资源不足直接算完成（放弃）
                }
                return -1;
            }
        }

        // 3. 查找有资源的 Lab
        const requiredMinerals = Object.values(boostmap);
        // 使用 getBoostLab 获取最佳 Lab
        // 注意：目前 boost 逻辑是针对每个部件分别判断的，但 getBoostLab 只能返回一个 Lab。
        // 如果 Creep 需要多种资源，它应该依次去不同的 Lab。
        // 这里我们需要找到任何一个能满足当前未 boost 部件需求的 Lab。
        
        let targetLab: StructureLab | null = null;
        
        // 尝试从缓存获取
        if (this.memory.boostTargetId) {
            const cachedLab = Game.getObjectById(this.memory.boostTargetId) as StructureLab;
            if (cachedLab && requiredMinerals.some(m => cachedLab.mineralType === m)) {
                targetLab = cachedLab;
            } else {
                delete this.memory.boostTargetId;
            }
        }

        // 如果没有缓存，寻找一个新的 Lab
        if (!targetLab) {
            // 遍历所有需要的资源，看哪个 Lab 准备好了
            for (const [partType, mineral] of Object.entries(boostmap)) {
                // 如果该部件类型还有未 boost 的，则寻找 Lab
                // 之前的逻辑是 some(... && p.boost)，只要有一个 boost 了就跳过，这是错误的
                if (!this.body.some(p => p.type === partType && !p.boost)) continue;
                
                // 寻找该资源的 Lab
                const lab = this.room.getBoostLab(mineral as ResourceConstant);
                if (lab) {
                    targetLab = lab;
                    this.memory.boostTargetId = lab.id;
                    break; // 找到一个就去
                }
            }
        }

        // 5. 如果找不到 Lab
        if (!targetLab) {
            if (!must) {
                delete this.memory.boostTargetId;
                return 0; // 非强制则放弃
            }
            
            // 重试逻辑
            if (!this.memory.boostAttempts) this.memory.boostAttempts = 0;
            this.memory.boostAttempts++;
            // 强制模式下 (must=true) 无限等待，直到找到 Lab
            // if (this.memory.boostAttempts >= 5) {
            //    delete this.memory.boostAttempts;
            //    delete this.memory.boostTargetId;
            //    return 0; // 重试超时，放弃
            // }
            return -2;
        }

        // 6. 智能选择 Lab (已通过 getBoostLab 完成)

        // 7. 强化与移动
        if (!this.pos.isNearTo(targetLab)) {
            // 使用 ignoreCreeps: true 启用 moveOptimization 的对穿逻辑
            // maxRooms: 1 限制在同房间
            this.moveTo(targetLab, { 
                visualizePathStyle: { stroke: '#ffffff' },
                ignoreCreeps: true,
                maxRooms: 1,
                range: 1
            });
            return 1;
        }

        const result = targetLab.boostCreep(this);
        if (result == OK) {
            const mineral = targetLab.mineralType;
            
            // 自动推断 ownerId 并提交任务
            // 如果是 Team Creep，ownerId 为 Team-ID
            // 如果是普通 Creep，ownerId 为 Creep Name
            const teamID = this.memory['teamID'];
            const ownerId = teamID ? `Team-${teamID}` : this.name;

            const boostedParts = this.body.filter(part => !part.boost && boostmap[part.type] === mineral);
            const boostAmount = Math.min(boostedParts.length * 30, targetLab.store[mineral] - targetLab.store[mineral] % 30);
            
            this.room.SubmitBoostTask(mineral, boostAmount, ownerId);

            // 强化成功，清除目标缓存，以便下一 tick 重新评估（可能需要去另一个 Lab，或者已经全部完成）
            delete this.memory.boostTargetId;
            return 1; // 继续下一轮检查
        } else if (result === ERR_NOT_IN_RANGE) {
            // 理论上 isNearTo 已经检查了，但防止边界情况
            this.moveTo(targetLab, { ignoreCreeps: true, maxRooms: 1, range: 1 });
            return 1;
        }

        return 1;
    }

    /**
     * boost creep (兼容层，内部调用 Boost)
     * @param boostTypes - 强化的资源类型数组
     * @param must - 是否必须boost
     * @param reserve - 是否为预定的boost
     * @returns boolean - true 表示完成/放弃，false 表示正在进行
     */
    goBoost(boostTypes: Array<string>, must: boolean = false) {
        // 将 boostTypes 转换为 boostmap
        // 注意：这里需要反查 BOOSTS 表来确定哪些部件可以使用这些资源
        // 这是一个简化的映射，假设每个资源只对应一种主要用途，或者我们只关心能不能用
        const boostmap: { [part: string]: string } = {};
        
        // 遍历 creep 的 body，为每个部件寻找匹配的 boostType
        this.body.forEach(part => {
            if (part.boost) return;
            const validBoosts = BOOSTS[part.type];
            if (!validBoosts) return;
            
            // 查找该部件是否可以使用 boostTypes 中的任一资源
            const targetBoost = boostTypes.find(type => type in validBoosts);
            if (targetBoost) {
                boostmap[part.type] = targetBoost;
            }
        });

        // 如果没有匹配的 boostmap，直接返回完成
        if (Object.keys(boostmap).length === 0) return true;

        const result = this.Boost(boostmap, { must });
        
        // 转换返回码：0 表示完成/放弃，其他表示未完成
        return result === 0;
    }

    unboost() {
        if(!this.body.some(part => part.boost)) return true;

        let lab = null;
        let container = this.room.container.find((c) => {
            return !!this.room.lab.find((l) => {
                if(!c.pos.isNear(l.pos) || l.cooldown > 0)
                    return false;
                lab = l;
                return true;
            });
        })

        if (!container || !lab) return false;
        if (this.pos.isEqual(container.pos)) {
            return lab.unboostCreep(this) === OK;
        } else {
            this.moveTo(container, { visualizePathStyle: { stroke: '#ffffff' } });
            return false;
        }
    }

    /**
     * 检查 boost 是否就绪（简化版）
     * 检查 creep 是否已完成所有需要的 boost，或者不需要 boost
     * @returns boolean - true 表示 boost 就绪或不需要 boost
     */
    isBoostReady(): boolean {
        // 如果 creep 没有配置 boostmap，则不需要 boost
        const boostmap = this.memory['boostmap'] as { [part: string]: string } | undefined;
        if (!boostmap || Object.keys(boostmap).length === 0) {
            return true;
        }

        // 检查所有需要 boost 的部件是否都已被 boost
        const allBoosted = this.body.every(part => {
            // 如果该部件类型不在 boostmap 中，则不需要 boost
            if (!boostmap[part.type]) return true;
            // 如果该部件已被 boost，则通过
            return !!part.boost;
        });

        return allBoosted;
    }
}