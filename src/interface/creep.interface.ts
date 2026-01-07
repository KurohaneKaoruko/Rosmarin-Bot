
/**
 * Creep接口扩展
 * @description 扩展Screeps原生Creep类，添加自定义方法
 */
interface Creep {
    // ==================== 核心方法 ====================
    /** 
     * 初始化
     * @description 初始化creep的状态和缓存
     */
    init(): void;
    
    /** 
     * 运行
     * @description 执行creep的主循环逻辑
     */
    exec(): void;
    
    /** 
     * 爬唱歌
     * @description 随机显示一条消息
     */
    randomSing(): void;

    // ==================== 移动功能 (MoveFunction) ====================
    /** 
     * 移动到指定房间
     * @param roomName - 目标房间名
     * @param options - 可选的移动选项
     * @returns 移动结果状态码
     */
    moveToRoom(roomName: string, options?: MoveToOpts): ScreepsReturnCode;
    
    /** 
     * 移动到所属房间 (home)
     * @returns true表示已到达，false表示正在移动
     * @description 移动到creep.memory.home或homeRoom指定的房间
     */
    moveHomeRoom(): boolean;
    
    /** 
     * 移动到目标房间
     * @param options - 可选的移动选项
     * @returns true表示已到达，false表示正在移动
     * @description 移动到creep.memory.targetRoom指定的房间
     */
    moveToTargetRoom(options?: MoveToOpts): boolean;
    
    /** 
     * 移动到资源房间
     * @param options - 可选的移动选项
     * @returns true表示已到达，false表示正在移动
     * @description 移动到creep.memory.sourceRoom指定的房间
     */
    moveToSourceRoom(options?: MoveToOpts): boolean;
    
    /** 
     * 检查是否在房间边缘并处理
     * @returns true表示在边缘并已处理，false表示不在边缘
     * @description 防止creep卡在房间边界
     */
    handleRoomEdge(): boolean;


    // ==================== 双人小队功能 (DoubleAction) ====================
    /** 
     * 双人小队移动
     * @param Direction - 移动方向常量
     * @returns 移动结果
     * @description 两个绑定的creep同时移动
     */
    doubleMove(Direction: DirectionConstant): number;
    
    /** 
     * 双人小队移动到目标
     * @param target - 目标位置
     * @param color - 可选，路径可视化颜色
     * @param ops - 可选，移动选项
     * @returns 移动结果
     */
    doubleMoveTo(target: RoomPosition, color?: string, ops?: MoveToOpts): number | boolean;
    
    /** 
     * 双人小队移动到目标房间
     * @param roomName - 目标房间名
     * @param color - 可选，路径可视化颜色
     * @returns true表示已到达，false表示正在移动
     */
    doubleMoveToRoom(roomName: string, color?: string): boolean;
    
    /** 
     * 躲边界
     * @returns true表示需要躲避，false表示不需要
     * @description 防止双人小队卡在房间边界
     */
    doubleFleeEdge(): boolean;
    
    /** 
     * 规避敌人
     * @returns 规避结果
     * @description 双人小队躲避敌方单位
     */
    doubleFlee(): number;
    
    /** 
     * 双人小队攻击
     * @param target - 攻击目标
     * @returns 攻击结果
     */
    doubleToAttack(target: Creep | Structure): number | boolean;
    
    /** 
     * 双人小队拆除
     * @param target - 拆除目标
     * @returns 拆除结果
     */
    doubleToDismantle(target: Structure): number | boolean;

    // ==================== 基础功能 (BaseFunction) ====================
    /** 
     * 获取能量
     * @param pickup - 可选，是否拾取掉落资源，默认true
     * @description 智能获取能量：优先从建筑提取，其次拾取掉落，最后采集source
     * @example creep.TakeEnergy(); // 自动获取能量
     * @example creep.TakeEnergy(false); // 不拾取掉落资源
     */
    TakeEnergy(pickup?: boolean): void;

    /** 
     * 根据给定配置boost
     * @param boostmap - 部件到boost资源的映射，如{ work: 'XUH2O', tough: 'XGHO2' }
     * @returns 0表示完成，1表示下一tick继续，-1表示资源不足，-2表示找不到lab
     * @description 移动到lab并进行boost强化
     * @example 
     * const result = creep.Boost({ work: 'XUH2O', tough: 'XGHO2' });
     * if (result === 0) { // boost完成，执行后续逻辑 }
     */
    Boost(boostmap: { [part: string]: string }): number;
    
    /** 
     * boost creep
     * @param boostTypes - 强化的资源类型数组，如['XUH2O', 'XGHO2']
     * @param must - 可选，是否必须boost，默认false
     * @param reserve - 可选，是否为预定的boost，默认false
     * @returns true表示boost完成或不需要boost，false表示正在进行
     * @description 按优先级顺序进行boost，失败5次后放弃
     */
    goBoost(boostTypes: string[], must?: boolean, reserve?: boolean): boolean;
    
    /** 
     * 解除boost
     * @returns true表示完成，false表示正在进行
     * @description 移动到lab旁的container并解除boost
     */
    unboost(): boolean;
    
    /** 
     * 是否处于白名单中
     * @returns true表示在白名单中，false表示不在
     * @description 检查creep所有者是否在Memory['whitelist']中
     */
    isWhiteList(): boolean;
    
    /** 
     * 检查 boost 是否就绪
     * @returns true表示boost就绪或不需要boost，false表示未完成
     * @description 检查creep是否已完成所有需要的boost
     */
    isBoostReady(): boolean;
    
    /** 
     * 切换任务状态
     * @param resourceType - 可选，检查的资源类型，不传则检查所有资源
     * @returns 'source'表示需要获取资源，'target'表示需要执行任务，null表示不需要切换
     * @description 根据creep存储状态判断应该切换到哪个状态
     * @example
     * const state = creep.switchTaskState(RESOURCE_ENERGY);
     * if (state === 'source') { // 去获取能量 }
     * else if (state === 'target') { // 去执行任务 }
     */
    switchTaskState(resourceType?: ResourceConstant): 'source' | 'target' | null;


    // ==================== 工作功能 (WorkFunction) ====================
    /** 
     * 采集资源
     * @param target - 采集目标（Source或Mineral）
     * @returns true表示正在采集，false表示正在移动，null表示目标无效
     * @description 如果不在范围内会自动移动
     */
    goHaverst(target: Source | Mineral): boolean;
    
    /** 
     * 从指定结构中提取资源
     * @param target - 提取目标（Structure、Tombstone或Ruin）
     * @param resourceType - 可选，资源类型，不传则提取第一种资源
     * @param amount - 可选，提取数量
     * @returns true表示正在提取，false表示正在移动，null表示目标无效
     * @description 如果不在范围内会自动移动
     * @example creep.goWithdraw(storage, RESOURCE_ENERGY, 1000);
     */
    goWithdraw(target: Structure | Tombstone | Ruin, resourceType?: ResourceConstant, amount?: number): boolean;
    
    /** 
     * 向指定结构转移资源
     * @param target - 转移目标（Creep、PowerCreep或Structure）
     * @param resourceType - 可选，资源类型，不传则转移第一种资源
     * @param amount - 可选，转移数量
     * @returns true表示正在转移，false表示正在移动，null表示目标无效
     * @description 如果不在范围内会自动移动
     */
    goTransfer(target: AnyCreep | Structure, resourceType?: ResourceConstant, amount?: number): boolean;
    
    /** 
     * 拾取掉落资源
     * @param target - 掉落的资源对象
     * @returns true表示正在拾取，false表示正在移动，null表示目标无效
     * @description 如果不在范围内会自动移动
     */
    goPickup(target: Resource): boolean;
    
    /** 
     * 建造
     * @param target - 建筑工地
     * @returns true表示正在建造，false表示正在移动，null表示目标无效
     * @description 如果不在范围内（3格）会自动移动
     */
    goBuild(target: ConstructionSite): boolean;
    
    /** 
     * 维修
     * @param target - 需要维修的建筑
     * @returns true表示正在维修或已满血，false表示正在移动，null表示目标无效
     * @description 如果不在范围内（3格）会自动移动，满血时返回true
     */
    goRepair(target: Structure): boolean;


    // ==================== 建造功能 (BuildFunction) ====================
    /** 
     * 查找并建造建筑工地
     * @param options - 可选配置
     * @param options.priority - 建筑类型优先级数组
     * @param options.range - 搜索范围
     * @returns true表示找到并正在建造，false表示未找到
     */
    findAndBuild(options?: {
        priority?: StructureConstant[];
        range?: number;
    }): boolean;
    
    /** 
     * 查找并维修建筑
     * @param options - 可选配置
     * @param options.maxHitsRatio - 最大血量比例，低于此比例才维修
     * @param options.excludeTypes - 排除的建筑类型
     * @param options.range - 搜索范围
     * @returns true表示找到并正在维修，false表示未找到
     */
    findAndRepair(options?: {
        maxHitsRatio?: number;
        excludeTypes?: StructureConstant[];
        range?: number;
    }): boolean;
    
    /** 
     * 建造道路
     * @returns true表示正在建造，false表示未找到道路工地
     */
    buildRoad(): boolean;
    
    /** 
     * 维修道路
     * @param minHitsRatio - 可选，最小血量比例，低于此比例才维修
     * @returns true表示正在维修，false表示未找到需要维修的道路
     */
    repairRoad(minHitsRatio?: number): boolean;

    // ==================== 资源收集功能 (CollectFunction) ====================
    /** 
     * 收集掉落的资源
     * @param resourceType - 可选，资源类型，不传则收集任意资源
     * @param minAmount - 可选，最小数量
     * @param range - 可选，搜索范围
     * @returns true表示找到并正在收集，false表示未找到
     */
    collectDroppedResource(resourceType?: ResourceConstant, minAmount?: number, range?: number): boolean;
    
    /** 
     * 从墓碑收集资源
     * @param resourceType - 可选，资源类型
     * @returns true表示找到并正在收集，false表示未找到
     */
    collectFromTombstone(resourceType?: ResourceConstant): boolean;
    
    /** 
     * 从废墟收集资源
     * @param resourceType - 可选，资源类型
     * @returns true表示找到并正在收集，false表示未找到
     */
    collectFromRuin(resourceType?: ResourceConstant): boolean;
    
    /** 
     * 从容器收集资源
     * @param minAmount - 可选，最小数量阈值，默认500
     * @param resourceType - 可选，资源类型，默认RESOURCE_ENERGY
     * @param excludeControllerContainer - 可选，是否排除控制器旁的容器，默认false
     * @returns true表示找到并正在收集，false表示未找到
     * @description 从房间内的container中收集资源
     */
    collectFromContainer(minAmount?: number, resourceType?: ResourceConstant, excludeControllerContainer?: boolean): boolean;
    
    /** 
     * 从存储或终端收集资源
     * @param resourceType - 可选，资源类型，默认RESOURCE_ENERGY
     * @param minAmount - 可选，最小数量阈值，默认5000
     * @returns true表示找到并正在收集，false表示未找到
     * @description 从storage或terminal中收集资源
     */
    collectFromStorage(resourceType?: ResourceConstant, minAmount?: number): boolean;
    
    /** 
     * 智能收集资源
     * @param resourceType - 可选，资源类型，默认RESOURCE_ENERGY
     * @param options - 可选配置
     * @param options.includeDropped - 是否包含掉落资源，默认true
     * @param options.includeTombstone - 是否包含墓碑，默认true
     * @param options.includeRuin - 是否包含废墟，默认true
     * @param options.includeContainer - 是否包含容器，默认true
     * @param options.includeStorage - 是否包含存储，默认true
     * @param options.minDroppedAmount - 掉落资源最小数量，默认50
     * @param options.minContainerAmount - 容器最小数量，默认500
     * @returns true表示找到并正在收集，false表示未找到
     * @description 按优先级尝试各种来源: 掉落资源 > 墓碑 > 废墟 > 容器 > 存储
     * @example
     * creep.smartCollect(RESOURCE_ENERGY, { includeStorage: false });
     */
    smartCollect(resourceType?: ResourceConstant, options?: {
        includeDropped?: boolean;
        includeTombstone?: boolean;
        includeRuin?: boolean;
        includeContainer?: boolean;
        includeStorage?: boolean;
        minDroppedAmount?: number;
        minContainerAmount?: number;
    }): boolean;

    // ==================== 战斗功能 (CombatFunction) ====================
    /** 
     * 查找敌对creep
     * @param range - 可选，搜索范围，不传则搜索整个房间
     * @param options - 可选过滤选项
     * @param options.excludeWhitelist - 是否排除白名单玩家，默认true
     * @param options.hasAttack - 是否只查找有近战攻击部件的，默认false
     * @param options.hasRangedAttack - 是否只查找有远程攻击部件的，默认false
     * @param options.hasHeal - 是否只查找有治疗部件的，默认false
     * @returns 敌对creep数组
     * @description 根据条件查找敌对creep，支持范围和部件过滤
     * @example
     * const enemies = creep.findHostileCreeps(10, { hasAttack: true });
     */
    findHostileCreeps(range?: number, options?: {
        excludeWhitelist?: boolean;
        hasAttack?: boolean;
        hasRangedAttack?: boolean;
        hasHeal?: boolean;
    }): Creep[];
    
    /** 
     * 攻击最近的敌人
     * @returns ScreepsReturnCode - OK表示成功，ERR_NO_BODYPART表示没有攻击部件，ERR_NOT_FOUND表示没有敌人
     * @description 使用近战攻击最近的敌人，如果不在范围内会自动移动
     */
    attackNearestHostile(): ScreepsReturnCode;
    
    /** 
     * 远程攻击最近的敌人
     * @returns ScreepsReturnCode - OK表示成功，ERR_NO_BODYPART表示没有远程攻击部件，ERR_NOT_FOUND表示没有敌人
     * @description 使用远程攻击最近的敌人，如果不在范围内会自动移动
     */
    rangedAttackNearestHostile(): ScreepsReturnCode;
    
    /** 
     * 自动攻击
     * @param target - 可选，攻击目标，不传则自动寻找最近的敌人
     * @returns ScreepsReturnCode - OK表示成功，ERR_NO_BODYPART表示没有攻击部件，ERR_NOT_FOUND表示没有敌人，ERR_NOT_IN_RANGE表示正在移动
     * @description 根据身体部件和距离自动选择攻击方式（近战或远程）
     * @example
     * creep.autoAttack(); // 自动寻找并攻击最近的敌人
     * creep.autoAttack(target); // 攻击指定目标
     */
    autoAttack(target?: Creep | Structure): ScreepsReturnCode;
    
    /** 
     * 逃离敌人
     * @param range - 可选，危险范围，默认5
     * @returns true表示正在逃跑，false表示安全
     * @description 使用PathFinder计算逃跑路径，躲避有攻击能力的敌人
     */
    fleeFromHostiles(range?: number): boolean;
    
    /** 
     * 检查boost是否就绪
     * @param boostTypes - 可选，boost类型数组
     * @param must - 可选，是否必须boost，默认false
     * @returns true表示已就绪或不需要boost，false表示未完成
     * @description 检查指定的boost类型是否都已完成
     */
    checkBoostReady(boostTypes?: string[], must?: boolean): boolean;
}

/**
 * Creep内存接口
 * @description 定义creep.memory的结构，所有属性都是可选的以支持部分初始化
 * @example
 * // 完整初始化
 * const memory: CreepMemory = { role: 'harvester', home: 'W1N1' };
 * // 部分初始化（用于孵化任务）
 * const memory = { homeRoom: 'W1N1', targetRoom: 'W2N2' } as CreepMemory;
 */
interface CreepMemory {
    /** 
     * creep角色
     * @description 决定creep的行为逻辑，孵化后由SpawnMission自动设置
     */
    role?: string;
    
    /** 
     * 所属房间名（简写）
     * @description creep的归属房间，用于返回和资源分配
     */
    home?: string;

    /** 
     * 所属房间名（完整写法）
     * @description creep的归属房间，与home功能相同，部分代码使用此属性
     */
    homeRoom?: string;
    
    /** 
     * 目标房间名
     * @description creep需要前往的目标房间
     */
    targetRoom?: string;
    
    /** 
     * 资源房间名
     * @description creep获取资源的房间
     */
    sourceRoom?: string;
    
    /** 
     * 当前状态
     * @description 用于状态机切换，如'source'获取资源，'target'执行任务
     */
    state?: string;
    
    /** 
     * 是否正在工作
     * @description 简单的工作状态标记
     */
    working?: boolean;
    
    /** 
     * 是否已完成boost
     * @description 标记creep是否已完成所有需要的boost
     */
    boosted?: boolean;
    
    /** 
     * boost尝试次数
     * @description 记录boost失败次数，超过阈值后放弃
     */
    boostAttempts?: number;

    /**
     * boost等级
     * @description 指定creep的boost强化等级，0-2
     * @example 0: 无boost, 1: T2 boost, 2: T3 boost
     */
    boostLevel?: number;
    
    /** 
     * boost配置映射
     * @description 部件类型到boost资源的映射
     * @example { work: 'XUH2O', tough: 'XGHO2' }
     */
    boostmap?: { [part: string]: string };
    
    /** 
     * 绑定的creep名称
     * @description 用于双人小队，绑定另一个creep
     */
    bind?: string;
    
    /** 
     * 当前任务
     * @description 存储当前执行的任务信息
     */
    task?: Task;
    
    /** 
     * 任务ID
     * @description 当前绑定的任务池任务ID
     */
    taskId?: string;
    
    /** 
     * 缓存数据
     * @description 存储临时数据，如目标ID、路径等
     */
    cache?: {
        /** 能量获取目标 */
        takeTarget?: { id: string; type: string } | null;
        /** 目标Source的ID */
        targetSourceId?: Id<Source> | null;
        /** 缓存的路径 */
        path?: RoomPosition[];
        /** 其他缓存数据 */
        [key: string]: any;
    };
    
    /** 
     * 禁止被对穿
     * @description betterMove模块使用，标记creep是否禁止被其他creep对穿
     * @see src/wheel/betterMove.ts
     */
    dontPullMe?: boolean;

    /**
     * 上次位置记录
     * @description betterMove模块使用，记录creep上次位置和停留时间，用于检测卡住
     * @see src/wheel/betterMove.ts
     */
    lastPos?: {
        /** X坐标 */
        x: number;
        /** Y坐标 */
        y: number;
        /** 停留时间（tick数） */
        time: number;
    };
    
    /** 
     * 是否为领导者
     * @description 双人小队中的领导者标记
     */
    isLeader?: boolean;
    
    /** 
     * 旗帜名称
     * @description 关联的旗帜名称，用于定位目标
     */
    flagName?: string;
    
    /** 
     * 其他自定义数据
     * @description 允许存储任意额外属性
     */
    [key: string]: any;
}





