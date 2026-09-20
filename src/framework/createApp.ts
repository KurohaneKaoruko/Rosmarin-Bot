import { log } from '@/utils.js';
import { errorMapper, sourceMappedStackTrace } from './errorMapper.js'
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
        room: () => runRunner(Game.rooms, roomRunner, 'room'),
        creep: () => runRunner(Game.creeps, creepRunner, 'creep'),
        powerCreep: () => runRunner(Game.powerCreeps, powerCreepRunner, 'pc'),
        flag: () => runRunner(Game.flags, flagRunner, 'flag'),
    };

    const hasOwnProperty = Object.prototype.hasOwnProperty;

    // ── 调用点错误隔离───────────────────
    // 任何一个 creep/房间/模块的异常只损失自己，不再中止整 tick 后续执行；
    // 错误聚合到 tick 末统一输出（限流防刷屏），连续报错的 creep 自动回收。
    type CollectedError = { context: string; error: unknown };
    let collectedErrors: CollectedError[] = [];
    const errorStreak = new Map<string, { count: number; lastTick: number }>();
    const ERROR_PRINT_LIMIT = 5;        // 每 tick 最多打印的堆栈数
    const ERROR_STREAK_SILENCE = 10;    // 连续报错 tick 数达到后静默
    const ERROR_STREAK_RECYCLE = 30;    // creep 连续报错 tick 数达到后自动回收

    const collectRunnerError = (context: string, error: unknown): void => {
        collectedErrors.push({ context, error });
        const message = error instanceof Error ? error.message : String(error);
        const key = `${context}:${message}`;
        const streak = errorStreak.get(key) ?? { count: 0, lastTick: -1 };
        streak.count = Game.time - streak.lastTick === 1 ? streak.count + 1 : 1;
        streak.lastTick = Game.time;
        errorStreak.set(key, streak);
    };

    const flushCollectedErrors = (): void => {
        if (collectedErrors.length === 0) return;
        const errors = collectedErrors;
        collectedErrors = [];

        for (const { context, error } of errors.slice(0, ERROR_PRINT_LIMIT)) {
            const message = error instanceof Error ? sourceMappedStackTrace(error) : String(error);
            log(`<text style="color:#ef9a9a">[${context}] ${message}</text>`);
        }
        if (errors.length > ERROR_PRINT_LIMIT) {
            log(`[错误隔离] 本 tick 另有 ${errors.length - ERROR_PRINT_LIMIT} 条错误被抑制`);
        }

        // 毒 creep 自动回收：连续多个 tick 每次执行都报错 → 已是僵尸，清掉让孵化重置
        for (const [key, streak] of errorStreak) {
            if (streak.count >= ERROR_STREAK_RECYCLE && streak.lastTick === Game.time) {
                const name = key.slice(0, key.indexOf(':'));
                const creep = Game.creeps[name];
                if (creep) {
                    creep.suicide();
                    errorStreak.delete(key);
                    log(`[错误隔离] creep ${name} 连续 ${ERROR_STREAK_RECYCLE} tick 报错，已自动回收`);
                }
            }
        }
        // 清理过期 streak，防止 Map 无限增长
        if (errorStreak.size > 200) {
            for (const [key, streak] of errorStreak) {
                if (Game.time - streak.lastTick > 100) errorStreak.delete(key);
            }
        }
    };

    const runRunner = <T>(objs: Record<string, T>, runner: (obj: T) => void, contextPrefix: string) => {
        for (const id in objs) {
            if (!hasOwnProperty.call(objs, id)) continue;
            try {
                runner(objs[id]);
            } catch (e) {
                collectRunnerError(`${contextPrefix}:${id}`, e);
            }
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

    /** 运行模块（模块间同样互相隔离） */
    const runCall = (type: EventType) => {
        modules[type].forEach((cb, index) => {
            try {
                cb();
            } catch (e) {
                collectRunnerError(`module:${type}:${index}`, e);
            }
        });
    };

    let initOK = false;
    const runInit = () => {
        if (initOK) return;
        const tryInit = (proto: { init?: () => void }, objs: Record<string, any>) => {
            if (!proto.init) return;
            runRunner(objs, (obj) => obj.init?.(), 'init');
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
        // tick 末统一输出隔离收集的错误
        flushCollectedErrors();
    };

    /** 运行 */
    const run = () => {
        cacheMemory();
        errorMapper(exec);
    };

    return { name, on, run };
};
