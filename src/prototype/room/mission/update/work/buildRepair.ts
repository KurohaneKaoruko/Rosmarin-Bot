import { compress } from '@/utils';

// 发布建造维修任务
export function UpdateBuildRepairMission(room: Room) {
    // 查找所有受损的结构
    const allStructures = room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.hits < structure.hitsMax
    });

    const NORMAL_STRUCTURE_THRESHOLD = 0.8;     // 普通修复建筑耐久度阈值
    const URGENT_STRUCTURE_THRESHOLD = 0.1;     // 紧急修复建筑耐久度阈值
    const NORMAL_WALL_HITS = room.level < 7 ? 300e3 : 1e6;               // 普通修复墙耐久度
    const URGENT_WALL_HITS = 3000;              // 紧急修复墙耐久度

    // 维修优先级：紧急维修-建筑 > 紧急维修-墙 > 常规维修-建筑 > 常规维修-墙
    for (const structure of allStructures) {
        const { hitsMax, structureType, hits, id, pos } = structure;
        const posInfo = compress(pos.x, pos.y);
        if (structureType !== STRUCTURE_WALL && structureType !== STRUCTURE_RAMPART) {
            // 处理建筑
            // 紧急维修
            if (hits < hitsMax * URGENT_STRUCTURE_THRESHOLD) {
                const data = {target: id, pos: posInfo, hits: hitsMax * URGENT_STRUCTURE_THRESHOLD};
                room.BuildRepairMissionAdd('repair', 1, data)
                continue;
            }

            // 常规维修
            if (hits < hitsMax * NORMAL_STRUCTURE_THRESHOLD) {
                const data = {target: id, pos: posInfo, hits: hitsMax * NORMAL_STRUCTURE_THRESHOLD};
                room.BuildRepairMissionAdd('repair', 3, data)
                continue;
            }
        } else {
            // 处理墙和城墙
            if (hits < URGENT_WALL_HITS) {          // 紧急维修
                const data = {target: id, pos: posInfo, hits: URGENT_WALL_HITS};
                room.BuildRepairMissionAdd('repair', 2, data)
                continue;
            }
            if (hits < NORMAL_WALL_HITS) {   // 常规维修
                const data = {target: id, pos: posInfo, hits: NORMAL_WALL_HITS};
                room.BuildRepairMissionAdd('repair', 4, data)
                continue;
            }
        }
    }

    // 建造任务
    const constructionSites = room.find(FIND_CONSTRUCTION_SITES);
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
        room.BuildRepairMissionAdd('build', level, data)
    }
}
