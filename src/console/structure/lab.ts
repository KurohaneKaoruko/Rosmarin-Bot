import {LabMap} from '@/constant/ResourceConstant'
import { compress } from '@/modules/utils/compress';
import { ensureBoostLabs } from '@/modules/utils/labReservations';
import { BASE_CONFIG } from '@/constant/config';
import { getAutoLabData, getRoomData, getStructData } from '@/modules/utils/memory';

export default {
    lab: {
        // 开启lab
        open(roomName?: string) {
            if (!roomName) {
                let ok = 0;
                let skip = 0;
                for (const rn of Object.keys(getRoomData())) {
                    const room = Game.rooms[rn];
                    if (!room || !room.my) {
                        skip++;
                        continue;
                    }
                    const BotMemStructures = getStructData(rn) as any;
                    BotMemStructures['lab'] = true;
                    ok++;
                }
                global.log(`已开启全部房间lab合成: 成功 ${ok}, 跳过 ${skip}`);
                return OK;
            }
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                global.log(`房间 ${roomName} 不存在或未添加。`);
                return;
            }
            const BotMemStructures = getStructData(roomName) as any;
            BotMemStructures['lab'] = true;
            global.log(`[${roomName}] 已开启lab合成。`);
            return OK;
        },
        // 关闭lab
        stop(roomName?: string) {
            if (!roomName) {
                let ok = 0;
                let skip = 0;
                for (const rn of Object.keys(getRoomData())) {
                    const room = Game.rooms[rn];
                    if (!room || !room.my) {
                        skip++;
                        continue;
                    }
                    const BotMemStructures = getStructData(rn) as any;
                    BotMemStructures['lab'] = false;
                    ok++;
                }
                global.log(`已关闭全部房间lab合成: 成功 ${ok}, 跳过 ${skip}`);
                return OK;
            }
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                global.log(`房间 ${roomName} 不存在或未添加。`);
                return;
            }
            const BotMemStructures = getStructData(roomName) as any;
            BotMemStructures['lab'] = false;
            global.log(`[${roomName}] 已关闭lab合成。`);
            return OK;
        },
        // 设置lab合成底物
        set(roomName: string, product: string, amount: number = 0) {
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                global.log(`房间 ${roomName} 不存在或未拥有。`);
                return;
            }
            const BotMemStructures = getStructData(roomName) as any;
            if (product) {
                if (!LabMap[product]) {
                    global.log(`不存在Lab合成产物 ${product} 。`);
                    return;
                }
                let A = LabMap[product].raw1;
                let B = LabMap[product].raw2;
                BotMemStructures['labAtype'] = A;
                BotMemStructures['labBtype'] = B;
                BotMemStructures['labAmount'] = Math.max(0, amount);
                global.log(`[${roomName}] 已设置lab合成底物为 ${A} 和 ${B}。`);
            }
            const labAflag = Game.flags[`labA`] || Game.flags[`lab-A`];
            const labBflag = Game.flags[`labB`] || Game.flags[`lab-B`];
            if(labAflag && labBflag && labAflag.pos.roomName === roomName && labBflag.pos.roomName === roomName) {
                const labA = labAflag.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_LAB) as StructureLab | undefined;
                const labB = labBflag.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_LAB) as StructureLab | undefined;
                if (!labA || !labB) {
                    global.log(`[${roomName}] 未找到 labA/labB 旗帜所在位置的 Lab。`);
                } else {
                    BotMemStructures['labA'] = compress(labA.pos.x, labA.pos.y);
                    BotMemStructures['labB'] = compress(labB.pos.x, labB.pos.y);
                    global.log(`[${roomName}] 已设置底物lab为 (${labA.pos.x},${labA.pos.y}) 和 (${labB.pos.x},${labB.pos.y})。`);
                }
                labAflag.remove();
                labBflag.remove();
            }
            BotMemStructures['lab'] = true;
            global.log(`[${roomName}] 已开启lab合成。`);
            return OK;
        },
        setboost(roomName: string) {
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                global.log(`房间 ${roomName} 不存在或未拥有。`);
                return;
            }
            // 手动长期征用：通过旗帜设置某个 lab 固定填充指定 boost 资源（mode: 'fixed'）
            const boostLabs = ensureBoostLabs(roomName);
            for(const id of Object.keys(boostLabs)) {
                const lab = Game.getObjectById(id) as StructureLab;
                if(!lab) delete boostLabs[id];
            }
            for(const flag of Game.rooms[roomName].find(FIND_FLAGS)) {
                const labsetMatch = flag.name.match(/^labset[-#/ ](\w+)(?:[-#/ ].*)?$/);
                if(!labsetMatch) continue;
                const lab = flag.pos.lookFor(LOOK_STRUCTURES).find(structure => structure.structureType === STRUCTURE_LAB);
                if (!lab) continue;
                const RES = BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                let resourceType = RES[labsetMatch[1]] || labsetMatch[1] as ResourceConstant;
                if (!resourceType || !LabMap[resourceType]) {
                    delete boostLabs[lab.id];
                    flag.remove();
                    console.log(`在房间 ${roomName} 删除了 lab(${lab.id}) 的强化资源设置`);
                    continue;
                }
                boostLabs[lab.id] = { mineral: resourceType, mode: 'fixed' };
                console.log(`在房间 ${roomName} 设置了 lab(${lab.id}) 的强化资源: ${resourceType}`);
                flag.remove();
            }
            return OK;
        },
        addboost(roomName: string, mineral: ResourceConstant, amount: number=3000) {
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                global.log(`房间 ${roomName} 不存在或未拥有。`);
                return;
            }
            room.AssignBoostTask(mineral, amount);
            return OK;
        },
        removeboost(roomName: string, mineral: string) {
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                global.log(`房间 ${roomName} 不存在或未拥有。`);
                return;
            }
            room.RemoveBoostTask(mineral);
            return OK;
        },
        auto: {
            set(roomName: string, product: string, amount: number=30000) {
                const room = Game.rooms[roomName];
                if(!room || !room.my) {
                    global.log(`房间 ${roomName} 不存在或未拥有。`);
                    return;
                }
                if(!LabMap[product]) {
                    global.log(`资源 ${product} 不存在。`);
                    return;
                }
                const BotMem = getAutoLabData(roomName);
    
                amount = amount || 0;
                BotMem[product] = amount;
                global.log(`已设置 ${roomName} 的自动lab合成: ${product} - ${amount}`);
                if (amount > 0) global.log(`合成任务限额: ${amount}`);
                return OK;
            },
            remove(roomName: string, product?: string) {
                const room = Game.rooms[roomName];
                if(!room || !room.my) {
                    global.log(`房间 ${roomName} 不存在或未拥有。`);
                    return;
                }
                if(!LabMap[product]) {
                    global.log(`资源 ${product} 不存在。`);
                    return;
                }
                const BotMem = getAutoLabData(roomName);
    
                delete BotMem[product];
                global.log(`已删去 ${roomName} 的自动lab合成: ${product}`);
                return OK;
            },
            list(roomName: string) {
                const BotMemAutoFactory = getAutoLabData();
                if(roomName) {
                    const autoLab = BotMemAutoFactory[roomName];
                    if(!autoLab || autoLab.length == 0) {
                        global.log(`[${roomName}]没有开启自动lab合成`);
                    } else {
                        console.log(`[${roomName}]自动lab合成有: `);
                        for (const product in BotMemAutoFactory[roomName]) {
                            console.log(`\n    -${product} - ${autoLab[product]}`);
                        }
                    }
                    return OK;
                }
    
                if(!BotMemAutoFactory || Object.keys(BotMemAutoFactory).length == 0) {
                    global.log(`没有房间开启自动lab合成`);
                }
                for(const roomName in BotMemAutoFactory) {
                    if(!BotMemAutoFactory[roomName] ||
                        BotMemAutoFactory[roomName].length == 0) {
                        continue;
                    }
                    console.log(`[${roomName}]自动lab合成有: `);
                    for (const product in BotMemAutoFactory[roomName]) {
                        console.log(`\n    -${product} - ${BotMemAutoFactory[roomName][product]}`);
                    }
                }
                return OK;
            }
        }
    }
}
