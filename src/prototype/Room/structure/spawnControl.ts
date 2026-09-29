import { isRoleId, RoleData, type RoleId } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';
import { GenCreepName } from '@/utils';
import { decompressBodyConfig } from '@/modules/shared/compress';
import { getRoomData } from '@/modules/shared/memory';
import { getRoomModeProfile } from '@/modules/shared/roomMode';
import { isRoomTickAligned } from '@/modules/shared/roomPhase';
import { getMyConstructionSites } from '../mission/updaters/spawnRules';

const getRoomMode = (room: Room) => {
    return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
};

const getEnergyState = (room: Room) =>
    room.memory.energyState || room.updateEnergyState?.(false);

// 仅这些角色允许在低能量时按当前可用能量降级体型。
// worker 的预算体型单独由“存在建造需求”控制。
// out-harvest / out-carry 一并纳入：外矿是摆脱能量短缺的收入投资，
// 短缺期降体型继续跑（收入按比例下降），远好过等满仓能量——
// 本地角色会把涓流能量优先吃掉，大体型 mission 会长期孵不出来，外矿因此断档。
const EMERGENCY_DOWNSIZE_ROLES = new Set(['harvester', 'transporter', 'carrier', 'manager', 'out-harvest', 'out-carry']);
const EMERGENCY_RECOVERY_UNIVERSAL_BODY: BodyPartConstant[] = [WORK, CARRY, MOVE];
const DOWNGRADED_LOGISTICS_ROLE_SET = new Set<RoleId>(['transporter', 'carrier', 'manager']);

const getFullRoleBodyCost = (room: Room, role: RoleId, upbody?: boolean) => {
    const fullConfig = room.GetRoleBodys(role, upbody, undefined);
    const fullBody = room.GenerateBodys(fullConfig, role);
    return fullBody?.length ? room.CalculateEnergy(fullBody) : null;
};

const updateDowngradedFlag = (
    room: Room,
    role: RoleId,
    taskData: SpawnTask,
    cost: number,
    usedBudget: boolean,
    state = getEnergyState(room)
) => {
    if (!DOWNGRADED_LOGISTICS_ROLE_SET.has(role)) return;

    const fullCost = getFullRoleBodyCost(room, role, taskData.upbody) ?? cost;
    const isLowEnergy = state === 'LOW' || state === 'CRITICAL';

    if (usedBudget && isLowEnergy) {
        if (cost < fullCost) taskData.memory.downgraded = true;
        return;
    }

    if (state === 'NORMAL' || state === 'SURPLUS') {
        if (cost >= fullCost) delete (taskData.memory as any).downgraded;
    }
};

const getAvailableSpawn = (room: Room) => {
    const requireActive =
        room.level !== 8 &&
        room.spawn.length !== 1 &&
        room.spawn.length !== CONTROLLER_STRUCTURES['spawn'][room.level];

    return room.spawn.find((spawn) => !spawn.spawning && (!requireActive || spawn.isActive()));
};

const finishSpawnTask = (room: Room, role: RoleId, taskId: string) => {
    const creepNum = room.getCreepNum();
    creepNum[role] = (creepNum[role] || 0) + 1;
    room.submitSpawnMission(taskId);
};

export default class SpawnControl extends Room {

    private getEmergencyUniversalCap() {
        const highIntensity = getRoomModeProfile(this).highIntensity;
        if (this.level <= 2) {
            return highIntensity ? THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL1_2_HIGH : THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL1_2;
        }
        if (this.level === 3) {
            return highIntensity ? THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL3_HIGH : THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL3;
        }
        return highIntensity ? THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL4P_HIGH : THRESHOLDS.SPAWN.UNIV_EMERGENCY_CAP.RCL4P;
    }

    private getEmergencyRecoveryUniversalBody() {
        const normalBody = this.GenerateBodys(this.GetRoleBodys('universal'), 'universal');
        if (normalBody?.length && this.CalculateEnergy(normalBody) <= this.energyAvailable) return normalBody;
        if (this.energyAvailable < THRESHOLDS.SPAWN.MIN_ENERGY) return null;
        return [...EMERGENCY_RECOVERY_UNIVERSAL_BODY];
    }

    private trySpawnEmergencyUniversal(spawn: StructureSpawn, blockedRole = 'recovery', referenceCost = 300) {
        const universalBody = this.getEmergencyRecoveryUniversalBody();
        if (!universalBody || universalBody.length <= 0) return false;

        const bodyCost = this.CalculateEnergy(universalBody);
        if (bodyCost <= 0 || bodyCost > this.energyAvailable) return false;

        const creepNum = this.getCreepNum();
        const spawnMissionNum = this.getSpawnMissionNum() || {};
        const transporterNum = (creepNum['transporter'] || 0) + (spawnMissionNum['transporter'] || 0);
        const carrierNum = (creepNum['carrier'] || 0) + (spawnMissionNum['carrier'] || 0);
        const harvesterNum = (creepNum['harvester'] || 0) + (spawnMissionNum['harvester'] || 0);
        const universalNum = creepNum['universal'] || 0;
        if (universalNum >= this.getEmergencyUniversalCap()) return false;

        const compareCost = Math.max(referenceCost, bodyCost);
        const storedEnergy =
            (this.storage?.store[RESOURCE_ENERGY] || 0) +
            (this.terminal?.store[RESOURCE_ENERGY] || 0);
        if (storedEnergy > compareCost * 10) {
            if (transporterNum !== 0) return false;
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
        for (const spawn of this.spawn) {
            if (!spawn.spawning) continue;

            const creepMemory = Memory.creeps[spawn.spawning.name];
            const role = creepMemory?.role;
            if (!isRoleId(role)) {
                spawn.spawning.cancel();
                continue;
            }
            const code = RoleData[role].code;
            this.visual.text(
                `${code} 🕒${spawn.spawning.remainingTime}`,
                spawn.pos.x,
                spawn.pos.y,
                { align: 'center',
                  color: 'red',
                  stroke: '#ffffff',
                  strokeWidth: 0.05,
                  font: 'bold 0.32 inter' }
            );
        }
    }

    GetSpawnTaskData() {
        const task = this.getSpawnMission();
        if (!task) return;

        const data = task.data as SpawnTask;
        const role = data.memory.role;

        if (!isRoleId(role)) {
            this.deleteMissionFromPool('spawn', task.id);
            return null;
        }

        const state = getEnergyState(this);
        let usedBudget = false;
        let body: ((BodyPartConstant | number)[])[] | string = data.body;
        if (typeof body === 'string' && body) {
            body = decompressBodyConfig(body);
        } else if (!body || !Array.isArray(body) || body.length === 0) {
            const allowBudgetSpawn =
                ((state === 'LOW' || state === 'CRITICAL') &&
                EMERGENCY_DOWNSIZE_ROLES.has(role)) ||
                (role === 'worker' && getMyConstructionSites(this).length > 0);
            const budget = allowBudgetSpawn ? this.energyAvailable : undefined;
            usedBudget = budget !== undefined;
            body = this.GetRoleBodys(role, data.upbody, budget);
        }

        const bodypart = this.GenerateBodys(body, role);
        if (!bodypart?.length) {
            this.deleteMissionFromPool('spawn', task.id);
            return null;
        }

        const cost = this.CalculateEnergy(bodypart);
        if (cost > this.energyCapacityAvailable) {
            this.deleteMissionFromPool('spawn', task.id);
            return null;
        }

        if (!data.memory.cache) data.memory.cache = {};

        updateDowngradedFlag(this, role, data, cost, usedBudget, state);

        const name = GenCreepName(data.name || RoleData[role].code);

        return {
            bodypart,
            name,
            memory: data.memory,
            taskId: task.id,
            cost,
        };
    }

    SpawnCreep() {
        if (!isRoomTickAligned(this.name, 5)) return;
        if (this.energyAvailable < 200) return;

        const spawn = getAvailableSpawn(this);
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

        // 记录出生 tick：供 harvester 无缝换班的路程实测（spawnRules）使用
        data.memory.spawnTick = Game.time;
        const result = spawn.spawnCreep(data.bodypart, data.name, { memory: data.memory });
        const role = data.memory.role;
        if (!isRoleId(role)) return;
        if (result === OK) {
            finishSpawnTask(this, role, data.taskId);
            return;
        }

        if (!isRoomTickAligned(this.name, 10)) return;
        // 处理停摆
        if (data.cost > this.energyAvailable) {
            const allowEmergencyDownsize = EMERGENCY_DOWNSIZE_ROLES.has(role);
            if (!allowEmergencyDownsize) {
                this.trySpawnEmergencyUniversal(spawn, role, data.cost);
                return;
            }

            const state = getEnergyState(this);
            if (state === 'LOW' || state === 'CRITICAL') {
                const config = this.GetRoleBodys(role, false, this.energyAvailable);
                const bodypart = this.GenerateBodys(config, role);
                const cost = this.CalculateEnergy(bodypart);
                if (bodypart.length > 0 && cost > 0 && cost <= this.energyAvailable) {
                    if (DOWNGRADED_LOGISTICS_ROLE_SET.has(role)) {
                        data.memory.downgraded = true;
                    }
                    const emergencyResult = spawn.spawnCreep(bodypart, GenCreepName(RoleData[role].code), { memory: data.memory });
                    if (emergencyResult === OK) {
                        finishSpawnTask(this, role, data.taskId);
                        global.log(`房间 ${this.name} 不足以孵化目标体型 ${role}，已按当前能量孵化缩小体型。`);
                        return;
                    }
                }
            }
            this.trySpawnEmergencyUniversal(spawn, role, data.cost);
        }
    }
}
