import { isRoleId, RoleData, RoleLevelData, type RoleId } from '@/constant/CreepConstant';
import { decompress, decompressBodyConfig } from '@/modules/shared/compress';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getRoomData } from '@/modules/shared/memory';
import { estimateRoomEnergyIncome, getUpgradeWorkTarget, getRoomMode, isUpgraderSpawnUrgent, UPGRADE_URGENT_SPAWN_LEVEL, UPGRADE_NEEDED_TTD } from '@/modules/shared/roomWorkforce';
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

        // 控制器容器水位的硬门/删单已移除：升级火力改由 roomWorkforce 的
        // 水位比例节流连续缩放（cc 低水位时火力平滑收缩至 25%，从不清零不删单——
        // 硬门+删单曾让升级单被反复删除、车队整装却无单可孵，RCL2 冻结 2k+ tick）。
        // cc 缺位的 boot 阶段由手填闭环（能量中枢 priority 5）接管供能。

        const creepNum = this.getCreepNum();
        const spawnMissionNum = this.getSpawnMissionNum();
        const context = createSpawnCheckContext(this, creepNum, spawnMissionNum);

        // 控制器容器的补给已并入 carrier 默认行为（cc 存量低于升级消耗节奏时，
        // carrier 自动把 extension 盈余搬去 cc——见 roomWorkforce.isControllerContainerThirsty
        // 与 carrier.ts 的取货分支），不再有专职涓流岗。
        // 历史教训：deficit 涓流不感知在途挂单，cc 长期空置 + 孵化忙碌时
        // 每轮 +1 永不封口，曾单局灌出 172 条 carrier 挂单。

        // 升级紧迫插队（对齐参考实现 UPGRADE_PRIORITY 语义）：
        // 实测收入超过在场升级火力（濒死个体不计）时，升级单插队到采集/搬运之前——
        // 收入涨火力涨的自适应闭环；控制器临近降级时无条件最优先（PREVENT_DOWNGRADE）。
        const roleOrder = Object.keys(RoleSpawnCheck);
        {
            const income = estimateRoomEnergyIncome(this);
            let upgradeFire = 0;
            for (const c of this.find(FIND_MY_CREEPS) as Creep[]) {
                if (c.memory.role !== 'upgrader' || c.spawning) continue;
                if ((c.ticksToLive || 1500) <= c.body.length * 3) continue;
                upgradeFire += c.getActiveBodyparts(WORK);
            }
            const preventDowngrade = (this.controller?.ticksToDowngrade ?? 1e9) < UPGRADE_NEEDED_TTD;
            if (preventDowngrade || income > upgradeFire) {
                const i = roleOrder.indexOf('upgrader');
                if (i > 0) {
                    roleOrder.splice(i, 1);
                    roleOrder.unshift('upgrader');
                }
            }
        }

        for (const role of roleOrder) {
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
                // 升级工体型：rush 按当前可用能量走 RCL 分级表（分级下探，保证随时能孵
                // ——满档体型会被建造/搬运的常态抽取压在成本线以下，零余量死锁）；
                // 非 rush 维持「按定编缺口 + 满容量」一次孵最大。
                let body = role === 'upgrader' && getRoomMode(this) === 'rush'
                    ? this.GetRoleBodys('upgrader', false, this.energyAvailable)
                    : role === 'upgrader'
                        ? buildUpgraderBodyConfig(this.energyCapacityAvailable, getUpgradeWorkTarget(this))
                        : '';
                // rush 升级体 = WORK 优先的静态堆：[W×N, C×Cn, M1]——站位由 carrier 手填，
                // C 缓冲让每次手填撑更久（削平等待空窗）；N/Cn 按预算自适应分配
                // （低级预算 WORK 优先，高预算 C 缓冲拉到 4）。分级表在低能量段只给 W2：
                // 6 只 W2 = 12W = 24e/t 封顶，卡死 RCL4→5。
                if (role === 'upgrader' && getRoomMode(this) === 'rush') {
                    const carryN = Math.min(4, Math.max(1, Math.floor(this.energyAvailable / 300)));
                    const workN = Math.max(1, Math.floor((this.energyAvailable - 50 - 50 * carryN) / 100));
                    body = [[WORK, workN], [CARRY, carryN], [MOVE, 1]] as ((BodyPartConstant | number)[])[];
                }
                // rush 开局（lv≤3）harvester 定点矿工化：无 CARRY 纯 [W×N, M1] 站桩连挖，
                // 掉落在工作位由 rush 常备 carrier 收取——mobile 自采自搬的运程空转
                // 会吃掉一半产出（attempt 23 实测 lv2→3 仅 5.5e/t，同预算定点翻倍）
                if (role === 'harvester' && getRoomMode(this) === 'rush' && this.level <= 3) {
                    const workN = Math.max(1, Math.floor((this.energyCapacityAvailable - 50) / 100));
                    body = [[WORK, workN], [MOVE, 1]] as ((BodyPartConstant | number)[])[];
                }
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
        const picked = pickSpawnMission(selection, allowWaitForPriorityEnergy, queueJumpAllowBelowLevel);
        if (!picked) return null;

        // 收入链连跑保险：外矿 8 房的 OH/OC 挂单每轮重铺（L4/L5 常驻海），
        // 升级单（L7）在严格优先级下永远轮不到——attempt 22 实测 RCL2 冻结 2k+ tick。
        // 连续 2 只收入链孵化后，升级单强制插队一次：收入链占 2/3 节拍，升级保 1/3，
        // 有界让位、双向不饿死（升级单不存在/孵不起时收入链照常连跑）。
        const memAny = this.memory as any;
        const pickedRole = (picked.data as any)?.memory?.role;
        if (picked.level >= 4 && picked.level <= 6 && (pickedRole === 'out-harvest' || pickedRole === 'out-carry')) {
            memAny.incomeChainRun = (memAny.incomeChainRun || 0) + 1;
        } else {
            memAny.incomeChainRun = 0;
            return picked;
        }
        if (memAny.incomeChainRun < 2) return picked;

        for (const task of tasks) {
            if ((task.data as any)?.memory?.role !== 'upgrader') continue;
            const required = this.getSpawnTaskRequiredEnergy(task, availableEnergy);
            if (required != null && required <= availableEnergy) {
                memAny.incomeChainRun = 0;
                return task;
            }
        }
        return picked;
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

