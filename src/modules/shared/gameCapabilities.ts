// 规则档能力开关：非官服入口启动时置位，共享代码的能力闸据此生效。
// 官服 main.ts 不置位——闸门全部旁路，官服行为保持纯净。
// 单向依赖：共享代码只读本开关，不感知具体 variant

let raceCompat = false;

export const enableRaceCompat = (): void => {
    raceCompat = true;
};

export const isRaceCompat = (): boolean => raceCompat;
