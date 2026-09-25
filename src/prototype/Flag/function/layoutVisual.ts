import LayoutVisual from '@/modules/features/Planner/utils/layoutVisual';
import { getLayoutData } from '@/shared/memory';
import { decompressBatch } from '@/shared/compress';

export default class LayoutVisualFunction extends Flag {
    // layoutVisual 旗：持续显示所在房的布局预览（数据取自布局 memory，每 tick 重绘）
    handleLayoutVisualFlag(): boolean {
        if (this.name !== 'layoutVisual') return false;

        const layoutMemory = getLayoutData(this.pos.roomName);
        if (!layoutMemory || Object.keys(layoutMemory).length === 0) return false;

        const structMap: Record<string, any[]> = {};
        for (const s in layoutMemory) structMap[s] = decompressBatch(layoutMemory[s]);
        LayoutVisual.showRoomStructures(this.pos.roomName, structMap);
        return true;
    }
}
