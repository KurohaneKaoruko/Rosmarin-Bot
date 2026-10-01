import { writeMoveWorkTileCandidates } from '@/modules/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { runWorkLayer } from '@/framework/ai/adapters';
import { getWorkerUpgradeSlot, registerUpgraderStarve } from '@/modules/shared/roomWorkforce';

/**
 * 专人升级工：**静态高效升级**——固定在控制器旁的工位，能量由搬运送进控制器缓冲
 * （link/container/terminal/storage），本角色绝不离开控制器区域自行找能量。
 *
 * 职责边界：
 * - 本角色：高效升级 + 特殊冲级（boost）；仓库断供时原地待命，能量由搬运送上容器；
 * - worker：建造 + 常规升级（worker 的升级侧定编见 getWorkerUpgradeTarget）；
 * - up-upgrade：已弃用（代码暂留），仅 UP-UPGRADE / AID-UUP 旗帜与跨房增援入口仍用。
 *
 * 仓库断供期：原地待命 + 记 starved 负反馈（缩编信号）；spawn 侧由
 * spawnMission.pauseRushUpgraderIfDepotStarved 同步暂停升级孵化、让位物流层。
 */

const RETIRE_UNBOOST_TIMEOUT = 100;

const isBodyBoosted = (creep: Creep) => creep.body.some((part) => !!part.boost);

// 冲级催化：WORK 用升级催化（XGH2O 系），MOVE 用加速（XZHO2 系）——非强制，缺资源自动跳过
const BOOST_MAP = {
    [typeof WORK === 'undefined' ? 'work' : WORK]: ['XGH2O', 'GH2O', 'GH'],
    [typeof MOVE === 'undefined' ? 'move' : MOVE]: ['XZHO2', 'ZHO2', 'ZO'],
} as { [part: string]: any };

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

/** 升级期间的移动工位：专属工位（range 0），无工位退回控制器 3 格 */
export const syncUpgraderMoveWork = (creep: Creep) => {
    if (
        creep.room.controller?.my &&
        creep.memory.working &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
        const slot = getWorkerUpgradeSlot(creep.room, creep.name);
        writeMoveWorkTileCandidates(creep, [
            slot ? { pos: slot, range: 0 } : { pos: creep.room.controller.pos, range: 3 },
        ]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (shouldRetire(creep)) {
        retire(creep);
        return WORK_EVENTS.STAY;
    }

    // 统一走 runControllerUpgrade：寻路、控制器工位前压、捡能量、升级、签名
    creep.runControllerUpgrade({ sign: true, pickupDropped: true });
    syncUpgraderMoveWork(creep);
    if (creep.store.getUsedCapacity() === 0) return WORK_EVENTS.TO_SOURCE;
    return WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;

    // boost 前置：未完成前不取能不升级（无 lab 环境自动跳过）
    if (!creep.ensureBoosted(BOOST_MAP)) return WORK_EVENTS.STAY;
    if (shouldRetire(creep)) {
        retire(creep);
        return WORK_EVENTS.STAY;
    }

    // 控制器周边缓冲取能：link > container > terminal > storage。
    // 严禁回退通用取能（fallbackToTakeEnergy: false）——静态升级工绝不离开
    // 控制器区域自己找能量：仓库空了就原地待命，能量由搬运送上容器；
    // 乱走会丢站位、拖垮吞吐，还和搬运/孵化抢散能。断供期照记 starved 账。
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
    // 仓库断供且已卸空：原地待命等补给（不移动、不找能量），仅记 starved 账
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        registerUpgraderStarve(creep.room);
        syncUpgraderMoveWork(creep);
    }
    return WORK_EVENTS.STAY;
};

const UpgraderFunction = {
    run(creep: Creep) {
        runWorkLayer(creep, { onSource, onTarget });
    },
};

export default UpgraderFunction;
