import { compress, decompress } from '@/modules/shared/compress';
import { getLayoutData, getStructData } from '@/modules/shared/memory';
import { THRESHOLDS } from '@/constant/Thresholds';

type WorkPoolName = 'build' | 'repair';
type WallRepairMemoryState = {
    pos?: number;
    hits?: number;
    until?: number;
    cursor?: number;
};
type WallRepairContext = {
    botMem: Record<string, any>;
    wallRepair: WallRepairMemoryState;
};

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

// ==================== Wall Getter Helpers ====================
const WALL_REPAIR_STRUCTURE_KEYS = ['spawn', 'tower', 'storage', 'terminal', 'factory', 'lab', 'nuker', 'powerSpawn'] as const;

const getWorkTaskPosInfo = (creep: Creep) =>
    compress(creep.pos.x, creep.pos.y);

const setWallMissionTickCache = (room: Room, task: RepairTask | null) => {
    const roomAny = room as any;
    roomAny._wallMissionTickCacheTick = Game.time;
    roomAny._wallMissionTickCacheTask = task;
};

const getWallRepairMemory = (roomName: string): WallRepairContext => {
    const botMem = getStructData(roomName) as any;
    botMem.wallRepair ??= {};
    return {
        botMem,
        wallRepair: botMem.wallRepair as WallRepairMemoryState,
    };
};

const createRepairTask = (pos: RoomPosition, hits: number): RepairTask => ({
    pos: compress(pos.x, pos.y),
    hits,
});

const isWallRepairStructure = (structure: Structure | null | undefined): structure is StructureWall | StructureRampart =>
    !!structure &&
    (structure.structureType === STRUCTURE_WALL || structure.structureType === STRUCTURE_RAMPART);

const getWallRepairStructuresAt = (room: Room, x: number, y: number) =>
    room.lookForAt(LOOK_STRUCTURES, x, y).filter(isWallRepairStructure);

const restoreCachedWallTask = (
    room: Room,
    wallRepair: WallRepairMemoryState
): RepairTask | null => {
    const { pos, hits, until } = wallRepair;
    if (pos == null || hits == null || !until || Game.time >= until) return null;

    const [x, y] = decompress(pos);
    const structure = getWallRepairStructuresAt(room, x, y)[0];
    if (!structure || structure.hits >= hits) return null;

    const task = { pos, hits };
    setWallMissionTickCache(room, task);
    return task;
};

const getWallHitsMaxThreshold = (botMem: Record<string, any>) =>
    botMem.ram_threshold
        ? Math.min(botMem.ram_threshold, 1)
        : THRESHOLDS.REPAIR.RAMPIRT_MAX_THRESHOLD;

const getProtectedRampartCandidates = (room: Room, layout: Record<string, any>) => {
    const protectedRamparts = [...(layout.rampart || [])];
    for (const key of WALL_REPAIR_STRUCTURE_KEYS) {
        const layoutPositions = layout[key];
        if (layoutPositions) {
            protectedRamparts.push(...layoutPositions);
            continue;
        }

        const structures = (room as any)[key];
        if (Array.isArray(structures)) {
            protectedRamparts.push(...structures.map((structure) => compress(structure.pos.x, structure.pos.y)));
            continue;
        }
        if (structures) {
            protectedRamparts.push(compress(structures.pos.x, structures.pos.y));
        }
    }
    return [...new Set(protectedRamparts)];
};

const getWallRepairCandidates = (room: Room, layout: Record<string, any>) =>
    (layout.constructedWall || []).concat(getProtectedRampartCandidates(room, layout));

const getDamagedWallRepairStructures = (room: Room) =>
    (((room as any).structures || room.find(FIND_STRUCTURES)) as Structure[])
        .filter((structure) => isWallRepairStructure(structure) && structure.hits < structure.hitsMax) as (StructureWall | StructureRampart)[];

const getAreaNukeDamage = (pos: RoomPosition, roomNukes: Nuke[]) =>
    roomNukes
        .filter((nuke) => pos.inRangeTo(nuke.pos, 2))
        .reduce((hits, nuke) => pos.isEqualTo(nuke.pos) ? hits + 1e7 : hits + 5e6, 0);

const findUrgentWallTask = (
    structures: (StructureWall | StructureRampart)[],
    roomNukes: Nuke[],
    referencePos: RoomPosition
): RepairTask | null => {
    let bestTask: RepairTask | null = null;
    let bestScore = Infinity;
    let bestNukePriority = false;

    for (const structure of structures) {
        let targetHits = structure.structureType === STRUCTURE_RAMPART
            ? Math.min(structure.hitsMax, THRESHOLDS.REPAIR.URGENT_RAMPART)
            : Math.min(structure.hitsMax, THRESHOLDS.REPAIR.URGENT_WALL);
        let nukePriority = false;

        if (roomNukes.length > 0) {
            const areaNukeDamage = getAreaNukeDamage(structure.pos, roomNukes);
            if (areaNukeDamage > 0) {
                const nukeTargetHits = Math.min(structure.hitsMax, areaNukeDamage + 1e6);
                if (structure.hits < nukeTargetHits) {
                    targetHits = Math.max(targetHits, nukeTargetHits);
                    nukePriority = true;
                }
            }
        }
        if (structure.hits >= targetHits) continue;

        const score = structure.hits + referencePos.getRangeTo(structure.pos);
        if (
            bestTask == null ||
            (nukePriority && !bestNukePriority) ||
            (nukePriority === bestNukePriority && score < bestScore)
        ) {
            bestTask = createRepairTask(structure.pos, targetHits);
            bestScore = score;
            bestNukePriority = nukePriority;
        }
    }

    return bestTask;
};

const getCandidateRepairGoal = (
    roomName: string,
    x: number,
    y: number,
    structure: StructureWall | StructureRampart,
    roomNukes: Nuke[],
    wallHitsMaxThreshold: number
) => {
    if (roomNukes.length > 0) {
        const pos = new RoomPosition(x, y, roomName);
        const areaNukeDamage = getAreaNukeDamage(pos, roomNukes);
        if (areaNukeDamage > 0 && structure.hits < areaNukeDamage + 1e6) {
            return { hits: areaNukeDamage + 1e6, score: 0 };
        }
    }

    const maxHits = Math.floor(structure.hitsMax * wallHitsMaxThreshold);
    if (structure.hits >= maxHits) return null;
    return { hits: maxHits, score: structure.hits / structure.hitsMax };
};

const scanWallRepairCandidates = (
    room: Room,
    candidates: number[],
    roomNukes: Nuke[],
    wallHitsMaxThreshold: number,
    cursor: number
) => {
    const scanLimit = Math.min(candidates.length, 80);
    const scannedCursor = (cursor + scanLimit) % candidates.length;
    let bestTask: RepairTask | null = null;
    let bestScore = Infinity;
    let bestCursor = cursor;

    for (let i = 0; i < scanLimit; i++) {
        const idx = (cursor + i) % candidates.length;
        const [x, y] = decompress(candidates[idx]);
        if (x < 0 || x > 49 || y < 0 || y > 49) continue;

        const structure = getWallRepairStructuresAt(room, x, y)
            .find((candidate) => candidate.hits < candidate.hitsMax);
        if (!structure) continue;

        const goal = getCandidateRepairGoal(room.name, x, y, structure, roomNukes, wallHitsMaxThreshold);
        if (!goal || goal.score >= bestScore) continue;

        bestTask = { pos: candidates[idx], hits: goal.hits };
        bestScore = goal.score;
        bestCursor = idx;
    }

    return {
        task: bestTask,
        nextCursor: bestTask ? (bestCursor + 1) % candidates.length : scannedCursor,
    };
};

const persistWallRepairTask = (
    room: Room,
    wallRepair: WallRepairMemoryState,
    task: RepairTask,
    ttl: number,
    cursor?: number
) => {
    wallRepair.pos = task.pos;
    wallRepair.hits = task.hits;
    wallRepair.until = Game.time + ttl;
    if (cursor !== undefined) wallRepair.cursor = cursor;
    setWallMissionTickCache(room, task);
    return task;
};

const clearWallRepairTask = (
    room: Room,
    wallRepair: WallRepairMemoryState,
    ttl: number,
    cursor?: number
) => {
    delete wallRepair.pos;
    delete wallRepair.hits;
    wallRepair.until = Game.time + ttl;
    if (cursor !== undefined) wallRepair.cursor = cursor;
    setWallMissionTickCache(room, null);
    return null;
};

// ==================== Getter ====================
export class WorkTaskGetter extends Room {
    getBuildMission(creep: Creep) {
        if (!this.checkMissionInPool('build')) return null;
        return this.getMissionFromPool('build', getWorkTaskPosInfo(creep));
    }

    getRepairMission(creep: Creep) {
        if (!this.checkMissionInPool('repair')) return null;
        return this.getMissionFromPool('repair', getWorkTaskPosInfo(creep));
    }

    getWallMission(creep: Creep) {
        if (this[RESOURCE_ENERGY] < THRESHOLDS.ENERGY.WALL_MIN) return null;

        const roomAny = this as any;
        if (roomAny._wallMissionTickCacheTick === Game.time) {
            return roomAny._wallMissionTickCacheTask ?? null;
        }

        const { botMem, wallRepair } = getWallRepairMemory(this.name);

        const cachedTask = restoreCachedWallTask(this, wallRepair);
        if (cachedTask) return cachedTask;

        const candidates = getWallRepairCandidates(this, getLayoutData(this.name) as any);
        if (!candidates.length) {
            setWallMissionTickCache(this, null);
            return null;
        }

        const roomNukes = this.find(FIND_NUKES) || [];
        const referencePos = creep?.pos || this.getCenter();
        const urgentTask = findUrgentWallTask(getDamagedWallRepairStructures(this), roomNukes, referencePos);
        if (urgentTask) return persistWallRepairTask(this, wallRepair, urgentTask, 5);

        const { task, nextCursor } = scanWallRepairCandidates(
            this,
            candidates,
            roomNukes,
            getWallHitsMaxThreshold(botMem),
            wallRepair.cursor || 0
        );
        if (!task) {
            return clearWallRepairTask(this, wallRepair, 5, nextCursor);
        }

        return persistWallRepairTask(this, wallRepair, task, 10, nextCursor);
    }
}
