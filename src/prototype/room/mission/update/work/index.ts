import { UpdateBuildRepairMission } from './buildRepair';
import { UpdateWallRepairMission, checkWallMission } from './wall';

// 检查任务是否有效
function BuildRepairMissionCheck(room: Room) {
    const checkFunc = (task: Task) => {
        const {target, hits} = task.data;
        const structure = Game.getObjectById(target) as Structure | null;
        if(!structure) return false;
        if ((task.type === 'repair') &&
            structure.hits >= hits) return false;
        return true;
    }

    room.checkMissionPool('build', checkFunc);
    room.checkMissionPool('repair', checkFunc);

    checkWallMission(room);
}

export { 
    UpdateBuildRepairMission, 
    UpdateWallRepairMission, 
    BuildRepairMissionCheck 
}
