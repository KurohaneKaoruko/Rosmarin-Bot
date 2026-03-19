import { LayeredStateMachine, StateMachine, StateId, EventId, GuardId, StepOptions, TransitionResult } from './stateMachine';
import { createWorkMachine, WORK_STATES, WorkLayerContext, WorkStateHandlers } from './workMachine';

// 记忆适配器：读写到 creep.memory
type MemoryStateStorage<S extends StateId> = {
    get: () => S | undefined;
    set: (state: S) => void;
};

// 确保 creep.memory 自身是可写对象：
// 某些脏数据场景下，memory 可能被写成 null / 数组 / 原始值，
// 此时继续访问 memory.fsm 会直接抛异常，因此要先把根容器修正回来。
const ensureCreepMemoryObject = (creep: Creep): CreepMemory => {
    if (creep.memory == null || typeof creep.memory !== 'object' || Array.isArray(creep.memory)) {
        (creep as Creep & { memory: CreepMemory }).memory = {} as CreepMemory;
    }
    return creep.memory;
};

// 确保 fsm 容器存在
export const ensureFsmBucket = <T extends StateId = StateId>(creep: Creep): Record<string, T> => {
    const memory = ensureCreepMemoryObject(creep);

    // 防御异常 fsm 结构（如被写成 null / 数组 / 非对象），统一重置为对象容器。
    if (memory.fsm == null || typeof memory.fsm !== 'object' || Array.isArray(memory.fsm)) {
        memory.fsm = {};
    }
    return memory.fsm as Record<string, T>;
};

// 多层 FSM 状态存储：写入 creep.memory.fsm
export const createFsmStorage = <S extends StateId>(creep: Creep, layerId: string): MemoryStateStorage<S> => {
    return {
        get: () => {
            const bucket = ensureFsmBucket<S>(creep);
            return bucket[layerId];
        },
        set: (state) => {
            const bucket = ensureFsmBucket<S>(creep);
            bucket[layerId] = state;
        }
    };
};

// 兼容旧 memory.working 的状态存储
export const createWorkingStorage = <S extends StateId>(
    creep: Creep,
    map: { source: S; target: S }
): MemoryStateStorage<S> => ({
    get: () => (creep.memory.working ? map.target : map.source),
    set: (state) => {
        creep.memory.working = state === map.target;
    }
});

// 统一执行器：返回每层的迁移结果
export type LayeredRunner<Ctx> = {
    machine: LayeredStateMachine<Ctx>;
    step: (ctx: Ctx, options?: Record<string, StepOptions<EventId>>) => Record<string, TransitionResult<StateId, EventId>>;
};

// 创建多层状态机运行器
export const createLayeredRunner = <Ctx>(
    layers: Record<string, StateMachine<Ctx, StateId, EventId, GuardId>>,
    selector?: (ctx: Ctx) => string[]
): LayeredRunner<Ctx> => {
    const machine = new LayeredStateMachine<Ctx>(layers, selector);
    return {
        machine,
        step: (ctx, options) => machine.step(ctx, options)
    };
};

// 旧 source/target 模式的快速迁移入口
export const runWorkLayer = (
    creep: Creep,
    handlers: WorkStateHandlers,
    options: { reenter?: boolean } = {}
) => {
    const storage = createWorkingStorage(creep, {
        source: WORK_STATES.SOURCE,
        target: WORK_STATES.TARGET
    });
    const machine = createWorkMachine(handlers, storage);
    const runner = createLayeredRunner<WorkLayerContext>({ work: machine });
    runner.step({ creep }, { work: { reenter: options.reenter ?? true } });
    return runner;
};
