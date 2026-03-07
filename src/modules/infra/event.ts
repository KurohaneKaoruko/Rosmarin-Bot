/**
 * 轻量事件队列。
 *
 * 只保留最基础的能力：
 * 1. 按 `start / tick / end` 三个阶段执行。
 * 2. `when` 支持数字延时，或函数条件。
 * 3. `times` 支持执行次数，或函数终止条件。
 * 4. 提供 `add / cancel / get / list` 这组全局 API。
 *
 * 这里刻意不做复杂功能：
 * - 不做事件优先级。
 * - 不做持久化。
 * - 不做嵌套调度器。
 *
 * 目标就是提供一个项目内随手可用、行为稳定、容易看懂的最小事件系统。
 */

/**
 * 事件所处的生命周期阶段。
 * `EventModule` 会在每个游戏 tick 内分别调用这三个阶段，
 * 因此事件只要标记自己想运行在哪个阶段即可。
 */
export type EventPhase = 'start' | 'tick' | 'end';

/**
 * 事件执行时传给回调的上下文。
 *
 * 说明：
 * - `tick` 是当前执行时刻的 `Game.time`
 * - `createdTick` 是事件被创建时的 `Game.time`
 * - `runCount` 是“执行前”的历史执行次数
 *   例如第一次执行时这里是 0，第二次执行时这里是 1
 */
export type DelayEventContext<T = any> = {
    id: string;
    life: EventPhase;
    tick: number;
    createdTick: number;
    runCount: number;
    data?: T;
};

/**
 * 事件触发条件。
 * - 数字：表示延后多少 tick 后执行
 * - 函数：每次轮到该阶段时动态判断是否执行
 */
export type EventWhen<T = any> = number | ((ctx: DelayEventContext<T>) => boolean);

/**
 * 事件终止条件。
 * - 数字：最多执行多少次
 * - 函数：每次执行后根据上下文决定是否移除
 */
export type EventTimes<T = any> = number | ((ctx: DelayEventContext<T>) => boolean);

/**
 * 事件真正要执行的业务逻辑。
 */
export type EventExec<T = any> = (ctx: DelayEventContext<T>) => void;

/**
 * 外部添加事件时可传入的配置。
 * 这里故意只保留最少字段，避免模块重新膨胀。
 */
export interface DelayEventSpec<T = any> {
    life?: EventPhase;
    when?: EventWhen<T>;
    times?: EventTimes<T>;
    exec: EventExec<T>;
    data?: T;
}

/**
 * 事件在队列内部保存的完整结构。
 *
 * 和 `DelayEventSpec` 的区别：
 * - 内部一定有 `id`
 * - `life / when / times` 都会被补齐默认值
 * - `dueTick` 用于数字延时场景，避免每次重复计算
 * - `runCount` 记录已经执行过多少次
 */
export interface DelayEventRecord<T = any> extends DelayEventSpec<T> {
    id: string;
    life: EventPhase;
    when: EventWhen<T>;
    times: EventTimes<T>;
    createdTick: number;
    dueTick: number;
    runCount: number;
}

/**
 * 挂在 `global.event` 上的最小 API。
 * 这样项目其它地方不需要 import 也能直接调度事件。
 */
export interface EventAPI {
    add<T = any>(spec: DelayEventSpec<T>): string;
    cancel(id: string): boolean;
    get<T = any>(id: string): DelayEventRecord<T> | null;
    list<T = any>(phase?: EventPhase): DelayEventRecord<T>[];
}

// 默认阶段：不给 `life` 时，事件默认在常规 `tick` 阶段执行。
const DEFAULT_PHASE: EventPhase = 'tick';

// 默认触发时机：当前阶段立即可执行。
const DEFAULT_WHEN = 0;

// 默认执行次数：只执行一次。
const DEFAULT_TIMES = 1;

// 事件只放内存，不做跨 tick 序列化，由运行时统一驱动。
const events = new Map<string, DelayEventRecord<any>>();

// 用于在同一个 tick 内生成不重复的事件 ID。
let seq = 0;

/**
 * 判定传入值是不是合法的事件阶段。
 * 这里单独抽出来，能让 `addEvent` 主流程更干净。
 */
const isEventPhase = (value: unknown): value is EventPhase => (
    value === 'start' || value === 'tick' || value === 'end'
);

/**
 * 将外部传入的延时值收敛成安全整数。
 * 非法值统一按 0 处理，负数也会被钳制成 0。
 */
const normalizeDelay = (value: number): number => {
    const delay = Number(value);
    if (!Number.isFinite(delay)) return 0;
    return Math.max(0, Math.floor(delay));
};

/**
 * 规范化 `times` 配置。
 *
 * 规则：
 * - 未传时默认执行 1 次
 * - 函数原样保留
 * - 数字转成非负整数
 */
const normalizeTimes = <T>(value?: EventTimes<T>): EventTimes<T> => {
    if (value === undefined) return DEFAULT_TIMES;
    if (typeof value === 'function') return value;
    if (typeof value !== 'number') {
        throw new Error('[Event] invalid event spec: times must be number or function');
    }

    if (!Number.isFinite(value)) return DEFAULT_TIMES;
    return Math.max(0, Math.floor(value));
};

/**
 * 事件 ID 只要求在本局运行时内可区分即可，
 * 因此直接使用 `Game.time + 自增序号` 组合。
 */
const createId = (): string => `event:${Game.time}:${seq++}`;

/**
 * 每次执行回调前都即时构造上下文，
 * 确保回调里拿到的是当前最新的 `runCount / Game.time`。
 */
const createContext = <T>(event: DelayEventRecord<T>): DelayEventContext<T> => ({
    id: event.id,
    life: event.life,
    tick: Game.time,
    createdTick: event.createdTick,
    runCount: event.runCount,
    data: event.data,
});

// 对外返回副本，避免调用方意外改写内部队列状态。
const cloneEvent = <T>(event: DelayEventRecord<T>): DelayEventRecord<T> => ({ ...event });

/**
 * 判断事件当前这一轮是否应该执行。
 *
 * 两种情况：
 * - 数字延时：比较当前 tick 是否已经到达 `dueTick`
 * - 函数条件：把当前上下文交给调用方自行决定
 */
const shouldRun = <T>(event: DelayEventRecord<T>): boolean => {
    if (typeof event.when === 'number') return Game.time >= event.dueTick;

    try {
        return !!event.when(createContext(event));
    } catch (error) {
        console.log(`[Event] when failed: ${event.id}`, error);
        return false;
    }
};

/**
 * 执行前的快速移除判断。
 *
 * 只对 `times` 为数字的情况生效：
 * 如果事件已经达到最大执行次数，就不再进入本轮执行。
 */
const shouldRemoveBeforeRun = <T>(event: DelayEventRecord<T>): boolean => (
    typeof event.times === 'number' && event.runCount >= event.times
);

/**
 * 执行后的移除判断。
 *
 * 规则：
 * - `times` 为数字：达到次数上限后移除
 * - `times` 为函数：执行完后再用最新上下文判断是否终止
 *
 * 如果终止函数本身抛错，直接移除事件，避免它每 tick 持续报错。
 */
const shouldRemoveAfterRun = <T>(event: DelayEventRecord<T>): boolean => {
    if (typeof event.times === 'number') return event.runCount >= event.times;

    try {
        return !!event.times(createContext(event));
    } catch (error) {
        console.log(`[Event] times failed: ${event.id}`, error);
        return true;
    }
};

/**
 * 添加一个事件并返回事件 ID。
 *
 * 这里会完成两件事：
 * 1. 校验外部传入的配置是否合法
 * 2. 把可选字段补齐成内部统一格式
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

    const id = createId();
    const record: DelayEventRecord<T> = {
        id,
        life,
        when,
        times: normalizeTimes(spec.times),
        exec: spec.exec,
        data: spec.data,
        createdTick: Game.time,
        dueTick: typeof when === 'number' ? Game.time + normalizeDelay(when) : Game.time,
        runCount: 0,
    };

    events.set(id, record);
    return id;
};

/**
 * 主动取消事件。
 * 找到就删除并返回 `true`，不存在则返回 `false`。
 */
export const cancelEvent = (id: string): boolean => events.delete(id);

/**
 * 按 ID 获取事件快照。
 * 返回副本而不是原对象，避免外部直接污染内部状态。
 */
export const getEvent = <T = any>(id: string): DelayEventRecord<T> | null => {
    const event = events.get(id) as DelayEventRecord<T> | undefined;
    return event ? cloneEvent(event) : null;
};

/**
 * 列出当前事件队列。
 * 如果传了 `phase`，只返回对应阶段的事件。
 */
export const listEvents = <T = any>(phase?: EventPhase): DelayEventRecord<T>[] => {
    const list = Array.from(events.values()) as DelayEventRecord<T>[];
    return list
        .filter((event) => !phase || event.life === phase)
        .map(cloneEvent);
};

/**
 * 先拍平当前事件 ID，再顺序执行。
 * 这样本轮新增的同阶段事件只会留到下一轮，行为更稳定。
 */
export const runEventPhase = (phase: EventPhase): number => {
    const ids = Array.from(events.keys());
    let executed = 0;

    for (const id of ids) {
        const event = events.get(id) as DelayEventRecord | undefined;
        if (!event || event.life !== phase) continue;

        if (shouldRemoveBeforeRun(event)) {
            events.delete(id);
            continue;
        }

        if (!shouldRun(event)) continue;

        try {
            event.exec(createContext(event));
        } catch (error) {
            console.log(`[Event] exec failed: ${event.id}`, error);
            events.delete(id);
            continue;
        }

        event.runCount += 1;
        executed += 1;

        if (shouldRemoveAfterRun(event)) events.delete(id);
    }

    return executed;
};

/**
 * 对外暴露的全局事件对象。
 * 直接复用这些函数引用，不额外包一层。
 */
const eventApi: EventAPI = {
    add: addEvent,
    cancel: cancelEvent,
    get: getEvent,
    list: listEvents,
};

/**
 * 确保 `global.event` 已经挂载。
 * 多次调用也安全，只会在第一次真正赋值。
 */
export const ensureEventApi = (): EventAPI => {
    if (!global.event) global.event = eventApi;
    return global.event;
};

/**
 * 补充全局类型声明，让 `global.event` 有明确类型。
 */
declare global {
    namespace NodeJS {
        interface Global {
            event?: EventAPI;
        }
    }
}
