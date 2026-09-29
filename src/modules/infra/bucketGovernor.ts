/**
 * CPU 桶闭环调控（Tier 1-3）。
 *
 * 把 CPU 桶当作被控变量，用积分控制器实时调节「外矿活跃阈值」：
 * - 桶高于目标 → 阈值下降 → 更多外矿激活
 * - 桶低于目标 → 阈值上升 → 低性价比外矿按 score 挂起
 *
 * 消费方：externalMine 的 runEnergy/runCenter 用 score 对比阈值，
 * score = 净收益/tick ÷ 孵化占用（见 estimateTargetSelectionStat）。
 *
 * 与 QoS 的分工：governor 管「业务开多少」（平滑可逆），QoS 管「单 tick 硬兜底」。
 */

const TARGET_BUCKET = 9000;      // 桶目标水位
const KI = 0.0008 / 1e6;         // 积分增益
const THRESHOLD_MAX = 2;         // 阈值钳制上限（score 量级 0.1~3）
const SYNC_INTERVAL = 300;       // 常态下 activeThreshold 的同步间隔
const BIG_MOVE_ERROR = 2000;     // 误差超过此值立即同步（快速收缩/扩张）

/** 每 tick 调用一次：更新外矿活跃阈值 */
export const updateBucketGovernor = (): void => {
    const mem = Memory as any;
    mem.remoteThreshold ??= 0;
    mem.activeThresholdUpdated ??= 0;

    const bucket = Game.cpu.bucket || 0;
    const error = bucket - TARGET_BUCKET;

    // 桶高 → 阈值降（扩外矿）；桶低 → 阈值升（挂起低性价比外矿）
    mem.remoteThreshold = Math.max(
        0,
        Math.min(THRESHOLD_MAX, mem.remoteThreshold - KI * error)
    );

    // 大幅变化立即生效；小幅变化 300 tick 冷却同步（防抖动）
    if (Math.abs(error) > BIG_MOVE_ERROR || Game.time - mem.activeThresholdUpdated >= SYNC_INTERVAL) {
        mem.activeThreshold = mem.remoteThreshold;
        mem.activeThresholdUpdated = Game.time;
    }
};

/** 当前生效的外矿活跃阈值（score 低于此值的外矿应挂起） */
export const getActiveRemoteThreshold = (): number => (Memory as any).activeThreshold ?? 0;
