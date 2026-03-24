import { runWorkLayer } from './adapters';
import type { WorkEvent, WorkStateHandlers } from './workMachine';

// 统一的 creep 角色运行接口：
// exec 只需要调用 run，准备阶段由框架包装器自行处理。
export type CreepRoleHandler = {
    run: (creep: Creep) => void;
};

// 角色定义输入：
// 允许保留一个轻量 prepare，但它不会再暴露给 exec。
export type CreepRoleDefinition = {
    prepare?: (creep: Creep) => boolean;
    run: (creep: Creep) => void;
};

type BoostConfig = Record<string, string[]>;

type BoostConfigResolver = BoostConfig | ((creep: Creep) => BoostConfig | null | undefined);
type BoostMustResolver = boolean | ((creep: Creep) => boolean);

type BoostedRoleDefinition = {
    boost: BoostConfigResolver;
    must?: BoostMustResolver;
    run: (creep: Creep) => void;
};

type WorkLayerRoleDefinition = {
    prepare?: (creep: Creep) => boolean;
    onSource?: (creep: Creep) => WorkEvent;
    onTarget?: (creep: Creep) => WorkEvent;
    createHandlers?: (creep: Creep) => WorkStateHandlers;
    beforeRun?: (creep: Creep) => void;
    reenter?: boolean;
};

type StrategyRoleDefinition<Ctx> = {
    prepare?: (creep: Creep) => boolean;
    createContext: (creep: Creep) => Ctx;
    strategies: Array<{
        canRun: (ctx: Ctx) => boolean;
        run: (ctx: Ctx) => void;
    }>;
};

type PipelineRoleDefinition<Ctx, Value> = {
    prepare?: (creep: Creep) => boolean;
    createContext: (creep: Creep) => Ctx;
    initial: (ctx: Ctx) => Value;
    steps: Array<(value: any, ctx: Ctx) => any>;
};

// 统一处理 prepare：
// 准备未完成时直接返回，完成后同 tick 继续执行 run。
const runPrepare = (creep: Creep, prepare?: (creep: Creep) => boolean) => {
    if (!prepare) return true;
    if (creep.memory.ready) return true;

    creep.memory.ready = prepare(creep);
    return creep.memory.ready;
};

const resolveBoostConfig = (creep: Creep, boost: BoostConfigResolver) =>
    typeof boost === 'function' ? boost(creep) : boost;

const resolveBoostMust = (creep: Creep, must?: BoostMustResolver) =>
    typeof must === 'function' ? must(creep) : must;

// 最轻量包装：只负责把 prepare 收回框架内部。
export const createCreepRole = (definition: CreepRoleDefinition): CreepRoleHandler => ({
    run(creep: Creep) {
        if (!runPrepare(creep, definition.prepare)) return;
        definition.run(creep);
    }
});

// 简单战斗/工作角色常用包装：
// 业务层只给 boost 配置和 run，本包装负责完整 boost 流程。
export const createBoostedRole = (definition: BoostedRoleDefinition): CreepRoleHandler =>
    createCreepRole({
        prepare: (creep) => {
            if (creep.memory.boosted) return true;

            const boostmap = resolveBoostConfig(creep, definition.boost);
            if (!boostmap || Object.keys(boostmap).length === 0) {
                creep.memory.boosted = true;
                return true;
            }

            const must = resolveBoostMust(creep, definition.must);
            const result = must === undefined
                ? creep.goBoost(boostmap as any)
                : creep.goBoost(boostmap as any, { must });
            const ok = result === OK;
            if (ok) creep.memory.boosted = true;
            return ok;
        },
        run: definition.run
    });

// Source/Target 双态角色包装：
// 业务层只写 onSource/onTarget，WorkLayer 驱动由框架处理。
export const createWorkLayerRole = (definition: WorkLayerRoleDefinition): CreepRoleHandler =>
    createCreepRole({
        prepare: definition.prepare,
        run(creep: Creep) {
            definition.beforeRun?.(creep);

            const handlers: WorkStateHandlers = definition.createHandlers
                ? definition.createHandlers(creep)
                : {
                    onSource: ({ creep: current }) => definition.onSource!(current),
                    onTarget: ({ creep: current }) => definition.onTarget!(current),
                };

            runWorkLayer(creep, handlers, { reenter: definition.reenter });
        }
    });

// 简单策略分发包装：
// action 侧只给上下文构造和策略列表，框架负责按顺序挑第一个可执行策略。
export const createStrategyRole = <Ctx>(definition: StrategyRoleDefinition<Ctx>): CreepRoleHandler =>
    createCreepRole({
        prepare: definition.prepare,
        run(creep: Creep) {
            const ctx = definition.createContext(creep);
            const strategy = definition.strategies.find((candidate) => candidate.canRun(ctx));
            strategy?.run(ctx);
        }
    });

// 轻量管道包装：
// action 侧只保留一串按顺序执行的转换步骤，不再直接依赖 Effect/pipeEffect。
export const createPipelineRole = <Ctx, Value>(definition: PipelineRoleDefinition<Ctx, Value>): CreepRoleHandler =>
    createCreepRole({
        prepare: definition.prepare,
        run(creep: Creep) {
            const ctx = definition.createContext(creep);
            let value: any = definition.initial(ctx);
            for (const step of definition.steps) {
                value = step(value, ctx);
            }
        }
    });
