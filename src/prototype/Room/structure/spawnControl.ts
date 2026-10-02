import { isRoleId, RoleData, type RoleId } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';
import { GenCreepName } from '@/utils';
import { decompressBodyConfig } from '@/modules/shared/compress';
import { getRoomData } from '@/modules/shared/memory';
import { getRoomModeProfile } from '@/modules/shared/roomMode';
import { isRoomTickAligned } from '@/modules/shared/roomPhase';
const getRoomMode = (room: Room) => {
    return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
};

const getEnergyState = (room: Room) =>
    room.memory.energyState || room.updateEnergyState?.(false);

// 仅这些角色允许在低能量时按当前可用能量降级体型。
// worker 不降级：W1 建造力（5 hits/t）只有满编的一半，
// 订单等满编身体即可。
// out-harvest / out-carry **不在其列**：远程体型由 remoteBody 生成器精心设计
// （采集工自带 CARRY 自补），按旧分档表缩水会产出零 CARRY 的废体型——
// 采集工 harvest 永远 ERR_FULL、白占编制。孵不起就排队等能量：
// 它们的队列优先级(level 12)天然让位于本地角色(worker 8)，本地编制吃满后
// 能量会攒到Extensions，远程 mission 随之孵出；真正的饥荒期远程转暗本身合理
// （外矿经济的容量门槛另见 externalMine.REMOTE_ECONOMY_MIN_CAPACITY）。
const EMERGENCY_DOWNSIZE_ROLES = new Set(['harvester', 'transporter', 'carrier', 'manager']);
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
        const creepNum = this.getCreepNum();
        const spawnMissionNum = this.getSpawnMissionNum() || {};
        const transporterNum = (creepNum['transporter'] || 0) + (spawnMissionNum['transporter'] || 0);
        const carrierNum = (creepNum['carrier'] || 0) + (spawnMissionNum['carrier'] || 0);
        const harvesterNum = (creepNum['harvester'] || 0) + (spawnMissionNum['harvester'] || 0);

        const spawnBootstrap = (role: 'harvester' | 'carrier', body: BodyPartConstant[]) => {
            const result = spawn.spawnCreep(
                body,
                GenCreepName(RoleData[role].code),
                { memory: { role, home: this.name, cache: {} } as CreepMemory }
            );
            if (result !== OK) return false;
            creepNum[role] = (creepNum[role] || 0) + 1;
            global.log(`房间 ${this.name} 应急孵化 ${role}（能量 ${this.energyAvailable}）。`);
            return true;
        };

        // rush 开局经济 = 定点矿工/搬运/升级三种 creep：
        // 判定只看场上活体（池内挂单可能永远付不起，不算补给）——
        // 无活体矿工先补矿工重启收入，有活体矿工才补搬运收掉落
        if (getRoomMode(this) === 'rush') {
            const aliveHarvesters = creepNum['harvester'] || 0;
            if (aliveHarvesters > 0 && (creepNum['carrier'] || 0) < 4) {
                return spawnBootstrap('carrier', [CARRY, CARRY, MOVE, MOVE]);
            }
            if (aliveHarvesters === 0) {
                return this.energyAvailable >= 200
                    ? spawnBootstrap('harvester', [WORK, WORK, MOVE, MOVE])
                    : spawnBootstrap('harvester', [WORK, MOVE]);
            }
            return false;
        }

        // 冷启动（lv1 零进度且全场无 creep）：首孵 [W2,M2] 静态矿工（收入优先），不用 UNIV
        const coldStart = this.controller?.level === 1
            && (this.controller?.progress || 0) === 0
            && Object.keys(Game.creeps).length === 0;
        if (coldStart) {
            if (harvesterNum === 0) return spawnBootstrap('harvester', [WORK, WORK, MOVE, MOVE]);
            return false;
        }

        // 停场恢复：采集/搬运断档时补 UNIV
        const universalBody = this.getEmergencyRecoveryUniversalBody();
        if (!universalBody || universalBody.length <= 0) return false;
        const bodyCost = this.CalculateEnergy(universalBody);
        if (bodyCost <= 0 || bodyCost > this.energyAvailable) return false;
        if ((creepNum['universal'] || 0) >= this.getEmergencyUniversalCap()) return false;

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

        const result2 = spawn.spawnCreep(
            universalBody,
            GenCreepName(RoleData['universal'].code),
            { memory: { role: 'universal', home: this.name, cache: {} } as CreepMemory }
        );
        if (result2 !== OK) return false;

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
        // rush 升级：按当前可用能量走分级表（与孵化端同口径，防零余量死锁）
        if (role === 'upgrader' && getRoomMode(this) === 'rush') {
            body = this.GetRoleBodys('upgrader', false, this.energyAvailable);
        }
        if (typeof body === 'string' && body) {
            body = decompressBodyConfig(body);
        } else if (!body || !Array.isArray(body) || body.length === 0) {
            // worker 不参与预算缩水：LOW 窗口缩出的 W1 建造力低会拖慢
            // 工期——等满编身体，不要小件
            const allowBudgetSpawn =
                (state === 'LOW' || state === 'CRITICAL') &&
                EMERGENCY_DOWNSIZE_ROLES.has(role);
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
        // 每 tick 处理孵化：5-tick 对齐门在能量充足期造成孵化空闲窗口
        //（爬虫孵化 12-45t + 门 5t = 20-40% 空转），rush 下 CPU 充裕不需要省
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
            // 远程投资类角色（out-* / reserver）孵不起就静默排队等能量：
            // 不缩水体（会产出零 CARRY 废体型）、也不代孵 universal（挤占编制）。
            // 它们的队列优先级天然低于本地角色，本地需求总是先被满足。
            if (role.startsWith('out-') || role === 'reserver') return;

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
