import harvester from './economy/harvester';
import carrier from './economy/carrier';
import transporterRole from './economy/transporter';
import manager from './economy/manager';
import worker from './economy/worker';
import minerRole from './economy/miner';
import upgraderRole from './economy/upgrader';
import universal from './economy/universal';
import aidBuild from './expansion/aid-build';
import aidCarry from './expansion/aid-carry';
import aidUpgrade from './expansion/aid-upgrade';
import { attackClaimer, claimer } from './expansion/claim';
import logistic from './support/logistic';
import upUpgrade from './support/up-upgrade';
import upRepair from './support/up-repair';
import dismantle from './support/dismantle';
import scout from './support/scout';
import outHarvest from './remote/outmine/out-harvest';
import outCarry from './remote/outmine/out-carry';
import outBuild from './remote/outmine/out-build';
import reserver from './remote/outmine/reserver';
import { outAttack, outDefend, outInvader, outRanged } from './remote/outmine/out-combat';
import outMineral from './remote/outmine/out-mineral';
import { out2Attack } from './remote/outmine/out-duo';
import powerCarry from './remote/power/power-carry';
import { powerAttack, powerHeal, powerRanged } from './remote/power/power-combat';
import depositHarvest from './remote/deposit/deposit-harvest';
import depositTransfer from './remote/deposit/deposit-transfer';
import { depositAttack, depositRanged } from './remote/deposit/deposit-combat';
import combatHeal from './combat/combatHeal';
import oneRanged from './combat/one-ranged';
import aio from './combat/aio';
import doubleAttack from './combat/double-attack';
import doubleDismantle from './combat/double-dismantle';
import pcHeal from './combat/pc-heal';
import { defend2Attack } from './combat/defend-duo';
import { EXECUTORS } from '@/constant/CreepConstant';
import { defendAttack, defendRanged } from './combat/defend-single';

type RoleHandler = {
    prepare?: (creep: Creep) => boolean;
    run: (creep: Creep) => void;
};

type MissingRoleHandlerReporter = (id: string) => void;

// 键统一引用 EXECUTORS 常量（派生自 RoleData[].executor），与孵化侧词表单一来源对齐
export const roleRegistry: Record<string, RoleHandler> = {
    [EXECUTORS.carrier]: carrier,
    [EXECUTORS.harvester]: harvester,
    [EXECUTORS.manager]: manager,
    [EXECUTORS.miner]: minerRole,
    [EXECUTORS.transporter]: transporterRole,
    [EXECUTORS.universal]: universal,
    [EXECUTORS.upgrader]: upgraderRole,
    [EXECUTORS.worker]: worker,
    [EXECUTORS['aid-build']]: aidBuild,
    [EXECUTORS['aid-carry']]: aidCarry,
    [EXECUTORS['aid-upgrade']]: aidUpgrade,
    [EXECUTORS['attack-claimer']]: attackClaimer,
    [EXECUTORS.claimer]: claimer,
    [EXECUTORS.cleaner]: dismantle,
    [EXECUTORS.dismantle]: dismantle,
    [EXECUTORS.logistic]: logistic,
    [EXECUTORS.scout]: scout,
    [EXECUTORS['up-upgrade']]: upUpgrade,
    [EXECUTORS['up-repair']]: upRepair,
    [EXECUTORS['deposit-attack']]: depositAttack,
    [EXECUTORS['deposit-harvest']]: depositHarvest,
    [EXECUTORS['deposit-ranged']]: depositRanged,
    [EXECUTORS['deposit-transfer']]: depositTransfer,
    [EXECUTORS['out-2attack']]: out2Attack,
    [EXECUTORS['out-attack']]: outAttack,
    [EXECUTORS['out-build']]: outBuild,
    [EXECUTORS['out-carry']]: outCarry,
    [EXECUTORS['out-defend']]: outDefend,
    [EXECUTORS['out-harvest']]: outHarvest,
    [EXECUTORS['out-invader']]: outInvader,
    [EXECUTORS['out-mineral']]: outMineral,
    [EXECUTORS['out-ranged']]: outRanged,
    [EXECUTORS['power-attack']]: powerAttack,
    [EXECUTORS['power-carry']]: powerCarry,
    [EXECUTORS['power-heal']]: powerHeal,
    [EXECUTORS['power-ranged']]: powerRanged,
    [EXECUTORS.reserver]: reserver,
    [EXECUTORS.aio]: aio,
    // 治疗型角色统一执行器：out-2heal / deposit-heal / defend-2heal / double-heal
    // 由 creep.memory.role 选策略，见 action/combat/combatHeal.ts
    [EXECUTORS['combat-heal']]: combatHeal,
    [EXECUTORS['double-attack']]: doubleAttack,
    [EXECUTORS['double-dismantle']]: doubleDismantle,
    [EXECUTORS['one-ranged']]: oneRanged,
    [EXECUTORS['pc-heal']]: pcHeal,
    [EXECUTORS['defend-2attack']]: defend2Attack,
    [EXECUTORS['defend-attack']]: defendAttack,
    [EXECUTORS['defend-ranged']]: defendRanged,
};

export const getRoleHandler = (id: string, onMissing?: MissingRoleHandlerReporter): RoleHandler | null => {
    const handler = roleRegistry[id];
    if (handler) return handler;
    onMissing?.(id);
    return null;
};
