import { errorMapper } from './errorMapper.js'
import { BASE_CONFIG } from '@/constant/config.js'

type EventType = 'init' | 'start' | 'tick' | 'end';
type RunnerType = 'room' | 'creep' | 'powerCreep' | 'flag';
type RunnerFn = () => void;

const GAME_OBJECTS: Record<RunnerType, () => Record<string, any>> = {
    room: () => Game.rooms,
    creep: () => Game.creeps,
    powerCreep: () => Game.powerCreeps,
    flag: () => Game.flags,
};

/**
 * 基本框架，用于管理游戏循环，挂载各种模块
 */
export const createApp = () => {
    const name = BASE_CONFIG.BOT_NAME;
    const events: Record<EventType, RunnerFn[]> = { init: [], start: [], tick: [], end: [] };
    const runners: Record<RunnerType, RunnerFn> = { room: () => {}, creep: () => {}, powerCreep: () => {}, flag: () => {} };

    /** 设置运行器 */
    const set = <T>(type: RunnerType, runner: (obj: T) => void) => {
        const getObjs = GAME_OBJECTS[type];
        if (getObjs) {
            runners[type] = () => Object.values(getObjs()).forEach(runner);
        }
    };

    /** 添加模块 */
    const on = (callbacks: RuntimeModule) => {
        if (!callbacks) return;
        for (const type in callbacks) {
            if (type in events) {
                const cb = callbacks[type as EventType];
                if (cb) events[type as EventType].push(cb as RunnerFn);
            }
        }
    };

    /** 运行模块 */
    const runCall = (type: EventType) => {
        for (const cb of events[type]) cb();
    };

    let initOK = false;
    const init = () => {
        runCall('init');
        const tryInit = (proto: any, objs: Record<string, any>) => {
            if (proto.init) Object.values(objs).forEach((o: any) => o.init());
        };
        tryInit(Room.prototype, Game.rooms);
        tryInit(Creep.prototype, Game.creeps);
        tryInit(PowerCreep.prototype, Game.powerCreeps);
        initOK = true;
        if (Game.shard.name !== 'sim') console.log('全局初始化完成。');
    };

    let _MemoryCache: Memory;
    let lastTime = 0;
    /** 内存缓存器 */
    const cacheMemory = () => {
        if (_MemoryCache && lastTime && Game.time === lastTime + 1) {
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
    };

    /** 主要逻辑 */
    const exec = () => {
        if (!initOK) init();
        runCall('start');
        runners.room();
        runners.creep();
        runners.powerCreep();
        runners.flag();
        runCall('tick');
        runCall('end');
    };

    /** 运行 */
    const run = () => {
        cacheMemory();
        errorMapper(exec);
    };

    return { name, set, on, run };
};
