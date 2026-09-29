import { LabMap, Goods, BarList } from "@/constant/ResourceConstant";
import { BASE_CONFIG } from "@/constant/config";
import { getStructData } from "@/modules/shared/memory";
import { THRESHOLDS } from "@/constant/Thresholds";

const MANAGE_BALANCE = {
    // 自动调度资源阈值
    THRESHOLD: {
        SOURCE: {
            DEFAULT: 4000,
            ENERGY: 30000,
            POWER: 5000,
            LAB: 3000,
            BAR: 3000,
            GOODS: 1200
        },
        TARGET: {
            DEFAULT: 3000,
            ENERGY: 25000,
            POWER: 5000,
            LAB: 3000,
            BAR: 3000,
            GOODS: 1000
        }
    },
    // Factory 搬运
    FACTORY_MIN: 3000,
    FACTORY_MAX: 3000,
    // PowerSpawn
    POWER_SPAWN_ENERGY_LIMIT: 5000,
    POWER_SPAWN_POWER_LIMIT: 100,
    // Terminal 自动平衡
    TERMINAL_ENERGY_LIMIT: 50e3,
    TERMINAL_RES_LIMIT: 10000
}

const MANAGE_STRUCTURE_ALIASES = {
    s: 'storage',
    t: 'terminal',
    l: 'link',
    f: 'factory',
    p: 'powerSpawn',
} as const;

type ManageStructureRef = {
    key: string;
    structure: AnyStoreStructure;
};

// 构造 terminal 资源平衡阈值表。
const createTerminalThresholds = () => {
    const thresholds = {
        source: {
            [RESOURCE_ENERGY]: MANAGE_BALANCE.THRESHOLD.SOURCE.ENERGY,
            [RESOURCE_POWER]: MANAGE_BALANCE.THRESHOLD.SOURCE.POWER,
            default: MANAGE_BALANCE.THRESHOLD.SOURCE.DEFAULT,
        } as Record<string, number>,
        target: {
            [RESOURCE_ENERGY]: MANAGE_BALANCE.THRESHOLD.TARGET.ENERGY,
            [RESOURCE_POWER]: MANAGE_BALANCE.THRESHOLD.TARGET.POWER,
            default: MANAGE_BALANCE.THRESHOLD.TARGET.DEFAULT,
        } as Record<string, number>,
    };

    const initThresholds = (list: string[], sourceValue: number, targetValue: number) => {
        for (const resourceType of list) {
            thresholds.source[resourceType] = sourceValue;
            thresholds.target[resourceType] = targetValue;
        }
    };

    initThresholds(Object.keys(LabMap), MANAGE_BALANCE.THRESHOLD.SOURCE.LAB, MANAGE_BALANCE.THRESHOLD.TARGET.LAB);
    initThresholds(BarList, MANAGE_BALANCE.THRESHOLD.SOURCE.BAR, MANAGE_BALANCE.THRESHOLD.TARGET.BAR);
    initThresholds(Goods, MANAGE_BALANCE.THRESHOLD.SOURCE.GOODS, MANAGE_BALANCE.THRESHOLD.TARGET.GOODS);

    return thresholds;
};

const normalizeManageResourceType = (resourceType: string | ResourceConstant) => {
    const alias = BASE_CONFIG.RESOURCE_ABBREVIATIONS[resourceType];
    return (alias || resourceType) as ResourceConstant;
};

const normalizeManageStructureKey = (structure: string) => {
    return (MANAGE_STRUCTURE_ALIASES[structure as keyof typeof MANAGE_STRUCTURE_ALIASES] || structure) as string;
};

const getThresholdAmount = (thresholdMap: Record<string, number>, resourceType: string) => {
    return thresholdMap[resourceType] ?? thresholdMap.default ?? 0;
};

const resolveManageStructure = (room: Room, structure: string): ManageStructureRef | null => {
    const resolvedKey = normalizeManageStructureKey(structure);
    const value = (room as any)[resolvedKey] as AnyStoreStructure | AnyStoreStructure[] | null;
    if (!value || Array.isArray(value)) return null;
    return {
        key: resolvedKey,
        structure: value,
    };
};

const getRequestedSendTotalAmount = (sendTotal: Record<string, number>) =>
    Object.values(sendTotal).reduce((sum, amount) => sum + (Number(amount) || 0), 0);

// ==================== 更新辅助 ====================
// 检查终端资源, 自动调度资源
function checkTerminalResourceBalance(room: Room) {
    if (!room.storage || !room.terminal) return false;
    if (!room.storage.pos.inRange(room.terminal.pos, 2)) return false;

    // 发送任务资源数
    const sendTotal = room.getSendMissionTotalAmount();
    const thresholds = createTerminalThresholds();
    const totalRequestedAmount = getRequestedSendTotalAmount(sendTotal);

    // 存在该旗帜时, 清空终端
    const terminalClearFlag = Game.flags[`${room.name}_terminal_clear`];

    // 检查终端自动转入
    for (const resourceType in room.storage.store) {
        let amount = 0;
        if (resourceType === RESOURCE_ENERGY && totalRequestedAmount > 0) {
            amount = Math.min(
                room.storage.store[resourceType],
                totalRequestedAmount - room.terminal.store[resourceType],
                MANAGE_BALANCE.TERMINAL_ENERGY_LIMIT - room.terminal.store[resourceType],
            );
        }
        // 有发送任务时，根据总量来定
        else if (sendTotal[resourceType]) {
            amount = Math.min(
                room.storage.store[resourceType],
                sendTotal[resourceType] - room.terminal.store[resourceType],
                MANAGE_BALANCE.TERMINAL_RES_LIMIT - room.terminal.store[resourceType]
            );
        } else {
            if (terminalClearFlag) break;
            // 当终端资源不足时，将storage资源补充到终端
            const threshold = getThresholdAmount(thresholds.target, resourceType);
            if (room.terminal.store[resourceType] >= threshold) continue;
            amount = Math.min(
                room.storage.store[resourceType],
                threshold - room.terminal.store[resourceType]
            );
        }
        if(amount <= 0) continue;
        room.ManageMissionAdd('s', 't', resourceType as ResourceConstant, amount);
    }

    // 检查终端自动转出
    for (const resourceType in room.terminal.store) {
        if (sendTotal[resourceType]) continue;
        // 当终端资源过多，且storage有空间时，将终端多余资源转入storage
        const threshold = terminalClearFlag
            ? 0
            : getThresholdAmount(thresholds.source, resourceType);
        if (room.terminal.store[resourceType] <= threshold) continue;

        const amount = room.terminal.store[resourceType] - threshold;
        if (amount <= 0) continue;
        room.ManageMissionAdd('t', 's', resourceType as ResourceConstant, amount);
    }
}

function checkFactoryResourceBalance(room: Room) {
    const factory = room.factory;
    if (!factory) return;
    const storage = room.storage;
    if (!storage) return;

    const mem = getStructData(room.name);
    if (!mem) return;
    
    const product = mem.factoryProduct;

    // 关停时全部取出
    if (!mem.factory || !product) {
        for(const type in factory.store) {
            room.ManageMissionAdd('f', 's', type as ResourceConstant, factory.store[type]);
        }
        return;
    }

    const components = COMMODITIES[product]?.components || {};

    // 将不是材料也不是产物的搬走
    for(const type in factory.store) {
        if(components[type]) continue;
        if(type === product) continue;
        room.ManageMissionAdd('f', 's', type as ResourceConstant, factory.store[type]);
    }


    // 材料不足时补充
    for(const component in components){
        if((room.getResAmount(component as ResourceConstant)) <= 0) continue;
        if(factory.store[component] >= 1000) continue;
        const amount = MANAGE_BALANCE.FACTORY_MIN - factory.store[component];

        room.ManageMissionAdd('s', 'f', component as ResourceConstant, Math.min(amount, storage.store[component]));
        if(storage.store[component] < amount) {
            room.ManageMissionAdd('t', 'f', component as ResourceConstant,
                Math.min(amount - storage.store[component],
                        room.terminal?.store[component]||0));
        }
    }

    // 产物过多时搬出
    if(factory.store[product] >= MANAGE_BALANCE.FACTORY_MAX) {
        if (room.storage && storage.store.getFreeCapacity() >= MANAGE_BALANCE.FACTORY_MAX) {
            room.ManageMissionAdd('f', 's', product, MANAGE_BALANCE.FACTORY_MAX);
        } else if (room.terminal && room.terminal.store.getFreeCapacity() >= MANAGE_BALANCE.FACTORY_MAX) {
            if (!storage.pos.inRange(room.terminal.pos, 2)) return false;
            room.ManageMissionAdd('f', 't', product, MANAGE_BALANCE.FACTORY_MAX);
        }
    }
}

function checkPowerSpawnResourceBalance(room: Room) {
    const powerSpawn = room.powerSpawn;
    if (!powerSpawn) return;
    const centerPos = room.getCenter();
    if (!powerSpawn.pos.inRangeTo(centerPos, 1)) return;

    const fillPowerSpawn = (resource: ResourceConstant, limit: number, amount: number) => {
        if (powerSpawn.store[resource] < limit) {
            if (room.storage && room.storage.store[resource] >= amount) {
                room.ManageMissionAdd('s', 'p', resource, amount);
            } else if (room.terminal && room.terminal.store[resource] >= amount) {
                room.ManageMissionAdd('t', 'p', resource, amount);
            }
        }
    };

    fillPowerSpawn(RESOURCE_ENERGY, 1000, MANAGE_BALANCE.POWER_SPAWN_ENERGY_LIMIT);
    fillPowerSpawn(RESOURCE_POWER, 50, MANAGE_BALANCE.POWER_SPAWN_POWER_LIMIT);
}


/**
 * 房间资源调度任务模块（manage/terminal）
 * @description
 * - 自动平衡 storage/terminal/factory/powerSpawn 资源
 * - manage 任务以 `type === 'manage'` 的形式存放在 transport 共享池中
 * - 通过任务池驱动 manager/transport creep 执行搬运与终端发送
 */
export default class ManageMission extends Room {
    /**
     * manage 更新入口
     * @description 检查终端、工厂、powerSpawn 的资源状态并生成调度任务
     */
    UpdateManageMission(offset = 0) {
        void offset;
        // 检查终端资源预留数量，不足则补充，超过则搬出
        checkTerminalResourceBalance(this);
        // 检查工厂资源数量，补充或搬出
        checkFactoryResourceBalance(this);
        // 补充powerSpawn资源，只在特定布局生效
        checkPowerSpawnResourceBalance(this);
    }

    /**
     * 添加/更新中央搬运任务（manage）
     * @param source - 来源建筑（可用缩写：s/t/l/f/p）
     * @param target - 目标建筑（可用缩写：s/t/l/f/p）
     * @param resourceType - 资源类型（支持缩写映射）
     * @param amount - 搬运数量（>0）
     */
    ManageMissionAdd(source: string, target: string, resourceType: ResourceConstant, amount: number) {
        const normalizedResourceType = normalizeManageResourceType(resourceType);
        const resolvedSource = resolveManageStructure(this, source);
        const resolvedTarget = resolveManageStructure(this, target);
        if (!resolvedSource || !resolvedTarget) return false;
        if (typeof amount !== 'number' || amount <= 0) return false;

        const sourceKey = resolvedSource.key;
        const targetKey = resolvedTarget.key;
        const sourceObj = resolvedSource.structure;
        const targetObj = resolvedTarget.structure;
        const sourceAmount = sourceObj.store?.[normalizedResourceType] || 0;
        if (sourceAmount <= 0) return false;

        const free = targetObj.store?.getFreeCapacity(normalizedResourceType) || 0;
        if (free <= 0) {
            const existingTaskId = this.checkSameMissionInPool('transport', 'manage', {
                source: sourceKey,
                target: targetKey,
                resourceType: normalizedResourceType,
            } as ManageTask);
            if (existingTaskId) this.deleteMissionFromPool('transport', existingTaskId);
            return false;
        }

        amount = Math.min(amount, free, sourceAmount);
        if (amount <= 0) return false;

        const taskData = {
            source: sourceKey,
            target: targetKey,
            resourceType: normalizedResourceType,
            amount,
        } as ManageTask;
        const existingTaskId = this.checkSameMissionInPool('transport', 'manage', {
            source: sourceKey,
            target: targetKey,
            resourceType: normalizedResourceType,
        } as ManageTask);
        if (existingTaskId) {
            return this.updateMissionPool('transport', existingTaskId,
                { data: taskData });
        } else {
            return this.addMissionToPool('transport', 'manage', 0, taskData);
        }
    }

    /**
     * 添加/更新终端发送任务（terminal/send）
     * @param targetRoom - 目标房间名
     * @param resourceType - 资源类型（支持缩写映射）
     * @param amount - 发送数量（>0）
     */
    SendMissionAdd(targetRoom: string, resourceType: string | ResourceConstant, amount: number) {
        const normalizedResourceType = normalizeManageResourceType(resourceType);
        const existingTaskId = this.checkSameMissionInPool('terminal', 'send', {
            targetRoom,
            resourceType: normalizedResourceType,
        } as SendTask);
        if (existingTaskId) {
            return this.updateMissionPool('terminal', existingTaskId,
                { data: { targetRoom, resourceType: normalizedResourceType, amount } as SendTask });
        } else {
            return this.addMissionToPool('terminal', 'send', 0, 
                { targetRoom, resourceType: normalizedResourceType, amount } as SendTask);
        }
    }

    /**
     * Upsert 终端发送任务，并保证任务数量“只增不减”
     * @description 同 {targetRoom, resourceType} 的 send 任务已存在时，不覆盖成更小的 amount，避免反复调度导致不收敛。
     * @param targetRoom - 目标房间名
     * @param resourceType - 资源类型（支持缩写映射）
     * @param amount - 期望至少发送数量（>0）
     * @param maxAmount - 可选上限（防止一次性排队过多）
     */
    SendMissionUpsertMax(targetRoom: string, resourceType: string | ResourceConstant, amount: number, maxAmount?: number) {
        const normalizedResourceType = normalizeManageResourceType(resourceType);
        if (!amount || typeof amount !== 'number' || amount <= 0) return false;

        const existingTaskId = this.checkSameMissionInPool('terminal', 'send', {
            targetRoom,
            resourceType: normalizedResourceType,
        } as SendTask);
        if (existingTaskId) {
            const task = this.getMissionFromPoolById('terminal', existingTaskId);
            const currentAmount = (task?.data as SendTask | undefined)?.amount ?? 0;
            let nextAmount = Math.max(currentAmount, amount);
            if (typeof maxAmount === 'number') nextAmount = Math.min(nextAmount, maxAmount);
            if (nextAmount === currentAmount) return OK;
            return this.updateMissionPool('terminal', existingTaskId, {data: {amount: nextAmount} as any});
        }

        let nextAmount = amount;
        if (typeof maxAmount === 'number') nextAmount = Math.min(nextAmount, maxAmount);
        return this.addMissionToPool('terminal', 'send', 0, {
            targetRoom,
            resourceType: normalizedResourceType,
            amount: nextAmount,
        } as SendTask);
    }
}

const getSendMinBatch = (resourceType: ResourceConstant) => {
    if (resourceType === RESOURCE_ENERGY) return THRESHOLDS.ENERGY.SEND_BATCH_ENERGY;
    return Goods.includes(resourceType as any) ? 10 : THRESHOLDS.ENERGY.SEND_BATCH_MINERAL;
};

const getRoomSendAmount = (room: Room, resourceType: ResourceConstant) =>
    (room.terminal?.store[resourceType] || 0) + (room.storage?.store[resourceType] || 0);

const canDispatchSendTask = (terminal: StructureTerminal | undefined, task: Task) => {
    if (!terminal || task.type !== 'send') return false;
    const data = task.data as SendTask;
    const minBatch = Math.min(data.amount, getSendMinBatch(data.resourceType));
    return (terminal.store[data.resourceType] || 0) >= minBatch;
};

const hasEnoughResourceForSendTask = (room: Room, task: Task) => {
    if (task.type !== 'send') return false;
    const data = task.data as SendTask;
    const requiredAmount = Math.min(data.amount, THRESHOLDS.ENERGY.SEND_REQUEST_MIN);
    return getRoomSendAmount(room, data.resourceType) >= requiredAmount;
};

// ==================== Getter ====================
export class ManageTaskGetter extends Room {
    getManageMission() {
        return this.getMissionFromPoolFirst('transport', (task) => task.type === 'manage') || null;
    }

    // 发送任务会被 TerminalWork 分批执行，这里不要求一次性满足全部 amount，但需要满足一个最小批量。
    getSendMission() {
        return this.getMissionFromPoolFirst('terminal', (task) => canDispatchSendTask(this.terminal, task));
    }

    getSendMissionTotalAmount() {
        const sends: Record<string, number> = {};
        const tasks = this.getAllMissionFromPool('terminal').filter((task) => task.type === 'send');
        for (const task of tasks) {
            const data = task.data as SendTask;
            if (!hasEnoughResourceForSendTask(this, task)) {
                this.deleteMissionFromPool('terminal', task.id);
                continue;
            }
            sends[data.resourceType] = data.amount + (sends[data.resourceType] || 0);
        }
        return sends;
    }
}
