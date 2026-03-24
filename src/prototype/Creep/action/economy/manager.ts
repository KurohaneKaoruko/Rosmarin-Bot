import { createStrategyRole } from '@/framework/ai/creepRole';
import { writeMoveWorkTileCandidates } from '@/shared/moveWork';

type LinkPlan =
    | { type: 'transfer-to-manage'; target: StructureLink }
    | { type: 'withdraw-from-storage'; source: StructureStorage }
    | { type: 'withdraw-from-manage'; source: StructureLink };

type ManagerPlan = {
    linkPlan: LinkPlan | null;
    missionTask: Task | null;
    depositTarget: { target: AnyStoreStructure | null; resourceType: ResourceConstant } | null;
};

type ManagerContext = {
    creep: Creep;
    plan: ManagerPlan;
};

const getManagerLockCenter = (room: Room): RoomPosition | null => {
    const centerPos = room.getCenter?.();
    const storage = room.storage;
    if (!centerPos || !room.controller?.my || !storage) return null;
    const hasManageLink = !!room.link?.some((link) =>
        link &&
        link.pos.inRangeTo(centerPos, 1) &&
        link.pos.inRangeTo(storage, 2)
    );
    return room.terminal || hasManageLink ? centerPos : null;
};

export const syncManagerMoveWork = (creep: Creep, centerPos = getManagerLockCenter(creep.room)) => {
    if (centerPos) {
        writeMoveWorkTileCandidates(creep, [{ pos: centerPos, range: 0 }]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

// 处理 creep 身上的其他资源（优先存储）
function handleOtherResources(creep: Creep, targetType: ResourceConstant): boolean {
    const resourceType = Object.keys(creep.store).find(type => type !== targetType && creep.store[type] > 0) as ResourceConstant;

    if (!resourceType) return false;

    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(resourceType) > 0) {
        creep.goTransfer(storage, resourceType);
        return true;
    }

    const terminal = creep.room.terminal;
    if (terminal && terminal.store.getFreeCapacity(resourceType) > 0) {
        creep.goTransfer(terminal, resourceType);
        return true;
    }

    creep.drop(resourceType);
    return true;
}

// 计算 Link 搬运计划（纯读取，不产生行动）
function planLinkTransfer(creep: Creep): LinkPlan | null {
    const storage = creep.room.storage;
    if (!storage) return null;

    let controllerLink: StructureLink | null = null;
    let manageLink: StructureLink | null = null;
    const normalLinks: StructureLink[] = [];

    const centerPos = creep.room.getCenter();
    for (const link of creep.room.link) {
        if (creep.room.source.some((source: any) => link.pos.inRangeTo(source, 2))) continue;
        if (link.pos.inRangeTo(creep.room.controller, 2)) {
            controllerLink = link;
            continue;
        }
        if (link.pos.inRangeTo(centerPos, 1) && link.pos.inRangeTo(storage, 2)) {
            manageLink = link;
            continue;
        }
        normalLinks.push(link);
    }

    if (!manageLink) return null;

    const needsEnergy =
        (controllerLink && controllerLink.store[RESOURCE_ENERGY] < 400) ||
        normalLinks.some((link) => link.store[RESOURCE_ENERGY] < 400);

    if (needsEnergy) {
        if (manageLink.store.getFreeCapacity(RESOURCE_ENERGY) < 100) return null;
        if (creep.store[RESOURCE_ENERGY] >= 100) {
            return { type: 'transfer-to-manage', target: manageLink };
        }
        if (storage.store[RESOURCE_ENERGY] > 0) {
            return { type: 'withdraw-from-storage', source: storage };
        }
        return null;
    }

    if (manageLink.store[RESOURCE_ENERGY] > 0) {
        return { type: 'withdraw-from-manage', source: manageLink };
    }

    return null;
}

// 执行 Link 搬运计划
function executeLinkPlan(creep: Creep, plan: LinkPlan): boolean {
    if (handleOtherResources(creep, RESOURCE_ENERGY)) return true;

    switch (plan.type) {
        case 'transfer-to-manage':
            creep.goTransfer(plan.target, RESOURCE_ENERGY);
            return true;
        case 'withdraw-from-storage':
            creep.goWithdraw(plan.source, RESOURCE_ENERGY);
            return true;
        case 'withdraw-from-manage':
            creep.goWithdraw(plan.source, RESOURCE_ENERGY);
            return true;
        default:
            return false;
    }
}

// 执行 manage 任务（搬运指定资源）
function executeManagerMission(creep: Creep, task: Task): boolean {
    let source = null as AnyStoreStructure | null;
    let target = null as AnyStoreStructure | null;

    const getStructure = (structureKey: string) => creep.room[structureKey] || null;

    const taskdata = task.data as ManageTask;

    source = getStructure(taskdata.source);
    target = getStructure(taskdata.target);

    if (!source || !target) {
        creep.room.deleteMissionFromPool('transport', task.id);
        return false;
    }
    if (!source.pos.inRange(target.pos, 2)) {
        creep.room.deleteMissionFromPool('transport', task.id);
        return false;
    }

    const type = taskdata.resourceType;
    const amount = taskdata.amount;

    // 如果任务数据不合法，则移除任务
    if (!amount || typeof amount !== 'number' || amount <= 0) {
        creep.room.deleteMissionFromPool('transport', task.id);
        return false;
    }

    // 如果身上有不是 type 的资源，先归库
    if (handleOtherResources(creep, type)) return true;

    if (creep.store.getUsedCapacity(type) === 0 && creep.store.getFreeCapacity() > 0) {
        if (source.store[type] === 0) {
            creep.room.deleteMissionFromPool('transport', task.id);
            return false;
        }
        const withdrawAmount = Math.min(amount, creep.store.getFreeCapacity(type), source.store[type]);
        const result = creep.withdraw(source, type, withdrawAmount);
        if (result == ERR_NOT_IN_RANGE) creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
        return true;
    }

    const transferResult = creep.transfer(target, type);

    if (transferResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
        return true;
    }

    if (transferResult === ERR_FULL) {
        creep.room.deleteMissionFromPool('transport', task.id);
        return true;
    }

    if (transferResult == OK) {
        const transferredAmount = Math.min(creep.store[type], amount);
        const data = task.data as TransportTask;
        data.amount -= transferredAmount;
        if (data.amount <= 0) {
            creep.room.deleteMissionFromPool('transport', task.id);
        }
    }

    return true;
}

// 选择把身上资源存回仓库的目标
function resolveDepositTarget(creep: Creep): { target: AnyStoreStructure | null; resourceType: ResourceConstant } | null {
    const resourceType = Object.keys(creep.store)[0] as ResourceConstant;
    if (!resourceType || creep.store[resourceType] <= 0) return null;

    const storage = creep.room.storage;
    const terminal = creep.room.terminal;

    const target = (storage && storage.store.getFreeCapacity(resourceType) > 0)
        ? storage
        : (terminal && terminal.store.getFreeCapacity(resourceType) > 0)
            ? terminal
            : null;

    if (!target) return { target: null, resourceType };
    return { target, resourceType };
}

// 构建计划：集中判断要执行的策略
function buildManagerPlan(creep: Creep): ManagerPlan {
    const linkPlan = planLinkTransfer(creep);
    const missionTask = creep.room.getMissionFromPoolFirst('transport', (task) => task.type === 'manage') as Task || null;
    const depositTarget = resolveDepositTarget(creep);
    return { linkPlan, missionTask, depositTarget };
}

const runDepositPlan = (ctx: ManagerContext) => {
    const plan = ctx.plan.depositTarget;
    if (!plan) return;
    if (plan.target) {
        ctx.creep.goTransfer(plan.target, plan.resourceType);
        return;
    }
    ctx.creep.drop(plan.resourceType);
};

const runIdle = (ctx: ManagerContext) => {
    const pos = ctx.creep.room.getCenter();
    if (!ctx.creep.pos.isEqualTo(pos)) {
        ctx.creep.moveTo(pos, { visualizePathStyle: { stroke: '#ffffff' } });
    }
};

const ManagerAction = createStrategyRole<ManagerContext>({
    createContext: (creep) => {
        const centerPos = getManagerLockCenter(creep.room);
        creep.memory.dontPullMe = !!centerPos && creep.pos.isEqualTo(centerPos);
        syncManagerMoveWork(creep, centerPos);
        return { creep, plan: buildManagerPlan(creep) };
    },
    strategies: [
        {
            canRun: (ctx) => !!ctx.plan.linkPlan,
            run: (ctx) => executeLinkPlan(ctx.creep, ctx.plan.linkPlan!)
        },
        {
            canRun: (ctx) => !!ctx.plan.missionTask,
            run: (ctx) => executeManagerMission(ctx.creep, ctx.plan.missionTask!)
        },
        {
            canRun: (ctx) => !!ctx.plan.depositTarget,
            run: runDepositPlan
        },
        {
            canRun: () => true,
            run: runIdle
        }
    ]
});

export default ManagerAction;
