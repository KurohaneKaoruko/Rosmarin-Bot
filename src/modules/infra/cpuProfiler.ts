import { getStatsMemory } from '@/modules/shared/memory';
/**
 * CPU 观测（Tier 0-4）。
 *
 * 默认关闭、生产零开销；开启方式：控制台执行 getStatsMemory().profiler = true
 * （关闭：delete getStatsMemory().profiler）。
 *
 * - profileStage：阶段采样，滚动 50 tick 均值（rooms/creeps/start/end…）
 * - recordObjectCost：单对象成本，仅记录最近一个采样 tick 的 top 排行
 * - getProfilerReport：配合控制台 diag.cpu() 查看报告
 *
 * 注意：开启时每个对象多两次 Game.cpu.getUsed() 调用，仅用于排障，不要常开。
 */

const STAGE_HISTORY_LIMIT = 50;

const stageHistory = new Map<string, number[]>();
let lastTickObjectCosts: { context: string; cpu: number }[] = [];
let lastProfiledTick = -1;

export const isProfilingEnabled = (): boolean => {
    const mem = Memory as any;
    return !!mem.stats?.profiler;
};

/** 包装一个阶段：采样其 CPU 开销（未开启时零额外成本，仅一次布尔判断） */
export const profileStage = <T>(stage: string, fn: () => T): T => {
    if (!isProfilingEnabled()) return fn();
    const start = Game.cpu.getUsed();
    try {
        return fn();
    } finally {
        const cost = Game.cpu.getUsed() - start;
        const arr = stageHistory.get(stage) ?? [];
        arr.push(cost);
        if (arr.length > STAGE_HISTORY_LIMIT) arr.shift();
        stageHistory.set(stage, arr);
    }
};

/** 记录单对象（creep/房间）本 tick 的 CPU 开销 */
export const recordObjectCost = (context: string, cpu: number): void => {
    if (Game.time !== lastProfiledTick) {
        lastProfiledTick = Game.time;
        lastTickObjectCosts = [];
    }
    lastTickObjectCosts.push({ context, cpu });
};

/** 生成诊断报告（阶段均值排行 + 最近采样 tick 的对象成本排行） */
export const getProfilerReport = () => ({
    stages: Array.from(stageHistory.entries())
        .map(([stage, arr]) => ({
            stage,
            avg: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3),
            samples: arr.length,
        }))
        .sort((a, b) => b.avg - a.avg),
    lastTickTopObjects: [...lastTickObjectCosts].sort((a, b) => b.cpu - a.cpu).slice(0, 20),
    note: '开启: getStatsMemory().profiler = true / 关闭: delete getStatsMemory().profiler',
});
