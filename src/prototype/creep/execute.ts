import { workRegistry, actionRegistry } from './action';
import { RoleData } from '@/constant/CreepConstant';
import { SongConstant } from '@/constant/SayConstant';

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

    // 随机唱歌♪
    randomSing() {
        if (this.memory.sayText) return;
        if (!this.room.my) return;
        if (Math.random() > 0.007) return;
        let index = Math.floor(Math.random() * SongConstant.length);
        let text = SongConstant[index];
        if(!text) return;
        if(typeof text === "string") {
            this.memory.sayText = [text+'♪', ''];
        } else {
            this.memory.sayText = text.map((t:string) => t+'♪');
            this.memory.sayText.push('');
        }
    }

}