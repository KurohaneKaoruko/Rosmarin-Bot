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

export default () => plugins.forEach(plugin => _.assign(global, plugin));
