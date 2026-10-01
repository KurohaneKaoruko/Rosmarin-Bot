import { writeMoveWorkTileCandidates } from '@/modules/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { runWorkLayer } from '@/framework/ai/adapters';
import { registerUpgraderStarve } from '@/modules/shared/roomWorkforce';

/**
 * @deprecated 已弃用：本文件的静态站桩实现已并入 upgrader 角色
 * （action/economy/upgrader.ts），常规升级不要再走这里。
 * 仅为 UP-UPGRADE / AID-UUP 旗帜与跨房增援入口暂时保留。
 */

// 冲级催化：WORK 用升级催化（XGH2O 系），MOVE 用加速（XZHO2 系）。
// goBoost 非强制模式，资源不足时自动放弃并不阻塞工作。
// 注意：测试环境可能只注入部分全局常量，因此惰性求值避免模块加载期 ReferenceError。
const getUpUpgradeBoostmap = () => ({
    [typeof WORK === 'undefined' ? 'work' : WORK]: ['XGH2O', 'GH2O', 'GH'],
    [typeof MOVE === 'undefined' ? 'move' : MOVE]: ['XZHO2', 'ZHO2', 'ZO'],
} as { [part: string]: any });

// 退役时允许花在卸载 boost 上的最长时间，超时强制自杀回收人口
const RETIRE_UNBOOST_TIMEOUT = 100;

const isBodyBoosted = (creep: Creep) => creep.body.some((part) => !!part.boost);

// 冲级爬只在两种情况下退役：房间升满 8 级，或寿命将尽。
// 退役优先尝试卸载 boost 回收矿物，超时后直接自杀。
const shouldRetire = (creep: Creep): boolean => {
    if (creep.room.controller?.my && creep.room.level >= 8) return true;
    return (creep.ticksToLive ?? 1500) < 50;
};

const retire = (creep: Creep): void => {
    const memory = creep.memory as any;
    if (memory.retireStartTick == null) memory.retireStartTick = Game.time;
    const timedOut = Game.time - memory.retireStartTick > RETIRE_UNBOOST_TIMEOUT;

    if (!timedOut && isBodyBoosted(creep)) {
        // unBoost 自带移动逻辑：走向紧邻 lab 的容器并触发卸载
        creep.unBoost();
        return;
    }
    creep.suicide();
};

export const syncUpUpgradeMoveWork = (creep: Creep) => {
    if (
        creep.room.controller?.my &&
        creep.memory.working &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
        writeMoveWorkTileCandidates(creep, [{ pos: creep.room.controller.pos, range: 3 }]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;
    if (shouldRetire(creep)) {
        retire(creep);
        return WORK_EVENTS.STAY;
    }
    if (creep.store.getUsedCapacity() === 0) {
        return WORK_EVENTS.TO_SOURCE;
    }

    // 统一走 runControllerUpgrade：寻路、控制器工位前压、捡能量、升级、签名
    creep.runControllerUpgrade({ sign: true, pickupDropped: true });
    syncUpUpgradeMoveWork(creep);
    return WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

    // boost 前置：未完成前不取能不升级（配置见 ROLE_BOOST_CONFIGS['up-upgrade']）
    if (!creep.ensureBoosted({ [WORK]: ['XGH2O', 'GH2O', 'GH'], [MOVE]: ['XZHO2', 'ZHO2', 'ZO'] })) {
        return WORK_EVENTS.STAY;
    }

    if (creep.store.getFreeCapacity() === 0) {
        return WORK_EVENTS.TO_TARGET;
    }
    if (shouldRetire(creep)) {
        retire(creep);
        return WORK_EVENTS.STAY;
    }

    // 控制器周边缓冲取能：link > container > terminal > storage。
    // 严禁回退通用取能（fallbackToTakeEnergy: false）——静态升级工绝不离开控制器区域
    // 自己找能量：仓库空了就原地待命，能量由搬运送上容器；乱走会拖垮吞吐，
    // 还会和搬运/孵化抢散能。断供期照记 starved 负反馈（缩编信号）。
    const filled = creep.withdrawControllerEnergy({
        linkRange: 2,
        containerRange: 2,
        terminalRange: 3,
        storageRange: 4,
        fallbackToTakeEnergy: false,
    });
    if (filled && creep.store.getFreeCapacity() === 0) {
        return WORK_EVENTS.TO_TARGET;
    }
    // 仓库断供且已卸空：原地待命等补给（不移动、不找能量），仅记断供账
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        registerUpgraderStarve(creep.room);
        syncUpUpgradeMoveWork(creep);
    }
    return WORK_EVENTS.STAY;
};

const UpUpgradeFunction = {
    run: (creep: Creep) => {
        writeMoveWorkTileCandidates(creep, []);
        runWorkLayer(creep, { onSource, onTarget });
    },
};

export default UpUpgradeFunction;
