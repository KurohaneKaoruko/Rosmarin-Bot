// 特殊规则服入口（要塞挑战：RCL8 锁定 / 无限能量 spawn / 无源房）
// 只挂孵化 + 战斗 + 移动所需；经济/扩张/团队等模块不加载（tree-shake 出 bundle）
import '@/compat';               // 环境兼容垫片（必须保持首位）
import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';
import { ClearModule } from '@/modules/ClearModule';
import { MoveModule } from '@/modules/MoveModule';
import { TeamModule } from '@/modules/TeamModule';

import '@/modules/infra/qos';           // QoS 全局挂载
import '@/modules/infra/BetterMove';    // creep 移动优化
import '@/modules/infra/structureCache'; // 极致建筑缓存

PrototypeExtension();    // 原型拓展（房间孵化池/旗帜系统挂载于此）
ConsoleExtension();      // 控制台命令拓展

import { configureServerCaps } from '@/modules/shared/gameCapabilities';
import { serverCaps } from './config';

configureServerCaps(serverCaps);    // 套用要塞服配置

const App = createApp();

App.on(ClearModule);      // 过期数据清理
App.on(MoveModule);       // 移动模块
App.on(TeamModule);       // 小队系统（ATK/TEAM_ 指令旗孵化 + 队伍行为控制）

import { writeDiagDumps } from '@/modules/infra/diagDump';

export const loop = () => {
    App.run();
    writeDiagDumps();      // 观察通道：__wd/__carrierDump 快照（外部 GET 读取）
};
