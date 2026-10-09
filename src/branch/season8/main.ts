// season8 赛季服入口：共享树全量挂载 + 赛季计分 / 扩张前线模块。
import { createApp } from '@/core/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';

import '@/modules/infra/qos';
import '@/modules/infra/BetterMove';
import '@/modules/infra/structureCache';

import { configureServerCaps } from '@/modules/shared/gameCapabilities';
import { serverCaps } from './config';
import { registerFillRequestProvider } from '@/modules/shared/roomWorkforce';
import { registerOutMineIncomeProvider } from '@/prototype/Room/feature/outMine';
import { buildFillRequests } from '@/modules/shared/energyLogistics';

configureServerCaps(serverCaps);    // 套用赛季服配置
registerFillRequestProvider(buildFillRequests);    // 定编填充信号 ← 能量中枢
registerOutMineIncomeProvider();    // 定编外矿收入 ← 外矿模块

PrototypeExtension();
ConsoleExtension();

import { ClearModule } from '@/modules/ClearModule';
import { Statistics } from '@/modules/Statistics';
import { MoveModule } from '@/modules/MoveModule';
import { Season8Module } from './Season8Module';
import season8Console from './console';

_.assign(global, season8Console);    // 赛季控制台命令：season8.<cmd>

const MODULE_MANIFEST = [
    ClearModule,
    Statistics,
    MoveModule,
    Season8Module,
] as const;

const App = createApp();

for (const module of MODULE_MANIFEST) {
    App.on(module);
}

export const loop = () => {
    App.run();
};
