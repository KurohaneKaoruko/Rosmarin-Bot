import { compress, decompress } from '@/utils';

// 刷墙任务
export function UpdateWallRepairMission(room: Room) {
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
            const maxHits = Math.floor(hitsMax * WALL_HITS_MAX_THRESHOLD);
            const targetHits = Math.min(Math.ceil(level / 100 * hitsMax), maxHits);
            const data = {target: id, pos: posInfo, hits: targetHits};
            if (!tasks[level]) tasks[level] = [];
            tasks[level].push(data);
            continue;
        }
    }

}

export function checkWallMission(room: Room) {
    if (!global.WallRampartRepairMission) return;
    const wallTaskMap = global.WallRampartRepairMission[room.name];
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
