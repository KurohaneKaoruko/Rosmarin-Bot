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
        const allStructures = this.find(FIND_STRUCTURES, {
            filter: (structure) => structure.hits < structure.hitsMax
        });

        const NORMAL_STRUCTURE_THRESHOLD = THRESHOLDS.REPAIR.NORMAL_STRUCTURE;
        const URGENT_STRUCTURE_THRESHOLD = THRESHOLDS.REPAIR.URGENT_STRUCTURE;
        const NORMAL_WALL_HITS = this.level < 7 ? THRESHOLDS.REPAIR.NORMAL_WALL.BELOW_RCL7 : THRESHOLDS.REPAIR.NORMAL_WALL.RCL8;
        const URGENT_WALL_HITS = THRESHOLDS.REPAIR.URGENT_WALL;

        for (const structure of allStructures) {
            const { hitsMax, structureType, hits, id, pos } = structure;
            const posInfo = compress(pos.x, pos.y);
            if (structureType !== STRUCTURE_WALL && structureType !== STRUCTURE_RAMPART) {
                if (hits < hitsMax * URGENT_STRUCTURE_THRESHOLD) {
                    const data = {target: id, pos: posInfo, hits: hitsMax * URGENT_STRUCTURE_THRESHOLD};
                    this.BuildRepairMissionAdd('repair', 1, data)
                    continue;
                }

                if (hits < hitsMax * NORMAL_STRUCTURE_THRESHOLD) {
                    const data = {target: id, pos: posInfo, hits: hitsMax * NORMAL_STRUCTURE_THRESHOLD};
                    this.BuildRepairMissionAdd('repair', 3, data)
                    continue;
                }
            } else {
                if (hits < URGENT_WALL_HITS) {
                    const data = {target: id, pos: posInfo, hits: URGENT_WALL_HITS};
                    this.BuildRepairMissionAdd('repair', 2, data)
                    continue;
                }
                if (hits < NORMAL_WALL_HITS) {
                    const data = {target: id, pos: posInfo, hits: NORMAL_WALL_HITS};
                    this.BuildRepairMissionAdd('repair', 4, data)
                    continue;
                }
            }
        }

        const constructionSites = this.find(FIND_CONSTRUCTION_SITES);
        for(const site of constructionSites) {
            const posInfo = compress(site.pos.x, site.pos.y);
            const data = {target: site.id, pos: posInfo};
            let level = Math.round((1 - site.progress / site.progressTotal) * 4);
            if (site.structureType === STRUCTURE_TERMINAL ||
                site.structureType === STRUCTURE_STORAGE ||
                site.structureType === STRUCTURE_SPAWN) {
                level = 0;
            } else if (site.structureType === STRUCTURE_EXTENSION ||
                site.structureType === STRUCTURE_ROAD) {
                level += 0;
            } else if (site.structureType === STRUCTURE_LINK ||
                site.structureType === STRUCTURE_TOWER) {
                level += 4;
            } else {
                level += 8;
            }
            this.BuildRepairMissionAdd('build', level, data)
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
        let existingTaskId = this.checkSameMissionInPool(type, type, { target: data.target } as any);
        if (existingTaskId) {
            return this.updateMissionPool(type, existingTaskId, {level, data});
        } else {
            return this.addMissionToPool(type, type, level, data);
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
        let WALL_HITS_MAX_THRESHOLD: number = THRESHOLDS.REPAIR.RAMPIRT_MAX_THRESHOLD;
        const botMem = getStructData(this.name);
        if (botMem['ram_threshold']) {
            WALL_HITS_MAX_THRESHOLD = Math.min(botMem['ram_threshold'], 1);
        }
        const memory = getLayoutData(this.name) as { [key: string]: number[]};
        let wallMem = memory['constructedWall'] || [];
        let rampartMem = memory['rampart'] || [];
        let structRampart = [];
        for (let s of ['spawn', 'tower', 'storage', 'terminal', 'factory', 'lab', 'nuker', 'powerSpawn']) {
            if (memory[s]) {
                structRampart.push(...(memory[s] || []));
            } else {
                if (Array.isArray(this[s])) {
                    const poss = this[s].map((s) => compress(s.pos.x, s.pos.y));
                    structRampart.push(...poss);
                } else if (this[s]) {
                    structRampart.push(compress(this[s].pos.x, this[s].pos.y));
                }
            }
        }
        rampartMem = [...new Set(rampartMem.concat(structRampart))];
        const ramwalls = [];
        [...wallMem, ...rampartMem].forEach((pos) => {
            const [x, y] = decompress(pos);
            if (x < 0 || x > 49 || y < 0 || y > 49) return;
            let rws = this.lookForAt(LOOK_STRUCTURES, x, y).filter((s) =>
                s.hits < s.hitsMax &&
                (s.structureType === STRUCTURE_WALL ||
                s.structureType === STRUCTURE_RAMPART)
            );
            ramwalls.push(...rws);
        })
    
        if (!global.WallRampartRepairMission) {
            global.WallRampartRepairMission = {}
        }
    
        let tasks = global.WallRampartRepairMission[this.name] = {};
        
        const roomNukes = this.find(FIND_NUKES) || [];
        for(const structure of ramwalls) {
            const { hitsMax, hits, id, pos } = structure;
            const posInfo = compress(pos.x, pos.y);
            if (roomNukes.length > 0) {
                const areaNukeDamage = roomNukes.filter((n) => pos.inRangeTo(n.pos, 2))
                .reduce((hits, nuke) => pos.isEqualTo(nuke.pos) ? hits + 1e7 : hits + 5e6, 0);
                if (hits < areaNukeDamage + 1e6) {
                    const data = {target: id, pos: posInfo, hits: areaNukeDamage + 1e6};
                    if (!tasks[0]) tasks[0] = [];
                    tasks[0].push(data);
                    continue;
                }
            }
            if(hits < hitsMax * WALL_HITS_MAX_THRESHOLD) {
                const level = Math.round(hits / hitsMax * 100) + 1;
                const maxHits = Math.floor(hitsMax * WALL_HITS_MAX_THRESHOLD);
                const targetHits = Math.min(Math.ceil(level / 100 * hitsMax), maxHits);
                const data = {target: id, pos: posInfo, hits: targetHits};
                if (!tasks[level]) tasks[level] = [];
                tasks[level].push(data);
                continue;
            }
        }
    }

    /**
     * 清理刷墙任务表中已完成/失效条目
     * @description 对 global.WallRampartRepairMission[this.name] 做就地清理
     */
    checkWallMission() {
        if (!global.WallRampartRepairMission) return;
        const wallTaskMap = global.WallRampartRepairMission[this.name];
        if (!wallTaskMap) return;

        for (const lvStr of Object.keys(wallTaskMap)) {
            const lv = Number(lvStr);
            const tasks = wallTaskMap[lv];
            if (!tasks || tasks.length === 0) { delete wallTaskMap[lv]; continue; }

            for (let i = tasks.length - 1; i >= 0; i--) {
                const task = tasks[i];
                const { target, hits } = task;
                const structure = Game.getObjectById(target) as Structure | null;
                if (!structure || structure.hits >= hits) tasks.splice(i, 1);
            }

            if (tasks.length === 0) delete wallTaskMap[lv];
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
        const checkFunc = (task: Task) => {
            const data = task.data as BuildTask | RepairTask;
            const {target} = data;
            const structure = Game.getObjectById(target) as Structure | null;
            if(!structure) return false;
            if ((task.type === 'repair') && 'hits' in data &&
                structure.hits >= (data as RepairTask).hits) return false;
            return true;
        }

        this.checkMissionPool('build', checkFunc);
        this.checkMissionPool('repair', checkFunc);

        this.checkWallMission();
    }
}
