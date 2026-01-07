const A = ATTACK
const W = WORK
const R = RANGED_ATTACK
const H = HEAL
const T = TOUGH
const M = MOVE

const T3 = {
    [A]: 'XUH2O',
    [W]: 'XZH2O',
    [R]: 'XKHO2',
    [H]: 'XLHO2',
    [T]: 'XGHO2',
    [M]: 'XZHO2',
}

const A25T15 = {
    role: 'team-attack',
    bodypart: [[A, 10], [T, 15], [A, 15], [M, 10]],
    boostmap: T3,
};
const W25T15 = {
    role: 'team-dismantle',
    bodypart: [[W, 10], [T, 15], [W, 15], [M, 10]],
    boostmap: T3,
};
const R25T15 = {
    role: 'team-ranged',
    bodypart: [[R, 10], [T, 15], [R, 15], [M, 10]],
    boostmap: T3,
};
const A28T12 = {
    role: 'team-attack',
    bodypart: [[A, 10], [T, 12], [A, 18], [M, 10]],
    boostmap: T3,
}
const W28T12 = {
    role: 'team-dismantle',
    bodypart: [[W, 10], [T, 12], [W, 18], [M, 10]],
    boostmap: T3,
}
const R28T12 = {
    role: 'team-ranged',
    bodypart: [[R, 10], [T, 12], [R, 18], [M, 10]],
    boostmap: T3,
}
const H28T12 = {
    role: 'team-heal',
    bodypart: [[T, 12], [M, 10], [H, 28]],
    boostmap: T3,
};

const A29T11 = {
    role: 'team-attack',
    bodypart: [[T, 11], [A, 29], [M, 10]],
    boostmap: T3,
}
const W29T11 = {
    role: 'team-dismantle',
    bodypart: [[T, 11], [W, 29], [M, 10]],
    boostmap: T3,
}
const R29T11 = {
    role: 'team-ranged',
    bodypart: [[T, 11], [R, 29], [M, 10]],
    boostmap: T3,
}
const H29R1T10 = {
    role: 'team-heal',
    bodypart: [[T, 10], [R, 1], [H, 29], [M, 10]],
    boostmap: T3,
}



const A35T5 = {
    role: 'team-attack',
    bodypart: [[A, 5], [T, 5], [A, 30], [M, 10]],
    boostmap: T3,
};
const W35T5 = {
    role: 'team-dismantle',
    bodypart: [[W, 5], [T, 5], [W, 30], [M, 10]],
    boostmap: T3,
};
const R30T10 = {
    role: 'team-ranged',
    bodypart: [[R, 15], [T, 10], [R, 15], [M, 10]],
    boostmap: T3,
};
const H35T5 = {
    role: 'team-heal',
    bodypart: [[T, 5], [H, 35], [M, 10]],
    boostmap: T3,
};

const A40 = {
    role: 'team-attack',
    bodypart: [[A, 40], [M, 10]],
    boostmap: T3,
}
const W40 = {
    role: 'team-dismantle',
    bodypart: [[W, 40], [M, 10]],
    boostmap: T3,
}
const R40 = {
    role: 'team-ranged',
    bodypart: [[R, 40], [M, 10]],
    boostmap: T3,
}
const H40 = {
    role: 'team-heal',
    bodypart: [[H, 40], [M, 10]],
    boostmap: T3,
}


export const TEAM_CONFIG = {
    /** 常用配置 */
    'W25/4': [ W25T15, W25T15, H28T12, H28T12 ],
    'A25/4': [ A25T15, A25T15, H28T12, H28T12 ],
    'R25/4': [ R25T15, R25T15, H28T12, H28T12 ],

    'W28/4': [ W28T12, W28T12, H28T12, H28T12 ],
    'A28/4': [ A28T12, A28T12, H28T12, H28T12 ],
    'R28/4': [ R28T12, R28T12, H28T12, H28T12 ],

    'W29/4': [ W29T11, W29T11, H29R1T10, H29R1T10 ],
    'A29/4': [ A29T11, A29T11, H29R1T10, H29R1T10 ],
    'R29/4': [ R29T11, R29T11, H29R1T10, H29R1T10 ],

    /** 混搭 */
    'AW/4': [ A25T15, W25T15, H28T12, H28T12 ],
    'AR/4': [ A25T15, R28T12, H28T12, H28T12 ],
    'WR/4': [ W25T15, R28T12, H28T12, H28T12 ],
    'AW28/4': [ A28T12, W28T12, H28T12, H28T12 ],
    'AR28/4': [ A28T12, R28T12, H28T12, H28T12 ],
    'WR28/4': [ W28T12, R28T12, H28T12, H28T12 ],
    'AW29/4': [ A29T11, W29T11, H29R1T10, H29R1T10 ],
    'AR29/4': [ A29T11, R29T11, H29R1T10, H29R1T10 ],
    'WR29/4': [ W29T11, R29T11, H29R1T10, H29R1T10 ],

    /** 激进配置 */
    // 双大黄
    'W35/4': [ W35T5, W35T5, H35T5, H35T5 ],
    // 双大红
    'A35/4': [ A35T5, A35T5, H35T5, H35T5 ],
    // 双大蓝
    'R30/4': [ R30T10, R30T10, H35T5, H35T5 ],

    /** 无奶 */
    // 四大蓝
    'R40/4': [ R40, R40, R40, R40 ],
    // 大黄大蓝
    'WR40/4': [ W40, W40, R40, R40],

    /** 二人小队 */
    // 二人红
    'AH/2': [ A25T15, H28T12 ],
    // 二人黄
    'WH/2': [ W25T15, H28T12 ],
    // 二人蓝
    'RH/2': [ R28T12, H28T12 ],
    // 二人35红
    'AH35/2': [ A35T5, H35T5],
    // 二人35黄
    'WH35/2': [ W35T5, H35T5],
    // 二人35蓝
    'RH35/2': [ R30T10, H35T5],
    // 二人40红
    'AH40/2': [ A40, H40 ],
    // 二人40黄
    'WH40/2': [ W40, H40 ],
    // 二人40蓝
    'RH40/2': [ R40, H40 ],
    // 二人黄蓝
    'WR40/2': [ W40, R40],

    // 无boost
    'RH/4T0': [
        { role: 'team-ranged', bodypart: [[RANGED_ATTACK, 25], [MOVE, 25]]},
        { role: 'team-ranged', bodypart: [[RANGED_ATTACK, 25], [MOVE, 25]]},
        { role: 'team-heal', bodypart: [[HEAL, 25], [MOVE, 25]]},
        { role: 'team-heal', bodypart: [[HEAL, 25], [MOVE, 25]]}
    ],
    'AH/4T0': [
        { role: 'team-attack', bodypart: [[ATTACK, 25], [MOVE, 25]] },
        { role: 'team-attack', bodypart: [[ATTACK, 25], [MOVE, 25]] },
        { role: 'team-heal', bodypart: [[HEAL, 25], [MOVE, 25]] },
        { role: 'team-heal', bodypart: [[HEAL, 25], [MOVE, 25]] }
    ],
    'WH/4T0': [
        { role: 'team-dismantle', bodypart: [[WORK, 25], [MOVE, 25]] },
        { role: 'team-dismantle', bodypart: [[WORK, 25], [MOVE, 25]] },
        { role: 'team-heal', bodypart: [[HEAL, 25], [MOVE, 25]] },
        { role: 'team-heal', bodypart: [[HEAL, 25], [MOVE, 25]] }
    ],
    'AH/2T0': [
        { role: 'team-attack', bodypart: [[ATTACK, 25], [MOVE, 25]] },
        { role: 'team-heal', bodypart: [[HEAL, 25], [MOVE, 25]] }
    ],
    'WH/2T0': [
        { role: 'team-dismantle', bodypart: [[WORK, 25], [MOVE, 25]] },
        { role: 'team-heal', bodypart: [[HEAL, 25], [MOVE, 25]] }
    ],
    'RH/2T0': [
        { role: 'team-ranged', bodypart: [[RANGED_ATTACK, 25], [MOVE, 25]] },
        { role: 'team-heal', bodypart: [[HEAL, 25], [MOVE, 25]] }
    ],


    /** 测试 */
    'TEST': [
        { role: 'team-attack', bodypart: [[ATTACK, 1], [MOVE, 1]] },
        { role: 'team-dismantle', bodypart: [[WORK, 1], [MOVE, 1]] },
        { role: 'team-ranged', bodypart: [[RANGED_ATTACK, 1], [MOVE, 1]] },
        { role: 'team-heal', bodypart: [[HEAL, 1], [MOVE, 1]] }
    ],

}