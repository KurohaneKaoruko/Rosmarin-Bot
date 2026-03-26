import { getLabAB, ensureBoostLabs, type BoostLabsMemory } from '@/shared/labReservations';
import { getStructData, getTeamData } from '@/shared/memory';

const BOOST_LAB_CAPACITY = 3000;
const BOOST_LAB_ENERGY_TARGET = 2000;
const BOOST_OWNER_TIMEOUT = 3000;

type BoostDemandMap = Partial<Record<ResourceConstant, number>>;
type BoostOwnerInfo = BoostTask['owners'][string];

export default class BoostMission extends Room {
    /**
     * 更新 Boost 任务池
     * @description
     * 1. 清理过期或无效的 Boost 预定
     * 2. 分配 Lab 进行 Boost (支持征用非底物 Lab)
     * 3. 生成 Transport 任务 (清理/填充)
     * 4. 回收不再需要的 Boost 资源
     */
    UpdateBoostMission(_offset = 0) {
        // 1. 清理无效预定
        this.cleanInvalidBoostTasks();

        if (!this.lab || this.lab.length === 0) return;

        // boostLabs：单表预留（task=任务临时征用，fixed=长期固定配置），并在这里完成旧字段迁移
        const boostLabs = ensureBoostLabs(this.name);
        const forbiddenLabIds = this.getForbiddenBoostLabIds();

        // 2. 获取当前活跃的 Boost 任务
        const activeTasks = (this.getAllMissionFromPool('boost') as Task[]) || [];

        if (activeTasks.length === 0) {
            // 没有 boost 任务时：只清理 task 征用；fixed 仍要持续补能量/补矿以保证随时可用
            this.clearAllBoostData();
            for (const labId in boostLabs) {
                const entry = boostLabs[labId];
                if (!entry || entry.mode !== 'fixed' || forbiddenLabIds.has(labId)) continue;
                this.manageBoostLab(Game.getObjectById(labId as Id<StructureLab>), entry.mineral, BOOST_LAB_CAPACITY);
            }
            return;
        }

        // 3. 收集需求与当前分配状态
        const neededMineralsMap: BoostDemandMap = {};
        for (const task of activeTasks) {
            const data = task.data as BoostTask;
            if (data.totalAmount <= 0) continue;
            neededMineralsMap[data.mineral] = (neededMineralsMap[data.mineral] || 0) + data.totalAmount;
        }

        const neededMinerals = new Set(Object.keys(neededMineralsMap) as ResourceConstant[]);
        // 本轮确认被占用的 Lab
        const assignedLabs = new Set<string>();

        for (const labId in boostLabs) {
            const entry = boostLabs[labId];
            if (!entry) continue;

            if (forbiddenLabIds.has(labId)) {
                if (entry.mode === 'task') delete boostLabs[labId];
                continue;
            }

            const mineral = entry.mineral;
            if (!mineral) {
                delete boostLabs[labId];
                continue;
            }

            if (entry.mode === 'fixed') {
                assignedLabs.add(labId);
                this.manageBoostLab(Game.getObjectById(labId as Id<StructureLab>), mineral, BOOST_LAB_CAPACITY);
                continue;
            }

            if (neededMinerals.has(mineral)) {
                assignedLabs.add(labId);
                this.manageBoostLab(Game.getObjectById(labId as Id<StructureLab>), mineral, neededMineralsMap[mineral] || 0);
                neededMinerals.delete(mineral);
                continue;
            }

            delete boostLabs[labId];
        }

        // 5. 为剩余的新需求分配 Lab
        const availableLabs = this.lab.filter((lab) => !forbiddenLabIds.has(lab.id));
        for (const mineral of neededMinerals) {
            // 寻找最佳 Lab（排除已分配的）
            const targetLab = this.findBestLabForBoost(availableLabs, assignedLabs, mineral);
            if (!targetLab) continue;

            // 标记征用，并立即驱动搬运
            boostLabs[targetLab.id] = { mineral, mode: 'task' };
            assignedLabs.add(targetLab.id);
            this.manageBoostLab(targetLab, mineral, neededMineralsMap[mineral] || 0);
        }
    }

    // ==================== Update Helpers ====================

    private getForbiddenBoostLabIds(): Set<string> {
        const botmem = getStructData(this.name);
        const { labAId, labBId } = getLabAB(this.name, this);
        const reactionActive = !!botmem?.lab && !!labAId && !!labBId && !!botmem?.labAtype && !!botmem?.labBtype;
        const forbiddenLabIds = new Set<string>();
        if (reactionActive) {
            forbiddenLabIds.add(labAId as string);
            forbiddenLabIds.add(labBId as string);
        }
        return forbiddenLabIds;
    }

    // ==================== Transport Helpers ====================

    private addBoostTransportMissionIfAbsent(task: TransportTask, match: Partial<TransportTask>) {
        // 检查是否已有相同的搬运任务
        if (this.checkSameMissionInPool('transport', 'transport', match as any)) return;
        this.addTransportMission(this.TransportLevel('boost'), task);
    }

    private cleanupBoostLab(lab: StructureLab) {
        const mineral = lab.mineralType;
        if (!mineral || lab.store[mineral] <= 0 || !this.storage) return;

        this.addBoostTransportMissionIfAbsent({
            source: lab.id,
            target: this.storage.id,
            resourceType: mineral,
            amount: lab.store[mineral],
            pos: this.toPosNumber(lab.pos)
        }, {
            source: lab.id,
            resourceType: mineral
        });
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

        if (lab.mineralType && lab.mineralType !== mineral) {
            // 资源不匹配，先清理现有矿物，再等待下一轮填充
            this.cleanupBoostLab(lab);
            return;
        }

        // 目标是让 Lab 里有足够的资源满足 totalAmount，且不超过 Lab 容量
        const currentAmount = lab.store[mineral] || 0;
        const freeSpace = lab.store.getFreeCapacity(mineral);
        const fillTarget = Math.min(BOOST_LAB_CAPACITY, amount);

        // 资源匹配或为空时，执行填充逻辑
        if (currentAmount < fillTarget && freeSpace > 0) {
            // 检查是否有足够的资源储备
            const source = [this.storage, this.terminal].find((store) => store && store.store[mineral] > 0);
            if (source) {
                const needed = Math.min(fillTarget - currentAmount, freeSpace, source.store[mineral]);
                if (needed > 0) {
                    this.addBoostTransportMissionIfAbsent({
                        source: source.id,
                        target: lab.id,
                        resourceType: mineral,
                        amount: needed,
                        pos: this.toPosNumber(lab.pos)
                    }, {
                        target: lab.id,
                        resourceType: mineral
                    });
                }
            }
        }

        // 补充能量（Boost Lab 必须有能量）
        if (!this.storage || this.storage.store[RESOURCE_ENERGY] <= 0) return;
        if (lab.store[RESOURCE_ENERGY] >= BOOST_LAB_ENERGY_TARGET) return;

        this.addBoostTransportMissionIfAbsent({
            source: this.storage.id,
            target: lab.id,
            resourceType: RESOURCE_ENERGY,
            amount: BOOST_LAB_ENERGY_TARGET - lab.store[RESOURCE_ENERGY],
            pos: this.toPosNumber(lab.pos)
        }, {
            target: lab.id,
            resourceType: RESOURCE_ENERGY
        });
    }

    // ==================== Cleanup Helpers ====================

    private isBoostOwnerValid(ownerId: string, info: BoostOwnerInfo) {
        // 超时预定直接失效；Team 预定则还要检查队伍是否仍然存在
        if (Game.time - info.time > BOOST_OWNER_TIMEOUT) return false;
        if (!ownerId.startsWith('Team-')) return true;
        return !!getTeamData(ownerId.slice(5));
    }

    /**
     * 清理无效的 Boost 任务
     */
    private cleanInvalidBoostTasks() {
        const boostTasks = this.getAllMissionFromPool('boost') as Task[];
        if (!boostTasks) return;

        for (const task of boostTasks) {
            const data = task.data as BoostTask;
            if (data.totalAmount <= 0) {
                this.deleteMissionFromPool('boost', task.id);
                continue;
            }

            if (!data.owners || Object.keys(data.owners).length === 0) {
                data.owners = { ['__public__']: { amount: data.totalAmount, time: Game.time } };
            }

            let modified = false;
            for (const ownerId in data.owners) {
                const info = data.owners[ownerId];

                // 超时检查 + Team 有效性检查
                if (!this.isBoostOwnerValid(ownerId, info)) {
                    console.log(`[Boost] 清理无效预定: ${ownerId} (Resource: ${data.mineral}, Amount: ${info.amount})`);
                    data.totalAmount -= info.amount;
                    delete data.owners[ownerId];
                    modified = true;
                }
            }

            if (data.totalAmount < 0) data.totalAmount = 0;
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
        const botmem = getStructData(this.name);
        const { labAId, labBId } = getLabAB(this.name, this);
        const reactionActive = !!botmem?.lab && !!labAId && !!labBId && !!botmem?.labAtype && !!botmem?.labBtype;
        const boostLabs = botmem?.boostLabs;
        if (boostLabs) {
            for (const labId of Object.keys(boostLabs) as Id<StructureLab>[]) {
                const entry = boostLabs[labId];
                if (!entry || entry.mode !== 'task') continue;
                if (!reactionActive && ((labAId && labId === labAId) || (labBId && labId === labBId))) continue;
                const lab = Game.getObjectById(labId);
                if (lab) this.cleanupBoostLab(lab);
            }
            for (const labId in boostLabs) {
                if (boostLabs[labId]?.mode === 'task') delete boostLabs[labId];
            }
        }
    }
}
