import { ROLES } from '@/constant/CreepConstant';
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
 * 仓库断供期：升级火力由 roomWorkforce 水位比例节流平滑收缩（从不清零不删单），
 * 待命点固定在控制器旁由搬运手填闭环供能。
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

/** 升级期间的移动工位：专属工位（range 0），无工位退回控制器 3 格。
 *  空仓待命时**同样**就位——升级工的待命点必须是控制器旁，
 *  站在 spawn 旁等手填 = 永远走不进 range 3（能量堆在身上升不了级的死锁）。 */
export const syncUpgraderMoveWork = (creep: Creep) => {
    if (creep.room.controller?.my) {
        const slot = getWorkerUpgradeSlot(creep.room, creep.name);
        writeMoveWorkTileCandidates(creep, [
            slot ? { pos: slot, range: 0 } : { pos: creep.room.controller.pos, range: 3 },
        ]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

/** 邻位借能（对齐参考实现口径）：cc 空了才借、只向「比自己更贴 cc」的有货邻居借、
 *  借出方打 tick 标记防同 tick 多头索取——能量沿内圈→外圈单向流动，不回弹不多跳 */
const borrowFromAdjacentUpgrader = (creep: Creep): boolean => {
    if ((creep.store[RESOURCE_ENERGY] || 0) > 0) return false;
    const room = creep.room;
    const controller = room.controller;
    if (!controller?.my) return false;
    const cc = (room.container || []).find(c => c.pos.inRangeTo(controller.pos, 3));
    if (!cc || (cc.store[RESOURCE_ENERGY] || 0) > 0) return false;
    const selfDist = creep.pos.getRangeTo(cc.pos);
    const mate = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (c: Creep) => {
            if (c.id === creep.id || c.memory.role !== ROLES.upgrader) return false;
            if ((c.store[RESOURCE_ENERGY] || 0) === 0) return false;
            if ((c as any)._transfered === Game.time) return false;
            return c.pos.getRangeTo(cc.pos) < selfDist;
        },
    })[0];
    if (!mate) return false;
    if (mate.transfer(creep, RESOURCE_ENERGY) !== OK) return false;
    (mate as any)._transfered = Game.time;
    return true;
};

const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (shouldRetire(creep)) {
        retire(creep);
        return WORK_EVENTS.STAY;
    }

    // 建造期让位：基础结构工地存在时暂停开火（能量让给 builder，旗清后恢复）
    if (Game.time - ((creep.room.memory as any).buildingTick || 0) < 30) {
        syncUpgraderMoveWork(creep);
        return WORK_EVENTS.STAY;
    }

    // cc 断供时向内圈邻居借能，借到即本 tick 收工
    if (borrowFromAdjacentUpgrader(creep)) {
        syncUpgraderMoveWork(creep);
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
    // 控制器区域自己找能量：仓库空了就**回控制器旁待命**（syncUpgraderMoveWork
    // 会写入就位候选），能量由搬运送上容器/手填；断供期照记 starved 账。
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
    // 手填/部分到货（carrier 的 transfer 不走 withdraw 返回值）：身上有货就去升级——
    // 停在 onSource 会原地站死（本分支无移动逻辑），boot 阶段升级工孵在 spawn 旁
    // 被 carrier 喂满后永远走不进控制器 3 格（实测 0 升级冻结的根因）
    if ((creep.store[RESOURCE_ENERGY] || 0) > 0) return WORK_EVENTS.TO_TARGET;
    // 仓库断供且已卸空：回控制器旁待命等补给（不找能量），仅记 starved 账
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        registerUpgraderStarve(creep.room);
        syncUpgraderMoveWork(creep);
        if (creep.pos.getRangeTo(creep.room.controller!.pos) > 3) {
            creep.moveTo(creep.room.controller!.pos, { range: 3 });
        }
    }
    return WORK_EVENTS.STAY;
};

const UpgraderFunction = {
    run(creep: Creep) {
        runWorkLayer(creep, { onSource, onTarget });
    },
};

export default UpgraderFunction;
