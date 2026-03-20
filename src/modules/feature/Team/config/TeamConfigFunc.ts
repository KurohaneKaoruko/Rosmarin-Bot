/**
 * TeamConfig 构造助手。
 *
 * 把成员包装函数和组队包装函数拆到单独文件里，
 * 让 TeamConfig.ts 只保留“体型模板”和“配置名到队伍”的映射。
 */
const BODY_PART_BY_ROLE = {
    A: ATTACK,
    W: WORK,
    R: RANGED_ATTACK,
    H: HEAL,
} as const;

const TEAM_ROLE_NAME = {
    A: 'team-attack',
    W: 'team-dismantle',
    R: 'team-ranged',
    H: 'team-heal',
} as const;

const T3_BOOST_MAP = {
    [ATTACK]: 'XUH2O',
    [WORK]: 'XZH2O',
    [RANGED_ATTACK]: 'XKHO2',
    [HEAL]: 'XLHO2',
    [TOUGH]: 'XGHO2',
    [MOVE]: 'XZHO2',
} as const;

export type TeamRoleKey = keyof typeof TEAM_ROLE_NAME;
type FrontlineRoleKey = Exclude<TeamRoleKey, 'H'>;

export const buildBoostedMember = (
    roleKey: TeamRoleKey,
    bodypart: [BodyPartConstant, number][],
) => ({
    role: TEAM_ROLE_NAME[roleKey],
    bodypart,
    boostmap: T3_BOOST_MAP,
});

export const buildPlainMember = (
    roleKey: TeamRoleKey,
    bodypart: [BodyPartConstant, number][],
) => ({
    role: TEAM_ROLE_NAME[roleKey],
    bodypart,
});

export type TeamMemberConfig =
    | ReturnType<typeof buildBoostedMember>
    | ReturnType<typeof buildPlainMember>;

export const buildFrontlineMember = (
    roleKey: FrontlineRoleKey,
    firstCount: number,
    toughCount: number,
    secondCount: number,
    moveCount = 10,
) =>
    buildBoostedMember(roleKey, [
        [BODY_PART_BY_ROLE[roleKey], firstCount],
        [TOUGH, toughCount],
        [BODY_PART_BY_ROLE[roleKey], secondCount],
        [MOVE, moveCount],
    ]);

export const buildHealerMember = (
    toughCount: number,
    healCount: number,
    rangedCount = 0,
    moveCount = 10,
) =>
    buildBoostedMember(
        'H',
        rangedCount > 0
            ? [
                [TOUGH, toughCount],
                [RANGED_ATTACK, rangedCount],
                [HEAL, healCount],
                [MOVE, moveCount],
            ]
            : [
                [TOUGH, toughCount],
                [MOVE, moveCount],
                [HEAL, healCount],
            ],
    );

export const buildMaxedMember = (roleKey: TeamRoleKey, bodypartCount: number) =>
    buildBoostedMember(roleKey, [
        [BODY_PART_BY_ROLE[roleKey], bodypartCount],
        [MOVE, 10],
    ]);

export const buildUnboostedMember = (
    roleKey: TeamRoleKey,
    bodypartCount = 25,
) =>
    buildPlainMember(roleKey, [
        [BODY_PART_BY_ROLE[roleKey], bodypartCount],
        [MOVE, bodypartCount],
    ]);

export const buildTestMember = (roleKey: TeamRoleKey) =>
    buildPlainMember(roleKey, [
        [BODY_PART_BY_ROLE[roleKey], 1],
        [MOVE, 1],
    ]);

export const buildSquad = (...members: TeamMemberConfig[]) => members;

export const buildDuo = (
    leftMember: TeamMemberConfig,
    rightMember: TeamMemberConfig,
) => buildSquad(leftMember, rightMember);

export const buildFour = (
    leftMember: TeamMemberConfig,
    rightMember: TeamMemberConfig,
) => buildSquad(leftMember, leftMember, rightMember, rightMember);

export const buildMixed = (
    leftFrontline: TeamMemberConfig,
    rightFrontline: TeamMemberConfig,
    healerMember: TeamMemberConfig,
) => buildSquad(leftFrontline, rightFrontline, healerMember, healerMember);

export const buildXFour = (member: TeamMemberConfig) =>
    buildSquad(member, member, member, member);
