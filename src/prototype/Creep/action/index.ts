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
import { defendAttack, defendRanged } from './combat/defend-single';

type RoleHandler = {
    prepare?: (creep: Creep) => boolean;
    run: (creep: Creep) => void;
};

type MissingRoleHandlerReporter = (id: string) => void;

export const roleRegistry: Record<string, RoleHandler> = {
    'carrier': carrier,
    'harvester': harvester,
    'manager': manager,
    'miner': minerRole,
    'transporter': transporterRole,
    'universal': universal,
    'upgrader': upgraderRole,
    'worker': worker,
    'aid-build': aidBuild,
    'aid-carry': aidCarry,
    'aid-upgrade': aidUpgrade,
    'attack-claimer': attackClaimer,
    'claimer': claimer,
    'cleaner': dismantle,
    'dismantle': dismantle,
    'logistic': logistic,
    'scout': scout,
    'up-upgrade': upUpgrade,
    'up-repair': upRepair,
    'deposit-attack': depositAttack,
    'deposit-harvest': depositHarvest,
    'deposit-ranged': depositRanged,
    'deposit-transfer': depositTransfer,
    'out-2attack': out2Attack,
    'out-attack': outAttack,
    'out-build': outBuild,
    'out-carry': outCarry,
    'out-defend': outDefend,
    'out-harvest': outHarvest,
    'out-invader': outInvader,
    'out-mineral': outMineral,
    'out-ranged': outRanged,
    'power-attack': powerAttack,
    'power-carry': powerCarry,
    'power-heal': powerHeal,
    'power-ranged': powerRanged,
    'reserver': reserver,
    'aio': aio,
    // 治疗型角色统一执行器：out-2heal / deposit-heal / defend-2heal / double-heal
    // 由 creep.memory.role 选策略，见 action/combat/combatHeal.ts
    'combat-heal': combatHeal,
    'double-attack': doubleAttack,
    'double-dismantle': doubleDismantle,
    'one-ranged': oneRanged,
    'pc-heal': pcHeal,
    'defend-2attack': defend2Attack,
    'defend-attack': defendAttack,
    'defend-ranged': defendRanged,
};

export const getRoleHandler = (id: string, onMissing?: MissingRoleHandlerReporter): RoleHandler | null => {
    const handler = roleRegistry[id];
    if (handler) return handler;
    onMissing?.(id);
    return null;
};
