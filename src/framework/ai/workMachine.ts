// 迁移事件（必须显式触发）
export const WORK_EVENTS = {
    TO_SOURCE: 'TO_SOURCE',
    TO_TARGET: 'TO_TARGET',
    STAY: 'STAY'
} as const;

export type WorkEvent = typeof WORK_EVENTS[keyof typeof WORK_EVENTS];

// 运行上下文：当前 creep
export type WorkLayerContext = {
    creep: Creep;
};

// 状态回调：只返回事件，不直接切换状态
export type WorkStateHandlers = {
    onSource: (ctx: WorkLayerContext) => WorkEvent | void;
    onTarget: (ctx: WorkLayerContext) => WorkEvent | void;
};
