import { StateMachine } from '@/framework/ai/stateMachine';
import { createFsmStorage, createLayeredRunner } from '@/framework/ai/adapters';

const NEAR_RANGE = 2;
const SOURCE_RANGE = 1;
const STAY_BUILD_RANGE = 3;

// 多层 FSM layer 标识：同一 creep 的不同层写入不同 key，避免冲突
export const HARVESTER_LAYERS = {
    FLOW: 'harvester:flow',
    DELIVER: 'harvester:deliver'
} as const;

// 能量流转层：只负责“采集 / 交付”的节奏切换
export const HARVESTER_FLOW_STATES = {
    COLLECT: 'collect',
    DELIVER: 'deliver'
} as const;
type HarvesterFlowState = typeof HARVESTER_FLOW_STATES[keyof typeof HARVESTER_FLOW_STATES];

const HARVESTER_FLOW_EVENTS = {
    HAS_ENERGY: 'has_energy',
    NEED_ENERGY: 'need_energy'
} as const;
type HarvesterFlowEvent = typeof HARVESTER_FLOW_EVENTS[keyof typeof HARVESTER_FLOW_EVENTS];

const HARVESTER_FLOW_GUARDS = {
    HAS_ENERGY: 'has_energy',
    NEED_ENERGY: 'need_energy'
} as const;
type HarvesterFlowGuard = typeof HARVESTER_FLOW_GUARDS[keyof typeof HARVESTER_FLOW_GUARDS];

// 交付层：只负责“转移 / 建造”两种交付方式的切换
export const HARVESTER_DELIVER_STATES = {
    TRANSFER: 'transfer',
    BUILD: 'build'
} as const;
type HarvesterDeliverState = typeof HARVESTER_DELIVER_STATES[keyof typeof HARVESTER_DELIVER_STATES];

const HARVESTER_DELIVER_EVENTS = {
    NEED_BUILD: 'need_build',
    NEED_TRANSFER: 'need_transfer'
} as const;
type HarvesterDeliverEvent = typeof HARVESTER_DELIVER_EVENTS[keyof typeof HARVESTER_DELIVER_EVENTS];

const HARVESTER_DELIVER_GUARDS = {
    NEED_BUILD: 'need_build',
    NEED_TRANSFER: 'need_transfer'
} as const;
type HarvesterDeliverGuard = typeof HARVESTER_DELIVER_GUARDS[keyof typeof HARVESTER_DELIVER_GUARDS];

type HarvesterContext = {
    creep: Creep;
    // 是否允许进入交付行为（用于避免采集阶段和交付阶段同 tick 冲突）
    allowDeliver: boolean;
};

const getHarvesterFlowState = (creep: Creep): HarvesterFlowState => {
    return (creep.memory.fsm?.[HARVESTER_LAYERS.FLOW] as HarvesterFlowState | undefined) || HARVESTER_FLOW_STATES.COLLECT;
};

const shouldRunDeliverLayer = (ctx: HarvesterContext): boolean => {
    if (!ctx.allowDeliver) return false;
    return getHarvesterFlowState(ctx.creep) === HARVESTER_FLOW_STATES.DELIVER;
};

/**
 * 查找适合投递的 Link
 * @description 要求房间 RCL>=5，Link 在 source 附近且未满
 */
function findTransferLink(creep: Creep, source: Source): StructureLink | null {
    if (creep.room.level < 5) return null;
    const links = creep.room.link;
    if (!links) return null;
    return links.find(l => l.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && source.pos.inRangeTo(l, NEAR_RANGE)) ?? null;
}

/**
 * 查找 Creep 附近的任意 Link
 * @description 用于交付层判断，主要关心“有没有可投递结构”
 */
function findAnyNearbyLink(creep: Creep): StructureLink | null {
    const links = creep.room.link;
    if (!links) return null;
    return links.find(l => l.pos.inRangeTo(creep.pos, NEAR_RANGE)) ?? null;
}

/**
 * 查找 Creep 附近的任意 Container
 * @description 用于交付层判断，主要关心“有没有可投递结构”
 */
function findAnyNearbyContainer(creep: Creep): StructureContainer | null {
    const containers = creep.room.container;
    if (!containers) return null;
    const candidates = containers.filter(c => c.pos.inRangeTo(creep.pos, NEAR_RANGE));
    if (candidates.length === 0) return null;
    return creep.pos.findClosestByRange(candidates) ?? null;
}

/**
 * 原地尝试建造附近的工地
 * @description 如果身上有能量且周围有工地，则进行建造；不产生移动
 * @returns 是否进行了建造
 */
function stayAndBuildNearby(creep: Creep): boolean {
    if (creep.store[RESOURCE_ENERGY] === 0) return false;
    const constructionSites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, STAY_BUILD_RANGE);
    const target = creep.pos.findClosestByRange(constructionSites);
    if (!target) return false;
    creep.build(target);
    return true;
}

/**
 * 交付层判定：是否应当转入“建造”模式
 * @description 附近没有 Link/Container 时，说明需要维护容器
 */
const shouldDeliverByBuild = (creep: Creep) => {
    const link = findAnyNearbyLink(creep);
    const container = findAnyNearbyContainer(creep);
    return !link && !container;
};

/**
 * 采集层判定：是否满足进入交付阶段
 * @description 接近满仓 / 源枯竭时允许切换，避免在源点空转
 */
const shouldSwitchToDeliver = (creep: Creep) => {
    if (creep.store.getFreeCapacity() === 0) return true;
    const source = creep.getBoundSource();
    if (!source) return false;
    if (source.energy === 0 && creep.store.getUsedCapacity() > 0) return true;

    // 预测本 tick 采集后就会满仓时提前切换，避免“采一跳就卡满”
    const income = creep.calculateHarvestIncomePerTick();
    return creep.store.getFreeCapacity() <= income;
};

/**
 * 采集层判定：是否需要回到采集阶段
 * @description 只要能量耗尽就应当回到采集
 */
const shouldSwitchToCollect = (creep: Creep) => {
    return creep.store[RESOURCE_ENERGY] === 0;
};

/**
 * 采集阶段
 * @description 采集能量，自动对齐到 Container，满载前预判切换
 * @returns 是否应该切换到交付阶段
 */
const runHarvest = (creep: Creep): boolean => {
    if (creep.store.getFreeCapacity() === 0) return true;
    const targetSource = creep.getBoundSource();
    if (!targetSource) {
        creep.memory.ready = false;
        return false;
    }

    // 源枯竭时优先尝试抽容器（与旧逻辑一致）
    if (targetSource.energy === 0) {
        if (creep.store.getUsedCapacity() > 0) return true;
        if (creep.pos.isNearTo(targetSource)) {
            if (!creep.room.container || !creep.room.link) return false;
            const candidates = creep.room.container.filter(
                c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && creep.pos.inRangeTo(c, SOURCE_RANGE)
            );
            const container = candidates.length > 0 ? creep.pos.findClosestByRange(candidates) : null;
            const link = findTransferLink(creep, targetSource);
            if (!container || !link) return false;
            creep.goWithdraw(container, RESOURCE_ENERGY);
        }
        return false;
    }

    if (!creep.moveToSourceWorkTile(targetSource)) return false;

    const result = creep.goHaverst(targetSource);
    if (!result) return false;
    if (creep.store.getCapacity() === 0) return false;

    // 预测下一次采集会满仓时切换到交付阶段
    const energyIncome = creep.calculateHarvestIncomePerTick();
    if (creep.store.getFreeCapacity() <= energyIncome) return true;

    return false;
};

/**
 * 转移阶段
 * @description 将能量转移到 Link 或 Container，若无处可放则原地建造或丢弃
 */
const runTransfer = (creep: Creep) => {
    if (creep.store[RESOURCE_ENERGY] === 0) return;

    if (creep.transferToSourceStructure()) return;

    if (stayAndBuildNearby(creep)) return;
    creep.drop(RESOURCE_ENERGY);
};

/**
 * 建造容器阶段
 * @description 当 Source 旁没有 Container/Link 时，负责维护和建造 Container
 */
const runBuild = (creep: Creep) => {
    if (creep.store[RESOURCE_ENERGY] === 0) return;

    // 尝试维护或建造
    const maintainResult = creep.maintainSourceContainer();
    if (maintainResult === 'acted') return;

    if (maintainResult === 'blocked') {
        if (!stayAndBuildNearby(creep)) {
            creep.drop(RESOURCE_ENERGY);
        }
        return;
    }

    // 如果无法维护（例如距离不够，或者已经有容器/Link了），则靠近源后等待交付层切换
    const targetSource = creep.getBoundSource();
    if (targetSource && !creep.pos.inRangeTo(targetSource, SOURCE_RANGE)) {
        creep.moveTo(targetSource);
    }
};

// 构建 Harvester 的能量流转层
const createHarvesterFlowMachine = (creep: Creep) => {
    const storage = createFsmStorage<HarvesterFlowState>(creep, HARVESTER_LAYERS.FLOW);
    return new StateMachine<HarvesterContext, HarvesterFlowState, HarvesterFlowEvent, HarvesterFlowGuard>(
        {
            initial: HARVESTER_FLOW_STATES.COLLECT,
            states: {
                [HARVESTER_FLOW_STATES.COLLECT]: {
                    onTick: (ctx) => {
                        // 未完成准备阶段则停留（由上层负责调用 prepare）
                        if (!ctx.creep.memory.ready) return;
                        const readyToDeliver = runHarvest(ctx.creep);
                        ctx.allowDeliver = readyToDeliver || shouldSwitchToDeliver(ctx.creep);
                        if (ctx.allowDeliver) return [HARVESTER_FLOW_EVENTS.HAS_ENERGY];
                    }
                },
                [HARVESTER_FLOW_STATES.DELIVER]: {
                    onTick: (ctx) => {
                        ctx.allowDeliver = true;
                        if (shouldSwitchToCollect(ctx.creep)) {
                            ctx.allowDeliver = false;
                            return [HARVESTER_FLOW_EVENTS.NEED_ENERGY];
                        }
                    }
                }
            },
            transitions: [
                {
                    from: HARVESTER_FLOW_STATES.COLLECT,
                    event: HARVESTER_FLOW_EVENTS.HAS_ENERGY,
                    to: HARVESTER_FLOW_STATES.DELIVER,
                    guard: HARVESTER_FLOW_GUARDS.HAS_ENERGY
                },
                {
                    from: HARVESTER_FLOW_STATES.DELIVER,
                    event: HARVESTER_FLOW_EVENTS.NEED_ENERGY,
                    to: HARVESTER_FLOW_STATES.COLLECT,
                    guard: HARVESTER_FLOW_GUARDS.NEED_ENERGY
                }
            ],
            guards: {
                [HARVESTER_FLOW_GUARDS.HAS_ENERGY]: (ctx) => shouldSwitchToDeliver(ctx.creep),
                [HARVESTER_FLOW_GUARDS.NEED_ENERGY]: (ctx) => shouldSwitchToCollect(ctx.creep)
            }
        },
        storage
    );
};

// 构建 Harvester 的交付层
const createHarvesterDeliverMachine = (creep: Creep) => {
    const storage = createFsmStorage<HarvesterDeliverState>(creep, HARVESTER_LAYERS.DELIVER);
    return new StateMachine<HarvesterContext, HarvesterDeliverState, HarvesterDeliverEvent, HarvesterDeliverGuard>(
        {
            initial: HARVESTER_DELIVER_STATES.TRANSFER,
            states: {
                [HARVESTER_DELIVER_STATES.TRANSFER]: {
                    onTick: (ctx) => {
                        // 采集阶段尚未完成时不进入交付行为
                        if (!shouldRunDeliverLayer(ctx)) return;
                        runTransfer(ctx.creep);
                        if (shouldDeliverByBuild(ctx.creep)) {
                            return [HARVESTER_DELIVER_EVENTS.NEED_BUILD];
                        }
                    }
                },
                [HARVESTER_DELIVER_STATES.BUILD]: {
                    onTick: (ctx) => {
                        if (!shouldRunDeliverLayer(ctx)) return;
                        runBuild(ctx.creep);
                        if (!shouldDeliverByBuild(ctx.creep)) {
                            return [HARVESTER_DELIVER_EVENTS.NEED_TRANSFER];
                        }
                    }
                }
            },
            transitions: [
                {
                    from: HARVESTER_DELIVER_STATES.TRANSFER,
                    event: HARVESTER_DELIVER_EVENTS.NEED_BUILD,
                    to: HARVESTER_DELIVER_STATES.BUILD,
                    guard: HARVESTER_DELIVER_GUARDS.NEED_BUILD
                },
                {
                    from: HARVESTER_DELIVER_STATES.BUILD,
                    event: HARVESTER_DELIVER_EVENTS.NEED_TRANSFER,
                    to: HARVESTER_DELIVER_STATES.TRANSFER,
                    guard: HARVESTER_DELIVER_GUARDS.NEED_TRANSFER
                }
            ],
            guards: {
                [HARVESTER_DELIVER_GUARDS.NEED_BUILD]: (ctx) => shouldDeliverByBuild(ctx.creep),
                [HARVESTER_DELIVER_GUARDS.NEED_TRANSFER]: (ctx) => !shouldDeliverByBuild(ctx.creep)
            }
        },
        storage
    );
};

const HarvesterAction = {
    /**
     * Harvester 主运行逻辑（已迁移到多层 FSM）
     */
    run: function (creep: Creep) {
        if (!creep.moveHomeRoom()) return;

        if (!creep.memory.ready) {
            creep.memory.ready = this.prepare(creep);
            return;
        }

        const ctx: HarvesterContext = {
            creep,
            allowDeliver: shouldSwitchToDeliver(creep)
        };

        const flowMachine = createHarvesterFlowMachine(creep);
        const deliverMachine = createHarvesterDeliverMachine(creep);
        const runner = createLayeredRunner<HarvesterContext>({
            [HARVESTER_LAYERS.FLOW]: flowMachine,
            [HARVESTER_LAYERS.DELIVER]: deliverMachine
        });

        runner.step(ctx, {
            [HARVESTER_LAYERS.FLOW]: { reenter: true },
            [HARVESTER_LAYERS.DELIVER]: { reenter: true }
        });

        if (getHarvesterFlowState(creep) === HARVESTER_FLOW_STATES.COLLECT) {
            deliverMachine.setState(HARVESTER_DELIVER_STATES.TRANSFER);
        }
    },
    /**
     * 准备阶段：绑定 Source
     */
    prepare: function (creep: Creep) {
        if (!creep.room.source || creep.room.source.length === 0) return false;
        const boundSource = creep.getBoundSource();
        if (boundSource) {
            creep.setBoundSourceId(boundSource.id);
            return true;
        }
        const targetSource = creep.room.closestSource(creep);
        if (!targetSource) return false;
        creep.setBoundSourceId(targetSource.id);
        return true;
    }
}

export default HarvesterAction;
