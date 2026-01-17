import {UpdateBuildRepairMission,
        UpdateWallRepairMission,
        BuildRepairMissionCheck} from './update/work/index'
import {UpdateTransportMission,
        TransportMissionCheck} from './update/transport/index'
import {UpdateManageMission} from './update/manageMission'
import {UpdateSpawnMission} from './update/spawnMission'
import {UpdateMineMission, UpdateHighwayScan} from './update/work/mine'

/** 任务更新 */
export default class Mission extends Room {    
    MissionUpdate() {
        const schedule: Array<{ interval: number; offset: number; run: (room: Room) => void }> = [
            { interval: 10, offset: 0, run: UpdateSpawnMission },
            { interval: 20, offset: 0, run: UpdateTransportMission },
            { interval: 30, offset: 1, run: UpdateManageMission },
            { interval: 50, offset: 1, run: UpdateBuildRepairMission },
            { interval: 50, offset: 2, run: UpdateWallRepairMission },
            { interval: 100, offset: 2, run: TransportMissionCheck },
            { interval: 200, offset: 2, run: BuildRepairMissionCheck },
            { interval: 1, offset: 0, run: UpdateMineMission },
            { interval: 1, offset: 0, run: UpdateHighwayScan },
        ];

        for (const item of schedule) {
            if (Game.time % item.interval === item.offset) item.run(this);
        }
    }
}
