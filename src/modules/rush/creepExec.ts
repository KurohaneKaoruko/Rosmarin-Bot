/**
 * rush creep 执行器：miner/hauler/upgrader/builder 的行为逻辑。
 * 口径：miner 定点采集不走位（满载落地或入容器）；hauler 满载后按挂单供货；
 * upgrader 工位升级 + 就地取能（link>掉落>容器）；builder 取能后按优先目标建造。
 * 移动走本地 moveTo/BetterMove，不做参考的 trafficManager 工作区标记。
 */
import { getRange } from './manageLogistics';

/** hauler 取能半程：去最近的 source 锚点（容器/地面堆）取满；取满置 startSupplying 进入供货 */
export const runHaulerFetchHalf = (creep: Creep): void => {
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        (creep.memory as any).startSupplying = true;
        return;
    }
    // 找最近的有能锚点
    const room = creep.room;
    const containers = room.find(FIND_STRUCTURES, {
        filter: (s: AnyStoreStructure) => s.structureType === STRUCTURE_CONTAINER && ((s as StructureContainer).store[RESOURCE_ENERGY] || 0) > 0,
    }) as StructureContainer[];
    const piles = room.find(FIND_DROPPED_RESOURCES).filter((d) => d.resourceType === RESOURCE_ENERGY);
    let best: { pos: RoomPosition; amount: number } | undefined;
    for (const c of containers) {
        if (!best || c.pos.getRangeTo(creep.pos) < best.pos.getRangeTo(creep.pos)) {
            best = { pos: c.pos, amount: c.store[RESOURCE_ENERGY] };
        }
    }
    for (const p of piles) {
        if (!best || p.pos.getRangeTo(creep.pos) < best.pos.getRangeTo(creep.pos)) {
            best = { pos: p.pos, amount: p.amount };
        }
    }
    if (!best) return;
    if (creep.pos.getRangeTo(best.pos) > 1) {
        creep.moveTo(best.pos, { range: 1 });
        return;
    }
    // 邻位：容器 withdraw / 地面 pickup
    const target = containers.find((c) => c.pos.getRangeTo(best!.pos) === 0 && (c.store[RESOURCE_ENERGY] || 0) > 0);
    if (target) creep.withdraw(target, RESOURCE_ENERGY);
    else {
        const pile = piles.find((p) => p.pos.getRangeTo(best!.pos) === 0);
        if (pile) creep.pickup(pile);
    }
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        (creep.memory as any).startSupplying = true;
    }
};

/** 采集：邻位 harvest；满载 → 容器/落地交付后继续。返回本 tick 是否实际采集 */
export const runMiner = (
    creep: Creep,
    source: Source,
    anchor: { x: number; y: number },
    container: StructureContainer | undefined,
): boolean => {
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 && !container) {
        creep.drop(RESOURCE_ENERGY);
        return false;
    }
    if (container && creep.pos.getRangeTo(container.pos) > 0) {
        creep.moveTo(container.pos, { range: 0 });
        return false;
    }
    const err = creep.harvest(source);
    if (err === ERR_NOT_IN_RANGE) {
        creep.moveTo(source.pos, { range: 1 });
        return false;
    }
    return err === OK;
};

/** 取能：从 source 容器或该点地面堆取满（hauler 的取半程） */
export const runHaulerFetch = (
    creep: Creep,
    anchorContainer: StructureContainer | undefined,
    anchorPos: { x: number; y: number },
): boolean => {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) return true;
    if (anchorContainer && anchorContainer.store[RESOURCE_ENERGY] > 0) {
        if (creep.pos.getRangeTo(anchorContainer.pos) > 1) {
            creep.moveTo(anchorContainer.pos, { range: 1 });
            return false;
        }
        creep.withdraw(anchorContainer, RESOURCE_ENERGY);
        return false;
    }
    // 地面堆
    const pile = creep.room
        .find(FIND_DROPPED_RESOURCES)
        .filter((d) => d.resourceType === RESOURCE_ENERGY && creep.pos.getRangeTo(d) <= 1)
        .sort((a, b) => b.amount - a.amount)[0];
    if (pile) {
        if (creep.pos.getRangeTo(pile) > 1) {
            creep.moveTo(pile, { range: 1 });
            return false;
        }
        creep.pickup(pile);
        return false;
    }
    return false;
};

/** 升级执行：工位升级 + 就地取能 + 内圈喂外圈 */
export const runUpgrader = (room: Room, creep: Creep, depot: StructureLink | StructureContainer | Resource | undefined): void => {
    const controller = room.controller!;
    if (creep.pos.getRangeTo(controller.pos) > 3) {
        creep.moveTo(controller.pos, { range: 3 });
        return;
    }
    creep.upgradeController(controller);

    const load = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    if (load === 0) {
        if (!depot) return;
        if (creep.pos.getRangeTo(depot.pos) > 1) {
            creep.moveTo(depot.pos, { range: 1 });
            return;
        }
        if (depot instanceof Resource) {
            creep.pickup(depot);
        } else {
            creep.withdraw(depot, RESOURCE_ENERGY);
        }
        return;
    }

    // 内圈喂外圈：邻位有空的升级工且更靠内时转赠
    const needy = creep.pos.findInRange(FIND_MY_CREEPS, 1).find((other) => {
        if (other.id === creep.id) return false;
        if ((other.memory as any).role !== 'upgrader') return false;
        return other.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    });
    if (needy) {
        creep.transfer(needy, RESOURCE_ENERGY);
    }
};

/** 建造执行：取能（沉淀点）→ 优先目标建造/维修 */
export const runBuilder = (
    creep: Creep,
    energyDepot: StructureStorage | StructureTerminal | StructureContainer | Resource | undefined,
    target: ConstructionSite | StructureRampart | undefined,
): void => {
    if (!target) return;
    if (creep.pos.getRangeTo(target.pos) > 3) {
        creep.moveTo(target.pos, { range: 3 });
        return;
    }
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        if (!energyDepot) return;
        if (creep.pos.getRangeTo(energyDepot.pos) > 1) {
            creep.moveTo(energyDepot.pos, { range: 1 });
            return;
        }
        if (energyDepot instanceof Resource) {
            creep.pickup(energyDepot);
        } else {
            creep.withdraw(energyDepot, RESOURCE_ENERGY);
        }
        return;
    }
    if (target instanceof ConstructionSite) {
        creep.build(target);
    } else {
        creep.repair(target);
    }
};
