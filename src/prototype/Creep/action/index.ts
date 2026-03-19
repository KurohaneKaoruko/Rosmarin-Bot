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
import aidBuild from './aid/aid-build';
import aidCarry from './aid/aid-carry';
import aidUpgrade from './aid/aid-upgrade';
import claimer from './aid/claimer';
import attackClaimer from './aid/attack-claimer';

// Other role imports
import logistic from './other/logistic';
import upUpgrade from './other/up-upgrade';
import upRepair from './other/up-repair';
import dismantle from './other/dismantle';
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
import powerAttack from './collect/power-attack';
import powerHeal from './collect/power-heal';
import powerCarry from './collect/power-carry';
import powerRanged from './collect/power-ranged';

// Deposit role imports
import depositHarvest from './collect/deposit-harvest';
import depositTransfer from './collect/deposit-transfer';
import depositRanged from './collect/deposit-ranged';
import depositAttack from './collect/deposit-attack';
import depositHeal from './collect/deposit-heal';

// War role imports
import oneRanged from './war/one-ranged';
import aio from './war/aio';
import doubleAttack from './war/double-attack';
import doubleDismantle from './war/double-dismantle';
import doubleHeal from './war/double-heal';
import pcHeal from './war/pc-heal';

// Defend role imports
import defendAttack from './defend/defend-attack';
import defendRanged from './defend/defend-ranged';
import defend2Attack from './defend/defend-2attack';
import defend2Heal from './defend/defend-2heal';

// 统一角色执行器接口：
// prepare 用于一次性准备阶段，run 负责每 tick 的实际执行。
export type CreepRoleHandler = {
    prepare?: (creep: Creep) => boolean;
    run: (creep: Creep) => void;
};

type MissingRoleHandlerReporter = (id: string) => void;

// 统一角色执行器注册表：
// 所有角色都通过同一个入口分发，不再区分 work / action 命名空间。
export const roleRegistry: Record<string, CreepRoleHandler> = {
    'carrier': carrier,
    'upgrader': upgrader,
    'worker': worker,
    'mineral': mineral,
    'scout': scout,
    'logistic': logistic,
    'up-upgrade': upUpgrade,
    'up-repair': upRepair,
    'reserve': reserve,
    'out-harvest': outHarvest,
    'out-build': outBuild,
    'out-mineral': outMineral,
    'deposit-harvest': depositHarvest,
    'deposit-transfer': depositTransfer,
    'power-carry': powerCarry,
    'aid-carry': aidCarry,
    'aid-upgrade': aidUpgrade,
    'harvester': harvester,
    'transport': transport,
    'manager': manager,
    'universal': universal,
    'cleaner': dismantle,
    'dismantle': dismantle,
    'signer': signer,
    'claimer': claimer,
    'attack-claimer': attackClaimer,
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
    'out-carry': outCarry,
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
    'pc-heal': pcHeal,
};

// 统一处理器解析函数：
// 让 execute 层只关心“按 id 取 handler”，不再感知注册表细节。
// 当调用方提供 onMissing 时，这里会把缺失事件显式抛回上层做日志或监控。
export const getRoleHandler = (id: string, onMissing?: MissingRoleHandlerReporter): CreepRoleHandler | null => {
    const handler = roleRegistry[id];
    if (handler) return handler;
    onMissing?.(id);
    return null;
};
