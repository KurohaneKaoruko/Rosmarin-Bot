// 行为树节点返回码（Success/Failure/Running）
export enum BtStatus {
    Success = 'Success',
    Failure = 'Failure',
    Running = 'Running'
}

// 行为树节点接口
export type BtNode<Ctx> = {
    tick: (ctx: Ctx) => BtStatus;
};

// 工厂函数：用于动态构造节点
export type BtFactory<Ctx> = () => BtNode<Ctx>;

// 固定 Success 节点
export const succeed = <Ctx>(): BtNode<Ctx> => ({
    tick: () => BtStatus.Success
});

// 固定 Failure 节点
export const fail = <Ctx>(): BtNode<Ctx> => ({
    tick: () => BtStatus.Failure
});

// 固定 Running 节点
export const running = <Ctx>(): BtNode<Ctx> => ({
    tick: () => BtStatus.Running
});

// 叶子节点（自定义逻辑）
export const leaf = <Ctx>(fn: (ctx: Ctx) => BtStatus): BtNode<Ctx> => ({
    tick: fn
});

// 条件节点：按条件选择分支
export const condition = <Ctx>(predicate: (ctx: Ctx) => boolean, onTrue: BtNode<Ctx>, onFalse: BtNode<Ctx>) =>
    leaf<Ctx>((ctx) => (predicate(ctx) ? onTrue.tick(ctx) : onFalse.tick(ctx)));

// 顺序节点：遇到 Failure/Running 即停止
export const sequence = <Ctx>(...nodes: BtNode<Ctx>[]): BtNode<Ctx> => ({
    tick: (ctx) => {
        for (const node of nodes) {
            const result = node.tick(ctx);
            if (result !== BtStatus.Success) return result;
        }
        return BtStatus.Success;
    }
});

// 选择节点：遇到 Success/Running 即停止
export const selector = <Ctx>(...nodes: BtNode<Ctx>[]): BtNode<Ctx> => ({
    tick: (ctx) => {
        for (const node of nodes) {
            const result = node.tick(ctx);
            if (result !== BtStatus.Failure) return result;
        }
        return BtStatus.Failure;
    }
});

// 重复节点：条件满足则 Success，否则执行子节点
export const repeatUntil = <Ctx>(predicate: (ctx: Ctx) => boolean, node: BtNode<Ctx>): BtNode<Ctx> => ({
    tick: (ctx) => {
        if (predicate(ctx)) return BtStatus.Success;
        const result = node.tick(ctx);
        if (result === BtStatus.Failure) return BtStatus.Failure;
        return BtStatus.Running;
    }
});

export class BehaviorTree<Ctx> {
    private root: BtNode<Ctx>;

    // 行为树实例：只保存根节点
    constructor(root: BtNode<Ctx>) {
        this.root = root;
    }

    // 执行根节点
    tick(ctx: Ctx): BtStatus {
        return this.root.tick(ctx);
    }
}

// 子树注册表：用于热插拔
export class BehaviorTreeRegistry<Ctx> {
    private nodes: Record<string, BtNode<Ctx>> = {};

    // 注册节点
    register(name: string, node: BtNode<Ctx>) {
        this.nodes[name] = node;
    }

    // 替换节点（热插拔）
    swap(name: string, node: BtNode<Ctx>) {
        this.nodes[name] = node;
    }

    // 读取节点
    resolve(name: string): BtNode<Ctx> | null {
        return this.nodes[name] || null;
    }
}

// 热插拔代理：运行时优先取注册表节点
export const hotSwap = <Ctx>(
    registry: BehaviorTreeRegistry<Ctx>,
    slot: string,
    fallback: BtNode<Ctx>
): BtNode<Ctx> =>
    leaf<Ctx>((ctx) => {
        const node = registry.resolve(slot) || fallback;
        return node.tick(ctx);
    });
