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
