// 策略上下文的基础结构
export type StrategyContext = {
    id: string;
};

// 单个策略：可替换的算法族成员
export type Strategy<Ctx, Result> = {
    id: string;
    canRun: (ctx: Ctx) => boolean;
    run: (ctx: Ctx) => Result;
};

// 简易依赖注入容器：按注册顺序选择策略
export class StrategyContainer<Ctx, Result> {
    private strategies: Strategy<Ctx, Result>[] = [];

    // 注册策略
    register(strategy: Strategy<Ctx, Result>) {
        this.strategies.push(strategy);
    }

    // 解析策略（第一个 canRun 为 true 的策略）
    resolve(ctx: Ctx): Strategy<Ctx, Result> | null {
        for (const strategy of this.strategies) {
            if (strategy.canRun(ctx)) return strategy;
        }
        return null;
    }
}

// 执行策略（可提供 fallback）
export const runStrategy = <Ctx, Result>(
    container: StrategyContainer<Ctx, Result>,
    ctx: Ctx,
    fallback?: Strategy<Ctx, Result>
) => {
    const strategy = container.resolve(ctx) || fallback;
    return strategy ? strategy.run(ctx) : undefined;
};
