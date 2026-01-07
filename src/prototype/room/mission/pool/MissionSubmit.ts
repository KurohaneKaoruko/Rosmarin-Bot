/**
 * 任务提交
 */
export default class MissionSubmit extends Room {
    // 提交运输任务
    submitTransportMission(id: Task['id'], amount: TransportTask['amount']) {
        const task = this.getMissionFromPoolById('transport', id);
        if (!task) return;
        amount = (task.data as TransportTask).amount - amount;
        if (amount < 0) amount = 0;
        
        const deleteFunc = (taskdata: TransportTask) =>{
            if(taskdata.amount <= 0) return true;
            return false;
        }

        this.submitMission('transport', id, {amount} as any, deleteFunc);
        return OK;
    }

    // 提交孵化任务
    submitSpawnMission(id: Task['id']) {
        const task = this.getMissionFromPoolById('spawn', id);
        if (!task) return;
        const role = task.data.memory.role;
        this.deleteMissionFromPool('spawn', id);

        if (!global.SpawnMissionNum) global.SpawnMissionNum = {};
        if (!global.SpawnMissionNum[this.name]) global.SpawnMissionNum[this.name] = {};
        if (!global.SpawnMissionNum[this.name][role]) global.SpawnMissionNum[this.name][role] = 0;
        global.SpawnMissionNum[this.name][role] = global.SpawnMissionNum[this.name][role] - 1;
        if (global.SpawnMissionNum[this.name][role] < 0) global.SpawnMissionNum[this.name][role] = 0;
        return OK;
    }
}