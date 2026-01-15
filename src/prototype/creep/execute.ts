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
            if (!this.memory.cache) { this.memory.cache = {} };
            if (func.prepare && !this.memory.ready) {
                this.memory.ready = func.prepare(this);
            }

            let stateChange = false;
            if (this.memory.working)
                stateChange = func.target(this);
            else stateChange = func.source(this);

            if (stateChange) {
                this.memory.working = !this.memory.working;
                this.memory.cache = {}; // 清空临时缓存
            }
        }
        else return;
    }
}