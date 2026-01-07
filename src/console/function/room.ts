import { signConstant } from "@/constant/SignConstant";

// 房间控制
export default {
    room: {
        // 添加房间
        add(roomName: string, layout?: string, x?: number, y?: number) {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');

            const BotMemRooms =  Memory['RoomControlData'];
            if(!BotMemRooms[roomName]) BotMemRooms[roomName] = {} as any;
            if(!BotMemRooms[roomName]['mode']) {
                BotMemRooms[roomName]['mode'] = 'main';
            }
            global.log(`已添加房间${roomName}。`);
            if(layout) {
                BotMemRooms[roomName]['layout'] = layout;
                global.log(`已设置 ${roomName} 的布局为 ${layout}。`);
            }
            if(x && y) {
                BotMemRooms[roomName]['center'] = {x, y};
                global.log(`已设置 ${roomName} 的布局中心为 (${x},${y})。`);
            } else {
                let PosFlag = Game.flags.storagePos || Game.flags.centerPos;
                if(PosFlag && PosFlag.room.name === roomName) {
                    BotMemRooms[roomName]['center'] = {x: PosFlag.pos.x, y: PosFlag.pos.y};
                    global.log(`已设置 ${roomName} 的布局中心为 (${PosFlag.pos.x},${PosFlag.pos.y})。`);
                }
            }
            Game.rooms[roomName].init();
            return OK;
        },
        // 删除房间
        remove(roomName: string) {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');
            let room = Game.rooms[roomName];
            if (room && room.my && room.level >= 6 && !Game.flags[`remove-${roomName}`]) {
                return Error(`房间 ${roomName} 等级大于等于6, 为避免误删除, 请放置一个名为 "remove-${roomName}" 的flag来确认删除。`);
            }
            if (Game.flags[`remove-${roomName}`]) Game.flags[`remove-${roomName}`].remove();

            delete Memory['rooms'][roomName];
            delete Memory['RoomControlData'][roomName];
            delete Memory['StructControlData'][roomName];
            delete Memory['LayoutData'][roomName];
            delete Memory['OutMineData'][roomName];
            delete Memory['AutoData']['AutoMarketData'][roomName];
            delete Memory['AutoData']['AutoLabData'][roomName];
            delete Memory['AutoData']['AutoFactoryData'][roomName];
            delete Memory['ResourceManage'][roomName];
            delete Memory['MissionPools'][roomName];
            global.log(`已从控制列表删除房间${roomName}并清空相关Memory。`);
            return OK;
        },
        // 查看房间列表
        list() {
            global.log(`房间控制列表：${Object.keys(Memory['RoomControlData']).join('、')}`);
            return OK;
        },
        // 设置房间模式
        mode(roomName: string, mode: string='main') {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');
            if (!['main', 'stop', 'low'].includes(mode)) return Error('仅支持main、stop、low模式。');

            const room = Game.rooms[roomName];
            const BotMemRooms =  Memory['RoomControlData'];
            if(!room || !room.my || !BotMemRooms[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            BotMemRooms[roomName]['mode'] = mode;
            global.log(`已设置 ${roomName} 的运行模式为 ${mode}。`);
            return OK;
        },
        // 设置房间中心
        setcenter(roomName: string, x: number, y: number) {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');

            const room = Game.rooms[roomName];
            const BotMemRooms = Memory['RoomControlData'];
            if(!room || !room.my || !BotMemRooms[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            BotMemRooms[roomName].center = { x, y };
            global.log(`已设置 ${roomName} 的布局中心为 (${x},${y})。`);
            return OK;
        },
        defendmode(roomName: string, mode: number=0) {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');

            const room = Game.rooms[roomName];
            const BotMemRooms = Memory['RoomControlData'];
            if(!room || !room.my || !BotMemRooms[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            BotMemRooms[roomName]['defend_mode'] = mode;
            global.log(`已设置 ${roomName} 的防御模式为 ${mode}。`);
            return OK;
        },
        // 设置签名
        sign(roomName: string, text?: string) {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');

            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                return Error(`房间 ${roomName} 不存在或未拥有。`);
            }
            const botMem = Memory['RoomControlData'][roomName];
            botMem['sign'] = text ?? signConstant[Math.floor(Math.random() * signConstant.length)];
            global.log(`已设置 ${roomName} 的房间签名为:\n ${text}`);
            return OK;
        },
        // 设置刷墙上限
        setram(roomName: string, hits: number) {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');

            if (hits <= 0) {
                console.log(`输入的数值必须大于0.`);
                return -1;
            }

            const botMem = Memory['StructControlData'][roomName];
            if (hits <= 1) {
                botMem['ram_threshold'] = hits;
                console.log(`已设置 ${roomName} 的刷墙上限比例为 ${hits}。`);
            } else {
                botMem['ram_threshold'] = hits / 3e8;
                console.log(`已设置 ${roomName} 的刷墙上限比例为 ${hits / 3e8}。`);
            }
            return OK;
        },
        // 添加发送任务
        send(roomName: string, targetRoom: string, type: string, amount: number) {
            if (!roomName.match(/^[EW][1-9]+[NS][1-9]+$/)) return Error(`房间名格式不正确。`);
            if (!targetRoom.match(/^[EW][1-9]+[NS][1-9]+$/)) return Error(`目标房间名格式不正确。`);
            const RESOURCE_ABBREVIATIONS = global.BaseConfig.RESOURCE_ABBREVIATIONS;
            type = RESOURCE_ABBREVIATIONS[type] || type;
            if (!RESOURCES_ALL.includes(type as ResourceConstant)) return Error(`资源类型不正确。`);
            if (typeof amount !== 'number') return Error(`数量必须是数字。`);
            if (amount <= 0) return Error(`数量必须大于0。`);
            
            const room = Game.rooms[roomName];
            room.SendMissionAdd(targetRoom, type, amount);
            global.log(`[任务模块] 在房间 ${room.name} 添加了发送任务: ${amount} ${type} -> ${targetRoom} `);
            return OK;
        }
    },
}

