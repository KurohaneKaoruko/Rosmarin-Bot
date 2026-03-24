import { beginInterShardTick, cleanupInterShardLocalRoot, endInterShardTick } from '@/features/interShard';

/**
 * 跨 shard 协同运行时模块。
 *
 * @remarks
 * - `start`：建立本 tick 的跨 shard 上下文；
 * - `end`：清理本地临时根并提交 tick 末尾状态。
 */
const InterShardModule = {
    /**
     * tick 开始阶段：初始化跨 shard 运行上下文。
     */
    start: function () {
        beginInterShardTick();
    },
    /**
     * tick 结束阶段：清理并收尾跨 shard 状态。
     */
    end: function () {
        cleanupInterShardLocalRoot();
        endInterShardTick();
    },
};

export { InterShardModule };
