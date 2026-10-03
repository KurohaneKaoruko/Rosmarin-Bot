import LayoutPlanner from "@/modules/features/Planner/layoutPlanner"
import { getLayoutData, getRoomData } from "@/modules/shared/memory";
import { getRoomMode } from "@/modules/shared/roomMode";



export default class AutoBuild extends Room {
    // 自动建筑
    autoBuild() {
        if (Game.cpu.bucket < 100) return;

        // 无源房不自动建造（能力闸，常规房零影响）：
        // 没有能量产出源的房间，工地永远无人完工，只会白占 CPU 与掉落衰减
        if (!(this.source || []).length) return;

        if (Game.time % 100 !== (this.memory['index']||0)) return;

        // 开启了自动建造, 且有布局Memory, 则自动建筑
        const memory = getRoomData()[this.name];
        const layoutMemory = getLayoutData(this.name);

        // mini 迷你房：无布局（或上一版误写的 63auto）时自动生成迷你房布局（buildMini），
        // 并确保自动建造开启；ext 走常规布局落位
        const staleLayout = (memory as any)?.layout === '63auto';
        if (getRoomMode(this) === 'mini' && (staleLayout || !layoutMemory || Object.keys(layoutMemory).length === 0)) {
            if (LayoutPlanner.buildMini(this.name, { quiet: true }) === OK) {
                if (memory) memory.autobuild = true;
            }
        }

        if (memory && memory.autobuild && layoutMemory &&
            Object.keys(layoutMemory).length) {
            // RCL1 不放任何建筑（参考实现开局口径）：200 点升级量的关键窗口期，
            // 产能全额直供升级线（worker 无工地即换班升级），RCL2 起再铺基建
            if (this.level >= 2) {
                LayoutPlanner.plannerCreateSite(this, layoutMemory, { maxSites: 10 });
            }
        }

        // 关键建筑造rampart
        if (this.level < 7) return;
        const structures = this.getStructures() || [];
        for (const s of ['spawn', 'tower', 'storage', 'terminal', 'factory', 'lab', 'nuker', 'powerSpawn']) {
            let structs = structures.filter((o) => o.structureType == s);
            for (const struct of structs) {
                if (!struct||!struct.pos) continue;
                const S = struct.pos.lookFor(LOOK_STRUCTURES);
                // 已有rampart则跳过
                if (S.some((o:any) => o.structureType == 'rampart')) continue;
                this.createConstructionSite(struct.pos.x, struct.pos.y, 'rampart');
            }
        }
    }
}
