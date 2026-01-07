const signAction = (creep: Creep) => {
    let controller = creep.room.controller;
    if (!controller) return;
    if (!controller.sign) return;
    if (controller.sign.username === creep.owner.username) return;
    if (controller.sign.username === 'Screeps') return;
    let whiteList = new Set<string>(Memory['whitelist'] || []);
    if (whiteList.has(controller.sign.username)) return;
    controller = creep.pos.findClosestByPath([controller]);
    if (!controller) return;

    if (creep.pos.isNearTo(controller)) {
        creep.signController(controller, '');
    } else {
        creep.moveTo(controller)
    }
    return true;
}

const signer = {
    run: (creep: Creep) => {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }

        if (!creep.memory['avoidRooms']) {
            creep.memory['avoidRooms'] = [];
        }

        let avoidRooms = new Set<string>(creep.memory['avoidRooms'] || [])
        if (!avoidRooms.has(creep.room.name)) {
            if (signAction(creep)) return;
            else creep.memory['avoidRooms'].push(creep.room.name);
        } else {
            if (creep.memory.targetRoom) {
                if (creep.pos.isRoomEdge() ||
                    creep.room.name !== creep.memory.targetRoom) {
                    let result = creep.moveTo(
                        new RoomPosition(25, 25, creep.memory.targetRoom),
                        { plainCost: 1, swampCost: 1 }
                    );
                    if (result !== ERR_NO_PATH) return;
                }
                delete creep.memory.targetRoom;
            }

            let roomName = creep.room.name;
            let nextRooms = Object.values(Game.map.describeExits(roomName))
                .filter((r) => {
                    if (Game.map.getRoomStatus(r).status !== 'normal') return false;
                    if (creep.moveTo(new RoomPosition(25, 25, r)) === ERR_NO_PATH) return false;
                    return true;
                });
            
            let activeNextRooms = nextRooms.filter((r) => !avoidRooms.has(r));
            if (activeNextRooms.length > 0) {
                let index = Math.floor(Math.random() * activeNextRooms.length);
                let nextRoom = activeNextRooms[index];
                creep.memory.targetRoom = nextRoom;
            } else {
                let index = Math.floor(Math.random() * nextRooms.length);
                let nextRoom = nextRooms[index];
                creep.memory.targetRoom = nextRoom;
            }
            
        }
    }
}

export default signer