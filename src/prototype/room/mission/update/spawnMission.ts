import { RoleData, RoleLevelData } from '@/constant/CreepConstant'

// 孵化相关
const SPAWN_MIN_ENERGY = 50e3;
// 维修相关
const REPAIR_MIN_ENERGY = 100e3;
// 刷墙相关
const WALL_MIN_ENERGY = 50000;
// 搬运任务生成阈值
const TRANSPORT_MIN = 10000;
const TRANSPORT_HIGH = 100000;

const RoleSpawnCheck = {
    'harvester': (room: Room, current: number) => {
        if (room.memory.defend) return false;
        return current < room.source.length;
    },
    'upgrader': (room: Room, current: number) => {
        const lv = room.level;
        const num = RoleLevelData['upgrader'][lv]['num'];
        if (room.memory.defend) return false;
        if (!Game.flags[`${room.name}/UPGRADE`]) return false;
        const ticksToDowngrade = room.controller?.ticksToDowngrade || 0;
        if (lv == 8 && ticksToDowngrade > 100000) return false;
        if (lv >= 5 && ticksToDowngrade > 10000 && room[RESOURCE_ENERGY] < SPAWN_MIN_ENERGY) return false;
        return current < num;
    },
    'transport': (room: Room, current: number) => {
        const num = RoleLevelData['transport'][room.level]['num'];
        let energy = (room.storage?.store[RESOURCE_ENERGY] || 0) +
                        (room.terminal?.store[RESOURCE_ENERGY] || 0);
        if (energy < TRANSPORT_MIN) return false;
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
            if (room.storage?.store[RESOURCE_ENERGY] < TRANSPORT_MIN) return false;
            if (current < 1 && room.checkMissionInPool('build')) return true;
            if (current < 2 && room.getMissionNumInPool('build') > 10) return true;
        }
        if (current >= 1 || room[RESOURCE_ENERGY] < REPAIR_MIN_ENERGY) return false;
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
        if (room.mineral.mineralAmount <= 0) return false;
        // 检查storage是否有足够空间
        const store = room.storage.store;
        if (store.getUsedCapacity() > store.getCapacity() * 0.95) return false;
        // 矿物太多时不挖
        if (store[room.mineral.mineralType] > 1e6) return false;
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
        }
        return false;
    },
    'up-upgrade': (room: Room, current: number) => {
        if (room.level == 8) return false;
        // 冲级
        let UPFlag = room.find(FIND_FLAGS).find(f => f.name.startsWith(`${room.name}/UP-UPGRADE/`));
        if (!UPFlag) return false;
        const match = UPFlag.name.match(/UP-UPGRADE\/(\d+)/);
        let num = match ? parseInt(match[1]) : 0;
        if (num < 1) return false;
        if (room.level >= 4 && room[RESOURCE_ENERGY] < TRANSPORT_HIGH) return false;
        
        return current < num;
    },
    'up-repair': (room: Room, current: number) => {
        // 加速刷墙
        const UPFlag = room.find(FIND_FLAGS).find(f => f.name.startsWith(`${room.name}/UP-REPAIR/`));
        if (!UPFlag) return false;
        const match = UPFlag.name.match(/UP-REPAIR\/(\d+)/);
        let num = match ? parseInt(match[1]) : 0;
        if (num < 1) return false;
        if (room.level < 7)  return false;
        if (room[RESOURCE_ENERGY] < TRANSPORT_HIGH) return false;
        return current < num;
    }
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