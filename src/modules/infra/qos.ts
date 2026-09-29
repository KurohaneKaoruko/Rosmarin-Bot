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

export type QoSAPI = {
    updateQoS: () => QoSState;
    getQoS: () => QoSState | null;
    shouldRun: (options?: ShouldRunOptions) => boolean;
    isTickAligned: (mod: number, offset?: number, tick?: number) => boolean;
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

/**
 * 检查当前 tick 是否与 modulo 对齐
 * @param mod  modulo 值
 * @param offset 偏移量（默认 0）
 * @param tick 当前 tick（默认 Game.time）
 * @returns 是否对齐
 */
export const isTickAligned = (mod: number, offset = 0, tick = Game.time) => {
    const normalized = ((offset % mod) + mod) % mod
    return tick % mod === normalized
}

/**
 * 角色牺牲顺序表（emergency 档冻结顺序）。
 *
 * 按「单 tick 开销 × 暂停可逆性」排出的牺牲顺序：
 * - **正值**：emergency 也要保的角色——战斗/防御（>0 最高保）、
 *   后勤保命链（harvester/carrier/transporter/manager/universal）；
 * - **负值**：CPU 告急时最先牺牲的角色——升级/建造类单 tick 开销最大、
 *   且暂停若干 tick 无不可逆损失（升级类 -10 最先冻结，建造类 -5 次之）；
 * - **0（缺省）**：未登记角色一律不冻结——安全默认，新角色忘了登记也不会在 emergency 消失。
 *
 * 初版仅 `emergency` 档（bucket<2000）生效；`constrained`/`normal` 行为不变，
 * 零感知上线后再按实测调参。
 */
export const ROLE_CPU_FREEZE_PRIORITY: Record<string, number> = {
    // —— 最先冻结：升级类 ——
    'upgrader': -10,
    'up-upgrade': -10,
    'aid-upgrade': -8,
    // —— 其次：建造/维修/清理/侦察 ——
    'worker': -5,
    'cleaner': -4,
    'scout': -3,
    'up-repair': -2,
    // —— 保命链：正分，emergency 永不冻结（显式登记以表达牺牲顺序）——
    'harvester': 10,
    'universal': 5,
    'carrier': 1,
    'transporter': 1,
    'manager': 1,
};

/** emergency 档下该角色是否应被冻结（跳过本 tick 执行） */
export function shouldSkipCreepInEmergency(role?: string): boolean {
    const qos = getQoS();
    if (!qos || qos.level !== 'emergency') return false;
    return (ROLE_CPU_FREEZE_PRIORITY[role || ''] ?? 0) < 0;
}

const qosApi: QoSAPI = {
    updateQoS,
    getQoS,
    shouldRun,
    isTickAligned,
};

/**
 * 挂载 QoS 全局 API（global.qos）
 * 说明：仅需在入口 main.ts 引入本模块，即可自动完成挂载。
 */
export function mountQoS(): QoSAPI {
    if (!global.qos) global.qos = qosApi;
    return global.qos;
}

// 模块加载即挂载，供全局直接调用 global.qos.xxx
mountQoS();

declare global {
    namespace NodeJS {
        interface Global {
            qos: QoSAPI;
            QoS?: QoSState;
        }
    }
}
