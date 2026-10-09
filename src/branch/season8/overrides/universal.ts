// season8 覆盖：通用机（universal）高能模式升级窗口。
// 共享实现（@/prototype/Creep/role/economy/universal）已含采源优先级/让位/换能链路，
// 本覆盖只补它没有的一层：high / rush 档且能量充足时，载能通用机优先升级（含控制器缓冲与拥堵判定），
// 其余场景原样交给共享 run。
import baseUniversal from '@/prototype/Creep/role/economy/universal';
import { THRESHOLDS } from '@/constant/Thresholds';
import { ROLES } from '@/constant/CreepConstant';
import { getRoomData } from '@/modules/shared/memory';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { SEASON8_THRESHOLDS, getHighModeUpgradeMinEnergy } from '../thresholds';

const getRoomMode = (room: Room) =>
    ((getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main') as string;

/** 高能模式升级窗口：high/rush 档、非 CRITICAL、且能量达标（低等级或临降级时放宽）。 */
const isHighModeUpgradeWindow = (room: Room): boolean => {
    const mode = getRoomMode(room);
    if (mode !== 'high' && mode !== 'rush') return false;

    const state = room.memory.energyState || room.updateEnergyState?.(false) || 'NORMAL';
    if (state === 'CRITICAL') return false;

    const totalEnergy = room.getEnergyProfile?.().totalEnergy ?? (room as any)[RESOURCE_ENERGY] ?? 0;
    const ttd = room.controller?.ticksToDowngrade || 0;
    return room.level <= 4 || totalEnergy >= getHighModeUpgradeMinEnergy(room.level) || ttd < 8000;
};

/** 控制器周围升级者是否已拥堵（缓存到房间 tick 缓存，避免同 tick 重复扫描）。 */
const isControllerCongested = (room: Room): boolean =>
    getRoomTickCacheValue(room, 'season8_controller_congested', () => {
        const controller = room.controller;
        if (!controller?.my) return false;
        const threshold = SEASON8_THRESHOLDS.UNIVERSAL.CONTROLLER_CONGESTION_UPGRADER_THRESHOLD;
        const range = SEASON8_THRESHOLDS.UNIVERSAL.CONTROLLER_CONGESTION_RANGE;
        const count = room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) =>
                c.pos.inRangeTo(controller, range) &&
                (c.memory.role === ROLES.upgrader || c.memory.role === ROLES['aid-upgrade']),
        }).length;
        return count >= threshold;
    }) as boolean;

/** 控制器缓冲目标：优先 link（近、空、低于缓冲上限），否则 container。 */
const chooseControllerBufferTarget = (creep: Creep): AnyStoreStructure | null => {
    const controller = creep.room.controller;
    if (!controller?.my) return null;

    const linkTarget = (creep.room.link || [])
        .filter(
            (l) =>
                l.pos.inRangeTo(controller, 2) &&
                l.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                l.store[RESOURCE_ENERGY] < THRESHOLDS.UNIVERSAL.CONTROLLER_LINK_BUFFER_TARGET,
        )
        .sort((a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY])[0] || null;

    const containerTarget = (creep.room.container || [])
        .filter(
            (c) =>
                c.pos.inRangeTo(controller, 3) &&
                c.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                c.store[RESOURCE_ENERGY] < THRESHOLDS.UNIVERSAL.CONTROLLER_CONTAINER_BUFFER_TARGET,
        )
        .sort((a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY])[0] || null;

    if (!linkTarget) return containerTarget;
    if (!containerTarget) return linkTarget;
    return creep.pos.getRangeTo(linkTarget) <= creep.pos.getRangeTo(containerTarget) ? linkTarget : containerTarget;
};

export const season8Universal: typeof baseUniversal = {
    run(creep: Creep) {
        if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && isHighModeUpgradeWindow(creep.room)) {
            const congested = isControllerCongested(creep.room);

            const buffer = chooseControllerBufferTarget(creep);
            if (buffer && (!congested || creep.pos.isNearTo(buffer))) {
                creep.goTransfer(buffer, RESOURCE_ENERGY);
                return;
            }

            const controller = creep.room.controller;
            if (!congested || (controller && creep.pos.inRangeTo(controller, 3))) {
                creep.goUpgrade();
                return;
            }
        }

        baseUniversal.run(creep);
    },
};
