interface Room {
    /** 房间中的source数组 */
    source: Source[];
    /** 房间中的mineral对象 */
    mineral: Mineral;
    /** 房间中的spawn数组 */
    spawn: StructureSpawn[];
    /** 房间中的extension数组 */
    extension: StructureExtension[];
    /** 房间中的powerSpawn对象 */
    powerSpawn: StructurePowerSpawn;
    /** 房间中的factory对象 */
    factory: StructureFactory;
    /** 房间中的tower数组 */
    tower: StructureTower[];
    /** 房间中的nuker对象 */
    nuker: StructureNuker;
    /** 房间中的lab数组 */
    lab: StructureLab[];
    /** 房间中的link数组 */
    link: StructureLink[];
    /** 房间中的container数组 */
    container: StructureContainer[];
    /** 房间中的extractor对象 */
    extractor: StructureExtractor;
    /** 房间中的observer对象 */
    observer: StructureObserver;
    /** 得到包括此房间所有（按此顺序：）storage、terminal、factory、container的数组 */
    mass_stores: (StructureStorage | StructureTerminal | StructureFactory | StructureContainer)[];
    /** 房间中的powerBank数组 */
    powerBank: StructurePowerBank[];
    /** 房间中的deposit数组 */
    deposit: Deposit[];
    /** 房间中的rampart数组 */
    rampart: StructureRampart[];
    /** 房间中的wall数组 */
    constructedWall: StructureWall[];
    /** 房间等级 */
    level: number;
    /** 房间是否为自己所有 */
    my: boolean;
    /** 本tick的房间建筑缓存 */
    structures: any[];

    // 房间初始化
    init(): void;
    // 房间建筑缓存更新
    update(type?: string): void;
    // 房间运行
    exec(): void;
    
    // Creep数量检查
    CheckCreeps(): void;
    // 处理孵化队列
    SpawnCreeps(): void;
    // 停机检查
    ShutdownInspection(): void;
    // 计算孵化所需能量
    CalculateEnergy(bodypartList: any[]): number;
    // 主动防御
    activeDefense(): void;
    // 全部建筑工作
    StructureWork(): void;

    /** 呼叫全体tower对目标发起攻击 */
    CallTowerAttack(target: any): void;
    /** 计算全部Tower对某个creep可能造成的实际伤害 */
    TowerDamageToCreep(creep: Creep): number;
    /** 治疗房间内的己方单位 */
    TowerHealCreep(): boolean;
    /** Tower攻击敌人 */
    TowerAttackEnemy(): boolean;
    /** Tower攻击NPC */
    TowerAttackNPC(): boolean;
    /** Tower根据任务修复建筑 */
    TowerTaskRepair(): boolean;

    /** 孵化信息可视化 */
    VisualSpawnInfo(): void;
    /** 获取孵化任务的相关数据 */
    GetSpawnTaskData(): { bodypart: BodyPartConstant[], name: string, memory: CreepMemory, taskId: string, cost: number };
    /** 孵化Creep */
    SpawnCreep(): void;

    /** Lab信息可视化 */
    VisualLabInfo(): void;
    /** Lab反应 */
    RunReaction(): void;

    // 计算中心点
    CacheCenterPos(): void;
    // 计算房间内所有结构体能量
    AllEnergy(): number;
    // 判断房间所有者是否在白名单中
    isWhiteList(): boolean;
    // 获取房间指定资源储备
    getResAmount(type: ResourceConstant | string): number;
    // 获取属于该房间的creep数量
    getCreepNum(): { [role: string]: number };
    // 返回一个等级, 取决于spawn总容量
    getEffectiveRoomLevel(): number;
    // 生成role体型, 压缩形式
    GetRoleBodys(role:string, upbody?: boolean): ((BodyPartConstant | number)[])[];
    // 生成creep body
    GenerateBodys(bodypartList: ((BodyPartConstant | number)[])[], role?: string): BodyPartConstant[];
    // 检查boost资源是否足够
    CheckBoostRes(bodypart: any[], boostmap: any): boolean;
    // 根据体型和boost配置分配boot任务
    AssignBoostTaskByBody(bodypart: any[], boostmap: any): boolean;
    // 给lab分配boost任务
    AssignBoostTask(mineral: string, amount: number): void;
    // 提交lab boost任务
    SubmitBoostTask(mineral: string, amount: number): void;
    // 取消lab boost任务
    RemoveBoostTask(mineral: string): void;
    // 获取房间内最近的source
    closestSource(creep: Creep): Source;
    // 检查spawn和tower是否需要补充能量
    CheckSpawnAndTower(): boolean;
    // 自动按照预设布局建造建筑
    autoBuild(): void;
    // 自动市场交易
    autoMarket(): void;
    // 自动lab合成
    autoLab(): void;
    // 自动工厂生产
    autoFactory(): void;
    // 自动powerSpawn
    autoPower(): void;
    // 外矿采集模块
    outMine(): void;
    // 获取房间内的敌方creep
    findEnemyCreeps(opts?: any): Creep[];
    // 获取房间内的敌方建筑
    findEnemyStructures(opts?: any): AnyOwnedStructure[];
    // 获取房间建筑
    getStructures(): Structure[];
    // 获取房间所有者名字
    getOwner(): string;
    // 生成主防cost矩阵
    getDefenseCostMatrix(): CostMatrix;
    // 可视化主防cost矩阵
    showDefenseCostMatrix(): void;
}

interface RoomMemory {    
    /** source周边的最大可用位置数 */
    sourcePosCount: { [source_id: string]: number };
    /** 防御状态 */
    defend: boolean;
    /** 房间运行序号 */
    index: number;
}