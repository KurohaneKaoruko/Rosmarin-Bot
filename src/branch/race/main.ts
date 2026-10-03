import '@/compat';               // 环境兼容垫片（必须保持首位：无 Power 玩法的服务器缺 PowerCreep 全局类）
import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';
import { ClearModule } from '@/modules/ClearModule';
import { Statistics } from '@/modules/Statistics';
import { FunnelModule } from '@/modules/FunnelModule';
import { InterShardModule } from '@/modules/InterShardModule';
import { MoveModule } from '@/modules/MoveModule';

import '@/modules/infra/qos';    // QoS 全局挂载
import '@/modules/infra/BetterMove';    // creep移动优化
import '@/modules/infra/structureCache';  // 极致建筑缓存
import { enableRaceCompat } from '@/modules/shared/gameCapabilities';

enableRaceCompat();      // race 规则档兼容能力：产出就绪序列等闸门据此生效

PrototypeExtension();    // 原型拓展
ConsoleExtension();      // 控制台命令拓展

const App = createApp();

App.on(FunnelModule);     // 跨房能量漏斗
App.on(InterShardModule); // InterShardMemory 缓存与清理
App.on(ClearModule);      // 过期数据清理
App.on(Statistics);       // 统计数据
App.on(MoveModule);       // 移动模块

import { updateBucketGovernor } from '@/modules/infra/bucketGovernor';
import { writeDiagDumps } from '@/modules/infra/diagDump';

export const loop = () => {
    // CPU 桶闭环：先更新外矿活跃阈值，再跑主循环（Tier 1-3）
    updateBucketGovernor();
    App.run();
    writeDiagDumps();
};
