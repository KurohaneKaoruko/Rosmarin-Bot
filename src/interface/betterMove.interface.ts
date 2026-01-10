interface Creep {
    // ==================== betterMove 原始方法备份 ====================
    /**
     * 原始moveTo方法
     * @description betterMove模块保存的原始Screeps moveTo方法
     * @see src/wheel/betterMove.ts
     */
    originMoveTo: typeof Creep.prototype.moveTo;

    /**
     * moveTo方法备份
     * @description betterMove模块增强前的moveTo方法备份
     * @see src/wheel/betterMove.ts
     */
    $moveTo: typeof Creep.prototype.moveTo;

    /**
     * build方法备份
     * @description betterMove模块增强前的build方法备份，增强版会设置dontPullMe=true
     */
    $build: typeof Creep.prototype.build;

    /**
     * repair方法备份
     * @description betterMove模块增强前的repair方法备份，增强版会设置dontPullMe=true
     */
    $repair: typeof Creep.prototype.repair;

    /**
     * upgradeController方法备份
     * @description betterMove模块增强前的upgradeController方法备份，增强版会设置dontPullMe=true
     */
    $upgradeController: typeof Creep.prototype.upgradeController;

    /**
     * dismantle方法备份
     * @description betterMove模块增强前的dismantle方法备份，增强版会设置dontPullMe=true
     */
    $dismantle: typeof Creep.prototype.dismantle;

    /**
     * harvest方法备份
     * @description betterMove模块增强前的harvest方法备份，增强版会设置dontPullMe=true
     */
    $harvest: typeof Creep.prototype.harvest;

    /**
     * attack方法备份
     * @description betterMove模块增强前的attack方法备份，增强版会设置dontPullMe=true
     */
    $attack: typeof Creep.prototype.attack;
}

/**
 * PowerCreep接口扩展
 * @description 扩展Screeps原生PowerCreep类，添加betterMove模块的方法
 * @see src/wheel/betterMove.ts
 */
interface PowerCreep {
    /**
     * 原始moveTo方法
     * @description betterMove模块保存的原始Screeps moveTo方法
     */
    originMoveTo: typeof PowerCreep.prototype.moveTo;

    /**
     * moveTo方法备份
     * @description betterMove模块增强前的moveTo方法备份
     */
    $moveTo: typeof PowerCreep.prototype.moveTo;
}

/**
 * MoveToOpts 扩展接口
 * @description 扩展Screeps原生MoveToOpts，添加betterMove模块的选项
 * @see src/wheel/betterMove.ts
 */
interface MoveToOpts {
    /**
     * 忽略沼泽
     * @description 将沼泽视为平地，移动消耗与平地相同
     * @default false
     * @example
     * creep.moveTo(target, { ignoreSwamps: true });
     */
    ignoreSwamps?: boolean;

    /**
     * 是否绕过敌对creep
     * @description 遇到敌对creep时是否尝试绕路
     * @default true
     * @example
     * creep.moveTo(target, { bypassHostileCreeps: false }); // 不绕过敌对creep
     */
    bypassHostileCreeps?: boolean;

    /**
     * 绕路检测范围
     * @description 检测需要绕过的creep的范围半径
     * @default 5
     * @example
     * creep.moveTo(target, { bypassRange: 10 }); // 扩大绕路检测范围
     */
    bypassRange?: number;

    /**
     * 无路径延迟
     * @description 当找不到完整路径时，延迟多少tick后重新寻路
     * @default 10
     * @example
     * creep.moveTo(target, { noPathDelay: 5 }); // 5tick后重新寻路
     */
    noPathDelay?: number;
}

/**
 * BetterMove全局模块接口
 * @description betterMove模块暴露的全局API
 * @see src/wheel/betterMove.ts
 */
interface BetterMoveAPI {
    /**
     * creep路径缓存
     * @description 存储所有creep的路径缓存数据
     */
    creepPathCache: {
        [creepName: string]: {
            /** 目标位置 */
            dst: { x: number; y: number };
            /** 路径对象 */
            path: any;
            /** 当前路径索引 */
            idx: number;
        };
    };

    /**
     * 设置是否使用增强版move
     * @param bool - 是否启用
     * @returns OK表示成功
     */
    setChangeMove(bool: boolean): ScreepsReturnCode;

    /**
     * 设置是否使用增强版moveTo
     * @param bool - 是否启用
     * @returns OK表示成功
     */
    setChangeMoveTo(bool: boolean): ScreepsReturnCode;

    /**
     * 设置是否使用增强版findClosestByPath
     * @param bool - 是否启用
     * @returns OK表示成功
     */
    setChangeFindClostestByPath(bool: boolean): ScreepsReturnCode;

    /**
     * 设置路径缓存清理延迟
     * @param number - 延迟tick数，undefined表示不自动清理
     * @returns OK表示成功，ERR_INVALID_ARGS表示参数无效
     */
    setPathClearDelay(number: number | undefined): ScreepsReturnCode;

    /**
     * 设置敌对房间CostMatrix清理延迟
     * @param number - 延迟tick数，undefined表示不自动清理
     * @returns OK表示成功，ERR_INVALID_ARGS表示参数无效
     */
    setHostileCostMatrixClearDelay(number: number | undefined): ScreepsReturnCode;

    /**
     * 删除指定房间的CostMatrix缓存
     * @param roomName - 房间名
     * @returns OK表示成功
     */
    deleteCostMatrix(roomName: string): ScreepsReturnCode;

    /**
     * 获取避开房间列表
     * @returns 避开房间的映射对象
     */
    getAvoidRoomsMap(): { [roomName: string]: number };

    /**
     * 添加避开房间
     * @param roomName - 房间名
     * @returns OK表示成功，ERR_INVALID_ARGS表示房间名无效
     */
    addAvoidRooms(roomName: string): ScreepsReturnCode;

    /**
     * 删除避开房间
     * @param roomName - 房间名
     * @returns OK表示成功，ERR_INVALID_ARGS表示房间名无效或不存在
     */
    deleteAvoidRooms(roomName: string): ScreepsReturnCode;

    /**
     * 删除指定房间内的所有路径缓存
     * @param roomName - 房间名
     * @returns OK表示成功，ERR_INVALID_ARGS表示房间名无效
     */
    deletePathInRoom(roomName: string): ScreepsReturnCode;

    /**
     * 添加避开出口
     * @param fromRoomName - 起始房间名
     * @param toRoomName - 目标房间名
     * @returns OK表示成功，ERR_INVALID_ARGS表示参数无效
     * @description 【未启用】
     */
    addAvoidExits(fromRoomName: string, toRoomName: string): ScreepsReturnCode;

    /**
     * 删除避开出口
     * @param fromRoomName - 起始房间名
     * @param toRoomName - 目标房间名
     * @returns OK表示成功，ERR_INVALID_ARGS表示参数无效
     * @description 【未启用】
     */
    deleteAvoidExits(fromRoomName: string, toRoomName: string): ScreepsReturnCode;

    /**
     * 打印性能统计信息
     * @returns 格式化的性能统计字符串
     * @description 包含平均耗时、缓存命中率、对穿率等统计数据
     */
    print(): string;

    /**
     * 清理未使用的缓存
     */
    clear(): void;
}

declare namespace NodeJS {
    interface Global {
        /**
         * BetterMove全局模块
         * @description 提供路径缓存管理和配置的全局API
         * @see src/wheel/betterMove.ts
         * @example
         * // 打印性能统计
         * console.log(global.BetterMove.print());
         * // 添加避开房间
         * global.BetterMove.addAvoidRooms('W10N10');
         * // 删除房间路径缓存
         * global.BetterMove.deletePathInRoom('W10N10');
         */
        BetterMove: BetterMoveAPI;
    }
}