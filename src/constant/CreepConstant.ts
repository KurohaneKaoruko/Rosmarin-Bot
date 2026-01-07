interface RoleConfig {
    [role: string]: {
        bodypart: any[],     // body配置
        must?: boolean,      // 是否无论战争还是和平都得孵化
        level?: number,      // 孵化优先级, 越小越优先
        code?: string,       // 短代号, 用于Creep名称
        work?: string,       // 执行函数名称, 在两种工作状态之间切换
        action?: string,     // 执行函数名称，自由定义的行动逻辑
        boostmap?: {
            [key: string]: string
        },  // boost配置
    }
}


export const RoleData: RoleConfig = {
    /* 基本房间运营 */
    'harvester': {
        bodypart: [[WORK, 2], [MOVE, 2]],
        level: 3, code: 'H', action: 'harvester'
    },  // 采集
    'carrier': {
        bodypart: [[CARRY, 3], [MOVE, 3]],
        level: 4, code: 'C', work: 'carrier'
    },  // 通用搬运
    'transport': {
        bodypart: [[CARRY, 4], [MOVE, 2]],
        level: 2, code: 'T', action: 'transport'
    }, // 资源搬运
    'manager': {
        bodypart: [[CARRY, 4], [MOVE, 2]],
        level: 1, code: 'M', action: 'manager'
    }, // 中央搬运
    'upgrader': {
        bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]],
        level: 10, code: 'U', work: 'upgrader'
    }, // 升级
    'worker': {
        bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]],
        level: 10, code: 'W', work: 'worker'
    }, // 建造、维修、刷墙
    'mineral': {
        bodypart: [[WORK, 2], [CARRY, 1], [MOVE, 1]],
        level: 6, code: 'MR', work: 'mineral'
    }, // 矿工
    'universal': {
        bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]],
        level: 0, code: 'UNIV', work: 'universal'
    }, // 采集搬运通用机，处理停摆与新房起步

    /* 特殊用途 */
    'scout': {
        bodypart: [[MOVE, 1]],
        level: 11, code: 'S', work: 'scout'
    },
    'logistic': {
        bodypart: [[CARRY, 3], [MOVE, 3]],
        level: 10, code: 'L', work: 'logistic'
    }, // 长途运输
    'cleaner': {
        bodypart: [[WORK, 25], [MOVE, 25]],
        level: 11, code: 'CLE', action: 'cleaner'
    },  // 清理者
    'dismantle': {
        bodypart: [[WORK, 40], [MOVE, 10]],
        boostmap: {[WORK]: 'XZH2O', [MOVE]: 'XZHO2'},
        level: 11, code: 'DIS', action: 'dismantle'
    },  // 拆除者
    'UP-upgrade': {
        bodypart: [[WORK, 2], [CARRY, 1], [MOVE, 1]],
        level: 11, code: 'UUP', work: 'up-upgrade'
    }, // 加速升级
    'UP-repair': {
        bodypart: [[WORK, 30], [CARRY, 5], [MOVE, 15]],
        level: 11, code: 'URE', work: 'up-repair'
    }, // 加速维修
    'signer': {
        bodypart: [[MOVE, 1]],
        level: 11, code: 'SIG', action: 'signer'
    }, // 签名


    /* 占领房间 */
    'claimer': {
        bodypart: [[MOVE, 5], [CLAIM, 1]],
        level: 10, code: 'CL', action: 'claimer'
    },
    'aclaimer': {
        bodypart: [[MOVE, 16], [CLAIM, 16]],
        level: 10, code: 'ACL', action: 'aclaimer'
    },

    /* 援建 */
    'aid-build': {
        bodypart: [[WORK, 20], [CARRY, 5], [MOVE, 25]],
        level: 10, code: 'AIDB', action: 'aid-build'
    },
    'aid-carry': {
        bodypart: [[CARRY, 25], [MOVE, 25]],
        level: 10, code: 'AIDC', work: 'aid-carry'
    },
    'aid-upgrade': {
        bodypart: [[WORK, 20], [CARRY, 5], [MOVE, 25]],
        level: 10, code: 'AIDU', work: 'aid-upgrade'
    },


    /* 战斗相关 */
    /* 一体机 */
    'one-ranged': {
        bodypart: [[TOUGH, 10], [RANGED_ATTACK, 10], [MOVE, 10], [HEAL, 20]],
        level: 10, code: '1R', action: 'one-ranged'
    },
    'aio': {
        bodypart: [[RANGED_ATTACK, 13], [MOVE, 25], [HEAL, 12]],
        level: 10, code: 'AIO', action: 'aio'
    }, // 进攻一体机
    'saio': {
        bodypart: [[RANGED_ATTACK, 10], [MOVE, 25], [HEAL, 15]],
        level: 10, code: 'SAIO', action: 'aio'
    }, // 支援一体机

    /* 二人队 */
    'double-attack': {
        bodypart: [[ATTACK, 8], [TOUGH, 12], [ATTACK, 20], [MOVE, 10]],
        boostmap: {[ATTACK]: 'XUH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2'},
        level: 10, code: '2A', action: 'double-attack'
    },
    'double-dismantle': {
        bodypart: [[WORK, 8], [TOUGH, 12], [WORK, 20], [MOVE, 10]],
        boostmap: {[WORK]: 'XZH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2'},
        level: 10, code: '2D', action: 'double-dismantle'
    },
    'double-heal': {
        bodypart: [[TOUGH, 12], [HEAL, 28], [MOVE, 10]],
        boostmap: {[TOUGH]: 'XGHO2', [HEAL]: 'XLHO2', [MOVE]: 'XZHO2'},
        level: 10, code: '2H', action: 'double-heal'
    },

    /* 四人队 */
    'team-attack': { bodypart: [], level: 10, code: 'xA' },
    'team-dismantle': { bodypart: [], level: 10, code: 'xD' },
    'team-heal': { bodypart: [], level: 10, code: 'xH' },
    'team-ranged': { bodypart: [], level: 10, code: 'xR' },

    /* 主动防御 */
    'defend-attack': {
        bodypart: [[ATTACK, 40], [MOVE, 10]],
        level: 8, code: "DFA", must: true, action: 'defend-attack'
    },
    'defend-ranged': {
        bodypart: [[RANGED_ATTACK, 40], [MOVE, 10]],
        level: 8, code: "DFR", must: true, action: 'defend-ranged'
    },
    'defend-2attack': {
        bodypart: [[TOUGH, 5], [ATTACK, 35], [MOVE, 10]],
        level: 7, code: "D2A", must: true, action: 'defend-2attack'
    },
    'defend-2heal': {
        bodypart: [[TOUGH, 10], [HEAL, 30], [MOVE, 10]],
        level: 7, code: "D2H", must: true, action: 'defend-2heal'
    },

    /* 外矿相关 */
    /* 外矿 */
    'reserver': { bodypart: [], level: 11, code: 'RSV', work: 'reserve' },
    'out-harvest': { bodypart: [], level: 12, code: 'OH', work: 'out-harvest' },
    'out-car': { bodypart: [], level: 13, code: 'OC', work: 'out-carry' },
    'out-carry': { bodypart: [], level: 13, code: 'OC', work: 'out-carry' },
    'out-build': { bodypart: [], level: 12, code: 'OB', work: 'out-build' },
    'out-defend': { bodypart: [], level: 8, code: 'OD', action: 'out-defend' },
    'out-2attack': { bodypart: [], level: 8, code: 'O2A', action: 'out-2attack' },
    'out-2heal': { bodypart: [], level: 8, code: 'O2H', action: 'out-2heal' },
    'out-invader': { bodypart: [], level: 10, code: 'OI', action: 'out-invader' },
    'out-attack': {
        bodypart: [[ATTACK, 19], [MOVE, 25], [HEAL, 6]],
        level: 9, code: 'OA', action: 'out-attack'
    },
    'out-ranged': {
        bodypart: [[RANGED_ATTACK, 15], [MOVE, 25], [HEAL, 10]],
        level: 9, code: 'OR', action: 'out-ranged'
    },
    'out-mineral': {
        bodypart: [[WORK, 30], [CARRY, 5], [MOVE, 15]],
        level: 12, code: 'OMR', work: 'out-mineral'
    },

    /* 沉积物 */
    'deposit-harvest': {
        bodypart: [[WORK, 20], [ATTACK, 2], [CARRY, 6], [MOVE, 22]],
        level: 11, code: 'DH', work: 'deposit-harvest'
    },
    'deposit-transfer': {
        bodypart: [[CARRY, 25], [MOVE, 25]],
        level: 11, code: 'DT', work: 'deposit-transfer'
    },
    'deposit-attack': {
        bodypart: [[ATTACK, 25], [MOVE, 25]],
        level: 8, code: "DPA", action: 'deposit-attack'
    },
    'deposit-heal': {
        bodypart: [[HEAL, 25], [MOVE, 25]],
        level: 8, code: 'DPH', action: 'deposit-heal'
    },
    'deposit-ranged': {
        bodypart: [[RANGED_ATTACK, 17], [MOVE, 25], [HEAL, 8]],
        level: 8, code: "DPR", action: 'deposit-ranged'
    },

    /* Power */
    'power-attack': {
        bodypart: [[TOUGH, 5], [MOVE, 25], [ATTACK, 20]],
        level: 10, code: 'PA', action: 'power-attack'
    },
    'power-heal': {
        bodypart: [[MOVE, 25], [HEAL, 25]],
        level: 10, code: 'PH', action: 'power-heal'
    },
    'power-carry': {
        bodypart: [[MOVE, 25], [CARRY, 25]],
        level: 9, code: 'PC', work: 'power-carry'
    },
    'power-ranged': {
        bodypart: [[MOVE, 25], [RANGED_ATTACK, 17], [HEAL, 8]],
        level: 11, code: 'PR', action: 'power-ranged'
    },

}

// 根据等级的动态部件
export const RoleLevelData = {
    'harvester': {
        1: { bodypart: [[WORK, 2], [MOVE, 2]], num: 0 },
        2: { bodypart: [[WORK, 4], [CARRY, 1], [MOVE, 1]], num: 0 },
        3: { bodypart: [[WORK, 5], [CARRY, 1], [MOVE, 2]], num: 0 },
        4: { bodypart: [[WORK, 5], [CARRY, 2], [MOVE, 3]], num: 0 },
        5: { bodypart: [[WORK, 8], [CARRY, 4], [MOVE, 4]], num: 0 },
        6: { bodypart: [[WORK, 10], [CARRY, 4], [MOVE, 5]], num: 0 },
        7: { bodypart: [[WORK, 10], [CARRY, 4], [MOVE, 5]], num: 0 },
        8: { bodypart: [[WORK, 10], [CARRY, 4], [MOVE, 5]], num: 0,
             upbodypart: [[WORK, 20], [CARRY, 4], [MOVE, 10]] },
    },
    'carrier': {
        1: { bodypart: [[CARRY, 2], [MOVE, 2]], num: 1 },
        2: { bodypart: [[CARRY, 3], [MOVE, 3]], num: 1 },
        3: { bodypart: [[CARRY, 7], [MOVE, 7]], num: 1 },
        4: { bodypart: [[CARRY, 10], [MOVE, 10]], num: 1 },
        5: { bodypart: [[CARRY, 12], [MOVE, 12]], num: 2 },
        6: { bodypart: [[CARRY, 15], [MOVE, 15]], num: 2 },
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
        4: { bodypart: [[WORK, 5], [CARRY, 3], [MOVE, 8]], num: 2 },
        5: { bodypart: [[WORK, 8], [CARRY, 2], [MOVE, 8]], num: 2 },
        6: { bodypart: [[WORK, 10], [CARRY, 5], [MOVE, 10]], num: 1 },
        7: { bodypart: [[WORK, 30], [CARRY, 5], [MOVE, 15]], num: 1 },
        8: { bodypart: [[WORK, 15], [CARRY, 5], [MOVE, 10]], num: 1 },
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
        3: { bodypart: [], num: 0 },
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
        2: { bodypart: [[WORK, 4], [MOVE, 2]], num: 0 },
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
        1: { bodypart: [[MOVE, 1], [HEAL, 1]], num: 0 },
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
        8: { bodypart: [[ATTACK, 20], [RANGED_ATTACK, 5] , [MOVE, 25]], num: 0 },
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
    "UP-upgrade": {
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
    "aid-build": {
        1: { bodypart: [[WORK, 1], [CARRY, 1], [MOVE, 2]], num: 0 },
        2: { bodypart: [[WORK, 2], [CARRY, 2], [MOVE, 4]], num: 0 },
        3: { bodypart: [[WORK, 3], [CARRY, 3], [MOVE, 6]], num: 0 },
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