// 跨房到位判定：位于目标房且不在房缘；房缘不算到位，防止边界抖动。
export const isArrivedInRoom = (creep: Creep, roomName: string | undefined | null): boolean =>
    !!roomName && creep.room.name === roomName && !creep.pos.isRoomEdge();
