export default class BoostFunction extends Creep {
    /**
     * 根据给定配置boost, 返回OK表示完成
     * @param boostmap 需要强化的部件及其对应的资源
     * @param opts 选项 { must: 是否强制 }
     * @returns 0表示完成, 1表示下一tick还要继续, -1表示资源不足, -2表示找不到对应的LAB
     */
    goBoost(boostmap: { [part: string]: MineralBoostConstant | MineralBoostConstant[] }, opts: { must?: boolean } = {}) {
        const { must = false } = opts;

        // Boost 期间允许被对穿，防止堵死 Lab 通道
        this.memory.dontPullMe = false;

        // 统一的 boost 资源统计：mass_stores（storage/terminal/factory/container）+ labs
        // 注意：room[RESOURCE] 的实现不包含 labs，且 boost 场景下资源很可能已经被搬进 lab
        const getBoostAvailableAmount = (mineral: ResourceConstant): number => {
            const inMassStores = Number((this.room as any)?.[mineral] ?? 0);
            const inLabs = (this.room.lab || []).reduce((sum, lab) => sum + (lab?.store?.[mineral] || 0), 0);
            return inMassStores + inLabs;
        };

        // 1. 检查是否已完成 Boost
        const normalizeBoostList = (v: MineralBoostConstant | MineralBoostConstant[] | undefined): MineralBoostConstant[] => {
            if (!v) return [];
            if (Array.isArray(v)) return v.filter(Boolean);
            return [v];
        };

        const bodypart: { [part: string]: number } = {}; // 需要强化的部件及其数量（仅统计未强化的）
        for (const part of this.body) {
            const boostList = normalizeBoostList(boostmap[part.type]);
            if (boostList.length <= 0) continue;
            if (part.boost) continue;
            bodypart[part.type] = (bodypart[part.type] || 0) + 1;
        }

        if (Object.keys(bodypart).length <= 0) {
            // 已完成，清理缓存
            delete this.memory.boostTargetId;
            delete this.memory.boostTargetMineral;
            delete this.memory.boostTargetPart;
            delete (this.memory as any).boostTargetAccessible;
            delete (this.memory as any).boostTargetFailCount;
            delete (this.memory as any).boostOptionalStartTime;
            delete (this.memory as any).boostEnsureTime;
            delete this.memory.boostAttempts;
            return 0;
        }

        // 2. 检查资源是否足够（允许同一部件按候选列表降级选择）
        for (const part in bodypart) {
            const boostList = normalizeBoostList(boostmap[part]);
            const requiredAmount = bodypart[part] * 30;

            const hasEnough = boostList.some(mineral => getBoostAvailableAmount(mineral as ResourceConstant) >= requiredAmount);
            if (hasEnough) continue;

            if (!must) {
                delete this.memory.boostTargetId;
                delete this.memory.boostTargetMineral;
                delete this.memory.boostTargetPart;
                delete (this.memory as any).boostTargetAccessible;
                delete (this.memory as any).boostTargetFailCount;
                delete (this.memory as any).boostOptionalStartTime;
                delete (this.memory as any).boostEnsureTime;
                delete this.memory.boostAttempts;
                return 0; // 如果不是强制，资源不足直接算完成（放弃）
            }
            return -1;
        }

        // 3. 查找有资源的 Lab
        // 注意：boostmap 允许传入候选列表，这里用于校验缓存是否仍然可用
        const requiredMinerals: MineralBoostConstant[] = [];
        for (const v of Object.values(boostmap)) {
            requiredMinerals.push(...normalizeBoostList(v as any));
        }
        // 使用 getBoostLab 获取最佳 Lab
        // 注意：目前 boost 逻辑是针对每个部件分别判断的，但 getBoostLab 只能返回一个 Lab。
        // 如果 Creep 需要多种资源，它应该依次去不同的 Lab。
        // 这里我们需要找到任何一个能满足当前未 boost 部件需求的 Lab。
        
        let targetLab: StructureLab | null = null;
        let targetMineral: MineralBoostConstant | null = null;
        let targetPart: BodyPartConstant | null = null;
        
        // 尝试从缓存获取
        if (this.memory.boostTargetId) {
            const cachedLab = Game.getObjectById(this.memory.boostTargetId) as StructureLab;
            const cachedMineral = this.memory.boostTargetMineral as MineralBoostConstant | undefined;
            const cachedPart = this.memory.boostTargetPart as BodyPartConstant | undefined;

            if (!cachedLab || !cachedMineral || !cachedPart) {
                delete this.memory.boostTargetId;
                delete this.memory.boostTargetMineral;
                delete this.memory.boostTargetPart;
            } else if (!requiredMinerals.includes(cachedMineral)) {
                delete this.memory.boostTargetId;
                delete this.memory.boostTargetMineral;
                delete this.memory.boostTargetPart;
            } else if (!bodypart[cachedPart]) {
                // 该部件类型已经不需要强化了
                delete this.memory.boostTargetId;
                delete this.memory.boostTargetMineral;
                delete this.memory.boostTargetPart;
            } else if (cachedLab.mineralType && cachedLab.mineralType !== cachedMineral) {
                // Lab 已被填充为其他资源，缓存失效
                delete this.memory.boostTargetId;
                delete this.memory.boostTargetMineral;
                delete this.memory.boostTargetPart;
            } else if (getBoostAvailableAmount(cachedMineral as ResourceConstant) < bodypart[cachedPart] * 30) {
                // 资源量发生变化导致不再足够，缓存失效
                delete this.memory.boostTargetId;
                delete this.memory.boostTargetMineral;
                delete this.memory.boostTargetPart;
            } else {
                targetLab = cachedLab;
                targetMineral = cachedMineral;
                targetPart = cachedPart;
            }
        }

        // 如果没有缓存，寻找一个新的 Lab
        if (!targetLab) {
            // 遍历所有需要的部件，看哪个 Lab 准备好了（候选资源按顺序尝试）
            for (const partType of Object.keys(bodypart) as BodyPartConstant[]) {
                // 如果该部件类型还有未 boost 的，则寻找 Lab
                // 之前的逻辑是 some(... && p.boost)，只要有一个 boost 了就跳过，这是错误的
                if (!this.body.some(p => p.type === partType && !p.boost)) continue;
                
                const boostList = normalizeBoostList(boostmap[partType]);
                const requiredAmount = bodypart[partType] * 30;
                
                for (const mineral of boostList as MineralBoostConstant[]) {
                    if (getBoostAvailableAmount(mineral as ResourceConstant) < requiredAmount) continue;
                    const lab = this.room.getBoostLab(mineral as ResourceConstant);
                    if (!lab) continue;

                    targetLab = lab;
                    targetMineral = mineral;
                    targetPart = partType;
                    this.memory.boostTargetId = lab.id;
                    this.memory.boostTargetMineral = mineral;
                    this.memory.boostTargetPart = partType;
                    delete (this.memory as any).boostTargetAccessible;
                    delete (this.memory as any).boostTargetFailCount;
                    break; // 找到一个就去
                }
                if (targetLab) break;
            }
        }

        // 5. 如果找不到 Lab
        if (!targetLab) {
            const teamID = this.memory['teamID'];
            const ownerId = this.memory['boostOwnerId'] || (teamID ? `Team-${teamID}` : this.name);

            const ensureInterval = 20;
            const lastEnsure = (this.memory as any).boostEnsureTime as number | undefined;
            const allowEnsure = !lastEnsure || Game.time - lastEnsure >= ensureInterval;

            const boostPool = this.room.getAllMissionFromPool?.('boost') as any[] | undefined;
            const ownersMap: Record<string, number> = {};
            if (boostPool) {
                for (const t of boostPool) {
                    const data = t?.data;
                    const mineral = data?.mineral as string | undefined;
                    if (!mineral) continue;
                    const amount = data?.owners?.[ownerId]?.amount;
                    if (typeof amount === 'number' && amount > 0) {
                        ownersMap[mineral] = (ownersMap[mineral] || 0) + amount;
                    }
                }
            }

            const partList = Object.keys(bodypart) as BodyPartConstant[];
            const remaining: Record<string, number> = {};
            const missing: Array<{ mineral: ResourceConstant; amount: number }> = [];

            for (const partType of partList) {
                const boostList = normalizeBoostList(boostmap[partType]);
                if (boostList.length <= 0) continue;

                const amount = bodypart[partType] * 30;
                let selected: ResourceConstant | null = null;
                for (const mineral of boostList as unknown as ResourceConstant[]) {
                    const available = remaining[mineral] ?? getBoostAvailableAmount(mineral) ?? 0;
                    if (available >= amount) {
                        selected = mineral;
                        remaining[mineral] = available - amount;
                        break;
                    }
                }
                if (!selected) continue;

                if ((ownersMap[selected] || 0) >= amount) {
                    ownersMap[selected] -= amount;
                    continue;
                }
                missing.push({ mineral: selected, amount });
            }

            if (allowEnsure && missing.length > 0) {
                for (const m of missing) {
                    this.room.AssignBoostTask(m.mineral, m.amount, ownerId);
                }
                (this.memory as any).boostEnsureTime = Game.time;
            }

            if (!this.memory.boostAttempts) this.memory.boostAttempts = 0;
            this.memory.boostAttempts++;

            // must=false：不直接当作完成。短暂等待 BoostMission 分配/补料后再放弃，避免“明明能 boost 却直接跳过”。 
            if (!must) {
                const optStart = (this.memory as any).boostOptionalStartTime as number | undefined;
                if (!optStart) (this.memory as any).boostOptionalStartTime = Game.time;
                const startTime = optStart || Game.time;
                const giveUpAfter = 80; // 可选 boost 最多等待的 tick 数

                if (Game.time - startTime >= giveUpAfter) {
                    delete this.memory.boostTargetId;
                    delete this.memory.boostTargetMineral;
                    delete this.memory.boostTargetPart;
                    delete (this.memory as any).boostTargetAccessible;
                    delete (this.memory as any).boostTargetFailCount;
                    delete (this.memory as any).boostOptionalStartTime;
                    delete (this.memory as any).boostEnsureTime;
                    delete this.memory.boostAttempts;
                    return 0;
                }
            }
            return 1;
        }

        // 已经找到目标 Lab，说明 boost 流程在推进，重置可选 boost 的等待计时
        delete (this.memory as any).boostOptionalStartTime;

        // 防御性处理：缓存的 lab 可能来自其他房间，且 moveTo(maxRooms:1) 会导致永远走不到
        if (targetLab.pos.roomName !== this.room.name) {
            delete this.memory.boostTargetId;
            delete this.memory.boostTargetMineral;
            delete this.memory.boostTargetPart;
            delete (this.memory as any).boostTargetFailCount;
            delete (this.memory as any).boostTargetAccessible;
            return 1;
        }

        // 防御性处理：如果 lab 周围没有可站立的相邻格，则永远无法进行 boost
        // 只在首次选中该 lab 时计算一次，降低 CPU 开销
        if ((this.memory as any).boostTargetAccessible !== true) {
            const terrain = this.room.getTerrain();
            let ok = false;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const x = targetLab.pos.x + dx;
                    const y = targetLab.pos.y + dy;
                    if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                    if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
                    const pos = new RoomPosition(x, y, this.room.name);
                    const structures = pos.lookFor(LOOK_STRUCTURES) as Structure[];
                    const blocked = structures.some(s => {
                        if (!s) return false;
                        if (s.structureType === STRUCTURE_ROAD) return false;
                        if (s.structureType === STRUCTURE_CONTAINER) return false;
                        if (s.structureType === STRUCTURE_RAMPART && (s as any).my) return false;
                        return true;
                    });
                    if (blocked) continue;
                    ok = true;
                    break;
                }
                if (ok) break;
            }
            if (!ok) {
                delete this.memory.boostTargetId;
                delete this.memory.boostTargetMineral;
                delete this.memory.boostTargetPart;
                delete (this.memory as any).boostTargetFailCount;
                delete (this.memory as any).boostTargetAccessible;
                return 1;
            }
            (this.memory as any).boostTargetAccessible = true;
        }

        // 6. 强化与移动
        if (!this.pos.isNearTo(targetLab)) {
            if (this.room?.visual) {
                const mineral = (targetMineral || (this.memory.boostTargetMineral as MineralBoostConstant | undefined)) as string | undefined;
                const c = mineralToUlkzgColor(mineral);
                this.room.visual.circle(targetLab.pos, { radius: 0.55, fill: 'transparent', stroke: c, strokeWidth: 0.07, opacity: 0.85 });
                drawPerpendicularDashes(this.room.visual, this.pos, targetLab.pos, c, 1.2, 0.28, 0.08, 0.35);
            }
            // moveTo 会在封装层根据“原地停留 tick 数”自动把 dontPullMe 置为 true，导致对穿/换位失效
            // boost 过程中允许对穿，避免出现“只差一格但永远进不去”的卡位现象
            ;(this.memory as any)._lpv = -1;
            ;(this.memory as any)._lpt = 0;
            this.memory.dontPullMe = false;
            // 使用 ignoreCreeps: true 启用 moveOptimization 的对穿逻辑
            // maxRooms: 1 限制在同房间
            this.moveTo(targetLab, { 
                ignoreCreeps: true,
                maxRooms: 1,
                range: 1
            });
            return 1;
        }

        const mineral = (targetMineral || (this.memory.boostTargetMineral as MineralBoostConstant | undefined)) as MineralBoostConstant | undefined;
        const partType = (targetPart || (this.memory.boostTargetPart as BodyPartConstant | undefined)) as BodyPartConstant | undefined;
        if (!mineral || !partType) {
            delete this.memory.boostTargetId;
            delete this.memory.boostTargetMineral;
            delete this.memory.boostTargetPart;
            delete (this.memory as any).boostTargetAccessible;
            delete (this.memory as any).boostTargetFailCount;
            return 1;
        }

        if (targetLab.mineralType && targetLab.mineralType !== mineral) {
            // Lab 被占用或资源被替换，清理缓存后重新选择
            delete this.memory.boostTargetId;
            delete this.memory.boostTargetMineral;
            delete this.memory.boostTargetPart;
            delete (this.memory as any).boostTargetAccessible;
            delete (this.memory as any).boostTargetFailCount;
            return 1;
        }

        const needParts = this.body.filter(part => part.type === partType && !part.boost).length;
        if (needParts <= 0) {
            // 目标部件已经全部完成，清理缓存后下一 tick 继续评估
            delete this.memory.boostTargetId;
            delete this.memory.boostTargetMineral;
            delete this.memory.boostTargetPart;
            delete (this.memory as any).boostTargetAccessible;
            delete (this.memory as any).boostTargetFailCount;
            return 1;
        }
        const boostAmount = needParts * 30;

        const teamID = this.memory['teamID'];
        const ownerId = this.memory['boostOwnerId'] || (teamID ? `Team-${teamID}` : this.name);

        const result = targetLab.boostCreep(this);
        if (result == OK) {
            if (boostAmount > 0) {
                this.room.SubmitBoostTask(mineral, boostAmount, ownerId);
            }

            // 强化成功，清除目标缓存，以便下一 tick 重新评估（可能需要去另一个 Lab，或者已经全部完成）
            delete this.memory.boostTargetId;
            delete this.memory.boostTargetMineral;
            delete this.memory.boostTargetPart;
            delete (this.memory as any).boostOptionalStartTime;
            delete (this.memory as any).boostTargetFailCount;
            delete (this.memory as any).boostTargetAccessible;
            return 1; // 继续下一轮检查
        } else if (result === ERR_NOT_IN_RANGE) {
            // 理论上 isNearTo 已经检查了，但防止边界情况
            this.moveTo(targetLab, { ignoreCreeps: true, maxRooms: 1, range: 1 });
            return 1;
        }

        // 失败处理：尽量避免“站在 lab 旁但长期不 boost”或“lab 未准备好就一直空转”
        const failCount = ((this.memory as any).boostTargetFailCount as number | undefined) || 0;
        (this.memory as any).boostTargetFailCount = failCount + 1;

        if (result === ERR_NOT_ENOUGH_RESOURCES) {
            // 缺矿/缺能量：确保有对应的 boost 任务，驱动 BoostMission 去补矿/补能量
            const ensureInterval = 10;
            const lastEnsure = (this.memory as any).boostEnsureTime as number | undefined;
            const allowEnsure = !lastEnsure || Game.time - lastEnsure >= ensureInterval;

            if (allowEnsure) {
                const boostPool = this.room.getAllMissionFromPool?.('boost') as any[] | undefined;
                let reserved = 0;
                if (boostPool) {
                    for (const t of boostPool) {
                        const data = t?.data;
                        if (!data || data.mineral !== mineral) continue;
                        const amount = data?.owners?.[ownerId]?.amount;
                        if (typeof amount === 'number' && amount > 0) reserved += amount;
                    }
                }
                const needEnsure = Math.max(0, boostAmount - reserved);
                if (needEnsure > 0) {
                    this.room.AssignBoostTask(mineral, needEnsure, ownerId);
                }
                (this.memory as any).boostEnsureTime = Game.time;
            }
            return 1;
        }

        // 某些错误码不会自行恢复：清理缓存，下一 tick 重选目标
        if (result === ERR_INVALID_TARGET || result === ERR_NOT_FOUND) {
            delete this.memory.boostTargetId;
            delete this.memory.boostTargetMineral;
            delete this.memory.boostTargetPart;
            delete (this.memory as any).boostTargetAccessible;
            delete (this.memory as any).boostTargetFailCount;
            return 1;
        }

        // 长时间失败：尝试换一个 lab，避免卡死在同一个目标上
        if ((this.memory as any).boostTargetFailCount >= 30) {
            delete this.memory.boostTargetId;
            delete this.memory.boostTargetMineral;
            delete this.memory.boostTargetPart;
            delete (this.memory as any).boostTargetFailCount;
            delete (this.memory as any).boostTargetAccessible;
        }
        return 1;
    }

    unBoost() {
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
        const boostmap = this.memory['boostmap'] as { [part: string]: MineralBoostConstant | MineralBoostConstant[] } | undefined;
        if (!boostmap || Object.keys(boostmap).length === 0) {
            return true;
        }

        // 检查所有需要 boost 的部件是否都已被 boost
        const allBoosted = this.body.every(part => {
            // 如果该部件类型不在 boostmap 中，则不需要 boost
            const conf = boostmap[part.type];
            if (!conf || (Array.isArray(conf) && conf.length <= 0)) return true;
            // 如果该部件已被 boost，则通过
            return !!part.boost;
        });

        return allBoosted;
    }
}

function mineralToUlkzgColor(mineral?: string): string {
    if (!mineral) return '#ffffff';
    const s = mineral.toUpperCase();
    const counts: Record<string, number> = { U: 0, L: 0, K: 0, Z: 0, G: 0 };
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        if (ch in counts) counts[ch]++;
    }
    let best: keyof typeof counts = 'U';
    const order: Array<keyof typeof counts> = ['U', 'L', 'K', 'Z', 'G'];
    for (const k of order) {
        if (counts[k] > counts[best]) best = k;
    }
    if (counts[best] <= 0) return '#ffffff';
    if (best === 'U') return '#5d9cec';
    if (best === 'L') return '#48cfad';
    if (best === 'K') return '#ac92ec';
    if (best === 'Z') return '#ffce54';
    return '#aab2bd';
}

function drawPerpendicularDashes(
    visual: RoomVisual,
    from: RoomPosition,
    to: RoomPosition,
    color: string,
    step: number,
    halfLen: number,
    width: number,
    opacity: number
): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!dist || dist <= 0.001) return;
    const ux = dx / dist;
    const uy = dy / dist;
    const px = -uy;
    const py = ux;

    for (let t = 0.4; t < dist; t += step) {
        const cx = from.x + ux * t;
        const cy = from.y + uy * t;
        const x1 = cx + px * halfLen;
        const y1 = cy + py * halfLen;
        const x2 = cx - px * halfLen;
        const y2 = cy - py * halfLen;
        visual.line(x1, y1, x2, y2, { color, width, opacity });
    }
}
