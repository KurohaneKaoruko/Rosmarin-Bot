import { log } from '@/utils.js';
import { errorMapper } from './errorMapper.js'
import { BASE_CONFIG } from '@/constant/config.js'
import { roomRunner } from './runner/RoomRunner';
import { creepRunner } from './runner/CreepRunner';
import { powerCreepRunner } from './runner/PowerCreepRunner';
import { flagRunner } from './runner/FlagRunner';

type EventType = 'init' | 'start' | 'tick' | 'end';
type RunnerType = 'room' | 'creep' | 'powerCreep' | 'flag';
type RunnerFn = () => void;
const EVENT_TYPES: readonly EventType[] = ['init', 'start', 'tick', 'end'];

/**
 * 基本框架，用于管理游戏循环，挂载各种模块
 */
export const createApp = () => {
    const name = BASE_CONFIG.BOT_NAME;
    const modules: Record<EventType, RunnerFn[]> = { init: [], start: [], tick: [], end: [] };
    const runners: Record<RunnerType, RunnerFn> = {
        room: () => runRunner(Game.rooms, roomRunner),
        creep: () => runRunner(Game.creeps, creepRunner),
        powerCreep: () => runRunner(Game.powerCreeps, powerCreepRunner),
        flag: () => runRunner(Game.flags, flagRunner),
    };

    const hasOwnProperty = Object.prototype.hasOwnProperty;
    const runRunner = <T>(objs: Record<string, T>, runner: (obj: T) => void) => {
        for (const id in objs) {
            if (!hasOwnProperty.call(objs, id)) continue;
            runner(objs[id]);
        }
    };

    /** 添加模块 */
    const on = (callbacks: RuntimeModule) => {
        if (!callbacks) return;
        for (const type of EVENT_TYPES) {
            const cb = callbacks[type];
            if (cb) modules[type].push(cb);
        }
    };

    /** 运行模块 */
    const runCall = (type: EventType) => {
        for (const cb of modules[type]) cb();
    };

    let initOK = false;
    const runInit = () => {
        if (initOK) return;
        const tryInit = (proto: { init?: () => void }, objs: Record<string, any>) => {
            if (!proto.init) return;
            runRunner(objs, (obj) => obj.init?.());
        };
        tryInit(Room.prototype, Game.rooms);
        tryInit(Creep.prototype, Game.creeps);
        tryInit(PowerCreep.prototype, Game.powerCreeps);
        runCall('init');
        initOK = true;
        if (Game.shard.name === 'sim') return;
        if (Memory.lastinit) {
            log(name, `<b>挂载完成。[距离上次挂载 ${Game.time - Memory.lastinit} tick]</b>`);
        } else {
            log(name, `<b>挂载完成。</b>`);
        }
        Memory.lastinit = Game.time;
    };

    let _MemoryCache: Memory;
    let lastTime = 0;
    /** 内存缓存器 */
    const cacheMemory = () => {
        if (_MemoryCache && lastTime && Game.time === lastTime + 1) {
            delete (global as any).Memory;
            (global as any).Memory = _MemoryCache;
            RawMemory._parsed = (global as any).Memory;
        } else {
            _MemoryCache = (global as any).Memory;
        }
        lastTime = Game.time;
    };

    /** 主要逻辑 */
    const exec = () => {
        // 先更新 QoS（用于后续模块统一降级/节流的判定依据）
        global.qos.updateQoS();
        runInit();
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

    return { name, on, run };
};
