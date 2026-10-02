/**
 * 诊断自采样落盘：每 30t 把 race 采样与运行状态写入 Memory 专用键，
 * 外部工具纯 GET Memory 读取，不经 console（eval 编译在引擎侧留残留，线性吃内存）。
 */
import { getRoomMode } from '@/modules/shared/roomMode';

// RCL 总进度表（level index → 升到该级所需累计进度点的近似口径，供看门狗显示）
const RCL_BARS = [0, 0, 200, 45000, 135000, 405000, 1215000, 3645000, 10935000];

export const writeDiagDumps = (): void => {
    if (Game.time % 30 !== 0) return;
    const memAny = Memory as any;
    for (const room of Object.values(Game.rooms)) {
        const race = (Memory.rooms as any)?.[room.name]?.race;
        if (!race) continue;
        memAny.__raceDump = JSON.stringify(race);
        const controller = room.controller;
        if (controller?.my) {
            const spawns = Object.values(Game.spawns).filter((s) => s.pos.roomName === room.name);
            const census: Record<string, number> = {};
            for (const creep of Object.values(Game.creeps)) {
                const role = (creep.memory as any).role || '?';
                census[role] = (census[role] || 0) + 1;
            }
            memAny.__wd = JSON.stringify({
                spawns: spawns.length,
                spawnRooms: spawns.map((s) => s.pos.roomName),
                creeps: Object.keys(Game.creeps).length,
                time: Game.time,
                wc: Date.now(),
                level: controller.level,
                progress: controller.progress,
                progressMax: (controller as any).progressMax || RCL_BARS[controller.level + 1] || 0,
                race: { baseline: race.baseline, levels: race.levels },
                cpuLimit: Game.cpu.limit,
                mode: getRoomMode(room),
                energyState: (room.memory as any).energyState,
                building: (room.memory as any).building,
                upgradersStarved: (room.memory as any).upgradersStarved,
                census,
            });
        }
        break;
    }
};
