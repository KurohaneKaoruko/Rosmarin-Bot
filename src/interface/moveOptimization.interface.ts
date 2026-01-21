/**
 * moveOpt 类型扩展
 * @description 为移动优化模块补齐 MoveToOpts 扩展字段与 global.BetterMove API 类型
 */

// ============================================================
// MoveToOpts 扩展 - MoveToOpts Extensions
// ============================================================

/**
 * 扩展 Screeps 原生 MoveToOpts
 * @description moveOpt 会读取这些扩展字段；不声明会导致 TS 侧访问报错
 */
interface MoveToOpts {
  /**
   * 无视 swamp 与 road 的移动力损耗差异
   * @description 主要用于 power creep / 观察者等单位，默认 false
   */
  ignoreSwamps?: boolean;

  /**
   * 被 creep 挡路时，是否绕过敌方 creep
   * @description 默认 true；设为 false 可用于近战贴脸攻击
   */
  bypassHostileCreeps?: boolean;

  /**
   * 绕路半径
   * @description 当被 creep 挡路且触发绕路时生效，默认 5
   */
  bypassRange?: number;

  /**
   * 寻得不完整路径时的再次寻路延迟
   * @description 默认 10（由 moveOpt 内部控制）
   */
  noPathDelay?: number;
}

// ============================================================
// global.BetterMove - BetterMove Global API
// ============================================================

/**
 * BetterMove 全局 API
 * @description moveOpt 在加载时挂载 global.BetterMove
 */
interface BetterMoveAPI {
  setChangeMove(bool: boolean): ScreepsReturnCode;
  creepPathCache: Record<string, unknown>;
  setChangeMoveTo(bool: boolean): ScreepsReturnCode;
  setChangeFindClostestByPath(bool: boolean): ScreepsReturnCode;
  setPathClearDelay(number?: number): ScreepsReturnCode;
  setHostileCostMatrixClearDelay(number?: number): ScreepsReturnCode;
  deleteCostMatrix(roomName: string): ScreepsReturnCode;
  getAvoidRoomsMap(): Record<string, 1>;
  addAvoidRooms(roomName: string): ScreepsReturnCode;
  deleteAvoidRooms(roomName: string): ScreepsReturnCode;
  deletePathInRoom(roomName: string): ScreepsReturnCode;
  addAvoidExits(fromRoomName: string, toRoomName: string): ScreepsReturnCode;
  deleteAvoidExits(fromRoomName: string, toRoomName: string): ScreepsReturnCode;
  print(): string;
  clear: () => void;
}

/**
 * 扩展 NodeJS.Global 接口
 * @description 声明 global.BetterMove 的类型
 */
declare namespace NodeJS {
  interface Global {
    BetterMove?: BetterMoveAPI;
  }
}
