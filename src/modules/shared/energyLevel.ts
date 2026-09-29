/**
 * 统一能量度量（Tier 1-4）。
 *
 * 把房间的储能折算成一个跨 RCL 可比的数：
 * - 低于本级「标准储量」→ 0~100 线性比例（100 = 刚好达标）
 * - 超出标准储量 → 每 1500 能量 +1（衡量富余程度）
 *
 * 阈值因此跨 RCL 可比："level < 30 = 紧急" "level >= 100 = 可支援"
 * 这类语义不再需要每级单独写数字。
 */

// 各 RCL 的标准储量（storage + terminal 能量口径）
const STANDARD_RESERVE_BY_LEVEL: Record<number, number> = {
    1: 10000,
    2: 10000,
    3: 10000,
    4: 20000,
    5: 40000,
    6: 80000,
    7: 160000,
    8: 320000,
};

const FUNNEL_SURPLUS_STEP = 1500;

/** 本级标准储量 */
export const getStandardReserve = (level: number): number => STANDARD_RESERVE_BY_LEVEL[level] ?? 10000;

/** 计算房间能量等级（storage + terminal 能量口径） */
export const getEnergyLevel = (room: Room): number => {
    const standard = getStandardReserve(room.level);
    const total = (room.storage?.store[RESOURCE_ENERGY] || 0) + (room.terminal?.store[RESOURCE_ENERGY] || 0);
    if (total < standard) return Math.floor((100 * total) / standard);
    return 100 + Math.round((total - standard) / FUNNEL_SURPLUS_STEP);
};
