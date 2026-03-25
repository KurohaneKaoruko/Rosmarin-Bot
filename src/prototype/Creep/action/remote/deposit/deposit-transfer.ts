import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { runWorkLayer } from '@/framework/ai/adapters';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

const getDepositTransferSourceCache = (creep: Creep): Record<string, any> => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    return (cache.source && typeof cache.source === 'object' ? cache.source : (cache.source = {})) as Record<string, any>;
};

// 提取 store 中第一个非能量资源，避免 Object.keys 直接退化成 string。
const getFirstNonEnergyResource = (store: StoreDefinition): ResourceConstant | null => {
    const resourceTypes = Object.keys(store) as ResourceConstant[];
    return resourceTypes.find((type) => type !== RESOURCE_ENERGY && store[type] > 0) || null;
};

// 提取 creep 当前携带的第一个资源类型。
const getFirstCarriedResource = (creep: Creep): ResourceConstant | null => {
    const resourceTypes = Object.keys(creep.store) as ResourceConstant[];
    return resourceTypes.find((type) => creep.store[type] > 0) || null;
};

const onSource = (creep: Creep): WorkEvent => {
    const cache = getDepositTransferSourceCache(creep);
    const sourceRoom = creep.memory.sourceRoom;
    creep.disableAttackNotificationsOnce();
    
    if((creep.memory.longMoveEnd||0) > 0 && (creep.memory.longMoveStart||0) > 0) {
        let tick = creep.memory.longMoveEnd - creep.memory.longMoveStart;
        if(tick < 0) tick = 0;
        if (creep.ticksToLive < tick + 50 && creep.store.getUsedCapacity() > 0) {
            return WORK_EVENTS.TO_TARGET;
        }
    }
    else{
        if(creep.ticksToLive < 200 && creep.store.getUsedCapacity() > 0){
            return WORK_EVENTS.TO_TARGET;
        }
    }

    const target = Game.getObjectById(cache.targetId) as any;
    const targetType = cache.targetType;
    if (target) {
        if (targetType === 'dropped' && target.amount > 0) {
            creep.goPickup(target);
            return creep.store.getFreeCapacity() == 0 ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
        } else if (targetType === 'tombstone' && target.store.getUsedCapacity() > 0) {
            const resourceType = getFirstNonEnergyResource(target.store);
            if (!resourceType) return WORK_EVENTS.STAY;
            creep.goWithdraw(target, resourceType);
            return creep.store.getFreeCapacity() == 0 ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
        } else if (targetType === 'harvester' && !creep.pos.isNearTo(target)) {
            creep.moveTo(target);
            return WORK_EVENTS.STAY;
        }
    }

    const droppedResources = creep.room.find(FIND_DROPPED_RESOURCES).filter(s => s.resourceType !== RESOURCE_ENERGY);
    if (droppedResources.length > 0) {
        const closestResource = creep.pos.findClosestByRange(droppedResources);
        cache.targetId = closestResource.id;
        cache.targetType = 'dropped';
        creep.goPickup(closestResource);
        return creep.store.getFreeCapacity() == 0 ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
    }
    const tombstones = creep.room.find(FIND_TOMBSTONES, {
        filter: (s:any) => s.store.getUsedCapacity() > 0 && Object.keys(s.store).some(type => type !== RESOURCE_ENERGY)
    });
    if (tombstones.length > 0) {
        const closestTombstone = creep.pos.findClosestByRange(tombstones);
        cache.targetId = closestTombstone.id;
        cache.targetType = 'tombstone';
        const resourceType = getFirstNonEnergyResource(closestTombstone.store);
        if (!resourceType) return WORK_EVENTS.STAY;
        creep.goWithdraw(closestTombstone, resourceType);
        return creep.store.getFreeCapacity() == 0 ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
    }

    if(!creep.memory.longMoveStart) creep.memory.longMoveStart = Game.time;
    if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        let opt = {};
        if (sourceRoom && creep.room.name != sourceRoom)
            opt = { ignoreCreeps: false };
        creep.moveToRoom(creep.memory.targetRoom, opt);
        return WORK_EVENTS.STAY;
    }

    const harvesters = getRoomTickCacheValue(creep.room, 'deposit_transfer_harvesters', () =>
        creep.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'deposit-harvest' &&
                c.room.name === c.memory.targetRoom &&
                c.store.getUsedCapacity() > 0
        }) as Creep[]
    );
    const activeHarvesters = harvesters.filter((harvester) => harvester.store.getUsedCapacity() > 0);
    if (activeHarvesters.length > 0) {
        let closestHarvester = creep.pos.findClosestByRange(activeHarvesters, {
            filter: (creep: Creep) => creep.store.getFreeCapacity() == 0
        });
        if (!closestHarvester) closestHarvester = creep.pos.findClosestByRange(activeHarvesters);
        if (!creep.pos.isNearTo(closestHarvester)) {
            cache.targetId = closestHarvester.id;
            cache.targetType = 'harvester';
            creep.moveTo(closestHarvester, { visualizePathStyle: { stroke: '#00ff00' }, ignoreCreeps: false });
            return creep.store.getFreeCapacity() == 0 ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
        }
    }

    const deposits = creep.room.deposit || creep.room.find(FIND_DEPOSITS);
    if (deposits.length == 1) {
        const deposit = deposits[0];
        if (deposit && !creep.pos.inRangeTo(deposit, 3)) {
            creep.moveTo(deposit, {
                visualizePathStyle: { stroke: '#00ff00' },
                ignoreCreeps: false,
                range: 3
            });
        }
    } else if (deposits.length > 1) {
        const deposit = deposits.reduce((a, b) => a.lastCooldown < b.lastCooldown ? a : b);
        if (deposit && !creep.pos.inRangeTo(deposit, 3)) {
            creep.moveTo(deposit, {
                visualizePathStyle: { stroke: '#00ff00' },
                ignoreCreeps: false,
                range: 3
            })
        }
    }
    
    if (!creep.memory.longMoveEnd) creep.memory.longMoveEnd = Game.time;

    return creep.store.getFreeCapacity() == 0 ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
};

const onTarget = (creep: Creep): WorkEvent => {
    const sourceRoom = creep.memory.sourceRoom;
    if (!sourceRoom) return creep.store.getUsedCapacity() == 0 ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
    if (creep.room.name != sourceRoom || creep.pos.isRoomEdge()) {
        let opt = {};
        if (creep.room.name != creep.memory.targetRoom)
            opt = { ignoreCreeps: false };
        creep.moveToRoom(sourceRoom, opt);
        return WORK_EVENTS.STAY;
    }

    const target = [creep.room.storage, creep.room.terminal].find(s => s && s.store.getFreeCapacity() > 1000);

    if (creep.room.my && target) {
        const resourceType = getFirstCarriedResource(creep);
        if (!resourceType) return WORK_EVENTS.TO_SOURCE;
        if (creep.pos.inRangeTo(target, 1)) {
            creep.transfer(target, resourceType);
            if ((creep.memory.longMoveEnd||0) > 0 && (creep.memory.longMoveStart||0) > 0 &&
                (creep.memory.longMoveEnd - creep.memory.longMoveStart) > creep.ticksToLive) {
                creep.suicide();
            }
        } else {
            creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
    } else {
        creep.say('no target');
        creep.moveTo(new RoomPosition(25, 25, sourceRoom), { visualizePathStyle: { stroke: '#ffaa00' } });
    }
    
    return creep.store.getUsedCapacity() == 0 ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
};

const deposit_transfer = {
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource,
            onTarget,
        });
    }
}

export default deposit_transfer;
