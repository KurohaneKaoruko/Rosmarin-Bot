interface Room {
    // ==================== 房间建筑缓存 ====================
    /** 
     * 房间中的source数组
     * @description 缓存房间内所有能量源，每tick自动更新
     * @example const sources = room.source; // Source[]
     */
    source: Source[];
    
    /** 
     * 房间中的mineral对象
     * @description 缓存房间内的矿物资源点
     */
    mineral: Mineral;
    
    /** 
     * 房间中的spawn数组
     * @description 缓存房间内所有孵化器
     */
    spawn: StructureSpawn[];
    
    /** 
     * 房间中的extension数组
     * @description 缓存房间内所有扩展
     */
    extension: StructureExtension[];
    
    /** 
     * 房间中的powerSpawn对象
     * @description 缓存房间内的PowerSpawn建筑
     */
    powerSpawn: StructurePowerSpawn;
    
    /** 
     * 房间中的factory对象
     * @description 缓存房间内的工厂建筑
     */
    factory: StructureFactory;
    
    /** 
     * 房间中的tower数组
     * @description 缓存房间内所有防御塔
     */
    tower: StructureTower[];
    
    /** 
     * 房间中的nuker对象
     * @description 缓存房间内的核弹发射井
     */
    nuker: StructureNuker;
    
    /** 
     * 房间中的lab数组
     * @description 缓存房间内所有实验室
     */
    lab: StructureLab[];

    /** 
     * 房间中的link数组
     * @description 缓存房间内所有Link建筑
     */
    link: StructureLink[];
    
    /** 
     * 房间中的container数组
     * @description 缓存房间内所有容器
     */
    container: StructureContainer[];
    
    /** 
     * 房间中的extractor对象
     * @description 缓存房间内的矿物提取器
     */
    extractor: StructureExtractor;
    
    /** 
     * 房间中的observer对象
     * @description 缓存房间内的观察者建筑
     */
    observer: StructureObserver;

    /**
     * 房间中的Road对象
     * @description 缓存房间内的路建筑
     */
    road: StructureRoad[];
    
    /** 
     * 得到包括此房间所有（按此顺序：）storage、terminal、factory、container的数组
     * @description 用于统计房间内所有可存储资源的建筑
     * @example const totalEnergy = room.mass_stores.reduce((sum, s) => sum + s.store[RESOURCE_ENERGY], 0);
     */
    mass_stores: (StructureStorage | StructureTerminal | StructureFactory | StructureContainer)[];
    
    /** 
     * 房间中的powerBank数组
     * @description 缓存房间内所有PowerBank（通常在过道房间）
     */
    powerBank: StructurePowerBank[];
    
    /** 
     * 房间中的deposit数组
     * @description 缓存房间内所有矿藏点
     */
    deposit: Deposit[];
    
    /** 
     * 房间中的rampart数组
     * @description 缓存房间内所有城墙
     */
    rampart: StructureRampart[];
    
    /** 
     * 房间中的wall数组
     * @description 缓存房间内所有人造墙
     */
    constructedWall: StructureWall[];
    
    /** 
     * 房间等级
     * @description 房间控制器等级，0-8
     */
    level: number;
    
    /** 
     * 房间是否为自己所有
     * @description 判断房间控制器是否属于当前玩家
     */
    my: boolean;
    
    /** 
     * 本tick的房间建筑缓存
     * @description 缓存房间内所有建筑，避免重复查找
     */
    structures: Structure[];


    // ==================== 核心方法 ====================
    /** 
     * 房间初始化
     * @description 初始化房间的各种缓存和任务池
     */
    init(): void;
    
    /** 
     * 房间建筑缓存更新
     * @param type - 可选，指定要更新的建筑类型，不传则更新全部
     * @description 更新房间内建筑的缓存数据
     */
    update(type?: string): void;
    
    /** 
     * 房间运行
     * @description 执行房间的主循环逻辑，包括建筑工作、任务更新等
     */
    exec(): void;

    // ==================== 基础功能 ====================
    /** 
     * 计算房间内所有结构体能量
     * @returns 房间内storage、terminal、factory、container中的能量总和
     * @example const totalEnergy = room.AllEnergy(); // 返回如 500000
     */
    AllEnergy(): number;
    
    /** 
     * 判断房间所有者是否在白名单中
     * @returns true表示房间所有者在白名单中，false表示不在
     * @description 检查Memory['whitelist']中是否包含房间控制器所有者
     */
    isWhiteList(): boolean;
    
    /** 
     * 获取房间指定资源储备
     * @param type - 资源类型常量，如RESOURCE_ENERGY、RESOURCE_UTRIUM等
     * @returns 房间storage和terminal中该资源的总量，无效资源返回0
     * @example const energy = room.getResAmount(RESOURCE_ENERGY); // 返回如 100000
     */
    getResAmount(type: ResourceConstant | string): number;

    /** 
     * 获取属于该房间的creep数量
     * @returns 以role为key，数量为value的对象
     * @description 统计所有home为该房间的creep，按角色分类计数
     * @example const nums = room.getCreepNum(); // { harvester: 2, upgrader: 1, ... }
     */
    getCreepNum(): { [role: string]: number };
    
    /** 
     * 返回一个等级, 取决于spawn总容量
     * @returns 有效房间等级（1-8），根据实际可用能量容量计算
     * @description 当spawn和extension未建满时，返回实际可用的等级
     */
    getEffectiveRoomLevel(): number;
    
    /** 
     * 检查spawn和tower是否需要补充能量
     * @returns true表示需要补充，false表示已满
     * @description 检查房间能量是否已满且所有tower能量充足（空余<100）
     */
    CheckSpawnAndTower(): boolean;
    
    /** 
     * 获取房间内最近的source
     * @param creep - 需要分配source的creep
     * @returns 绑定creep最少且有空位的source，或null
     * @description 智能分配source，避免多个creep挤在同一个source
     */
    closestSource(creep: Creep): Source;
    
    /** 
     * 获取房间内的敌方creep
     * @param opts - 可选的过滤选项，同Room.find的filter
     * @returns 不在白名单中的敌方creep数组
     * @description 结果会缓存到当前tick，避免重复查找
     */
    findEnemyCreeps(opts?: FilterOptions<FIND_HOSTILE_CREEPS>): Creep[];
    
    /** 
     * 获取房间内的敌方PowerCreep
     * @param opts - 可选的过滤选项
     * @returns 不在白名单中的敌方PowerCreep数组
     */
    findEnemyPowerCreeps(opts?: FilterOptions<FIND_HOSTILE_POWER_CREEPS>): PowerCreep[];
    
    /** 
     * 获取房间内的敌方建筑
     * @param opts - 可选的过滤选项
     * @returns 不在白名单中的敌方建筑数组
     */
    findEnemyStructures(opts?: FilterOptions<FIND_HOSTILE_STRUCTURES>): AnyOwnedStructure[];
    
    /** 
     * 获取房间建筑
     * @returns 房间内所有建筑的数组，结果会缓存
     */
    getStructures(): Structure[];
    
    /** 
     * 获取房间所有者名字
     * @returns 房间控制器所有者的用户名，无所有者返回空字符串
     */
    getOwner(): string;


    // ==================== 体型生成 ====================
    /** 
     * 生成role体型, 压缩形式
     * @param role - 角色名称，如'harvester'、'upgrader'等
     * @param upbody - 可选，是否使用升级版体型
     * @returns 压缩形式的体型数组，如[[WORK, 5], [CARRY, 1], [MOVE, 3]]
     * @description 根据房间等级和能量容量动态生成合适的体型
     * @example const body = room.GetRoleBodys('harvester'); // [[WORK, 5], [CARRY, 1], [MOVE, 3]]
     */
    GetRoleBodys(role: string, upbody?: boolean): ((BodyPartConstant | number)[])[];
    
    /** 
     * 生成creep body
     * @param bodypartList - 压缩形式的体型数组，如[[WORK, 5], [CARRY, 1], [MOVE, 3]]
     * @param role - 可选，角色名称，用于特殊体型排列
     * @returns 展开后的body数组，如[WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE]
     * @description 将压缩体型展开为实际body数组，某些角色有特殊排列顺序
     */
    GenerateBodys(bodypartList: ((BodyPartConstant | number)[])[], role?: string): BodyPartConstant[];
    
    /** 
     * 计算孵化所需能量
     * @param bodypartList - 展开后的body数组
     * @returns 孵化该body所需的能量值
     * @example const cost = room.CalculateEnergy([WORK, CARRY, MOVE]); // 200
     */
    CalculateEnergy(bodypartList: BodyPartConstant[]): number;

    // ==================== Boost相关 ====================
    /** 
     * 检查boost资源是否足够
     * @param bodypart - 压缩形式的体型数组
     * @param boostmap - 部件到boost资源的映射，如{ work: 'XUH2O', tough: 'XGHO2' }
     * @returns true表示资源足够，false表示不足
     * @description 检查房间内是否有足够的boost资源来强化指定体型
     */
    CheckBoostRes(bodypart: (BodyPartConstant | number)[][], boostmap: { [bodypart: string]: MineralBoostConstant }): boolean;
    
    /** 
     * 根据体型和boost配置分配boot任务
     * @param bodypart - 压缩形式的体型数组
     * @param boostmap - 可选，部件到boost资源的映射
     * @returns true表示分配成功，false表示资源不足
     * @description 为指定体型的每个需要boost的部件分配lab任务
     */
    AssignBoostTaskByBody(bodypart: (BodyPartConstant | number)[][], boostmap?: { [bodypart: string]: MineralBoostConstant }): boolean;
    
    /** 
     * 给lab分配boost任务
     * @param mineral - boost资源类型
     * @param amount - 需要的资源数量（部件数*30）
     * @returns true表示分配成功，false表示没有可用lab
     * @description 找到空闲的lab并分配boost任务，如无可用lab则加入队列
     */
    AssignBoostTask(mineral: ResourceConstant, amount: number): boolean;

    /** 
     * 提交lab boost任务
     * @param mineral - boost资源类型
     * @param amount - 已使用的资源数量
     * @returns OK表示成功，ERR_NOT_FOUND表示未找到对应任务
     * @description 当creep完成boost后调用，减少任务中的剩余量
     */
    SubmitBoostTask(mineral: string, amount: number): ScreepsReturnCode;
    
    /** 
     * 取消lab boost任务
     * @param mineral - boost资源类型
     * @returns OK表示成功，ERR_NOT_FOUND表示未找到对应任务
     * @description 删除指定资源的boost任务
     */
    RemoveBoostTask(mineral: string): ScreepsReturnCode;

    // ==================== 防御相关 ====================
    /** 
     * 主动防御
     * @description 执行房间的主动防御逻辑，包括tower攻击、creep调度等
     */
    activeDefense(): void;
    
    /** 
     * 生成主防cost矩阵
     * @returns PathFinder.CostMatrix对象，用于防御路径规划
     * @description 生成考虑防御建筑的cost矩阵
     */
    getDefenseCostMatrix(): CostMatrix;
    
    /** 
     * 可视化主防cost矩阵
     * @description 在房间中显示cost矩阵的可视化效果，用于调试
     */
    showDefenseCostMatrix(): void;

    // ==================== 建筑工作 ====================
    /** 
     * 全部建筑工作
     * @description 执行房间内所有建筑的工作逻辑
     */
    StructureWork(): void;
    
    /** 
     * Spawn工作
     * @description 执行孵化器的孵化逻辑
     */
    SpawnWork(): void;
    
    /** 
     * Tower工作
     * @description 执行防御塔的攻击、治疗、维修逻辑
     */
    TowerWork(): void;
    
    /** 
     * Link工作
     * @description 执行Link的能量传输逻辑
     */
    LinkWork(): void;
    
    /** 
     * Lab工作
     * @description 执行实验室的化合物合成逻辑
     */
    LabWork(): void;
    
    /** 
     * Terminal工作
     * @description 执行终端的资源发送和市场交易逻辑
     */
    TerminalWork(): void;
    
    /** 
     * Factory工作
     * @description 执行工厂的商品生产逻辑
     */
    FactoryWork(): void;
    
    /** 
     * PowerSpawn工作
     * @description 执行PowerSpawn的power处理逻辑
     */
    PowerSpawnWork(): void;


    // ==================== Tower控制 ====================
    /** 
     * 呼叫全体tower对目标发起攻击
     * @param target - 攻击目标（Creep、PowerCreep或Structure）
     * @description 所有能量>=10的tower对目标发起攻击
     */
    CallTowerAttack(target: Creep | PowerCreep | Structure): void;
    
    /** 
     * 呼叫全体tower对目标治疗
     * @param target - 治疗目标（Creep或PowerCreep）
     * @description 所有能量>=10的tower对目标进行治疗
     */
    CallTowerHeal(target: Creep | PowerCreep): void;
    
    /** 
     * 呼叫全体tower对目标维修
     * @param target - 维修目标建筑
     * @param energy - 可选，tower最低能量要求，默认10
     * @description 所有能量>=energy的tower对目标进行维修
     */
    CallTowerRepair(target: Structure, energy?: number): void;
    
    /** 
     * 计算Tower的伤害
     * @param dist - 攻击距离（格数）
     * @returns 单个tower在该距离的伤害值（600-150）
     * @description 距离<=5时600伤害，5-20线性递减，>=20时150伤害
     * @example room.TowerDamage(5); // 600
     * @example room.TowerDamage(10); // 450
     * @example room.TowerDamage(25); // 150
     */
    TowerDamage(dist: number): number;
    
    /** 
     * 计算全部tower对某一点的伤害总值
     * @param pos - 目标位置
     * @returns 所有tower对该位置的伤害总和，考虑PWR_OPERATE_TOWER效果
     * @description 如果pos不在本房间，返回0
     */
    TowerTotalDamage(pos: RoomPosition): number;
    
    /** 
     * 计算全部Tower对某个creep可能造成的实际伤害
     * @param creep - 目标creep
     * @returns 考虑tough减伤和治疗后的实际伤害值
     * @description 计算考虑boost tough减伤、周围治疗单位后的净伤害
     */
    TowerDamageToCreep(creep: Creep): number;
    
    /** 
     * 治疗房间内的己方单位
     * @returns true表示有单位被治疗，false表示无需治疗
     * @description 优先治疗战斗单位，随机分配tower避免过度治疗
     */
    TowerHealCreep(): boolean;
    
    /** 
     * Tower攻击敌人
     * @returns true表示有敌人被攻击，false表示无敌人
     * @description 集火攻击能造成最高伤害的敌人
     */
    TowerAttackEnemy(): boolean;
    
    /** 
     * Tower攻击NPC
     * @returns true表示有NPC被攻击，false表示无NPC
     * @description 攻击Source Keeper和Invader
     */
    TowerAttackNPC(): boolean;
    
    /** 
     * Tower根据任务修复建筑
     * @returns true表示有建筑被修复，false表示无需修复
     * @description 从repair任务池获取任务，优先修复低血量建筑
     */
    TowerTaskRepair(): boolean;


    // ==================== Spawn控制 ====================
    /** 
     * 孵化信息可视化
     * @description 在spawn位置显示当前孵化进度和队列信息
     */
    VisualSpawnInfo(): void;
    
    /** 
     * 获取孵化任务的相关数据
     * @returns 孵化任务数据对象，包含bodypart、name、memory、taskId、cost，无任务返回null
     * @description 从spawn任务池获取下一个要孵化的任务
     */
    GetSpawnTaskData(): { 
        /** 展开后的body数组 */
        bodypart: BodyPartConstant[], 
        /** creep名称 */
        name: string, 
        /** creep初始memory */
        memory: CreepMemory, 
        /** 任务ID */
        taskId: string, 
        /** 孵化能量消耗 */
        cost: number 
    } | null;
    
    /** 
     * 孵化Creep
     * @description 执行孵化逻辑，从任务池获取任务并孵化
     */
    SpawnCreep(): void;

    // ==================== Lab控制 ====================
    /** 
     * Lab信息可视化
     * @description 在lab位置显示当前资源和反应信息
     */
    VisualLabInfo(): void;
    
    /** 
     * Lab反应
     * @description 执行lab的化合物合成反应
     */
    RunReaction(): void;

    // ==================== 自动任务 ====================
    /** 
     * 自动按照预设布局建造建筑
     * @description 根据Memory中的布局数据自动放置建筑工地
     */
    autoBuild(): void;
    
    /** 
     * 自动市场交易
     * @description 自动处理市场订单，买卖资源
     */
    autoMarket(): void;
    
    /** 
     * 自动lab合成
     * @description 自动安排lab的化合物合成任务
     */
    autoLab(): void;
    
    /** 
     * 自动工厂生产
     * @description 自动安排工厂的商品生产任务
     */
    autoFactory(): void;
    
    /** 
     * 自动powerSpawn
     * @description 自动处理power资源
     */
    autoPower(): void;


    // ==================== 外矿采集 ====================
    /**
     * 外矿采集主函数
     * @description 处理房间的外矿采集逻辑，包括能量矿、中央九房、过道观察、Power采集、Deposit采集
     * @example room.outMine(); // 在房间exec()中调用
     */
    outMine(): void;

    /**
     * 能量矿采集
     * @description 处理外矿能量源的采集，包括侦查、预定、采集、搬运、建造等
     */
    EnergyMine(): void;

    /**
     * 中央九房采集
     * @description 处理中央九房(SK房)的资源采集，包括Source Keeper房间的特殊处理
     */
    CenterMine(): void;

    /**
     * 观察过道
     * @description 使用Observer观察过道房间，寻找PowerBank和Deposit
     */
    LookHighWay(): void;

    /**
     * Power采集
     * @description 处理PowerBank的采集任务，包括攻击队、治疗队、搬运队的孵化
     */
    PowerMine(): void;

    /**
     * Deposit采集
     * @description 处理Deposit的采集任务，包括采集者和搬运者的孵化
     */
    DepositMine(): void;
}

/**
 * 房间Memory接口
 * @description 存储房间相关的持久化数据
 */
interface RoomMemory {
    /** 
     * source周边的最大可用位置数
     * @description 缓存每个source周围可站立的位置数量，用于分配harvester
     * @example { "sourceId1": 3, "sourceId2": 5 }
     */
    sourcePosCount: { [source_id: string]: number };
    
    /** 
     * 防御状态
     * @description true表示房间处于防御状态，会触发防御逻辑
     */
    defend: boolean;
    
    /** 
     * 房间运行序号
     * @description 用于分散不同房间的运行时机，避免CPU峰值
     */
    index: number;

    // ==================== 外矿采集任务 ====================
    
    /**
     * Power采集任务数据
     * @description 存储各过道房间的PowerBank采集任务
     * @example
     * ```typescript
     * this.memory['powerMine'] = {
     *     'E5N5': { creep: 2, boostLevel: 1, prNum: 1, active: true }
     * };
     * ```
     */
    powerMine?: {
        [roomName: string]: PowerMineTaskData;
    };

    /**
     * Deposit采集任务数据
     * @description 存储各过道房间的Deposit采集任务
     * - 以房间名为key时，value为DepositMineTaskData对象
     * - 以deposit.id为key时，value为可用位置数量(number)
     * @example
     * ```typescript
     * // 房间级任务数据
     * this.memory['depositMine'] = {
     *     'E5N5': { type: 'silicon', num: 2, active: true }
     * };
     * // 或者 deposit 级位置数据
     * this.memory['depositMine'] = {
     *     '5f1234567890abcdef': 3  // deposit周围可用位置数
     * };
     * ```
     */
    depositMine?: {
        [roomNameOrDepositId: string]: DepositMineTaskData | number;
    };
}

/**
 * Power采集任务数据
 * @description 单个PowerBank采集任务的配置
 */
interface PowerMineTaskData {
    /** 
     * 采集队数量
     * @description 同时工作的攻击+治疗队伍数量
     */
    creep: number;
    
    /** 
     * boost等级
     * @description 0=无boost, 1=T1 boost, 2=T2 boost
     */
    boostLevel: number;
    
    /** 
     * Ranged攻击手数量
     * @description 用于清理周围敌人的远程攻击者数量
     */
    prNum: number;
    
    /** 
     * 任务是否激活
     * @description false时暂停孵化新的采集队
     */
    active?: boolean;

    /** 
     * 已孵化计数
     * @description 已经孵化的攻击+治疗队伍数量
     */
    count?: number;

    /** 
     * 最大孵化数量
     * @description 孵化上限，防止意外情况导致过度孵化
     */
    max?: number;

    /** 
     * Ranged已孵化计数
     */
    prCount?: number;

    /** 
     * Ranged最大孵化数量
     */
    prMax?: number;
}

/**
 * Deposit采集任务数据
 * @description 单个Deposit采集任务的配置
 */
interface DepositMineTaskData {
    /** 
     * Deposit类型
     * @description 矿藏类型：silicon, metal, biomass, mist
     */
    type?: DepositConstant;
    
    /** 
     * 工作creep数量
     * @description 同时工作的采集者数量
     */
    num: number;
    
    /** 
     * 任务是否激活
     * @description false时暂停孵化新的采集者
     */
    active?: boolean;
}
