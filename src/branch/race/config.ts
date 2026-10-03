/** race 服配置：冲级规则档 */
import type { ServerCaps } from '@/modules/shared/gameCapabilities';

export const serverCaps: Partial<ServerCaps> = {
    raceCompat: true,         // 产出就绪闸门等 race 特有闸生效
};
