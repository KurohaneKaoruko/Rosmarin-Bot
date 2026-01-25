import { log } from '@/utils.js';
import { errorMapper } from './errorMapper.js'
import { BASE_CONFIG } from '@/constant/config.js'
import { updateQoS } from '@/modules/infra/qos.js';

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

    /**
     * perf 数据存放在 Memory.stats.perf
     * - 不强依赖 Statistics 模块是否启用；只是提供数据源
     * - HUD/日志侧想展示时再读取（例如插旗 /stats）
     */
    const ensurePerfRoot = () => {
        const mem = Memory as any;
        if (!mem.stats) mem.stats = {};
        if (!mem.stats.perf) mem.stats.perf = {};
        return mem.stats.perf as any;
    };

    /**
     * 轻量计时器：记录某段逻辑的 CPU 耗时（getUsed 差值）
     * 说明：这里刻意不做复杂统计（比如均值/滑窗），避免引入额外开销与噪声。
     */
    const measure = (perf: Record<string, number>, key: string, fn: RunnerFn) => {
        const start = Game.cpu.getUsed();
        fn();
        perf[key] = Game.cpu.getUsed() - start;
    };

    let initOK = false;
    const runInit = () => {
        if (initOK) return;
        const tryInit = (proto: any, objs: Record<string, any>) => {
            if (proto.init) Object.values(objs).forEach((o: any) => o.init());
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
        // 先更新 QoS（用于后续模块统一降级/节流的判定依据）
        updateQoS();
        const perfRoot = ensurePerfRoot();
        perfRoot.tick = Game.time;
        const perf: Record<string, number> = {};

        const execStart = Game.cpu.getUsed();
        runInit();
        measure(perf, 'event.start', () => runCall('start'));
        measure(perf, 'runner.room', () => runners.room());
        measure(perf, 'runner.creep', () => runners.creep());
        measure(perf, 'runner.powerCreep', () => runners.powerCreep());
        measure(perf, 'runner.flag', () => runners.flag());
        measure(perf, 'event.tick', () => runCall('tick'));
        measure(perf, 'event.end', () => runCall('end'));
        perf.total = Game.cpu.getUsed() - execStart;
        // last：只保留最近一次 tick 的分段耗时，避免 Memory 体积膨胀
        perfRoot.last = perf;
    };

    /** 运行 */
    const run = () => {
        cacheMemory();
        errorMapper(exec);
    };

    return { name, set, on, run };
};
