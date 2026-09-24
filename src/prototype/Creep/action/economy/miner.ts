import { createFsmStorage, createLayeredRunner } from '@/framework/ai/adapters';
import { StateMachine } from '@/framework/ai/stateMachine';
import { writeMoveWorkTileCandidates } from '@/shared/moveWork';

export const MINERAL_LAYERS = {
    FLOW: 'mineral:flow',
    MAINTENANCE: 'mineral:maintenance',
} as const;

export const MINERAL_FLOW_STATES = {
    COLLECT: 'collect',
    DELIVER: 'deliver',
} as const;

export const MINERAL_MAINTENANCE_STATES = {
    HARVEST: 'harvest',
    MAINTAIN: 'maintain',
} as const;

type MineralFlowState = typeof MINERAL_FLOW_STATES[keyof typeof MINERAL_FLOW_STATES];
type MineralMaintenanceState = typeof MINERAL_MAINTENANCE_STATES[keyof typeof MINERAL_MAINTENANCE_STATES];

type MineralContext = {
    creep: Creep;
    allowCollect: boolean;
};

const getMineral = (creep: Creep) => creep.room.mineral || creep.room.find(FIND_MINERALS)[0] || null;

const getMineralContainer = (creep: Creep): StructureContainer | null => {
    const mineral = getMineral(creep);
    if (!mineral) return null;
    return creep.room.container.find((container) => container.pos.inRangeTo(mineral, 1)) || null;
};

const getMineralFlowState = (creep: Creep): MineralFlowState =>
    (creep.memory.fsm?.[MINERAL_LAYERS.FLOW] as MineralFlowState | undefined) ||
    (creep.memory.working ? MINERAL_FLOW_STATES.DELIVER : MINERAL_FLOW_STATES.COLLECT);

export const syncMineralMoveWork = (creep: Creep) => {
    const mineral = getMineral(creep);
    if (getMineralFlowState(creep) === MINERAL_FLOW_STATES.COLLECT && mineral) {
        writeMoveWorkTileCandidates(creep, [{ pos: mineral.pos, range: 1 }]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

const shouldDeliver = (creep: Creep) =>
    creep.store.getFreeCapacity() === 0 && creep.store.getUsedCapacity() > 0;

const shouldCollect = (creep: Creep) => creep.store.getUsedCapacity() === 0;

const needsContainerMaintenance = (creep: Creep) => {
    const mineral = getMineral(creep);
    if (!mineral || !creep.room.extractor) return false;
    return !getMineralContainer(creep) && creep.room.level >= 6;
};

const runMineralHarvest = (creep: Creep) => {
    const mineral = getMineral(creep);
    if (!mineral) return;
    if (!creep.room.extractor) {
        creep.say('无提取器');
        syncMineralMoveWork(creep);
        return;
    }

    const container = getMineralContainer(creep);
    if (!container) {
        syncMineralMoveWork(creep);
        return;
    }

    if (!creep.pos.isEqualTo(container)) {
        creep.moveTo(container, { maxRooms: 1, range: 0 });
        syncMineralMoveWork(creep);
        return;
    }

    if (mineral.mineralAmount <= 0) {
        creep.suicide();
        return;
    }

    if (creep.pos.isNearTo(mineral)) creep.harvest(mineral);
    else creep.moveTo(mineral, { maxRooms: 1, range: 1 });

    if (!shouldDeliver(creep)) syncMineralMoveWork(creep);
};

const runMineralMaintenance = (creep: Creep) => {
    const mineral = getMineral(creep);
    if (!mineral) return;
    if (!creep.room.extractor) {
        creep.say('无提取器');
        syncMineralMoveWork(creep);
        return;
    }

    if (!creep.pos.inRangeTo(mineral, 1)) {
        creep.moveTo(mineral, { maxRooms: 1, range: 1 });
        syncMineralMoveWork(creep);
        return;
    }

    const hasContainerSite = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 2)
        .some((site) => site.structureType === STRUCTURE_CONTAINER);
    if (!hasContainerSite) {
        creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
    }
    syncMineralMoveWork(creep);
};

const runMineralDeliver = (creep: Creep) => {
    let target = creep.getTarget<AnyStoreStructure>();
    const mineralContainer = getMineralContainer(creep);

    if (!target || target.store.getFreeCapacity() <= 0) {
        creep.clearTarget();
        if (mineralContainer && mineralContainer.store.getFreeCapacity() > 0) {
            creep.setTarget(mineralContainer, 'store');
            target = mineralContainer;
        } else {
            return;
        }
    }

    const resourceType = (Object.keys(creep.store) as ResourceConstant[])
        .find((type) => creep.store.getUsedCapacity(type) > 0);
    if (!resourceType) return;

    if (creep.transfer(target, resourceType) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
    }
};

const createMineralFlowMachine = (creep: Creep) =>
    new StateMachine<MineralContext, MineralFlowState, 'full' | 'empty', never>({
        initial: MINERAL_FLOW_STATES.COLLECT,
        states: {
            [MINERAL_FLOW_STATES.COLLECT]: {
                onTick: (ctx) => {
                    ctx.allowCollect = true;
                    if (shouldDeliver(ctx.creep)) return ['full'];
                }
            },
            [MINERAL_FLOW_STATES.DELIVER]: {
                onTick: (ctx) => {
                    ctx.allowCollect = false;
                    runMineralDeliver(ctx.creep);
                    if (shouldCollect(ctx.creep)) return ['empty'];
                }
            }
        },
        transitions: [
            { from: MINERAL_FLOW_STATES.COLLECT, event: 'full', to: MINERAL_FLOW_STATES.DELIVER },
            { from: MINERAL_FLOW_STATES.DELIVER, event: 'empty', to: MINERAL_FLOW_STATES.COLLECT },
        ]
    }, createFsmStorage<MineralFlowState>(creep, MINERAL_LAYERS.FLOW));

const createMineralMaintenanceMachine = (creep: Creep) =>
    new StateMachine<MineralContext, MineralMaintenanceState, 'need_maintain' | 'ready_harvest', never>({
        initial: MINERAL_MAINTENANCE_STATES.HARVEST,
        states: {
            [MINERAL_MAINTENANCE_STATES.HARVEST]: {
                onTick: (ctx) => {
                    if (!ctx.allowCollect) return;
                    if (needsContainerMaintenance(ctx.creep)) {
                        return ['need_maintain'];
                    }
                    runMineralHarvest(ctx.creep);
                }
            },
            [MINERAL_MAINTENANCE_STATES.MAINTAIN]: {
                onTick: (ctx) => {
                    if (!ctx.allowCollect) return;
                    runMineralMaintenance(ctx.creep);
                    if (!needsContainerMaintenance(ctx.creep)) {
                        return ['ready_harvest'];
                    }
                }
            }
        },
        transitions: [
            { from: MINERAL_MAINTENANCE_STATES.HARVEST, event: 'need_maintain', to: MINERAL_MAINTENANCE_STATES.MAINTAIN },
            { from: MINERAL_MAINTENANCE_STATES.MAINTAIN, event: 'ready_harvest', to: MINERAL_MAINTENANCE_STATES.HARVEST },
        ]
    }, createFsmStorage<MineralMaintenanceState>(creep, MINERAL_LAYERS.MAINTENANCE));

const minerRole = {
    run: (creep: Creep) => {
        const ctx: MineralContext = {
            creep,
            allowCollect: getMineralFlowState(creep) === MINERAL_FLOW_STATES.COLLECT,
        };

        const runner = createLayeredRunner<MineralContext>({
            [MINERAL_LAYERS.MAINTENANCE]: createMineralMaintenanceMachine(creep),
            [MINERAL_LAYERS.FLOW]: createMineralFlowMachine(creep),
        });

        runner.step(ctx, {
            [MINERAL_LAYERS.MAINTENANCE]: { reenter: true },
            [MINERAL_LAYERS.FLOW]: { reenter: true },
        });

        creep.memory.working = getMineralFlowState(creep) === MINERAL_FLOW_STATES.DELIVER;
        if (!creep.memory.working) {
            creep.clearTarget();
        }
    }
};

export default minerRole;
