/**
 * 任务系统接口定义
 * @description 定义房间任务池相关的所有接口和类型
 */

interface Room {
    // ==================== 任务池基础操作 ====================
    /**
     * 初始化任务池
     * @description 在Memory中创建该房间的任务池结构，如果已存在则跳过
     * @returns OK表示成功初始化，void表示已存在
     * @example room.initMissionPool();
     */
    initMissionPool(): OK | void;

    /**
     * 添加任务到任务池
     * @param PoolName - 任务池名称，如'transport'、'spawn'、'build'等
     * @param type - 任务类型
     * @param level - 任务优先级，数值越小优先级越高
     * @param data - 任务数据，根据任务类型不同而不同
     * @returns OK表示添加成功，void表示失败
     * @example room.addMissionToPool('transport', 'transport', 0, { source: sourceId, target: targetId, resourceType: RESOURCE_ENERGY, amount: 1000 });
     */
    addMissionToPool(PoolName: string, type: Task["type"], level: Task["level"], data: Task["data"]): OK | void;

    /**
     * 从任务池获取任务
     * @param PoolName - 任务池名称
     * @param pos - 可选，指定获取第几个任务（从0开始）
     * @param checkFunc - 可选，自定义检查函数，返回true的任务才会被获取
     * @returns 符合条件的任务对象，未找到返回null
     * @example const task = room.getMissionFromPool('transport', 0, (t) => t.data.resourceType === RESOURCE_ENERGY);
     */
    getMissionFromPool(PoolName: string, pos?: number, checkFunc?: (task: Task) => boolean): Task | null;

    /**
     * 获取任务池中的第一个任务
     * @param PoolName - 任务池名称
     * @param checkFunc - 可选，自定义检查函数
     * @returns 第一个符合条件的任务，未找到返回null或undefined
     * @example const task = room.getMissionFromPoolFirst('spawn');
     */
    getMissionFromPoolFirst(PoolName: string, checkFunc?: (task: Task) => boolean): Task | null | undefined;

    /**
     * 获取任务池中的随机一个任务
     * @param PoolName - 任务池名称
     * @returns 随机选取的任务，池为空返回null或undefined
     * @example const task = room.getMissionFromPoolRandom('repair');
     */
    getMissionFromPoolRandom(PoolName: string): Task | null | undefined;

    /**
     * 获取任务池中的所有任务
     * @param PoolName - 任务池名称
     * @returns 任务数组，池不存在返回null
     * @example const tasks = room.getAllMissionFromPool('build');
     */
    getAllMissionFromPool(PoolName: string): Task[] | null;

    /**
     * 通过ID获取任务池中的任务
     * @param PoolName - 任务池名称
     * @param id - 任务ID
     * @returns 对应的任务对象，未找到返回null或undefined
     * @example const task = room.getMissionFromPoolById('transport', 'task_123456');
     */
    getMissionFromPoolById(PoolName: string, id: Task["id"]): Task | null | undefined;

    /**
     * 检查任务池中是否存在相同任务
     * @param PoolName - 任务池名称
     * @param type - 任务类型
     * @param data - 用于比较的任务数据（部分字段）
     * @returns 相同任务的ID，不存在返回null或undefined
     * @description 根据任务类型和关键数据字段判断是否为相同任务
     * @example const existId = room.checkSameMissionInPool('manage', 'manage', { source: 'storage', target: 'terminal', resourceType: RESOURCE_ENERGY });
     */
    checkSameMissionInPool(PoolName: string, type: Task["type"], data: Task["data"]): Task['id'] | null | undefined;

    /**
     * 检查任务池中是否存在任务
     * @param PoolName - 任务池名称
     * @returns true表示存在任务，false表示为空
     * @example if (room.checkMissionInPool('spawn')) { console.log('有孵化任务'); }
     */
    checkMissionInPool(PoolName: string): boolean;

    /**
     * 获取任务池中的任务数量
     * @param PoolName - 任务池名称
     * @returns 任务数量，池不存在返回0
     * @example const count = room.getMissionNumInPool('transport');
     */
    getMissionNumInPool(PoolName: string): number;

    /**
     * 锁定任务池中的任务
     * @param PoolName - 任务池名称
     * @param id - 任务ID
     * @param creepid - 锁定该任务的creep ID
     * @returns OK表示锁定成功
     * @description 锁定后其他creep无法获取该任务
     * @example room.lockMissionInPool('transport', 'task_123', creep.id);
     */
    lockMissionInPool(PoolName: string, id: Task["id"], creepid: Id<Creep>): OK | void;

    /**
     * 解锁任务池中的任务
     * @param PoolName - 任务池名称
     * @param id - 任务ID
     * @returns OK表示解锁成功
     * @example room.unlockMissionInPool('transport', 'task_123');
     */
    unlockMissionInPool(PoolName: string, id: Task["id"]): OK | void;

    /**
     * 更新任务池中的任务
     * @param PoolName - 任务池名称
     * @param id - 任务ID
     * @param options - 更新选项
     * @param options.level - 可选，新的优先级
     * @param options.data - 可选，新的任务数据
     * @param options.lock - 可选，新的锁定状态
     * @returns OK表示更新成功
     * @example room.updateMissionPool('transport', 'task_123', { level: 1, data: { amount: 500 } });
     */
    updateMissionPool(PoolName: string, id: Task["id"], 
        options: {level?: Task["level"], data?: Task["data"], lock?: Task["lock"]}): OK | void;

    /**
     * 删除任务池中的任务
     * @param PoolName - 任务池名称
     * @param id - 任务ID
     * @returns OK表示删除成功
     * @example room.deleteMissionFromPool('build', 'task_123');
     */
    deleteMissionFromPool(PoolName: string, id: Task["id"]): OK | void;

    /**
     * 检查并清理任务池中已完成、过期或失效的任务
     * @param PoolName - 任务池名称
     * @param checkFunc - 检查函数，返回true表示任务应被删除
     * @returns OK表示检查完成
     * @example room.checkMissionPool('build', (t) => !Game.getObjectById(t.data.target));
     */
    checkMissionPool(PoolName: string, checkFunc: (t: Task) => boolean): OK | void;

    /**
     * 提交任务完成信息
     * @param PoolName - 任务池名称
     * @param id - 任务ID
     * @param data - 提交的数据（如完成的数量）
     * @param deleteFunc - 判断是否删除任务的函数，返回true则删除
     * @returns OK表示提交成功
     * @example room.submitMission('transport', 'task_123', { amount: 100 }, (t) => t.amount <= 0);
     */
    submitMission(PoolName: string, id: Task["id"], data: Task["data"], deleteFunc: (t: any) => boolean): OK | void;

    // ==================== 任务添加方法 ====================
    /**
     * 添加中央搬运任务（Manage任务）
     * @param source - 资源来源，可用缩写：s=storage, t=terminal, l=link, f=factory, p=powerSpawn
     * @param target - 资源目标，可用缩写同上
     * @param resourceType - 资源类型，支持缩写如'energy'、'U'等
     * @param amount - 搬运数量
     * @returns void
     * @description 用于storage、terminal、factory等之间的资源调配
     * @example room.ManageMissionAdd('s', 't', 'energy', 10000); // storage -> terminal 10000能量
     * @example room.ManageMissionAdd('storage', 'factory', RESOURCE_BATTERY, 500);
     */
    ManageMissionAdd(source: string, target: string, resourceType: any, amount: number): void;

    /**
     * 添加资源发送任务（Terminal发送）
     * @param targetRoom - 目标房间名
     * @param resourceType - 资源类型，支持缩写
     * @param amount - 发送数量
     * @returns OK表示成功，void表示操作完成
     * @description 通过Terminal向其他房间发送资源
     * @example room.SendMissionAdd('W1N1', RESOURCE_ENERGY, 50000);
     * @example room.SendMissionAdd('E2S3', 'U', 10000); // 发送10000 Utrium
     */
    SendMissionAdd(targetRoom: string, resourceType: string | ResourceConstant, amount: number): OK | void;

    /**
     * 添加建造或维修任务
     * @param type - 任务类型：'build'建造 或 'repair'维修
     * @param level - 任务优先级，数值越小优先级越高
     * @param data - 任务数据，BuildTask或RepairTask
     * @returns OK表示成功，void表示操作完成
     * @example room.BuildRepairMissionAdd('build', 0, { target: constructionSiteId, pos: 0 });
     * @example room.BuildRepairMissionAdd('repair', 1, { target: structureId, pos: 0, hits: 100000 });
     */
    BuildRepairMissionAdd(type: 'build' | 'repair', level: number, data: BuildTask | RepairTask): OK | void;

    /**
     * 添加运输任务
     * @param level - 任务优先级
     * @param data - 运输任务数据
     * @returns OK表示成功，void表示操作完成
     * @description 用于creep之间或creep与建筑之间的资源运输
     * @example room.TransportMissionAdd(0, { source: containerId, target: storageId, resourceType: RESOURCE_ENERGY, amount: 2000, pos: 0 });
     */
    TransportMissionAdd(level: number, data: TransportTask): OK | void;

    /**
     * 添加孵化任务
     * @param name - creep名称
     * @param body - 体型配置，可以是压缩形式数组或字符串
     * @param level - 任务优先级，-1表示使用角色默认优先级
     * @param role - 角色名称，如'harvester'、'upgrader'等
     * @param memory - 可选，creep初始memory
     * @param upbody - 可选，是否使用升级版体型
     * @returns OK(0)表示成功，-1表示失败（角色不存在或能量不足）
     * @example room.SpawnMissionAdd('harvester_1', [[WORK, 5], [CARRY, 1], [MOVE, 3]], 0, 'harvester');
     * @example room.SpawnMissionAdd('upgrader_1', 'w5c1m3', -1, 'upgrader', { targetRoom: 'W1N1' });
     */
    SpawnMissionAdd(name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, role: string, memory?: CreepMemory, upbody?: boolean): OK | -1;

    // ==================== 任务获取方法 ====================
    /**
     * 获取运输任务
     * @param creep - 请求任务的creep
     * @returns 运输任务对象，无任务返回null
     * @description 根据creep位置和任务优先级分配合适的运输任务
     * @example const task = room.getTransportMission(creep);
     */
    getTransportMission(creep: Creep): Task | null;

    /**
     * 获取建造任务
     * @param creep - 请求任务的creep
     * @returns 建造任务对象，无任务返回null
     * @example const task = room.getBuildMission(creep);
     */
    getBuildMission(creep: Creep): Task | null;

    /**
     * 获取维修任务
     * @param creep - 请求任务的creep
     * @returns 维修任务对象，无任务返回null
     * @description 优先返回低血量建筑的维修任务
     * @example const task = room.getRepairMission(creep);
     */
    getRepairMission(creep: Creep): Task | null;

    /**
     * 获取刷墙任务
     * @param creep - 请求任务的creep
     * @returns 刷墙任务数据，无任务返回null
     * @description 专门用于修复rampart和wall
     * @example const task = room.getWallMission(creep);
     */
    getWallMission(creep: Creep): RepairTask | null;

    /**
     * 获取资源发送任务
     * @returns 发送任务对象
     * @description 从terminal任务池获取send类型任务
     * @example const task = room.getSendMission();
     */
    getSendMission(): Task | null;

    /**
     * 获取发送任务的总发送数量
     * @returns 以资源类型为key，总数量为value的对象
     * @description 统计所有待发送任务的资源总量
     * @example const totals = room.getSendMissionTotalAmount(); // { energy: 50000, U: 10000 }
     */
    getSendMissionTotalAmount(): { [type: string]: number };

    /**
     * 获取孵化任务
     * @returns 孵化任务对象，无任务返回null
     * @description 从spawn任务池获取优先级最高的任务
     * @example const task = room.getSpawnMission();
     */
    getSpawnMission(): Task | null;

    /**
     * 获取孵化任务的数量统计
     * @returns 以角色为key，数量为value的对象
     * @description 统计各角色的待孵化任务数量
     * @example const nums = room.getSpawnMissionNum(); // { harvester: 1, upgrader: 2 }
     */
    getSpawnMissionNum(): { [role: string]: number };

    /**
     * 根据角色列表获取孵化任务总数
     * @param roles - 角色名称数组
     * @returns 指定角色的孵化任务总数
     * @example const total = room.getSpawnMissionTotalByRoles(['harvester', 'carrier']); // 3
     */
    getSpawnMissionTotalByRoles(roles: string[]): number;

    // ==================== 任务提交方法 ====================
    /**
     * 提交运输任务完成信息
     * @param id - 任务ID
     * @param amount - 已运输的数量
     * @returns OK表示成功，void表示任务不存在
     * @description 减少任务中的剩余数量，数量为0时自动删除任务
     * @example room.submitTransportMission('task_123', 500);
     */
    submitTransportMission(id: Task['id'], amount: TransportTask['amount']): OK | void;

    /**
     * 提交孵化任务完成信息
     * @param id - 任务ID
     * @returns OK表示成功，void表示任务不存在
     * @description 孵化完成后调用，删除对应任务
     * @example room.submitSpawnMission('task_123');
     */
    submitSpawnMission(id: Task['id']): OK | void;

    // ==================== 任务更新 ====================
    /**
     * 任务更新主循环
     * @description 每tick调用，检查并更新所有任务池的状态
     * - 清理已完成或失效的任务
     * - 更新任务优先级
     * - 处理超时任务
     * @example room.MissionUpdate();
     */
    MissionUpdate(): void;
}


// ==================== 任务池接口 ====================
/**
 * 任务池接口
 * @description 存储不同类型的任务数组
 */
interface MissionPool {
    /** 任务类型 -> 任务数组 */
    [type: string]: Task[]
}

// ==================== 任务接口 ====================
/**
 * 任务基础接口
 * @description 所有任务类型的基础结构
 */
interface Task {
    /** 
     * 任务唯一ID
     * @description 格式通常为 'task_' + Game.time + '_' + 随机数
     */
    id: string;
    
    /** 
     * 任务优先级
     * @description 数值越小优先级越高，0为最高优先级
     */
    level: number;
    
    /** 
     * 任务类型
     * @description 用于区分不同类型的任务处理逻辑
     */
    type: 'transport' | 'manage' | 'build' | 'repair' | 'send' | 'spawn';
    
    /** 
     * 任务数据
     * @description 根据任务类型存储不同的数据结构
     */
    data: TransportTask | BuildTask | RepairTask | ManageTask | SendTask | SpawnTask | any;
    
    /** 
     * 任务是否被锁定
     * @description 锁定后其他creep无法获取该任务
     */
    lock?: boolean;
    
    /** 
     * 绑定该任务的creep ID
     * @description 用于追踪任务执行者
     */
    bindCreep?: Id<Creep> | null;
}

// ==================== 具体任务类型 ====================
/**
 * 运输任务数据
 * @description 用于creep运输资源的任务
 */
interface TransportTask {
    /** 
     * 资源来源建筑ID
     * @description 从该建筑取出资源
     */
    source: Id<Structure>;
    
    /** 
     * 资源目标建筑ID
     * @description 将资源放入该建筑
     */
    target: Id<Structure>;
    
    /** 
     * 资源类型
     * @description 如RESOURCE_ENERGY、RESOURCE_UTRIUM等
     */
    resourceType: ResourceConstant;
    
    /** 
     * 资源数量
     * @description 需要运输的总数量
     */
    amount: number;
    
    /** 
     * 任务位置索引
     * @description 用于任务排序
     */
    pos: number;
}

/**
 * 建造任务数据
 * @description 用于建造建筑工地的任务
 */
interface BuildTask {
    /** 
     * 建造目标ID
     * @description 建筑工地或建筑的ID
     */
    target: Id<Structure> | Id<ConstructionSite>;
    
    /** 
     * 任务位置索引
     */
    pos: number;
}

/**
 * 维修任务数据
 * @description 用于维修建筑的任务
 */
interface RepairTask {
    /** 
     * 维修目标ID
     */
    target: Id<Structure> | Id<ConstructionSite>;
    
    /** 
     * 任务位置索引
     */
    pos: number;
    
    /** 
     * 目标血量
     * @description 维修到该血量后任务完成
     */
    hits: number;
}

/**
 * 中央搬运任务数据
 * @description 用于storage、terminal、factory等之间的资源调配
 */
interface ManageTask {
    /** 
     * 资源来源
     * @description 可选值：storage、terminal、link、factory、powerSpawn
     */
    source: 'storage' | 'terminal' | 'link' | 'factory' | 'powerSpawn';
    
    /** 
     * 资源目标
     * @description 可选值：storage、terminal、link、factory、powerSpawn
     */
    target: 'storage' | 'terminal' | 'link' | 'factory' | 'powerSpawn';
    
    /** 
     * 资源类型
     */
    resourceType: ResourceConstant;
    
    /** 
     * 搬运数量
     */
    amount: number;
}

/**
 * 发送任务数据
 * @description 用于Terminal发送资源到其他房间
 */
interface SendTask {
    /** 
     * 目标房间名
     * @description 如'W1N1'、'E2S3'等
     */
    targetRoom: string;
    
    /** 
     * 资源类型
     */
    resourceType: ResourceConstant;
    
    /** 
     * 发送数量
     */
    amount: number;
}

/**
 * 孵化任务数据
 * @description 用于孵化creep的任务
 */
interface SpawnTask {
    /** 
     * creep名称
     * @description 必须唯一，最大100字符
     */
    name: string;
    
    /** 
     * 体型配置
     * @description 压缩形式的体型数组，如[[WORK, 5], [CARRY, 1], [MOVE, 3]]
     */
    body: ((BodyPartConstant | number)[])[];
    
    /** 
     * creep初始memory
     * @description 包含role等基础信息
     */
    memory: CreepMemory;
    
    /** 
     * 孵化所需能量
     * @description 预计算的能量消耗
     */
    energy: number;
    
    /** 
     * 是否使用升级版体型
     * @description 某些角色有多种体型配置
     */
    upbody?: boolean;
}
