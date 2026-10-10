import { log } from '@/modules/utils';
import { MISSION_POOLS } from '@/constant/MissionConstant';
import { isRoleId, ROLES, RoleData, type RoleId } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';
import { GenCreepName } from '@/modules/utils';
import { decompressBodyConfig } from '@/modules/shared/compress';
import { getRoomData } from '@/modules/shared/memory';
import { getRoomModeProfile } from '@/modules/shared/roomMode';
import { isEnergyCheckEnabled } from '@/modules/shared/gameCapabilities';
import { isRoomTickAligned } from '@/modules/shared/roomPhase';
import { drawSpawnInfo } from '@/modules/shared/roomVisuals';
const getRoomMode = (room: Room) => {
    return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
};

const getEnergyState = (room: Room) =>
    room.memory.energyState || room.updateEnergyState?.(false);

// 仅这些角色允许在低能量时按当前可用能量降级体型。
// worker 不降级：W1 建造力（5 hits/t）只有满编的一半，
// 订单等满编身体即可。
// 外矿工作位（carrier/harvester 远端分身）**不在其列**：远程体型由 remoteBody 生成器精心设计
// （采集工自带 CARRY 自补），按旧分档表缩水会产出零 CARRY 的废体型——
// 采集工 harvest 永远 ERR_FULL、白占编制。孵不起就排队等能量：
// 它们的队列优先级(level 12)天然让位于本地角色(worker 8)，本地编制吃满后
// 能量会攒到Extensions，远程 mission 随之孵出；真正的饥荒期远程转暗本身合理
// （外矿经济的容量门槛另见 externalMine.REMOTE_ECONOMY_MIN_CAPACITY）。
const EMERGENCY_DOWNSIZE_ROLES = new Set<string>([ROLES.harvester, ROLES.transporter, ROLES.carrier, ROLES.manager]);
const EMERGENCY_RECOVERY_UNIVERSAL_BODY: BodyPartConstant[] = [WORK, CARRY, MOVE];
const DOWNGRADED_LOGISTICS_ROLE_SET = new Set<RoleId>([ROLES.transporter, ROLES.carrier, ROLES.manager]);

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
        const normalBody = this.GenerateBodys(this.GetRoleBodys(ROLES.universal), ROLES.universal);
        if (normalBody?.length && this.CalculateEnergy(normalBody) <= this.energyAvailable) return normalBody;
        if (this.energyAvailable < THRESHOLDS.SPAWN.MIN_ENERGY) return null;
        return [...EMERGENCY_RECOVERY_UNIVERSAL_BODY];
    }

    private trySpawnEmergencyUniversal(spawn: StructureSpawn, blockedRole = 'recovery', referenceCost = 300) {
        // 应急孵化收窄（仅卡死场景介入，用户裁定口径）：三者同时成立才触发——
        // ① spawn 满仓 ≥300（到顶不再变化）；② 场上没有可给 spawn 填充能量的搬运工，
        // 或没有可供搬运的能量；③ 孵化队列中的关键 creep 在当前能量下孵化不出。
        // 落地排队阶段（任务可孵/管线排队中）一律走正常孵化管线，不抢跑。
        if (spawn.energy < spawn.energyCapacity) return false;

        let hasFillableCarrier = false;
        for (const c of Object.values(Game.creeps)) {
            const m = (c.memory || {}) as any;
            if (m.role !== ROLES.carrier || m.home !== this.name || c.spawning) continue;
            if ((c.store[RESOURCE_ENERGY] || 0) > 0) { hasFillableCarrier = true; break; }
        }
        const haulableEnergy =
            (Game.rooms[this.name]?.container || []).some(c => (c.store[RESOURCE_ENERGY] || 0) > 0) ||
            ((Game.rooms[this.name]?.find(FIND_DROPPED_RESOURCES, {
                filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY,
            }) || []) as Resource[]).length > 0;
        if (hasFillableCarrier && haulableEnergy) return false;
        if (referenceCost <= this.energyAvailable) return false;

        const creepNum = this.getCreepNum();
        const spawnMissionNum = this.getSpawnMissionNum() || {};
        const transporterNum = (creepNum[ROLES.transporter] || 0) + (spawnMissionNum[ROLES.transporter] || 0);
        const carrierNum = (creepNum[ROLES.carrier] || 0) + (spawnMissionNum[ROLES.carrier] || 0);
        const harvesterNum = (creepNum[ROLES.harvester] || 0) + (spawnMissionNum[ROLES.harvester] || 0);

        const spawnBootstrap = (role: RoleId, body: BodyPartConstant[]) => {
            const result = spawn.spawnCreep(
                body,
                GenCreepName(RoleData[role].code),
                { memory: { role, home: this.name, cache: {} } as CreepMemory }
            );
            if (result !== OK) return false;
            creepNum[role] = (creepNum[role] || 0) + 1;
            log(`房间 ${this.name} 应急孵化 ${role}（能量 ${this.energyAvailable}）。`);
            return true;
        };

        // rush 开局经济 = 定点矿工/搬运/升级三种 creep：
        // 判定只看场上活体（池内挂单可能永远付不起，不算补给）——
        // 无活体矿工先补矿工重启收入，有活体矿工才补搬运收掉落
        if (getRoomMode(this) === 'rush') {
            const aliveHarvesters = creepNum[ROLES.harvester] || 0;
            if (aliveHarvesters > 0 && (creepNum[ROLES.carrier] || 0) < 4) {
                return spawnBootstrap(ROLES.carrier, [CARRY, CARRY, MOVE, MOVE]);
            }
            if (aliveHarvesters === 0) {
                return this.energyAvailable >= 200
                    ? spawnBootstrap(ROLES.harvester, [WORK, WORK, MOVE, MOVE])
                    : spawnBootstrap(ROLES.harvester, [WORK, MOVE]);
            }
            return false;
        }

        // 冷启动（lv1 零进度且全场无 creep）：首孵 [W2,M2] 静态矿工（收入优先），不用 UNIV
        const coldStart = this.controller?.level === 1
            && (this.controller?.progress || 0) === 0
            && Object.keys(Game.creeps).length === 0;
        if (coldStart) {
            if (harvesterNum === 0) return spawnBootstrap(ROLES.harvester, [WORK, WORK, MOVE, MOVE]);
            return false;
        }

        // 停场恢复：采集/搬运断档时补 UNIV
        const universalBody = this.getEmergencyRecoveryUniversalBody();
        if (!universalBody || universalBody.length <= 0) return false;
        const bodyCost = this.CalculateEnergy(universalBody);
        if (bodyCost <= 0 || bodyCost > this.energyAvailable) return false;
        if ((creepNum[ROLES.universal] || 0) >= this.getEmergencyUniversalCap()) return false;

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
            GenCreepName(RoleData[ROLES.universal].code),
            { memory: { role: ROLES.universal, home: this.name, cache: {} } as CreepMemory }
        );
        if (result2 !== OK) return false;

        creepNum[ROLES.universal] = (creepNum[ROLES.universal] || 0) + 1;
        log(`房间 ${this.name} 因 ${blockedRole} 卡住或断档，已紧急孵化 universal 进行恢复。`);
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
        drawSpawnInfo(this.spawn);
    }

    GetSpawnTaskData() {
        const task = this.getSpawnMission();
        if (!task) return;

        const data = task.data as SpawnTask;
        const role = data.memory.role;

        if (!isRoleId(role)) {
            this.deleteMissionFromPool(MISSION_POOLS.spawn, task.id);
            return null;
        }

        const state = getEnergyState(this);
        const resolved = this.resolveBodyConfig(role, data, state);
        const bodypart = this.GenerateBodys(resolved.body, role);
        if (!bodypart?.length) {
            this.deleteMissionFromPool(MISSION_POOLS.spawn, task.id);
            return null;
        }

        const cost = this.CalculateEnergy(bodypart);
        // 不做容量钳制/缩容（参考实现 requestCreep 口径：任务原样排队，孵不孵引擎裁决）。
        // 常规服体型生成 ≤ 容量，无影响；特殊规则服（无限能量 spawn）大体型按原样直孵

        if (!data.memory.cache) data.memory.cache = {};

        updateDowngradedFlag(this, role, data, cost, resolved.usedBudget, state);

        const name = GenCreepName(data.name || RoleData[role].code);

        return {
            bodypart,
            name,
            memory: data.memory,
            taskId: task.id,
            cost,
            poolTask: task,
        };
    }

    /** 任务体型的解析与决策：字符串解压 / rush 升级分级表 / 预算缩水三分支归一 */
    private resolveBodyConfig(
        role: RoleId,
        data: SpawnTask,
        state: string,
    ): { body: ((BodyPartConstant | number)[][]); usedBudget: boolean } {
        let usedBudget = false;
        let body: ((BodyPartConstant | number)[])[] | string = data.body;
        // rush 升级：按当前可用能量走分级表（与孵化端同口径，防零余量死锁）
        if (role === ROLES.upgrader && getRoomMode(this) === 'rush') {
            body = this.GetRoleBodys(ROLES.upgrader, false, this.energyAvailable);
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
        return { body, usedBudget };
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
            // energyCheck 关闭时校验孵化真实启动：引擎可能吞单（OK 但 spawning 未启动）。
            // 幻单不消耗挂单，退池 30t 后重试——只消耗真正孵得出来的
            if (!isEnergyCheckEnabled() && !spawn.spawning && !Game.creeps[data.name]) {
                const poolTask = (data as any).poolTask as any;
                if (poolTask) poolTask.phantomRetryAt = Game.time + 30;
                return;
            }
            finishSpawnTask(this, role, data.taskId);
            return;
        }
        // energyCheck 关闭：可孵性由引擎裁决，本轮失败直接重试，不进停摆处理
        if (!isEnergyCheckEnabled()) return;

        if (!isRoomTickAligned(this.name, 10)) return;
        // 能量足以支付本 tick 孵化：不会进入停摆处理
        if (data.cost <= this.energyAvailable) return;
        // 远程投资类角色（out-* / reserver）孵不起就静默排队等能量：
        // 不缩水体（会产出零 CARRY 废体型）、也不代孵 universal（挤占编制）。
        // 它们的队列优先级天然低于本地角色，本地需求总是先被满足。
        if (role.startsWith('out-') || role === ROLES.reserver) return;
        // 低能量期预算小体型重试（仅 EMERGENCY_DOWNSIZE 角色）
        const state = getEnergyState(this);
        if ((state === 'LOW' || state === 'CRITICAL') && EMERGENCY_DOWNSIZE_ROLES.has(role)) {
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
                    log(`房间 ${this.name} 不足以孵化目标体型 ${role}，已按当前能量孵化缩小体型。`);
                    return;
                }
            }
        }
        this.trySpawnEmergencyUniversal(spawn, role, data.cost);
    }
}
