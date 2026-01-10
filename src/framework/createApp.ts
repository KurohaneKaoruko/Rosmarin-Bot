import { errorMapper } from './errorMapper.js'
import { BASE_CONFIG } from '@/constant/config.js'

/**
 * 基本框架，用于管理游戏循环，挂载各种模块
 */
export const createApp = () => {
    const name = BASE_CONFIG.BOT_NAME;
    const events = {init: [], start: [], tick: [], end: []}
    
    let runRoom = () => {};
    let runCreep = () => {};
    let runPower = () => {};
    let runFlag = () => {};

    /** 设置运行器 */
    const set = (type: 'room' | 'creep' | 'power' | 'flag' , runner: any) => {
        if (type === 'room') {
            runRoom = () => Object.values(Game.rooms).forEach(runner);
        } else if (type === 'creep') {
            runCreep = () => Object.values(Game.creeps).forEach(runner);
        } else if (type === 'power') {
            runPower = () => Object.values(Game.powerCreeps).forEach(runner);
        } else if (type === 'flag') {
            runFlag = () => Object.values(Game.flags).forEach(runner);
        } else {
            console.log(`未知的运行器类型: ${type}`);
        }
    }

    /** 添加模块 */
    const on = (callbacks: any) => {
        if (!callbacks || typeof callbacks !== 'object') return;
        Object.keys(callbacks)?.forEach(type => {
            if (!events[type]) return;
            events[type].push(callbacks[type])
        })
    };

    /** 运行模块 */
    const runCall = (name: string) => {
        if (!events[name]) return;
        events[name].forEach((callback: () => void) => callback());
    }

    let initOK = false;
    const init = () => {
        runCall('init');
        const initRun = (objs: any) => Object.values(objs).forEach((item: any) => item.init()); 
        if (Room.prototype.init) initRun(Game.rooms);
        if (Creep.prototype.init) initRun(Game.creeps);
        if (PowerCreep.prototype.init) initRun(Game.powerCreeps);
        initOK = true;
        if (Game.shard.name == 'sim') return;
        console.log(`全局初始化完成。`);
    };

    let _MemoryCache: Memory;
    let lastTime = 0;
    /** 内存缓存器 */
    const MemoryCacher = () => {
        if (_MemoryCache && lastTime && Game.time == lastTime + 1) {
            // @ts-ignore
            delete global.Memory;
            // @ts-ignore
            global.Memory = _MemoryCache;
            // @ts-ignore
            RawMemory._parsed = global.Memory;
        } else {
            // @ts-ignore
            _MemoryCache = global.Memory;
        }
        lastTime = Game.time;
    }

    /** 主要逻辑 */
    const exec = () => {
        if(!initOK) init();
        runCall('start');
        runRoom();
        runCreep();
        runPower();
        runFlag();
        runCall('tick');
        runCall('end');
    }

    /** 运行 */
    const run = () => {
        MemoryCacher();
        errorMapper(exec);
    }

    return { name, set, on, run }
};
