/** 移动优化模块同步运行时 */
import { syncAvoidRooms, autoDiscoverObservers } from '@/modules/infra/moveOptimization';

export const MoveOptModule = {
    end: function() {
        if (Game.time % 10 !== 0) return;

        // 更新 avoidRooms 数组
        syncAvoidRooms(Memory['bypassRooms'] || []);

        // 更新 Observer 列表
        autoDiscoverObservers();
    }
};
