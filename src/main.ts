import '@/compat';               // 环境兼容垫片（必须保持首位：无 Power 玩法的服务器缺 PowerCreep 全局类）
import { createApp } from '@/framework/createApp';
import { PrototypeExtension } from '@/prototype';
import { ConsoleExtension } from '@/console';
import { EventModule } from '@/modules/EventModule';
import { ClearModule } from '@/modules/ClearModule';
import { GeneratePixel } from '@/modules/Pixel';
import { Statistics } from '@/modules/Statistics';
import { ResourceManage } from '@/modules/ResourceManage';
import { FunnelModule } from '@/modules/FunnelModule';
import { TeamModule } from '@/modules/TeamModule';
import { DDModule } from '@/modules/DDModule';
import { NukeModule } from '@/modules/NukeModule';
import { ExpandModule } from '@/modules/ExpandModule';
import { InterShardModule } from '@/modules/InterShardModule';
import { MoveModule } from '@/modules/MoveModule';

import '@/modules/infra/qos';    // QoS 全局挂载
import '@/modules/infra/BetterMove';    // creep移动优化
import '@/modules/infra/structureCache';  // 极致建筑缓存

PrototypeExtension();    // 原型拓展
ConsoleExtension();      // 控制台命令拓展

const App = createApp();

App.on(TeamModule);       // 小队模块
App.on(EventModule);      // 事件模块
App.on(ResourceManage);   // 资源调度管理
App.on(FunnelModule);     // 跨房能量漏斗
App.on(InterShardModule); // InterShardMemory 缓存与清理
App.on(ExpandModule);     // 跨 shard 扩张
App.on(NukeModule);       // 核弹打击
App.on(DDModule);         // 消息模块
App.on(ClearModule);      // 过期数据清理
App.on(Statistics);       // 统计数据
App.on(GeneratePixel);    // 搓像素
App.on(MoveModule);       // 移动模块

import { updateBucketGovernor } from '@/modules/infra/bucketGovernor';

export const loop = () => {
    // CPU 桶闭环：先更新外矿活跃阈值，再跑主循环（Tier 1-3）
    updateBucketGovernor();
    App.run();
    // 诊断自采样：外部工具只读（GET memory），不再经 console eval 写入
    //（每次 eval 编译在引擎侧留残留，线性吃外部内存直至 worker OOM）
    if (Game.time % 30 === 0) {
        const memAny = Memory as any;
        for (const room of Object.values(Game.rooms)) {
            const race = (Memory.rooms as any)?.[room.name]?.race;
            if (!race) continue;
            memAny.__raceDump = JSON.stringify(race);
            const controller = room.controller;
            if (controller?.my) {
                const spawns = Object.values(Game.spawns).filter((s) => s.pos.roomName === room.name);
                const BARS = [0, 0, 200, 45000, 135000, 405000, 1215000, 3645000, 10935000];
                memAny.__wd = JSON.stringify({
                    spawns: spawns.length,
                    spawnRooms: spawns.map((s) => s.pos.roomName),
                    creeps: Object.keys(Game.creeps).length,
                    time: Game.time,
                    wc: Date.now(),
                    level: controller.level,
                    progress: controller.progress,
                    progressMax: (controller as any).progressMax || BARS[controller.level + 1] || 0,
                    race: { baseline: race.baseline, levels: race.levels },
                });
            }
            break;
        }
    }
};
