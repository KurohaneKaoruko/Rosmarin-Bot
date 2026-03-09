import { RoleData } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';
import { GenCreepName } from '@/utils';
import { decompressBodyConfig } from '@/modules/utils/compress';
import { getRoomData } from '@/modules/utils/memory';

const getRoomMode = (room: Room) => {
    return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
};

// 仅这些角色允许在低能量时按当前可用能量降级体型，避免 upgrader/worker 等被误降级。
const EMERGENCY_DOWNSIZE_ROLES = new Set(['harvester', 'transport', 'carrier', 'manager']);
const EMERGENCY_RECOVERY_UNIVERSAL_BODY: BodyPartConstant[] = [WORK, CARRY, MOVE];


export default class SpawnControl extends Room {
    private getEmergencyUniversalCap() {
        const mode = getRoomMode(this);
        const highMode = mode === 'high' || mode === 'rush';
        return this.level <= 2
            ? (highMode ? THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL1_2_HIGH : THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL1_2)
            : this.level === 3
                ? (highMode ? THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL3_HIGH : THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL3)
                : (highMode ? THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL4P_HIGH : THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL4P);
    }

    private getEmergencyRecoveryUniversalBody() {
        const normalBody = this.GenerateBodys(this.GetRoleBodys('universal'), 'universal');
        if (normalBody && normalBody.length > 0) {
            const normalCost = this.CalculateEnergy(normalBody);
            if (normalCost <= this.energyAvailable) return normalBody;
        }
        if (this.energyAvailable >= THRESHOLDS.SPAWN.MIN_ENERGY) {
            return [...EMERGENCY_RECOVERY_UNIVERSAL_BODY];
        }
        return null;
    }

    private trySpawnEmergencyUniversal(spawn: StructureSpawn, blockedRole = 'recovery', referenceCost = 300) {
        const universalBody = this.getEmergencyRecoveryUniversalBody();
        if (!universalBody || universalBody.length <= 0) return false;

        const bodyCost = this.CalculateEnergy(universalBody);
        if (bodyCost <= 0 || bodyCost > this.energyAvailable) return false;

        const creepNum = this.getCreepNum();
        const spawnMissionNum = this.getSpawnMissionNum() || {};
        const transportNum = (creepNum['transport'] || 0) + (spawnMissionNum['transport'] || 0);
        const carrierNum = (creepNum['carrier'] || 0) + (spawnMissionNum['carrier'] || 0);
        const harvesterNum = (creepNum['harvester'] || 0) + (spawnMissionNum['harvester'] || 0);
        const universalNum = creepNum['universal'] || 0;
        if (universalNum >= this.getEmergencyUniversalCap()) return false;

        const compareCost = Math.max(referenceCost, bodyCost);
        const storedEnergy =
            (this.storage?.store[RESOURCE_ENERGY] || 0) +
            (this.terminal?.store[RESOURCE_ENERGY] || 0);
        if (storedEnergy > compareCost * 10) {
            if (transportNum !== 0) return false;
        } else if ((this[RESOURCE_ENERGY] || 0) + this.energyAvailable > compareCost) {
            if (carrierNum !== 0) return false;
        } else {
            if (harvesterNum !== 0 && carrierNum !== 0) return false;
        }

        const result = spawn.spawnCreep(
            universalBody,
            GenCreepName(RoleData['universal'].code),
            { memory: { role: 'universal', home: this.name, cache: {} } as CreepMemory }
        );
        if (result !== OK) return false;

        creepNum['universal'] = (creepNum['universal'] || 0) + 1;
        global.log(`房间 ${this.name} 因 ${blockedRole} 卡住或断档，已紧急孵化 universal 进行恢复。`);
        return true;
    }

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
            const allowBudgetSpawn =
                (state === 'LOW' || state === 'CRITICAL') &&
                EMERGENCY_DOWNSIZE_ROLES.has(role);
            const budget = allowBudgetSpawn ? this.energyAvailable : undefined;
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
        if (!data) {
            const controllerDowngradeUrgent =
                !!this.controller?.my &&
                (this.controller.ticksToDowngrade || 0) < THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TTD;
            if (this.CheckSpawnAndTower() || controllerDowngradeUrgent) {
                this.trySpawnEmergencyUniversal(spawn);
            }
            return;
        }

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
            const allowEmergencyDownsize = EMERGENCY_DOWNSIZE_ROLES.has(role);
            if (!allowEmergencyDownsize) {
                this.trySpawnEmergencyUniversal(spawn, role, data.cost);
                return;
            }

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
            this.trySpawnEmergencyUniversal(spawn, role, data.cost);
        }
    }
}
