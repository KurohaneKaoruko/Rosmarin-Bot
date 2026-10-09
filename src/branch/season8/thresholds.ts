// 赛季专属阈值：共享 THRESHOLDS 未包含的项（高能模式升级 / 控制器拥堵），仅本变体消费。
// 与共享 @/constant/Thresholds 同名结构，便于覆盖处理器按原写法取值。
export const SEASON8_THRESHOLDS = {
    UPGRADE: {
        /** 各 RCL 下「高能模式升级窗口」所需的最低全房能量 */
        HIGH_MODE_MIN_ENERGY: {
            RCL5: 20000,
            RCL6: 40000,
            RCL7: 80000,
            RCL8: 120000,
        },
        LOGISTICS_SCORE_PER_UPGRADER: 1.1,
        HIGH_MODE_MAX_UPGRADER: 8,
    },
    UNIVERSAL: {
        /** 高能档下取能门槛（低于共享档，鼓励持续升级而非囤能） */
        HIGH_MODE_MIN_CONTAINER_AMOUNT: 180,
        HIGH_MODE_MIN_DROPPED_AMOUNT: 35,
        /** 控制器拥堵判定：范围内升级者数 ≥ 阈值即视为拥堵 */
        CONTROLLER_CONGESTION_RANGE: 3,
        CONTROLLER_CONGESTION_UPGRADER_THRESHOLD: 2,
    },
} as const;

/** 按房间等级取「高能模式升级窗口」的最低能量门槛。 */
export const getHighModeUpgradeMinEnergy = (level: number): number => {
    const table = SEASON8_THRESHOLDS.UPGRADE.HIGH_MODE_MIN_ENERGY;
    if (level >= 8) return table.RCL8;
    if (level >= 7) return table.RCL7;
    if (level >= 6) return table.RCL6;
    if (level >= 5) return table.RCL5;
    return 0;
};
