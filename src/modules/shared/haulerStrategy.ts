/**
 * 搬运工策略数学（配对/预期产量/接力判据纯函数）。
 *
 * 纯函数与按 tick 分代的预订账本，无游戏全局依赖，可独立单测。
 */

/**
 * 途中预期产出增量：搬运路程内的持续采集产出。
 *
 * - 路程短于再生周期：产出受源头存量封顶（`min(energy, 采集力×路程)`）
 * - 路程越过再生周期：存量部分照计，越过段按采集力线性累计
 * - 无采集力或已到场：增量为 0
 */
export const expectedOutputDelta = (input: {
    energy: number;
    harvestPower: number;
    distance: number;
    regenTime: number;
}): number => {
    const { energy, harvestPower, distance, regenTime } = input;
    if (harvestPower <= 0 || distance <= 0) return 0;
    if (distance < regenTime) return Math.min(energy, harvestPower * distance);
    return Math.min(energy, harvestPower * regenTime) + harvestPower * (distance - regenTime);
};

/**
 * 按 tick 分代的源线容量预订账本：认领即预扣，换 tick 自动清零。
 *
 * 用于防扎堆——多个空载搬运工同 tick 选线时，先认领者预扣自身容量，
 * 后续者看到的待运量是扣除预订后的净值。
 */
export const createPendingLedger = () => {
    let tick = -1;
    const reserved = new Map<string, number>();
    const ensureTick = (current: number) => {
        if (tick !== current) {
            tick = current;
            reserved.clear();
        }
    };
    return {
        /** 指定源线的当前已预订量（换 tick 自动归零） */
        reservedOf(key: string, currentTick: number): number {
            ensureTick(currentTick);
            return reserved.get(key) ?? 0;
        },
        /** 认领预订：为该源线预扣 capacity */
        reserve(key: string, currentTick: number, amount: number): void {
            ensureTick(currentTick);
            reserved.set(key, (reserved.get(key) ?? 0) + amount);
        },
    };
};

/**
 * 卸货止盈选择：storage 优先承接主仓，
 * terminal 仅按止盈水位补线（能量低于水位且有空位）；两者皆不可用返回 null 走承接链。
 */
export const selectCarryDeposit = (input: {
    storageFree: number;
    terminalEnergy: number;
    terminalFree: number;
    storageMinFree: number;
    terminalEnergyLine: number;
}): 'storage' | 'terminal' | null => {
    if (input.storageFree > input.storageMinFree) return 'storage';
    if (input.terminalEnergy < input.terminalEnergyLine && input.terminalFree > 0) return 'terminal';
    return null;
};

/**
 * 相向对穿互换判据。
 *
 * 全部条件满足才允许对穿能量移交：双方相位相反、均未在本 tick 接力过/撤退中、
 * 意图格互指（对方要踏进的格 = 我的位置）、容量相等、供方 TTL > 50（快死的能量不做半程交接）。
 */
export const evaluateHeadOnSwap = (input: {
    supplying: boolean;
    otherSupplying: boolean;
    otherRetreat: boolean;
    otherRelayed: boolean;
    selfRelayed: boolean;
    coordsInterlocked: boolean;
    capacityEqual: boolean;
    supplierTtl: number;
}): boolean =>
    !input.selfRelayed
    && !input.otherRetreat
    && !input.otherRelayed
    && input.supplying !== input.otherSupplying
    && input.coordsInterlocked
    && input.capacityEqual
    && input.supplierTtl > 50;
