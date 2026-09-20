/**
 * 房间控制
 */
import { isRoomTickAligned } from '@/shared/roomPhase';
import roomConsole from '@/console/function/room';
import layoutConsole from '@/console/function/layout';
import { getAutoData, getMissionPools, getRoomData } from '@/shared/memory';

export const roomRunner = function (room: Room) {
    if (!room) return;

    // 更新建筑缓存(对所有有视野的房间)——叠加房间相位错峰，多房不同 tick 重建
    if (isRoomTickAligned(room.name, 10)) room.update();

    // 只运行自己的房间
    if (!room.my) return;

    let roomMem = getRoomData(room.name) as any;
    if (!roomMem) {
        const roomAutoStart = getAutoData().RoomAutoStart;
        if (!roomAutoStart) return;

        roomConsole.room.add(room.name, roomAutoStart.layout);
        roomConsole.room.mode(room.name, roomAutoStart.mode);
        layoutConsole.layout.build(room.name, roomAutoStart.layout);
        layoutConsole.layout.auto(room.name, true);

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
