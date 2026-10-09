// 赛季覆盖装配：把赛季专属行为挂到共享实现之上（不复制共享模块，只替换/包裹差异单元）。
// - 角色处理器：roleRegistry 替换 universal（高能模式升级窗口）
// - Room 方法：包裹 autoBuild（道路工地裁剪）
import { roleRegistry } from '@/prototype/Creep/runtime/registry';
import { EXECUTORS } from '@/constant/CreepConstant';
import { season8Universal } from './universal';
import { trimSeason8RoadSites } from './autoBuild';

export const installSeason8Overrides = (): void => {
    roleRegistry[EXECUTORS.universal] = season8Universal;

    const prevAutoBuild = Room.prototype.autoBuild;
    Room.prototype.autoBuild = function () {
        trimSeason8RoadSites(this);
        return prevAutoBuild.call(this);
    };
};
