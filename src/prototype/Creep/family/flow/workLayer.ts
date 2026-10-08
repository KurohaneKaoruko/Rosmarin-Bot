// source/target 双相切换骨架：只接收两相回调，基于 memory.working 切换，不含业务策略。
// 迁移事件（必须显式触发）
export const WORK_EVENTS = {
    TO_SOURCE: 'TO_SOURCE',
    TO_TARGET: 'TO_TARGET',
    STAY: 'STAY'
} as const;

export type WorkEvent = typeof WORK_EVENTS[keyof typeof WORK_EVENTS];

// 状态回调：直接收当前 creep，只返回事件，不直接切换状态。
export type WorkStateHandlers = {
    onSource: (creep: Creep) => WorkEvent | void;
    onTarget: (creep: Creep) => WorkEvent | void;
};

const WORK_LAYER_STATE = {
    SOURCE: 'source',
    TARGET: 'target'
} as const;

type WorkLayerState = typeof WORK_LAYER_STATE[keyof typeof WORK_LAYER_STATE];

const getWorkLayerState = (creep: Creep): WorkLayerState =>
    creep.memory.working ? WORK_LAYER_STATE.TARGET : WORK_LAYER_STATE.SOURCE;

const setWorkLayerState = (creep: Creep, state: WorkLayerState) => {
    creep.memory.working = state === WORK_LAYER_STATE.TARGET;
};

const runWorkLayerState = (
    handlers: WorkStateHandlers,
    creep: Creep,
    state: WorkLayerState
) => {
    return state === WORK_LAYER_STATE.TARGET
        ? handlers.onTarget(creep)
        : handlers.onSource(creep);
};

const resolveNextWorkLayerState = (state: WorkLayerState, event: ReturnType<typeof runWorkLayerState>): WorkLayerState => {
    if (event === WORK_EVENTS.TO_TARGET) return WORK_LAYER_STATE.TARGET;
    if (event === WORK_EVENTS.TO_SOURCE) return WORK_LAYER_STATE.SOURCE;
    return state;
};

// 双相流转入口：执行当前相回调，按返回事件切换 working，切换当刻默认重入新相。
export const runWorkLayer = (
    creep: Creep,
    handlers: WorkStateHandlers,
    options: { reenter?: boolean } = {}
) => {
    const from = getWorkLayerState(creep);
    const event = runWorkLayerState(handlers, creep, from);
    const to = resolveNextWorkLayerState(from, event);
    const transitioned = to !== from;

    if (transitioned) {
        setWorkLayerState(creep, to);
        if (options.reenter ?? true) {
            runWorkLayerState(handlers, creep, to);
        }
    }

    return {
        transitioned,
        from,
        to,
        event,
    };
};
