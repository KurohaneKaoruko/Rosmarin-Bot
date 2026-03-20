// 角色执行框架常量：所有角色都走统一入口，
// 这里只保留“当前角色采用哪种行为框架”的元信息。
export const ROLE_EXECUTOR_FRAMEWORKS = {
    LAYERED_FSM: 'layered-fsm',
    BEHAVIOR_TREE: 'behavior-tree',
    STRATEGY: 'strategy',
    PIPELINE: 'pipeline',
} as const;

// 行为实现框架：用于声明角色当前使用的执行框架。
export type RoleExecutorFramework =
    (typeof ROLE_EXECUTOR_FRAMEWORKS)[keyof typeof ROLE_EXECUTOR_FRAMEWORKS];

// 角色执行器绑定：集中声明统一入口 id 与框架类型。
// id 必须与 roleRegistry 中的键保持一致，避免分发时出现隐式映射。
export type RoleExecutorBinding = {
    id: string;
    framework: RoleExecutorFramework;
};

type RoleBoostConfig = {
    [key: string]: string;
};

export type RoleDefinition = {
    bodypart: any[];                 // body 配置
    must?: boolean;                 // 是否无论战争还是和平都得孵化
    level?: number;                 // 孵化优先级，越小越优先
    code?: string;                  // 短代号，用于 creep 名称
    executor?: RoleExecutorBinding; // 运行时执行器绑定
    boostmap?: RoleBoostConfig;     // boost 配置
};

export type RoleConfig = Record<string, RoleDefinition>;

// 统一执行器绑定：角色配置只描述“由谁执行”“采用什么框架”，
// 实际调度统一在 roleRegistry 中完成。
const bindExecutor = (id: string, framework: RoleExecutorFramework): RoleExecutorBinding => ({
    id,
    framework,
});

// 默认命名约定：role 名与 executor.id 保持一致。
// 只有这里登记的角色允许偏离默认约定，用于兼容历史 handler 名称并集中记录例外。
export const ROLE_EXECUTOR_ID_OVERRIDES = {
    reserver: 'reserve',
} as const;

// 解析角色绑定到的统一执行器 id：
// 默认直接返回 role 本身；只有登记在 override 表中的角色才会映射到历史 handler 名称。
export const resolveRoleExecutorId = (role: string): string =>
    ROLE_EXECUTOR_ID_OVERRIDES[role as keyof typeof ROLE_EXECUTOR_ID_OVERRIDES] || role;

const bindLayeredExecutor = (id: string): RoleExecutorBinding =>
    bindExecutor(id, ROLE_EXECUTOR_FRAMEWORKS.LAYERED_FSM);

const bindBehaviorTreeExecutor = (id: string): RoleExecutorBinding =>
    bindExecutor(id, ROLE_EXECUTOR_FRAMEWORKS.BEHAVIOR_TREE);

const bindStrategyExecutor = (id: string): RoleExecutorBinding =>
    bindExecutor(id, ROLE_EXECUTOR_FRAMEWORKS.STRATEGY);

const bindPipelineExecutor = (id: string): RoleExecutorBinding =>
    bindExecutor(id, ROLE_EXECUTOR_FRAMEWORKS.PIPELINE);

const defineRole = (role: RoleDefinition): RoleDefinition => role;

export const RoleData: RoleConfig = {
    /* 基本房间运营 */
    harvester: defineRole({
        bodypart: [[WORK, 2], [MOVE, 2]],
        level: 3,
        code: 'H',
        executor: bindLayeredExecutor('harvester'),
    }), // 采集
    carrier: defineRole({
        bodypart: [[CARRY, 3], [MOVE, 3]],
        level: 3,
        code: 'C',
        executor: bindLayeredExecutor('carrier'),
    }), // 通用搬运
    transport: defineRole({
        bodypart: [[CARRY, 4], [MOVE, 2]],
        level: 2,
        code: 'T',
        executor: bindStrategyExecutor('transport'),
    }), // 资源搬运
    manager: defineRole({
        bodypart: [[CARRY, 4], [MOVE, 2]],
        level: 1,
        code: 'M',
        executor: bindStrategyExecutor('manager'),
    }), // 中央搬运
    upgrader: defineRole({
        bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]],
        level: 10,
        code: 'U',
        executor: bindLayeredExecutor('upgrader'),
    }), // 升级
    worker: defineRole({
        bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]],
        level: 10,
        code: 'W',
        executor: bindLayeredExecutor('worker'),
    }), // 建造、维修、刷墙
    mineral: defineRole({
        bodypart: [[WORK, 2], [CARRY, 1], [MOVE, 1]],
        level: 6,
        code: 'MR',
        executor: bindLayeredExecutor('mineral'),
    }), // 矿工
    universal: defineRole({
        bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]],
        level: 0,
        code: 'UNIV',
        executor: bindPipelineExecutor('universal'),
    }), // 采集搬运通用机，处理停摆与新房起步

    /* 特殊用途 */
    scout: defineRole({
        bodypart: [[MOVE, 1]],
        level: 11,
        code: 'S',
        executor: bindStrategyExecutor('scout'),
    }),
    logistic: defineRole({
        bodypart: [[CARRY, 3], [MOVE, 3]],
        level: 10,
        code: 'L',
        executor: bindLayeredExecutor('logistic'),
    }), // 长途运输
    cleaner: defineRole({
        bodypart: [[WORK, 25], [MOVE, 25]],
        level: 11,
        code: 'CLE',
        executor: bindStrategyExecutor('cleaner'),
    }), // 清理者
    dismantle: defineRole({
        bodypart: [[WORK, 40], [MOVE, 10]],
        boostmap: { [WORK]: 'XZH2O', [MOVE]: 'XZHO2' },
        level: 11,
        code: 'DIS',
        executor: bindStrategyExecutor('dismantle'),
    }), // 拆除者
    'up-upgrade': defineRole({
        bodypart: [[WORK, 2], [CARRY, 1], [MOVE, 1]],
        level: 11,
        code: 'UUP',
        executor: bindLayeredExecutor('up-upgrade'),
    }), // 加速升级
    'up-repair': defineRole({
        bodypart: [[WORK, 30], [CARRY, 5], [MOVE, 15]],
        level: 11,
        code: 'URE',
        executor: bindLayeredExecutor('up-repair'),
    }), // 加速维修

    /* 占领房间 */
    claimer: defineRole({
        bodypart: [[MOVE, 5], [CLAIM, 1]],
        level: 10,
        code: 'CL',
        executor: bindBehaviorTreeExecutor('claimer'),
    }),
    'attack-claimer': defineRole({
        bodypart: [[MOVE, 16], [CLAIM, 16]],
        level: 10,
        code: 'ACL',
        executor: bindBehaviorTreeExecutor('attack-claimer'),
    }),

    /* 援建 */
    'aid-build': defineRole({
        bodypart: [[WORK, 20], [CARRY, 5], [MOVE, 25]],
        level: 10,
        code: 'AIDB',
        executor: bindLayeredExecutor('aid-build'),
    }),
    'aid-carry': defineRole({
        bodypart: [[CARRY, 25], [MOVE, 25]],
        level: 10,
        code: 'AIDC',
        executor: bindLayeredExecutor('aid-carry'),
    }),
    'aid-upgrade': defineRole({
        bodypart: [[WORK, 20], [CARRY, 5], [MOVE, 25]],
        level: 10,
        code: 'AIDU',
        executor: bindLayeredExecutor('aid-upgrade'),
    }),

    /* 战斗相关 */
    /* 一体机 */
    'one-ranged': defineRole({
        bodypart: [[TOUGH, 10], [RANGED_ATTACK, 10], [MOVE, 10], [HEAL, 20]],
        level: 10,
        code: '1R',
        executor: bindBehaviorTreeExecutor('one-ranged'),
    }),
    aio: defineRole({
        bodypart: [[RANGED_ATTACK, 13], [MOVE, 25], [HEAL, 12]],
        level: 10,
        code: 'AIO',
        executor: bindBehaviorTreeExecutor('aio'),
    }), // 进攻一体机
    saio: defineRole({
        bodypart: [[RANGED_ATTACK, 10], [MOVE, 25], [HEAL, 15]],
        level: 10,
        code: 'SAIO',
        executor: bindBehaviorTreeExecutor('aio'),
    }), // 支援一体机

    /* 二人队 */
    'double-attack': defineRole({
        bodypart: [[ATTACK, 8], [TOUGH, 12], [ATTACK, 20], [MOVE, 10]],
        boostmap: { [ATTACK]: 'XUH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' },
        level: 10,
        code: '2A',
        executor: bindBehaviorTreeExecutor('double-attack'),
    }),
    'double-dismantle': defineRole({
        bodypart: [[WORK, 8], [TOUGH, 12], [WORK, 20], [MOVE, 10]],
        boostmap: { [WORK]: 'XZH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' },
        level: 10,
        code: '2D',
        executor: bindBehaviorTreeExecutor('double-dismantle'),
    }),
    'double-heal': defineRole({
        bodypart: [[TOUGH, 12], [HEAL, 28], [MOVE, 10]],
        boostmap: { [TOUGH]: 'XGHO2', [HEAL]: 'XLHO2', [MOVE]: 'XZHO2' },
        level: 10,
        code: '2H',
        executor: bindBehaviorTreeExecutor('double-heal'),
    }),

    /* 四人队 */
    // 四人队成员由 Team 模块统一接管行动，因此不绑定常规 executor。
    'team-attack': defineRole({ bodypart: [], level: 10, code: 'xA' }),
    'team-dismantle': defineRole({ bodypart: [], level: 10, code: 'xD' }),
    'team-heal': defineRole({ bodypart: [], level: 10, code: 'xH' }),
    'team-ranged': defineRole({ bodypart: [], level: 10, code: 'xR' }),

    /* 主动防御 */
    'defend-attack': defineRole({
        bodypart: [[ATTACK, 40], [MOVE, 10]],
        level: 8,
        code: 'DFA',
        must: true,
        executor: bindBehaviorTreeExecutor('defend-attack'),
    }),
    'defend-ranged': defineRole({
        bodypart: [[RANGED_ATTACK, 40], [MOVE, 10]],
        level: 8,
        code: 'DFR',
        must: true,
        executor: bindBehaviorTreeExecutor('defend-ranged'),
    }),
    'defend-2attack': defineRole({
        bodypart: [[TOUGH, 5], [ATTACK, 35], [MOVE, 10]],
        level: 7,
        code: 'D2A',
        must: true,
        executor: bindBehaviorTreeExecutor('defend-2attack'),
    }),
    'defend-2heal': defineRole({
        bodypart: [[TOUGH, 10], [HEAL, 30], [MOVE, 10]],
        level: 7,
        code: 'D2H',
        must: true,
        executor: bindBehaviorTreeExecutor('defend-2heal'),
    }),

    /* 外矿相关 */
    reserver: defineRole({
        bodypart: [],
        level: 11,
        code: 'RSV',
        // reserver 角色使用 reserve 处理器，映射关系由 ROLE_EXECUTOR_ID_OVERRIDES 统一维护。
        executor: bindLayeredExecutor(resolveRoleExecutorId('reserver')),
    }),
    'out-harvest': defineRole({
        bodypart: [],
        level: 12,
        code: 'OH',
        executor: bindLayeredExecutor('out-harvest'),
    }),
    'out-car': defineRole({
        bodypart: [],
        level: 13,
        code: 'OC',
        executor: bindStrategyExecutor('out-carry'),
    }),
    'out-carry': defineRole({
        bodypart: [],
        level: 13,
        code: 'OC',
        executor: bindStrategyExecutor('out-carry'),
    }),
    'out-build': defineRole({
        bodypart: [],
        level: 12,
        code: 'OB',
        executor: bindLayeredExecutor('out-build'),
    }),
    'out-defend': defineRole({
        bodypart: [],
        level: 8,
        code: 'OD',
        executor: bindBehaviorTreeExecutor('out-defend'),
    }),
    'out-2attack': defineRole({
        bodypart: [],
        level: 8,
        code: 'O2A',
        executor: bindBehaviorTreeExecutor('out-2attack'),
    }),
    'out-2heal': defineRole({
        bodypart: [],
        level: 8,
        code: 'O2H',
        executor: bindBehaviorTreeExecutor('out-2heal'),
    }),
    'out-invader': defineRole({
        bodypart: [],
        level: 10,
        code: 'OI',
        executor: bindBehaviorTreeExecutor('out-invader'),
    }),
    'out-attack': defineRole({
        bodypart: [[ATTACK, 19], [MOVE, 25], [HEAL, 6]],
        level: 9,
        code: 'OA',
        executor: bindBehaviorTreeExecutor('out-attack'),
    }),
    'out-ranged': defineRole({
        bodypart: [[RANGED_ATTACK, 15], [MOVE, 25], [HEAL, 10]],
        level: 9,
        code: 'OR',
        executor: bindBehaviorTreeExecutor('out-ranged'),
    }),
    'out-mineral': defineRole({
        bodypart: [[WORK, 30], [CARRY, 5], [MOVE, 15]],
        level: 12,
        code: 'OMR',
        executor: bindLayeredExecutor('out-mineral'),
    }),

    /* 沉积物 */
    'deposit-harvest': defineRole({
        bodypart: [[WORK, 20], [ATTACK, 2], [CARRY, 6], [MOVE, 22]],
        level: 11,
        code: 'DH',
        executor: bindLayeredExecutor('deposit-harvest'),
    }),
    'deposit-transfer': defineRole({
        bodypart: [[CARRY, 25], [MOVE, 25]],
        level: 11,
        code: 'DT',
        executor: bindLayeredExecutor('deposit-transfer'),
    }),
    'deposit-attack': defineRole({
        bodypart: [[ATTACK, 25], [MOVE, 25]],
        level: 8,
        code: 'DPA',
        executor: bindBehaviorTreeExecutor('deposit-attack'),
    }),
    'deposit-heal': defineRole({
        bodypart: [[HEAL, 25], [MOVE, 25]],
        level: 8,
        code: 'DPH',
        executor: bindBehaviorTreeExecutor('deposit-heal'),
    }),
    'deposit-ranged': defineRole({
        bodypart: [[RANGED_ATTACK, 17], [MOVE, 25], [HEAL, 8]],
        level: 8,
        code: 'DPR',
        executor: bindBehaviorTreeExecutor('deposit-ranged'),
    }),

    /* Power */
    'power-attack': defineRole({
        bodypart: [[TOUGH, 5], [MOVE, 25], [ATTACK, 20]],
        level: 10,
        code: 'PA',
        executor: bindBehaviorTreeExecutor('power-attack'),
    }),
    'power-heal': defineRole({
        bodypart: [[MOVE, 25], [HEAL, 25]],
        level: 10,
        code: 'PH',
        executor: bindBehaviorTreeExecutor('power-heal'),
    }),
    'pc-heal': defineRole({
        bodypart: [[MOVE, 25], [HEAL, 25]],
        level: 10,
        code: 'PCH',
        executor: bindBehaviorTreeExecutor('pc-heal'),
    }),
    'power-carry': defineRole({
        bodypart: [[MOVE, 25], [CARRY, 25]],
        level: 9,
        code: 'PC',
        executor: bindLayeredExecutor('power-carry'),
    }),
    'power-ranged': defineRole({
        bodypart: [[MOVE, 25], [RANGED_ATTACK, 17], [HEAL, 8]],
        level: 11,
        code: 'PR',
        executor: bindBehaviorTreeExecutor('power-ranged'),
    }),
};

// 根据等级的动态部件
export const RoleLevelData = {
    'harvester': {
        1: { bodypart: [[WORK, 2], [CARRY, 1], [MOVE, 1]], num: 0 },
        2: { bodypart: [[WORK, 3], [CARRY, 1], [MOVE, 1]], num: 0 },
        3: { bodypart: [[WORK, 5], [CARRY, 1], [MOVE, 3]], num: 0 },
        4: { bodypart: [[WORK, 6], [CARRY, 1], [MOVE, 3]], num: 0 },
        5: { bodypart: [[WORK, 8], [CARRY, 2], [MOVE, 4]], num: 0 },
        6: { bodypart: [[WORK, 10], [CARRY, 2], [MOVE, 5]], num: 0 },
        7: { bodypart: [[WORK, 10], [CARRY, 2], [MOVE, 5]], num: 0 },
        8: { bodypart: [[WORK, 10], [CARRY, 2], [MOVE, 5]], num: 0,
             upbodypart: [[WORK, 20], [CARRY, 4], [MOVE, 10]] },
    },
    'carrier': {
        1: { bodypart: [[CARRY, 2], [MOVE, 2]], num: 1 },
        2: { bodypart: [[CARRY, 3], [MOVE, 3]], num: 2 },
        3: { bodypart: [[CARRY, 7], [MOVE, 7]], num: 2 },
        4: { bodypart: [[CARRY, 10], [MOVE, 10]], num: 1 },
        5: { bodypart: [[CARRY, 12], [MOVE, 12]], num: 1 },
        6: { bodypart: [[CARRY, 15], [MOVE, 15]], num: 1 },
        7: { bodypart: [[CARRY, 20], [MOVE, 20]], num: 0 },
        8: { bodypart: [[CARRY, 25], [MOVE, 25]], num: 0 },
    },
    'transport': {
        1: { bodypart: [[CARRY, 1], [MOVE, 1]], num: 0 },
        2: { bodypart: [[CARRY, 1], [MOVE, 1]], num: 0 },
        3: { bodypart: [[CARRY, 2], [MOVE, 2]], num: 0 },
        4: { bodypart: [[CARRY, 5], [MOVE, 5]], num: 1 },
        5: { bodypart: [[CARRY, 12], [MOVE, 6]], num: 1 },
        6: { bodypart: [[CARRY, 16], [MOVE, 8]], num: 1 },
        7: { bodypart: [[CARRY, 24], [MOVE, 12]], num: 1 },
        8: { bodypart: [[CARRY, 32], [MOVE, 16]], num: 1 },
    },
    'manager': {
        1: { bodypart: [[CARRY, 1], [MOVE, 1]], num: 0 },
        2: { bodypart: [[CARRY, 1], [MOVE, 1]], num: 0 },
        3: { bodypart: [[CARRY, 2], [MOVE, 1]], num: 0 },
        4: { bodypart: [[CARRY, 2], [MOVE, 1]], num: 0 },
        5: { bodypart: [[CARRY, 5], [MOVE, 1]], num: 1 },
        6: { bodypart: [[CARRY, 15], [MOVE, 1]], num: 1 },
        7: { bodypart: [[CARRY, 25], [MOVE, 1]], num: 1 },
        8: { bodypart: [[CARRY, 39], [MOVE, 1]], num: 1 },
    },
    'upgrader': {
        1: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 3 },
        2: { bodypart: [[WORK, 2], [CARRY, 2], [MOVE, 4]], num: 3 },
        3: { bodypart: [[WORK, 3], [CARRY, 3], [MOVE, 6]], num: 3 },
        4: { bodypart: [[WORK, 4], [CARRY, 4], [MOVE, 8]], num: 2 },
        5: { bodypart: [[WORK, 6], [CARRY, 6], [MOVE, 6]], num: 2 },
        6: { bodypart: [[WORK, 15], [CARRY, 5], [MOVE, 10]], num: 2 },
        7: { bodypart: [[WORK, 30], [CARRY, 5], [MOVE, 15]], num: 2 },
        8: { bodypart: [[WORK, 15], [CARRY, 5], [MOVE, 10]], num: 1 },
    },
    'universal': {
        1: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        2: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        3: { bodypart: [[WORK, 2], [CARRY, 2], [MOVE, 4]], num: 0 },
        4: { bodypart: [[WORK, 2], [CARRY, 2], [MOVE, 4]], num: 0 },
        5: { bodypart: [[WORK, 2], [CARRY, 2], [MOVE, 4]], num: 0 },
        6: { bodypart: [[WORK, 3], [CARRY, 2], [MOVE, 5]], num: 0 },
        7: { bodypart: [[WORK, 3], [CARRY, 2], [MOVE, 5]], num: 0 },
        8: { bodypart: [[WORK, 3], [CARRY, 2], [MOVE, 5]], num: 0 },
    },
    'worker': {
        1: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        2: { bodypart: [[WORK, 2], [CARRY, 2], [MOVE, 4]], num: 0 },
        3: { bodypart: [[WORK, 3], [CARRY, 3], [MOVE, 6]], num: 0 },
        4: { bodypart: [[WORK, 5], [CARRY, 4], [MOVE, 9]], num: 0 },
        5: { bodypart: [[WORK, 6], [CARRY, 6], [MOVE, 12]], num: 0 },
        6: { bodypart: [[WORK, 10], [CARRY, 10], [MOVE, 10]], num: 0 },
        7: { bodypart: [[WORK, 20], [CARRY, 10], [MOVE, 15]], num: 0 },
        8: { bodypart: [[WORK, 15], [CARRY, 15], [MOVE, 15]], num: 0,
             upbodypart: [[WORK, 20], [CARRY, 10], [MOVE, 15]]},
    },
    'mineral': {
        1: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        2: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        3: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        4: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        5: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        6: { bodypart: [[WORK, 10], [CARRY, 2], [MOVE, 5]], num: 0 },
        7: { bodypart: [[WORK, 20], [CARRY, 2], [MOVE, 5]], num: 0 },
        8: { bodypart: [[WORK, 40], [MOVE, 10]], num: 0 },
    },
    'logistic': {
        1: { bodypart: [[CARRY, 1], [MOVE, 1]], num: 0 },
        2: { bodypart: [[CARRY, 2], [MOVE, 2]], num: 0 },
        3: { bodypart: [[CARRY, 3], [MOVE, 3]], num: 0 },
        4: { bodypart: [[CARRY, 5], [MOVE, 5]], num: 0 },
        5: { bodypart: [[CARRY, 10], [MOVE, 10]], num: 0 },
        6: { bodypart: [[CARRY, 15], [MOVE, 15]], num: 0 },
        7: { bodypart: [[CARRY, 20], [MOVE, 20]], num: 0 },
        8: { bodypart: [[CARRY, 25], [MOVE, 25]], num: 0 },
    },
    "claimer": {
        1: { bodypart: [], num: 0 },
        2: { bodypart: [], num: 0 },
        3: { bodypart: [[MOVE, 1], [CLAIM, 1]], num: 0 },
        4: { bodypart: [[MOVE, 1], [CLAIM, 1]], num: 0 },
        5: { bodypart: [[MOVE, 1], [CLAIM, 1]], num: 0 },
        6: { bodypart: [[MOVE, 1], [CLAIM, 1]], num: 0 },
        7: { bodypart: [[MOVE, 1], [CLAIM, 1]], num: 0 },
        8: { bodypart: [[MOVE, 5], [CLAIM, 1]], num: 0 },
    },
    "reserver": {
        1: { bodypart: [], num: 0 },
        2: { bodypart: [], num: 0 },
        3: { bodypart: [[MOVE, 1], [CLAIM, 1]], num: 0 },
        4: { bodypart: [[MOVE, 1], [CLAIM, 1]], num: 0 },
        5: { bodypart: [[MOVE, 2], [CLAIM, 2]], num: 0 },
        6: { bodypart: [[MOVE, 2], [CLAIM, 2]], num: 0 },
        7: { bodypart: [[MOVE, 3], [CLAIM, 3]], num: 0 },
        8: { bodypart: [[MOVE, 5], [CLAIM, 5]], num: 0 },
    },
    "out-harvest": {
        1: { bodypart: [[WORK, 2], [MOVE, 2]], num: 0 },
        2: { bodypart: [[WORK, 3], [CARRY, 1], [MOVE, 3]], num: 0 },
        3: { bodypart: [[WORK, 5], [CARRY, 1], [MOVE, 3]], num: 0 },
        4: { bodypart: [[WORK, 6], [CARRY, 1], [MOVE, 3]], num: 0 },
        5: { bodypart: [[WORK, 6], [CARRY, 1], [MOVE, 3]], num: 0 },
        6: { bodypart: [[WORK, 6], [CARRY, 1], [MOVE, 3]], num: 0 },
        7: { bodypart: [[WORK, 8], [CARRY, 2], [MOVE, 4]], num: 0 },
        8: { bodypart: [[WORK, 10], [CARRY, 2], [MOVE, 5]], num: 0 },
    },
    "out-build": {
        1: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 1 },
        2: { bodypart: [[WORK, 2], [CARRY, 2], [MOVE, 4]], num: 1 },
        3: { bodypart: [[WORK, 3], [CARRY, 3], [MOVE, 6]], num: 1 },
        4: { bodypart: [[WORK, 4], [CARRY, 4], [MOVE, 8]], num: 1 },
        5: { bodypart: [[WORK, 4], [CARRY, 10], [MOVE, 7]], num: 1 },
        6: { bodypart: [[WORK, 5], [CARRY, 10], [MOVE, 15]], num: 1 },
        7: { bodypart: [[WORK, 10], [CARRY, 10], [MOVE, 20]], num: 1 },
        8: { bodypart: [[WORK, 10], [CARRY, 10], [MOVE, 20]], num: 1 },
    },
    "out-car": {
        1: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        2: { bodypart: [[WORK, 1], [CARRY, 2], [MOVE, 3]], num: 0 },
        3: { bodypart: [[WORK, 1], [CARRY, 3], [MOVE, 4]], num: 0 },
        4: { bodypart: [[WORK, 1], [CARRY, 7], [MOVE, 4]], num: 0 },
        5: { bodypart: [[WORK, 1], [CARRY, 21], [MOVE, 11]], num: 0 },
        6: { bodypart: [[WORK, 2], [CARRY, 20], [MOVE, 11]], num: 0 },
        7: { bodypart: [[WORK, 2], [CARRY, 26], [MOVE, 14]], num: 0 },
        8: { bodypart: [[WORK, 2], [CARRY, 30], [MOVE, 16]], num: 0 },
    },
    "out-carry": {
        1: { bodypart: [[CARRY, 2], [MOVE, 2]], num: 0 },
        2: { bodypart: [[CARRY, 3], [MOVE, 3]], num: 0 },
        3: { bodypart: [[CARRY, 4], [MOVE, 4]], num: 0 },
        4: { bodypart: [[CARRY, 8], [MOVE, 4]], num: 0 },
        5: { bodypart: [[CARRY, 20], [MOVE, 10]], num: 0 },
        6: { bodypart: [[CARRY, 20], [MOVE, 10]], num: 0 },
        7: { bodypart: [[CARRY, 26], [MOVE, 13]], num: 0 },
        8: { bodypart: [[CARRY, 32], [MOVE, 16]], num: 0 },
    },
    "out-defend": {
        1: { bodypart: [[MOVE, 1], [RANGED_ATTACK, 1]], num: 0 },
        2: { bodypart: [[MOVE, 2], [RANGED_ATTACK, 1], [HEAL, 1]], num: 0 },
        3: { bodypart: [[MOVE, 2], [RANGED_ATTACK, 1], [HEAL, 1]], num: 0 },
        4: { bodypart: [[MOVE, 4], [RANGED_ATTACK, 2], [HEAL, 2]], num: 0 },
        5: { bodypart: [[MOVE, 6], [RANGED_ATTACK, 3], [HEAL, 3]], num: 0 },
        6: { bodypart: [[MOVE, 8], [RANGED_ATTACK, 4], [HEAL, 4]], num: 0 },
        7: { bodypart: [[MOVE, 16], [RANGED_ATTACK, 8], [HEAL, 8]], num: 0 },
        8: { bodypart: [[MOVE, 25], [ATTACK, 5], [RANGED_ATTACK, 10], [HEAL, 10]], num: 0 },
    },
    "out-invader": {
        1: { bodypart: [[MOVE, 1], [ATTACK, 1]], num: 0 },
        2: { bodypart: [[MOVE, 2], [ATTACK, 2]], num: 0 },
        3: { bodypart: [[MOVE, 3], [ATTACK, 3]], num: 0 },
        4: { bodypart: [[MOVE, 4], [ATTACK, 4]], num: 0 },
        5: { bodypart: [[MOVE, 6], [ATTACK, 6]], num: 0 },
        6: { bodypart: [[MOVE, 8], [ATTACK, 8]], num: 0 },
        7: { bodypart: [[MOVE, 15], [ATTACK, 15]], num: 0 },
        8: { bodypart: [[MOVE, 15], [ATTACK, 15]], num: 0 },
    },
    'out-2attack': {
        1: { bodypart: [[ATTACK, 2], [MOVE, 2]], num: 0 },
        2: { bodypart: [[ATTACK, 4], [MOVE, 4]], num: 0 },
        3: { bodypart: [[ATTACK, 6], [MOVE, 6]], num: 0 },
        4: { bodypart: [[ATTACK, 10], [MOVE, 10]], num: 0 },
        5: { bodypart: [[ATTACK, 12], [MOVE, 12]], num: 0 },
        6: { bodypart: [[ATTACK, 15], [MOVE, 15]], num: 0 },
        7: { bodypart: [[ATTACK, 20], [MOVE, 20]], num: 0 },
        8: { bodypart: [[ATTACK, 25] , [MOVE, 25]], num: 0},
    },
    "out-2heal": {
        1: { bodypart: [[MOVE, 1], [HEAL, 1]], num: 0 },
        2: { bodypart: [[MOVE, 1], [HEAL, 1]], num: 0 },
        3: { bodypart: [[MOVE, 2], [HEAL, 2]], num: 0 },
        4: { bodypart: [[MOVE, 3], [HEAL, 3]], num: 0 },
        5: { bodypart: [[MOVE, 6], [HEAL, 6]], num: 0 },
        6: { bodypart: [[MOVE, 7], [HEAL, 7]], num: 0 },
        7: { bodypart: [[MOVE, 18], [HEAL, 18]], num: 0 },
        8: { bodypart: [[MOVE, 25], [HEAL, 25]], num: 0 },
    },
    "up-upgrade": {
        1: { bodypart: [[WORK, 2], [CARRY, 1], [MOVE, 1]], num: 0 },
        2: { bodypart: [[WORK, 3], [CARRY, 2], [MOVE, 2]], num: 0 },
        3: { bodypart: [[WORK, 4], [CARRY, 2], [MOVE, 6]], num: 0 },
        4: { bodypart: [[WORK, 8], [CARRY, 2], [MOVE, 5]], num: 0 },
        5: { bodypart: [[WORK, 10], [CARRY, 5], [MOVE, 5]], num: 0 },
        6: { bodypart: [[WORK, 20], [CARRY, 1], [MOVE, 5]], num: 0 },
        7: { bodypart: [[WORK, 39], [CARRY, 1], [MOVE, 10]], num: 0 },
        8: { bodypart: [[WORK, 32], [CARRY, 1], [MOVE, 16]], num: 0 }
    },
    "defend-attack": {
        1: { bodypart: [[ATTACK, 2], [MOVE, 2]], num: 0 },
        2: { bodypart: [[ATTACK, 4], [MOVE, 4]], num: 0 },
        3: { bodypart: [[ATTACK, 6], [MOVE, 6]], num: 0 },
        4: { bodypart: [[ATTACK, 10], [MOVE, 10]], num: 0 },
        5: { bodypart: [[ATTACK, 12], [MOVE, 12]], num: 0 },
        6: { bodypart: [[ATTACK, 15], [MOVE, 15]], num: 0 },
        7: { bodypart: [[ATTACK, 40], [MOVE, 10]], num: 0 },
        8: { bodypart: [[ATTACK, 40], [MOVE, 10]], num: 0 },
    },
    "defend-ranged": {
        6: { bodypart: [[RANGED_ATTACK, 10], [MOVE, 10]], num: 0 },
        7: { bodypart: [[RANGED_ATTACK, 30], [MOVE, 10]], num: 0 },
        8: { bodypart: [[RANGED_ATTACK, 40], [MOVE, 10]], num: 0 },
    },
    "defend-2attack": {
        7: { bodypart: [[TOUGH, 5], [ATTACK, 35], [MOVE, 10]], num: 0 },
        8: { bodypart: [[TOUGH, 5], [ATTACK, 35], [MOVE, 10]], num: 0 },
    },
    "defend-2heal": {
        7: { bodypart: [[TOUGH, 5], [HEAL, 20], [MOVE, 10]], num: 0 },
        8: { bodypart: [[TOUGH, 5], [HEAL, 35], [MOVE, 10]], num: 0 },
    },
    "aid-build": {
        1: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        2: { bodypart: [[WORK, 3], [CARRY, 2], [MOVE, 3]], num: 0 },
        3: { bodypart: [[WORK, 4], [CARRY, 3], [MOVE, 4]], num: 0 },
        4: { bodypart: [[WORK, 5], [CARRY, 4], [MOVE, 9]], num: 0 },
        5: { bodypart: [[WORK, 6], [CARRY, 6], [MOVE, 12]], num: 0 },
        6: { bodypart: [[WORK, 10], [CARRY, 10], [MOVE, 10]], num: 0 },
        7: { bodypart: [[WORK, 15], [CARRY, 15], [MOVE, 15]], num: 0 },
        8: { bodypart: [[WORK, 16], [CARRY, 16], [MOVE, 16]], num: 0 },
    },
    "aid-upgrade": {
        1: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 1]], num: 0 },
        2: { bodypart: [[WORK, 2], [CARRY, 2], [MOVE, 2]], num: 0 },
        3: { bodypart: [[WORK, 4], [CARRY, 3], [MOVE, 4]], num: 0 },
        4: { bodypart: [[WORK, 6], [CARRY, 4], [MOVE, 6]], num: 0 },
        5: { bodypart: [[WORK, 10], [CARRY, 5], [MOVE, 10]], num: 0 },
        6: { bodypart: [[WORK, 12], [CARRY, 5], [MOVE, 12]], num: 0 },
        7: { bodypart: [[WORK, 20], [CARRY, 5], [MOVE, 13]], num: 0 },
        8: { bodypart: [[WORK, 25], [CARRY, 5], [MOVE, 15]], num: 0 },
    }
}

// 配置选项
export const RoleBodys = {
    'aid-build': {
        'T3': {
            bodypart: [[WORK, 35], [CARRY, 5], [MOVE, 10]],
            boostmap: { [WORK]: 'XLH2O', [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' }
        }
    },
    'aid-upgrade': {
        'T3': {
            bodypart: [[WORK, 35], [CARRY, 5], [MOVE, 10]],
            boostmap: { [WORK]: 'XGH2O', [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' }
        }
    },
    'aid-carry': {
        'T3': {
            bodypart: [[CARRY, 25], [MOVE, 25]],
            boostmap: { [CARRY]: 'XKH2O' }
        },
        'BIG': {
            bodypart: [[CARRY, 40], [MOVE, 10]],
            boostmap: { [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' }
        }
    }
}
