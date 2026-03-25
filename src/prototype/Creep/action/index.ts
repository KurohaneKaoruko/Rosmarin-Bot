import type { CreepRoleHandler } from '@/framework/ai/creepRole';
import harvester from './economy/harvester';
import carrier from './economy/carrier';
import transporterRole from './economy/transporter';
import manager from './economy/manager';
import upgrader from './economy/upgrader';
import worker from './economy/worker';
import minerRole from './economy/miner';
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
import reserve from './remote/outmine/reserve';
import { outAttack, outDefend, outInvader, outRanged } from './remote/outmine/out-combat';
import outMineral from './remote/outmine/out-mineral';
import { out2Attack, out2Heal } from './remote/outmine/out-duo';
import powerCarry from './remote/power/power-carry';
import { powerAttack, powerHeal, powerRanged } from './remote/power/power-combat';
import depositHarvest from './remote/deposit/deposit-harvest';
import depositTransfer from './remote/deposit/deposit-transfer';
import { depositAttack, depositHeal, depositRanged } from './remote/deposit/deposit-combat';
import oneRanged from './combat/assault/one-ranged';
import aio from './combat/assault/aio';
import doubleAttack from './combat/assault/double-attack';
import doubleDismantle from './combat/assault/double-dismantle';
import doubleHeal from './combat/assault/double-heal';
import pcHeal from './combat/assault/pc-heal';
import { defend2Attack, defend2Heal } from './combat/defense/defend-duo';
import { defendAttack, defendRanged } from './combat/defense/defend-single';

type MissingRoleHandlerReporter = (id: string) => void;

export const roleRegistry: Record<string, CreepRoleHandler> = {
    'carrier': carrier,
    'harvester': harvester,
    'manager': manager,
    'miner': minerRole,
    'transporter': transporterRole,
    'universal': universal,
    'upgrader': upgrader,
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
    'up-repair': upRepair,
    'up-upgrade': upUpgrade,
    'deposit-attack': depositAttack,
    'deposit-harvest': depositHarvest,
    'deposit-heal': depositHeal,
    'deposit-ranged': depositRanged,
    'deposit-transfer': depositTransfer,
    'out-2attack': out2Attack,
    'out-2heal': out2Heal,
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
    'reserve': reserve,
    'aio': aio,
    'double-attack': doubleAttack,
    'double-dismantle': doubleDismantle,
    'double-heal': doubleHeal,
    'one-ranged': oneRanged,
    'pc-heal': pcHeal,
    'defend-2attack': defend2Attack,
    'defend-2heal': defend2Heal,
    'defend-attack': defendAttack,
    'defend-ranged': defendRanged,
};

export const getRoleHandler = (id: string, onMissing?: MissingRoleHandlerReporter): CreepRoleHandler | null => {
    const handler = roleRegistry[id];
    if (handler) return handler;
    onMissing?.(id);
    return null;
};
