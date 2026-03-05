/**
 * 延时事件模块（简化版）
 *
 * 用法：
 * - 在任意位置调用 `global.event.add(...)` 添加事件。
 * - 在 `EventModule` 的 `start/tick/end` 阶段调用 `runEventPhase(...)` 执行。
 * - 支持 `when`（延时/条件）、`maxRuns`（最大次数）、`stopWhen`（终止条件）和 `data` 透传。
 */

/** 事件执行阶段（不包含 init） */
export type EventPhase = 'start' | 'tick' | 'end';

/** 事件执行上下文 */
export type DelayEventContext<T = any> = {
    id: string;
    life: EventPhase;
    tick: number;
    createdTick: number;
    runCount: number;
    data?: T;
};

/** 事件触发条件：延时 N tick 或函数条件 */
export type EventWhen<T = any> = number | ((ctx: DelayEventContext<T>) => boolean);

/** 事件终止条件：返回 true 时终止 */
export type EventStopWhen<T = any> = (ctx: DelayEventContext<T>) => boolean;

/** 事件执行函数 */
export type EventExec<T = any> = (ctx: DelayEventContext<T>) => void;

/** 添加事件时的配置 */
export interface DelayEventSpec<T = any> {
    when?: EventWhen<T>;
    life?: EventPhase;
    maxRuns?: number;
    stopWhen?: EventStopWhen<T>;
    exec: EventExec<T>;
    data?: T;
}

/** 事件内部记录结构 */
export interface DelayEventRecord<T = any> extends DelayEventSpec<T> {
    id: string;
    life: EventPhase;
    when: EventWhen<T>;
    maxRuns: number;
    createdTick: number;
    dueTick: number | null;
    runCount: number;
}

/** 挂载到 global.event 的 API */
export interface EventAPI {
    add<T = any>(spec: DelayEventSpec<T>): string;
    cancel(id: string): boolean;
    get<T = any>(id: string): DelayEventRecord<T> | null;
    list<T = any>(phase?: EventPhase): DelayEventRecord<T>[];
}

const DEFAULT_PHASE: EventPhase = 'tick';
const DEFAULT_WHEN = 0;
const DEFAULT_MAX_RUNS = 1;

const events = new Map<string, DelayEventRecord>();
let seq = 0;

const isEventPhase = (value: unknown): value is EventPhase => (
    value === 'start' || value === 'tick' || value === 'end'
);

const normalizeDelay = (value: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
};

const normalizeMaxRuns = (value?: number): number => {
    const n = Number(value ?? DEFAULT_MAX_RUNS);
    if (!Number.isFinite(n)) return DEFAULT_MAX_RUNS;
    return Math.max(0, Math.floor(n));
};

const createId = () => `event:${Game.time}:${seq++}`;

const createContext = <T>(event: DelayEventRecord<T>): DelayEventContext<T> => ({
    id: event.id,
    life: event.life,
    tick: Game.time,
    createdTick: event.createdTick,
    runCount: event.runCount,
    data: event.data,
});

const cloneEvent = <T>(event: DelayEventRecord<T>): DelayEventRecord<T> => ({ ...event });

const shouldRunByWhen = <T>(event: DelayEventRecord<T>): boolean => {
    if (typeof event.when === 'number') return Game.time >= (event.dueTick ?? Game.time);

    try {
        return !!event.when(createContext(event));
    } catch (error) {
        console.log(`[Event] when failed: ${event.id}`, error);
        return false;
    }
};

const shouldStop = <T>(event: DelayEventRecord<T>): boolean => {
    if (event.runCount >= event.maxRuns) return true;
    if (!event.stopWhen) return false;

    try {
        return !!event.stopWhen(createContext(event));
    } catch (error) {
        // stopWhen 抛错时直接终止，避免事件持续报错
        console.log(`[Event] stopWhen failed: ${event.id}`, error);
        return true;
    }
};

/**
 * 添加事件并返回事件 ID。
 */
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

    if (spec.stopWhen && typeof spec.stopWhen !== 'function') {
        throw new Error('[Event] invalid event spec: stopWhen must be a function');
    }

    const id = createId();
    const dueTick = typeof when === 'number' ? Game.time + normalizeDelay(when) : null;
    const record: DelayEventRecord<T> = {
        id,
        life,
        when,
        maxRuns: normalizeMaxRuns(spec.maxRuns),
        stopWhen: spec.stopWhen,
        exec: spec.exec,
        data: spec.data,
        createdTick: Game.time,
        dueTick,
        runCount: 0,
    };

    events.set(id, record);
    return id;
};

/**
 * 取消事件。
 */
export const cancelEvent = (id: string): boolean => events.delete(id);

/**
 * 根据 ID 获取事件（返回副本）。
 */
export const getEvent = <T = any>(id: string): DelayEventRecord<T> | null => {
    const event = events.get(id) as DelayEventRecord<T> | undefined;
    return event ? cloneEvent(event) : null;
};

/**
 * 列出事件（返回副本）。
 */
export const listEvents = <T = any>(phase?: EventPhase): DelayEventRecord<T>[] => {
    const list = Array.from(events.values()) as DelayEventRecord<T>[];
    if (!phase) return list.map(cloneEvent);
    return list.filter((event) => event.life === phase).map(cloneEvent);
};

/**
 * 执行某个阶段的事件队列，返回本次执行数量。
 *
 * 说明：先快照 ID，再遍历，可保证“本轮新增事件不会在本轮执行”。
 */
export const runEventPhase = (phase: EventPhase): number => {
    const ids = Array.from(events.keys());
    let executed = 0;

    for (const id of ids) {
        const event = events.get(id);
        if (!event) continue;
        if (event.life !== phase) continue;

        if (event.runCount >= event.maxRuns) {
            events.delete(id);
            continue;
        }

        if (!shouldRunByWhen(event)) continue;

        try {
            event.exec(createContext(event));
        } catch (error) {
            console.log(`[Event] exec failed: ${event.id}`, error);
            events.delete(id);
            continue;
        }

        event.runCount += 1;
        executed += 1;

        if (shouldStop(event)) events.delete(id);
    }

    return executed;
};

const eventApi: EventAPI = {
    add: addEvent,
    cancel: cancelEvent,
    get: getEvent,
    list: listEvents,
};

/**
 * 确保全局事件 API 已挂载。
 */
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
