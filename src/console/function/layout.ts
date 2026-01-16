import { compress, decompress, compressBatch, decompressBatch } from '@/utils';
import HelperVisual from '@/modules/feature/planner/helperVisual';
import LayoutPlanner from '@/modules/feature/planner/layoutPlanner';

export default {
    layout: {
        // 设置房间布局
        set(roomName: string, layout: string, x: number, y: number) {
            const room = Game.rooms[roomName];
            const BotMemRooms = Memory['RoomControlData'];
            if (!room || !room.my || !BotMemRooms[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            if (!layout) {
                BotMemRooms[roomName]['layout'] = '';
                delete BotMemRooms[roomName]['center'];
                global.log(`已清除 ${roomName} 的布局设置。`);
                return OK;
            }
            if (!x || !y) {
                return Error(`需要输入正确的布局中心坐标。`);
            }
            BotMemRooms[roomName]['layout'] = layout;
            BotMemRooms[roomName]['center'] = { x, y };
            global.log(`已设置 ${roomName} 的布局为 ${layout}, 布局中心为 (${x},${y})`);
            return OK;
        },
        // 开关自动建筑
        auto(roomName: string) {
            const room = Game.rooms[roomName];
            const BotMemRooms = Memory['RoomControlData'];
            if (!room || !room.my || !BotMemRooms[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            const layout = BotMemRooms[roomName]['layout'];
            if (!layout) {
                return Error(`房间 ${roomName} 未设置布局。`);
            }
            const center = BotMemRooms[roomName]['center'];
            if (layout && !center) {
                return Error(`房间  ${roomName} 未设置布局中心。`);
            }
            const memory = BotMemRooms[roomName];
            memory.autobuild = !memory.autobuild;
            global.log(`已${memory.autobuild ? '开启' : '关闭'} ${roomName} 的自动建筑.`);
            return OK;
        },
        // 清除房间布局memory
        remove(roomName: string) {
            delete Memory['LayoutData'][roomName];
            global.log(`已清除 ${roomName} 的布局memory。`);
            return OK;
        },
        // 构建布局
        build(roomName: string) {
            const BotMemRooms = Memory['RoomControlData'];
            if (!BotMemRooms[roomName]) {
                return Error(`房间 ${roomName} 未添加到控制列表。`);
            }
            const layoutMemory = Memory['LayoutData'][roomName];
            if (layoutMemory && Object.keys(layoutMemory).length) {
                console.log(`房间 ${roomName} 的布局memory已存在，将覆盖原memory。`);
                delete Memory['LayoutData'][roomName];
            }
            const layoutType = BotMemRooms[roomName]['layout'];
            // 如果没有设置布局就会使用自动布局
            if (!layoutType || layoutType == '63auto') {
                return LayoutPlanner.buildDynamic63(roomName);
            } else {
                return LayoutPlanner.buildStatic(roomName, layoutType);
            }
        },
        // 查看布局可视化
        visual(roomName?: string, layout?: string) {
            let cpu = Game.cpu.getUsed();
            let result = null;
            if (roomName && layout) {
                if (layout == '63') {
                    result = LayoutPlanner.visualDynamic63(roomName);
                } else {
                    result = LayoutPlanner.visualStatic(roomName, layout);
                }
            } else if (roomName) {
                const layoutMemory = Memory['LayoutData'][roomName];
                if (!layoutMemory || Object.keys(layoutMemory).length == 0) {
                    console.log(`房间 ${roomName} 的布局memory不存在，将根据自动布局可视化...`)
                    result = LayoutPlanner.visualDynamic63(roomName);
                } else {
                    console.log(`将根据房间${roomName}的布局memory进行可视化...`)
                    const structMap = {};
                    for (const s in layoutMemory) {
                        structMap[s] = decompressBatch(layoutMemory[s]);
                    }
                    HelperVisual.showRoomStructures(roomName, structMap);
                    result = OK;
                }
            } else {
                result = LayoutPlanner.visualDynamic63ByFlags();
            }
            if (result == OK) {
                cpu = Game.cpu.getUsed() - cpu;
                console.log(`可视化完成，消耗CPU ${cpu.toFixed(2)}。`)
                return OK;
            } else {
                console.log(`可视化失败，消耗CPU ${cpu.toFixed(2)}。`)
                return result;
            }
        },
        // 将房间建筑加入布局memory
        save(roomName: string, struct?: string) {
            const BotMemRooms = Memory['RoomControlData'];
            if (!BotMemRooms[roomName]) {
                return Error(`房间 ${roomName} 未添加到控制列表。`);
            }
            if (!struct) {
                if (!Memory['LayoutData'][roomName]) Memory['LayoutData'][roomName] = {};
                let layoutMemory = Memory['LayoutData'][roomName];
                const room = Game.rooms[roomName];
                const structList = ['spawn', 'extension', 'link', 'tower', 'road', 'storage', 'terminal', 'factory', 'lab',
                    'nuker', 'observer', 'powerSpawn', 'container', 'extractor'];
                for (const s of structList) {
                    let structs = room[s] as Structure[];
                    if (!Array.isArray(structs)) structs = [structs];
                    layoutMemory[s] = structs.map(struct => compress(struct.pos.x, struct.pos.y));
                }
                console.log(`房间 ${roomName} 的布局已更新。`);
            } else {
                let layoutMemory = Memory['LayoutData'][roomName];
                if (!layoutMemory) {
                    layoutMemory = Memory['LayoutData'][roomName] = {};
                }
                const structList = ['spawn', 'extension', 'link', 'tower', 'road', 'storage', 'terminal', 'factory', 'lab',
                    'nuker', 'observer', 'powerSpawn', 'container', 'extractor', 'rampart', 'constructedWall'];
                if (!structList.includes(struct)) return Error(`不支持的struct类型 ${struct}。`);
                
                const room = Game.rooms[roomName];
                let structs = room[struct] as Structure[];
                if (!Array.isArray(structs)) structs = [structs];
                layoutMemory[struct] = structs.map(struct => compress(struct.pos.x, struct.pos.y));
                console.log(`房间 ${roomName} 的 ${struct} 布局已更新。`);
            }
            return OK;
        },
        // 查看rampart最小血量, 只考虑布局中的
        ramhits(roomName: string) {
            const layoutMemory = Memory['LayoutData'][roomName];
            if (!layoutMemory) {
                return Error(`房间 ${roomName} 的布局memory不存在。`);
            }
            if (Object.keys(layoutMemory).length == 0) {
                return Error(`房间 ${roomName} 的布局memory为空。`);
            }
            let rampartMem = layoutMemory['rampart'] || [];
            let structRampart = [];
            for (let s of ['spawn', 'tower', 'storage', 'terminal', 'factory', 'lab', 'nuker', 'powerSpawn']) {
                structRampart.push(...(layoutMemory[s] || []));
            }
            rampartMem = [...new Set(rampartMem.concat(structRampart))];
            let ramparts = Game.rooms[roomName].rampart.filter((r) => rampartMem.includes(compress(r.pos.x, r.pos.y)));
            let minRampart = ramparts.reduce((r, c) => r.hits < c.hits ? r : c);
            let maxRampart = ramparts.reduce((r, c) => r.hits > c.hits ? r : c);
            let minHits = '', maxHits = '';
            if (minRampart.hits < 1e6) {
                minHits = (minRampart.hits / 1000).toFixed(2) + 'K';
            } else {
                minHits = (minRampart.hits / 1e6).toFixed(2) + 'M';
            }
            if (maxRampart.hits < 1e6) {
                maxHits = (maxRampart.hits / 1000).toFixed(2) + 'K';
            } else {
                maxHits = (maxRampart.hits / 1e6).toFixed(2) + 'M';
            }
            return  `[Min] ${minHits}  (${minRampart.pos.x}, ${minRampart.pos.y})\n`+
                    `[Max] ${maxHits}  (${maxRampart.pos.x}, ${maxRampart.pos.y})`;
        },
        // 从布局memory添加或删除所选rampart
        rampart(roomName: string, operate = 1) {
            const flag = Game.flags['layout-rampart'];
            if (!flag) {
                console.log('未找到`layout-rampart`旗帜标记');
                return -1;
            }
            const rampart = []
            if (flag.pos.lookFor(LOOK_STRUCTURES).filter((s) => s.structureType === STRUCTURE_RAMPART).length > 0) {
                rampart.push(compress(flag.pos.x, flag.pos.y));
                const queue = [[flag.pos.x, flag.pos.y]];
                const done = {}
                while (queue.length > 0) {
                    const pos = queue.shift();
                    const x = pos[0];
                    const y = pos[1];
                    if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                    const xy = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
                    for (const p of xy) {
                        const px = p[0];
                        const py = p[1];
                        if (px < 0 || px > 49 || py < 0 || py > 49) continue;
                        const pos1 = new RoomPosition(px, py, flag.pos.roomName);
                        if (!done[compress(px, py)] &&
                            pos1.lookFor(LOOK_STRUCTURES)
                                .filter((s) => s.structureType === STRUCTURE_RAMPART).length > 0) {
                            rampart.push(compress(pos1.x, pos1.y));
                            queue.push([px, py]);
                        }
                    }
                    done[compress(x, y)] = true;
                }
            } else {
                console.log('`layout-rampart`旗帜没有放置到rampart上');
                return -1;
            }
            flag.remove();
            let count = 0;
            if (operate === 1) {
                const memory = Memory['LayoutData'][roomName];
                if (!memory.rampart) memory.rampart = [];
                for (const ram of rampart) {
                    if (!memory.rampart.includes(ram)) {
                        memory.rampart.push(ram);
                        count++;
                    }
                }
                console.log(`已添加${count}个rampart到布局memory`);
                return OK;
            }
            else {
                const memory = Memory['LayoutData'][roomName];
                for (const ram of rampart) {
                    if (memory.rampart.includes(ram)) {
                        memory.rampart.splice(memory.rampart.indexOf(ram), 1);
                        count++;
                    }
                }
                console.log(`已从布局memory删除${count}个rampart`);
                return OK;
            }
        },
        wall(roomName: string, operate = 1) {
            const flag = Game.flags['layout-wall'];
            if (!flag) {
                console.log('未找到`layout-wall`旗帜标记');
                return -1;
            }
            const constructedWall = []
            if (flag.pos.lookFor(LOOK_STRUCTURES).filter((s) => s.structureType === STRUCTURE_WALL).length > 0) {
                constructedWall.push(compress(flag.pos.x, flag.pos.y));
                const queue = [[flag.pos.x, flag.pos.y]];
                const done = {}
                while (queue.length > 0) {
                    const pos = queue.shift();
                    const x = pos[0];
                    const y = pos[1];
                    if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                    const xy = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
                    for (const p of xy) {
                        const px = p[0];
                        const py = p[1];
                        if (px < 0 || px > 49 || py < 0 || py > 49) continue;
                        const pos1 = new RoomPosition(px, py, flag.pos.roomName);
                        if (!done[compress(px, py)] &&
                            pos1.lookFor(LOOK_STRUCTURES)
                                .filter((s) => s.structureType === STRUCTURE_WALL).length > 0) {
                            constructedWall.push(compress(pos1.x, pos1.y));
                            queue.push([px, py]);
                        }
                    }
                    done[compress(x, y)] = true;
                }
            } else {
                console.log('`layout-wall`旗帜没有放置到wall上');
                return -1;
            }
            flag.remove();
            let count = 0;
            if (operate === 1) {
                const memory = Memory['LayoutData'][roomName];
                if (!memory.constructedWall) memory.constructedWall = [];
                for (const wall of constructedWall) {
                    if (!memory.constructedWall.includes(wall)) {
                        memory.constructedWall.push(wall);
                        count++;
                    }
                }
                console.log(`已添加${count}个wall到布局memory`);
                return OK;
            }
            else {
                const memory = Memory['LayoutData'][roomName];
                for (const wall of constructedWall) {
                    if (memory.constructedWall.includes(wall)) {
                        memory.constructedWall.splice(memory.constructedWall.indexOf(wall), 1);
                        count++;
                    }
                }
                console.log(`已从布局memory删除${count}个wall`);
                return OK;
            }
        },
        ramwall(roomName: string, operate = 1) {
            const flag = Game.flags['layout-ramwall'];
            if (!flag) {
                console.log('未找到`layout-ramwall`旗帜标记');
                return -1;
            }
            const rampart = []
            const constructedWall = []
            const queue = []
            if (flag.pos.lookFor(LOOK_STRUCTURES).every((s) =>
                s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART)) {
                console.log('`layout-ramwall`旗帜没有放置到wall或rampart上');
                return -1;
            }
            else if (flag.pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === STRUCTURE_WALL)) {
                constructedWall.push(compress(flag.pos.x, flag.pos.y));
                queue.push([flag.pos.x, flag.pos.y]);
            }
            else if (flag.pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === STRUCTURE_RAMPART)) {
                rampart.push(compress(flag.pos.x, flag.pos.y));
                queue.push([flag.pos.x, flag.pos.y]);
            }
            const done = {}
            while (queue.length > 0) {
                const pos = queue.shift();
                const x = pos[0];
                const y = pos[1];
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                const xy = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
                for (const p of xy) {
                    const px = p[0];
                    const py = p[1];
                    if (px < 0 || px > 49 || py < 0 || py > 49) continue;
                    const pos1 = new RoomPosition(px, py, flag.pos.roomName);
                    if (!done[compress(px, py)] &&
                        pos1.lookFor(LOOK_STRUCTURES)
                            .some((s) => s.structureType === STRUCTURE_WALL)) {
                        constructedWall.push(compress(pos1.x, pos1.y));
                        queue.push([px, py]);
                    } else if (!done[compress(px, py)] &&
                        pos1.lookFor(LOOK_STRUCTURES)
                            .some((s) => s.structureType === STRUCTURE_RAMPART)) {
                        rampart.push(compress(pos1.x, pos1.y));
                        queue.push([px, py]);
                    }
                }
                done[compress(x, y)] = true;
            }

            flag.remove();
            let wallcount = 0;
            let rampartcount = 0;
            if (operate === 1) {
                const memory = Memory['LayoutData'][roomName];
                if (!memory.constructedWall) memory.constructedWall = [];
                for (const wall of constructedWall) {
                    if (!memory.constructedWall.includes(wall)) {
                        memory.constructedWall.push(wall);
                        wallcount++;
                    }
                }
                if (!memory.rampart) memory.rampart = [];
                for (const ramp of rampart) {
                    if (!memory.rampart.includes(ramp)) {
                        memory.rampart.push(ramp);
                        rampartcount++;
                    }
                }
                console.log(`已添加${wallcount}个wall和${rampartcount}个rampart到布局memory`);
                return OK;
            }
            else {
                const memory = Memory['LayoutData'][roomName];
                for (const wall of constructedWall) {
                    if (memory.constructedWall.includes(wall)) {
                        memory.constructedWall.splice(memory.constructedWall.indexOf(wall), 1);
                        wallcount++;
                    }
                }
                for (const ramp of rampart) {
                    if (memory.rampart.includes(ramp)) {
                        memory.rampart.splice(memory.rampart.indexOf(ramp), 1);
                        rampartcount++;
                    }
                }
                console.log(`已从布局memory删除${wallcount}个wall和${rampartcount}个rampart`);
                return OK;
            }
        },
        ramarea(roomName: string, operate = 1) {
            const flagA = Game.flags['layout-ramA'];
            const flagB = Game.flags['layout-ramB'];
            if (!flagA || !flagB) {
                console.log('未找到flag');
                return ERR_INVALID_ARGS;
            }
            const room = Game.rooms[roomName];
            if (!room) return ERR_INVALID_ARGS;
            const minX = Math.min(flagA.pos.x, flagB.pos.x);
            const maxX = Math.max(flagA.pos.x, flagB.pos.x);
            const minY = Math.min(flagA.pos.y, flagB.pos.y);
            const maxY = Math.max(flagA.pos.y, flagB.pos.y);
            const rampart = room.lookForAtArea(LOOK_STRUCTURES, minY, minX, maxY, maxX, true)
                                .filter((s) => s.structure.structureType === STRUCTURE_RAMPART)
                                .map((s) => compress(s.x, s.y));
            let rampartcount = 0;
            if (operate === 1) {
                const memory = Memory['LayoutData'][roomName];
                if (!memory.rampart) memory.rampart = [];
                for (const ramp of rampart) {
                    if (!memory.rampart.includes(ramp)) {
                        memory.rampart.push(ramp);
                        rampartcount++;
                    }
                }
                console.log(`已添加${rampartcount}个rampart到布局memory`);
            } else {
                const memory = Memory['LayoutData'][roomName];
                if (!memory.rampart) memory.rampart = [];
                for (const ramp of rampart) {
                    if (memory.rampart.includes(ramp)) {
                        memory.rampart.splice(memory.rampart.indexOf(ramp), 1);
                        rampartcount++;
                    }
                }
                console.log(`已从布局memory删除${rampartcount}个rampart`);
            }
            flagA.remove();
            flagB.remove();
            return OK;
        }
    }
}
