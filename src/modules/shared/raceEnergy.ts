/**
 * 冲级面板能量采样累加器：跨模块把「采集进账」汇入面板窗口采样。
 * 只做计数无逻辑——raceVisual 每个采样窗结算取走并归零。
 */
const minedAccum: Record<string, number> = {};

/** 记一笔源矿采集进账（harvest 成功后按 WORK×2 调用） */
export const raceEnergyMined = (roomName: string, amount: number): void => {
    minedAccum[roomName] = (minedAccum[roomName] || 0) + amount;
};

/** 取走自上次结算以来的进账累计（取走即归零） */
export const takeRaceEnergyMined = (roomName: string): number => {
    const v = minedAccum[roomName] || 0;
    delete minedAccum[roomName];
    return v;
};
