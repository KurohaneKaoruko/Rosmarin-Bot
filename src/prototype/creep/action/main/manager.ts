/**
 * manage任务执行函数
 * @param {Creep} creep - 执行任务的 creep
 * @returns {boolean} - 是否成功执行任务
 */
function managerMission(creep: Creep): boolean {
    if(!creep.room.checkMissionInPool('manage')) return false;

    const task = creep.room.getMissionFromPoolFirst('manage') as Task;
    let source = null;
    let target = null;

    /** 获取结构对象 */
    const getStructure = (structureKey: string) => {
        return creep.room[structureKey] || null;
    };

    const taskdata = task.data as ManageTask

    source = getStructure(taskdata.source);
    target = getStructure(taskdata.target);

    if (!source || !target) {
        creep.room.deleteMissionFromPool('manage', task.id)
        return false;
    };
    if (!source.pos.inRange(target.pos, 2)) {
        creep.room.deleteMissionFromPool('manage', task.id)
        return false;
    }

    const type = taskdata.resourceType;
    const amount = taskdata.amount;
    
    // 如果任务数据不合法，则移除任务
    if(!amount || typeof amount !== 'number' || amount <= 0) {
        creep.room.deleteMissionFromPool('manage', task.id)
        return false;
    }

    // 如果身上有不是type的资源，先将其放到storage或terminal
    if (handleOtherResources(creep, type)) return true;

    if (creep.store.getUsedCapacity(type) === 0 && creep.store.getFreeCapacity() > 0) {
        // 提取资源
        if (source.store[type] === 0) {
            creep.room.deleteMissionFromPool('manage', task.id);
            return false;
        }
        const withdrawAmount = Math.min(amount, creep.store.getFreeCapacity(type), source.store[type]);
        const result = creep.withdraw(source, type, withdrawAmount);
        if (result == ERR_NOT_IN_RANGE) creep.moveTo(source,  { visualizePathStyle: { stroke: '#ffaa00' }})
        return true;
    } else {
        const transferResult = creep.transfer(target, type);

        if (transferResult === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, {visualizePathStyle: {stroke: '#ffaa00'}});
            return true;
        }

        if (transferResult === ERR_FULL) {
            creep.room.deleteMissionFromPool('manage', task.id);
            return true;
        }
    
        if (transferResult == OK) {
            const transferredAmount = Math.min(creep.store[type], amount);
            const data = task.data as TransportTask;
            data.amount -= transferredAmount;
            if (data.amount <= 0) {
                creep.room.deleteMissionFromPool('manage', task.id);
            }
        }
        
        return true;
    }
}

/**
 * 处理 creep 身上的其他资源
 * @param {Creep} creep - 需要处理的 creep
 * @param {string} targetType - 目标资源类型
 * @returns {boolean} - 是否处理了其他资源
 */
function handleOtherResources(creep: Creep, targetType: ResourceConstant): boolean {
    const resourceType = Object.keys(creep.store).find(type => type !== targetType && creep.store[type] > 0) as ResourceConstant;
    
    if (!resourceType) return false;

    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity() > 0) {
        creep.goTransfer(storage, resourceType);
        return true;
    }

    const terminal = creep.room.terminal;
    if (terminal && terminal.store.getFreeCapacity() > 0) {
        creep.goTransfer(terminal, resourceType);
        return true;
    }

    creep.say('FULL');

    return false;
}




function LinkEnergyTransfer(creep: Creep) {
    const storage = creep.room.storage;
    if (!storage) return;

    let controllerLink = null;
    let manageLink = null;
    let normalLink = [];
    for(const link of creep.room.link) {
        if (creep.room.source.some((source: any) => link.pos.inRangeTo(source, 2))) {
            continue;
        }
        if (link.pos.inRangeTo(creep.room.controller, 2)) {
            controllerLink = link;
            continue;
        }
        const center = Memory['RoomControlData'][creep.room.name]?.center;
        if (center && link.pos.inRangeTo(center.x, center.y, 1) && link.pos.inRangeTo(storage, 2)) {
            manageLink = link;
            continue;
        }
        normalLink.push(link);
    }

    if (!manageLink) return; // 没有中心Link，不执行任务

    // 向link转移能量
    if (controllerLink && controllerLink.store[RESOURCE_ENERGY] < 400) {
        if (manageLink?.store.getFreeCapacity(RESOURCE_ENERGY) < 100) {
            return; // 只在空余空间大于100时转移能量
        }
        if (creep.store[RESOURCE_ENERGY] >= 100) {  // 有能量时转移
            creep.goTransfer(manageLink, RESOURCE_ENERGY);
            return true;
        }
        // 如果身上有不是energy的资源，先将其放到storage或terminal
        if (handleOtherResources(creep, RESOURCE_ENERGY)) return true;
        const source = storage?.store[RESOURCE_ENERGY] > 0 ? storage : null;
        if (source) {
            creep.goWithdraw(source, RESOURCE_ENERGY);
            return true;
        } 
    }
    else if(normalLink.some((link: any) => link.store[RESOURCE_ENERGY] < 400)) {
        if (manageLink?.store.getFreeCapacity(RESOURCE_ENERGY) < 100) {
            return; // 只在空余空间大于100时转移能量
        }
        if (creep.store[RESOURCE_ENERGY] >= 100) {  // 有能量时转移
            creep.goTransfer(manageLink, RESOURCE_ENERGY);
            return true;
        }
        // 如果身上有不是energy的资源，先将其放到storage或terminal
        if (handleOtherResources(creep, RESOURCE_ENERGY)) return true;
        const source = storage?.store[RESOURCE_ENERGY] > 0 ? storage : null;
        if (source) {
            creep.goWithdraw(source, RESOURCE_ENERGY);
            return true;
        }
    }
    // 从link提取能量
    else if (manageLink?.store[RESOURCE_ENERGY] > 0) {
        // 如果身上有不是energy的资源，先将其放到storage或terminal
        if (handleOtherResources(creep, RESOURCE_ENERGY)) return true;
        if (creep.store.getFreeCapacity() > 0) {
            creep.goWithdraw(manageLink, RESOURCE_ENERGY);
            return true;
        }
    }
    return false
}


const ManagerAction = {
    run: function(creep: Creep) {
        if (!creep.memory.dontPullMe) creep.memory.dontPullMe = true;
        const storage = creep.room.storage;
        const terminal = creep.room.terminal;

        // 取放Link
        if (LinkEnergyTransfer(creep)) return;
    
        // 搬运任务
        if (managerMission(creep)) return;

        // 将身上的资源存放到storage、terminal中
        const resourceType = Object.keys(creep.store)[0] as ResourceConstant;
        const target = storage?.store.getFreeCapacity(RESOURCE_ENERGY) > 0 ? storage :
                        terminal?.store.getFreeCapacity(RESOURCE_ENERGY) > 0 ? terminal : null;
        if (target && resourceType && creep.store[resourceType] > 0) {
            creep.goTransfer(target, resourceType);
            return true;
        }
        
        // 没有任务时移动到布局中心
        const center = Memory['RoomControlData'][creep.room.name]?.center;
        if (center && creep.pos.inRangeTo(center.x, center.y, 2)) {
            const pos = new RoomPosition(center.x, center.y, creep.room.name);
            if (!creep.pos.isEqualTo(pos)) {
                creep.moveTo(pos, { visualizePathStyle: { stroke: '#ffffff' } });
                return;
            }
        }
        return;
    }
};

export default ManagerAction;
