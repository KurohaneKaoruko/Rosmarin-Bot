import { compressBodyConfig } from "@/utils";

type BoostConfig = {
    bodypart: [BodyPartConstant, number][];
    boostmap: { [bodypart: string]: MineralBoostConstant };
};

const RoleBodys: { [role: string]: { [tier: string]: BoostConfig } } = {
    'aid-build': {
        'T3': {
            bodypart: [[WORK, 35], [CARRY, 5], [MOVE, 10]],
            boostmap: { [WORK]: 'XLH2O', [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' }
        }
    },
    'aid-upgrade': {
        'T3': {
            bodypart: [[WORK, 35], [CARRY, 5], [MOVE, 10]],
            boostmap: { [WORK]: 'XGH2O', [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' }
        }
    },
    'aid-carry': {
        'T3': {
            bodypart: [[CARRY, 25], [MOVE, 25]],
            boostmap: { [CARRY]: 'XKH2O' }
        },
        'BIG': {
            bodypart: [[CARRY, 40], [MOVE, 10]],
            boostmap: { [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' }
        }
    }
};

const AidModule = (flagName: string) => {
    // 增援建造
    // AID-BUILD_孵化房间_S-能量源房间_T间隔
    if (flagName.startsWith('AID-BUILD/')) {
        // 孵化间隔
        let spawnInterval = getSpawnInterval(flagName);
        if (!timeCheck(flagName, spawnInterval)) return true;
        // 孵化房间
        const room = getSpawnRoom(flagName);
        if (!room) return true;

        // 目标房间
        const targetRoom = Game.flags[flagName].pos.roomName;
        // 能量源房间
        let sourceRoom = flagName.match(/\/S-([EW][1-9]+[NS][1-9]+)/)?.[1] || targetRoom;
        
        let bodys = [];
        let memory = { sourceRoom, targetRoom } as CreepMemory;

        // 是否BOOST
        let boost = flagName.match(/\/B-(\w+)/)?.[1] as string || undefined;
        if (boost && RoleBodys['aid-build'][boost]) {
            const config = RoleBodys['aid-build'][boost];
            bodys = config.bodypart || [];
            const boostmap = config.boostmap;
            memory['boostmap'] = boostmap;
            let result = room.AssignBoostTaskByBody(bodys, boostmap);
            if (!result) {
                bodys = [];
                delete memory['boostmap'];
            }
        }
        
        room.SpawnMissionAdd('', compressBodyConfig(bodys), -1, 'aid-build', memory);
        return true;

    }

    // 增援升级
    // AID-UPGRADE_孵化房间_T间隔
    if (flagName.startsWith('AID-UPGRADE/')) {
        // 孵化间隔
        let spawnInterval = getSpawnInterval(flagName);
        if (!timeCheck(flagName, spawnInterval)) return true;
        // 孵化房间
        const room = getSpawnRoom(flagName);
        if (!room) return true;
        // 目标房间
        const targetRoom = Game.flags[flagName].pos.roomName;
        
        let bodys = [];
        let memory = {
            home: targetRoom,
            targetRoom: targetRoom,
        } as CreepMemory;

        // 是否BOOST
        let boost = flagName.match(/\/B-(\w+)/)?.[1] as string || undefined;
        if (boost && RoleBodys['aid-upgrade'][boost]) {
            const config = RoleBodys['aid-upgrade'][boost];
            bodys = config.bodypart || [];
            const boostmap = config.boostmap;
            memory['boostmap'] = boostmap;
            let result = room.AssignBoostTaskByBody(bodys, boostmap);
            if (!result) { bodys = []; delete memory['boostmap']; }
        }
        
        room.SpawnMissionAdd('', compressBodyConfig(bodys), -1, 'aid-upgrade', memory);
        return true;

    }
    
    // 增援冲级
    // AID-UUP_孵化房间_T间隔
    if (flagName.startsWith('AID-UUP/')) {
        // 孵化间隔
        let spawnInterval = getSpawnInterval(flagName);
        if (!timeCheck(flagName, spawnInterval)) return true;
        // 孵化房间
        const room = getSpawnRoom(flagName);
        if (!room) return true;

        // 目标房间
        const targetRoom = Game.flags[flagName].pos.roomName;

        let bodys = [];

        room.SpawnMissionAdd('', compressBodyConfig(bodys), -1, 'UP-upgrade', {
            home: targetRoom,
        } as CreepMemory);
        return true;
    }

    // 增援能量
    // AID-ENERGY_孵化房间_B-BOOST配置_T间隔
    if (flagName.startsWith('AID-ENERGY/')) {
        // 孵化间隔
        let spawnInterval = getSpawnInterval(flagName);
        if (!timeCheck(flagName, spawnInterval)) return true;
        // 孵化房间
        const room = getSpawnRoom(flagName);
        if (!room) return true;

        // 目标房间
        const targetRoom = Game.flags[flagName].pos.roomName;

        let bodys = [];
        let memory = {
            sourceRoom: room.name,
            targetRoom: targetRoom,
            resource: RESOURCE_ENERGY,
        } as any;

        // 是否BOOST
        let boost = flagName.match(/\/B-(\w+)/)?.[1] as string || undefined;
        if (boost && RoleBodys['aid-carry'][boost]) {
            bodys = RoleBodys['aid-carry'][boost].bodypart || [];
            memory['boostmap'] = RoleBodys['aid-carry'][boost].boostmap || {};
            let result = room.AssignBoostTaskByBody(bodys, memory['boostmap']);
            if (!result) {
                bodys = [];
                delete memory['boostmap'];
            }
        }

        room.SpawnMissionAdd('', bodys, -1, 'aid-carry', memory);
        return true;
    }
    
}


function getSpawnInterval (flagName: string) {
    let spawnInterval = flagName.match(/\/T(\d+)/)?.[1] as any;
    if (!spawnInterval) spawnInterval = 500;
    else spawnInterval = parseInt(spawnInterval);
    return spawnInterval;
}

function getSpawnRoom (flagName: string) {
    // 孵化房间
    const spawnRoom = flagName.match(/\/([EW][1-9]+[NS][1-9]+)/)?.[1];
    const room = Game.rooms[spawnRoom];
    if (!spawnRoom || !room || !room.my) {
        Game.flags[flagName].remove();
        return undefined;
    }
    return room;
}

function timeCheck (flagName: string, spawnInterval: number) {
    const flagMemory = Game.flags[flagName].memory;
    if ((Game.time - (flagMemory['lastTime']||0) < spawnInterval)) return false;
    flagMemory['lastTime'] = Game.time;
    return true;
}

export default AidModule;