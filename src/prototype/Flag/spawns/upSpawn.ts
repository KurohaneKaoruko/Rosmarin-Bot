import { ROLES } from '@/constant/CreepConstant';
import { compressBodyConfig } from "@/modules/shared/compress";
import { THRESHOLDS } from "@/constant/Thresholds";
import { getCreepByTargetRoom } from "@/modules/shared/creepTickIndex";

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
        // 换代感知计数：退役中（RCL8 满级 / TTL<100 进卸 boost 流程）的爬不计入在编，
        // 接替者在其退役期间就提前下单（含 boost 耗时），缩短冲级编队换代的升级空窗。
        const active = ((getCreepByTargetRoom(room.name)[ROLES.upgrader] || []) as any[]).filter((c) => {
            if (!c || c.spawning) return false;
            if (c.room.level >= 8) return false;
            if ((c.ticksToLive ?? 1500) < 100) return false;
            return true;
        }).length;
        const current = active + (spawnMissionNum[ROLES.upgrader] || 0);
        const missing = Math.max(0, target - current);
        if (missing <= 0) return true;

        for (let i = 0; i < missing; i++) {
            room.SpawnMissionAdd('', compressBodyConfig([]), -1, ROLES.upgrader, { homeRoom: room.name, targetRoom: room.name, spawnFlag: flagName } as CreepMemory);
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
        const current = (creepNum[ROLES['up-repair']] || 0) + (spawnMissionNum[ROLES['up-repair']] || 0);
        const missing = Math.max(0, target - current);
        if (missing <= 0) return true;

        for (let i = 0; i < missing; i++) {
            room.SpawnMissionAdd('', compressBodyConfig([]), -1, ROLES['up-repair'], { homeRoom: room.name, targetRoom: room.name, spawnFlag: flagName } as CreepMemory);
        }
        return true;
    }
}
