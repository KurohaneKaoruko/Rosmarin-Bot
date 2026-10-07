/**
 * Creep 工作控制
 */
import { shouldSkipCreepInEmergency } from '@/modules/infra/qos';

export const creepRunner = function (creep: Creep) {
    if (!creep || creep.spawning) return;
    if (!creep.memory.role) {
        creep.suicide();
        return;
    }

    // QoS emergency 熔断：按角色牺牲顺序表跳过执行。
    // 被冻结的 creep 原地待命，跳过的只是执行，不销毁不回收，桶回升后自动恢复。
    if (shouldSkipCreepInEmergency(creep.memory.role)) return;

    // Creep工作
    creep.exec();
}
