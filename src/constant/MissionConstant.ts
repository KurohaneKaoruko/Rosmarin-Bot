/**
 * 任务池词表（单一来源）。
 * 池名常量供池操作与提交方引用；类型联合以 interface/mission.interface.ts 的 ambient 声明为准，
 * MISSION_POOL_NAMES 用 satisfies 与 MissionPoolName 编译期互检，新增池名必须两处同步。
 */
export const MISSION_POOL_NAMES = [
    'transport',
    'build',
    'repair',
    'terminal',
    'spawn',
    'mine',
    'boost',
] as const satisfies readonly MissionPoolName[];

export type MissionPoolId = (typeof MISSION_POOL_NAMES)[number];

/** 池名常量表：MISSION_POOLS.spawn 代替字面量 'spawn'（值类型为键字面量） */
export const MISSION_POOLS = Object.freeze(
    Object.fromEntries(MISSION_POOL_NAMES.map((name) => [name, name])),
) as { readonly [K in MissionPoolId]: K };
