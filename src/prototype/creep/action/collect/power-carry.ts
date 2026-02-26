import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';

const power_carry = {
    source: function(creep: Creep) {
        const powerTombstones = getRoomTickCacheValue(creep.room, 'power_carry_tombstones', () =>
            creep.room.find(FIND_TOMBSTONES, {
                filter: (r) => r.store.getUsedCapacity(RESOURCE_POWER) > 0
            }) as Tombstone[]
        );
        let powerTombstone = powerTombstones.find((t) => t.store.getUsedCapacity(RESOURCE_POWER) > 0);
        if (powerTombstone) {
            creep.memory['powerTombstoneId'] = powerTombstone.id;
            creep.goWithdraw(powerTombstone as any, RESOURCE_POWER);
            return false;
        }
        if(creep.store.getFreeCapacity(RESOURCE_POWER) === 0) {
            return true;
        }
        
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom, {bypassRange:10});
            return;
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
                return false;
            }
        }

        // 先处理内存里有的目标
        let powerDropped: Resource, powerRuin: Ruin;
        powerDropped = Game.getObjectById(creep.memory['powerDroppedId']) as Resource;
        if (powerDropped) {
            creep.goPickup(powerDropped);
            return;
        }
        powerRuin = Game.getObjectById(creep.memory['powerRuinId']) as Ruin;
        if (powerRuin) {
            creep.goWithdraw(powerRuin, RESOURCE_POWER);
            return;
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
            return;
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
            return;
        }
        
        // 如果都没有, 那么做如下处理。
        if (!powerBank && !powerDropped && !powerRuin) {
            const powerCarryCreeps = getRoomTickCacheValue(creep.room, 'power_carry_target_creeps', () =>
                creep.room.find(FIND_MY_CREEPS, {
                    filter: (c) => c.memory.role == 'power-carry' && c.memory.targetRoom == creep.room.name
                }) as Creep[]
            );
            powerCarryCreeps.forEach((c) => { c.memory['suicide'] = true; });
            if (creep.store.getUsedCapacity(RESOURCE_POWER) === 0) {
                creep.suicide();
                return false;
            }
            if (creep.store.getUsedCapacity(RESOURCE_POWER) > 0) {
                return true;
            }
        }
        
        return creep.store.getFreeCapacity(RESOURCE_POWER) === 0;
    },
    target: function(creep: Creep) {
        if (creep.room.name != creep.memory.homeRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.homeRoom);
            return;
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

        return creep.store.getUsedCapacity(RESOURCE_POWER) === 0;
    }
}

export default power_carry;
