/**
 * 房间控制
 */
import { getMissionPools, getRoomData } from '@/modules/utils/memory';

export const roomRunner = function (room: Room) {
    // 定期更新建筑缓存
    if (Game.time % 10 === 0) room.update();

    // 只运行自己的房间
    if (!room || !room.controller?.my) return;
    // 不运行未加入控制列表的房间
    const roomMem = getRoomData(room.name);
    if (!roomMem) return;
    if ((roomMem as any).mode === 'stop') return;

    if (Game.time % 100 == 0) {
        room.memory['index'] = Math.floor(Math.random() * 100); // 0-99
    }

    // 初始化
    const pools = getMissionPools();
    if (!pools[room.name]) room.initMissionPool();
    else if (!global.CreepNum[room.name]) {
        global.CreepNum[room.name] = {};
        global.SpawnMissionNum[room.name] = {};
    }
    
    // 房间运行
    room.exec();
}
