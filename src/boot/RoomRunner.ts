/**
 * 房间控制
 */
export const roomRunner = function (room: Room) {
    // 定期更新建筑缓存
    let updateInterval = 100;
    // 如果有工地，更新频率提高
    if (room.find(FIND_CONSTRUCTION_SITES).length > 0) updateInterval = 20;
    // 低等级房间更新频率较高
    else if (room.level < 8) updateInterval = 50;
    
    if (Game.time % updateInterval == 0) room.update();

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
