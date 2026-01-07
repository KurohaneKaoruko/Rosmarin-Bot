/**
 * 房间控制
 */
export const roomControl = function (room: Room) {
    // 定期更新建筑缓存
    if (Game.time % 50 == 0) room.update();

    // 只运行自己的房间
    if (!room || !room.controller?.my) return;
    // 不运行未加入控制列表的房间
    if (!Memory['RoomControlData'][room.name]) return;

    if (Game.time % 100 == 0) {
        room.memory['index'] = Math.floor(Math.random() * 100); // 0-99
    }

    // 初始化
    if (!Memory.MissionPools[room.name]) room.initMissionPool();
    else if (!global.CreepNum[room.name]) {
        global.CreepNum[room.name] = {};
        global.SpawnMissionNum[room.name] = {};
    }
    
    // 房间运行
    room.exec();
}