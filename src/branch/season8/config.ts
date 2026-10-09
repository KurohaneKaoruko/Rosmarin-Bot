/** season8 服配置：赛季计分规则档（扇区得分 + 托管 high 档） */
import type { ServerCaps } from '@/modules/shared/gameCapabilities';

export const serverCaps: Partial<ServerCaps> = {
    raceCompat: false,        // 无 race 特有闸
    racePanel: false,         // 冲级面板改用 season8 自带报告
    boostResCheck: true,      // 小队走正常 boost 检查
    energyCheck: true,        // 孵化走正常能量闸
    defaultRoomMode: 'high',  // 赛季托管统一 high，最大化冲分
};
