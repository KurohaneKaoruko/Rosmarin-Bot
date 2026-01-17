import {decompress} from "@/utils"

export default class AutoBuild extends Room {
    // 自动建筑
    autoBuild() {
        if (this.memory.defend) return;
        if (Memory['warmode']) return;
        if (Game.cpu.bucket < 100) return;
        
        if (Game.time % 100 !== (this.memory['index']||0)) return;

        // 开启了自动建造, 且有布局Memory, 则自动建筑
        const memory = Memory['RoomControlData'][this.name];
        const layoutMemory = Memory['LayoutData'][this.name];
        if (memory && memory.autobuild && layoutMemory &&
            Object.keys(layoutMemory).length) {
            // 根据布局放置工地
            plannerCreateSite(this, layoutMemory);
        }

        // 关键建筑造rampart
        if (this.level < 7) return;
        const structures = this.getStructures() || [];
        for (const s of ['spawn', 'tower', 'storage', 'terminal', 'factory', 'lab', 'nuker', 'powerSpawn']) {
            let structs = structures.filter((o) => o.structureType == s);
            for (const struct of structs) {
                if (!struct||!struct.pos) continue;
                const S = struct.pos.lookFor(LOOK_STRUCTURES);
                // 已有rampart则跳过
                if (S.some((o:any) => o.structureType == 'rampart')) continue;
                this.createConstructionSite(struct.pos.x, struct.pos.y, 'rampart');
            }
        }
    }
}

// 根据布局放置工地
const plannerCreateSite = function (room: Room, layoutMemory: any) {
    // 现有工地到达上限时不处理
    const allSite = room.find(FIND_CONSTRUCTION_SITES);
    if (allSite.length >= 100) return;
    // 遍历布局各个建筑类型的坐标数组
    for (const s in layoutMemory) {
        // 当前RCL能造的数量为最大建造数
        const buildMax = CONTROLLER_STRUCTURES[s][room.level];
        if (!buildMax) continue;

        // 如果建筑数量达到上限，则跳过
        let count = 0;  // 建筑计数
        let structures = room[s] || room.find(FIND_STRUCTURES, { filter: (o) => o.structureType == s });
        count = structures.length;
        if (count >= buildMax) continue;
        // 算上工地数再判断一次
        const sites = allSite.filter(o => o.structureType == s);
        count += sites.length;
        if (count >= buildMax) continue;
        
        // 限制建造到第几个
        let points = getPoints(room, s, layoutMemory[s]);
        if (!points || points.length == 0) continue;
        // 构建工地
        for (const p of points) {
            const [x, y] = decompress(p); // 解压坐标
            if (x < 0 || x > 49 || y < 0 || y > 49) continue; // 超出边界跳过
            const Pos = new RoomPosition(x, y, room.name);
            const C = Pos.lookFor(LOOK_CONSTRUCTION_SITES);
            if (C.length) continue; // 已有工地跳过
            const S = Pos.lookFor(LOOK_STRUCTURES);
            // 检查是否跳过该位置的建造
            if (checkSkipBuild(room, s, S, Pos)) continue;
            const result = room.createConstructionSite(x, y, s as any);
            if (result == ERR_FULL) return;
        }
    }
}

// 限制建造到第几个, 返回坐标数组(压缩形式)
function getPoints(room: Room, structureType: string, layoutArray: any) {
    if (structureType == 'road') {
        if (room.level < 3) return [];   // 3级以下不建造路
        // 对于路则使用如下判断来限制
        const layoutType = Memory['RoomControlData'][room.name]['layout'];
        switch (layoutType) {
            case 'tea':
                if (room.level == 3) return layoutArray.slice(0, 11);
                if (room.level == 4) return layoutArray.slice(0, 24);
                if (room.level == 5) return layoutArray.slice(0, 37);
                break;
            case 'hoho':
                if (room.level == 3) return layoutArray.slice(0, 7);
                if (room.level == 4) return layoutArray.slice(0, 13);
                if (room.level == 5) return layoutArray.slice(0, 21);
                break;
            default:
                break;
        }
    } else if (structureType == 'rampart') {
        // 4级以下不建造墙
        if (room.level < 4) return [];
    }

    return layoutArray;
}



// // 对于关键建筑, 在所在位置建造rampart
// function buildRampart(room: Room, structureType: string, LOOK_S: Structure<StructureConstant>[], Pos: RoomPosition) {
//     if (room.level < 4) return; // 4级以下不建造墙
//     if (!mainStructMap.includes(structureType)) return;
//     if (LOOK_S.some(o => o.structureType == 'rampart')) return;
//     if (LOOK_S.every(o => o.structureType !== structureType)) return;
//     room.createConstructionSite(Pos.x, Pos.y, 'rampart');
//     return;
// }

// 检查建筑所在位置的情况, 决定是否跳过建造
function checkSkipBuild(room: Room, structureType: string, LOOK_STRUCT: Structure<StructureConstant>[], Pos: RoomPosition) {
    switch (structureType) {
        case 'rampart':
            // 位置没建筑可以造
            if (!LOOK_STRUCT.length) return false;
            // 有墙跳过
            if (LOOK_STRUCT.some(o => o.structureType == STRUCTURE_RAMPART || o.structureType == STRUCTURE_WALL)) return true;
            break;
        case 'road':
            // 位置没建筑可以造
            if (!LOOK_STRUCT.length) return false;
            // 有不可通过建筑，则跳过
            if (LOOK_STRUCT.some(o => o.structureType != STRUCTURE_RAMPART &&
                o.structureType != STRUCTURE_CONTAINER)) return true;
            break;
        case 'container':
            // 有不可通过建筑，则跳过
            if (LOOK_STRUCT.length &&
                LOOK_STRUCT.some(o => o.structureType != STRUCTURE_RAMPART &&
                o.structureType != STRUCTURE_ROAD)) return true;
            if (room.level <= 7) return false;
            // 在控制器旁边的container, 在等级高时不造
            if (Pos.inRangeTo(room.controller, 2)) return true;
            break;
        default:
            // 位置没建筑可以造
            if (!LOOK_STRUCT.length) return false;
            // 有不可通过建筑，则跳过
            if (LOOK_STRUCT.some(o => o.structureType != 'rampart' &&
                o.structureType != 'road')) return true;
            break;
    }
    
    return false;
}

