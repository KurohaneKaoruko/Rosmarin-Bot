const CarryEnergySource = {
    tombstone: (creep) => findClosestUnclaimedResource(creep, FIND_TOMBSTONES, 100),
    ruin: (creep) => findClosestUnclaimedResource(creep, FIND_RUINS),
    container: (creep) => {
        const containers = creep.room.container
            .filter((c: StructureContainer) => c && !c.pos.inRangeTo(creep.room.controller, 1) &&
            (creep.room.storage ? c.store.getUsedCapacity() :
                c.store[RESOURCE_ENERGY]) > Math.min(666, creep.store.getFreeCapacity()));
        return creep.pos.findClosestByRange(containers);
    },
    storageOrTerminal: (creep) => {
        const storage = creep.room.storage;
        const terminal = creep.room.terminal;
        const cc = creep.room.container.find((c: StructureContainer) =>
                    c.pos.inRangeTo(creep.room.controller, 1));
        const cl = creep.room.link.find((l: StructureLink) =>
                    l.pos.inRangeTo(creep.room.controller, 2));
        if (creep.room.CheckSpawnAndTower() ||
            (!cl && cc?.store.getFreeCapacity(RESOURCE_ENERGY) > 500)) {
            if (storage?.store[RESOURCE_ENERGY] > 1000 &&
                terminal?.store[RESOURCE_ENERGY] > 1000 &&
                storage?.store[RESOURCE_ENERGY] < terminal?.store[RESOURCE_ENERGY]) return terminal;
            if (storage?.store[RESOURCE_ENERGY] > 1000) return storage;
            if (terminal?.store[RESOURCE_ENERGY] > 1000) return terminal;
        }
        if (storage && terminal && terminal.store[RESOURCE_ENERGY] > 10000 &&
            storage.store.getFreeCapacity() > 10000 &&
            terminal.store[RESOURCE_ENERGY] > storage.store[RESOURCE_ENERGY]) return terminal;
        return null;
    }
};

const findClosestUnclaimedResource = (creep, findConstant, minAmount = 0) => {
    const resources = creep.room.find(findConstant, {
        filter: r => (creep.room.storage ? r.store.getUsedCapacity() : r.store[RESOURCE_ENERGY]) > minAmount
    });
    const closestResource = creep.pos.findClosestByRange(resources);
    if (!closestResource) return null;
    const otherTransporters = _.filter(Memory.creeps, c => 
        c.role === 'carrier' && c.cache?.targetId === closestResource.id
    );
    return otherTransporters.length === 0 ? closestResource : null;
};

const checkAndFillNearbyExtensions = (creep) => {
    const { pos, room, store, memory } = creep;
    
    const energyAvailable = store[RESOURCE_ENERGY];
    if (energyAvailable <= 50 || !room.storage || pos.getRangeTo(room.storage) > 10) {
        return false;
    }

    const lastPos = memory.lastCheckPos;
    const totalMove = lastPos ? Math.abs(lastPos.x - pos.x) + Math.abs(lastPos.y - pos.y) : 2;

    if (!memory.nearbyExtensions || totalMove > 1) {
        memory.nearbyExtensions = room.lookForAtArea(
            LOOK_STRUCTURES,
            Math.max(0, pos.y - 1), Math.max(0, pos.x - 1),
            Math.min(49, pos.y + 1), Math.min(49, pos.x + 1),
            true
        ).filter(item => 
            item.structure.structureType === STRUCTURE_EXTENSION && 
            item.structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        ).map(item => item.structure.id);
        memory.lastCheckPos = { x: pos.x, y: pos.y };
    }

    const extensionToFill = memory.nearbyExtensions.find(id => {
        const extension = Game.getObjectById(id) as StructureExtension;
        return extension && extension.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    });
    
    if (extensionToFill) {
        const result = creep.transfer(Game.getObjectById(extensionToFill), RESOURCE_ENERGY);
        if (result === OK) {
            memory.nearbyExtensions = memory.nearbyExtensions.filter(e => e !== extensionToFill);
            if (memory.nearbyExtensions && memory.nearbyExtensions.length === 0) {
                delete memory.nearbyExtensions;
            }
            return true;
        }
    }

    return false;
};

const withdraw = (creep) => {
    const { pos, store, memory } = creep;

    const controllerContainer = creep.room.container?.find((c: StructureContainer) =>
        c.pos.inRangeTo(creep.room.controller, 1));

    if (!creep.room.CheckSpawnAndTower() && !controllerContainer &&
        !creep.room.storage && !creep.room.terminal) return false;

    // 收集掉落的资源
    const droppedResource = pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType !== RESOURCE_ENERGY
    }) || pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 500
    })
    if (droppedResource && creep.room.storage) {
        memory.dropWithdraw = true;
        if (pos.inRangeTo(droppedResource, 1)) {
            const result = creep.pickup(droppedResource);
            if (result == OK && droppedResource.amount >= store.getFreeCapacity()) {
                return true;
            }
        } else {
            creep.moveTo(droppedResource, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
        return;
    }
    if (memory.dropWithdraw) memory.dropWithdraw = false;

    // 从建筑收集资源
    if (!memory.cache.targetId) {
        const target = CarryEnergySource.tombstone(creep) || CarryEnergySource.ruin(creep) ||
                       CarryEnergySource.container(creep) || CarryEnergySource.storageOrTerminal(creep);
        if (target) {
            memory.cache.targetId = target.id;
            memory.cache.resourceType = Object.keys(target.store)[0];
        }
    }
    const target = Game.getObjectById(memory.cache.targetId) as StructureContainer | StructureStorage | StructureTerminal | StructureLink;
    if (!target || (target.store.getUsedCapacity()||0) === 0) {
        delete memory.cache.targetId;
        return;
    }
    if (pos.inRangeTo(target, 1)) {
        const resourceType = creep.room.storage ? Object.keys(target.store)[0] : RESOURCE_ENERGY;
        const result = creep.withdraw(target, resourceType);
        if(result == OK && target.store[resourceType] >= store.getFreeCapacity()){
            return true;
        }
    } else {
        creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
    }
};

const carry = (creep: any) => {
    const { memory, store, room, pos } = creep;

    let target = Game.getObjectById(memory.cache.targetId) as any;

    // 找目标
    if (!target || !store[memory.cache.resourceType] || !target.store.getFreeCapacity(memory.cache.resourceType)) {
        const controllerContainer = creep.room.container.find((c: StructureContainer) =>
                                    c.pos.inRangeTo(creep.room.controller, 1));
        const controllerLink = creep.room.link.find((l: StructureLink) =>
                                    l.pos.inRangeTo(creep.room.controller, 2));
        if (!memory.dropWithdraw && store[RESOURCE_ENERGY] > 0 && room.CheckSpawnAndTower()) {
            const spawnExtensions = (room.spawn?.concat(room.extension) ?? [])
                        .filter((e: StructureExtension) => e?.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
            target = creep.pos.findClosestByRange(spawnExtensions) || 
                     creep.pos.findClosestByRange((room.tower || [])
                        .filter((t: StructureTower) => t?.store.getFreeCapacity(RESOURCE_ENERGY) > 100));
            if(!target){
                const powerSpawn = room.powerSpawn || null;
                if(powerSpawn && powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY) > 100){
                    target = powerSpawn;
                }
            }
            if (target) {
                memory.cache.targetId = target.id;
                memory.cache.resourceType = RESOURCE_ENERGY;
            }
        }
        else if (!memory.dropWithdraw && !controllerLink && controllerContainer && store[RESOURCE_ENERGY] > 0 && controllerContainer.store.getFreeCapacity() > 0) {
            memory.cache.targetId = controllerContainer.id;
            memory.cache.resourceType = RESOURCE_ENERGY;
        }
        else {
            target = [room.storage, room.terminal].find(s => s?.store.getFreeCapacity() > 0);
            if (target) {
                memory.cache.targetId = target.id;
                memory.cache.resourceType = Object.keys(store)[0];
            }
        }
    }

    if (target) {
        if (pos.inRangeTo(target, 1)) {
            const isStorageOrTerminal = [STRUCTURE_STORAGE, STRUCTURE_TERMINAL].includes(target.structureType);
            const resourceType = isStorageOrTerminal ? Object.keys(store)[0] : RESOURCE_ENERGY;
            const result = creep.transfer(target, resourceType);
            if (result === OK) {
                delete memory.cache.targetId;
                delete memory.cache.resourceType;
                if (Object.keys(store).length == 1 &&
                    target.store.getFreeCapacity(resourceType) >= store[resourceType]) {
                    return true;
                }
            }
        } else {
            creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
        }
        return;
    }
};

const GoGenerateSafeMode = (creep: Creep) => {
    const controller = creep.room.controller;
    if (!controller || !controller.my || controller.level < 7 ||
        controller.safeModeAvailable > 0) {
        return false;
    }
    if (creep.store[RESOURCE_GHODIUM] < 1000) {
        if (creep.store.getCapacity() < 1000) return false;
        const target = [creep.room.storage, creep.room.terminal].find(s => s && s.store[RESOURCE_GHODIUM] >= 1000);
        if (!target) return false;
        creep.goWithdraw(target, RESOURCE_GHODIUM, 1000);
        return true;
    }
    else if (creep.store[RESOURCE_GHODIUM] >= 1000) {
        if(creep.pos.isNearTo(controller)){
            creep.generateSafeMode(controller);
        } else{
            creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
        }
    } else return false
}



const CarrierFunction = {
    source: (creep: any) => {
        if (!creep.moveHomeRoom()) return;
        if (creep.store.getFreeCapacity() === 0) return true;
        if (GoGenerateSafeMode(creep)) return;
        return withdraw(creep);
    },
    target: (creep: any) => {
        if (!creep.moveHomeRoom()) return;
        if (creep.store.getUsedCapacity() === 0) return true;
        if (checkAndFillNearbyExtensions(creep)) return;
        return carry(creep);
    },
};

export default CarrierFunction;
