/**
 * 任务提交
 */
import { getMissionPools } from '@/modules/utils/memory';

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
        this.deleteMissionFromPool('spawn', id);
        return OK;
    }

    /**
     * 删除指定 role 的孵化任务
     * @description 用于防御结束后撤销未孵化的防御兵孵化队列，避免继续出兵浪费能量。
     */
    deleteSpawnMissionsByRole(roles: string[] | string): number {
        const roleSet = new Set(Array.isArray(roles) ? roles : [roles]);
        const pools = getMissionPools()?.[this.name];
        const tasks = pools?.spawn;
        if (!Array.isArray(tasks) || tasks.length === 0) return 0;

        let removed = 0;
        const remaining: Task[] = [];

        for (const task of tasks) {
            const data = task?.data as SpawnTask | undefined;
            const role = data?.memory?.role;
            if (role && roleSet.has(role)) {
                removed++;
                continue;
            }
            remaining.push(task);
        }

        pools.spawn = remaining as any;

        delete (this as any)._spawnMissionNumCache;
        delete (this as any)._spawnMissionNumCacheTick;
        return removed;
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
