import { addTransportMission, LevelMap } from './utils';

// 检查powerSpawn是否需要填充power
export function UpdatePowerMission(room: Room) {
    if(room.level < 8 || !room.powerSpawn) return;
    let center = Memory['RoomControlData'][room.name].center;
    let centerPos: RoomPosition;
    if (center) centerPos = new RoomPosition(center.x, center.y, room.name);
    if (centerPos && room.powerSpawn.pos.inRangeTo(centerPos, 1)) return;
    // 在中心附近1格内，不填充

    const storage = room.storage;
    const terminal = room.terminal;
    if(!storage && !terminal) return;

    const powerSpawn = room.powerSpawn;
    if(!powerSpawn) return;
    let neededAmount = 100 - powerSpawn.store[RESOURCE_POWER];
    if (neededAmount < 50) return;

    let target = [storage, terminal].reduce((a, b) => {
        if (!a && !b) return null;
        if (!a || !b) return a || b;
        if (a.store[RESOURCE_POWER] > b.store[RESOURCE_POWER]) return a;
        return b;
    }, null)

    if(!target || target.store[RESOURCE_POWER] <= 0) return;

    addTransportMission(room, LevelMap.powerSpawn, {
        pos: target,
        source: target.id,
        target: powerSpawn.id,
        resourceType: RESOURCE_POWER,
        amount: Math.min(neededAmount, target.store[RESOURCE_POWER]),
    });
}
