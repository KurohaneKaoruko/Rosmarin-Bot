// season8 独立内存区：`Memory.RosmarinBot.Season8Data`。
// 与共享 memory.ts 解耦，仅本变体读写，避免污染主线内存 schema。
import { getBotMemory } from '@/modules/shared/memory';

/** 赛季运行快照与规划状态（结构见 Season8Module 写入字段）。 */
export function getSeason8Data(): any {
    const mem = getBotMemory() as any;
    mem.Season8Data ??= {};
    mem.Season8Data.rooms ??= {};
    mem.Season8Data.frontier ??= {};
    mem.Season8Data.cpuBudget ??= { tick: 0, bucket: 0, used: 0, level: 'normal' };
    return mem.Season8Data;
}
