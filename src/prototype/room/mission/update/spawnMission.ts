import { RoleData, RoleLevelData } from '@/constant/CreepConstant'

const RoleSpawnCheck = {
    'harvester': (room: Room, current: number) => {
        if (room.memory.defend) return false;
        return current < room.source.length;
    },
    'upgrader': (room: Room, current: number) => {
        const num = RoleLevelData['upgrader'][room.level]['num'];
        if (room.memory.defend) return false;
        if (global.CreepNum[room.name]?.['UP-upgrade']) return false;
        if (room.level == 8 && !Game.flags[`${room.name}/UPGRADE`] &&
            room.controller.ticksToDowngrade >= 150000) return false;
        return current < num;
    },
    'transport': (room: Room, current: number) => {
        const num = RoleLevelData['transport'][room.level]['num'];
        let energy = (room.storage?.store[RESOURCE_ENERGY] || 0) +
                        (room.terminal?.store[RESOURCE_ENERGY] || 0);
        if (energy < 10000) return false;
        return current < num && (room.storage || room.terminal);
    },
    'manager': (room: Room, current: number) => {
        const num = RoleLevelData['manager'][room.level]['num'];
        if (num == 0) return false;
        const center = Memory['RoomControlData'][room.name]?.center;
        const storage = room.storage;
        const terminal = room.terminal;
        const link = room.link.find(l => l.pos.inRangeTo(center.x, center.y, 1));
        return current < num && storage && (terminal || link);
    },
    'carrier': (room: Room, current: number) => {
        const num = RoleLevelData['carrier'][room.level]['num'];
        if (num > 0) return current < num;
        if (current >= 1) return false;
        if (room.mineral?.mineralAmount > 0) return true;
        if (room.container?.some((c) => c.store.getUsedCapacity() > 1000)) return true;
        return false;
    },
    'worker': (room: Room, current: number) => {
        if (Memory['warmode']) return false;
        if (room.level < 6) {
            if (current < 2 && room.checkMissionInPool('build')) return true;
        } else {
            if (current < 1 && room.checkMissionInPool('build')) return true;
            if (current < 2 && room.getMissionNumInPool('build') > 10) return true;
        }
        if (current >= 1 || room[RESOURCE_ENERGY] < 100000) return false;
        if (room.level < 8 || Game.flags[`${room.name}/REPAIR`]) {
            let WR_Tasks = global.WallRampartRepairMission?.[room.name];
            if (WR_Tasks && Object.keys(WR_Tasks)?.length > 0) return true;
        }
        if (!room.tower || room.tower.length == 0) {
            return room.getMissionNumInPool('repair') >= 20;
        }
        return false;
    },
    'mineral': (room: Room, current: number) => {
        const lv = room.level;
        if (lv < 6) return false;
        if (room.memory.defend) return false;
        if (!room.storage) return false;
        if (!room.extractor) return false;
        if (room.mineral.mineralAmount < 0) return false;
        // 检查storage是否有足够空间
        const store = room.storage.store;
        if (store.getUsedCapacity() > store.getCapacity() * 0.95) return false;
        // 当前等级的最大ext能量容量
        const CS = CONTROLLER_STRUCTURES;
        const EEC = EXTENSION_ENERGY_CAPACITY;
        const extMaxEnergyCapacity = CS["spawn"][lv] * 300 + CS['extension'][lv] * EEC[lv];
        if (room.energyCapacityAvailable < extMaxEnergyCapacity) return false;
        return current < 1 && lv >= 6;
    },
    'universal': (room: Room, current: number) => {
        const lv = room.level;
        if (current < 2 && lv < 3) {
            return (!room.container || room.container.length < 1);
        } else if (current < 1) {
            const controller = room.controller;
            const botMem = Memory['RoomControlData'][room.name];
            const sign = botMem?.sign ?? global.BASE_CONFIG.DEFAULT_SIGN;
            const oldSign = controller.sign?.text ?? '';
            return controller && oldSign != sign
        }
        return false;
    },
    'UP-upgrade': (room: Room, current: number) => {
        if (room.level == 8) return false;
        // 冲级
        let UPFlag = room.find(FIND_FLAGS).find(f => f.name.startsWith(`${room.name}/UP-UPGRADE/`));
        if (!UPFlag) return false;
        const match = UPFlag.name.match(/UP-UPGRADE\/(\d+)/);
        let num = match ? parseInt(match[1]) : 0;
        if (num < 1) return false;
        if (room.level >= 4 && room[RESOURCE_ENERGY] < 100000) return false;
        
        return current < num;
    },
    'UP-repair': (room: Room, current: number) => {
        // 加速刷墙
        const UPFlag = room.find(FIND_FLAGS).find(f => f.name.startsWith(`${room.name}/UP-REPAIR/`));
        if (!UPFlag) return false;
        const match = UPFlag.name.match(/UP-REPAIR\/(\d+)/);
        let num = match ? parseInt(match[1]) : 0;
        if (num < 1) return false;
        if (room.level < 7)  return false;
        if (room[RESOURCE_ENERGY] < 100000) return false;
        return current < num;
    },
    // 'signer': (room: Room, current: number) => {
    //     if (current > 0) return false;
    //     if (Game.map.getRoomStatus(room.name).status != 'normal') return false;
    //     if (Object.values(Game.creeps).some(c=>c.memory.role=='signer')) return false;
    //     if (Math.random() > 0.1) return false;
    //     return true;
    // }
}


function UpdateSpawnMission(room: Room) {
    if (!room.spawn) return false;
    
    const CreepNum = room.getCreepNum();
    const SpawnMissionNum = room.getSpawnMissionNum();

    for (const role in RoleSpawnCheck) {
        const current = (CreepNum[role] || 0) + (SpawnMissionNum[role] || 0);
        if (RoleSpawnCheck[role](room, current)) {
            room.SpawnMissionAdd(
                RoleData[role].code,
                '',
                RoleData[role]['level'],
                role,
                { home: room.name } as CreepMemory
            );
        }
    }

    return true;
}


export {UpdateSpawnMission}