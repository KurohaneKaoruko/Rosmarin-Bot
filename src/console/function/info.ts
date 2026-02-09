import { showRoomInfo } from "@/modules/utils/showRoomInfo";
import { showFactoryInfo, showLabInfo } from "@/modules/utils/showProductionInfo";
import { showCraftableInfo } from "@/modules/utils/showCraftableInfo";
import { getRoomData } from "@/modules/utils/memory";

export default {
    info: {
        // 查看房间工作状态
        room(roomName?: string) {
            // 如果只查询单个房间且不存在，返回错误信息
            if (roomName) {
                const room = Game.rooms[roomName];
                if (!room || !room.my) return Error(`房间 ${roomName} 不存在或未拥有。`);
            }
            // 获取需要显示的房间名列表
            const roomNames = roomName ? [roomName] : Object.keys(getRoomData());
            return showRoomInfo(roomNames);
        },
        lab(roomName?: string) {
            if (roomName) {
                const room = Game.rooms[roomName];
                if (!room || !room.my) return Error(`房间 ${roomName} 不存在或未拥有。`);
            }
            const roomNames = roomName ? [roomName] : Object.keys(getRoomData());
            return showLabInfo(roomNames);
        },
        factory(roomName?: string) {
            if (roomName) {
                const room = Game.rooms[roomName];
                if (!room || !room.my) return Error(`房间 ${roomName} 不存在或未拥有。`);
            }
            const roomNames = roomName ? [roomName] : Object.keys(getRoomData());
            return showFactoryInfo(roomNames);
        },
        // 查看所有资源储量
        res() {
            return global.HelperRoomResource.showAllRes();
        },
        // 查看房间资源占用空间
        roomres() {
            return global.HelperRoomResource.showRoomRes();
        },
        craft() {
            return showCraftableInfo();
        },
    }
}
