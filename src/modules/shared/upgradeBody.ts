import { buildRushUpgraderBody } from '@/modules/shared/rush';

/**
 * 升级工体型生成（非 rush 路径）。
 * 算法与冲级期共用同一实现（`buildRushUpgraderBody`），
 * 避免两条升级工体格口径各自漂移：
 * - 基础 1W1C1M（200）起步；
 * - CARRY 增长门为容量比 `(CARRY_CAPACITY×carry)/work < carryRatio`；
 * - move 在 work/move >= 4 时补一格机动；
 * - 其余预算全部换成 WORK（升级主力）；
 * - maxWork 为 WORK 部件上限（定编缺口），达到即停。
 *
 * @returns bodypart 配置数组（[[WORK, n], …]），空数组表示预算不足以起步
 */
export function buildUpgraderBodyConfig(
    energyCapacity: number,
    maxWork: number,
    carryRatio = 1,
): ((BodyPartConstant | number)[])[] {
    return buildRushUpgraderBody(energyCapacity, { maxWork, carryRatio }) ?? [];
}
