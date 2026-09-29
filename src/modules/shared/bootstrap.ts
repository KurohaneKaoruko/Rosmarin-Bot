/**
 * 落地自启判定：
 * - 有效房间：已加入控制列表且属于自己的房间；
 * - 有效房间为 0 且拥有房间为 1 → 视为落地后的首个房间，自动按默认参数启动运行。
 *   （重生/重置后残留的控制列表条目因无视野无法确认归属，不计入有效房间，
 *     因此重生到新房间时同样会自动启动。）
 *
 * 判定实时计算（调用方少、成本低），不引入额外缓存。
 */
import { getRoomData } from '@/modules/shared/memory';

export const shouldAutoStartFirstRoom = (): boolean => {
    let ownedCount = 0;
    for (const room of Object.values(Game.rooms)) {
        if (room && room.controller && room.controller.my) ownedCount++;
    }
    if (ownedCount !== 1) return false;

    let validCount = 0;
    for (const name of Object.keys(getRoomData())) {
        const room = Game.rooms[name];
        if (room && room.controller && room.controller.my) validCount++;
    }
    return validCount === 0;
};
