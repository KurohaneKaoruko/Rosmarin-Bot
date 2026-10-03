// 赛季服入口（占位）：赛季规则多变，先按官服全量挂载，规则明确后再裁剪
import '@/compat';
import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';
import { ClearModule } from '@/modules/ClearModule';
import { MoveModule } from '@/modules/MoveModule';
import { Statistics } from '@/modules/Statistics';

import '@/modules/infra/qos';
import '@/modules/infra/BetterMove';
import '@/modules/infra/structureCache';

PrototypeExtension();
ConsoleExtension();

const App = createApp();

App.on(ClearModule);
App.on(Statistics);
App.on(MoveModule);

export const loop = () => {
    App.run();
};
