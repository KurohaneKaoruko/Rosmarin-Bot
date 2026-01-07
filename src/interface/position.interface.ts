interface RoomPosition {
    // 切比雪夫距离
    getDistance(pos: RoomPosition): number;
    // 是否位置相同
    isEqual(pos: RoomPosition): boolean;
    // 是否相邻
    isNear(pos: RoomPosition): boolean;
    // 是否在指定距离内
    inRange(target: any, range: number): boolean;
    // 是否位于房间边界
    isRoomEdge(): boolean;
    // 该位置是否可通行, 无视野根据terrain判定
    walkable(withCreep?: boolean, rampartOwnerUserName?: string): boolean
    // 转为全局坐标
    toGlobal(): { x: number, y: number };
    // 该位置是否有rampart
    coverRampart(): boolean;
    /**
     * 获取房间坐标
     */
    getRoomCoordinate(): { x: number, y: number };
    /**
     * 跨房是否相邻
     */
    isCrossRoomNearTo(other: RoomPosition): boolean;
    /**
     * 跨房间的两点之间的距离
     */
    crossRoomGetRangeTo(other: RoomPosition): number 
    /**
     * 判断爬是否在房间边缘附近
     */
    isNearEdge(range: number): boolean;
    /**
     * 返回范围内的 posList，不包括自己
     */
    nearPos(range?: number): RoomPosition[];
    /**
     * 减去另一个坐标
     */
    crossRoomSubPos(other: RoomPosition): { x: number, y: number };
    /**
     * 获得 direction 的方向 的 RoomPosition, 会得到跨房的点
     * @param direction 方向
     * @returns
     */
    getDirectPos(direction: DirectionConstant): RoomPosition;
    /**
     * 获取 RoomPosition 的哈希值
     */
    hashCode (): number;
    /**
     * 获取 RoomPosition 在房间内的哈希值
     */
    hashCodeInRoom(): number;
    /**
     * 获取pos相邻某个方向上的点
     * @param direction 方向
     * @returns 
     */
    getAdjacentPos(direction: DirectionConstant): RoomPosition
    /**
     * 获取相邻点的方向
     * @param toPos 目标位置
     */
    getDirection(toPos: RoomPosition): DirectionConstant
}