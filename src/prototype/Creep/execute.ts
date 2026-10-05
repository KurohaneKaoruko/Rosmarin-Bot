import { log } from '@/modules/utils';
import { getRoleHandler } from './action';
import { ensureMemoryCache } from './function/cacheFunction';
import { RoleData } from '@/constant/CreepConstant';

const creepExecuteErrorTickCache: Record<string, number> = {};

// 统一执行入口的错误日志：
// 同一类错误每 tick 只记一次，避免配置缺失时刷屏。
const reportExecuteIssue = (key: string, message: string) => {
    const tick = typeof Game !== 'undefined' && typeof Game.time === 'number' ? Game.time : -1;
    if (creepExecuteErrorTickCache[key] === tick) return;
    creepExecuteErrorTickCache[key] = tick;

    log(message);
};

export default class CreepExecute extends Creep {
    exec() {
        const role = this.memory.role;
        if (!role) return;
        const roledata = RoleData[role];
        if (!roledata) {
            reportExecuteIssue(
                `missing-role:${role}`,
                `[CreepExecute] 未找到角色 ${role} 的 RoleData 配置，当前 creep 将跳过执行。`
            );
            return;
        }

        // 新框架下，角色执行入口统一由 executor 字符串声明。
        // 这里不再区分旧的 work/action 模式，只根据统一 id 获取处理器。
        const executor = roledata.executor;
        if (!executor) {
            // 没有执行器绑定的角色直接跳过：
            return;
        }

        const handler = getRoleHandler(executor, (missingId) => {
            reportExecuteIssue(
                `missing-handler:${role}:${missingId}`,
                `[CreepExecute] 角色 ${role} 绑定的统一处理器 ${missingId} 不存在，请检查 RoleData.executor 与 roleRegistry 是否一致。`
            );
        });
        if (!handler) return;

        ensureMemoryCache(this.memory);

        // 角色自己的准备阶段（如 boost / 绑定初始化）已经收回到框架包装器内部，
        // 统一执行入口只负责把 creep 交给 handler.run。
        handler.run(this);
    }
}
