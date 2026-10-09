// season8 覆盖：自动建造的道路工地裁剪。
// 共享 autoBuild 已移除该逻辑，这里以「前置钩」形式补回（低等级全清、赛季房按 RCL 封顶），
// 其余自动建造流程仍走共享实现。
import { getRoomData } from '@/modules/shared/memory';

const isSeason8Room = (room: Room): boolean => {
    const roomCfg = (getRoomData() as any)?.[room.name];
    return !!roomCfg?.season8Enabled || (global as any).Season8Active === true;
};

/**
 * 道路工地裁剪：
 * - RCL ≤ 3：全部清除（低等级道路无收益）；
 * - 赛季房 RCL4 封顶 1 条、RCL5 封顶 2 条，超出部分按进度从低到高裁掉。
 */
export const trimSeason8RoadSites = (room: Room): void => {
    const roadSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_ROAD,
    });

    if (room.level <= 3) {
        for (const site of roadSites) site.remove();
        return;
    }

    if (!isSeason8Room(room)) return;

    let cap: number | null = null;
    if (room.level === 4) cap = 1;
    else if (room.level === 5) cap = 2;
    if (cap === null) return;
    if (roadSites.length <= cap) return;

    roadSites.sort((a, b) => (b.progress || 0) - (a.progress || 0));
    for (let i = cap; i < roadSites.length; i++) {
        roadSites[i].remove();
    }
};
