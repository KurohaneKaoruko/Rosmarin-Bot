/** race 服配置：冲级规则档 */
import type { ServerCaps } from '@/modules/shared/gameCapabilities';

export const serverCaps: Partial<ServerCaps> = {
    raceCompat: true,         // 产出就绪闸门等 race 特有闸生效
    racePanel: true,          // 冲级数据面板（左下角 rush 面板）
    defaultRoomMode: 'rush',  // race 房间固定冲级档（不按 cpu.limit 订阅档兜底）
    skipBuildTypes: ['factory', 'nuker', 'terminal', 'lab', 'powerSpawn', 'rampart', 'wall'],  // 不自动建造的结构类型（rampart：布局自带防御环，race 不灌墙；威胁防御由 manageDefense 自管）
    buildMinLevel: { rampart: 4, wall: 4 },  // 布局防御环/墙 RCL4 起造（对齐原 rclToBuildRampart 口径）
};
