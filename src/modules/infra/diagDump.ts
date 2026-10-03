/**
 * 诊断自采样落盘：每 30t 把 race 采样与运行状态写入 Memory 专用键，
 * 外部工具纯 GET Memory 读取，不经 console（eval 编译在引擎侧留残留，线性吃内存）。
 */
import { getRoomMode } from '@/modules/shared/roomMode';
import { getOutMineData } from '@/modules/shared/memory';

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
                race: {
                    baseline: race.baseline,
                    levels: race.levels,
                    segments: race.segments ?? null,
                    failed: race.failed ?? false,
                    failedSegment: race.failedSegment ?? null,
                },
                // 容器/工地布点：核验控制器侧容器去重与布局容器落位
                containers: (room.container || []).map((c) => [c.pos.x, c.pos.y]),
                sites: (room.find(FIND_MY_CONSTRUCTION_SITES) as ConstructionSite[])
                    .map((s) => `${s.structureType}@${s.pos.x},${s.pos.y}`),
                cpuLimit: Game.cpu.limit,
                mode: getRoomMode(room),
                energyState: (room.memory as any).energyState,
                building: (room.memory as any).building,
                upgradersStarved: (room.memory as any).upgradersStarved,
                census,
            });
            // 外矿交付链快照：容器/落地能量/工地，定位「舰队空转、能量不回家」
            const targets = getOutMineData()?.[room.name]?.energy ?? [];
            // carrier 状态快照：FSM/取货缓存/停车，定位游荡与断供
            const carriers = Object.values(Game.creeps)
                .filter((c) => c.room.name === room.name && (c.memory as any).role === 'carrier')
                .map((c) => {
                    const mem = c.memory as any;
                    const cache = mem.cache ?? {};
                    return {
                        n: c.name.slice(-6),
                        x: c.pos.x,
                        y: c.pos.y,
                        flow: mem.fsm?.['carrier:flow'] ?? '-',
                        work: mem.working ?? '-',
                        load: c.store.getUsedCapacity(RESOURCE_ENERGY) || 0,
                        src: cache.carrierSourceKind ?? '-',
                        park: mem._parkPos ? 1 : 0,
                    };
                });
            memAny.__carrierDump = JSON.stringify({ time: Game.time, carriers });
            // 孵化池角色分布 + 外矿准入预算数字
            const poolRoles: Record<string, number> = {};
            for (const task of (room.getAllMissionFromPool?.('spawn') ?? []) as any[]) {
                const role = task?.data?.memory?.role || '?';
                poolRoles[role] = (poolRoles[role] || 0) + 1;
            }
            let liveLocal = 0;
            let liveRemote = 0;
            for (const creep of Object.values(Game.creeps)) {
                const role = (creep.memory as any).role || '';
                if (role.startsWith('out-') || role === 'reserver') liveRemote += creep.body.length;
                else liveLocal += creep.body.length;
            }
            const outMineState = (Memory as any).OutMineData ?? null;
            memAny.__om = JSON.stringify({
                time: Game.time,
                pool: poolRoles,
                carryTrace: (global as any).__carryTrace ?? [],
                budget: {
                    capacity: Math.max(1, (room.spawn || []).length) * 500,
                    liveLocal,
                    liveRemote,
                    sourceTiming: (room.memory as any).sourceTiming ?? null,
                },
                outMineData: outMineState,
                targets: targets.slice(0, 6).map((tn: string) => {
                    const tr = Game.rooms[tn];
                    if (!tr) return { room: tn, visible: false };
                    const containers = tr.find(FIND_STRUCTURES, { filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER }) as StructureContainer[];
                    const sources = tr.find(FIND_SOURCES);
                    const dropped = sources.reduce((sum, s) =>
                        sum + s.pos.findInRange(FIND_DROPPED_RESOURCES, 2)
                            .reduce((a, d) => a + (d.resourceType === RESOURCE_ENERGY ? d.amount : 0), 0), 0);
                    const sites = tr.find(FIND_MY_CONSTRUCTION_SITES);
                    return {
                        room: tn,
                        containers: containers.length,
                        containerEnergy: containers.reduce((a, c) => a + (c.store.energy || 0), 0),
                        dropped,
                        sites: sites.length,
                        siteTypes: Object.entries(_.countBy(sites, (s: ConstructionSite) => s.structureType)),
                    };
                }),
            });
        }
        break;
    }
};
