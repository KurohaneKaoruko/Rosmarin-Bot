/** 要塞服配置：RCL8 锁定 + 无源房 */
import type { ServerCaps } from '@/modules/shared/gameCapabilities';

export const serverCaps: Partial<ServerCaps> = {
    racePanel: false,          // 冲级面板无意义
    boostResCheck: false,      // 小队不做 boost 资源检查，也不下发 boost 任务
    energyCheck: false,        // 孵化不做能量闸，可孵性交由引擎裁决
    defaultRoomMode: 'main',   // 房间默认档
};
