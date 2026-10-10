type RoleHandler = {
    prepare?: (creep: Creep) => boolean;
    run: (creep: Creep) => void;
};

type MissingRoleHandlerReporter = (id: string) => void;

import harvester from '../role/economy/harvester';
import carrier from '../role/economy/carrier';
import transporterRole from '../role/economy/transporter';
import manager from '../role/economy/manager';
import worker from '../role/economy/worker';
import minerRole from '../role/economy/miner';
import upgraderRole from '../role/economy/upgrader';
import universal from '../role/economy/universal';
import aidBuild from '../role/expansion/aid-build';
import aidCarry from '../role/expansion/aid-carry';
import aidUpgrade from '../role/expansion/aid-upgrade';
import { attackClaimer, claimer } from '../role/expansion/claim';
import logistic from '../role/support/logistic';
import upUpgrade from '../role/support/up-upgrade';
import upRepair from '../role/support/up-repair';
import dismantle from '../role/support/dismantle';
import scout from '../role/support/scout';
import outBuild from '../role/remote/outmine/out-build';
import reserver from '../role/remote/outmine/reserver';
import { outAttack, outDefend, outInvader, outRanged } from '../role/remote/outmine/out-combat';
import outMineral from '../role/remote/outmine/out-mineral';
import { out2Attack } from '../role/remote/outmine/out-duo';
import powerCarry from '../role/remote/power/power-carry';
import { powerAttack, powerHeal, powerRanged } from '../role/remote/power/power-combat';
import depositHarvest from '../role/remote/deposit/deposit-harvest';
import depositTransfer from '../role/remote/deposit/deposit-transfer';
import { depositAttack, depositRanged } from '../role/remote/deposit/deposit-combat';
import { makeCombatHealHandler } from '../role/combat/combatHeal';
import oneRanged from '../role/combat/one-ranged';
import aio from '../role/combat/aio';
import doubleAttack from '../role/combat/double-attack';
import doubleDismantle from '../role/combat/double-dismantle';
import pcHeal from '../role/combat/pc-heal';
import { defend2Attack } from '../role/combat/defend-duo';
import { EXECUTORS, ROLES } from '\@/constant/CreepConstant';
import { defendAttack, defendRanged } from '../role/combat/defend-single';

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
    [EXECUTORS['out-defend']]: outDefend,
    [EXECUTORS['out-invader']]: outInvader,
    [EXECUTORS['out-mineral']]: outMineral,
    [EXECUTORS['out-ranged']]: outRanged,
    [EXECUTORS['power-attack']]: powerAttack,
    [EXECUTORS['power-carry']]: powerCarry,
    [EXECUTORS['power-heal']]: powerHeal,
    [EXECUTORS['power-ranged']]: powerRanged,
    [EXECUTORS.reserver]: reserver,
    [EXECUTORS.aio]: aio,
    // 治疗型角色：策略在注册时按角色 id 预绑定，运行时零查表
    [EXECUTORS['out-2heal']]: makeCombatHealHandler(ROLES['out-2heal']),
    [EXECUTORS['deposit-heal']]: makeCombatHealHandler(ROLES['deposit-heal']),
    [EXECUTORS['defend-2heal']]: makeCombatHealHandler(ROLES['defend-2heal']),
    [EXECUTORS['double-heal']]: makeCombatHealHandler(ROLES['double-heal']),
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
