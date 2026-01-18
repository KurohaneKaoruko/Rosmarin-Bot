/**
 * 任务更新主模块
 * @description 以固定频率调度各类任务更新入口（spawn/transport/manage/work/mine 等）
 */
export default class Mission extends Room {    
    declare UpdateSpawnMission: () => void;
    declare UpdateTransportMission: () => void;
    declare UpdateManageMission: () => void;
    declare UpdateBuildRepairMission: () => void;
    declare UpdateWallRepairMission: () => void;
    declare TransportMissionCheck: () => void;
    declare BuildRepairMissionCheck: () => void;
    declare UpdateMineMission: () => void;
    declare UpdateHighwayScan: () => void;

    /**
     * 任务更新主循环
     * @description 按 interval/offset 分帧调度各子模块更新，降低单 tick CPU 峰值
     */
    MissionUpdate() {
        const schedule: Array<{ interval: number; offset: number; run: () => void }> = [
            { interval: 10, offset: 0, run: () => this.UpdateSpawnMission() },
            { interval: 20, offset: 0, run: () => this.UpdateTransportMission() },
            { interval: 30, offset: 1, run: () => this.UpdateManageMission() },
            { interval: 50, offset: 1, run: () => this.UpdateBuildRepairMission() },
            { interval: 50, offset: 2, run: () => this.UpdateWallRepairMission() },
            { interval: 100, offset: 2, run: () => this.TransportMissionCheck() },
            { interval: 200, offset: 2, run: () => this.BuildRepairMissionCheck() },
            { interval: 1, offset: 0, run: () => this.UpdateMineMission() },
            { interval: 1, offset: 0, run: () => this.UpdateHighwayScan() },
        ];

        for (const item of schedule) {
            if (Game.time % item.interval === item.offset) item.run();
        }
    }
}
