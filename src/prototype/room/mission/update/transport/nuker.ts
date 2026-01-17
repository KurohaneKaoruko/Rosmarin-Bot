import { addTransportMission, LevelMap } from './utils';

// 填充nuker用的资源
export function UpdateNukerMission(room: Room) {
    if(Game.time % 50 !== 0) return;
    if(room.level < 8) return;
    if(!room.nuker) return;
    const storage = room.storage;
    const terminal = room.terminal;
    if(!storage && !terminal) return;
    
    const nuker = room.nuker;
    if(!nuker) return;
    if(nuker.store[RESOURCE_GHODIUM] === 5000) return;  // 如果nuker中已经满了，则不补充

    let amount = 5000 - nuker.store[RESOURCE_GHODIUM];

    let source: Id<Structure>;
    if (storage && storage.store[RESOURCE_GHODIUM] > 0) {
        source = storage.id; // 从storage获取
        amount = Math.min(amount, storage.store[RESOURCE_GHODIUM])
    } else if (terminal && terminal.store[RESOURCE_GHODIUM] > 0) {
        source = terminal.id; // 从terminal获取
        amount = Math.min(amount, terminal.store[RESOURCE_GHODIUM])
    } else {
        return; // 如果storage和terminal都不足，则不补充
    }

    addTransportMission(room, LevelMap.nuker, {
        pos: nuker,
        source,
        target: nuker.id,
        resourceType: RESOURCE_GHODIUM,
        amount,
    });
}
