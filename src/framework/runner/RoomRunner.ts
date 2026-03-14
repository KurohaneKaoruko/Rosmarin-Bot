/**
 * 房间控制
 */
import roomConsole from '@/console/function/room';
import layoutConsole from '@/console/function/layout';
import { getAutoData, getMissionPools, getRoomData } from '@/modules/utils/memory';

export const roomRunner = function (room: Room) {
    if (!room) return;

    // 只运行自己的房间
    if (!room.controller?.my) return;

    let roomMem = getRoomData(room.name) as any;
    if (!roomMem) {
        const roomAutoStart = (getAutoData() as any).RoomAutoStart as AutoDataMemory['RoomAutoStart'] | undefined;
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

    // 定期更新建筑缓存
    if (Game.time % 10 === 0) room.update();

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
