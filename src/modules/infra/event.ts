/**
 * 延时事件模块
 *
 * 用途：
 * - 让项目任意位置都能通过 `global.event.add(...)` 投递一个“未来某时机执行”的事件。
 * - 事件按生命周期阶段执行：`start | tick | end`（默认 `tick`，不支持 `init`）。
 *
 * 快速用法：
 * 1) 本 tick 执行一次（默认 tick 阶段）
 *    global.event.add({ exec: () => { ... } })
 *
 * 2) 延后 N tick 执行
 *    global.event.add({ when: 10, exec: () => { ... } })
 *
 * 3) 条件触发（每个对应阶段轮询条件）
 *    global.event.add({
 *      when: ({ tick }) => tick % 5 === 0,
 *      exec: () => { ... }
 *    })
 *
 * 4) 指定生命周期阶段
 *    global.event.add({ life: 'end', exec: () => { ... } })
 *
 * 5) 执行次数与终止条件
 *    - maxRuns：最多执行 N 次
 *      global.event.add({ maxRuns: 3, exec: () => { ... } })
 *    - stopWhen：返回 true 时终止（函数在每次 exec 之后判断）
 *      global.event.add({
 *        stopWhen: ({ runCount }) => runCount >= 2,
 *        exec: () => { ... }
 *      })
 *
 * 6) 运行时数据透传
 *    global.event.add({
 *      data: { roomName: 'W1N1' },
 *      exec: ({ data }) => { ... }
 *    })
 *
 * 7) 取消与查询
 *    const id = global.event.add({ exec: () => { ... } })
 *    global.event.get(id)
 *    global.event.list('tick')
 *    global.event.cancel(id)
 *
 * 关键语义（实现约束）：
 * - 事件存储在 `global` 内存中，不做 Memory 持久化；重挂载后不会保留。
 * - `when` 为 number 时表示相对当前 tick 的延迟（负数会按 0 处理）。
 * - 同一阶段执行过程中新增的事件，不会在本轮立即执行，而是下轮（通常下个 tick）执行。
 * - `exec` 抛错会记录日志并移除该事件，避免卡死队列。
 * - `stopWhen` 抛错会按“终止事件”处理，避免无限异常重试。
 */
export type EventPhase = 'start' | 'tick' | 'end';

export type DelayEventContext<T = any> = {
    id: string;
    life: EventPhase;
    tick: number;
    createdTick: number;
    runCount: number;
    data?: T;
};

export type EventWhen<T = any> = number | ((ctx: DelayEventContext<T>) => boolean);
export type EventStopWhen<T = any> = (ctx: DelayEventContext<T>) => boolean;
export type EventExec<T = any> = (ctx: DelayEventContext<T>) => void;

export interface DelayEventSpec<T = any> {
    when?: EventWhen<T>;
    life?: EventPhase;
    maxRuns?: number;
    stopWhen?: EventStopWhen<T>;
    exec: EventExec<T>;
    data?: T;
}

export interface DelayEventRecord<T = any> extends DelayEventSpec<T> {
    id: string;
    life: EventPhase;
    when: EventWhen<T>;
    maxRuns: number;
    stopWhen?: EventStopWhen<T>;
    createdTick: number;
    dueTick: number | null;
    runCount: number;
}

export interface EventAPI {
    add<T = any>(spec: DelayEventSpec<T>): string;
    cancel(id: string): boolean;
    get<T = any>(id: string): DelayEventRecord<T> | null;
    list<T = any>(phase?: EventPhase): DelayEventRecord<T>[];
}

const DEFAULT_PHASE: EventPhase = 'tick';
const DEFAULT_WHEN = 0;
const DEFAULT_MAX_RUNS = 1;
const EVENT_PHASES: readonly EventPhase[] = ['start', 'tick', 'end'];

// 分阶段队列：每个生命周期阶段独立管理，避免遍历时做无效判断
const phaseQueues: Record<EventPhase, Map<string, DelayEventRecord>> = {
    start: new Map(),
    tick: new Map(),
    end: new Map(),
};

let eventSeq = 0;

const isEventPhase = (value: unknown): value is EventPhase => (
    value === 'start' || value === 'tick' || value === 'end'
);

const normalizeDelay = (when: number): number => {
    const n = Number(when);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
};

const normalizeMaxRuns = (maxRuns: number): number => {
    const n = Number(maxRuns);
    if (!Number.isFinite(n)) return DEFAULT_MAX_RUNS;
    return Math.max(0, Math.floor(n));
};

const createEventId = () => `event:${Game.time}:${eventSeq++}`;

// 统一回调上下文，保证 when/maxRuns/stopWhen/exec 拿到一致的运行时信息
const createContext = <T>(event: DelayEventRecord<T>): DelayEventContext<T> => ({
    id: event.id,
    life: event.life,
    tick: Game.time,
    createdTick: event.createdTick,
    runCount: event.runCount,
    data: event.data,
});

const safePredicate = <T>(
    event: DelayEventRecord<T>,
    predicate: (ctx: DelayEventContext<T>) => boolean,
    stage: 'when' | 'stopWhen'
): boolean => {
    try {
        return !!predicate(createContext(event));
    } catch (error) {
        console.log(`[Event] ${stage} predicate failed: ${event.id}`, error);
        return stage === 'stopWhen';
    }
};

const shouldExecute = <T>(event: DelayEventRecord<T>): boolean => {
    if (typeof event.when === 'number') return Game.time >= (event.dueTick ?? Game.time);
    return safePredicate(event, event.when, 'when');
};

const hitRunLimit = <T>(event: DelayEventRecord<T>): boolean => {
    return event.runCount >= event.maxRuns;
};

const shouldFinish = <T>(event: DelayEventRecord<T>): boolean => {
    if (hitRunLimit(event)) return true;
    if (!event.stopWhen) return false;
    return safePredicate(event, event.stopWhen, 'stopWhen');
};

const cloneEvent = <T>(event: DelayEventRecord<T>): DelayEventRecord<T> => ({
    ...event,
});

export const addEvent = <T = any>(spec: DelayEventSpec<T>): string => {
    if (!spec || typeof spec.exec !== 'function') {
        throw new Error('[Event] invalid event spec: exec must be a function');
    }

    const life = spec.life ?? DEFAULT_PHASE;
    if (!isEventPhase(life)) {
        throw new Error('[Event] invalid event spec: life must be start/tick/end');
    }

    const when = spec.when ?? DEFAULT_WHEN;
    if (typeof when !== 'number' && typeof when !== 'function') {
        throw new Error('[Event] invalid event spec: when must be number or function');
    }

    const maxRuns = normalizeMaxRuns(spec.maxRuns ?? DEFAULT_MAX_RUNS);
    if (!Number.isFinite(maxRuns)) {
        throw new Error('[Event] invalid event spec: maxRuns must be a number');
    }

    if (spec.stopWhen && typeof spec.stopWhen !== 'function') {
        throw new Error('[Event] invalid event spec: stopWhen must be a function');
    }

    const id = createEventId();
    const dueTick = typeof when === 'number' ? Game.time + normalizeDelay(when) : null;
    const event: DelayEventRecord<T> = {
        id,
        life,
        when,
        maxRuns,
        stopWhen: spec.stopWhen,
        exec: spec.exec,
        data: spec.data,
        createdTick: Game.time,
        dueTick,
        runCount: 0,
    };

    phaseQueues[life].set(id, event);
    return id;
};

export const cancelEvent = (id: string): boolean => {
    for (const phase of EVENT_PHASES) {
        if (phaseQueues[phase].delete(id)) return true;
    }
    return false;
};

export const getEvent = <T = any>(id: string): DelayEventRecord<T> | null => {
    for (const phase of EVENT_PHASES) {
        const event = phaseQueues[phase].get(id) as DelayEventRecord<T> | undefined;
        if (event) return cloneEvent(event);
    }
    return null;
};

export const listEvents = <T = any>(phase?: EventPhase): DelayEventRecord<T>[] => {
    if (phase) {
        return Array.from(phaseQueues[phase].values()).map((event) => cloneEvent(event as DelayEventRecord<T>));
    }
    return EVENT_PHASES.flatMap((item) =>
        Array.from(phaseQueues[item].values()).map((event) => cloneEvent(event as DelayEventRecord<T>))
    );
};

export const runEventPhase = (phase: EventPhase): number => {
    const queue = phaseQueues[phase];
    if (!queue || queue.size === 0) return 0;

    // 先快照再遍历：确保“本轮执行中新增的事件”不会在本轮被执行
    const ids = Array.from(queue.keys());
    let executed = 0;
    for (const id of ids) {
        const event = queue.get(id);
        if (!event) continue;

        if (hitRunLimit(event)) {
            queue.delete(id);
            continue;
        }

        if (!shouldExecute(event)) continue;

        try {
            event.exec(createContext(event));
        } catch (error) {
            console.log(`[Event] exec failed: ${event.id}`, error);
            queue.delete(id);
            continue;
        }

        event.runCount += 1;
        executed += 1;
        if (shouldFinish(event)) queue.delete(id);
    }

    return executed;
};

const eventApi: EventAPI = {
    add: addEvent,
    cancel: cancelEvent,
    get: getEvent,
    list: listEvents,
};

export const ensureEventApi = (): EventAPI => {
    if (!global.event) global.event = eventApi;
    return global.event;
};

declare global {
    namespace NodeJS {
        interface Global {
            event?: EventAPI;
        }
    }
}
