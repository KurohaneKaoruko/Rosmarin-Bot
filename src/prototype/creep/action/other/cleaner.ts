const cleaner = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            creep.moveToRoom(creep.memory.targetRoom);
            return
        }

        if (creep.room.my) return;
        if (Game.time < creep.memory.idle) return;

        if (!creep.memory['NO_PATH']) creep.memory['NO_PATH'] = [];
        const target = Game.getObjectById(creep.memory['targetId']) as Structure;

        if (!target) {
            const enemiesStructures = creep.room.find(FIND_STRUCTURES);
            if(enemiesStructures.length == 0) return;
            const Structures = enemiesStructures.filter((s: any) =>
                s.hits && s.hits > 0 && s.hits <= 1e5 &&
                (!s.store || s.store.getUsedCapacity() <= 3000));
            
            const targetStructure = creep.pos.findClosestByPath(Structures, {
                filter: (s: any) => !creep.memory['NO_PATH'].includes(s.id),
                ignoreCreeps: true,
                maxRooms: 1,
                range: 1,
                plainCost: 1,
                swampCost: 1
            });

            if (!targetStructure) {
                creep.memory['idle'] = Game.time + 10;
                return;
            }

            const result = creep.moveTo(targetStructure, {
                visualizePathStyle: {stroke: '#ffff00'},
                maxRooms: 1, range: 1
            });
            if (result == ERR_NO_PATH) {
                creep.memory['NO_PATH'].push(targetStructure.id);
                return;
            }
            creep.memory['targetId'] = targetStructure.id;
            return;
        }

        if (!target) return;
        
        if(creep.pos.isNearTo(target)) creep.dismantle(target);
        else creep.moveTo(target,{maxRooms: 1,range: 1});

        return true;
    }
}


export default cleaner;