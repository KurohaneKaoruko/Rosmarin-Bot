import { MachineConfig, StateMachine } from './stateMachine';

// 统一的 source/target 两态模型
export const WORK_STATES = {
    SOURCE: 'source',
    TARGET: 'target'
} as const;

export type WorkState = typeof WORK_STATES[keyof typeof WORK_STATES];

// 迁移事件（必须显式触发）
export const WORK_EVENTS = {
    TO_SOURCE: 'TO_SOURCE',
    TO_TARGET: 'TO_TARGET',
    STAY: 'STAY'
} as const;

export type WorkEvent = typeof WORK_EVENTS[keyof typeof WORK_EVENTS];

// 迁移守卫（预留给条件判定）
export const WORK_GUARDS = {
    CAN_SWITCH: 'CAN_SWITCH'
} as const;

export type WorkGuard = typeof WORK_GUARDS[keyof typeof WORK_GUARDS];

// 运行上下文：当前 creep
export type WorkLayerContext = {
    creep: Creep;
};

// 状态回调：只返回事件，不直接切换状态
export type WorkStateHandlers = {
    onSource: (ctx: WorkLayerContext) => WorkEvent | void;
    onTarget: (ctx: WorkLayerContext) => WorkEvent | void;
};

// 创建标准 source/target 状态机
export const createWorkMachine = (
    handlers: WorkStateHandlers,
    storage: { get: () => WorkState | undefined; set: (state: WorkState) => void }
) => {
    const config: MachineConfig<WorkLayerContext, WorkState, WorkEvent, WorkGuard> = {
        initial: WORK_STATES.SOURCE,
        states: {
            [WORK_STATES.SOURCE]: {
                onTick: (ctx) => {
                    const event = handlers.onSource(ctx);
                    return event ? [event] : [];
                }
            },
            [WORK_STATES.TARGET]: {
                onTick: (ctx) => {
                    const event = handlers.onTarget(ctx);
                    return event ? [event] : [];
                }
            }
        },
        transitions: [
            { from: WORK_STATES.SOURCE, event: WORK_EVENTS.TO_TARGET, to: WORK_STATES.TARGET },
            { from: WORK_STATES.TARGET, event: WORK_EVENTS.TO_SOURCE, to: WORK_STATES.SOURCE },
            { from: WORK_STATES.SOURCE, event: WORK_EVENTS.STAY, to: WORK_STATES.SOURCE },
            { from: WORK_STATES.TARGET, event: WORK_EVENTS.STAY, to: WORK_STATES.TARGET }
        ]
    };
    return new StateMachine(config, storage);
};
