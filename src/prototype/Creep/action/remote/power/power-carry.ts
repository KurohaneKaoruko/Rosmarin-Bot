import { ROLES } from '@/constant/CreepConstant';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { runWorkLayer } from '@/framework/ai/adapters';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';

const onSource = (creep: Creep): WorkEvent => {
    const powerTombstones = getRoomTickCacheValue(creep.room, 'power_carry_tombstones', () =>
        creep.room.find(FIND_TOMBSTONES, {
            filter: (r) => r.store.getUsedCapacity(RESOURCE_POWER) > 0
        }) as Tombstone[]
    );
    let powerTombstone = powerTombstones.find((t) => t.store.getUsedCapacity(RESOURCE_POWER) > 0);
    if (powerTombstone) {
        creep.memory['powerTombstoneId'] = powerTombstone.id;
        creep.goWithdraw(powerTombstone as any, RESOURCE_POWER);
        return WORK_EVENTS.STAY;
    }
    if(creep.store.getFreeCapacity(RESOURCE_POWER) === 0) {
        return WORK_EVENTS.TO_TARGET;
    }
    
    if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(creep.memory.targetRoom, {bypassRange:10});
        return WORK_EVENTS.STAY;
    }

    
    let powerBank = creep.room.powerBank?.[0];
    if (!powerBank) {
        creep.room.update(STRUCTURE_POWER_BANK);
        powerBank = creep.room.powerBank?.[0];
    }
    if (powerBank) {
        creep.memory['powerBankId'] = powerBank.id;
        // 靠近powerBank
        if (!creep.pos.inRangeTo(powerBank, 3)) {
            creep.moveTo(powerBank, {range: 3, ignoreCreeps: false});
            return WORK_EVENTS.STAY;
        }
    }

    // 先处理内存里有的目标
    let powerDropped: Resource, powerRuin: Ruin;
    powerDropped = Game.getObjectById(creep.memory['powerDroppedId']) as Resource;
    if (powerDropped) {
        creep.goPickup(powerDropped);
        return WORK_EVENTS.STAY;
    }
    powerRuin = Game.getObjectById(creep.memory['powerRuinId']) as Ruin;
    if (powerRuin) {
        creep.goWithdraw(powerRuin, RESOURCE_POWER);
        return WORK_EVENTS.STAY;
    }
    // 再处理能找到的目标
    const droppedPowerResources = getRoomTickCacheValue(creep.room, 'power_carry_dropped_power', () =>
        creep.room.find(FIND_DROPPED_RESOURCES, {
            filter: (r) => r.resourceType == RESOURCE_POWER
        }) as Resource[]
    );
    powerDropped = droppedPowerResources.find((r) => r.amount > 0);
    if (powerDropped) {
        creep.memory['powerDroppedId'] = powerDropped.id;
        creep.goPickup(powerDropped);
        return WORK_EVENTS.STAY;
    }
    const powerRuins = getRoomTickCacheValue(creep.room, 'power_carry_power_ruins', () =>
        creep.room.find(FIND_RUINS, {
            filter: (r) => r.store.getUsedCapacity(RESOURCE_POWER) > 0
        }) as Ruin[]
    );
    powerRuin = powerRuins.find((r) => r.store.getUsedCapacity(RESOURCE_POWER) > 0);
    if (powerRuin) {
        creep.memory['powerRuinId'] = powerRuin.id;
        creep.goWithdraw(powerRuin, RESOURCE_POWER);
        return WORK_EVENTS.STAY;
    }
    
    // 如果都没有, 那么做如下处理。
    if (!powerBank && !powerDropped && !powerRuin) {
        const powerCarryCreeps = getRoomTickCacheValue(creep.room, 'power_carry_target_creeps', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.memory.role == ROLES['power-carry'] && c.memory.targetRoom == creep.room.name
            }) as Creep[]
        );
        powerCarryCreeps.forEach((c) => { c.memory['suicide'] = true; });
        if (creep.store.getUsedCapacity(RESOURCE_POWER) === 0) {
            creep.suicide();
            return WORK_EVENTS.STAY;
        }
        if (creep.store.getUsedCapacity(RESOURCE_POWER) > 0) {
            return WORK_EVENTS.TO_TARGET;
        }
    }
    
    return creep.store.getFreeCapacity(RESOURCE_POWER) === 0 ? WORK_EVENTS.TO_TARGET : WORK_EVENTS.STAY;
};

const onTarget = (creep: Creep): WorkEvent => {
    const sourceRoom = creep.memory.sourceRoom;
    if (!sourceRoom) return creep.store.getUsedCapacity(RESOURCE_POWER) === 0 ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
    if (creep.room.name != sourceRoom || creep.pos.isRoomEdge()) {
        creep.moveToRoom(sourceRoom);
        return WORK_EVENTS.STAY;
    }

    const storage = creep.room.storage;
    if (storage) {
        if (creep.pos.isNearTo(storage)) {
            creep.transfer(storage, RESOURCE_POWER);
            if (creep.memory['suicide']) {
                creep.suicide();
            }
        } else {
            creep.moveTo(storage);
        }
    }

    return creep.store.getUsedCapacity(RESOURCE_POWER) === 0 ? WORK_EVENTS.TO_SOURCE : WORK_EVENTS.STAY;
};

const power_carry = {
    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource,
            onTarget,
        });
    }
}

export default power_carry;
