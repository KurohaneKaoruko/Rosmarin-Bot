import { compress, decompress } from '@/utils';

// 发布建造维修任务
function UpdateBuildRepairMission(room: Room) {
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

// 刷墙任务
function UpdateWallRepairMission(room: Room) {
    let WALL_HITS_MAX_THRESHOLD = 0.9;        // 墙最大耐久度阈值
    const botMem = Memory['StructControlData'][room.name];
    if (botMem['ram_threshold']) {
        WALL_HITS_MAX_THRESHOLD = Math.min(botMem['ram_threshold'], 1);
    }
    const memory = Memory['LayoutData'][room.name] as { [key: string]: number[]} || {};
    let wallMem = memory['constructedWall'] || [];
    let rampartMem = memory['rampart'] || [];
    let structRampart = [];
    for (let s of ['spawn', 'tower', 'storage', 'terminal', 'factory', 'lab', 'nuker', 'powerSpawn']) {
        if (memory[s]) {
            structRampart.push(...(memory[s] || []));
        } else {
            if (Array.isArray(room[s])) {
                const poss = room[s].map((s) => compress(s.pos.x, s.pos.y));
                structRampart.push(...poss);
            } else if (room[s]) {
                structRampart.push(compress(room[s].pos.x, room[s].pos.y));
            }
        }
    }
    rampartMem = [...new Set(rampartMem.concat(structRampart))];
    const ramwalls = [];
    [...wallMem, ...rampartMem].forEach((pos) => {
        const [x, y] = decompress(pos);
        if (x < 0 || x > 49 || y < 0 || y > 49) return;
        let rws = room.lookForAt(LOOK_STRUCTURES, x, y).filter((s) =>
            s.hits < s.hitsMax &&
            (s.structureType === STRUCTURE_WALL ||
            s.structureType === STRUCTURE_RAMPART)
        );
        ramwalls.push(...rws);
    })

    if (!global.WallRampartRepairMission) {
        global.WallRampartRepairMission = {}
    }

    let tasks = global.WallRampartRepairMission[room.name] = {};
    
    const roomNukes = room.find(FIND_NUKES) || [];
    for(const structure of ramwalls) {
        const { hitsMax, hits, id, pos } = structure;
        const posInfo = compress(pos.x, pos.y);
        if (roomNukes.length > 0) {
            // 计算附近核弹的伤害
            const areaNukeDamage = roomNukes.filter((n) => pos.inRangeTo(n.pos, 2))
            .reduce((hits, nuke) => pos.isEqualTo(nuke.pos) ? hits + 1e7 : hits + 5e6, 0);
            // 防核维修
            if (hits < areaNukeDamage + 1e6) {
                const data = {target: id, pos: posInfo, hits: areaNukeDamage + 1e6};
                if (!tasks[0]) tasks[0] = [];
                tasks[0].push(data);
                continue;
            }
        }
        // 刷墙维修
        if(hits < hitsMax * WALL_HITS_MAX_THRESHOLD) {
            const level = Math.round(hits / hitsMax * 100) + 1; // 优先级
            const targetHits = Math.ceil(level / 100 * hitsMax) % (hitsMax * WALL_HITS_MAX_THRESHOLD);
            const data = {target: id, pos: posInfo, hits: targetHits};
            if (!tasks[level]) tasks[level] = [];
            tasks[level].push(data);
            continue;
        }
    }

}

// 检查任务是否有效
function BuildRepairMissionCheck(room: Room) {
    const checkFunc = (task: Task) => {
        const {target, hits} = task.data;
        const structure = Game.getObjectById(target) as Structure | null;
        if(!structure) return false;
        if ((task.type === 'repair') &&
            structure.hits >= hits) return false;
        return true;
    }

    room.checkMissionPool('build', checkFunc);
    room.checkMissionPool('repair', checkFunc);

    let wallTasks = global.WallRampartRepairMission[room.name];
    if (!wallTasks || wallTasks.length === 0) return;
    for (let i = wallTasks.length - 1; i >= 0; i--) {
        const task = wallTasks[i];
        const { target, hits } = task;
        const structure = Game.getObjectById(target) as Structure | null;
        if (!structure || structure.hits > hits) {
            wallTasks.splice(i, 1); // 删除当前元素
        }
    }
}

export { UpdateBuildRepairMission, UpdateWallRepairMission, BuildRepairMissionCheck }