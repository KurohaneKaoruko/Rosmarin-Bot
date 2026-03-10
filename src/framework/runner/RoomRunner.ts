/**
 * 房间控制
 */
import { ensureRoomData, getMissionPools } from '@/modules/utils/memory';

export const roomRunner = function (room: Room) {
    // 定期更新建筑缓存
    if (Game.time % 10 === 0) room.update();

    // 只运行自己的房间
    if (!room || !room.controller?.my) return;
    // 默认按 main 运行，只有显式 stop 才停止
    const roomMem = ensureRoomData(room.name) as any;
    if (!(roomMem?.mode)) roomMem.mode = 'main';
    if (roomMem.mode === 'stop') return;

    const roomMemory = room.memory as any;
    if (!roomMemory._init) {
        room.init();
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
