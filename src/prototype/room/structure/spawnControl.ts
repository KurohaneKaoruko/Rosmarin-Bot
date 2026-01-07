import { RoleData } from '@/constant/CreepConstant';
import { decompressBodyConfig, GenCreepName } from '@/utils';

export default class SpawnControl extends Room {
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

        let body: ((BodyPartConstant | number)[])[] = data.body;
        if (typeof body == 'string' && body) {
            body = decompressBodyConfig(body);
        } else if (!body || !Array.isArray(body) || body.length == 0) {
            body = this.GetRoleBodys(role, data.upbody);
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
        if (this.energyAvailable < 250) return;

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
            if (!global.CreepNum) global.CreepNum = {};
            if (!global.CreepNum[this.name]) global.CreepNum[this.name] = {};
            global.CreepNum[this.name][role] = (global.CreepNum[this.name][role] || 0) + 1;
            this.submitSpawnMission(data.taskId);
            return;
        }

        if (Game.time % 10) return;
        // 处理停摆
        if (data.cost > this.energyAvailable) {
            if (role !== 'harvester' && role !== 'transport' && role !== 'carrier' && role !== 'manager') return;
            
            let T_num = 0, C_num = 0, H_num = 0, univ_num = 0;
            this.find(FIND_MY_CREEPS).forEach(c => {
                if (c.memory.role == 'transport') T_num++;
                if (c.memory.role == 'carrier') C_num++;
                if (c.memory.role == 'harvester') H_num++;
                if (c.memory.role == 'universal') univ_num++;
            })
            if (!global.SpawnMissionNum[this.name]) global.SpawnMissionNum[this.name] = {};

            if ((this.storage && this.storage.store[RESOURCE_ENERGY] > data.cost * 10) ||
                (this.terminal && this.terminal.store[RESOURCE_ENERGY] > data.cost * 10)) {
                if (T_num !== 0) return;
            } else if (this[RESOURCE_ENERGY] + this.energyAvailable > data.cost) {
                if (C_num !== 0) return;
            } else {
                if (H_num !== 0 && C_num !== 0) return;
            }
            
            univ_num += global.SpawnMissionNum[this.name]['universal'] || 0;
            if (univ_num >= 2) return;

            spawn.spawnCreep(
                this.GenerateBodys(RoleData['universal'].bodypart),
                GenCreepName(RoleData['universal'].code),
                { memory: { role: 'universal', home: this.name } as CreepMemory }
            );
            global.log(`房间 ${this.name} 没有且不足以孵化 ${role}，已紧急孵化 universal。`);
            
        }
    }
}
