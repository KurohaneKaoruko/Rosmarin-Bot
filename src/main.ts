import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';
import { MemoryInit, GlobalInit } from '@/init';
import { roomRunner } from '@/boot/RoomRunner';
import { creepRunner } from '@/boot/CreepRunner';
import { powerCreepRunner } from '@/boot/PowerCreepRunner';
import { flagRunner } from '@/boot/FlagRunner';
import { EventModule } from '@/modules/runtime/event';
import { ClearModule  } from '@/modules/runtime/ClearModule';
import { GeneratePixel } from '@/modules/runtime/Pixel';
import { Statistics } from '@/modules/runtime/Statistics'
import { ResourceManage } from '@/modules/runtime/ResourceManage';
import { TeamModule } from '@/modules/runtime/TeamModule';
import { DDModule } from '@/modules/runtime/DD_Module';
import { NukeModule } from '@/modules/runtime/NukeModule';

import '@/modules/infra/moveOptimization';    // creep移动优化
import '@/modules/infra/structureCache';  // 极致建筑缓存
import '@/modules/infra/roomResource'; // 资源统计

PrototypeExtension();    // 原型拓展
ConsoleExtension();      // 控制台命令拓展

const App = createApp();

App.set('room', roomRunner);             // room运行
App.set('creep', creepRunner);           // creep运行
App.set('powerCreep', powerCreepRunner); // powerCreep运行
App.set('flag', flagRunner);             // flag运行

App.on(MemoryInit);     // 初始化内存
App.on(GlobalInit);     // 全局初始化
App.on(EventModule);    // 事件模块
App.on(TeamModule);     // 小队模块
App.on(ResourceManage); // 资源调度管理
App.on(NukeModule);     // 核弹打击
App.on(ClearModule);    // 过期数据清理
App.on(GeneratePixel);  // 搓像素
App.on(Statistics);     // 统计数据
App.on(DDModule);       // 消息模块



export const loop = App.run;


// // 性能开销分析
// import profiler from '@/modules/infra/screeps-profiler';
// profiler.enable();
// export const loop = function() {
//     profiler.wrap(App.run);
// }
