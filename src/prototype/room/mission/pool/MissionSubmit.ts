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

    // 提交mine任务
    submitMineMission(id: Task['id'], data: Partial<MineTask>) {
        const task = this.getMissionFromPoolById('mine', id);
        if (!task) return;
        
        // 合并数据
        const newData = { ...task.data, ...data };
        
        const deleteFunc = (taskdata: MineTask) => {
            // 如果被标记为非激活且没有特定条件保留，则可能需要删除
            // 但目前 mine 任务主要由 UpdateMineMission 管理生命周期，这里主要用于更新状态
            if (task.type === 'deposit' && (taskdata as DepositMineTask).active === false) {
                // 可以选择在这里删除，或者等待 UpdateMineMission 清理
                // 这里我们仅更新状态，让 UpdateMineMission 决定是否删除
                return false;
            }
            return false;
        }

        this.submitMission('mine', id, newData, deleteFunc);
        return OK;
    }
}