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

            const working = this.memory.working;
            let stateChange = false;
            if (working) stateChange = func.target(this);
            else stateChange = func.source(this);

            if (stateChange) {
                this.memory.working = !working;
                // 清空临时缓存
                if (working) this.memory.cacheTarget = {};
                else this.memory.cacheSource = {};
                this.memory.cache = {};
            }
        }
        else return;
    }
}
