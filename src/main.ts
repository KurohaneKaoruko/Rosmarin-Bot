import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';
import { MemoryInit, GlobalInit } from '@/init';
import { EventModule } from '@/event';
import { roomControl } from '@/boot/RoomControl'
import { creepControl } from '@/boot/CreepControl'
import { powerControl } from '@/boot/PowerControl'
import { flagControl } from '@/boot/FlagControl'
import { ClearModule  } from '@/modules/function/ClearModule';
import { GeneratePixel } from '@/modules/function/Pixel';
import { Statistics } from '@/modules/function/Statistics'
import { FlagSpawn } from '@/modules/FlagSpawn';
import { ResourceManage } from '@/modules/ResourceManage';
import TeamModule from '@/modules/team/TeamModule';

import '@/wheel/betterMove';    // 超级移动优化
import '@/wheel/structureCache';  // 极致建筑缓存
import '@/wheel/roomResource'; // 资源统计

PrototypeExtension();    // 原型拓展
ConsoleExtension();      // 控制台命令拓展

const App = createApp();
App.set('room', roomControl);     // 房间控制
App.set('creep', creepControl);   // creep控制
App.set('power', powerControl);   // powerCreep控制
App.set('flag', flagControl);     // flag控制

App.on(MemoryInit);     // 初始化内存
App.on(GlobalInit);     // 全局变量模块
App.on(EventModule);    // 事件模块
App.on(TeamModule);     // 小队模块
App.on(FlagSpawn);      // 旗帜触发孵化
App.on(ResourceManage); // 资源调度管理
App.on(ClearModule);    // 过期数据清理
App.on(GeneratePixel);  // 搓像素
App.on(Statistics);     // 统计数据


// export const loop = App.run;


// 性能开销分析
import profiler from '@/wheel/screeps-profiler';
profiler.enable();
export const loop = function() {
    profiler.wrap(App.run);
}

