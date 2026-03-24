import { runWorkLayer } from '@/framework/ai/adapters';
import { writeMoveWorkTileCandidates } from '@/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';

export const syncMineralMoveWork = (creep: Creep) => {
    const mineral = creep.room.mineral || creep.room.find(FIND_MINERALS)[0];
    if (!creep.memory.working && mineral) {
        writeMoveWorkTileCandidates(creep, [{ pos: mineral.pos, range: 1 }]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

const onSource = (creep: Creep): WorkEvent => {
    const mineral = creep.room.mineral;
    if (!mineral) {
        return WORK_EVENTS.STAY;
    }

    // 检查矿物点是否有提取器
    if (!creep.room.extractor) {
        creep.say('无提取器');
        syncMineralMoveWork(creep);
        return WORK_EVENTS.STAY;
    }

    // 移动到矿物存储桶
    const mineralContainer = creep.room.container.find(c => c.pos.inRangeTo(creep.room.mineral, 1)) || null;
    if (!mineralContainer) {
        syncMineralMoveWork(creep);
        return WORK_EVENTS.STAY;
    }
    if (!creep.pos.isEqualTo(mineralContainer)) {
        creep.moveTo(mineralContainer, { maxRooms: 1, range: 0 });
    } else {
        // 如果矿物未枯竭，则开始采集
        if (mineral.mineralAmount > 0) {
            if (creep.pos.isNearTo(mineral)) {
                creep.harvest(mineral);
            } else {
                creep.moveTo(mineral, { maxRooms: 1, range: 1 });
            }
        } else {
            creep.suicide();
            return WORK_EVENTS.STAY;
        }
    }

    const full = creep.store.getFreeCapacity() === 0 && creep.store.getUsedCapacity() > 0;
    if (!full) syncMineralMoveWork(creep);
    return full ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
};

const onTarget = (creep: Creep): WorkEvent => {
    creep.memory.cacheTarget = creep.memory.cacheTarget || {}
    const cache = creep.memory.cacheTarget
    // 如果没有缓存存储目标，则寻找存储目标
    if (!cache.targetId) {
        const mineralContainer = creep.room.container.find(c => c.pos.inRangeTo(creep.room.mineral, 1)) || null;
        if(!mineralContainer &&
            creep.room.level >= 6 &&
            creep.pos.inRange(creep.room.mineral.pos, 1) &&
            creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 2)
            .filter(cs => cs.structureType === STRUCTURE_CONTAINER).length === 0) {
                creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
            return WORK_EVENTS.STAY;
        }
        const target = (mineralContainer && mineralContainer.store.getFreeCapacity() > 0) ?
                        mineralContainer : null;

        if (target) {
            cache.targetId = target.id;
        } else {
            return WORK_EVENTS.STAY;
        }
    }

    const target = Game.getObjectById(cache.targetId) as StructureContainer | StructureStorage | StructureTerminal;
    if (!target || target.store.getFreeCapacity() === 0) {
        delete cache.targetId;
        return WORK_EVENTS.STAY;
    }

    const resourceType = Object.keys(creep.store)[0] as ResourceConstant;
    if (creep.transfer(target, resourceType) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
    }

    return creep.store.getUsedCapacity() === 0 ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
};

const MineralAction = {
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource: ({ creep }) => onSource(creep),
            onTarget: ({ creep }) => onTarget(creep),
        });
    }
};

export default MineralAction;
