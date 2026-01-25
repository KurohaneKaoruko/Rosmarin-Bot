/**
 * QoS（Quality of Service）档位
 * - normal：资源充足，模块按正常频率运行
 * - constrained：资源紧张，建议对昂贵模块降频/限额
 * - emergency：资源告急，只保留关键逻辑，避免 CPU 自激振荡
 */
export type QoSLevel = 'normal' | 'constrained' | 'emergency';

export type QoSState = {
    level: QoSLevel;
    bucket: number;
    used: number;
    tick: number;
};

type ShouldRunOptions = {
    every?: number;
    minBucket?: number;
    allowLevels?: QoSLevel[];
    levelAtLeast?: QoSLevel;
};

const LEVEL_ORDER: Record<QoSLevel, number> = {
    emergency: 0,
    constrained: 1,
    normal: 2,
};

function ensureStatsRoot() {
    const mem = Memory as any;
    if (!mem.stats) mem.stats = {};
    if (!mem.stats.perf) mem.stats.perf = {};
}

/**
 * 每 tick 计算 QoS 档位，并同步到 global 与 Memory.stats
 * - global.QoS：便于模块在运行期直接读取（不写 Memory 也可用）
 * - Memory.stats.qos：便于 HUD/日志侧观测（本项目已有 Statistics 模块）
 */
export function updateQoS(): QoSState {
    const bucket = Number(Game.cpu.bucket || 0);
    const used = Number(Game.cpu.getUsed() || 0);

    let level: QoSLevel = 'normal';
    if (bucket < 2000) level = 'emergency';
    else if (bucket < 5000) level = 'constrained';

    const state: QoSState = { level, bucket, used, tick: Game.time };

    (global as any).QoS = state;
    ensureStatsRoot();
    (Memory.stats as any).qos = state;

    return state;
}

export function getQoS(): QoSState | null {
    return (global as any).QoS || null;
}

/**
 * 通用“是否执行”判定工具：用于后续把昂贵模块接入统一节流/降级策略
 * - every：每 N tick 执行一次
 * - minBucket：bucket 低于阈值则跳过
 * - allowLevels：只允许在指定 QoS 档位执行
 * - levelAtLeast：要求 QoS 至少达到某个档位（例如至少 constrained / normal）
 */
export function shouldRun(options: ShouldRunOptions = {}): boolean {
    const qos = getQoS();
    const every = options.every;
    if (every && every > 1 && Game.time % every !== 0) return false;

    if (options.minBucket != null) {
        const bucket = qos ? qos.bucket : Number(Game.cpu.bucket || 0);
        if (bucket < options.minBucket) return false;
    }

    if (options.allowLevels && options.allowLevels.length > 0) {
        const level = qos ? qos.level : 'normal';
        if (!options.allowLevels.includes(level)) return false;
    }

    if (options.levelAtLeast) {
        const level = qos ? qos.level : 'normal';
        if (LEVEL_ORDER[level] < LEVEL_ORDER[options.levelAtLeast]) return false;
    }

    return true;
}
