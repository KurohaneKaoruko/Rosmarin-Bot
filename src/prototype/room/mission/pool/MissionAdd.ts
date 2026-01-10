import { RoleData } from '@/constant/CreepConstant'
import {decompressBodyConfig} from "@/utils";

/**
 * 任务添加模块
 */
export default class MissionAdd extends Room {
    // 添加搬运任务
    ManageMissionAdd(source: string, target: string, resourceType: any, amount: number) {
        // 将缩写转换为全名
        const RES = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS;
        if(RES[resourceType]) resourceType = RES[resourceType];
        // 将缩写转换为全名
        const structures = {
            s: 'storage',
            t: 'terminal',
            l: 'link',
            f: 'factory',
            p: 'powerSpawn'
        }
        if(source in structures) source = structures[source];
        if(target in structures) target = structures[target];

        if(!source || !target || !resourceType || !amount) return false;
        if(typeof amount !== 'number' || amount <= 0) return false;

        // 检查是否有相同任务
        let existingTaskId = this.checkSameMissionInPool('manage', 'manage', {source, target, resourceType} as ManageTask);
        if (existingTaskId) {
            // 如果存在相同任务，更新任务数据
            return this.updateMissionPool('manage', existingTaskId,
                {data:{source, target, resourceType, amount} as ManageTask});
        } else {
            // 如果不存在相同任务，添加新任务
            return this.addMissionToPool('manage', 'manage', 0, 
                {source, target, resourceType, amount} as ManageTask);
        }
    }

    // 添加发送任务
    SendMissionAdd(targetRoom: string, resourceType: string | ResourceConstant, amount: number) {
        // 将缩写转换为全名
        const RES = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS;
        if(RES[resourceType]) resourceType = RES[resourceType];
        // 检查是否有相同任务
        let existingTaskId = this.checkSameMissionInPool('terminal', 'send', {targetRoom, resourceType} as SendTask);
        if (existingTaskId) {
            // 如果存在相同任务，更新任务数据
            return this.updateMissionPool('terminal', existingTaskId,
                {data:{targetRoom, resourceType, amount} as SendTask});
        } else {
            // 如果不存在相同任务，添加新任务
            return this.addMissionToPool('terminal', 'send', 0, 
                {targetRoom, resourceType, amount} as SendTask);
        }
    }

    // 添加建造维修任务
    BuildRepairMissionAdd(type: 'build' | 'repair', level: number, data: BuildTask | RepairTask) {
        // 检查是否有相同任务
        let existingTaskId = this.checkSameMissionInPool(type, type, { target: data.target });
        if (existingTaskId) {
            // 如果存在相同任务，更新任务数据
            return this.updateMissionPool(type, existingTaskId, {level, data});
        } else {
            // 如果不存在相同任务，添加新任务
            return this.addMissionToPool(type, type, level, data);
        }
    }

    // 添加运输任务
    TransportMissionAdd(level: number, data: TransportTask) {
        // 检查是否有相同任务
        let existingTaskId = this.checkSameMissionInPool('transport', 'transport',
                    {source:data.source, target:data.target, resourceType:data.resourceType});
        if (existingTaskId) {
            // 如果存在相同任务，更新任务数据
            return this.updateMissionPool('transport', existingTaskId, {level, data});
        } else {
            // 如果不存在相同任务，添加新任务
            return this.addMissionToPool('transport', 'transport', level, data);
        }
    }

    // 添加孵化任务
    SpawnMissionAdd(name: string, body: any[] | string, level: number, role: string, memory?: CreepMemory, upbody?: boolean) {
        if (!RoleData[role]) {
            console.log(`role ${role} 不存在`);
            return -1;
        }
        
        if(level < 0) level = RoleData[role].level;
        let bodypart: BodyPartConstant[];
        let energy: number = 0;
        if (typeof body === 'string') {
            bodypart = this.GenerateBodys(decompressBodyConfig(body), role)
            energy = this.CalculateEnergy(bodypart);
        } else {
            bodypart = this.GenerateBodys(body, role);
            energy = this.CalculateEnergy(bodypart);
        }

        if(energy > this.energyCapacityAvailable) return -1;
        if(!memory) memory = {} as CreepMemory;
        memory.role = role;
        if (upbody === undefined) {
            this.addMissionToPool('spawn', 'spawn', level, {name, body, memory, energy})
        } else {
            upbody = upbody || false;
            this.addMissionToPool('spawn', 'spawn', level, {name, body, memory, energy, upbody})
        }
        if (!global.SpawnMissionNum) global.SpawnMissionNum = {};
        if (!global.SpawnMissionNum[this.name]) global.SpawnMissionNum[this.name] = {};
        if (!global.SpawnMissionNum[this.name][role]) global.SpawnMissionNum[this.name][role] = 0;
        global.SpawnMissionNum[this.name][role] = global.SpawnMissionNum[this.name][role] + 1;
        return OK;
    }

}
