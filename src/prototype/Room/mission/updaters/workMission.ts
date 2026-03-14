import { getStructData } from '@/modules/utils/memory';
import { THRESHOLDS } from '@/constant/Thresholds';

type WorkPoolName = 'build' | 'repair';

/**
 * 房间 Work 任务更新模块
 * @description 负责建造/维修任务生成、刷墙任务生成与任务有效性检查（不包含外矿 mine）。
 */
export default class WorkMission extends Room {
    /**
     * build / repair 在任务池中只保留一个“占位任务”。
     * 实际目标会在 creep 获取任务时动态选择，避免大量细粒度任务污染内存。
     */
    private normalizePlaceholderPool(poolName: WorkPoolName) {
        const tasks = this.getAllMissionFromPool(poolName) || [];
        for (const task of tasks.slice()) {
            if (task && task.type === poolName && task.data && (task.data as any).target) {
                this.deleteMissionFromPool(poolName, task.id);
            }
        }

        const placeholders = (this.getAllMissionFromPool(poolName) || []).filter(
            (task: any) => task && task.type === poolName && !(task.data && task.data.target),
        );
        for (let i = 1; i < placeholders.length; i++) {
            this.deleteMissionFromPool(poolName, placeholders[i].id);
        }
    }

    private ensurePlaceholderMission(poolName: WorkPoolName, shouldExist: boolean) {
        if (!shouldExist) return;
        const existingTaskId = this.checkSameMissionInPool(poolName, poolName, {} as any);
        if (!existingTaskId) {
            this.addMissionToPool(poolName, poolName, 5, {} as any);
        }
    }

    private getOwnedConstructionSites() {
        return (((this as any).constructionSite || this.find(FIND_CONSTRUCTION_SITES)) as ConstructionSite[])
            .filter((site) => site && (site as any).my);
    }

    private hasRepairTarget() {
        const allStructures = (this as any).structures || this.find(FIND_STRUCTURES);
        for (const structure of allStructures) {
            if (!structure || structure.hits >= structure.hitsMax) continue;
            if (structure.structureType === STRUCTURE_WALL || structure.structureType === STRUCTURE_RAMPART) continue;
            if (structure.hits < structure.hitsMax * THRESHOLDS.REPAIR.NORMAL_STRUCTURE) return true;
        }
        return false;
    }

    /**
     * 更新建造/维修任务池（build/repair）
     * @description
     * - 扫描受损建筑，按紧急/常规优先级入队 repair
     * - 扫描工地，按建筑类型与施工进度计算优先级入队 build
     */
    UpdateBuildRepairMission(offset = 0) {
        void offset;
        this.normalizePlaceholderPool('build');
        this.normalizePlaceholderPool('repair');

        this.ensurePlaceholderMission('build', this.getOwnedConstructionSites().length > 0);
        this.ensurePlaceholderMission('repair', this.hasRepairTarget());
    }

    /**
     * 添加/更新建造或维修任务（build/repair）
     * @param type - build 或 repair
     * @param level - 优先级（数值越小越高）
     * @param data - 任务数据
     * @returns OK/false 等任务池写入结果
     */
    BuildRepairMissionAdd(type: 'build' | 'repair', level: number, data: BuildTask | RepairTask) {
        let existingTaskId = this.checkSameMissionInPool(type, type, {} as any);
        if (existingTaskId) {
            return this.updateMissionPool(type, existingTaskId, {level});
        } else {
            return this.addMissionToPool(type, type, level, {} as any);
        }
    }

    /**
     * 更新刷墙/城墙维修任务（WallRampartRepairMission）
     * @description
     * - 根据 LayoutData 中的 wall/rampart 记录构建候选列表
     * - 支持核弹防护优先维修
     * - 以耐久百分比映射为优先级分组写入 global.WallRampartRepairMission
     */
    UpdateWallRepairMission(offset = 0) {
        void offset;
        const botMem = getStructData(this.name) as any;
        if (!botMem.wallRepair) botMem.wallRepair = {};
        if (global.WallRampartRepairMission && global.WallRampartRepairMission[this.name]) {
            delete global.WallRampartRepairMission[this.name];
        }
    }


    /**
     * 检查 build/repair 任务池有效性并清理无效任务
     * @description
     * - build: 目标结构存在即可
     * - repair: 目标结构存在且 hits 未达到目标阈值
     * - 同时清理刷墙任务表
     */
    BuildRepairMissionCheck() {
        const hasBuildTarget = this.getOwnedConstructionSites().length > 0;
        const buildCheck = (task: Task) => task.type === 'build' && hasBuildTarget;
        this.checkMissionPool('build', buildCheck);

        const hasRepairTarget = this.hasRepairTarget();
        const repairCheck = (task: Task) => task.type === 'repair' && hasRepairTarget;
        this.checkMissionPool('repair', repairCheck);
    }
}
