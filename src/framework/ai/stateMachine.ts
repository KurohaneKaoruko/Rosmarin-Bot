// 状态机基础类型：状态、事件、守卫标识
export type StateId = string;
export type EventId = string;
export type GuardId = string;

export type Transition<S extends StateId, E extends EventId, G extends GuardId> = {
    from: S;
    event: E;
    to: S;
    guard?: G;
};

// 守卫函数映射：用常量名注册，集中管理迁移条件
export type GuardMap<Ctx, G extends GuardId> = Record<G, (ctx: Ctx) => boolean>;

// 单状态处理器：进入/退出/每 tick 处理
export type StateHandler<Ctx, S extends StateId, E extends EventId> = {
    onEnter?: (ctx: Ctx, event?: E) => void;
    onExit?: (ctx: Ctx, event?: E) => void;
    onTick?: (ctx: Ctx) => E[] | void;
};

// 状态机配置：初始状态、状态处理器、迁移表、守卫表
export type MachineConfig<Ctx, S extends StateId, E extends EventId, G extends GuardId> = {
    initial: S;
    states: Record<S, StateHandler<Ctx, S, E>>;
    transitions: Array<Transition<S, E, G>>;
    guards?: GuardMap<Ctx, G>;
};

// 状态存储适配：允许对接 creep.memory 等
export type StateStorage<S extends StateId> = {
    get: () => S | undefined;
    set: (state: S) => void;
};

// step 执行参数：外部事件、最大迁移次数、是否重入
export type StepOptions<E extends EventId> = {
    externalEvents?: E[];
    maxTransitions?: number;
    reenter?: boolean;
};

// step 结果：是否发生迁移、from/to、触发事件
export type TransitionResult<S extends StateId, E extends EventId> = {
    transitioned: boolean;
    from: S;
    to: S;
    event?: E;
};

export class StateMachine<Ctx, S extends StateId, E extends EventId, G extends GuardId> {
    private config: MachineConfig<Ctx, S, E, G>;
    private storage: StateStorage<S>;

    // 绑定配置与存储；当存储为空时写入初始状态
    constructor(config: MachineConfig<Ctx, S, E, G>, storage: StateStorage<S>) {
        this.config = config;
        this.storage = storage;
        if (!this.storage.get()) {
            this.storage.set(this.config.initial);
        }
    }

    // 获取当前状态（存储为空时回退到初始状态）
    get state(): S {
        return (this.storage.get() || this.config.initial) as S;
    }

    // 直接写入状态（供外部初始化/恢复使用）
    setState(state: S) {
        this.storage.set(state);
    }

    // 执行一步：由 onTick 生成事件并尝试迁移
    step(ctx: Ctx, options: StepOptions<E> = {}): TransitionResult<S, E> {
        const current = this.state;
        const handler = this.config.states[current];
        const internalEvents = handler?.onTick?.(ctx) || [];
        const events = [...internalEvents, ...(options.externalEvents || [])];
        const maxTransitions = Math.max(0, options.maxTransitions ?? events.length);

        let result: TransitionResult<S, E> = {
            transitioned: false,
            from: current,
            to: current
        };
        // 多事件串行消费时，使用实时状态继续匹配后续事件
        let currentState = current;
        // 限制单次 step 的迁移次数，避免在单 tick 中过度迁移
        let transitionedCount = 0;

        for (let i = 0; i < events.length; i++) {
            if (maxTransitions > 0 && transitionedCount >= maxTransitions) break;
            const event = events[i];
            const transition = this.findTransition(currentState, event, ctx);
            if (!transition) continue;
            this.applyTransition(ctx, transition, event);
            transitionedCount++;
            currentState = transition.to;
            result = { transitioned: true, from: current, to: currentState, event };
        }

        if (result.transitioned && options.reenter) {
            const nextHandler = this.config.states[this.state];
            nextHandler?.onTick?.(ctx);
        }

        return result;
    }

    // 立即派发单个事件
    dispatch(ctx: Ctx, event: E): TransitionResult<S, E> {
        const current = this.state;
        const transition = this.findTransition(current, event, ctx);
        if (!transition) {
            return { transitioned: false, from: current, to: current };
        }
        this.applyTransition(ctx, transition, event);
        return { transitioned: true, from: current, to: transition.to, event };
    }

    // 按事件筛选迁移，并依次应用守卫
    private findTransition(state: S, event: E, ctx: Ctx): Transition<S, E, G> | undefined {
        const transitions = this.config.transitions.filter((t) => t.from === state && t.event === event);
        if (transitions.length === 0) return undefined;
        for (const transition of transitions) {
            if (!transition.guard) return transition;
            const guard = this.config.guards?.[transition.guard];
            if (guard && guard(ctx)) return transition;
        }
        return undefined;
    }

    // 执行迁移：退出 -> 写入状态 -> 进入
    private applyTransition(ctx: Ctx, transition: Transition<S, E, G>, event: E) {
        const current = this.state;
        const currentHandler = this.config.states[current];
        currentHandler?.onExit?.(ctx, event);
        this.storage.set(transition.to);
        const nextHandler = this.config.states[transition.to];
        nextHandler?.onEnter?.(ctx, event);
    }
}

export type LayerSelector<Ctx> = (ctx: Ctx) => string[];

// 多层状态机：按层并行执行（每层只负责一种行为类别）
export class LayeredStateMachine<Ctx> {
    private layers: Record<string, StateMachine<Ctx, StateId, EventId, GuardId>>;
    private selector?: LayerSelector<Ctx>;

    constructor(
        layers: Record<string, StateMachine<Ctx, StateId, EventId, GuardId>>,
        selector?: LayerSelector<Ctx>
    ) {
        this.layers = layers;
        this.selector = selector;
    }

    // 执行所有激活层
    step(ctx: Ctx, options?: Record<string, StepOptions<EventId>>) {
        const active = this.selector ? this.selector(ctx) : Object.keys(this.layers);
        const results: Record<string, TransitionResult<StateId, EventId>> = {};
        for (const id of active) {
            const layer = this.layers[id];
            if (!layer) continue;
            results[id] = layer.step(ctx, options?.[id]);
        }
        return results;
    }

    // 获取指定层状态
    getState(layerId: string): StateId {
        return this.layers[layerId].state;
    }

    // 设置指定层状态
    setState(layerId: string, state: StateId) {
        this.layers[layerId].setState(state);
    }
}
