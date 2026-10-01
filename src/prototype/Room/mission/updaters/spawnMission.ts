import { isRoleId, RoleData, RoleLevelData, type RoleId } from '@/constant/CreepConstant';
import { decompress, decompressBodyConfig } from '@/modules/shared/compress';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getRoomData } from '@/modules/shared/memory';
import { getUpgradeWorkTarget, getControllerCarryDeficit, getRoomMode, isUpgraderSpawnUrgent, UPGRADE_URGENT_SPAWN_LEVEL } from '@/modules/shared/roomWorkforce';
import { buildUpgraderBodyConfig } from '@/modules/shared/upgradeBody';
import { getDowngradedLogisticsCountByAssignedRoom, hasSoonDeadCreepByAssignedRoomRole } from '@/modules/shared/creepTickIndex';
import {
    pruneDelayedUpgraderSpawnMissions,
    pruneCriticalNonRecoveryMissions,
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
     * rush spawn 平衡（水位门）：控制器容器水位低于升级抽水速率 × 10-tick
     * 缓冲时，暂停升级孵化并清掉升级挂单，把 spawn 让给物流/建造层；
     * 仓库续上后自动恢复。分级下探后的升级单随时能孵，不受此门影响。
     *
     * @returns true 表示本 tick 升级孵化被暂停。
     */
    pauseRushUpgraderIfDepotStarved(): boolean {
        if (getRoomMode(this) !== 'rush') return false;
        const controller = this.controller;
        const container = (this.container || []).find(
            c => controller && c.pos.inRangeTo(controller.pos, 3),
        );
        // 没有控制器容器：早期阶段无静态冲级路线，不干预（走 extension 口径）
        if (!container) return false;

        const depot = container.store[RESOURCE_ENERGY] || 0;
        const drainRate = getUpgradeWorkTarget(this);
        if (drainRate <= 0) return false;
        // 水位低于抽水速率 × 10 tick 的缓冲：暂停升级孵化（物流优先补给）
        if (depot >= drainRate * 10) return false;

        // 仓库见底：清掉升级挂单（它们以固定成本占池，会让 L9 物流永远等不到窗口）
        const tasks = (this.getAllMissionFromPool('spawn') || []) as Task[];
        for (const task of tasks) {
            const taskData = task.data as SpawnTask;
            if (taskData?.memory?.role !== 'upgrader') continue;
            this.deleteMissionFromPool?.('spawn', task.id);
        }
        return true;
    }

    /**
     * spawn 更新入口
     * @description 按角色规则检查缺口并生成对应孵化任务
     * @returns true 表示已执行检查，false 表示不满足条件（例如无 spawn）
     */
    UpdateSpawnMission(offset = 0) {
        void offset;
        if (!this.spawn || this.spawn.length === 0) return false;
        pruneDelayedUpgraderSpawnMissions(this);
        // CRITICAL 复苏：清掉救援线（harvester/universal）以外的孵化积压，
        // 防止小爬流水线在能量枯竭期互相抢食（能量回升后此清理自动空转）
        pruneCriticalNonRecoveryMissions(this);

        // rush spawn 平衡：升级任务的成本线（分级体型 E{tier}）若高于
        // extension 常态水位，会与 L9 物流单互相卡位——升级单永远挂池、搬运/建造永久
        // 饿死、外矿断流、最后升级工灭绝（race 实测三连）。仓库（控制器容器）水位
        // 低于身位成本时暂停升级孵化并清掉挂单，把 spawn 让给物流层；容器续上后
        // 升级任务自动恢复——形成「仓库满 → 升级消耗 → 仓库空 → 物流补给」的自然轮转。
        const rushUpgraderPaused = this.pauseRushUpgraderIfDepotStarved();

        const creepNum = this.getCreepNum();
        const spawnMissionNum = this.getSpawnMissionNum();
        const context = createSpawnCheckContext(this, creepNum, spawnMissionNum);

        // rush：控制器容器专职搬运（升级端 maxWork
        // 每 tick 抽干容器，通用 carrier 的「非紧急才喂容器」口径喂不满）。
        // 每轮最多补 1 只涓流进场；level 9 = 插队层，让位升级工(7)/建造(8)。
        const controllerCarryMissing = getControllerCarryDeficit(this);
        if (controllerCarryMissing > 0) {
            this.SpawnMissionAdd(
                RoleData['carrier'].code,
                '',
                9,
                'carrier',
                { home: this.name, controllerCarry: true } as CreepMemory
            );
        }

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
                // rush 升级在仓库断粮期被暂停（见 pauseRushUpgraderIfDepotStarved）
                if (role === 'upgrader' && rushUpgraderPaused) continue;
                // 升级工体型：rush 按当前可用能量走 RCL 分级表（分级下探，保证随时能孵
                // ——满档体型会被建造/搬运的常态抽取压在成本线以下，零余量死锁）；
                // 非 rush 维持「按定编缺口 + 满容量」一次孵最大。
                const body = role === 'upgrader' && getRoomMode(this) === 'rush'
                    ? this.GetRoleBodys('upgrader', false, this.energyAvailable)
                    : role === 'upgrader'
                        ? buildUpgraderBodyConfig(this.energyCapacityAvailable, getUpgradeWorkTarget(this))
                        : '';
                // 缺口门：WORK 缺口×2 都填不满一个身位时不发单（防小缺口反复孵化空转）
                if (role === 'upgrader') {
                    const bodyWork = (body as ((BodyPartConstant | number)[])[])
                        .reduce((sum, [part, n]) => sum + (part === WORK ? Number(n) : 0), 0);
                    const deficit = Math.max(0, getUpgradeWorkTarget(this) - adjusted);
                    if (deficit * 2 < bodyWork) continue;
                }
                // 升级加急：水位/收入满足加急口径时，升级任务插到外矿流水线之前
                const level = role === 'upgrader' && isUpgraderSpawnUrgent(this)
                    ? UPGRADE_URGENT_SPAWN_LEVEL
                    : RoleData[role].level;
                this.SpawnMissionAdd(
                    RoleData[role].code,
                    body,
                    level,
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
        // rush 升级：按当前可用能量走分级表下探——固定满档体型（RCL4 = 1300 = 满容量）
        // 会被建造/搬运的常态抽取压死，extension 攒到成本线以下就永远孵不出
        if (role === 'upgrader' && getRoomMode(this) === 'rush') {
            body = this.GetRoleBodys('upgrader', false, energyAvailable);
        }
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

