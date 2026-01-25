
const Transport = {
    run: function(creep: Creep) {
        const roomAny = creep.room as any;
        const canAutoStore = (s: AnyStoreStructure, resource: ResourceConstant) => {
            if (!s) return false;
            switch (s.structureType) {
                case STRUCTURE_POWER_SPAWN:
                    return resource === RESOURCE_ENERGY || resource === RESOURCE_POWER;
                case STRUCTURE_NUKER:
                    return resource === RESOURCE_ENERGY || resource === RESOURCE_GHODIUM;
                case STRUCTURE_LAB:
                    return resource === RESOURCE_ENERGY;
                case STRUCTURE_FACTORY:
                    return resource === RESOURCE_ENERGY;
                case STRUCTURE_CONTAINER:
                    return !isSourceContainer(s);
                default:
                    return true;
            }
        };
        const isSourceContainer = (s: AnyStoreStructure) => {
            if (!s || s.structureType !== STRUCTURE_CONTAINER) return false;
            return creep.room.source?.some((src: Source) => src && s.pos.inRangeTo(src.pos, 2));
        };
        // 如果没有任务，则接取任务. 如果即将死亡，则不接取任务
        if (!creep.memory.mission && creep.ticksToLive > 20) {
            creep.memory.mission = creep.room.getTransportMission(creep);
        }
    
        // 如果接取不到任务，检查身上是否有资源，如果有则运输回storage. 如果即将死亡，则立刻运输回storage
        if (!creep.memory.mission || creep.ticksToLive < 20) {
            if(creep.store.getUsedCapacity() === 0) return;
            const resource = Object.keys(creep.store)[0] as ResourceConstant;
            if (!resource) return;

            const candidates: AnyStoreStructure[] = [
                creep.room.storage,
                creep.room.terminal,
                roomAny.factory,
                roomAny.powerSpawn,
                roomAny.nuker,
                ...(roomAny.lab || []),
                ...(roomAny.container || []),
            ].filter(Boolean) as AnyStoreStructure[];

            const target = candidates.find(s => canAutoStore(s, resource) && s.store?.getFreeCapacity(resource) > 0) || null;
            if (!target) {
                creep.drop(resource);
                return;
            }

            const result = creep.transfer(target, resource);
            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { range: 1 });
            } else if (result === ERR_FULL) {
                creep.drop(resource);
            }
            return;
        }
    
        let storage = creep.room.storage;
        let terminal = creep.room.terminal;
        if(!storage) return;
    
        // 获取任务信息
        const getMissionData = function() {
            let mission = creep.memory.mission;
            let { source, target, resourceType, amount} = mission.data as TransportTask;
            let targetObj = Game.getObjectById(target) as AnyStoreStructure;
            let sourceObj = Game.getObjectById(source) as AnyStoreStructure;
            return { mission, sourceObj, targetObj, resourceType, amount };
        }
    
        const { mission, sourceObj, targetObj, resourceType, amount } = getMissionData();
    
        // 如果target已满，移除当前任务
        if(!targetObj || targetObj.store.getFreeCapacity(resourceType) === 0) {
            creep.room.deleteMissionFromPool('transport', mission.id);
            delete creep.memory.mission;
            return;
        }
    
        // 如果没有足够的资源，移除当前任务
        if (!sourceObj || creep.store[resourceType] + sourceObj.store[resourceType] < amount) {
            creep.room.deleteMissionFromPool('transport', mission.id);
            delete creep.memory.mission;
            return;
        }
    
        // 如果身上有多余资源，先将其放入storage
        if (creep.store.getUsedCapacity() > 0 && Object.keys(creep.store).some(r => r !== resourceType)) {
            for (let resource in creep.store) {
                if (resource === resourceType) continue;
                const res = resource as ResourceConstant;
                const candidates: AnyStoreStructure[] = [
                    storage,
                    terminal,
                    roomAny.factory,
                    roomAny.powerSpawn,
                    roomAny.nuker,
                    ...(roomAny.lab || []),
                    ...(roomAny.container || []),
                ].filter(Boolean) as AnyStoreStructure[];
                const extraTarget = candidates.find(s => !isSourceContainer(s) && canAutoStore(s, res) && s.store?.getFreeCapacity(res) > 0) || null;
                if (extraTarget) {
                    creep.goTransfer(extraTarget, res);
                } else if (creep.store[res] > 0) {
                    creep.drop(res);
                }
                return;
            }
        }
    
        // 提前做好下一个任务的移动
        const missionMove = function(nextTickResAmount?: number,resType?: ResourceConstant) {
            const { sourceObj, targetObj, resourceType, amount } = getMissionData();
            if (resType != resourceType || nextTickResAmount < amount) {
                creep.moveTo(sourceObj, {
                    visualizePathStyle: { stroke: '#ffaa00' },
                    maxRooms: 1,
                    range: 1
                });
            } else {
                creep.moveTo(targetObj, {
                    visualizePathStyle: { stroke: '#ffffff' },
                    maxRooms: 1,
                    range: 1
                });
            }
        }
    
        
        // 如果creep没有足够的指定资源，从source获取
        if (creep.store.getFreeCapacity(resourceType) > 0 && creep.store[resourceType] < amount) {
            if (creep.pos.isNearTo(sourceObj)) {
                const result = creep.withdraw(sourceObj, resourceType);
                if(result === OK && !creep.pos.isNearTo(targetObj)) {
                    creep.moveTo(targetObj.pos, {
                        visualizePathStyle: { stroke: '#ffffff' },
                        maxRooms: 1,
                        range: 1
                    });
                }
            } else {
                creep.moveTo(sourceObj, {
                    visualizePathStyle: { stroke: '#ffaa00' },
                    maxRooms: 1,
                    range: 1
                });
            }
        } 
        // 如果creep有足够的指定资源，将其转移到target
        else {
            // 尝试向目标转移资源
            if(creep.pos.isNearTo(targetObj)) {
                const result = creep.transfer(targetObj, resourceType,
                    Math.min(amount, creep.store[resourceType], targetObj.store.getFreeCapacity(resourceType)));
                if(result === OK) {
                    // 如果任务完成，提交任务并获取新任务
                    creep.room.submitTransportMission(mission.id, Math.min(amount, creep.store[resourceType]));
                    creep.memory.mission = creep.room.getTransportMission(creep);
                    const nextTickResAmount = (creep.store[resourceType] - amount) || 0;
                    if(creep.memory.mission) missionMove(nextTickResAmount, resourceType);
                } else if(result === ERR_FULL || result === ERR_INVALID_TARGET) {
                    // 如果无法转移, 删除任务并获取新任务
                    creep.room.deleteMissionFromPool('transport', mission.id);
                    creep.memory.mission = creep.room.getTransportMission(creep);
                    const nextTickResAmount = (creep.store[resourceType] - amount) || 0;
                    if(creep.memory.mission) missionMove(nextTickResAmount, resourceType);
                }
            } else {
                creep.moveTo(targetObj,
                    { visualizePathStyle: { stroke: '#ffffff' },
                    maxRooms: 1,
                    range: 1
                });
            }
        }
    }
}


export default Transport;
