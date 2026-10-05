/**
 * Team 配置表（体型 / 角色 / boost 映射）。
 *
 * TeamSpawner 会从孵化旗解析 config key，并在这里取出队伍成员数组。
 * 数组顺序会映射到队内 A1/A2/B1/B2 等位置，所以每个配置的成员顺序不能乱。
 *
 * 配置 key 命名约定：
 * - `A/W/R/H`：attack / dismantle / ranged / heal
 * - `25/28/29/35/40`：成员模板档位
 * - 低 RCL 配置用 `AH/4L7` / `AR/2L5` 这类格式表示，且默认无 boost
 * - `/4`：四人队，`/2`：二人队；`N`：不使用 boost
 *
 * 成员模板名就是体型描述，由 member() 解析成配置：
 * - 语法为 `字母+数字` 序列，字母取 A/W/R/H/T/M = attack/work/ranged/heal/tough/move
 * - 名字以 `N` 结尾 = 无 boost；否则挂全套 T3 boost
 * - role 默认按第一个 A/W/R/H 部件推导，编队不同时显式覆盖
 */

/** T3 boost 对照表：部件 -> 化合物 */
const T3_BOOST_MAP = {
    [ATTACK]: 'XUH2O',
    [WORK]: 'XZH2O',
    [RANGED_ATTACK]: 'XKHO2',
    [HEAL]: 'XLHO2',
    [TOUGH]: 'XGHO2',
    [MOVE]: 'XZHO2',
} as const;

export type TeamMemberConfig = {
    role: string;
    bodypart: (BodyPartConstant | number)[][];
    boostmap?: { [part: string]: string };
};

const PART = { A: ATTACK, W: WORK, R: RANGED_ATTACK, H: HEAL, T: TOUGH, M: MOVE } as const;
const ROLE = { A: 'team-attack', W: 'team-dismantle', R: 'team-ranged', H: 'team-heal' } as const;

/** 把体型名（如 `A10T15A15M10`）解析成成员配置 */
const member = (name: string): TeamMemberConfig => {
    const plain = name.endsWith('N');
    const spec = plain ? name.slice(0, -1) : name;
    const parts = spec.match(/[AWRHTM]\d+/g) ?? [];
    if (parts.length === 0 || parts.join('') !== spec) {
        throw new Error(`无法解析体型名: ${name}`);
    }
    const rolePart = parts.find((p) => p[0] in ROLE);
    if (!rolePart) {
        throw new Error(`体型名 ${name} 缺少角色部件(A/W/R/H)`);
    }
    const role = ROLE[rolePart[0] as keyof typeof ROLE];
    const bodypart = parts.map((p) => [PART[p[0] as keyof typeof PART], Number(p.slice(1))]);
    return plain ? { role, bodypart } : { role, bodypart, boostmap: T3_BOOST_MAP };
};

// ── T3 boost 成员模板 ──────────────────────────────────────────

// 25 档前排：X10 T15 X15 M10
const A10T15A15M10 = member('A10T15A15M10');
const W10T15W15M10 = member('W10T15W15M10');
const R10T15R15M10 = member('R10T15R15M10');

// 28 档前排：X10 T12 X18 M10（TOUGH 更少、输出更重）
const A10T12A18M10 = member('A10T12A18M10');
const W10T12W18M10 = member('W10T12W18M10');
const R10T12R18M10 = member('R10T12R18M10');

// 29 档前排：X9 T11 X20 M10（极限输出）
const A9T11A20M10 = member('A9T11A20M10');
const W9T11W20M10 = member('W9T11W20M10');
const R9T11R20M10 = member('R9T11R20M10');

// 35 档玻璃大炮：A/W 为 X5 T5 X30，R 为 R15 T10 R15 特化
const A5T5A30M10 = member('A5T5A30M10');
const W5T5W30M10 = member('W5T5W30M10');
const R15T10R15M10 = member('R15T10R15M10');

// 奶妈（纯奶版 MOVE 在 HEAL 前，受创先掉 MOVE 保奶量）
const T12M10H28 = member('T12M10H28');
const T5M10H35 = member('T5M10H35');
// 特例：带 1 远程补刀，但仍按奶妈编队（默认推导会误判成远程）
const T10R1H29M10 = { ...member('T10R1H29M10'), role: 'team-heal' };

// 40 档顶配：X40 M10，无 TOUGH
const A40M10 = member('A40M10');
const W40M10 = member('W40M10');
const R40M10 = member('R40M10');
const H40M10 = member('H40M10');

// RH 一体化：前排 R 重 / 后排 H 重，都按远程编队
const R10T10R10H10M10 = member('R10T10R10H10M10');
// 特例：后排 H 更多，但按远程编队
const H10T10R10H10M10 = { ...member('H10T10R10H10M10'), role: 'team-ranged' };

// ── 无 boost 成员模板（无 TOUGH，以 N 结尾）───────────────────

const A25M25N = member('A25M25N');
const W25M25N = member('W25M25N');
const R25M25N = member('R25M25N');
const H25M25N = member('H25M25N');

// L7：前排同 25 部件，奶量降为 18；RX 自带奶量
const H18M18N = member('H18M18N');
const R20H5M25N = member('R20H5M25N');

// L6
const A17M17N = member('A17M17N');
const W15M15N = member('W15M15N');
const R11M11N = member('R11M11N');
const H7M7N = member('H7M7N');

// L5
const A13M13N = member('A13M13N');
const W12M12N = member('W12M12N');
const R9M9N = member('R9M9N');
const H6M6N = member('H6M6N');

// L4
const A10M10N = member('A10M10N');
const W8M8N = member('W8M8N');
const R6M6N = member('R6M6N');
const H4M4N = member('H4M4N');

export const TEAM_CONFIG: Record<string, TeamMemberConfig[]> = {
    /** 常用配置 */
    'W25/4': [W10T15W15M10, W10T15W15M10, T12M10H28, T12M10H28],
    'A25/4': [A10T15A15M10, A10T15A15M10, T12M10H28, T12M10H28],
    'R25/4': [R10T15R15M10, R10T15R15M10, T12M10H28, T12M10H28],

    'W28/4': [W10T12W18M10, W10T12W18M10, T12M10H28, T12M10H28],
    'A28/4': [A10T12A18M10, A10T12A18M10, T12M10H28, T12M10H28],
    'R28/4': [R10T12R18M10, R10T12R18M10, T12M10H28, T12M10H28],

    'W29/4': [W9T11W20M10, W9T11W20M10, T10R1H29M10, T10R1H29M10],
    'A29/4': [A9T11A20M10, A9T11A20M10, T10R1H29M10, T10R1H29M10],
    'R29/4': [R9T11R20M10, R9T11R20M10, T10R1H29M10, T10R1H29M10],

    /** 五人十字：四远攻臂 + 治疗中心（/5 → cross 八向） */
    'R25/5': [R10T15R15M10, R10T15R15M10, R10T15R15M10, R10T15R15M10, T12M10H28],
    /** 九人三方阵：前排远攻 + 中排远攻 + 后排治疗（/9 → square3 八向） */
    'R29/9': [R10T15R15M10, R10T15R15M10, R10T15R15M10, R10T12R18M10, R10T12R18M10, R10T12R18M10, T12M10H28, T12M10H28, T12M10H28],

    'RH/4': [R10T10R10H10M10, R10T10R10H10M10, H10T10R10H10M10, H10T10R10H10M10],

    /** 混搭 */
    'AW/4': [A10T15A15M10, W10T15W15M10, T12M10H28, T12M10H28],
    'AR/4': [A10T15A15M10, R10T12R18M10, T12M10H28, T12M10H28],
    'WR/4': [W10T15W15M10, R10T12R18M10, T12M10H28, T12M10H28],
    'AW28/4': [A10T12A18M10, W10T12W18M10, T12M10H28, T12M10H28],
    'AR28/4': [A10T12A18M10, R10T12R18M10, T12M10H28, T12M10H28],
    'WR28/4': [W10T12W18M10, R10T12R18M10, T12M10H28, T12M10H28],
    'AW29/4': [A9T11A20M10, W9T11W20M10, T10R1H29M10, T10R1H29M10],
    'AR29/4': [A9T11A20M10, R9T11R20M10, T10R1H29M10, T10R1H29M10],
    'WR29/4': [W9T11W20M10, R9T11R20M10, T10R1H29M10, T10R1H29M10],

    /** 激进配置 */
    'W35/4': [W5T5W30M10, W5T5W30M10, T5M10H35, T5M10H35],
    'A35/4': [A5T5A30M10, A5T5A30M10, T5M10H35, T5M10H35],
    'R30/4': [R15T10R15M10, R15T10R15M10, T5M10H35, T5M10H35],

    /** 无奶 */
    'R40/4': [R40M10, R40M10, R40M10, R40M10],
    'WR40/4': [W40M10, W40M10, R40M10, R40M10],

    /** 无 boost */
    'RH/4N': [R25M25N, R25M25N, H25M25N, H25M25N],
    'AH/4N': [A25M25N, A25M25N, H25M25N, H25M25N],
    'WH/4N': [W25M25N, W25M25N, H25M25N, H25M25N],
    'AH/2N': [A25M25N, H25M25N],
    'WH/2N': [W25M25N, H25M25N],
    'RH/2N': [R25M25N, H25M25N],

    /** 二人小队 */
    'AH/2': [A10T15A15M10, T12M10H28],
    'WH/2': [W10T15W15M10, T12M10H28],
    'RH/2': [R10T12R18M10, T12M10H28],
    'AH35/2': [A5T5A30M10, T5M10H35],
    'WH35/2': [W5T5W30M10, T5M10H35],
    'RH35/2': [R15T10R15M10, T5M10H35],
    'AH40/2': [A40M10, H40M10],
    'WH40/2': [W40M10, H40M10],
    'RH40/2': [R40M10, H40M10],
    'WR40/2': [W40M10, R40M10],

    /** 低 RCL 队伍 */
    // RCL 7
    'AH/4L7': [A25M25N, A25M25N, H18M18N, H18M18N],
    'WH/4L7': [W25M25N, W25M25N, H18M18N, H18M18N],
    'RH/4L7': [R25M25N, R25M25N, H18M18N, H18M18N],
    'RX/4L7': [R20H5M25N, R20H5M25N, R20H5M25N, R20H5M25N],

    'AH/2L7': [A25M25N, H18M18N],
    'WH/2L7': [W25M25N, H18M18N],
    'RH/2L7': [R25M25N, H18M18N],
    'RX/2L7': [R20H5M25N, R20H5M25N],

    // RCL 6
    'AH/4L6': [A17M17N, A17M17N, H7M7N, H7M7N],
    'WH/4L6': [W15M15N, W15M15N, H7M7N, H7M7N],
    'RH/4L6': [R11M11N, R11M11N, H7M7N, H7M7N],

    'AH/2L6': [A17M17N, H7M7N],
    'WH/2L6': [W15M15N, H7M7N],
    'RH/2L6': [R11M11N, H7M7N],

    // RCL 5
    'AH/4L5': [A13M13N, A13M13N, H6M6N, H6M6N],
    'WH/4L5': [W12M12N, W12M12N, H6M6N, H6M6N],
    'RH/4L5': [R9M9N, R9M9N, H6M6N, H6M6N],

    'AR/4L5': [A13M13N, A13M13N, R9M9N, R9M9N],
    'WR/4L5': [W12M12N, W12M12N, R9M9N, R9M9N],
    'R2/4L5': [R9M9N, R9M9N, R9M9N, R9M9N],

    'AH/2L5': [A13M13N, H6M6N],
    'WH/2L5': [W12M12N, H6M6N],
    'RH/2L5': [R9M9N, H6M6N],

    'AR/2L5': [A13M13N, R9M9N],
    'WR/2L5': [W12M12N, R9M9N],
    'R2/2L5': [R9M9N, R9M9N],

    // RCL 4
    'AH/4L4': [A10M10N, A10M10N, H4M4N, H4M4N],
    'WH/4L4': [W8M8N, W8M8N, H4M4N, H4M4N],
    'RH/4L4': [R6M6N, R6M6N, H4M4N, H4M4N],

    'AR/4L4': [A10M10N, A10M10N, R6M6N, R6M6N],
    'WR/4L4': [W8M8N, W8M8N, R6M6N, R6M6N],
    'R2/4L4': [R6M6N, R6M6N, R6M6N, R6M6N],

    'AH/2L4': [A10M10N, H4M4N],
    'WH/2L4': [W8M8N, H4M4N],
    'RH/2L4': [R6M6N, H4M4N],

    'AR/2L4': [A10M10N, R6M6N],
    'WR/2L4': [W8M8N, R6M6N],
    'R2/2L4': [R6M6N, R6M6N],

    /** 测试 */
    TEST: [member('A1M1N'), member('W1M1N'), member('R1M1N'), member('H1M1N')],
};
