import base from './base';
import diag from './function/diag';
import info from './function/info';
import room from './function/room';
import mine from './function/mine';
import layout from './function/layout';
import market from './function/market';
import resource from './function/resource';
import expand from './function/expand';
import spawn from './structure/spawn';
import terminal from './structure/terminal';
import lab from './structure/lab';
import factory from './structure/factory';
import powerSpawn from './structure/powerspawn';
import nuker from './structure/nuker';
import helps from './help'
import { registerRoomAutoStartProvider } from '@/framework/runner/roomAutoStart';
import { mountQoS } from '@/modules/infra/qos';
import { ensureEventApi } from '@/modules/infra/event';

// console 侧向 framework 注入房间自动开局实现（消除 framework→console 反向依赖）
registerRoomAutoStartProvider({
    startFirstRoom(roomName) {
        room.room.start(roomName, undefined, { quiet: true });
    },
    applyAutoStart(roomName, autoStart) {
        room.room.add(roomName, autoStart.layout);
        room.room.mode(roomName, autoStart.mode);
        layout.layout.build(roomName, autoStart.layout);
        layout.layout.auto(roomName, true);
    },
});

const plugins = [
    base,
    diag,
    info,
    room,
    layout,
    market,
    mine,
    resource,
    expand,
    lab,
    spawn,
    nuker,
    factory,
    terminal,
    powerSpawn,
]

/** 控制台命令拓展 */
export const ConsoleExtension = function () {
    plugins.forEach(plugin => _.assign(global, plugin));
    mountQoS();          // 控制台人机入口保留 global.qos（运行时消费已改模块 import）
    ensureEventApi();    // 控制台人机入口保留 global.event
    helps.map(item => {
        if (global[item.alias]) return;
        Object.defineProperty(global, item.alias, { get: item.exec })
    })
}
