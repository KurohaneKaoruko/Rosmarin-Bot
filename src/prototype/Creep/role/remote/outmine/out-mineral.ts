import { ROLES } from '@/constant/CreepConstant';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { runWorkLayer } from '@/prototype/Creep/family/flow/workLayer';
import { writeMoveWorkTileCandidates } from '@/modules/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/prototype/Creep/family/flow/workLayer';
import { isArrivedInRoom } from '@/prototype/Creep/shared/movement';

// 迁移条件集中声明：采满 -> 交付，空包 -> 继续采集
const OUT_MINERAL_SWITCH = {
    TO_TARGET: (creep: Creep) => creep.store.getFreeCapacity() === 0,
    TO_SOURCE: (creep: Creep) => creep.store.getUsedCapacity() === 0
} as const;

// 尝试交给附近 out-carry
const transferToNearbyCarrier = (creep: Creep): boolean => {
    const res = Object.keys(creep.store)[0] as ResourceConstant;
    const carriers = getRoomTickCacheValue(creep.room, 'out_mineral_carriers', () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === ROLES['out-carry']
        }) as Creep[]
    );
    const nearbyCarrier = carriers.find((c) =>
        c.store.getFreeCapacity(res) > 0 && creep.pos.inRangeTo(c, 1)
    );

    if (!nearbyCarrier) return false;
    return creep.transfer(nearbyCarrier, res) === OK;
};

// 没有容器时：仅施工已有 container 工地。
// 工地放置由 externalRoad 统一负责，这里不再直接 createConstructionSite。
const handleNoContainer = (creep: Creep) => {
    const site = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.my
    })[0];

    if (!site) {
        const mineral = creep.room.mineral || creep.room.find(FIND_MINERALS)[0];
        if (mineral && !creep.pos.inRangeTo(mineral, 1)) {
            creep.moveTo(mineral, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
        return;
    }

    if (creep.pos.inRangeTo(site, 2)) {
        creep.build(site);
        return;
    }

    const container = creep.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER
    })[0] as StructureContainer | undefined;
    if (container) creep.moveTo(container, { visualizePathStyle: { stroke: '#ffaa00' } });
};

// 有容器时：往容器存放
const handleWithContainer = (creep: Creep, container: StructureContainer) => {
    if (creep.pos.isEqualTo(container)) {
        const res = Object.keys(creep.store)[0] as ResourceConstant;
        creep.transfer(container, res);
        return;
    }
    creep.moveTo(container, { reusePath: 50, visualizePathStyle: { stroke: '#ffaa00' } });
};

// 采集阶段
const runSourcePhase = (creep: Creep): boolean => {
    if (!(isArrivedInRoom(creep, creep.memory.targetRoom))) {
        creep.moveToRoom(creep.memory.targetRoom);
        return false;
    }

    let mineral = creep.room.mineral;
    if (!mineral) {
        creep.room.update('mineral');
        mineral = creep.room.mineral;
    }

    if (mineral) {
        if (creep.pos.isNearTo(mineral)) {
            creep.harvest(mineral);
        } else {
            const dangerousHostiles = getRoomTickCacheValue(creep.room, 'out_mineral_dangerous_hostiles', () =>
                creep.room.find(FIND_HOSTILE_CREEPS, {
                    filter: (c) =>
                        !c.isWhiteList() &&
                        (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0)
                }) as Creep[]
            );
            if (dangerousHostiles.some((h) => h.pos.inRangeTo(mineral!, 3))) {
                syncOutMineralMoveWork(creep);
                if (creep.pos.x <= 1) creep.move(RIGHT);
                else if (creep.pos.x >= 48) creep.move(LEFT);
                else if (creep.pos.y <= 1) creep.move(BOTTOM);
                else if (creep.pos.y >= 48) creep.move(TOP);
                return false;
            }
            creep.moveTo(mineral, { maxRooms: 1 });
        }
    }

    const shouldSwitch = OUT_MINERAL_SWITCH.TO_TARGET(creep);
    if (!shouldSwitch) syncOutMineralMoveWork(creep);
    return shouldSwitch;
};

// 交付阶段
const runTargetPhase = (creep: Creep): boolean => {
    if (transferToNearbyCarrier(creep)) return OUT_MINERAL_SWITCH.TO_SOURCE(creep);

    const targetContainer = creep.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER
    })[0] as StructureContainer | undefined;

    if (!targetContainer) handleNoContainer(creep);
    else handleWithContainer(creep, targetContainer);

    return OUT_MINERAL_SWITCH.TO_SOURCE(creep);
};

const onTarget = (creep: Creep): WorkEvent => {
    const shouldSwitch = runTargetPhase(creep);
    return shouldSwitch ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    const shouldSwitch = runSourcePhase(creep);
    return shouldSwitch ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
};

export const syncOutMineralMoveWork = (creep: Creep) => {
    const mineral = creep.room.mineral || creep.room.find(FIND_MINERALS)[0];
    if (!creep.memory.working && mineral) {
        writeMoveWorkTileCandidates(creep, [{ pos: mineral.pos, range: 1 }]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

const outMineral = {
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource,
            onTarget
        });
    }
};

export default outMineral;
