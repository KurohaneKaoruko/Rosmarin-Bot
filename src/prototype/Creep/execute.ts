import { workRegistry, actionRegistry } from './action';
import { RoleData } from '@/constant/CreepConstant';

export default class CreepExecute extends Creep {
    exec() {
        const role = this.memory.role;
        const roledata = RoleData[role];
        if (!roledata) return;

        if (roledata.action) {
            const actionFunc = actionRegistry[roledata.action];
            if (actionFunc) {
                actionFunc.run(this);
            }
        } else if(roledata.work) {
            const func = workRegistry[roledata.work];
            if (!func) return;
            this.memory.cache = this.memory.cache || {}
            this.memory.cacheSource = this.memory.cacheSource || {}
            this.memory.cacheTarget = this.memory.cacheTarget || {}
            if (func.prepare && !this.memory.ready) {
                this.memory.ready = func.prepare(this);
            }

            const working = !!this.memory.working;
            const currentRunner = working ? func.target : func.source;
            const nextRunner = working ? func.source : func.target;

            // 无缝工作模式：
            // 本 tick 发生 source/target 状态切换后，立即执行一次新状态逻辑，
            // 避免传统切换带来的 1 tick 空转。
            let stateChange = !!currentRunner?.call(func, this);

            if (stateChange) {
                const nextWorking = !working;
                this.memory.working = nextWorking;
                // 清空临时缓存
                if (working) this.memory.cacheTarget = {};
                else this.memory.cacheSource = {};
                this.memory.cache = {};

                // 切换后立刻执行一次新状态；本 tick 不再继续连环切换。
                nextRunner?.call(func, this);
            }
        }
        else return;
    }
}
