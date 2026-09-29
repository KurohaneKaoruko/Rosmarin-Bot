import { log } from '@/utils.js';
import { errorMapper, sourceMappedStackTrace } from './errorMapper.js'
import { isProfilingEnabled, profileStage, recordObjectCost } from '@/modules/infra/cpuProfiler';
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
        creep: () => runCreeps(),
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
    const RECYCLE_COOLDOWN_TICKS = 1500;// 同角色两次回收的最小间隔（≈一个 creep 寿命）
    // 回收冷却（运行时态，代码重新推送后自动清零）：防止确定性错误触发
    // 「孵化→报错→自杀→再孵化」的能量空转循环——同角色至多 1 次回收 / 1500 tick。
    const recycleCooldownByRole = new Map<string, number>();

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

        // 毒 creep 自动回收：连续多个 tick 每次执行都报错 → 已是僵尸，清掉让孵化重置。
        // 但同角色受 1500 tick 冷却限制：确定性代码错误不会触发「孵化→自杀」能量空转循环。
        for (const [key, streak] of errorStreak) {
            if (streak.count < ERROR_STREAK_RECYCLE || streak.lastTick !== Game.time) continue;
            const name = key.slice(0, key.indexOf(':'));
            const creep = Game.creeps[name];
            if (!creep) continue;
            const role = String(creep.memory?.role ?? 'unknown');
            const lastRecycle = recycleCooldownByRole.get(role) ?? -Infinity;
            if (Game.time - lastRecycle < RECYCLE_COOLDOWN_TICKS) continue; // 冷却期内：静默保留，交由隔离兜底
            recycleCooldownByRole.set(role, Game.time);
            creep.suicide();
            log(`[错误隔离] creep ${name} 连续 ${ERROR_STREAK_RECYCLE} tick 报错，已自动回收（${role} 角色进入 ${RECYCLE_COOLDOWN_TICKS} tick 回收冷却）`);
        }
        // 清理过期 streak，防止 Map 无限增长
        if (errorStreak.size > 200) {
            for (const [key, streak] of errorStreak) {
                if (Game.time - streak.lastTick > 100) errorStreak.delete(key);
            }
        }
    };

    const runRunner = <T>(objs: Record<string, T>, runner: (obj: T) => void, contextPrefix: string) => {
        const profiling = isProfilingEnabled();
        for (const id in objs) {
            if (!hasOwnProperty.call(objs, id)) continue;
            if (!profiling) {
                try {
                    runner(objs[id]);
                } catch (e) {
                    collectRunnerError(`${contextPrefix}:${id}`, e);
                }
                continue;
            }
            // 采样模式：额外记录单对象 CPU 开销
            const start = Game.cpu.getUsed();
            try {
                runner(objs[id]);
            } catch (e) {
                collectRunnerError(`${contextPrefix}:${id}`, e);
            } finally {
                recordObjectCost(`${contextPrefix}:${id}`, Game.cpu.getUsed() - start);
            }
        }
    };

    // creep 的公平轮转游标：CPU 预算耗尽被顺延的 creep，下一 tick 优先执行
    let creepCursor = 0;

    /**
     * creep 专用 runner：带 CPU 预算闸与公平轮转。
     *
     * 社区标准防超时做法：不再「全量跑、超了被引擎逐个掐断」（超时报错刷屏 +
     * 被掐 creep 的动作丢失），而是在预算线（cpuLimit×0.85）处停止启动新 creep，
     * 剩余 creep 顺延到下一 tick 优先执行（游标轮转，公平不饿死）。
     */
    const runCreeps = () => {
        const profiling = isProfilingEnabled();
        const keys = Object.keys(Game.creeps);
        const total = keys.length;
        if (total === 0) return;

        const limit = Game.cpu.limit || 20;
        const softCap = limit * 0.85;
        const start = creepCursor % total;
        let ran = 0;

        for (let k = 0; k < total; k += 1) {
            if (Game.cpu.getUsed() > softCap) break;
            const creep = Game.creeps[keys[(start + k) % total]];
            if (!creep) continue;
            ran += 1;
            const id = keys[(start + k) % total];
            if (!profiling) {
                try {
                    creepRunner(creep);
                } catch (e) {
                    collectRunnerError(`creep:${id}`, e);
                }
                continue;
            }
            const startCpu = Game.cpu.getUsed();
            try {
                creepRunner(creep);
            } catch (e) {
                collectRunnerError(`creep:${id}`, e);
            } finally {
                recordObjectCost(`creep:${id}`, Game.cpu.getUsed() - startCpu);
            }
        }
        creepCursor = (start + ran) % total;
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
        profileStage('start', () => runCall('start'));
        profileStage('rooms', () => runners.room());
        profileStage('creeps', () => runCreeps());
        profileStage('powerCreeps', () => runners.powerCreep());
        profileStage('flags', () => runners.flag());
        profileStage('tick', () => runCall('tick'));
        profileStage('end', () => runCall('end'));
        // tick 末统一输出隔离收集的错误
        flushCollectedErrors();
        // 上报本 tick CPU：连续超限触发 QoS 熔断降级（bucket 满时 QoS 原判定看不到超限）
        global.qos.noteTickCpu(Game.cpu.getUsed());
    };

    /** 运行 */
    const run = () => {
        cacheMemory();
        errorMapper(exec);
        // 序列化节流：显式调用 RawMemory.set 后，
        // 引擎会跳过 tick 末的默认 Memory 序列化。Memory 上 MB 时这是每 tick 1~3 CPU 的固定开销。
        // 30 tick 窗口平衡 CPU 收益与全局重置时的丢失风险；
        // cacheMemory 已持有 _MemoryCache 引用，与此机制兼容。
        if (Game.time % 30 === 0) RawMemory.set(JSON.stringify(Memory));
    };

    return { name, on, run };
};
