import { addTransportMission, LevelMap } from './utils';

export function UpdateEnergyMission(room: Room) {
    const storage = room.storage;
    const terminal = room.terminal;
    let energy = (storage?.store[RESOURCE_ENERGY]||0) + (terminal?.store[RESOURCE_ENERGY]||0);
    if(energy < 3000) return;

    let storageOrTerminal = null;

    if(terminal && storage) {
        storageOrTerminal = terminal.store[RESOURCE_ENERGY] > storage.store[RESOURCE_ENERGY] ? terminal : storage;
    } else {
        storageOrTerminal = storage || terminal;
    }

    if (!storageOrTerminal) return;

    // 检查spawn和扩展是否需要填充能量
    if(room.spawn && room.spawn.length > 0 && room.energyAvailable < room.energyCapacityAvailable) {
        room.spawn.forEach((s) => {
            const amount = s.store.getFreeCapacity(RESOURCE_ENERGY);
            if (amount === 0) return;
            if (energy < amount) return;
            energy -= amount;
            addTransportMission(room, LevelMap.ext, {
                pos: s,
                source: storageOrTerminal.id,
                target: s.id,
                resourceType: RESOURCE_ENERGY,
                amount,
            });
        })
        room.extension.forEach((e) => {
            const amount = e.store.getFreeCapacity(RESOURCE_ENERGY);
            if (amount === 0) return;
            if (energy < amount) return;
            energy -= amount;
            addTransportMission(room, LevelMap.ext, {
                pos: e,
                source: storageOrTerminal.id,
                target: e.id,
                resourceType: RESOURCE_ENERGY,
                amount,
            });
        })
    }

    // 检查tower是否需要填充能量
    if(room.level >= 3 && room.tower && room.tower.length > 0) {
        const towers = room.tower
            .filter((t: StructureTower) => t && t.store.getFreeCapacity(RESOURCE_ENERGY) > 200);
        towers.forEach((t: StructureTower) => {
            const amount = t.store.getFreeCapacity(RESOURCE_ENERGY);
            if(energy < amount) return;
            energy -= amount;
            addTransportMission(room, LevelMap.tower, {
                pos: t,
                source: storageOrTerminal.id,
                target: t.id,
                resourceType: RESOURCE_ENERGY,
                amount,
            });
        })
    }

    // 能量缺少时不填充以下的
    if(room.getResAmount(RESOURCE_ENERGY) < 10000) return;

    // 检查lab是否需要填充能量
    if (Game.time % 20 === 0 && room.level >= 6 && room.lab) {
        const labs = room.lab
            .filter((l: StructureLab) => l && l.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
        labs.forEach((l: StructureLab) => {
            const amount = l.store.getFreeCapacity(RESOURCE_ENERGY);
            if(energy < amount) return;
            energy -= amount;
            addTransportMission(room, LevelMap.labEnergy, {
                pos: l,
                source: storage.id,
                target: l.id,
                resourceType: RESOURCE_ENERGY,
                amount,
            });
        })
    }

    // 检查powerSpawn是否需要填充能量
    let center = Memory['RoomControlData'][room.name].center;
    let centerPos: RoomPosition;
    if (center) centerPos = new RoomPosition(center.x, center.y, room.name);
    // 没设置中心或者powerSpawn不在中心时填充
    if (Game.time % 20 === 0 && room.level == 8 && room.powerSpawn &&
        (!centerPos || !room.powerSpawn.pos.inRangeTo(centerPos, 1))) {
        const powerSpawn = room.powerSpawn;
        const amount = powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY);
        if(powerSpawn && amount > 400 && energy >= amount) {
            energy -= amount;
            addTransportMission(room, LevelMap.powerSpawn, {
                pos: powerSpawn,
                source: storage.id,
                target: powerSpawn.id,
                resourceType: RESOURCE_ENERGY,
                amount,
            });
        }
    }

    // 能量缺少时不填充以下的
    if(room.getResAmount(RESOURCE_ENERGY) < 100000) return;

    // 检查nuker是否需要填充能量
    if(Game.time % 20 === 0 && room.level == 8 && room.nuker) {
        const nuker = room.nuker;
        const amount = Math.min(nuker.store.getFreeCapacity(RESOURCE_ENERGY), 3000);
        if(nuker && amount > 0 && energy >= amount) {
            energy -= amount;
            addTransportMission(room, LevelMap.nuker, {
                pos: nuker,
                source: storage.id,
                target: nuker.id,
                resourceType: RESOURCE_ENERGY,
                amount,
            });
        }
    }

    return OK;
}
