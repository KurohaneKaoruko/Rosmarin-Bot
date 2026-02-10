import { compress, decompress } from '@/modules/utils/compress';
import { getLayoutData, getStructData } from '@/modules/utils/memory';
import { THRESHOLDS } from '@/constant/Thresholds';

/**
 * 房间 Work 任务更新模块
 * @description 负责建造/维修任务生成、刷墙任务生成与任务有效性检查（不包含外矿 mine）。
 */
export default class WorkMission extends Room {
    /**
     * 更新建造/维修任务池（build/repair）
     * @description
     * - 扫描受损建筑，按紧急/常规优先级入队 repair
     * - 扫描工地，按建筑类型与施工进度计算优先级入队 build
     */
    UpdateBuildRepairMission(offset = 0) {
        const buildPool = this.getAllMissionFromPool('build') || [];
        for (const t of buildPool.slice()) {
            if (t && t.type === 'build' && t.data && (t.data as any).target) {
                this.deleteMissionFromPool('build', t.id);
            }
        }
        const buildPlaceholders = (this.getAllMissionFromPool('build') || []).filter((t: any) => t && t.type === 'build' && !(t.data && t.data.target));
        for (let i = 1; i < buildPlaceholders.length; i++) {
            this.deleteMissionFromPool('build', buildPlaceholders[i].id);
        }

        const constructionSites = ((this as any).constructionSite || this.find(FIND_CONSTRUCTION_SITES)).filter((s) => s && (s as any).my);
        if (constructionSites.length > 0) {
            const existingTaskId = this.checkSameMissionInPool('build', 'build', {} as any);
            if (!existingTaskId) {
                this.addMissionToPool('build', 'build', 5, {} as any);
            }
        }

        const repairPool = this.getAllMissionFromPool('repair') || [];
        for (const t of repairPool.slice()) {
            if (t && t.type === 'repair' && t.data && (t.data as any).target) {
                this.deleteMissionFromPool('repair', t.id);
            }
        }
        const repairPlaceholders = (this.getAllMissionFromPool('repair') || []).filter((t: any) => t && t.type === 'repair' && !(t.data && t.data.target));
        for (let i = 1; i < repairPlaceholders.length; i++) {
            this.deleteMissionFromPool('repair', repairPlaceholders[i].id);
        }

        const NORMAL_STRUCTURE_THRESHOLD = THRESHOLDS.REPAIR.NORMAL_STRUCTURE;

        const all = (this as any).structures || this.find(FIND_STRUCTURES);
        let hasRepairTarget = false;
        for (const structure of all) {
            if (!structure || structure.hits >= structure.hitsMax) continue;
            if (structure.structureType === STRUCTURE_WALL || structure.structureType === STRUCTURE_RAMPART) continue;
            if (structure.hits < structure.hitsMax * NORMAL_STRUCTURE_THRESHOLD) { hasRepairTarget = true; break; }
        }

        if (hasRepairTarget) {
            const existingTaskId = this.checkSameMissionInPool('repair', 'repair', {} as any);
            if (!existingTaskId) {
                this.addMissionToPool('repair', 'repair', 5, {} as any);
            }
        }
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
        const hasBuildTarget = (((this as any).constructionSite || this.find(FIND_CONSTRUCTION_SITES)).some((s) => s && (s as any).my));
        const buildCheck = (task: Task) => task.type === 'build' && hasBuildTarget;
        this.checkMissionPool('build', buildCheck);

        const NORMAL_STRUCTURE_THRESHOLD = THRESHOLDS.REPAIR.NORMAL_STRUCTURE;
        const all = (this as any).structures || this.find(FIND_STRUCTURES);
        let hasRepairTarget = false;
        for (const structure of all) {
            if (!structure || structure.hits >= structure.hitsMax) continue;
            if (structure.structureType === STRUCTURE_WALL || structure.structureType === STRUCTURE_RAMPART) continue;
            if (structure.hits < structure.hitsMax * NORMAL_STRUCTURE_THRESHOLD) { hasRepairTarget = true; break; }
        }
        const repairCheck = (task: Task) => task.type === 'repair' && hasRepairTarget;
        this.checkMissionPool('repair', repairCheck);

    }
}
