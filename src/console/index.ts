import base from './base';
import info from './function/info';
import room from './function/room';
import outMine from './function/outmine';
import layout from './function/layout';
import market from './function/market';
import resource from './function/resource';
import spawn from './structure/spawn';
import terminal from './structure/terminal';
import lab from './structure/lab';
import factory from './structure/factory';
import powerSpawn from './structure/powerspawn';
import nuker from './structure/nuker';
import helps from './help'

const plugins = [
    base,
    info,
    room,
    layout,
    market,
    outMine,
    resource,
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
    helps.map(item => {
        if (global[item.alias]) return;
        Object.defineProperty(global, item.alias, { get: item.exec })
    })
}

