/**
 * 房间相关 Memory 清理
 * @description 用于房间被移出控制列表或失去控制权后，级联清理所有与房间维度绑定的 Memory 数据。
 */
import { getAutoData, getLayoutData, getMissionPools, getOutMineData, getResourceManage, getRoomData, getStructData } from '@/modules/utils/memory';

export const clearRoomRelatedMemory = (roomName: string) => {
    if (!roomName) return;

    if (Memory.rooms) delete Memory.rooms[roomName];
    const rooms = getRoomData();
    delete rooms[roomName];
    const structs = getStructData();
    delete structs[roomName];
    const layouts = getLayoutData();
    delete layouts[roomName];
    const outMine = getOutMineData();
    delete outMine[roomName];
    const resource = getResourceManage();
    delete resource[roomName];
    const pools = getMissionPools();
    delete pools[roomName];

    const auto = getAutoData() as any;
    if (auto?.AutoMarketData) delete auto.AutoMarketData[roomName];
    if (auto?.AutoLabData) delete auto.AutoLabData[roomName];
    if (auto?.AutoFactoryData) delete auto.AutoFactoryData[roomName];
    if (auto?.AutoPowerData) delete auto.AutoPowerData[roomName];
};
