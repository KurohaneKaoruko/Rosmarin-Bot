/**
 * PowerCreep 接口扩展
 * 
 * PowerCreep 是与账户绑定的不朽"英雄"单位，死亡后可在任意 PowerSpawn 重生。
 * 可以通过升级来获得各种强大的能力(powers)，最高等级为25级。
 * 
 * @see https://docs.screeps.com/power.html
 */
interface PowerCreep {
    // shared =====================================================
    // 核心方法 - Core Methods
    // ============================================================

    /**
     * 初始化 PowerCreep
     * @description 在 PowerCreep 首次生成或重生时调用，用于初始化状态
     * @example
     * ```typescript
     * powerCreep.init();
     * ```
     */
    init(): void;

    /**
     * 执行 PowerCreep 的主循环逻辑
     * @description 每 tick 调用一次，处理 PowerCreep 的所有行为逻辑，包括：
     * - 续命检查 (ToRenew)
     * - 移动到指定位置 (flag: {name}-move)
     * - 移动到工作房间 (flag: {name}-home)
     * - 开启房间 Power 功能
     * - 生成和管理 OPS 资源
     * - 按优先级执行各种 Power 能力
     * @example
     * ```typescript
     * // 在主循环中调用
     * for (const name in Game.powerCreeps) {
     *     const pc = Game.powerCreeps[name];
     *     if (pc.ticksToLive) pc.exec();
     * }
     * ```
     */
    exec(): void;

    // ============================================================
    // 基础功能 - Base Functions
    // ============================================================

    /**
     * 检查 PowerCreep 所有者是否在白名单中
     * @description 从 Memory['whitelist'] 中读取白名单列表进行检查
     * @returns {boolean} 如果所有者在白名单中返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.isWhiteList()) {
     *     // 友方 PowerCreep，不进行攻击
     * }
     * ```
     */
    isWhiteList(): boolean;

    /**
     * 检查并开启房间的 Power 功能
     * @description 如果房间控制器未开启 Power 功能，则移动到控制器旁边并开启。
     * 只有开启 Power 功能后，PowerCreep 才能在该房间使用能力。
     * @returns {boolean} 如果正在执行开启操作返回 true，如果已开启返回 false
     * @example
     * ```typescript
     * if (powerCreep.PowerEnabled()) {
     *     return; // 正在开启 Power，跳过其他操作
     * }
     * // Power 已开启，可以使用能力
     * ```
     */
    PowerEnabled(): boolean;

    /**
     * 前往 PowerSpawn 或 PowerBank 续命
     * @description 当 ticksToLive < 500 时自动寻找续命点：
     * 1. 优先使用当前房间的 PowerSpawn（需要是自己的房间）
     * 2. 在过道房间寻找 PowerBank
     * 3. 使用 {name}-renew 旗帜指定的房间的 PowerSpawn
     * @returns {boolean} 如果正在执行续命操作返回 true，否则返回 false
     * @example
     * ```typescript
     * // 在主循环开始时检查续命
     * if (powerCreep.ToRenew()) {
     *     return; // 正在续命，跳过其他操作
     * }
     * ```
     */
    ToRenew(): boolean;

    // ============================================================
    // OPS 资源管理 - OPS Management
    // ============================================================

    /**
     * 将多余的 OPS 资源存入 Storage
     * @description 在以下情况下会转移 OPS：
     * 1. 背包满且 OPS > 200 时，转移一半的 OPS（保留至少200）
     * 2. ticksToLive < 50 时，转移所有 OPS（防止死亡损失）
     * @returns {boolean} 如果正在执行转移操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.transferOPS()) {
     *     return; // 正在转移 OPS
     * }
     * ```
     */
    transferOPS(): boolean;

    /**
     * 从 Storage 或 Terminal 取出 OPS 资源
     * @description 当 PowerCreep 携带的 OPS 不足时，从存储建筑中取出补充
     * @param {number} [amount=200] - 目标 OPS 数量，默认为 200
     * @returns {boolean} 如果正在执行取出操作返回 true，否则返回 false
     * @example
     * ```typescript
     * // 补充 OPS 到 200
     * if (powerCreep.withdrawOPS()) {
     *     return;
     * }
     * // 补充 OPS 到 500
     * if (powerCreep.withdrawOPS(500)) {
     *     return;
     * }
     * ```
     */
    withdrawOPS(amount?: number): boolean;

    /**
     * 为 PowerSpawn 运输 Power 资源
     * @description 当 PowerSpawn 的 Power 不足时，从 Storage 取出并运送。
     * 需要在 Memory['StructControlData'][roomName].powerSpawn 中开启。
     * 条件检查：
     * - Storage 中 Power >= 100
     * - Storage 中 Energy >= 10000
     * - PowerSpawn 中 Power < 50 时补充，> 60 时停止
     * @returns {boolean} 如果正在执行运输操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.transferPower()) {
     *     return; // 正在运输 Power
     * }
     * ```
     */
    transferPower(): boolean;

    // ============================================================
    // Power 能力 - Power Abilities
    // ============================================================

    /**
     * 使用 PWR_GENERATE_OPS 能力生成 OPS 资源
     * @description 生成 OPS 资源到 PowerCreep 的背包中。
     * OPS 是使用其他 Power 能力的消耗品。
     * - 等级1: 每次生成 1 OPS
     * - 等级5: 每次生成 8 OPS
     * - 冷却时间: 50 ticks
     * @returns {boolean} 如果成功使用能力返回 true，否则返回 false
     * @example
     * ```typescript
     * powerCreep.Generate_OPS();
     * ```
     */
    Generate_OPS(): boolean;

    /**
     * 使用 PWR_REGEN_SOURCE 能力加速 Source 再生
     * @description 对 Source 使用，加速其能量再生速度。
     * - 等级1: 每15 ticks 再生 50 能量
     * - 等级5: 每15 ticks 再生 250 能量
     * - 持续时间: 300 ticks
     * - 需要在 Source 3格范围内
     * - 房间处于防御状态时不执行
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.Regen_Source()) {
     *     return; // 正在加速 Source
     * }
     * ```
     */
    Regen_Source(): boolean;

    /**
     * 使用 PWR_REGEN_MINERAL 能力加速 Mineral 再生
     * @description 对 Mineral 使用，加速其矿物再生速度。
     * - 持续时间: 100 ticks
     * - 需要在 Mineral 3格范围内
     * - 房间处于防御状态时不执行
     * - Mineral 储量为 0 时不执行
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.Regen_Mineral()) {
     *     return; // 正在加速 Mineral
     * }
     * ```
     */
    Regen_Mineral(): boolean;

    /**
     * 使用 PWR_OPERATE_SPAWN 能力加速 Spawn 孵化
     * @description 对 Spawn 使用，减少孵化时间。
     * - 等级1: 孵化时间 x0.9
     * - 等级5: 孵化时间 x0.2
     * - 持续时间: 1000 ticks
     * - 消耗: 100 OPS
     * - 需要在 Spawn 3格范围内
     * - 触发条件: 有 {name}-upspawn 旗帜、房间防御状态、或有 power/deposit 采集任务
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.Operate_Spawn()) {
     *     return; // 正在加速 Spawn
     * }
     * ```
     */
    Operate_Spawn(): boolean;

    /**
     * 使用 PWR_OPERATE_EXTENSION 能力快速填充 Extension
     * @description 从 Storage/Terminal 中直接填充房间所有 Extension 的能量。
     * - 等级1: 填充 20% 容量
     * - 等级5: 填充 100% 容量
     * - 消耗: 2 OPS
     * - 需要在目标建筑 3格范围内
     * - 触发条件: 房间能量 < 50% 容量
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.Operate_Extension()) {
     *     return; // 正在填充 Extension
     * }
     * ```
     */
    Operate_Extension(): boolean;

    /**
     * 使用 PWR_OPERATE_STORAGE 能力扩展 Storage 容量
     * @description 对 Storage 使用，临时增加其存储容量。
     * - 等级1: +500,000 容量
     * - 等级5: +7,000,000 容量
     * - 持续时间: 1000 ticks
     * - 消耗: 100 OPS
     * - 需要在 Storage 3格范围内
     * - 触发条件: Storage 剩余容量 < 5000
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.Operate_Storage()) {
     *     return; // 正在扩展 Storage
     * }
     * ```
     */
    Operate_Storage(): boolean;

    /**
     * 使用 PWR_OPERATE_TOWER 能力增强 Tower 效果
     * @description 对 Tower 使用，增强其攻击/治疗/修复效果。
     * - 等级1: 效果 x1.1
     * - 等级5: 效果 x1.5
     * - 持续时间: 100 ticks
     * - 消耗: 10 OPS
     * - 需要在 Tower 3格范围内
     * - 触发条件: 房间处于防御状态 (room.memory.defend)
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.Operate_Tower()) {
     *     return; // 正在增强 Tower
     * }
     * ```
     */
    Operate_Tower(): boolean;

    /**
     * 使用 PWR_OPERATE_FACTORY 能力激活 Factory 生产高级商品
     * @description 对 Factory 使用，允许其生产对应等级的商品。
     * - Factory 等级由此能力决定
     * - 持续时间: 1000 ticks
     * - 消耗: 100 OPS
     * - 需要在 Factory 3格范围内
     * - 条件: Factory 等级与能力等级匹配，且有足够原料
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.Operate_Factory()) {
     *     return; // 正在激活 Factory
     * }
     * ```
     */
    Operate_Factory(): boolean;

    /**
     * 使用 PWR_OPERATE_LAB 能力加速 Lab 反应
     * @description 对 Lab 使用，增加每次反应的产出量。
     * - 等级1: 每次反应 +2 产出
     * - 等级5: 每次反应 +10 产出
     * - 持续时间: 1000 ticks
     * - 消耗: 10 OPS
     * - 需要在 Lab 3格范围内
     * - 条件: Lab 正在进行合成反应
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.Operate_Lab()) {
     *     return; // 正在加速 Lab
     * }
     * ```
     */
    Operate_Lab(): boolean;

    /**
     * 使用 PWR_OPERATE_POWER 能力加速 PowerSpawn 处理
     * @description 对 PowerSpawn 使用，增加每次处理的 Power 数量。
     * - 等级1: 每次处理 +1 Power
     * - 等级5: 每次处理 +5 Power
     * - 持续时间: 1000 ticks
     * - 消耗: 200 OPS
     * - 需要在 PowerSpawn 3格范围内
     * - 条件: Storage 中 Power >= 5000
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * if (powerCreep.Operate_Power()) {
     *     return; // 正在加速 PowerSpawn
     * }
     * ```
     */
    Operate_Power(): boolean;

    /**
     * 使用 PWR_SHIELD 能力生成护盾
     * @description 在指定位置生成一个临时护盾，吸收伤害。
     * - 等级1: 5,000 护盾值
     * - 等级5: 25,000 护盾值
     * - 持续时间: 50 ticks
     * - 冷却时间: 20 ticks
     * - 消耗: 100 能量
     * - 需要站在目标位置上
     * @param {RoomPosition} pos - 生成护盾的目标位置
     * @returns {boolean} 如果正在执行操作返回 true，否则返回 false
     * @example
     * ```typescript
     * const dangerPos = new RoomPosition(25, 25, 'W1N1');
     * if (powerCreep.Shield(dangerPos)) {
     *     return; // 正在生成护盾
     * }
     * ```
     */
    Shield(pos: RoomPosition): boolean;
}
