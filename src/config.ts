/** 官服配置：默认口径即官服行为，这里显式声明基线便于对照 */
import type { ServerCaps } from '@/modules/shared/gameCapabilities';

export const serverCaps: Partial<ServerCaps> = {
    raceCompat: false,        // 无 race 特有闸
    racePanel: true,          // 冲级面板开启（rush 模式下渲染）
    boostResCheck: true,      // 小队走正常 boost 检查与任务下发
    energyCheck: true,        // 孵化走正常能量闸
    defaultRoomMode: 'auto',  // 房间默认档按订阅位兜底（cpu.limit ≥ 100 → rush）
};
