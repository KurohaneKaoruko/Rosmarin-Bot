import {
    buildBoostedMember,
    buildDuo,
    buildFrontlineMember,
    buildHealerMember,
    buildMaxedMember,
    buildFour,
    buildMixed,
    buildPlainMember,
    buildTestMember,
    buildXFour,
    buildUnboostedMember,
} from './TeamConfigFunc';

/**
 * Team 配置表（体型 / 角色 / boost 映射）。
 *
 * TeamSpawner 会从孵化旗解析 config key，并在这里取出队伍成员数组。
 * 数组顺序会映射到队内 A1/A2/B1/B2 等位置，所以每个配置的成员顺序不能乱。
 *
 * key 命名约定：
 * - `A/W/R/H`：attack / dismantle / ranged / heal
 * - `25/28/29/35/40`：成员模板档位
 * - 低 RCL 配置用 `AH/4L7` / `AR/2L5` 这类格式表示，且默认无 boost
 * - RH 可额外带 `S` / `I` 后缀区分分开版和一体版
 * - `/4`：四人队，`/2`：二人队
 * - `N`：不使用 boost
 *
 * 模板变量命名约定：
 * - 直接按 body 顺序命名，便于一眼看出体型，例如 `A40M10`、`A10T15A15M10`、`R20H5M25N`
 * - 无 boost 模板以 `N` 结尾
 */

// 常用 boosted 模板
const A10T15A15M10 = buildFrontlineMember('A', 10, 15, 15);
const W10T15W15M10 = buildFrontlineMember('W', 10, 15, 15);
const R10T15R15M10 = buildFrontlineMember('R', 10, 15, 15);

const A10T12A18M10 = buildFrontlineMember('A', 10, 12, 18);
const W10T12W18M10 = buildFrontlineMember('W', 10, 12, 18);
const R10T12R18M10 = buildFrontlineMember('R', 10, 12, 18);
const T12M10H28 = buildHealerMember({ tough: 12, heal: 28 });

const A9T11A20M10 = buildFrontlineMember('A', 9, 11, 20);
const W9T11W20M10 = buildFrontlineMember('W', 9, 11, 20);
const R9T11R20M10 = buildFrontlineMember('R', 9, 11, 20);
const T10R1H29M10 = buildHealerMember({ tough: 10, ranged: 1, heal: 29 });

const A5T5A30M10 = buildFrontlineMember('A', 5, 5, 30);
const W5T5W30M10 = buildFrontlineMember('W', 5, 5, 30);
const R15T10R15M10 = buildFrontlineMember('R', 15, 10, 15);
const T5M10H35 = buildHealerMember({ tough: 5, heal: 35 });

const A40M10 = buildMaxedMember('A', 40);
const W40M10 = buildMaxedMember('W', 40);
const R40M10 = buildMaxedMember('R', 40);
const H40M10 = buildMaxedMember('H', 40);

const R10T10R10H10M10 = buildBoostedMember('R', [
    [RANGED_ATTACK, 10],
    [TOUGH, 10],
    [RANGED_ATTACK, 10],
    [HEAL, 10],
    [MOVE, 10],
]);

const H10T10R10H10M10 = buildBoostedMember('R', [
    [HEAL, 10],
    [TOUGH, 10],
    [RANGED_ATTACK, 10],
    [HEAL, 10],
    [MOVE, 10],
]);

// 低 RCL 双/四人队模板：默认无 boost，且不带 TOUGH。
const H18M18N = buildPlainMember('H', [[HEAL, 18], [MOVE, 18]]);
const R20H5M25N = buildPlainMember('R', [[RANGED_ATTACK, 20], [HEAL, 5], [MOVE, 25]]);

const A17M17N = buildPlainMember('A', [[ATTACK, 17], [MOVE, 17]]);
const W15M15N = buildPlainMember('W', [[WORK, 15], [MOVE, 15]]);
const R11M11N = buildPlainMember('R', [[RANGED_ATTACK, 11], [MOVE, 11]]);
const H7M7N = buildPlainMember('H', [[HEAL, 7], [MOVE, 7]]);

const A13M13N = buildPlainMember('A', [[ATTACK, 13], [MOVE, 13]]);
const W12M12N = buildPlainMember('W', [[WORK, 12], [MOVE, 12]]);
const R9M9N = buildPlainMember('R', [[RANGED_ATTACK, 9], [MOVE, 9]]);
const H6M6N = buildPlainMember('H', [[HEAL, 6], [MOVE, 6]]);

const A10M10N = buildPlainMember('A', [[ATTACK, 10], [MOVE, 10]]);
const W8M8N = buildPlainMember('W', [[WORK, 8], [MOVE, 8]]);
const R6M6N = buildPlainMember('R', [[RANGED_ATTACK, 6], [MOVE, 6]]);
const H4M4N = buildPlainMember('H', [[HEAL, 4], [MOVE, 4]]);

// 显式无 boost / 测试模板
const A25M25N = buildUnboostedMember('A');
const W25M25N = buildUnboostedMember('W');
const R25M25N = buildUnboostedMember('R');
const H25M25N = buildUnboostedMember('H');

const A1M1Test = buildTestMember('A');
const W1M1Test = buildTestMember('W');
const R1M1Test = buildTestMember('R');
const H1M1Test = buildTestMember('H');

// 这里只决定队伍怎么拼，不再重复写成员体型。
export const TEAM_CONFIG = {
    /** 常用配置 */
    'W25/4': buildFour(W10T15W15M10, T12M10H28),
    'A25/4': buildFour(A10T15A15M10, T12M10H28),
    'R25/4': buildFour(R10T15R15M10, T12M10H28),

    'W28/4': buildFour(W10T12W18M10, T12M10H28),
    'A28/4': buildFour(A10T12A18M10, T12M10H28),
    'R28/4': buildFour(R10T12R18M10, T12M10H28),

    'W29/4': buildFour(W9T11W20M10, T10R1H29M10),
    'A29/4': buildFour(A9T11A20M10, T10R1H29M10),
    'R29/4': buildFour(R9T11R20M10, T10R1H29M10),

    'RH/4': buildFour(R10T10R10H10M10, H10T10R10H10M10),

    /** 混搭 */
    'AW/4': buildMixed(A10T15A15M10, W10T15W15M10, T12M10H28),
    'AR/4': buildMixed(A10T15A15M10, R10T12R18M10, T12M10H28),
    'WR/4': buildMixed(W10T15W15M10, R10T12R18M10, T12M10H28),
    'AW28/4': buildMixed(A10T12A18M10, W10T12W18M10, T12M10H28),
    'AR28/4': buildMixed(A10T12A18M10, R10T12R18M10, T12M10H28),
    'WR28/4': buildMixed(W10T12W18M10, R10T12R18M10, T12M10H28),
    'AW29/4': buildMixed(A9T11A20M10, W9T11W20M10, T10R1H29M10),
    'AR29/4': buildMixed(A9T11A20M10, R9T11R20M10, T10R1H29M10),
    'WR29/4': buildMixed(W9T11W20M10, R9T11R20M10, T10R1H29M10),

    /** 激进配置 */
    'W35/4': buildFour(W5T5W30M10, T5M10H35),
    'A35/4': buildFour(A5T5A30M10, T5M10H35),
    'R30/4': buildFour(R15T10R15M10, T5M10H35),

    /** 无奶 */
    'R40/4': buildXFour(R40M10),
    'WR40/4': buildFour(W40M10, R40M10),

    /** 无 boost */
    'RH/4N': buildFour(R25M25N, H25M25N),
    'AH/4N': buildFour(A25M25N, H25M25N),
    'WH/4N': buildFour(W25M25N, H25M25N),
    'AH/2N': buildDuo(A25M25N, H25M25N),
    'WH/2N': buildDuo(W25M25N, H25M25N),
    'RH/2N': buildDuo(R25M25N, H25M25N),

    /** 二人小队 */
    'AH/2': buildDuo(A10T15A15M10, T12M10H28),
    'WH/2': buildDuo(W10T15W15M10, T12M10H28),
    'RH/2': buildDuo(R10T12R18M10, T12M10H28),
    'AH35/2': buildDuo(A5T5A30M10, T5M10H35),
    'WH35/2': buildDuo(W5T5W30M10, T5M10H35),
    'RH35/2': buildDuo(R15T10R15M10, T5M10H35),
    'AH40/2': buildDuo(A40M10, H40M10),
    'WH40/2': buildDuo(W40M10, H40M10),
    'RH40/2': buildDuo(R40M10, H40M10),
    'WR40/2': buildDuo(W40M10, R40M10),

    /** 低 RCL 队伍 */
    // RCL 7
    'AH/4L7': buildFour(A25M25N, H18M18N),
    'WH/4L7': buildFour(W25M25N, H18M18N),
    'RH/4L7': buildFour(R25M25N, H18M18N),
    'RX/4L7': buildXFour(R20H5M25N),

    'AH/2L7': buildDuo(A25M25N, H18M18N),
    'WH/2L7': buildDuo(W25M25N, H18M18N),
    'RH/2L7': buildDuo(R25M25N, H18M18N),
    'RX/2L7': buildDuo(R20H5M25N, R20H5M25N),

    // RCL 6
    'AH/4L6': buildFour(A17M17N, H7M7N),
    'WH/4L6': buildFour(W15M15N, H7M7N),
    'RH/4L6': buildFour(R11M11N, H7M7N),

    'AH/2L6': buildDuo(A17M17N, H7M7N),
    'WH/2L6': buildDuo(W15M15N, H7M7N),
    'RH/2L6': buildDuo(R11M11N, H7M7N),

    // RCL 5
    'AH/4L5': buildFour(A13M13N, H6M6N),
    'WH/4L5': buildFour(W12M12N, H6M6N),
    'RH/4L5': buildFour(R9M9N, H6M6N),

    'AR/4L5': buildFour(A13M13N, R9M9N),
    'WR/4L5': buildFour(W12M12N, R9M9N),
    'R2/4L5': buildXFour(R9M9N),

    'AH/2L5': buildDuo(A13M13N, H6M6N),
    'WH/2L5': buildDuo(W12M12N, H6M6N),
    'RH/2L5': buildDuo(R9M9N, H6M6N),

    'AR/2L5': buildDuo(A13M13N, R9M9N),
    'WR/2L5': buildDuo(W12M12N, R9M9N),
    'R2/2L5': buildDuo(R9M9N, R9M9N),

    // RCL 4
    'AH/4L4': buildFour(A10M10N, H4M4N),
    'WH/4L4': buildFour(W8M8N, H4M4N),
    'RH/4L4': buildFour(R6M6N, H4M4N),

    'AR/4L4': buildFour(A10M10N, R6M6N),
    'WR/4L4': buildFour(W8M8N, R6M6N),
    'R2/4L4': buildXFour(R6M6N),

    'AH/2L4': buildDuo(A10M10N, H4M4N),
    'WH/2L4': buildDuo(W8M8N, H4M4N),
    'RH/2L4': buildDuo(R6M6N, H4M4N),

    'AR/2L4': buildDuo(A10M10N, R6M6N),
    'WR/2L4': buildDuo(W8M8N, R6M6N),
    'R2/2L4': buildDuo(R6M6N, R6M6N),

    /** 测试 */
    TEST: [
        A1M1Test,
        W1M1Test,
        R1M1Test,
        H1M1Test,
    ],
};
