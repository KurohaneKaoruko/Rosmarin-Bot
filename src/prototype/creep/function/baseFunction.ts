/**
 * 一些基础的功能
 */
export default class BaseFunction extends Creep {
    /**
     * 获取能量
     */
    TakeEnergy(pickup: boolean = true) {   // worker、upgrader 的能量获取
        const updateTakeTarget = () => {
            if (this.memory.cache.takeTarget) return false;

            const target =  (pickup ? findDroppedResourceTarget(1000) : null) ||
                            findStructureTarget() ||
                            (pickup ? findDroppedResourceTarget(100) : null) ||
                            findRuinTarget();

            if (target) {
                this.memory.cache.takeTarget = target;
                return true;
            }
            return false;
        };

        const handleExistingTarget = () => {
            if (!this.memory.cache.takeTarget) return false;

            const target = Game.getObjectById(this.memory.cache.takeTarget.id) as any;
            if (!target) {
                this.memory.cache.takeTarget = null;
                return false;
            }

            const type = this.memory.cache.takeTarget.type;
            if (type === 'dropped') {
                if (target.amount <= 0) {
                    this.memory.cache.takeTarget = null;
                    return false;
                }
                this.goPickup(target);
                return true;
            }
            if (type === 'structure' || type === 'ruin') {
                if (!target.store || target.store[RESOURCE_ENERGY] <= 0) {
                    this.memory.cache.takeTarget = null;
                    return false;
                }
                this.goWithdraw(target, RESOURCE_ENERGY);
                return true;
            }
            return false;
        };

        const findStructureTarget = () => {
            const target = [];
            const storage = this.room.storage;
            const terminal = this.room.terminal;
            const link = this.room.link;
            const container = this.room.container;
            if (storage && storage.store[RESOURCE_ENERGY] >= 5000) {
                target.push(storage);
            }
            if (terminal && terminal.store[RESOURCE_ENERGY] >= 5000) {
                target.push(terminal);
            }

            for(const l of link) {
                if (l && l.store[RESOURCE_ENERGY] >= 400) {
                    target.push(l);
                }
            }
            for(const c of container) {
                if (c && c.store[RESOURCE_ENERGY] >= 500) {
                    target.push(c);
                }
            }
            const closestTarget = this.pos.findClosestByRange(target);
            return closestTarget ? { id: closestTarget.id, type: 'structure' } : null;
        }

        const findDroppedResourceTarget = (amount = 50) => {
            const droppedResources = this.room.find(FIND_DROPPED_RESOURCES, {
                filter: resource => resource.resourceType === RESOURCE_ENERGY && resource.amount >= amount
            });
            const closestDroppedEnergy = this.pos.findClosestByRange(droppedResources);
            return closestDroppedEnergy
                ? { id: closestDroppedEnergy.id, type: 'dropped' }
                : null;
        };

        const findRuinTarget = () => {
            const ruins = this.room.find(FIND_RUINS, {
                filter: r => r && r.store[RESOURCE_ENERGY] > 0
            });
            const closestRuin = this.pos.findClosestByRange(ruins);
            return closestRuin
                ? { id: closestRuin.id, type: 'ruin' }
                : null;
        };

        const harvestEnergy = () => {
            // if (this.room.level > 4) return false;
            if (!this.memory.cache.targetSourceId) {
                let targetSource = this.room.closestSource(this);
                if (targetSource) {
                    this.memory.cache.targetSourceId = targetSource.id;
                }
            }

            const targetSource = Game.getObjectById(this.memory.cache.targetSourceId) as Source;
            if (!targetSource || targetSource.energy <= 0) {
                this.memory.cache.targetSourceId = null;
                return false;
            }

            if (this.pos.inRangeTo(targetSource, 1)) {
                return this.harvest(targetSource) === OK;
            } else {
                this.moveTo(targetSource, { visualizePathStyle: { stroke: '#ffaa00' } });
                return true;
            }
        };

        updateTakeTarget();   // 更新目标
        if (handleExistingTarget()) return;    // 拿取能量
        else harvestEnergy();    // 采集能量
    }

    /**
     * 根据给定配置boost, 返回OK表示完成
     * @param boostmap 需要强化的部件及其对应的资源
     * @returns 0表示完成, 1表示下一tick还要继续, -1表示资源不足, -2表示找不到对应的LAB
     */
    Boost(boostmap: { [part: string]: string }) {
        let bodypart = {}   // 需要强化的部件及其数量
        const done = this.body.every(part => {
            if (!boostmap[part.type]) return true;
            if (part.boost) {
                return true;
            }
            if (!bodypart[part.type]) {
                bodypart[part.type] = 1;
            } else {
                bodypart[part.type] += 1;
            }
            return false;
        })
        if (done) return 0;

        // 检查是否拥有足够资源
        for (const part in bodypart) {
            if (this.room[boostmap[part]] < bodypart[part] * 30) {
                return -1;
            }
        }

        // 查找有足够指定资源的lab
        const labs = this.room.lab?.filter((lab) => 
            lab.mineralType &&
            Object.values(boostmap).includes(lab.mineralType) &&
            lab.store[lab.mineralType] >= 30
        ) || [];

        // 需要的资源
        const needMineral = [];
        for (const part in bodypart) {
            needMineral.push(boostmap[part]);
        }

        // 过滤不需要的lab
        const availableLabs = labs.filter(lab => {
            return needMineral.includes(lab.mineralType);
        }) || [];
        // 如果找不到
        if (availableLabs.length == 0) {
            return -2;
        }

        // 找到最近的lab
        const closestLab = this.pos.findClosestByRange(availableLabs);
        // 如果creep不在lab旁边，移动到lab
        if (!this.pos.isNearTo(closestLab)) {
            this.moveTo(closestLab, { visualizePathStyle: { stroke: '#ffffff' } });
            return 1;
        }

        // 尝试强化
        let result = closestLab.boostCreep(this);
        if (result == OK) {
            const mineral = closestLab.mineralType;
            const boostedParts = this.body.filter(part => !part.boost && boostmap[part.type] === mineral);
            const boostAmount = Math.min(boostedParts.length * 30, closestLab.store[mineral] - closestLab.store[mineral] % 30);
            this.room.SubmitBoostTask(mineral, boostAmount);
            return 1;
        }
    }

    /**
     *boost creep
     * @param {Array<string>} boostTypes - 强化的资源类型数组
     * @param {boolean} must - 是否必须boost
     * @param {boolean} reserve - 是否为预定的boost
     * @returns {boolean} - 是否成功强化或结束强化
     */
    goBoost(boostTypes: Array<string>, must: boolean = false, reserve: boolean = false) {
        // 检查需要强化的部件是否都已经被强化
        const allRequiredPartsAreBoosted = this.body.every(part => 
            !boostTypes.some(boostType => BOOSTS[part.type] && boostType in BOOSTS[part.type]) || part.boost
        );
        // 所有需要强化的部件都已强化，返回true
        if (allRequiredPartsAreBoosted) {
            return true;
        }
        
        // 查找有足够指定资源的lab
        const labs = this.room.lab?.filter((lab) => 
            lab.mineralType &&
            boostTypes.includes(lab.mineralType) &&
            lab.store[lab.mineralType] >= 30
        ) || [];

        // 过滤掉对应部件已强化满的lab
        const availableLabs = labs.filter(lab => {
            return this.body.some(part => !part.boost && BOOSTS[part.type] && lab.mineralType in BOOSTS[part.type]);
        }) || [];
        // 如果找不到
        if (availableLabs.length == 0) {
            return !must;
        }

        // 按照输入的优先级顺序选择lab
        const prioritizedLabs = availableLabs.sort((a, b) => {
            for (let type of boostTypes) {
                if (a.mineralType === type && b.mineralType !== type) return -1;
                if (b.mineralType === type && a.mineralType !== type) return 1;
            }
            return 0;
        });

        const closestLab = this.pos.findClosestByRange(prioritizedLabs);
        if(!closestLab) return !must;
        
        // 如果creep不在lab旁边，移动到lab
        if (!this.pos.isNearTo(closestLab)) {
            this.moveTo(closestLab, { visualizePathStyle: { stroke: '#ffffff' } });
            return false;
        }
        
        // 尝试强化
        let result = closestLab.boostCreep(this);
        if (result == OK) {
            if (reserve) {
                const mineral = closestLab.mineralType;
                const boostedParts = this.body.filter(part => BOOSTS[part.type] && mineral in BOOSTS[part.type]);
                const boostAmount = Math.min(boostedParts.length * 30, closestLab.store[mineral] - closestLab.store[mineral] % 30);
                this.room.SubmitBoostTask(mineral, boostAmount);
            }
            return false; // 强化成功，继续执行
        }
        
        // 如果强化失败，重试多次后放弃
        if (!this.memory.boostAttempts) {
            this.memory.boostAttempts = 1;
        } else {
            this.memory.boostAttempts++;
        }
        
        if (this.memory.boostAttempts >= 5 || !must) {
            // 重试5次后放弃强化
            delete this.memory.boostAttempts;
            return true;
        }
        
        return false; // 继续尝试强化
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

    // 是否处于白名单中
    isWhiteList() {
        let whiteList = new Set<string>(Memory['whitelist'] || []);
        return whiteList.has(this.owner.username);
    }
}
