/**
 * 房间相关 Memory 清理
 * @description 用于房间被移出控制列表或失去控制权后，级联清理所有与房间维度绑定的 Memory 数据。
 */
export const clearRoomRelatedMemory = (roomName: string) => {
    if (!roomName) return;

    if (Memory.rooms) delete Memory.rooms[roomName];
    if (Memory['RoomControlData']) delete Memory['RoomControlData'][roomName];
    if (Memory['StructControlData']) delete Memory['StructControlData'][roomName];
    if (Memory['LayoutData']) delete Memory['LayoutData'][roomName];
    if (Memory['OutMineData']) delete Memory['OutMineData'][roomName];
    if (Memory['ResourceManage']) delete Memory['ResourceManage'][roomName];
    if (Memory['MissionPools']) delete Memory['MissionPools'][roomName];

    const auto = Memory['AutoData'] as any;
    if (auto?.AutoMarketData) delete auto.AutoMarketData[roomName];
    if (auto?.AutoLabData) delete auto.AutoLabData[roomName];
    if (auto?.AutoFactoryData) delete auto.AutoFactoryData[roomName];
    if (auto?.AutoPowerData) delete auto.AutoPowerData[roomName];
};
