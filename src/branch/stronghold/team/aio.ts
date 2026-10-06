/**
 * 要塞服一体机小队配置：全员同规格（远攻+治疗一体），任意存活子集仍是完整战力。
 *
 * - 体型口径：T 抗伤在前，R/H 居中，M 收尾（部件按序承损，治疗与机动最后损失）
 * - 无 boost（N 后缀）：要塞服不做强化，成员出生即战力
 * - 键名后缀 /9 = 三方阵，/4 = 四人队；ATK 旗短名自动补全
 */
import { member, registerTeamConfig } from '@/modules/features/Team/config/TeamConfig';

// 均衡：单体 150 输出 / 180 治疗
const AIO = member('T10R15H15M10N');
// 重奶：单体 100 输出 / 240 治疗，对高塔密集目标换生存
const AIOH = member('T10R10H20M10N');
// 重输出：单体 250 输出 / 60 治疗，对低级目标快拆
const AIOD = member('T10R25H5M10N');

registerTeamConfig({
    'AIO/9': Array(9).fill(AIO),
    'AIO/4': Array(4).fill(AIO),
    'AIOH/9': Array(9).fill(AIOH),
    'AIOH/4': Array(4).fill(AIOH),
    'AIOD/9': Array(9).fill(AIOD),
    'AIOD/4': Array(4).fill(AIOD),
});
