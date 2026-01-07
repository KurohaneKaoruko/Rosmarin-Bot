// Main role imports
import harvester from './main/harvester';
import carrier from './main/carrier';
import transport from './main/transport';
import manager from './main/manager';
import upgrader from './main/upgrader';
import worker from './main/worker';
import mineral from './main/mineral';
import universal from './main/universal';

// Aid role imports
import claimer from './aid/claimer';
import aclaimer from './aid/aclaimer';
import aidBuild from './aid/aid-build';
import aidCarry from './aid/aid-carry';
import aidUpgrade from './aid/aid-upgrade';

// Other role imports
import logistic from './other/logistic';
import upUpgrade from './other/up-upgrade';
import upRepair from './other/up-repair';
import dismantle from './other/dismantle';
import cleaner from './other/cleaner';
import signer from './other/signer';
import scout from './other/scout';

// Outmine role imports
import outHarvest from './outmine/out-harvest';
import outCarry from './outmine/out-carry';
import outBuild from './outmine/out-build';
import reserve from './outmine/reserve';
import outDefend from './outmine/out-defend';
import outInvader from './outmine/out-invader';
import outAttack from './outmine/out-attack';
import outRanged from './outmine/out-ranged';
import outMineral from './outmine/out-mineral';
import out2Attack from './outmine/out-2attack';
import out2Heal from './outmine/out-2heal';

// Power role imports
import powerAttack from './power/power-attack';
import powerHeal from './power/power-heal';
import powerCarry from './power/power-carry';
import powerRanged from './power/power-ranged';

// Deposit role imports
import depositHarvest from './deposit/deposit-harvest';
import depositTransfer from './deposit/deposit-transfer';
import depositRanged from './deposit/deposit-ranged';
import depositAttack from './deposit/deposit-attack';
import depositHeal from './deposit/deposit-heal';

// War role imports
import oneRanged from './war/one-ranged';
import aio from './war/aio';
import doubleAttack from './war/double-attack';
import doubleDismantle from './war/double-dismantle';
import doubleHeal from './war/double-heal';

// Defend role imports
import defendAttack from './defend/defend-attack';
import defendRanged from './defend/defend-ranged';
import defend2Attack from './defend/defend-2attack';
import defend2Heal from './defend/defend-2heal';

// Work模式注册表 - 包含source和target方法的函数
export const workRegistry: Record<string, any> = {
    'carrier': carrier,
    'upgrader': upgrader,
    'worker': worker,
    'mineral': mineral,
    'universal': universal,
    'scout': scout,
    'logistic': logistic,
    'up-upgrade': upUpgrade,
    'up-repair': upRepair,
    'reserve': reserve,
    'out-harvest': outHarvest,
    'out-carry': outCarry,
    'out-build': outBuild,
    'out-mineral': outMineral,
    'deposit-harvest': depositHarvest,
    'deposit-transfer': depositTransfer,
    'power-carry': powerCarry,
    'aid-carry': aidCarry,
    'aid-upgrade': aidUpgrade,
};

// Action模式注册表 - 包含run方法的函数
export const actionRegistry: Record<string, any> = {
    'harvester': harvester,
    'transport': transport,
    'manager': manager,
    'cleaner': cleaner,
    'dismantle': dismantle,
    'signer': signer,
    'claimer': claimer,
    'aclaimer': aclaimer,
    'aid-build': aidBuild,
    'one-ranged': oneRanged,
    'aio': aio,
    'double-attack': doubleAttack,
    'double-dismantle': doubleDismantle,
    'double-heal': doubleHeal,
    'defend-attack': defendAttack,
    'defend-ranged': defendRanged,
    'defend-2attack': defend2Attack,
    'defend-2heal': defend2Heal,
    'out-defend': outDefend,
    'out-2attack': out2Attack,
    'out-2heal': out2Heal,
    'out-invader': outInvader,
    'out-attack': outAttack,
    'out-ranged': outRanged,
    'deposit-attack': depositAttack,
    'deposit-heal': depositHeal,
    'deposit-ranged': depositRanged,
    'power-attack': powerAttack,
    'power-heal': powerHeal,
    'power-ranged': powerRanged,
};
