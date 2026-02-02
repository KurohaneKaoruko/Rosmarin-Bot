import { compressBodyConfig } from "@/modules/utils/compress";
import { log } from "@/utils";
import { RoleBodys } from "../spawnConfig";
import { getSpawnRoomOrRemove, parseFlagNumber, tickThrottle } from "../utils";

export default class AidSpawnFunction extends Flag {
    // 旗帜触发的孵化控制
    handleAidSpawnFlag(): boolean {
        const flagName = this.name;
        if (!this.isAidSpawnFlag(flagName)) return false;

        // 节流：每 10 tick 扫描一次，减少 CPU 开销
        if (Game.time % 10) return true;
        if (this.handleAidBuildFlag(flagName)) return true;
        if (this.handleAidUpgradeFlag(flagName)) return true;
        if (this.handleAidUupFlag(flagName)) return true;
        if (this.handleAidEnergyFlag(flagName)) return true;
        if (this.handleClaimFlag(flagName)) return true;
        if (this.handleReserveFlag(flagName)) return true;
        if (this.handleCleanFlag(flagName)) return true;
        if (this.handleAttackClaimFlag(flagName)) return true;

        return true;
    }

    // 增援建造
    // AID-BUILD_孵化房间_S-能量源房间_T-间隔
    private handleAidBuildFlag(flagName: string): boolean {
        if (!flagName.startsWith('AID-BUILD/')) return false;

        const spawnInterval = this.getSpawnIntervalFromName();
        if (!this.timeCheck(spawnInterval)) return true;

        const room = this.getSpawnRoomFromName();
        if (!room) return true;

        const targetRoom = this.pos.roomName;
        const sourceRoom = flagName.match(/\/S-([EW][1-9]+[NS][1-9]+)/)?.[1] || targetRoom;

        let bodys: any[] = [];
        const memory = { sourceRoom, targetRoom } as CreepMemory;

        // 是否BOOST
        const boost = this.getBoostTierFromName(flagName);
        if (boost && RoleBodys['aid-build'][boost]) {
            const config = RoleBodys['aid-build'][boost];
            bodys = config.bodypart || [];
            const boostmap = config.boostmap;
            if (room.CheckBoostRes(bodys, boostmap)) {
                memory['boostmap'] = boostmap;
                memory['boostOwnerId'] = `${flagName}:${Game.time}`;
            } else {
                bodys = [];
                delete memory['boostmap'];
            }
        }

        const ret = room.SpawnMissionAdd('', compressBodyConfig(bodys), -1, 'aid-build', memory);
        if (ret === OK && memory['boostmap']) {
            room.AssignBoostTaskByBody(bodys, memory['boostmap'] as any, memory['boostOwnerId'] as any);
        }
        return true;
    }

    // 增援升级
    // AID-UPGRADE_孵化房间_T间隔
    private handleAidUpgradeFlag(flagName: string): boolean {
        if (!flagName.startsWith('AID-UPGRADE/')) return false;

        const spawnInterval = this.getSpawnIntervalFromName();
        if (!this.timeCheck(spawnInterval)) return true;

        const room = this.getSpawnRoomFromName();
        if (!room) return true;

        const targetRoom = this.pos.roomName;

        let bodys: any[] = [];
        const memory = { home: targetRoom, targetRoom } as CreepMemory;

        // 是否BOOST
        const boost = this.getBoostTierFromName(flagName);
        if (boost && RoleBodys['aid-upgrade'][boost]) {
            const config = RoleBodys['aid-upgrade'][boost];
            bodys = config.bodypart || [];
            const boostmap = config.boostmap;
            if (room.CheckBoostRes(bodys, boostmap)) {
                memory['boostmap'] = boostmap;
                memory['boostOwnerId'] = `${flagName}:${Game.time}`;
            } else {
                bodys = [];
                delete memory['boostmap'];
            }
        }

        const ret = room.SpawnMissionAdd('', compressBodyConfig(bodys), -1, 'aid-upgrade', memory);
        if (ret === OK && memory['boostmap']) {
            room.AssignBoostTaskByBody(bodys, memory['boostmap'] as any, memory['boostOwnerId'] as any);
        }
        return true;
    }

    // 增援冲级
    // AID-UUP_孵化房间_T间隔
    private handleAidUupFlag(flagName: string): boolean {
        if (!flagName.startsWith('AID-UUP/')) return false;

        const spawnInterval = this.getSpawnIntervalFromName();
        if (!this.timeCheck(spawnInterval)) return true;

        const room = this.getSpawnRoomFromName();
        if (!room) return true;

        const targetRoom = this.pos.roomName;
        room.SpawnMissionAdd('', compressBodyConfig([]), -1, 'up-upgrade', { home: targetRoom } as CreepMemory);
        return true;
    }

    // 增援能量
    // AID-ENERGY_孵化房间_B-BOOST配置_T间隔
    private handleAidEnergyFlag(flagName: string): boolean {
        if (!flagName.startsWith('AID-ENERGY/')) return false;

        const spawnInterval = this.getSpawnIntervalFromName();
        if (!this.timeCheck(spawnInterval)) return true;

        const room = this.getSpawnRoomFromName();
        if (!room) return true;

        const targetRoom = this.pos.roomName;

        let bodys: any[] = [];
        const memory = {
            sourceRoom: room.name,
            targetRoom: targetRoom,
            resource: RESOURCE_ENERGY,
        } as any;

        // 是否BOOST
        const boost = this.getBoostTierFromName(flagName);
        if (boost && RoleBodys['aid-carry'][boost]) {
            bodys = RoleBodys['aid-carry'][boost].bodypart || [];
            const boostmap = RoleBodys['aid-carry'][boost].boostmap || {};
            if (room.CheckBoostRes(bodys, boostmap)) {
                memory['boostmap'] = boostmap;
                memory['boostOwnerId'] = `${flagName}:${Game.time}`;
            } else {
                bodys = [];
                delete memory['boostmap'];
            }
        }

        const ret = room.SpawnMissionAdd('', bodys, -1, 'aid-carry', memory);
        if (ret === OK && memory['boostmap']) {
            room.AssignBoostTaskByBody(bodys, memory['boostmap'], memory['boostOwnerId'] as any);
        }
        return true;
    }

    // 占领房间（优化：同时孵化 claimer + aid-build；满足条件时自动关闭）
    private handleClaimFlag(flagName: string): boolean {
        if (!flagName.startsWith('CLAIM/')) return false;

        const room = this.getSpawnRoomFromName();
        if (!room) return true;

        const targetRoom = this.pos.roomName;
        const isNotCenterRoom = !(/^[EW]\d*[456][NS]\d*[456]$/.test(targetRoom));
        const isNotHighway = /^[EW]\d*[1-9][NS]\d*[1-9]$/.test(targetRoom);
        if (!isNotCenterRoom || !isNotHighway) {
            this.remove();
            return true;
        }

        const targetRoomObj = Game.rooms[targetRoom];

        // 已经完成“起房”：有 spawn 且没有工地 -> 自动关闭，避免后续误触发继续孵化
        if (targetRoomObj?.my) {
            const hasSpawn = targetRoomObj.find(FIND_MY_STRUCTURES, {
                filter: (s) => s.structureType === STRUCTURE_SPAWN
            }).length > 0;
            const siteNum = targetRoomObj.find(FIND_MY_CONSTRUCTION_SITES).length;
            if (hasSpawn && siteNum === 0) {
                log('CLAIM', `${targetRoom} 已有spawn且无工地，已自动关闭CLAIM流程`);
                this.remove();
                return true;
            }
        }

        // 避免重复孵化 claimer
        let hasClaimer = false;
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory?.role !== 'claimer') continue;
            if (creep.memory?.targetRoom !== targetRoom) continue;
            hasClaimer = true;
            break;
        }

        // 目标房间未被占领时，确保有 claimer 在路上
        if (!hasClaimer && (!targetRoomObj || !targetRoomObj.my)) {
            room.SpawnMissionAdd('', '', -1, 'claimer', { targetRoom, spawnFlag: flagName } as any);
            log('CLAIM', `${room.name} 派出了一个 claimer 来占领 ${targetRoom}`);
        }

        // 同步孵化 aid-build 援助建造（不影响单独 AID 旗帜：只统计/控制本 CLAIM 旗帜派生的 builder）
        let claimAidNum = 0;
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory?.role !== 'aid-build') continue;
            if (creep.memory?.targetRoom !== targetRoom) continue;
            if (creep.memory?.spawnFlag !== flagName) continue;
            claimAidNum++;
        }

        const desiredAidNum = 1;
        const claimMemory = this.memory as any;
        const aidInterval = 200;
        const lastAidTime = typeof claimMemory['lastAidBuildTime'] === 'number' ? claimMemory['lastAidBuildTime'] : 0;
        if (claimAidNum < desiredAidNum && Game.time - lastAidTime >= aidInterval) {
            const memory = { sourceRoom: targetRoom, targetRoom: targetRoom, spawnFlag: flagName } as any;
            room.SpawnMissionAdd('', compressBodyConfig([]), -1, 'aid-build', memory);
            claimMemory['lastAidBuildTime'] = Game.time;
            log('CLAIM', `${room.name} 派出了一个 aid-build 援助建造 ${targetRoom}`);
        }

        return true;
    }

    // 预定房间
    private handleReserveFlag(flagName: string): boolean {
        if (!flagName.startsWith('RESERVE/')) return false;

        const spawnInterval = this.getSpawnIntervalFromName(500);
        if (!this.timeCheck(spawnInterval)) return true;
        const room = this.getSpawnRoomFromName();
        if (!room) return true;
        const targetRoom = this.pos.roomName;
        room.SpawnMissionAdd('', '', -1, 'reserver', { targetRoom });
        return true;
    }

    // 清扫房间 (用于防御薄弱的房间)
    private handleCleanFlag(flagName: string): boolean {
        if (!flagName.startsWith('CLEAN/')) return false;

        const spawnInterval = this.getSpawnIntervalFromName(500);
        if (!this.timeCheck(spawnInterval)) return true;
        const room = this.getSpawnRoomFromName();
        if (!room) return true;
        const targetRoom = this.pos.roomName;
        room.SpawnMissionAdd('', '', -1, 'cleaner', { targetRoom });
        return true;
    }

    // 攻击控制器
    private handleAttackClaimFlag(flagName: string): boolean {
        if (!flagName.startsWith('ACLAIM/')) return false;

        const spawnInterval = this.getSpawnIntervalFromName(1000) || 500;
        if (!this.timeCheck(spawnInterval)) return true;
        const room = this.getSpawnRoomFromName();
        if (!room) return true;

        const targetRoom = this.pos.roomName;
        let num = flagName.match(/\/N-(\d+)$/)?.[1] as any;
        if (!num) num = 1;
        else num = parseInt(num);
        for (let i = 0; i < num; i++) {
            room.SpawnMissionAdd('', '', num, 'attack-claimer', { targetRoom, num });
        }
        log('CLAIM', `${room.name} 孵化了 ${num} 个 attack-claimer 来攻击 ${targetRoom}`);
        return true;
    }

    private isAidSpawnFlag(flagName: string) {
        return (
            flagName.startsWith('CLAIM/') ||
            flagName.startsWith('RESERVE/') ||
            flagName.startsWith('CLEAN/') ||
            flagName.startsWith('ACLAIM/') ||
            flagName.startsWith('AID-BUILD/') ||
            flagName.startsWith('AID-UPGRADE/') ||
            flagName.startsWith('AID-UUP/') ||
            flagName.startsWith('AID-ENERGY/')
        );
    }

    private getBoostTierFromName(flagName: string): string | undefined {
        return flagName.match(/\/B-(\w+)/)?.[1] as string || undefined;
    }

    private getSpawnIntervalFromName(Default = 500) {
        return parseFlagNumber(this.name, 'T', Default)
    }

    private getSpawnRoomFromName() {
        return getSpawnRoomOrRemove(this)
    }

    private timeCheck(spawnInterval: number) {
        return tickThrottle(this, spawnInterval)
    }
}
