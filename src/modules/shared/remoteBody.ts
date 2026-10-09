import { ROLES } from '@/constant/CreepConstant';
/**
 * 外矿爬体型生成（按可用能量容量最大化，替代固定分档）。
 *
 * - 采集工：WORK 优先补到 5（单矿满速 10/tick），move 保持 move/work ≥ 0.5 的机动，
 *   自带 1 CARRY 自补；容量不足时自然收敛到小体型（预算内能孵多大孵多大）。
 * - 搬运工：整组扩展（走路段 [C,C,M]，越野 [C,M]），CARRY 最大化。
 */
const WORK_COST = 100;
const CARRY_COST = 50;
const MOVE_COST = 50;

/** 接力模式单程携带上限：小体型快周转（controller 等级 < 7） */
export const RELAY_HAULER_CARRY_SIZE = 4;
/** 直运模式单程携带上限（controller 等级 >= 7，基础设施成熟） */
export const DIRECT_HAULER_CARRY_SIZE = 32;

type BodyConfig = ((BodyPartConstant | number)[])[];

export function buildRemoteMinerBody(
    energyCapacity: number,
    maxWork = 5,
    needCarry = true,
    speed = 0.5,
): BodyConfig {
    let spent = MOVE_COST;
    let work = 0;
    let move = 1;
    let carry = 0;
    if (needCarry) {
        carry = 1;
        spent += CARRY_COST;
    }

    const canAdd = (partCost: number) => spent + partCost <= energyCapacity && work + move + carry + 1 <= MAX_CREEP_SIZE;

    while (spent < energyCapacity && work + move + carry < MAX_CREEP_SIZE) {
        if (work < 5 && work < maxWork && canAdd(WORK_COST)) {
            work += 1;
            spent += WORK_COST;
            continue;
        }
        if ((move === 0 || move / work < speed) && canAdd(MOVE_COST)) {
            move += 1;
            spent += MOVE_COST;
            continue;
        }
        const desiredCarry = work >= 5 && needCarry ? Math.ceil((4 * work * 2) / 50) : carry;
        if (carry < desiredCarry && canAdd(CARRY_COST)) {
            carry += 1;
            spent += CARRY_COST;
            continue;
        }
        if (maxWork > 0 && work >= maxWork) break;
        if (canAdd(WORK_COST)) {
            work += 1;
            spent += WORK_COST;
            continue;
        }
        break;
    }

    if (work <= 0) return [];
    const body: (BodyPartConstant | number)[][] = [[WORK, work], [MOVE, move]];
    if (carry > 0) body.push([CARRY, carry]);
    return body;
}

export function buildHaulerBodyConfig(
    energyCapacity: number,
    options: { forRoad?: boolean; maxCarry?: number } = {},
): BodyConfig {
    const { forRoad = false, maxCarry = 32 } = options;
    const group: BodyPartConstant[] = forRoad ? [CARRY, CARRY, MOVE] : [CARRY, MOVE];
    const groupCost = forRoad ? 150 : 100;
    const carryPerGroup = forRoad ? 2 : 1;
    const maxGroups = Math.min(
        Math.floor((MAX_CREEP_SIZE) / group.length),
        Math.floor(maxCarry / carryPerGroup),
        Math.floor(energyCapacity / groupCost),
    );
    if (maxGroups <= 0) return [];

    const body: (BodyPartConstant | number)[][] = [];
    for (let i = 0; i < maxGroups; i += 1) {
        for (const part of group) {
            body.push([part, 1]);
        }
    }
    return body;
}

/**
 * 外矿建造工体型：[W2, C1, M1] 整组扩展（300/组）。
 *
 * - WORK 占半：建造/维修的主力；CARRY 自取能量（容器/掉落/工地旁）；M 半数保证
 *   无路平原的远程机动；
 * - RoleData[ROLES['out-build']].bodypart 是空数组且 RoleLevelData 无分级表——不传显式
 *   体型时 GetRoleBodys 解析出空 body，孵化端按「无法孵化」永久跳过
 *   （race 实测：外矿路网工地铺满却没有一只建造工）。
 */
export function buildOutBuildBody(energyCapacity: number): BodyConfig {
    const groupCost = WORK_COST * 2 + CARRY_COST + MOVE_COST;
    const maxGroups = Math.min(
        Math.floor(MAX_CREEP_SIZE / 4),
        Math.floor(energyCapacity / groupCost),
    );
    if (maxGroups <= 0) return [];
    return [[WORK, maxGroups * 2], [CARRY, maxGroups], [MOVE, maxGroups]];
}
