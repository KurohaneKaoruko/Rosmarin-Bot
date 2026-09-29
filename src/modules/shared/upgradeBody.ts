/**
 * 升级工体型生成：按可用能量容量逐部件扩展，
 * 一次孵出「当前能孵的最大体型」，而不是固定分档的小体型。
 *
 * 规则：
 * - 基础 1W1C1M（200）起步；
 * - carry 保持 carry/work < carryRatio（升级工贴着控制器升级，carry 少量自补）；
 * - move 在 work/move >= 4 时补一格机动；
 * - 其余预算全部换成 WORK（升级主力）；
 * - maxWork 为 WORK 部件上限（定编缺口），达到即停。
 *
 * @returns bodypart 配置数组（[[WORK, n], [CARRY, n], [MOVE, n]]），空数组表示预算不足以起步
 */
export function buildUpgraderBodyConfig(
    energyCapacity: number,
    maxWork: number,
    carryRatio = 1,
): ((BodyPartConstant | number)[])[] {
    const cost = { work: BODYPART_COST[WORK], carry: BODYPART_COST[CARRY], move: BODYPART_COST[MOVE] };
    let work = 1;
    let move = 1;
    let carry = 1;
    let spent = cost.work + cost.carry + cost.move;

    const canAdd = (part: 'work' | 'carry' | 'move') =>
        spent + cost[part] <= energyCapacity && work + move + carry + 1 <= MAX_CREEP_SIZE;

    while (energyCapacity > spent) {
        // carry 优先保持 carry/work < carryRatio（升级工 self-fill 少量能量）
        if (carry / Math.max(1, work) < carryRatio && canAdd('carry')) {
            carry += 1;
            spent += cost.carry;
            continue;
        }
        // move 保持机动（work/move >= 4 时补 move）
        if ((move === 0 || work / move >= 4) && canAdd('move')) {
            move += 1;
            spent += cost.move;
            continue;
        }
        // WORK 上限（定编缺口）达到即停
        if (maxWork > 0 && work >= maxWork) break;
        if (canAdd('work')) {
            work += 1;
            spent += cost.work;
            continue;
        }
        break;
    }

    if (work <= 0) return [];
    return [[WORK, work], [CARRY, carry], [MOVE, move]];
}
