/**
 * Creep 单 tick 行为标记。
 *
 * @remarks
 * 标记只保留在当前 tick，下一 tick 自动失效。
 * 用于避免同一 tick 内后续逻辑覆盖先前已经下发的关键动作（例如接力后的 move 意图）。
 */
export const CREEP_TICK_ACTION = {
    RELAY_GIVE: 'relay-give',
    RELAY_RECEIVE: 'relay-receive',
} as const;

export type CreepTickActionType = typeof CREEP_TICK_ACTION[keyof typeof CREEP_TICK_ACTION];

type TickActionState = {
    tick: number;
    actions: Set<CreepTickActionType>;
};

type CreepWithTickAction = Creep & {
    __tickActionState?: TickActionState;
};

/**
 * 读取或创建当前 tick 的动作状态容器。
 *
 * @param creep 目标 creep（扩展了临时状态字段）。
 * @returns 当前 tick 对应的动作状态对象。
 */
const ensureTickActionState = (creep: CreepWithTickAction): TickActionState => {
    const existing = creep.__tickActionState;
    if (existing && existing.tick === Game.time) return existing;

    const state: TickActionState = {
        tick: Game.time,
        actions: new Set<CreepTickActionType>(),
    };
    creep.__tickActionState = state;
    return state;
};

/**
 * 记录 creep 在当前 tick 已经执行过的关键行为。
 *
 * @param creep 目标 creep。
 * @param action 行为标记。
 */
export const markCreepTickAction = (creep: Creep, action: CreepTickActionType): void => {
    const state = ensureTickActionState(creep as CreepWithTickAction);
    state.actions.add(action);
};

/**
 * 判断 creep 在当前 tick 是否已被打上指定行为标记。
 *
 * @param creep 目标 creep。
 * @param action 行为标记。
 * @returns `true` 表示当前 tick 已记录该行为。
 */
export const hasCreepTickAction = (creep: Creep, action: CreepTickActionType): boolean => {
    const state = (creep as CreepWithTickAction).__tickActionState;
    if (!state || state.tick !== Game.time) return false;
    return state.actions.has(action);
};
