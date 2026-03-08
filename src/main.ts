import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';
import { EventModule } from '@/modules/runtime/EventModule';
import { ClearModule } from '@/modules/runtime/ClearModule';
import { GeneratePixel } from '@/modules/runtime/Pixel';
import { Statistics } from '@/modules/runtime/Statistics';
import { ResourceManage } from '@/modules/runtime/ResourceManage';
import { TeamModule } from '@/modules/runtime/TeamModule';
import { DDModule } from '@/modules/runtime/DD_Module';
import { NukeModule } from '@/modules/runtime/NukeModule';
import { ExpandModule } from '@/modules/runtime/ExpandModule';
import { InterShardModule } from '@/modules/runtime/InterShardModule';
import { MoveModule } from '@/modules/runtime/MoveModule';

import '@/modules/infra/qos';
import '@/modules/infra/moveOptimization';
import '@/modules/infra/structureCache';

PrototypeExtension();
ConsoleExtension();

const App = createApp();

App.on(TeamModule);
App.on(EventModule);
App.on(ResourceManage);
App.on(InterShardModule);
App.on(ExpandModule);
App.on(NukeModule);
App.on(DDModule);
App.on(ClearModule);
App.on(Statistics);
App.on(GeneratePixel);
App.on(MoveModule);

export const loop = App.run;

// import profiler from '@/modules/infra/screeps-profiler';
// profiler.enable();
// export const loop = function() {
//     profiler.wrap(App.run);
// };
