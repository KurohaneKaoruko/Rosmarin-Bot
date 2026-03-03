import { signConstant } from "@/constant/NameConstant";
import { BASE_CONFIG } from "@/constant/config";
import { clearRoomRelatedMemory } from "@/modules/utils/roomMemory";
import { ensureRoomData, getRoomData, getStructData } from "@/modules/utils/memory";
import { parseShardRoomName } from "@/modules/infra/shardRoom";

// 房间控制
export default {
    room: {
        // 快速开始
        start(roomName: string, layout?: string) {
            // 添加房间
            if (!layout) global.room.add(roomName);
            else {
                const centerPos = Game.flags['centerPos']?.pos;
                if (!centerPos || centerPos.roomName !== roomName) {
                    return Error('未设置中心, 请将centerPos放置到需要设置的布局中心位置。')
                } else {
                    global.room.add(roomName, layout);
                }
            }
            // 构建布局
            global.layout.build(roomName);
            // 开启自动建造
            global.layout.auto(roomName, true);
            return OK;
        },
        // 添加房间
        add(roomName: string, layout?: string, x?: number, y?: number) {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');

            const roomMem = ensureRoomData(roomName) as any;
            if(!roomMem['mode']) {
                roomMem['mode'] = 'main';
            }
            global.log(`已添加房间${roomName}。`);
            if(layout) {
                roomMem['layout'] = layout;
                global.log(`已设置 ${roomName} 的布局为 ${layout}。`);
            }
            if(x && y) {
                roomMem['center'] = {x, y};
                global.log(`已设置 ${roomName} 的布局中心为 (${x},${y})。`);
            } else {
                let PosFlag = Game.flags.storagePos || Game.flags.centerPos;
                if(PosFlag && PosFlag.room.name === roomName) {
                    roomMem['center'] = {x: PosFlag.pos.x, y: PosFlag.pos.y};
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
            clearRoomRelatedMemory(roomName);
            global.log(`已从控制列表删除房间${roomName}并清空相关Memory。`);
            return OK;
        },
        // 查看房间列表
        list() {
            global.log(`房间控制列表：${Object.keys(getRoomData()).join('、')}`);
            return OK;
        },
        // 设置房间模式
        mode(roomName: string, mode: 'main' | 'low' | 'high' | 'stop' = 'main') {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');
            if (!['main', 'stop', 'low', 'high'].includes(mode)) return Error('仅支持main、stop、low、high模式。');

            const room = Game.rooms[roomName];
            const BotMemRooms =  getRoomData();
            if(!room || !room.my || !BotMemRooms[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            BotMemRooms[roomName]['mode'] = mode;
            global.log(`已设置 ${roomName} 的运行模式为 ${mode}。`);
            return OK;
        },
        // 通用前期冲刺模式：优先核心建筑 + 加速升级
        rush(roomName: string, on?: boolean, maxRcl?: number) {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');
            if (maxRcl !== undefined) {
                if (!Number.isFinite(maxRcl) || maxRcl < 1 || maxRcl > 8) {
                    return Error('maxRcl 必须是 1~8 的数字。');
                }
            }

            const room = Game.rooms[roomName];
            const BotMemRooms = getRoomData();
            if (!room || !room.my || !BotMemRooms[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }

            const roomMem = BotMemRooms[roomName] as any;
            const current = roomMem.devRush ?? roomMem.rcl3Rush;
            const next = on === undefined ? !current : !!on;
            const nextMaxRcl = Math.max(1, Math.min(8, Math.floor(maxRcl ?? roomMem.devRushMaxRcl ?? 3)));
            roomMem.devRush = next;
            roomMem.devRushMaxRcl = nextMaxRcl;
            // backward-compat for old logic/data
            roomMem.rcl3Rush = next;
            if (next && roomMem.mode === 'low') roomMem.mode = 'high';

            global.log(`已设置 ${roomName} 的前期冲刺模式为 ${next ? '开启' : '关闭'}（maxRcl=${nextMaxRcl}）。`);
            return OK;
        },
        // 设置房间中心
        setcenter(roomName: string, x: number, y: number) {
            if (!roomName) return Error('请输入房间名。');
            if (!roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('房间名格式不正确。');

            const room = Game.rooms[roomName];
            const BotMemRooms = getRoomData();
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
            const BotMemRooms = getRoomData();
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
            const rooms = getRoomData();
            if (!rooms[roomName]) {
                return Error(`房间 ${roomName} 未添加到控制列表。`);
            }
            const botMem = rooms[roomName] as any;
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

            const botMem = getStructData(roomName) as any;
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
            const RESOURCE_ABBREVIATIONS = BASE_CONFIG.RESOURCE_ABBREVIATIONS;
            type = RESOURCE_ABBREVIATIONS[type] || type;
            if (!RESOURCES_ALL.includes(type as ResourceConstant)) return Error(`资源类型不正确。`);
            if (typeof amount !== 'number') return Error(`数量必须是数字。`);
            if (amount <= 0) return Error(`数量必须大于0。`);
            
            const room = Game.rooms[roomName];
            room.SendMissionAdd(targetRoom, type, amount);
            global.log(`[任务模块] 在房间 ${room.name} 添加了发送任务: ${amount} ${type} -> ${targetRoom} `);
            return OK;
        },
        // 迁移房间归属：将属于 roomName 的 creep home/homeRoom 修改为 targetRoom
        jump(roomName: string, targetRoom: string) {
            if (!roomName) return Error('请输入源房间名。');
            if (!targetRoom) return Error('请输入目标房间名。');

            const fromSpec = parseShardRoomName(roomName);
            const toSpec = parseShardRoomName(targetRoom);
            if (!fromSpec.roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('源房间名格式不正确。');
            if (!toSpec.roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('目标房间名格式不正确。');

            let changed = 0;
            let matched = 0;
            for (const name in Game.creeps) {
                const creep = Game.creeps[name];
                const mem = creep.memory as any;
                const localHome = mem.home ? parseShardRoomName(mem.home).roomName : undefined;
                const localHomeRoom = mem.homeRoom ? parseShardRoomName(mem.homeRoom).roomName : undefined;
                if (localHome !== fromSpec.roomName && localHomeRoom !== fromSpec.roomName) continue;

                matched++;
                mem.home = targetRoom;
                mem.homeRoom = toSpec.roomName;
                // clear stale source lock after room migration
                delete mem.targetSourceId;
                if (mem.cache && typeof mem.cache === 'object') delete mem.cache.targetSourceId;
                if (mem.cacheSource && typeof mem.cacheSource === 'object') {
                    delete mem.cacheSource.targetId;
                    delete mem.cacheSource.targetType;
                }
                changed++;
            }

            global.log(`[RoomJump] ${fromSpec.roomName} -> ${targetRoom}，匹配 ${matched}，修改 ${changed}`);
            return OK;
        }
    },
}
