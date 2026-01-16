import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';
import { MemoryInit, GlobalInit } from '@/init';
import { roomControl } from '@/boot/RoomControl';
import { creepControl } from '@/boot/CreepControl';
import { powerControl } from '@/boot/PowerControl';
import { flagControl } from '@/boot/FlagControl';
import { EventModule } from '@/modules/runtime/event';
import { ClearModule  } from '@/modules/runtime/ClearModule';
import { GeneratePixel } from '@/modules/runtime/Pixel';
import { Statistics } from '@/modules/runtime/Statistics'
import { FlagSpawn } from '@/modules/runtime/flagSpawn';
import { ResourceManage } from '@/modules/runtime/ResourceManage';
import TeamModule from '@/modules/feature/TeamModule';

import '@/modules/infra/betterMove';    // 超级移动优化
import '@/modules/infra/structureCache';  // 极致建筑缓存
import '@/modules/infra/roomResource'; // 资源统计

PrototypeExtension();    // 原型拓展
ConsoleExtension();      // 控制台命令拓展

const App = createApp();

App.set('room', roomControl);     // room控制
App.set('creep', creepControl);   // creep控制
App.set('power', powerControl);   // powerCreep控制
App.set('flag', flagControl);     // flag控制

App.on(MemoryInit);     // 初始化内存
App.on(GlobalInit);     // 全局初始化
App.on(EventModule);    // 事件模块
App.on(TeamModule);     // 小队模块
App.on(FlagSpawn);      // 旗帜触发孵化
App.on(ResourceManage); // 资源调度管理
App.on(ClearModule);    // 过期数据清理
App.on(GeneratePixel);  // 搓像素
App.on(Statistics);     // 统计数据

export const loop = App.run;


// // 性能开销分析
// import profiler from '@/modules/infra/screeps-profiler';
// profiler.enable();
// export const loop = function() {
//     profiler.wrap(App.run);
// }


