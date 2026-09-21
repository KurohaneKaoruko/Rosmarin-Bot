/**
 * 房间控制
 */
import { isRoomTickAligned } from '@/shared/roomPhase';
import roomConsole from '@/console/function/room';
import layoutConsole from '@/console/function/layout';
import { getAutoData, getMissionPools, getRoomData } from '@/shared/memory';
import { shouldAutoStartFirstRoom } from '@/shared/bootstrap';

export const roomRunner = function (room: Room) {
    if (!room) return;

    // 更新建筑缓存(对所有有视野的房间)——叠加房间相位错峰，多房不同 tick 重建
    if (isRoomTickAligned(room.name, 10)) room.update();

    // 只运行自己的房间
    if (!room.my) return;

    let roomMem = getRoomData(room.name) as any;
    if (!roomMem) {
        const roomAutoStart = getAutoData().RoomAutoStart;
        if (shouldAutoStartFirstRoom()) {
            // 落地自启：有效房间（在列表且属于自己的）为 0、拥有房间为 1 时，
            // 视为落地后的首个房间，按默认参数（auto 布局 / main 模式）自动 start；
            // 需要自定义参数时，启动后再用 room.mode / layout.set 等调整即可。
            // start 静默执行，这里只输出一行汇总。
            roomConsole.room.start(room.name, undefined, { quiet: true });
            roomMem = getRoomData(room.name) as any;
            const center = roomMem?.center;
            global.log(
                `[auto] 首个己方房间 ${room.name} 已自动启动：布局 ${roomMem?.layout || 'auto'}` +
                `${center ? `，中心 (${center.x},${center.y})` : ''}（默认参数运行，可随时调整）。`,
            );
        } else if (roomAutoStart) {
            roomConsole.room.add(room.name, roomAutoStart.layout);
            roomConsole.room.mode(room.name, roomAutoStart.mode);
            layoutConsole.layout.build(room.name, roomAutoStart.layout);
            layoutConsole.layout.auto(room.name, true);
        } else {
            return;
        }

        roomMem = getRoomData(room.name) as any;
        if (!roomMem) return;
    }

    if (!(roomMem?.mode)) roomMem.mode = 'main';
    if (roomMem.mode === 'stop') return;

    const roomMemory = room.memory as any;
    if (!roomMemory._init) {
        if (typeof room.init === 'function') {
            room.init();
        }
        roomMemory._init = true;
    }

    if (Game.time % 100 == 0) {
        room.memory['index'] = Math.floor(Math.random() * 100); // 0-99
    }

    // 初始化
    const pools = getMissionPools();
    if (!pools[room.name]) room.initMissionPool();

    // 房间运行
    room.exec();
}
