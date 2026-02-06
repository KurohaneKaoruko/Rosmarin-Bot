import LayoutPlanner from "@/modules/feature/planner/layoutPlanner"
import { getLayoutData, getRoomData } from "@/modules/utils/memory";



export default class AutoBuild extends Room {
    // 自动建筑
    autoBuild() {
        if (Game.cpu.bucket < 100) return;
        
        if (Game.time % 100 !== (this.memory['index']||0)) return;

        // 开启了自动建造, 且有布局Memory, 则自动建筑
        const memory = getRoomData()[this.name];
        const layoutMemory = getLayoutData(this.name);
        if (memory && memory.autobuild && layoutMemory &&
            Object.keys(layoutMemory).length) {
            LayoutPlanner.plannerCreateSite(this, layoutMemory, { maxSites: 10 });
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
