/**
 * 要塞服 ATK 攻击旗表层：旗名解析与派兵策略。
 *
 * 旗名协议：`ATK[/_孵化房][/_配置][/_N次数][/_T间隔]`（`/` 与 `_` 均可作分隔）。
 * - 目标 = 旗所在房间（旗插哪打到哪）
 * - 孵化房：旗名参数优先；缺省自动选取离旗最近的己方房
 * - 配置缺省 R29/9 九人三方阵；短名（如 R28）自动补全 /4、/2
 * - 次数缺省无限（N0 同义）；间隔缺省 0 = 孵化队列空闲即派
 * - 场上队伍上限 10 队
 */
import type { SpecProvider, TeamSpawnSpec } from '@/modules/features/Team/runtime/TeamSpawner';
import { TEAM_CONFIG } from '@/modules/features/Team/config/TeamConfig';

/** ATK 默认配置：九人三方阵（前排/中排远攻 + 后排治疗，要塞攻坚主力编队） */
export const ATK_DEFAULT_CONFIG = 'R29/9';
/** ATK 默认孵化间隔：0 = 无定时，孵化队列空闲即派下一队 */
export const ATK_DEFAULT_INTERVAL = 0;
/** ATK 同时存在的队伍上限 */
export const ATK_TEAM_CAP = 10;

/**
 * ATK 旗解析器（注册进 TeamSpawner 的表层旗型）。
 *
 * @remarks
 * - 目标 = 旗所在房间（旗插哪打到哪）。\n
 * - boost 缺货只等待不拆旗；主房无视野不拆旗。\n
 * - 配置不存在时拆旗并提示（防无效旗长留）。
 */
export const atkSpecProvider: SpecProvider = (flagName: string, flag: Flag): TeamSpawnSpec | undefined => {
    if (!/^ATK([/_].*)?$/.test(flagName)) return undefined;

    let spawnParam: string | undefined;
    let maxCount: number | undefined;
    let interval: number | undefined;
    const rest: string[] = [];
    for (const seg of flagName.slice(3).split(/[/_]/)) {
        if (!seg) continue;
        const n = seg.match(/^N(\d+)$/);
        if (n) { maxCount = parseInt(n[1]); continue; }
        const t = seg.match(/^T(\d+)$/);
        if (t) { interval = parseInt(t[1]); continue; }
        if (/^[EW]\d+[NS]\d+$/.test(seg)) { spawnParam ??= seg.toUpperCase(); continue; }
        rest.push(seg);
    }

    // 配置段拼回（'R28'+'4' → 'R28/4'）；无子段的短名自动补 /4、/2
    let config = rest.length ? rest.join('/') : ATK_DEFAULT_CONFIG;
    if (!TEAM_CONFIG[config] && !config.includes('/')) {
        config = TEAM_CONFIG[`${config}/4`] ? `${config}/4` : `${config}/2`;
    }
    if (!TEAM_CONFIG[config]) {
        console.log(`[ATK] ${flagName} 配置 ${config} 不存在（如 R29/9、R25/4、RH/4）`);
        flag.remove();
        delete Memory.flags[flagName];
        return undefined;
    }

    // 孵化房：旗名参数优先，否则离旗最近的己方房
    const myRooms = Object.values(Game.rooms).filter(r => r.my);
    let spawnRoomName = spawnParam;
    if (!spawnRoomName && myRooms.length) {
        spawnRoomName = myRooms
            .map(r => ({ name: r.name, dist: Game.map.getRoomLinearDistance(r.name, flag.pos.roomName) }))
            .sort((a, b) => a.dist - b.dist)[0].name;
    }

    return {
        kind: 'ATK',
        config,
        spawnRoomName,
        targetRoom: flag.pos.roomName,
        maxCount,
        interval: interval ?? ATK_DEFAULT_INTERVAL,
        noMaxIsInfinite: true,
        keepOnBoostShortage: true,
        keepOnMissingRoom: true,
        blockUnownedController: false,
        teamCap: ATK_TEAM_CAP,
    };
};
