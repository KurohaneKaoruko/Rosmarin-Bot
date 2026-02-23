/**
 * 任务更新主模块
 * @description 以固定频率调度各类任务更新入口（spawn/transport/manage/work/mine 等）
 */
import { isTickAligned } from '@/modules/infra/qos';
import { getRoomData } from '@/modules/utils/memory';

export default class Mission extends Room {    
    declare UpdateSpawnMission: (offset?: number) => void;
    declare UpdateTransportMission: (offset?: number) => void;
    declare UpdateBoostMission: (offset?: number) => void;
    declare UpdateManageMission: (offset?: number) => void;
    declare UpdateBuildRepairMission: (offset?: number) => void;
    declare UpdateWallRepairMission: (offset?: number) => void;
    declare TransportMissionCheck: () => void;
    declare BuildRepairMissionCheck: () => void;
    declare UpdateMineMission: () => void;
    declare UpdateHighwayScan: () => void;

    /**
     * 任务更新主循环
     * @description 按 interval/offset 分帧调度各子模块更新，降低单 tick CPU 峰值
     */
    MissionUpdate() {
        const mode = (getRoomData(this.name) as any)?.mode || (this.memory as any).mode;
        const highMode = mode === 'high';
        const spawnInterval = highMode ? 5 : 10;
        const transportInterval = highMode ? 10 : 20;

        const schedule: Array<{ interval: number; offset: number; run: (offset: number) => void }> = [
            { interval: spawnInterval, offset: 0, run: (offset) => this.UpdateSpawnMission(offset) },
            { interval: transportInterval, offset: 1, run: (offset) => this.UpdateTransportMission(offset) },
            { interval: 20, offset: 2, run: (offset) => this.UpdateBoostMission(offset) },
            { interval: 30, offset: 3, run: (offset) => this.UpdateManageMission(offset) },
            { interval: 50, offset: 4, run: (offset) => this.UpdateBuildRepairMission(offset) },
            { interval: 50, offset: 5, run: (offset) => this.UpdateWallRepairMission(offset) },
            { interval: 100, offset: 6, run: (_) => this.TransportMissionCheck() },
            { interval: 200, offset: 7, run: (_) => this.BuildRepairMissionCheck() },
            { interval: 1, offset: 0, run: (_) => this.UpdateMineMission() },
            { interval: 1, offset: 0, run: (_) => this.UpdateHighwayScan() },
        ];

        for (const item of schedule) {
            if (isTickAligned(item.interval, item.offset)) item.run(item.offset);
        }
    }
}
