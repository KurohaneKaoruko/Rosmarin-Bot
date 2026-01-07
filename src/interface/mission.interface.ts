interface Room {
    // 任务池初始化
    initMissionPool(): OK | void;
    // 添加任务到任务池
    addMissionToPool(PoolName: string, type: Task["type"], level: Task["level"], data: Task["data"]): OK | void;
    // 获取任务池中的任务
    getMissionFromPool(PoolName: string, pos?: number, checkFunc?: (task: Task) => boolean): Task | null;
    // 获取任务池中的第一个任务
    getMissionFromPoolFirst(PoolName: string, checkFunc?: (task: Task) => boolean): Task | null;
    // 获取任务池中的随机一个任务
    getMissionFromPoolRandom(PoolName: string): Task | null;
    // 获取任务池中的所有任务
    getAllMissionFromPool(PoolName: string): Task[] | null;
    // 用id获取任务池中的任务
    getMissionFromPoolById(PoolName: string, id: Task["id"]): Task | null;
    // 检查是否有相同任务
    checkSameMissionInPool(PoolName: string, type: Task["type"], data: Task["data"]): Task['id'] | null;
    // 检查任务池中是否存在任务
    checkMissionInPool(PoolName: string): boolean;
    // 获取任务池中的任务数量
    getMissionNumInPool(PoolName: string): number;
    // 锁定任务池中的任务
    lockMissionInPool(PoolName: string, id: Task["id"], creepid: Id<Creep>): OK | void;
    // 解锁任务池中的任务
    unlockMissionInPool(PoolName: string, id: Task["id"]): OK | void;
    // 更新任务池中的任务
    updateMissionPool(PoolName: string, id: Task["id"], 
        {level, data, lock}: 
        {level?: Task["level"], data?: Task["data"], lock?: Task["lock"]}): OK | void;
    // 删除任务池中的任务
    deleteMissionFromPool(PoolName: string, id: Task["id"]): OK | void;
    // 检查任务池中的任务是否已完成、过期、失效
    checkMissionPool(PoolName: string, checkFunc: (t: Task) => boolean): OK | void;
    // 提交任务完成信息
    submitMission(PoolName: string, id: Task["id"], data: Task["data"], deleteFunc: (t: any) => boolean): OK | void;

    // 添加中央搬运任务
    ManageMissionAdd(source: string, target: string, resourceType: any, amount: number): void;
    // 添加建造与维修任务
    BuildRepairMissionAdd(type: 'build' | 'repair', level: number, data: any): void;
    // 添加运输任务
    TransportMissionAdd(level: number, data: TransportTask): OK | void;
    // 添加资源发送任务
    SendMissionAdd(target: string, resourceType: string | ResourceConstant, amount: number): OK | void;
    // 添加孵化任务
    SpawnMissionAdd(name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, role: string, memory?: any): OK | -1;

    // 获取运输任务
    getTransportMission(creep: Creep): Task | null;
    // 获取建造或维修任务
    getBuildMission(creep: Creep): Task | null;
    // 获取维修或刷墙任务
    getRepairMission(creep: Creep): Task | null;
    // 获取刷墙任务
    getWallMission(creep: Creep): RepairTask | null;
    // 获取资源发送任务
    getSendMission();
    // 获取发送任务的总发送数量
    getSendMissionTotalAmount(): {[type: string]: number};
    // 获取孵化任务
    getSpawnMission(): Task | null;
    // 获取孵化任务的数量
    getSpawnMissionNum(): {[type: string]: number};
    // 根据roles获取孵化任务的总数量
    getSpawnMissionTotalByRoles(roles: string[]): number;
    
    // 提交运输任务完成信息
    submitTransportMission(id: Task['id'], amount: TransportTask['amount']): void;
    // 提交孵化任务完成信息
    submitSpawnMission(id: Task['id']): void;

    // 任务更新
    MissionUpdate(): void;
}

interface Memory {
    MissionPools: {
        [roomName: string]: MissionPool
    };
}

interface MissionPool {
    [type: string]: Task[]
};

interface Task {
    id: string, // 任务id
    level: number,  // 优先级
    type: 'transport' | 'manage' | 'build' | 'repair' | 'send' | 'spawn',  // 任务类型
    data: TransportTask | BuildTask | RepairTask | ManageTask | SendTask | SpawnTask | any // 任务数据
    lock?: boolean, // 任务是否被锁定
    bindCreep?: Id<Creep> | null, // 绑定该任务的creep
}

interface TransportTask {
    source: Id<Structure>,  // 资源来源
    target: Id<Structure>,  // 资源目标
    resourceType: ResourceConstant, // 资源类型
    amount: number, // 资源数量
    pos: number,  // 任务位置
}

interface BuildTask {
    target: Id<Structure> | Id<ConstructionSite>,
    pos: number,  // 任务位置
}

interface RepairTask {
    target: Id<Structure> | Id<ConstructionSite>,
    pos: number,  // 任务位置
    hits: number,
}

interface ManageTask {
    source: 'storage' | 'terminal' | 'link' | 'factory' | 'powerSpawn',  // 资源来源
    target: 'storage' | 'terminal' | 'link' | 'factory' | 'powerSpawn',  // 资源目标
    resourceType: ResourceConstant,
    amount: number,
}

interface SendTask {
    targetRoom: string,
    resourceType: ResourceConstant,
    amount: number,
}

interface SpawnTask {
    name: string,
    body: any[],
    memory: CreepMemory,
    energy: number,
    upbody?: boolean,
}
