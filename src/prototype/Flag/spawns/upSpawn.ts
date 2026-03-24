import { compressBodyConfig } from "@/shared/compress";
import { THRESHOLDS } from "@/constant/Thresholds";

export default class UpSpawnFunction extends Flag {
    // 房间内 UP 类旗帜触发孵化（UP-UPGRADE / UP-REPAIR）
    handleUpSpawnFlag(): boolean {
        const flagName = this.name;
        if (flagName.match(/^[EW]\d+[NS]\d+\/UP-UPGRADE\//)) return this.handleUpUpgradeFlag(flagName);
        if (flagName.match(/^[EW]\d+[NS]\d+\/UP-REPAIR\//)) return this.handleUpRepairFlag(flagName);
        return false;
    }

    // 房间内冲级旗帜：<房间名>/UP-UPGRADE/<数量>
    private handleUpUpgradeFlag(flagName: string): boolean {
        const match = flagName.match(/^([EW]\d+[NS]\d+)\/UP-UPGRADE\/(\d+)/);
        if (!match) return false;

        const roomName = match[1];
        const target = match[2] ? parseInt(match[2], 10) : 0;
        if (target < 1) return true;

        const room = Game.rooms[roomName];
        if (!room || !room.my || !room.spawn?.length) return true;
        if (room.level === 8) return true;
        if (room.level >= 4 && room[RESOURCE_ENERGY] < THRESHOLDS.TRANSPORT.HIGH_AMOUNT) return true;

        const creepNum = room.getCreepNum() || {};
        const spawnMissionNum = room.getSpawnMissionNum() || {};
        const current = (creepNum['up-upgrade'] || 0) + (spawnMissionNum['up-upgrade'] || 0);
        const missing = Math.max(0, target - current);
        if (missing <= 0) return true;

        for (let i = 0; i < missing; i++) {
            room.SpawnMissionAdd('', compressBodyConfig([]), -1, 'up-upgrade', { homeRoom: room.name, targetRoom: room.name, spawnFlag: flagName } as CreepMemory);
        }
        return true;
    }

    // 房间内刷墙旗帜：<房间名>/UP-REPAIR/<数量>
    private handleUpRepairFlag(flagName: string): boolean {
        const match = flagName.match(/^([EW]\d+[NS]\d+)\/UP-REPAIR\/(\d+)/);
        if (!match) return false;

        const roomName = match[1];
        const target = match[2] ? parseInt(match[2], 10) : 0;
        if (target < 1) return true;

        const room = Game.rooms[roomName];
        if (!room || !room.my || !room.spawn?.length) return true;
        if (room.level < 7) return true;
        if (room[RESOURCE_ENERGY] < THRESHOLDS.TRANSPORT.HIGH_AMOUNT) return true;

        const creepNum = room.getCreepNum() || {};
        const spawnMissionNum = room.getSpawnMissionNum() || {};
        const current = (creepNum['up-repair'] || 0) + (spawnMissionNum['up-repair'] || 0);
        const missing = Math.max(0, target - current);
        if (missing <= 0) return true;

        for (let i = 0; i < missing; i++) {
            room.SpawnMissionAdd('', compressBodyConfig([]), -1, 'up-repair', { homeRoom: room.name, targetRoom: room.name, spawnFlag: flagName } as CreepMemory);
        }
        return true;
    }
}
