/**
 * RoomPosition 扩展接口定义
 * @description 扩展 Screeps 原生 RoomPosition 类，提供更多实用方法
 */

interface RoomPosition {
    // ==================== 距离与位置判断 ====================
    
    /**
     * 计算切比雪夫距离（棋盘距离）
     * @description 计算两点之间的切比雪夫距离，即横纵坐标差的最大值
     * @param pos - 目标位置
     * @returns 切比雪夫距离，不同房间返回 Infinity
     * @example
     * const distance = creep.pos.getDistance(target.pos);
     * if (distance <= 3) creep.rangedAttack(target);
     */
    getDistance(pos: RoomPosition): number;

    /**
     * 判断两个位置是否完全相同
     * @description 比较 x、y 坐标和房间名是否都相等
     * @param pos - 目标位置
     * @returns true 表示位置相同
     * @example
     * if (creep.pos.isEqual(flag.pos)) {
     *     creep.say('到达目标');
     * }
     */
    isEqual(pos: RoomPosition): boolean;

    /**
     * 判断两个位置是否相邻
     * @description 判断是否在同一房间且距离 <= 1（包括对角线）
     * @param pos - 目标位置
     * @returns true 表示相邻
     * @example
     * if (creep.pos.isNear(source.pos)) {
     *     creep.harvest(source);
     * }
     */
    isNear(pos: RoomPosition): boolean;

    /**
     * 判断目标是否在指定范围内
     * @description 支持传入带 pos 属性的对象或 RoomPosition
     * @param target - 目标对象或位置，可以是 Creep、Structure、RoomPosition 等
     * @param range - 范围距离
     * @returns true 表示在范围内
     * @example
     * if (creep.pos.inRange(controller, 3)) {
     *     creep.upgradeController(controller);
     * }
     */
    inRange(target: RoomObject | RoomPosition | { pos: RoomPosition }, range: number): boolean;

    /**
     * 判断位置是否在房间边界上
     * @description 检查 x 或 y 坐标是否为 0 或 49
     * @returns true 表示在边界上
     * @example
     * if (creep.pos.isRoomEdge()) {
     *     // 处于房间边界，可能需要跨房移动
     * }
     */
    isRoomEdge(): boolean;

    /**
     * 判断位置是否在房间边缘附近
     * @description 检查是否距离房间边界在指定范围内
     * @param range - 距离边界的范围，默认为 1
     * @returns true 表示在边缘附近
     * @example
     * if (creep.pos.isNearEdge(3)) {
     *     // 距离边界 3 格以内
     * }
     */
    isNearEdge(range?: number): boolean;

    // ==================== 跨房间操作 ====================

    /**
     * 跨房间判断是否相邻
     * @description 支持跨房间边界的相邻判断
     * @param other - 目标位置
     * @returns true 表示相邻（包括跨房间边界）
     * @example
     * if (creep.pos.isCrossRoomNearTo(targetPos)) {
     *     // 可以进行近战攻击
     * }
     */
    isCrossRoomNearTo(other: RoomPosition): boolean;

    /**
     * 跨房间计算两点距离
     * @description 计算跨房间的切比雪夫距离
     * @param other - 目标位置
     * @returns 跨房间的距离
     * @example
     * const range = creep.pos.crossRoomGetRangeTo(targetPos);
     */
    crossRoomGetRangeTo(other: RoomPosition): number;

    /**
     * 跨房间坐标相减
     * @description 计算两个位置的全局坐标差值
     * @param other - 目标位置
     * @returns 坐标差值 { x, y }
     * @example
     * const delta = creep.pos.crossRoomSubPos(targetPos);
     * console.log(`需要移动 x:${delta.x}, y:${delta.y}`);
     */
    crossRoomSubPos(other: RoomPosition): { x: number; y: number };

    // ==================== 坐标转换 ====================

    /**
     * 获取房间坐标
     * @description 将房间名解析为数值坐标，如 'E1N2' -> { x: 1, y: -3 }
     * @returns 房间坐标 { x, y }
     * @example
     * const coord = pos.getRoomCoordinate();
     * // 'W1N1' -> { x: -2, y: -2 }
     * // 'E0S0' -> { x: 0, y: 0 }
     */
    getRoomCoordinate(): { x: number; y: number };

    /**
     * 转换为全局坐标
     * @description 将位置转换为全地图的绝对坐标
     * @returns 全局坐标 { x, y }
     * @example
     * const global = pos.toGlobal();
     * // 用于跨房间距离计算或路径规划
     */
    toGlobal(): { x: number; y: number };

    // ==================== 地形与建筑判断 ====================

    /**
     * 判断位置是否可通行
     * @description 检查该位置是否可以被 creep 通过
     * - 有视野时：检查建筑、地形、工地
     * - 无视野时：仅根据 terrain 判断
     * @param withCreep - 是否考虑 creep 占位，默认 false
     * @param rampartOwnerUserName - 指定 rampart 所有者用户名，用于判断敌方 rampart
     * @returns true 表示可通行
     * @example
     * if (pos.walkable()) {
     *     // 可以移动到该位置
     * }
     * if (pos.walkable(true)) {
     *     // 可以移动且没有 creep 占位
     * }
     */
    walkable(withCreep?: boolean, rampartOwnerUserName?: string): boolean;

    /**
     * 判断位置是否有 rampart 覆盖
     * @description 检查该位置是否有 rampart 建筑
     * @returns true 表示有 rampart，无视野时返回 undefined
     * @example
     * if (pos.coverRampart()) {
     *     // 该位置有 rampart 保护
     * }
     */
    coverRampart(): boolean | undefined;

    // ==================== 方向与相邻位置 ====================

    /**
     * 获取指定方向上的位置（支持跨房间）
     * @description 获取指定方向上相邻的位置，如果超出房间边界会返回相邻房间的位置
     * @param direction - 方向常量 (TOP, TOP_RIGHT, RIGHT, 等)
     * @returns 目标位置的 RoomPosition
     * @example
     * const nextPos = creep.pos.getDirectPos(TOP);
     * // 如果 creep 在 y=0，会返回上方房间 y=49 的位置
     */
    getDirectPos(direction: DirectionConstant): RoomPosition;

    /**
     * 获取指定方向上的相邻位置（仅当前房间）
     * @description 获取指定方向上相邻的位置，不处理跨房间情况
     * @param direction - 方向常量
     * @returns 相邻位置的 RoomPosition，无效方向返回自身
     * @example
     * const adjacentPos = creep.pos.getAdjacentPos(RIGHT);
     */
    getAdjacentPos(direction: DirectionConstant): RoomPosition;

    /**
     * 获取到目标位置的方向
     * @description 计算从当前位置到目标位置需要移动的方向
     * @param toPos - 目标位置
     * @returns 方向常量，位置相同时返回 undefined
     * @example
     * const dir = creep.pos.getDirection(target.pos);
     * creep.move(dir);
     */
    getDirection(toPos: RoomPosition): DirectionConstant | undefined;

    /**
     * 获取范围内的所有位置
     * @description 返回以当前位置为中心、指定范围内的所有位置（不包括自身）
     * @param range - 范围，默认为 1
     * @returns RoomPosition 数组
     * @example
     * const nearbyPositions = creep.pos.nearPos(2);
     * // 返回周围 5x5 范围内的 24 个位置
     */
    nearPos(range?: number): RoomPosition[];

    // ==================== 哈希值 ====================

    /**
     * 获取位置的全局哈希值
     * @description 生成包含房间信息的唯一哈希值，可用于全局位置索引
     * @returns 哈希值（整数）
     * @example
     * const hash = pos.hashCode();
     * positionMap[hash] = someData;
     */
    hashCode(): number;

    /**
     * 获取位置在房间内的哈希值
     * @description 生成仅基于 x、y 坐标的哈希值，同一房间内唯一
     * @returns 哈希值（整数，范围 0-4095）
     * @example
     * const hash = pos.hashCodeInRoom();
     * roomPositionMap[hash] = someData;
     */
    hashCodeInRoom(): number;

    // ==================== 旗帜操作 ====================

    /**
     * 在该位置创建旗帜
     * @description 在当前位置创建一个新旗帜
     * @param name - 旗帜名称
     * @param color1 - 主颜色，默认 COLOR_WHITE
     * @param color2 - 副颜色，默认 COLOR_WHITE
     * @returns 旗帜名称或错误码
     * @example
     * pos.createFlag('MyFlag', COLOR_RED, COLOR_BLUE);
     */
    createFlag(name: string, color1?: ColorConstant, color2?: ColorConstant): string | ERR_NAME_EXISTS | ERR_INVALID_ARGS;
}
