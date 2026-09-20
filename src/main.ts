import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';
import { EventModule } from '@/modules/EventModule';
import { ClearModule } from '@/modules/ClearModule';
import { GeneratePixel } from '@/modules/Pixel';
import { Statistics } from '@/modules/Statistics';
import { ResourceManage } from '@/modules/ResourceManage';
import { TeamModule } from '@/modules/TeamModule';
import { DDModule } from '@/modules/DDModule';
import { NukeModule } from '@/modules/NukeModule';
import { ExpandModule } from '@/modules/ExpandModule';
import { InterShardModule } from '@/modules/InterShardModule';
import { MoveModule } from '@/modules/MoveModule';

import '@/infra/qos';    // QoS 全局挂载
import '@/infra/BetterMove';    // creep移动优化
import '@/infra/structureCache';  // 极致建筑缓存

PrototypeExtension();    // 原型拓展
ConsoleExtension();      // 控制台命令拓展

const App = createApp();

App.on(TeamModule);       // 小队模块
App.on(EventModule);      // 事件模块
App.on(ResourceManage);   // 资源调度管理
App.on(InterShardModule); // InterShardMemory 缓存与清理
App.on(ExpandModule);     // 跨 shard 扩张
App.on(NukeModule);       // 核弹打击
App.on(DDModule);         // 消息模块
App.on(ClearModule);      // 过期数据清理
App.on(Statistics);       // 统计数据
App.on(GeneratePixel);    // 搓像素
App.on(MoveModule);       // 移动模块

export const loop = App.run;
