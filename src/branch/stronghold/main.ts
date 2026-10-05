// 特殊规则服入口（要塞挑战：RCL8 锁定 / 无限能量 spawn / 无源房）
// 只挂孵化 + 战斗 + 移动所需；经济/扩张/团队等模块不加载（tree-shake 出 bundle）
// 环境兼容垫片（必须保持首位）
import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';

import '@/modules/infra/qos';           // QoS 全局挂载
import '@/modules/infra/BetterMove';    // creep 移动优化
import '@/modules/infra/structureCache'; // 极致建筑缓存

PrototypeExtension();    // 原型拓展（房间孵化池/旗帜系统挂载于此）
ConsoleExtension();      // 控制台命令拓展

import { configureServerCaps } from '@/modules/shared/gameCapabilities';
import { serverCaps } from './config';
import { registerFillRequestProvider } from '@/modules/shared/roomWorkforce';
import { registerOutMineIncomeProvider } from '@/prototype/Room/feature/outMine';
import { buildFillRequests } from '@/modules/shared/energyLogistics';
import './team';    // 要塞服 team 模块表层：注册 ATK 旗型解析（须在首次孵化扫描前）

configureServerCaps(serverCaps);    // 套用要塞服配置
registerFillRequestProvider(buildFillRequests);    // 定编填充信号 ← 能量中枢
registerOutMineIncomeProvider();    // 定编外矿收入 ← 外矿模块

import { ClearModule } from '@/modules/ClearModule';
import { MoveModule } from '@/modules/MoveModule';
import { TeamModule } from '@/modules/TeamModule';
const MODULE_MANIFEST = [
    ClearModule,
    MoveModule,
    TeamModule,
] as const;

const App = createApp();

for (const module of MODULE_MANIFEST) {
    App.on(module);
}

import { writeDiagDumps } from '@/modules/infra/diagDump';

export const loop = () => {
    App.run();
    writeDiagDumps();      // 观察通道：__wd/__carrierDump 快照（外部 GET 读取）
};
