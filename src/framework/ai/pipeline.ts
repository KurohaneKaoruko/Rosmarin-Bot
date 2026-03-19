// Effect 运行轨迹：用于副作用可观测
export type EffectTrace = {
    label: string;
    detail?: any;
};

// Effect Monad：将副作用集中封装
export class Effect<Ctx, T> {
    private runner: (ctx: Ctx, trace: EffectTrace[]) => T;

    // runner 只允许在 run 时触发
    constructor(runner: (ctx: Ctx, trace: EffectTrace[]) => T) {
        this.runner = runner;
    }

    // 纯值封装
    static of<Ctx, T>(value: T): Effect<Ctx, T> {
        return new Effect(() => value);
    }

    // 执行副作用并记录 trace
    static perform<Ctx, T>(label: string, fn: (ctx: Ctx) => T): Effect<Ctx, T> {
        return new Effect((ctx, trace) => {
            const value = fn(ctx);
            trace.push({ label });
            return value;
        });
    }

    // 纯映射
    map<U>(fn: (value: T) => U): Effect<Ctx, U> {
        return new Effect((ctx, trace) => fn(this.runner(ctx, trace)));
    }

    // 纯链式组合
    flatMap<U>(fn: (value: T) => Effect<Ctx, U>): Effect<Ctx, U> {
        return new Effect((ctx, trace) => fn(this.runner(ctx, trace)).runner(ctx, trace));
    }

    // 纯观察（不改变值）
    tap(fn: (value: T) => void): Effect<Ctx, T> {
        return new Effect((ctx, trace) => {
            const value = this.runner(ctx, trace);
            fn(value);
            return value;
        });
    }

    // 执行并返回结果 + 轨迹
    run(ctx: Ctx): { value: T; trace: EffectTrace[] } {
        const trace: EffectTrace[] = [];
        const value = this.runner(ctx, trace);
        return { value, trace };
    }
}

// 组合多个 Effect 步骤（多数步骤保持纯计算）
export const pipeEffect = <Ctx, T>(initial: Effect<Ctx, T>, ...steps: Array<(input: Effect<Ctx, any>) => Effect<Ctx, any>>) =>
    steps.reduce((acc, step) => step(acc), initial) as Effect<Ctx, any>;
