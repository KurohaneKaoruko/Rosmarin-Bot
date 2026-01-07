import { RoleData, RoleBodys } from "@/constant/CreepConstant";
import { log } from "@/utils";

const ClaimModule = (flagName: string) => {
    // 占领房间
    if (flagName.startsWith('CLAIM/')) {
        // 孵化房间
        const room = getSpawnRoom(flagName);
        if (!room) return true;
        // 目标房间
        const targetRoom = Game.flags[flagName].pos.roomName;
        const isNotCenterRoom = !(/^[EW]\d*[456][NS]\d*[456]$/.test(targetRoom)); // 非中间房间
        const isNotHighway = /^[EW]\d*[1-9][NS]\d*[1-9]$/.test(targetRoom); // 非过道房间
        if (isNotCenterRoom && isNotHighway &&
            (!Game.rooms[targetRoom] || !Game.rooms[targetRoom].my)) {
            room.SpawnMissionAdd('', '', -1, 'claimer',{targetRoom});
            log('CLAIM', `${room.name} 孵化了一个 claimer 来占领 ${targetRoom}`);
        }
        Game.flags[flagName].remove();
        return true;
    }

    // 预定房间
    if (flagName.startsWith('RESERVE/')) {
        // 孵化间隔
        let spawnInterval = getSpawnInterval(flagName);
        if (!timeCheck(flagName, spawnInterval)) return true;
        // 孵化房间
        const room = getSpawnRoom(flagName);
        if (!room) return true;
        // 目标房间
        const targetRoom = Game.flags[flagName].pos.roomName;
        room.SpawnMissionAdd('', '', -1, 'reserver',{targetRoom});
        return true;
    }

    // 清扫房间 (用于防御薄弱的房间)
    if (flagName.startsWith('CLEAN/')) {
        // 孵化间隔
        const spawnInterval = getSpawnInterval(flagName);
        if (!timeCheck(flagName, spawnInterval)) return true;
        // 孵化房间
        const room = getSpawnRoom(flagName);
        if (!room) return true;
        // 目标房间
        const targetRoom = Game.flags[flagName].pos.roomName;
        room.SpawnMissionAdd('', '', -1, 'cleaner',{targetRoom});
        return true;
    }

    // 攻击控制器
    if (flagName.startsWith('ACLAIM/')) {
        // 孵化间隔
        const spawnInterval = getSpawnInterval(flagName, 1000) || 500;
        if (!timeCheck(flagName, spawnInterval)) return true;
        // 孵化房间
        const room = getSpawnRoom(flagName);
        if (!room) return true;
        // 目标房间
        const targetRoom = Game.flags[flagName].pos.roomName;
        // 同时数量
        let num = flagName.match(/\/N(\d+)$/)?.[1] as any;
        if (!num) num = 1;
        else num = parseInt(num);
        for (let i = 0; i < num; i++) {
            room.SpawnMissionAdd('', '', num, 'aclaimer', {targetRoom, num});
            log('CLAIM', `${room.name} 孵化了 ${num} 个 aclaimer 来攻击 ${targetRoom}`);
        }
        return true;
    }

}

function getSpawnInterval (flagName: string, Default=500) {
    let spawnInterval = flagName.match(/\/T(\d+)/)?.[1] as any;
    if (!spawnInterval) spawnInterval = Default;
    else spawnInterval = parseInt(spawnInterval);
    return spawnInterval;
}

function getSpawnRoom (flagName: string) {
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
    flagMemory['spawnCount'] = (flagMemory['spawnCount']||0) + 1;
    return true;
}

export default ClaimModule;