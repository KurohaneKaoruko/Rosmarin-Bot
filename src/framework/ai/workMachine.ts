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
