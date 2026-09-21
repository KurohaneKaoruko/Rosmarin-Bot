import { signConstant } from "@/constant/NameConstant";
import { BASE_CONFIG } from "@/constant/config";
import { clearRoomRelatedMemory, ensureRoomData, getAutoData, getRoomData, getStructData } from "@/shared/memory";
import { parseShardRoomName } from "@/shared/shardRoom";
import { clearMemoryCache } from "@/prototype/Creep/function/cacheFunction";
import { ROOM_NAME_SOURCE_TEXT, resolveRoomName } from "@/console/argUtils";

// 动态布局（无需布局中心）
const DYNAMIC_LAYOUT_SET = new Set(['auto', '63auto', 'scorpior']);
const ROOM_MODE_SET = ['main', 'stop', 'low', 'high', 'rush'];

// 房间控制
export default {
    room: {
    /**
     * 快速启动：一条指令完成「加入控制列表 → 构建布局 → 开启自动建筑」。
     *
     * 两个参数都可以省略：
     * - start()               自动推断房间（旗帜 > 唯一未托管房 > 唯一己方房），使用自动布局
     * - start('W1N1')         指定房间，使用自动布局（或沿用已配置布局）
     * - start('W1N1','clover')指定房间 + 静态布局（需 centerPos 旗帜标记布局中心）
     */
    start(roomName?: string, layout?: string) {
        // ── 1. 房间推断 ──
        const resolved = resolveRoomName(roomName);
        if (!resolved.roomName) return resolved.error;
        const target = resolved.roomName;

        // ── 2. 布局确定：显式传入 > 房间已有配置 > auto ──
        const layoutName = layout || (getRoomData(target) as any)?.layout || 'auto';

        // ── 3. 静态布局必须有中心（旗帜标记）──
        const centerFlag = Game.flags.centerPos;
        if (!DYNAMIC_LAYOUT_SET.has(layoutName) &&
            (!centerFlag || centerFlag.pos.roomName !== target)) {
            return Error(
                `使用静态布局 ${layoutName} 需要布局中心：请将名为 centerPos 的旗帜放到 ${target} 的布局中心（storage 位置），` +
                `或改用自动布局 start('${target}')。`,
            );
        }

        // ── 4. 依次执行启动流程 ──
        global.room.add(target, layoutName);
        const buildResult = global.layout.build(target, layoutName);
        if (buildResult !== OK && buildResult !== undefined) {
            return Error(`${target} 布局构建失败（${buildResult}），可手动执行 layout.build('${target}', '${layoutName}') 重试。`);
        }
        global.layout.auto(target, true);

        // ── 5. 启动摘要与后续提示 ──
        const roomMem = getRoomData(target) as any;
        const center = roomMem?.center;
        global.log(
            `[start] ${target} 启动完成：布局 ${layoutName}${center ? `，中心 (${center.x},${center.y})` : ''}，自动建筑已开启。`,
        );
        if (resolved.source && resolved.source !== 'explicit') {
            global.log(`[start] 未指定房间名，已自动选择（${ROOM_NAME_SOURCE_TEXT[resolved.source]}）。`);
        }
        global.log(
            `[start] 接下来可以：mine.addarea('${target}') 挂载周边外矿 / room.auto() 开启新占领房自动托管 / helpRoom 查看全部指令。`,
        );
        return OK;
    },
    // 添加房间到控制列表（roomName 可省略，推断规则同 start）
    add(roomName?: string, layout?: string, x?: number, y?: number) {
        const resolved = resolveRoomName(roomName);
        if (!resolved.roomName) return resolved.error;
        const target = resolved.roomName;

        const roomMem = ensureRoomData(target) as any;
        if (!roomMem['mode']) {
            roomMem['mode'] = 'main';
        }
        global.log(`已将房间 ${target} 加入控制列表。`);
        if (layout) {
            roomMem['layout'] = layout;
            global.log(`已设置 ${target} 的布局为 ${layout}。`);
        }
        if (x && y) {
            roomMem['center'] = { x, y };
            global.log(`已设置 ${target} 的布局中心为 (${x},${y})。`);
        } else {
            let PosFlag = Game.flags.storagePos || Game.flags.centerPos;
            if (PosFlag && PosFlag.room.name === target) {
                roomMem['center'] = { x: PosFlag.pos.x, y: PosFlag.pos.y };
                global.log(`已设置 ${target} 的布局中心为 (${PosFlag.pos.x},${PosFlag.pos.y})。`);
            }
        }
        const room = Game.rooms[target];
        if (room?.my && typeof room.init === 'function') {
            room.init();
            (room.memory as any)._init = true;
        }
        return OK;
    },
    // 开关新占领房间自动接管
    auto(
        enable: boolean = true,
        mode: 'main' | 'low' | 'high' | 'rush' = 'main',
        layout: 'auto' | '63auto' | 'scorpior' = 'auto'
    ) {
        const auto = getAutoData() as any;
        if (!enable) {
            delete auto.RoomAutoStart;
            global.log(`已关闭新占领房间自动托管。`);
            return OK;
        }
        if (!['main', 'low', 'high', 'rush'].includes(mode)) {
            return Error('自动托管默认模式仅支持 main、low、high、rush。');
        }
        if (!['auto', '63auto', 'scorpior'].includes(layout)) {
            return Error('自动托管仅支持 auto、63auto、scorpior 三种自动布局。');
        }

        auto.RoomAutoStart = {
            mode,
            layout,
        };
        global.log(`已开启新占领房间自动托管：mode=${mode} layout=${layout}`);
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
    // 查看房间列表（含模式/布局/中心/自动建筑状态）
    list() {
        const rooms = getRoomData();
        const names = Object.keys(rooms);
        if (names.length === 0) {
            global.log('房间控制列表：空。使用 start() 一键启动，或 room.add(roomName) 手动添加。');
            return OK;
        }
        const lines = names.map(name => {
            const cfg = rooms[name] as any;
            const bits: string[] = [];
            if (cfg.mode) bits.push(`模式 ${cfg.mode}`);
            if (cfg.layout) bits.push(`布局 ${cfg.layout}`);
            if (cfg.center) bits.push(`中心 (${cfg.center.x},${cfg.center.y})`);
            if (cfg.autobuild) bits.push('自动建筑 ✔');
            const room = Game.rooms[name];
            if (room && room.my) bits.push(`RCL${room.level}`);
            return `- ${name}${bits.length ? '：' + bits.join(' | ') : ''}`;
        });
        global.log(`房间控制列表（${names.length} 个）：\n${lines.join('\n')}`);
        return OK;
    },
    // 设置房间模式（roomName 可省略；也支持 room.mode('high') 单参数写法）
    mode(roomName?: string, mode: 'main' | 'low' | 'high' | 'stop' | 'rush' = 'main') {
        // 单参数写法：room.mode('high') / room.mode('rush')
        if (roomName && ROOM_MODE_SET.includes(roomName)) {
            mode = roomName as any;
            roomName = undefined;
        }
        if (!ROOM_MODE_SET.includes(mode)) return Error(`仅支持 ${ROOM_MODE_SET.join('、')} 模式。`);

        const resolved = resolveRoomName(roomName);
        if (!resolved.roomName) return resolved.error;

        const room = Game.rooms[resolved.roomName];
        if (!room || !room.my) {
            return Error(`房间 ${resolved.roomName} 不存在或未拥有。`);
        }
        const roomMem = ensureRoomData(resolved.roomName) as any;
        roomMem['mode'] = mode;
        global.log(`已设置 ${resolved.roomName} 的运行模式为 ${mode}。`);
        return OK;
    },
    // 设置房间中心（roomName/x/y 均可省略：用 centerPos/storagePos 旗帜定位）
    setcenter(roomName?: string, x?: number, y?: number) {
        const resolved = resolveRoomName(roomName);
        if (!resolved.roomName) return resolved.error;
        const target = resolved.roomName;

        const room = Game.rooms[target];
        if (!room || !room.my) {
            return Error(`房间 ${target} 不存在或未拥有。`);
        }

        let cx = x;
        let cy = y;
        if (typeof cx !== 'number' || typeof cy !== 'number') {
            const flag = Game.flags.centerPos || Game.flags.storagePos;
            if (flag && flag.pos.roomName === target) {
                cx = flag.pos.x;
                cy = flag.pos.y;
            } else {
                return Error(
                    `需要布局中心坐标，或将 centerPos / storagePos 旗帜放到 ${target} 内：` +
                    `room.setcenter('${target}', x, y)`,
                );
            }
        }

        const roomMem = ensureRoomData(target) as any;
        roomMem['center'] = { x: cx, y: cy };
        global.log(`已设置 ${target} 的布局中心为 (${cx},${cy})。`);
        return OK;
    },
    // 设置防御模式（roomName 可省略；也支持 room.defendmode(2) 单参数写法）
    defendmode(roomName?: string | number, mode: number = 0) {
        // 单参数写法：room.defendmode(1)
        if (typeof roomName === 'number') {
            mode = roomName;
            roomName = undefined;
        }

        const resolved = resolveRoomName(roomName as string | undefined);
        if (!resolved.roomName) return resolved.error;

        const room = Game.rooms[resolved.roomName];
        if (!room || !room.my) {
            return Error(`房间 ${resolved.roomName} 不存在或未拥有。`);
        }
        const roomMem = ensureRoomData(resolved.roomName) as any;
        roomMem['defend_mode'] = mode;
        global.log(`已设置 ${resolved.roomName} 的防御模式为 ${mode}。`);
        return OK;
    },
    // 设置签名（roomName 可省略；text 省略时随机挑一条）
    sign(roomName?: string, text?: string) {
        const resolved = resolveRoomName(roomName);
        if (!resolved.roomName) return resolved.error;

        const room = Game.rooms[resolved.roomName];
        if (!room || !room.my) {
            return Error(`房间 ${resolved.roomName} 不存在或未拥有。`);
        }
        const applied = text ?? signConstant[Math.floor(Math.random() * signConstant.length)];
        const botMem = ensureRoomData(resolved.roomName) as any;
        botMem['sign'] = applied;
        global.log(`已设置 ${resolved.roomName} 的房间签名为:\n ${applied}`);
        return OK;
    },
    // 设置刷墙上限（roomName 可省略；0-1 为比例，>1 按 hits/3e8 折算）
    setram(roomName?: string, hits?: number) {
        const resolved = resolveRoomName(roomName);
        if (!resolved.roomName) return resolved.error;

        if (typeof hits !== 'number' || !(hits > 0)) {
            return Error('请输入大于 0 的数值：0~1 之间按比例使用，大于 1 时按 hits/3e8 折算为比例。');
        }

        const botMem = getStructData(resolved.roomName) as any;
        const ratio = hits <= 1 ? hits : hits / 3e8;
        botMem['ram_threshold'] = ratio;
        global.log(`已设置 ${resolved.roomName} 的刷墙上限比例为 ${ratio}。`);
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
    // 迁移房间归属：将属于 roomName 的 creep home/homeRoom/sourceRoom 修改为 targetRoom
    jump(roomName: string, targetRoom: string) {
        if (!roomName) return Error('请输入源房间名。');
        if (!targetRoom) return Error('请输入目标房间名。');

        const fromSpec = parseShardRoomName(roomName);
        const toSpec = parseShardRoomName(targetRoom);
        if (!fromSpec.roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('源房间名格式不正确。');
        if (!toSpec.roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error('目标房间名格式不正确。');

        let changed = 0;
        let matched = 0;
        const clearRoomLocalCache = (mem: any) => {
            // 清理跨房后容易失效的临时缓存/路径，避免继续追旧目标卡边缘
            clearMemoryCache(mem);
            delete mem._moveToRoomState;
        };

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            const mem = creep.memory as any;
            const localHome = mem.home ? parseShardRoomName(mem.home).roomName : undefined;
            const localHomeRoom = mem.homeRoom ? parseShardRoomName(mem.homeRoom).roomName : undefined;
            const localSourceRoom = mem.sourceRoom ? parseShardRoomName(mem.sourceRoom).roomName : undefined;
            if (localHome !== fromSpec.roomName && localHomeRoom !== fromSpec.roomName && localSourceRoom !== fromSpec.roomName) continue;

            matched++;
            if (localHome === fromSpec.roomName) {
                mem.home = targetRoom;
            }
            if (localHomeRoom === fromSpec.roomName) {
                mem.homeRoom = toSpec.roomName;
            }
            if (localSourceRoom === fromSpec.roomName) {
                mem.sourceRoom = toSpec.roomName;
            }
            // clear stale source lock after room migration
            delete mem.targetSourceId;
            clearRoomLocalCache(mem);
            changed++;
        }

        global.log(`[RoomJump] ${fromSpec.roomName} -> ${targetRoom}，匹配 ${matched}，修改 ${changed}`);
        return OK;
    }
    },
};
