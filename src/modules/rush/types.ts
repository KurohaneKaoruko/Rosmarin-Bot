/**
 * rush 经济核心共享类型（整建制移植的模块间契约）。
 */
import type { RushMinHeap } from './minHeap';

/** 孵化请求（写入孵化堆的标准化载荷；priority = 任务类型*1e5 + 任务优先级*100 + 角色序） */
export type RushSpawnRequest = {
    body: BodyPartConstant[];
    /** 缺省时由孵化器生成（角色短码前缀 + 编码房名 + 计数） */
    name?: string;
    memory: any;
    taskType: string;
    roomName: string;
    priority: number;
};

/** 房间级堆缓存（跨 tick 复用、进程生命周期清零；键含 lastUsed 便于清理） */
export type RushRoomHeap = {
    lastUsed: number;
    [key: string]: any;
};

/** 房间每 tick 孵化态（preTick 建立，孵化消费循环使用） */
export type RushRoomTickState = {
    freeSpawns: StructureSpawn[];
    numSpawns: number;
    canSpawn: boolean;
    /** 本 tick 已发生：搬运空闲（加码）/ 升级取能落空（减码）信号 */
    spawnBalanceAdded: boolean;
    spawnBalanceSubtracted: boolean;
    /** 孵化优先级堆（每 tick 重建，管理器先写入、孵化循环后消费） */
    spawnQueue: RushMinHeap<RushSpawnRequest>;
    /** 角色 → 在岗 creep 花名册（preTick 从登记名册重建） */
    creeps: Record<string, Creep[]>;
    /** 本房型 builder/upgrader 体型的 work 上限缓存（每 tick） */
    builderMaxNumWork?: number;
    upgraderMaxNumWork?: number;
    /** 每 tick 预算缓存 */
    maxWork?: number;
    energyLevel?: number;
};

/** source 编成信息（等价参考 Memory.sourceInfos 条目；记账字段每 tick 重算） */
export type RushSourceInfo = {
    sourceId: string;
    roomName: string;
    /** 本矿（true）/外矿 */
    my: boolean;
    /** 采集点到沉淀点路径长 */
    distance: number;
    /** 满编采集速率 */
    energyPerTick: number;
    /** 可用工作位数量 */
    numOpen: number;
    containerCoord?: string;
    /** 容器已建成 */
    constructed?: boolean;
    /** 本矿：source link 与 storage link 双全（运力需求归零） */
    linked?: boolean;
    /** 外矿房型 */
    type?: 'normal' | 'keeper';
    /** 外矿：预订有效（速率不打折） */
    reserved?: boolean;
    /** 每 tick 重算的记账字段 */
    harvestPower?: number;
    harvestingPower?: number;
    numMiner?: number;
    pendingEnergy?: number;
    lastPendingEnergy?: number;
    maxIncome?: number;
    maxHarvestPower?: number;
    constructing?: boolean;
    constructingIndex?: number;
};
