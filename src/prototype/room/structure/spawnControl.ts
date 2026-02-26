import { RoleData } from '@/constant/CreepConstant';
import { GenCreepName } from '@/utils';
import { decompressBodyConfig } from '@/modules/utils/compress';



export default class SpawnControl extends Room {
    SpawnWork() {
        // 没有spawn时不处理
        if (!this.spawn) return;
        // 可视化孵化状态
        this.VisualSpawnInfo();
        // 孵化creep
        this.SpawnCreep();
    }

    VisualSpawnInfo() {
        this.spawn.forEach(spawn => {
            if (!spawn.spawning) return;
            
            const role = Memory.creeps[spawn.spawning.name]?.role;
            if (!role) {
                spawn.spawning.cancel();
                return;
            }
            const code = RoleData[role]?.code;
            this.visual.text(
                `${code} 🕒${spawn.spawning.remainingTime}`,
                spawn.pos.x,
                spawn.pos.y,
                { align: 'center',
                  color: 'red',
                  stroke: '#ffffff',
                  strokeWidth: 0.05,
                  font: 'bold 0.32 inter' }
            )
        })
    }

    GetSpawnTaskData() {
        const task = this.getSpawnMission();
        if (!task) return;

        const data = task.data as SpawnTask;
        let role = data.memory.role;

        if (!role) {
            this.deleteMissionFromPool('spawn', task.id);
            return null;
        }

        let usedBudget = false;
        let body: ((BodyPartConstant | number)[])[] | string = data.body;
        if (typeof body == 'string' && body) {
            body = decompressBodyConfig(body);
        } else if (!body || !Array.isArray(body) || body.length == 0) {
            const state = this.memory.energyState || this.updateEnergyState?.(false);
            const budget = state === 'LOW' || state === 'CRITICAL' ? this.energyAvailable : undefined;
            usedBudget = budget !== undefined;
            body = this.GetRoleBodys(role, data.upbody, budget);
        }

        const bodypart = this.GenerateBodys(body, role);
        if (!bodypart || bodypart.length == 0) {
            this.deleteMissionFromPool('spawn', task.id);
            return null;
        }

        const cost = this.CalculateEnergy(bodypart);
        if (cost > this.energyCapacityAvailable) {
            this.deleteMissionFromPool('spawn', task.id);
            return null;
        }

        if (!data.memory.cache) data.memory.cache = {};

        if (role === 'transport' || role === 'carrier' || role === 'manager') {
            const state = this.memory.energyState || this.updateEnergyState?.(false);
            if (usedBudget && (state === 'LOW' || state === 'CRITICAL')) {
                const fullConfig = this.GetRoleBodys(role, data.upbody, undefined);
                const fullBody = this.GenerateBodys(fullConfig, role);
                const fullCost = fullBody?.length ? this.CalculateEnergy(fullBody) : cost;
                if (cost < fullCost) data.memory.downgraded = true;
            } else if (state === 'NORMAL' || state === 'SURPLUS') {
                const fullConfig = this.GetRoleBodys(role, data.upbody, undefined);
                const fullBody = this.GenerateBodys(fullConfig, role);
                const fullCost = fullBody?.length ? this.CalculateEnergy(fullBody) : cost;
                if (cost >= fullCost) delete (data.memory as any).downgraded;
            }
        }

        let name = GenCreepName(data.name||RoleData[role].code);

        return {
            bodypart,
            name,
            memory: data.memory,
            taskId: task.id,
            cost
        }
    }

    SpawnCreep() {
        if (Game.time % 5) return;
        if (this.energyAvailable < 200) return;

        let spawn: StructureSpawn;
        if (this.level == 8 || this.spawn.length == 1) {
            spawn = this.spawn.find(s => !s.spawning);
        } else if (this.spawn.length == CONTROLLER_STRUCTURES['spawn'][this.level]) {
            spawn = this.spawn.find(s => !s.spawning);
        } else {
            spawn = this.spawn.find(s => !s.spawning && s.isActive());
        }
        if (!spawn) return;

        const data = this.GetSpawnTaskData();
        if (!data) return;

        const result = spawn.spawnCreep(data.bodypart, data.name, {memory: data.memory})
        let role = data.memory.role;
        if (result == OK) {
            // 成功孵化后更新房间内角色计数
            const creepNum = this.getCreepNum();
            creepNum[role] = (creepNum[role] || 0) + 1;
            this.submitSpawnMission(data.taskId);
            return;
        }

        if (Game.time % 10) return;
        // 处理停摆
        if (data.cost > this.energyAvailable) {
            if (role !== 'harvester' && role !== 'transport' && role !== 'carrier' && role !== 'manager') return;

            const state = this.memory.energyState || this.updateEnergyState?.(false);
            if (state === 'LOW' || state === 'CRITICAL') {
                const config = this.GetRoleBodys(role, false, this.energyAvailable);
                const bodypart = this.GenerateBodys(config, role);
                const cost = this.CalculateEnergy(bodypart);
                if (bodypart.length > 0 && cost > 0 && cost <= this.energyAvailable) {
                    if (role === 'transport' || role === 'carrier' || role === 'manager') {
                        data.memory.downgraded = true;
                    }
                    const emergencyResult = spawn.spawnCreep(bodypart, GenCreepName(RoleData[role].code), { memory: data.memory });
                    if (emergencyResult === OK) {
                        const creepNum = this.getCreepNum();
                        creepNum[role] = (creepNum[role] || 0) + 1;
                        this.submitSpawnMission(data.taskId);
                        global.log(`房间 ${this.name} 不足以孵化目标体型 ${role}，已按当前能量孵化缩小体型。`);
                        return;
                    }
                }
            }
            
            let T_num = 0, C_num = 0, H_num = 0, univ_num = 0;
            this.find(FIND_MY_CREEPS).forEach(c => {
                if (c.memory.role == 'transport') T_num++;
                if (c.memory.role == 'carrier') C_num++;
                if (c.memory.role == 'harvester') H_num++;
                if (c.memory.role == 'universal') univ_num++;
            })
            const spawnMissionNum = this.getSpawnMissionNum() || {};

            if ((this.storage && this.storage.store[RESOURCE_ENERGY] > data.cost * 10) ||
                (this.terminal && this.terminal.store[RESOURCE_ENERGY] > data.cost * 10)) {
                if (T_num !== 0) return;
            } else if (this[RESOURCE_ENERGY] + this.energyAvailable > data.cost) {
                if (C_num !== 0) return;
            } else {
                if (H_num !== 0 && C_num !== 0) return;
            }
            
            univ_num += spawnMissionNum['universal'] || 0;
            if (univ_num >= 2) return;

            spawn.spawnCreep(
                this.GenerateBodys(RoleData['universal'].bodypart),
                GenCreepName(RoleData['universal'].code),
                { memory: { role: 'universal', home: this.name, cache: {} } as CreepMemory }
            );
            global.log(`房间 ${this.name} 没有且不足以孵化 ${role}，已紧急孵化 universal。`);
            
        }
    }
}
