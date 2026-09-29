import { isRoleId, RoleData, RoleLevelData, type RoleId } from '@/constant/CreepConstant';
import { decompress, decompressBodyConfig } from '@/modules/shared/compress';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getRoomData } from '@/modules/shared/memory';
import { getDowngradedLogisticsCountByAssignedRoom, hasSoonDeadCreepByAssignedRoomRole } from '@/modules/shared/creepTickIndex';
import {
    pruneDelayedUpgraderSpawnMissions,
    createSpawnCheckContext,
    getAdjustedSpawnRoleCurrent,
    shouldSpawnRole,
    RoleSpawnCheck,
    getDowngradeUniversalSpawnMissing,
    getMyConstructionSites,
} from './spawnRules';

// 供测试与外部模块直接使用孵化判定入口（spawnMission 作为统一出口 re-export）
export {
    createSpawnCheckContext,
    getAdjustedSpawnRoleCurrent,
    shouldSpawnRole,
    RoleSpawnCheck,
    getDowngradeUniversalSpawnMissing,
    getMyConstructionSites,
    pruneDelayedUpgraderSpawnMissions,
} from './spawnRules';

export default class SpawnMission extends Room {
    /**
     * spawn 更新入口
     * @description 按角色规则检查缺口并生成对应孵化任务
     * @returns true 表示已执行检查，false 表示不满足条件（例如无 spawn）
     */
    UpdateSpawnMission(offset = 0) {
        void offset;
        if (!this.spawn || this.spawn.length === 0) return false;
        pruneDelayedUpgraderSpawnMissions(this);

        const creepNum = this.getCreepNum();
        const spawnMissionNum = this.getSpawnMissionNum();
        const context = createSpawnCheckContext(this, creepNum, spawnMissionNum);

        for (const role in RoleSpawnCheck) {
            const adjusted = getAdjustedSpawnRoleCurrent(context, role);
            if (role === 'universal') {
                const rescueMissing = getDowngradeUniversalSpawnMissing(this, adjusted);
                if (rescueMissing > 0) {
                    for (let i = 0; i < rescueMissing; i++) {
                        this.SpawnMissionAdd(
                            RoleData[role].code,
                            '',
                            RoleData[role].level,
                            role,
                            { home: this.name } as CreepMemory
                        );
                    }
                    continue;
                }
            }
            if (shouldSpawnRole(role, context, adjusted)) {
                this.SpawnMissionAdd(
                    RoleData[role].code,
                    '',
                    RoleData[role].level,
                    role,
                    { home: this.name } as CreepMemory
                );
            }
        }

        return true;
    }

    /**
     * 添加孵化任务（spawn）
     * @param name - 孵化任务标识（常用 RoleData[role].code）
     * @param body - 身体配置（数组或压缩字符串）
     * @param level - 任务优先级；<0 时使用默认等级
     * @param role - creep 角色
     * @param memory - creep memory（会克隆并写入 role）
     * @param upbody - 是否启用升级 body（可选）
     * @returns OK 表示入队成功，-1 表示失败
     */
    SpawnMissionAdd(name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, role: string, memory?: CreepMemory, upbody?: boolean) {
        if (!RoleData[role]) {
            console.log(`role ${role} 不存在`);
            return -1;
        }

        if (!memory) memory = {} as CreepMemory;
        else memory = { ...(memory as any) } as CreepMemory;
        memory.role = role;

        if (level < 0) level = RoleData[role].level;
        let bodypart: BodyPartConstant[];
        let energy = 0;
        if (typeof body === 'string') {
            bodypart = this.GenerateBodys(decompressBodyConfig(body), role);
            energy = this.CalculateEnergy(bodypart);
        } else {
            bodypart = this.GenerateBodys(body, role);
            energy = this.CalculateEnergy(bodypart);
        }

        if (energy > this.energyCapacityAvailable) return -1;

        if (upbody === undefined) {
            this.addMissionToPool('spawn', 'spawn', level, { name, body, memory, energy });
        } else {
            this.addMissionToPool('spawn', 'spawn', level, { name, body, memory, energy, upbody: !!upbody });
        }
        return OK;
    }
}

// ==================== Getter Helpers ====================
const SPAWN_GETTER_BUDGET_ROLES = new Set(['harvester', 'transporter', 'carrier', 'manager']);

const getSpawnTaskRole = (taskData?: SpawnTask): RoleId | null => {
    const role = taskData?.memory?.role;
    return isRoleId(role) ? role : null;
};

type SpawnMissionSelection = {
    highestPriority: number;
    firstAffordableAtHighestPriority: Task | null;
    cheapestBlockedAtHighestPriority: Task | null;
    cheapestBlockedEnergy: number;
    bestAffordableOverall: Task | null;
    bestAffordableOverallLevel: number;
};

const createSpawnMissionSelection = (): SpawnMissionSelection => ({
    highestPriority: Infinity,
    firstAffordableAtHighestPriority: null,
    cheapestBlockedAtHighestPriority: null,
    cheapestBlockedEnergy: Infinity,
    bestAffordableOverall: null,
    bestAffordableOverallLevel: Infinity,
});

const updateSpawnMissionSelection = (
    selection: SpawnMissionSelection,
    task: Task,
    requiredEnergy: number,
    availableEnergy: number
) => {
    const affordable = requiredEnergy <= availableEnergy;

    if (affordable && task.level < selection.bestAffordableOverallLevel) {
        selection.bestAffordableOverall = task;
        selection.bestAffordableOverallLevel = task.level;
    }

    if (task.level < selection.highestPriority) {
        selection.highestPriority = task.level;
        selection.firstAffordableAtHighestPriority = affordable ? task : null;
        selection.cheapestBlockedAtHighestPriority = affordable ? null : task;
        selection.cheapestBlockedEnergy = affordable ? Infinity : requiredEnergy;
        return;
    }

    if (task.level > selection.highestPriority) return;

    if (affordable) {
        selection.firstAffordableAtHighestPriority ??= task;
        return;
    }

    if (requiredEnergy < selection.cheapestBlockedEnergy) {
        selection.cheapestBlockedAtHighestPriority = task;
        selection.cheapestBlockedEnergy = requiredEnergy;
    }
};

const pickSpawnMission = (
    selection: SpawnMissionSelection,
    allowWaitForPriorityEnergy: boolean,
    queueJumpAllowBelowLevel: number
) => {
    if (selection.highestPriority === Infinity) return null;

    if (!allowWaitForPriorityEnergy) {
        return selection.bestAffordableOverall || selection.cheapestBlockedAtHighestPriority;
    }

    if (selection.firstAffordableAtHighestPriority) {
        return selection.firstAffordableAtHighestPriority;
    }

    if (
        selection.bestAffordableOverall &&
        selection.bestAffordableOverallLevel < queueJumpAllowBelowLevel
    ) {
        return selection.bestAffordableOverall;
    }

    return selection.cheapestBlockedAtHighestPriority;
};

export class SpawnTaskGetter extends Room {
    private getSpawnTaskRequiredEnergy(task: Task, energyAvailable: number): number | null {
        const data = task.data as SpawnTask;
        const role = getSpawnTaskRole(data);
        if (!role) return null;

        let body = data.body as ((BodyPartConstant | number)[])[] | string;
        const hasFixedBody = (typeof body === 'string' && !!body) || (Array.isArray(body) && body.length > 0);
        let requiredEnergy = Number(data.energy || 0);

        // 空 body 任务是动态体型，必须实时计算能耗；否则 energy=0 会错误抢占队首。
        if (!hasFixedBody) {
            const state = this.memory.energyState || this.updateEnergyState?.(false);
            const allowBudgetSpawn =
                ((state === 'LOW' || state === 'CRITICAL') &&
                SPAWN_GETTER_BUDGET_ROLES.has(role)) ||
                (role === 'worker' && getMyConstructionSites(this).length > 0);
            const budget = allowBudgetSpawn ? energyAvailable : undefined;
            body = this.GetRoleBodys(role, data.upbody, budget);
            const bodypart = this.GenerateBodys(body as any[], role);
            requiredEnergy = bodypart.length > 0 ? this.CalculateEnergy(bodypart) : Infinity;
        } else if (requiredEnergy <= 0) {
            const normalized = typeof body === 'string' ? decompressBodyConfig(body) : body;
            const bodypart = this.GenerateBodys(normalized as any[], role);
            requiredEnergy = bodypart.length > 0 ? this.CalculateEnergy(bodypart) : Infinity;
            data.energy = requiredEnergy;
        }

        return Number.isFinite(requiredEnergy) && requiredEnergy > 0 ? requiredEnergy : null;
    }

    getSpawnMission() {
        pruneDelayedUpgraderSpawnMissions(this);
        const availableEnergy = this.energyAvailable || 0;
        const allowWaitForPriorityEnergy = THRESHOLDS.SPAWN.ALLOW_WAIT_FOR_PRIORITY_ENERGY;
        const queueJumpAllowBelowLevel = THRESHOLDS.SPAWN.WAIT_ENERGY_QUEUE_JUMP_ALLOW_BELOW_LEVEL;
        const tasks = this.getAllMissionFromPool('spawn');
        const selection = createSpawnMissionSelection();

        for (const task of tasks) {
            if (!task || task.lock) continue;

            const requiredEnergy = this.getSpawnTaskRequiredEnergy(task, availableEnergy);
            if (requiredEnergy == null) continue;

            updateSpawnMissionSelection(selection, task, requiredEnergy, availableEnergy);
        }

        // 严格尊重优先级：只有最高优先级层没有能孵化的任务时，才等待该层；
        // 少数例外（例如停摆恢复 universal）仍由 SpawnControl 层处理。
        return pickSpawnMission(selection, allowWaitForPriorityEnergy, queueJumpAllowBelowLevel);
    }

    getSpawnMissionNum() {
        const roomAny = this as any;
        if (roomAny._spawnMissionNumCacheTick === Game.time) {
            return roomAny._spawnMissionNumCache || {};
        }

        const tasks = this.getAllMissionFromPool('spawn');
        const spawnMissionNum: Record<string, number> = {};
        for (const task of tasks) {
            const data = task.data as SpawnTask;
            const role = getSpawnTaskRole(data);
            if (!role) continue;
            spawnMissionNum[role] = (spawnMissionNum[role] || 0) + 1;
        }

        roomAny._spawnMissionNumCache = spawnMissionNum;
        roomAny._spawnMissionNumCacheTick = Game.time;
        return spawnMissionNum;
    }

    getSpawnMissionTotalByRoles(roles: string[]) {
        const tasks = this.getAllMissionFromPool('spawn');
        let num = 0;
        for (const task of tasks) {
            const data = task.data as SpawnTask;
            const role = getSpawnTaskRole(data);
            if (!role) continue;
            if (roles.includes(role)) num++;
        }
        return num;
    }
}
