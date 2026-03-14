import { RoleData } from '@/constant/CreepConstant'
import { decompressBodyConfig } from "@/modules/utils/compress";
import {
    SPAWN_MANAGED_ROLES,
    type SpawnManagedRole,
    createSpawnCheckContext,
    getAdjustedSpawnRoleCurrent,
    getDowngradeUniversalSpawnMissing,
    pruneDelayedUpgraderSpawnMissions,
    shouldSpawnRole,
} from './spawnMissionConditions';

/**
 * 房间孵化任务模块（spawn）
 * @description
 * - 根据房间状态与 RoleSpawnCheck 规则动态生成孵化任务
 * - 提供 SpawnMissionAdd 将孵化任务写入任务池，并失效 SpawnMissionNum 缓存
 */
export default class SpawnMission extends Room {
    private queueDefaultRoleSpawn(role: SpawnManagedRole) {
        return this.SpawnMissionAdd(
            RoleData[role].code,
            '',
            RoleData[role].level,
            role,
            { home: this.name } as CreepMemory
        );
    }

    /**
     * 为默认体型角色连续补齐缺口。
     * `universal` 在降级救急场景下可能一次补多个，这里集中处理。
     */
    private queueDefaultRoleSpawns(role: SpawnManagedRole, count: number) {
        for (let i = 0; i < count; i++) {
            this.queueDefaultRoleSpawn(role);
        }
    }

    /**
     * 复制 memory 并强制写入 role，避免调用方的对象被原地污染。
     */
    private createSpawnMemory(role: string, memory?: CreepMemory) {
        const nextMemory = memory
            ? { ...(memory as any) }
            : {} as CreepMemory;
        nextMemory.role = role;
        return nextMemory as CreepMemory;
    }

    /**
     * 将 body 配置解析为实际身体并计算能耗。
     * 字符串 body 代表压缩配置，空数组则交给 `GenerateBodys` 走动态体型逻辑。
     */
    private resolveSpawnBodyEnergy(
        role: string,
        body: ((BodyPartConstant | number)[])[] | string,
    ) {
        const bodyConfig = typeof body === 'string'
            ? decompressBodyConfig(body)
            : body;
        const bodypart = this.GenerateBodys(bodyConfig, role);
        return {
            bodypart,
            energy: this.CalculateEnergy(bodypart),
        };
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

        const context = createSpawnCheckContext(
            this,
            this.getCreepNum(),
            this.getSpawnMissionNum(),
        );

        for (const role of SPAWN_MANAGED_ROLES) {
            const current = getAdjustedSpawnRoleCurrent(context, role);
            if (role === 'universal') {
                const rescueMissing = getDowngradeUniversalSpawnMissing(this, current);
                if (rescueMissing > 0) {
                    this.queueDefaultRoleSpawns(role, rescueMissing);
                    continue;
                }
            }
            if (shouldSpawnRole(role, context, current)) {
                this.queueDefaultRoleSpawn(role);
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

        const taskMemory = this.createSpawnMemory(role, memory);
        if (level < 0) level = RoleData[role].level;

        const { energy } = this.resolveSpawnBodyEnergy(role, body);
        const taskData: SpawnTask = {
            name,
            body,
            memory: taskMemory,
            energy,
        };

        if (energy > this.energyCapacityAvailable) return -1;
        if (upbody === undefined) {
            this.addMissionToPool('spawn', 'spawn', level, taskData);
        } else {
            taskData.upbody = !!upbody;
            this.addMissionToPool('spawn', 'spawn', level, taskData);
        }
        return OK;
    }
}
