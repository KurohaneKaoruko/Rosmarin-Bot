import { ROLES } from '@/constant/CreepConstant';
import { writeMoveWorkTileCandidates } from '@/modules/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/prototype/Creep/family/flow/workLayer';
import { runWorkLayer } from '@/prototype/Creep/family/flow/workLayer';
import { ROLE_BOOST_CONFIGS } from '@/prototype/Creep/function/boostFunction';

const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

    creep.runControllerUpgrade();
    if (creep.store.getUsedCapacity() === 0) {
        creep.say('🔄');
        return WORK_EVENTS.TO_SOURCE;
    }
    syncAidUpgradeMoveWork(creep);
    return WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

    creep.withdrawControllerEnergy({
        linkRange: 2,
        containerRange: 2,
        fallbackToTakeEnergy: true,
    });

    if (creep.store.getFreeCapacity() === 0) {
        creep.say('⚡');
        return WORK_EVENTS.TO_TARGET;
    }
    return WORK_EVENTS.STAY;
};

export const syncAidUpgradeMoveWork = (creep: Creep) => {
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

// 出发前 TTL 门槛：低于该值先在 spawn 续命（boost 后绝不再续命，防止丢强化）
const AID_TTL_READY = 1200;

/**
 * 源房准备阶段（仅 aidRush 跨房增援）：续命 → boost → 出发。
 * 顺序铁律：续命必须在 boost 之前——boost 后续命会丢强化；
 * boost 完成后直接出发，绝不再回 spawn。
 * ensureBoosted 非强制：补料 80t 内没到位就自动放弃，无强化也会出发。
 */
const aidSourcePrep = (creep: Creep): boolean => {
    const mem = creep.memory as any;
    if (mem.boosted) return false; // 已强化 → 出发

    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];

    // 1) 续命：TTL 优先拉满
    if ((creep.ticksToLive ?? 0) < AID_TTL_READY && spawn && !spawn.spawning) {
        if (creep.pos.inRangeTo(spawn, 1)) spawn.renewCreep(creep);
        else creep.moveTo(spawn, { range: 1 });
        return true;
    }

    // 2) boost：资源不足时 ensureBoosted 内部自动放弃 → 无强化出发
    if (!creep.ensureBoosted(mem.boostmap || ROLE_BOOST_CONFIGS[ROLES['aid-upgrade']])) return true;

    return false; // 准备完成 → 出发
};

const aid_upgrade = {
    run: (creep) => {
        const mem = creep.memory as any;
        // 跨房增援准备：源房内先完成 续命 + boost 再出发；boost 后绝不再续命
        if (mem.aidRush && creep.room.name !== mem.targetRoom && aidSourcePrep(creep)) return;

        runWorkLayer(creep, { onSource, onTarget }, { reenter: true });
    }
};

export default aid_upgrade;
