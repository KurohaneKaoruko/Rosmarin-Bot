// 服务器能力配置：schema 与默认值在此（共享层），每个入口（= 每个服务器的代码）
// 启动时用 configureServerCaps 声明自己的档位，共享代码的能力闸据此生效。
// 官服 main.ts 不置位——全部按默认值（官服口径）旁路。
// 单向依赖：共享代码只读本配置，不感知具体 variant。

import type { RoomModeName } from '@/modules/shared/roomMode';

/** 服务器能力配置项（各服配置文件的数据结构，见 branch/<规则>/config.ts） */
export type ServerCaps = {
    /** race 规则档兼容：产出就绪闸门等 race 特有闸 */
    raceCompat: boolean;
    /** 冲级数据面板（左下角 rush 面板 + race 记账；RCL8 锁定/无源服无意义） */
    racePanel: boolean;
    /** 小队孵化前的 boost 资源检查（关闭时跳过检查与 boost 任务下发） */
    boostResCheck: boolean;
    /** 孵化挂单入池/挑选时的能量闸（关闭时大体型直入池，可孵性交由引擎裁决） */
    energyCheck: boolean;
    /** 不自动建造的结构类型（布局照常规划，仅放置时跳过；核心仓库 storage/terminal 不适用） */
    skipBuildTypes: string[];
    /** 结构类型 → 最低建造等级（达到前不放该类工地；未配置的类型按引擎口径） */
    buildMinLevel: Record<string, number>;
    /** 房间默认档：非 auto 时替代「订阅档位」兜底（显式 room.mode 配置仍最优先） */
    defaultRoomMode: 'auto' | RoomModeName;
};

const caps: ServerCaps = {
    raceCompat: false,
    racePanel: true,
    boostResCheck: true,
    energyCheck: true,
    skipBuildTypes: [],
    buildMinLevel: {},
    defaultRoomMode: 'auto',
};

export const configureServerCaps = (partial: Partial<ServerCaps>): void => {
    Object.assign(caps, partial);
};

export const isRaceCompat = (): boolean => caps.raceCompat;

export const isRacePanelEnabled = (): boolean => caps.racePanel;

export const isBoostResCheckEnabled = (): boolean => caps.boostResCheck;

export const isEnergyCheckEnabled = (): boolean => caps.energyCheck;

export const getSkipBuildTypes = (): readonly string[] => caps.skipBuildTypes;

export const getBuildMinLevel = (): Readonly<Record<string, number>> => caps.buildMinLevel;

export const getDefaultRoomMode = (): 'auto' | RoomModeName => caps.defaultRoomMode;
