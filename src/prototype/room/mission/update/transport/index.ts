import { UpdateEnergyMission } from './energy';
import { UpdateLabMission, UpdateLabBoostMission } from './lab';
import { UpdatePowerMission } from './power';
import { UpdateNukerMission } from './nuker';

// 更新运输任务
function UpdateTransportMission(room: Room) {
    const storage = room.storage;
    if(!storage) return;

    UpdateEnergyMission(room);
    UpdatePowerMission(room);
    UpdateLabMission(room);
    UpdateLabBoostMission(room);
    UpdateNukerMission(room);
}

// 检查任务是否有效
function TransportMissionCheck(room: Room) {
    const checkFunc = (task: Task) => {
        // 如果任务被锁定，检查锁定是否有效，无效则解锁
        if(task.lock) {
            const creep = Game.getObjectById(task.bindCreep) as Creep;
            const mission = creep?.memory?.mission;
            if(!creep || !mission || mission?.id !== task.id) {
                task.lock = false;
                task.bindCreep = null;
            }
        };
        // 检查目标是否有效
        const data = task.data as TransportTask
        const source = Game.getObjectById(data.source) as any;
        const target = Game.getObjectById(data.target) as any;;
        if(!source || !target) return false;
        return target.store.getFreeCapacity(data.resourceType) > 0 && data.amount > 0;
    }

    room.checkMissionPool('transport', checkFunc);
}

export {
    UpdateTransportMission,
    TransportMissionCheck,
}
