// 查找最近的未被其他 carrier 占用的资源
const findClosestUnclaimedResource = (creep: Creep, findConstant: FindConstant, minAmount = 0): Tombstone | Ruin | null => {
    const hasStorage = !!creep.room.storage;
    const resources = creep.room.find(findConstant, {
        filter: (r: Tombstone | Ruin) => 
            (hasStorage ? r.store.getUsedCapacity() : r.store[RESOURCE_ENERGY]) > minAmount
    }) as (Tombstone | Ruin)[];
    
    const closest = creep.pos.findClosestByRange(resources);
    if (!closest) return null;
    
    // 检查是否有其他 carrier 已锁定该目标
    for (const name in Memory.creeps) {
        const mem = Memory.creeps[name];
        if (mem.role === 'carrier' && mem.cache?.targetId === closest.id) {
            return null;
        }
    }
    return closest;
};

// 获取 storage 或 terminal 作为能量来源
const getStorageOrTerminal = (creep: Creep) => {
    const { storage, terminal, container, link, controller } = creep.room as any;
    if (!storage && !terminal) return null;
    
    const controllerContainer = container?.find((c: StructureContainer) => c.pos.inRangeTo(controller, 1));
    const controllerLink = link?.find((l: StructureLink) => l.pos.inRangeTo(controller, 2));
    
    const needEnergy = creep.room.CheckSpawnAndTower() || 
                       (!controllerLink && controllerContainer?.store.getFreeCapacity(RESOURCE_ENERGY) > 500);
    
    const storageEnergy = storage?.store[RESOURCE_ENERGY] || 0;
    const terminalEnergy = terminal?.store[RESOURCE_ENERGY] || 0;
    
    if (needEnergy) {
        // 优先从能量更多的结构取
        if (storageEnergy > 1000 && terminalEnergy > 1000) {
            return storageEnergy < terminalEnergy ? terminal : storage;
        }
        if (storageEnergy > 1000) return storage;
        if (terminalEnergy > 1000) return terminal;
    }
    
    // 平衡 terminal 和 storage 的能量
    if (terminal && storage && terminalEnergy > 10000 && 
        storage.store.getFreeCapacity() > 10000 && terminalEnergy > storageEnergy) {
        return terminal;
    }
    
    return null;
};

// 路过时顺便填充附近的 extension
const checkAndFillNearbyExtensions = (creep: Creep) => {
    const { pos, room, store, memory } = creep;
    const energyAvailable = store[RESOURCE_ENERGY];
    
    if (energyAvailable <= 50 || !room.storage || pos.getRangeTo(room.storage) > 10) {
        return false;
    }

    const lastPos = memory.lastCheckPos as { x: number; y: number } | undefined;
    const moved = lastPos ? Math.abs(lastPos.x - pos.x) + Math.abs(lastPos.y - pos.y) : 2;

    // 移动超过1格时重新扫描附近 extension
    if (!memory.nearbyExtensions || moved > 1) {
        const structures = room.lookForAtArea(
            LOOK_STRUCTURES,
            Math.max(0, pos.y - 1), Math.max(0, pos.x - 1),
            Math.min(49, pos.y + 1), Math.min(49, pos.x + 1),
            true
        );
        memory.nearbyExtensions = structures
            .filter(item => 
                item.structure.structureType === STRUCTURE_EXTENSION && 
                (item.structure as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0
            )
            .map(item => item.structure.id);
        memory.lastCheckPos = { x: pos.x, y: pos.y };
    }

    const extensions = memory.nearbyExtensions as Id<StructureExtension>[];
    for (let i = 0; i < extensions.length; i++) {
        const ext = Game.getObjectById(extensions[i]);
        if (ext?.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            if (creep.transfer(ext, RESOURCE_ENERGY) === OK) {
                extensions.splice(i, 1);
                if (extensions.length === 0) delete memory.nearbyExtensions;
                return true;
            }
        }
    }
    return false;
};

// 收集资源阶段
const withdraw = (creep: Creep) => {
    const { pos, store, memory, room } = creep;
    const roomAny = room as any;
    const cache = memory.cache as { targetId?: Id<any>; resourceType?: ResourceConstant };

    const controllerContainer = roomAny.container?.find((c: StructureContainer) =>
        c.pos.inRangeTo(room.controller, 1));

    // 检查是否需要运输
    if (!room.CheckSpawnAndTower() && !controllerContainer && !room.storage && !room.terminal) {
        return false;
    }

    // 优先收集掉落资源
    if (room.storage) {
        // 非能量资源优先
        const nonEnergy = pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
            filter: (r: Resource) => r.resourceType !== RESOURCE_ENERGY
        });
        if (nonEnergy) {
            memory.dropWithdraw = true;
            creep.goPickup(nonEnergy);
            return pos.inRangeTo(nonEnergy, 1) && nonEnergy.amount >= store.getFreeCapacity();
        }
        // 大量能量 (>500)
        if (creep.collectDroppedResource(RESOURCE_ENERGY, 500)) {
            memory.dropWithdraw = true;
            return;
        }
    }
    if (memory.dropWithdraw) memory.dropWithdraw = false;

    // 从建筑收集资源
    if (!cache.targetId) {
        // 优先墓碑和废墟
        const tombstone = findClosestUnclaimedResource(creep, FIND_TOMBSTONES, 100);
        const ruin = !tombstone ? findClosestUnclaimedResource(creep, FIND_RUINS) : null;
        const target = tombstone || ruin;
        
        if (target) {
            cache.targetId = target.id as Id<any>;
            cache.resourceType = Object.keys(target.store)[0] as ResourceConstant;
        } else {
            const minAmount = Math.min(666, store.getFreeCapacity());
            
            if (!room.storage) {
                // 无 storage 时只收集能量
                if (creep.collectFromContainer(minAmount, RESOURCE_ENERGY, true)) return;
            } else {
                // 有 storage 时收集任意资源
                const containers = (roomAny.container || []).filter((c: StructureContainer) => 
                    c && !c.pos.inRangeTo(room.controller!, 1) && c.store.getUsedCapacity() > minAmount
                ) as StructureContainer[];
                const containerTarget = pos.findClosestByRange(containers);
                if (containerTarget) {
                    cache.targetId = containerTarget.id;
                    cache.resourceType = Object.keys(containerTarget.store)[0] as ResourceConstant;
                }
            }
            
            // 尝试从 storage/terminal 收集
            if (!cache.targetId) {
                const storageTarget = getStorageOrTerminal(creep);
                if (storageTarget) {
                    cache.targetId = storageTarget.id;
                    cache.resourceType = Object.keys(storageTarget.store)[0] as ResourceConstant;
                }
            }
        }
    }

    const target = Game.getObjectById(cache.targetId);
    if (!target || !(target as any).store?.getUsedCapacity()) {
        delete cache.targetId;
        return;
    }

    if (pos.inRangeTo(target, 1)) {
        const resourceType = room.storage ? (Object.keys((target as any).store)[0] as ResourceConstant) : RESOURCE_ENERGY;
        const result = creep.withdraw(target as any, resourceType);
        return result === OK && (target as any).store[resourceType] >= store.getFreeCapacity();
    }
    
    creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
};

// 运送资源阶段
const carry = (creep: Creep) => {
    const { memory, store, room, pos } = creep;
    const roomAny = room as any;
    const cache = memory.cache as { targetId?: Id<any>; resourceType?: ResourceConstant };

    let target = Game.getObjectById(cache.targetId) as AnyStoreStructure | null;

    // 寻找目标
    if (!target || !store[cache.resourceType!] || !target.store.getFreeCapacity(cache.resourceType)) {
        const controllerContainer = roomAny.container?.find((c: StructureContainer) =>
            c.pos.inRangeTo(room.controller, 1));
        const controllerLink = roomAny.link?.find((l: StructureLink) =>
            l.pos.inRangeTo(room.controller, 2));

        if (!memory.dropWithdraw && store[RESOURCE_ENERGY] > 0 && room.CheckSpawnAndTower()) {
            // 填充 spawn/extension/tower
            const spawnExtensions = [...(roomAny.spawn || []), ...(roomAny.extension || [])]
                .filter((e: StructureSpawn | StructureExtension) => e?.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
            
            target = pos.findClosestByRange(spawnExtensions) ||
                     pos.findClosestByRange((roomAny.tower || [])
                        .filter((t: StructureTower) => t?.store.getFreeCapacity(RESOURCE_ENERGY) > 100));
            
            if (!target && roomAny.powerSpawn?.store.getFreeCapacity(RESOURCE_ENERGY) > 100) {
                target = roomAny.powerSpawn;
            }
            
            if (target) {
                cache.targetId = target.id;
                cache.resourceType = RESOURCE_ENERGY;
            }
        } else if (!memory.dropWithdraw && !controllerLink && controllerContainer && 
                   store[RESOURCE_ENERGY] > 0 && controllerContainer.store.getFreeCapacity() > 0) {
            // 填充控制器容器
            cache.targetId = controllerContainer.id;
            cache.resourceType = RESOURCE_ENERGY;
            target = controllerContainer;
        } else {
            // 存入 storage/terminal
            target = [room.storage, room.terminal].find(s => s?.store.getFreeCapacity() > 0) || null;
            if (target) {
                cache.targetId = target.id;
                cache.resourceType = Object.keys(store)[0] as ResourceConstant;
            }
        }
    }

    if (!target) return;

    if (pos.inRangeTo(target, 1)) {
        const isStorage = target.structureType === STRUCTURE_STORAGE || target.structureType === STRUCTURE_TERMINAL;
        const resourceType = isStorage ? (Object.keys(store)[0] as ResourceConstant) : RESOURCE_ENERGY;
        
        if (creep.transfer(target, resourceType) === OK) {
            delete cache.targetId;
            delete cache.resourceType;
            // 检查是否完成所有资源转移
            const storeKeys = Object.keys(store);
            if (storeKeys.length === 1 && target.store.getFreeCapacity(resourceType) >= store[resourceType]) {
                return true;
            }
        }
    } else {
        creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
    }
};

// 生成安全模式
const goGenerateSafeMode = (creep: Creep): boolean => {
    const controller = creep.room.controller;
    if (!controller?.my || controller.level < 7 || controller.safeModeAvailable > 0) {
        return false;
    }
    
    const ghodiumNeeded = 1000;
    if (creep.store[RESOURCE_GHODIUM] < ghodiumNeeded) {
        if (creep.store.getCapacity() < ghodiumNeeded) return false;
        
        const source = [creep.room.storage, creep.room.terminal]
            .find(s => s && s.store[RESOURCE_GHODIUM] >= ghodiumNeeded);
        if (!source) return false;
        
        creep.goWithdraw(source, RESOURCE_GHODIUM, ghodiumNeeded);
        return true;
    }
    
    if (creep.pos.isNearTo(controller)) {
        creep.generateSafeMode(controller);
    } else {
        creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
    }
    return true;
};



// Carrier 主逻辑
const CarrierFunction = {
    source: (creep: Creep) => {
        if (!creep.moveHomeRoom()) return;
        if (creep.store.getFreeCapacity() === 0) return true;
        if (goGenerateSafeMode(creep)) return;
        return withdraw(creep);
    },
    target: (creep: Creep) => {
        if (!creep.moveHomeRoom()) return;
        if (creep.store.getUsedCapacity() === 0) return true;
        if (checkAndFillNearbyExtensions(creep)) return;
        return carry(creep);
    },
};

export default CarrierFunction;
