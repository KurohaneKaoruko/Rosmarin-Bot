// season8 赛季服入口。
// 与官服 main.ts 同构：全部复用共享树（modules / prototype / console / core），
// 差异只有三处——增挂 Season8 冲分模块、关闭赛季不兼容模块、加赛季终端发送限制。
// 共用模块一律不复制；赛季专属实现只放本目录（Season8Module / scoring / console / marketCompat / mineralContainer）。
import { createApp } from '@/core/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';

import { EventModule } from '@/modules/EventModule';
import { ClearModule } from '@/modules/ClearModule';
import { Statistics } from '@/modules/Statistics';
import { ResourceManage } from '@/modules/ResourceManage';
import { FunnelModule } from '@/modules/FunnelModule';
import { TeamModule } from '@/modules/TeamModule';
import { InterShardModule } from '@/modules/InterShardModule';
import { MoveModule } from '@/modules/MoveModule';

import '@/modules/infra/qos';             // QoS 全局挂载
import '@/modules/infra/BetterMove';      // creep 移动优化
import '@/modules/infra/structureCache';  // 极致建筑缓存

import { configureServerCaps } from '@/modules/shared/gameCapabilities';
import { registerFillRequestProvider } from '@/modules/shared/roomWorkforce';
import { registerOutMineIncomeProvider } from '@/prototype/Room/feature/outMine';
import { buildFillRequests } from '@/modules/shared/energyLogistics';
import { serverCaps } from './config';

import { Season8Module } from './Season8Module';
import { mountSeason8Console } from './console';
import { installSeason8Guards } from './guards';
import { installSeason8Overrides } from './overrides';

configureServerCaps(serverCaps);                   // 套用赛季服配置（默认 high 档）
registerFillRequestProvider(buildFillRequests);    // 定编填充信号 ← 能量中枢
registerOutMineIncomeProvider();                   // 定编外矿收入 ← 外矿模块

PrototypeExtension();    // 原型拓展
ConsoleExtension();      // 控制台命令拓展

mountSeason8Console();    // 赛季控制台命令：season8.<cmd>
installSeason8Guards();   // 赛季终端发送限制
installSeason8Overrides();// 赛季覆盖：通用机高能升级窗口 / 道路工地裁剪

const App = createApp();

App.on(TeamModule);        // 小队模块
App.on(EventModule);       // 事件模块
App.on(ResourceManage);    // 资源调度管理
App.on(FunnelModule);      // 跨房能量漏斗
App.on(InterShardModule);  // InterShardMemory 缓存与清理
App.on(Season8Module);     // 赛季冲分：房间快照 / 扇区得分 / 扩张前线 / 计划状态同步
App.on(ClearModule);       // 过期数据清理
App.on(Statistics);        // 统计数据
App.on(MoveModule);        // 移动模块

// 赛季禁用（不注册）：ExpandModule 跨 shard 扩张 / NukeModule 核弹打击 / Pixel 搓像素

import { updateBucketGovernor } from '@/modules/infra/bucketGovernor';
import { writeDiagDumps } from '@/modules/infra/diagDump';

export const loop = () => {
    updateBucketGovernor();
    App.run();
    writeDiagDumps();
};
