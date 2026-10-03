import { compressBodyConfig } from "@/modules/shared/compress";
import { log } from "@/modules/utils";
import ClaimSpawnFunction from "./claimSpawn";
import { getFlagSpawnLoad, isActiveAidBuildFlagCreep } from "../function/spawnLoad";
import { AidBodys } from "./config";
import { parseFlagNumber, parseSpawnRoomName, tickThrottle } from "../utils";

// Spawn mission uses smaller level as higher priority; 0 is highest practical priority.
const JUMP_SPAWN_PRIORITY = 0;
const MANUAL_AID_BUILD_SPAWN_PRIORITY = 0;
const AID_BUILD_DEFAULT_INTERVAL = 200;
const MANUAL_AID_BUILD_TARGET_COUNT = 5;

const getGlobalReserverLoad = (targetRoom: string) => {
    let live = 0;
    let queued = 0;

    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        if (!creep || creep.memory?.role !== 'reserver') continue;
        if (creep.memory?.targetRoom !== targetRoom) continue;
        live++;
    }

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room || typeof (room as any).getAllMissionFromPool !== 'function') continue;
        const tasks = room.getAllMissionFromPool('spawn') || [];
        for (const task of tasks as any[]) {
            const memory = task?.data?.memory;
            if (!memory || memory.role !== 'reserver') continue;
            if (memory.targetRoom !== targetRoom) continue;
            queued++;
        }
    }

    return {
        live,
        queued,
        total: live + queued,
    };
};

export default class AidSpawnFunction extends ClaimSpawnFunction {
    // 旗帜触发的孵化控制
    handleAidSpawnFlag(): boolean {
        const flagName = this.name;
        if (flagName.startsWith('JUMP/') || flagName.startsWith('AID-JUMP/')) return this.handleJumpFlag(flagName);
        // 节流只作用于援助族旗自身：非援助旗必须放行到后续处理器（否则整条旗链被 90% 的 tick 掐断）
        const isAidFlag = /^(AID-BUILD\/|AID-UPGRADE\/|AID-UUP\/|AID-ENERGY\/|CLAIM\/|RESERVE\/)/.test(flagName);
        if (!isAidFlag) return false;
        // 节流：援助旗每 10 tick 扫描一次（每旗独立计时），减少 CPU 开销
        if (!tickThrottle(this, 10, 'aidScanTick')) return true;
        if (flagName.startsWith('AID-BUILD/')) return this.handleAidBuildFlag(flagName);
        if (flagName.startsWith('AID-UPGRADE/')) return this.handleAidUpgradeFlag(flagName);
        if (flagName.startsWith('AID-UUP/')) return this.handleAidUupFlag(flagName);
        if (flagName.startsWith('AID-ENERGY/')) return this.handleAidEnergyFlag(flagName);
        if (flagName.startsWith('CLAIM/')) return this.handleClaimFlag(flagName);
        // 自动占领旗：名为 claim / claim-备注，自动选最近的能孵 claimer 的己方房，占领后自动 start
        if (flagName === 'claim' || flagName.startsWith('claim-')) return this.handleAutoClaimFlag(flagName);
        if (flagName.startsWith('RESERVE/')) return this.handleReserveFlag(flagName);

        return true;
    }

    // 增援建造
    // AID-BUILD_孵化房间_S-能量源房间_T-间隔
    private handleAidBuildFlag(flagName: string): boolean {
        if (!flagName.startsWith('AID-BUILD/')) return false;

        const spawnInterval = this.getSpawnIntervalFromName(AID_BUILD_DEFAULT_INTERVAL);
        if (!this.timeCheck(spawnInterval)) return true;

        const room = this.getSpawnRoomFromName();
        if (!room) return true;

        const targetRoom = this.pos.roomName;
        const sourceRoom = flagName.match(/\/S-([EW]\d+[NS]\d+)/)?.[1] || targetRoom;
        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'aid-build',
            (memory) => memory.targetRoom === targetRoom && memory.sourceRoom === sourceRoom,
            isActiveAidBuildFlagCreep
        );
        if (spawnLoad.total >= MANUAL_AID_BUILD_TARGET_COUNT) return true;

        let bodys: any[] = [];
        const memory = { homeRoom: room.name, sourceRoom, targetRoom, spawnFlag: flagName } as CreepMemory;

        // 是否BOOST
        const boost = this.getBoostTierFromName(flagName);
        if (boost && AidBodys['aid-build'][boost]) {
            const config = AidBodys['aid-build'][boost];
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

        const ret = room.SpawnMissionAdd('', compressBodyConfig(bodys), MANUAL_AID_BUILD_SPAWN_PRIORITY, 'aid-build', memory);
        if (ret !== OK) {
            log('AID', `${room.name} -> ${targetRoom} spawn aid-build failed ret=${ret}, e=${room.energyAvailable}/${room.energyCapacityAvailable}`);
            return true;
        }
        if (ret === OK && memory['boostmap']) {
            room.AssignBoostTaskByBody(bodys, memory['boostmap'] as any, memory['boostOwnerId'] as any);
        }
        log('AID', `${room.name} -> ${targetRoom} queue aid-build`);
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
        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'aid-upgrade',
            (memory) => memory.targetRoom === targetRoom && memory.homeRoom === room.name
        );
        if (spawnLoad.total >= 1) return true;

        let bodys: any[] = [];
        const memory = { homeRoom: room.name, targetRoom, spawnFlag: flagName } as CreepMemory;

        // 是否BOOST
        const boost = this.getBoostTierFromName(flagName);
        if (boost && AidBodys['aid-upgrade'][boost]) {
            const config = AidBodys['aid-upgrade'][boost];
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
        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'aid-upgrade',
            (memory) => memory.targetRoom === targetRoom && memory.homeRoom === room.name
        );
        if (spawnLoad.total >= 1) return true;

        // 大体型冲级 upgrader（50 部件）+ boost 任务接线（同 aid-build 模式：资源足则由 BoostMission 灌 lab）
        const bodys = room.GetRoleBodys('aid-upgrade');
        const boostmap: Record<string, MineralBoostConstant[]> = { [WORK]: ['XGH2O', 'GH2O', 'GH'] };
        const memory: CreepMemory = {
            homeRoom: room.name,
            targetRoom,
            spawnFlag: flagName,
            aidRush: true,
        } as CreepMemory;

        if (bodys?.length && room.CheckBoostRes(bodys, boostmap)) {
            const ownerId = `${flagName}:${Game.time}`;
            room.AssignBoostTaskByBody(bodys, boostmap, ownerId);
            (memory as any).boostmap = boostmap;
            (memory as any).boostOwnerId = ownerId;
        }

        room.SpawnMissionAdd('', compressBodyConfig(bodys ?? []), -1, 'aid-upgrade', memory);
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
        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'aid-carry',
            (memory) =>
                memory.targetRoom === targetRoom &&
                memory.sourceRoom === room.name &&
                memory.resource === RESOURCE_ENERGY
        );
        if (spawnLoad.total >= 1) return true;

        let bodys: any[] = [];
        const memory = {
            homeRoom: room.name,
            sourceRoom: room.name,
            targetRoom: targetRoom,
            resource: RESOURCE_ENERGY,
            spawnFlag: flagName,
        } as any;

        // 是否BOOST
        const boost = this.getBoostTierFromName(flagName);
        if (boost && AidBodys['aid-carry'][boost]) {
            bodys = AidBodys['aid-carry'][boost].bodypart || [];
            const boostmap = AidBodys['aid-carry'][boost].boostmap || {};
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
    // Jump-room flow:
    // 1) prepare target room with builder/carry, build container and stock energy
    // 2) send one claimer only when ready
    // 3) after claim keep enough builder/carry until spawn is settled
    // Flag format:
    // JUMP/<spawnRoom>/B-<preBuilder>/C-<preCarry>/E-<energy>/PB-<postBuilder>/PC-<postCarry>
    // AID-JUMP/<spawnRoom>/...
    private handleJumpFlag(flagName: string): boolean {
        if (!flagName.startsWith('JUMP/') && !flagName.startsWith('AID-JUMP/')) return false;

        const targetRoom = this.pos.roomName;
        const room = this.getJumpSpawnRoom(flagName, targetRoom);
        if (!room) return true;

        const targetRoomObj = Game.rooms[targetRoom];
        const jumpMem = this.memory as any;

        if (Game.time - (jumpMem['lastJumpLegacyCleanTime'] || 0) >= 20) {
            jumpMem['lastJumpLegacyCleanTime'] = Game.time;
            this.cleanupJumpLegacyTasks(room, flagName, targetRoom);
        }
        if (Game.time - (jumpMem['lastJumpCarryCleanTime'] || 0) >= 10) {
            jumpMem['lastJumpCarryCleanTime'] = Game.time;
            this.cleanupJumpCarryTasks(room, flagName, targetRoom);
        }

        // B/PB 是数量参数，正常使用不可能为 0：B-0/PB-0 = 无限建造工；缺省 B=4、PB=B
        const rawBuilder = parseFlagNumber(flagName, 'B', 4);
        const preBuilder = rawBuilder === 0 ? Infinity : Math.max(1, rawBuilder);
        const rawPostBuilder = parseFlagNumber(flagName, 'PB', -1);
        const postBuilder = rawPostBuilder === 0 ? Infinity : Math.max(preBuilder, rawPostBuilder);
        const minEnergy = Math.max(500, parseFlagNumber(flagName, 'E', 3000));
        const linearDistance = Game.map.getRoomLinearDistance(room.name, targetRoom, true);

        // 未占领前先堆出更高规模的准备队伍，再放 claimer。
        const preClaimBuilder = Math.min(20, Math.max(preBuilder, preBuilder + 5 + Math.floor(linearDistance / 2)));
        const preClaimCarry = 0;
        const claimEnergyNeed = Math.max(minEnergy, 2500);

        const anchorPos = this.getJumpAnchorPos(targetRoomObj, jumpMem);
        if (targetRoomObj && anchorPos) {
            this.ensureJumpContainerSite(targetRoomObj, anchorPos, jumpMem);
        }

        const counts = this.getJumpRoleCounts(room, flagName, targetRoom);
        const isClaimed = !!targetRoomObj?.my;
        const desiredBuilder = isClaimed ? postBuilder : preClaimBuilder;
        const desiredCarry = 0;

        const hasContainer = !!(targetRoomObj && this.hasJumpContainer(targetRoomObj));
        const stagedEnergy = targetRoomObj ? this.getJumpEnergyStock(targetRoomObj) : 0;
        const claimBuilderLiveNeed = Math.max(3, Math.ceil(preClaimBuilder * 0.6));
        const minBuilderAtTarget = Math.max(2, Math.ceil(preClaimBuilder * 0.45));
        const minCarryAtTarget = 0;
        const readyForClaim = !isClaimed
            && hasContainer
            && stagedEnergy >= claimEnergyNeed
            && counts.builderLive >= claimBuilderLiveNeed
            && counts.builderAtTarget >= minBuilderAtTarget
            && counts.carryAtTarget >= minCarryAtTarget;

        if (readyForClaim && counts.claimer < 1) {
            const memory = { homeRoom: room.name, targetRoom, spawnFlag: flagName, jumpMode: true } as any;
            const ret = room.SpawnMissionAdd('', compressBodyConfig([[MOVE, 1], [CLAIM, 1]]), JUMP_SPAWN_PRIORITY, 'claimer', memory);
            if (ret === OK) {
                log('JUMP', `${room.name} -> ${targetRoom} ready, spawn claimer`);
            } else if (Game.time - (jumpMem['lastJumpClaimFailTime'] || 0) >= 30) {
                jumpMem['lastJumpClaimFailTime'] = Game.time;
                log('JUMP', `${room.name} -> ${targetRoom} spawn claimer failed ret=${ret}, e=${room.energyAvailable}/${room.energyCapacityAvailable}`);
            }
            return true;
        }

        if (counts.builder < desiredBuilder) {
            const body = this.getJumpBuilderBody(room);
            const memory = {
                homeRoom: room.name,
                sourceRoom: targetRoom,
                targetRoom,
                spawnFlag: flagName,
                jumpMode: true
            } as any;
            const ret = room.SpawnMissionAdd('', compressBodyConfig(body), JUMP_SPAWN_PRIORITY, 'aid-build', memory);
            if (ret === OK) {
                log('JUMP', `${room.name} -> ${targetRoom} spawn aid-build (${counts.builder + 1}/${desiredBuilder})`);
            } else if (Game.time - (jumpMem['lastJumpBuildFailTime'] || 0) >= 30) {
                jumpMem['lastJumpBuildFailTime'] = Game.time;
                log('JUMP', `${room.name} -> ${targetRoom} spawn aid-build failed ret=${ret}, e=${room.energyAvailable}/${room.energyCapacityAvailable}`);
            }
            return true;
        }

        if (!isClaimed && !readyForClaim && Game.time - (jumpMem['lastJumpHintTime'] || 0) >= 100) {
            jumpMem['lastJumpHintTime'] = Game.time;
            log('JUMP', `${targetRoom} preparing: container=${hasContainer ? 'Y' : 'N'}, energy=${stagedEnergy}/${claimEnergyNeed}, builder=${counts.builderLive}+${counts.builderQueued}/${desiredBuilder}, claimBuilder=${counts.builderLive}/${claimBuilderLiveNeed}, carry=${counts.carryLive}+${counts.carryQueued}/${preClaimCarry}, builderInRoom=${counts.builderAtTarget}/${minBuilderAtTarget}, carryInRoom=${counts.carryAtTarget}/${minCarryAtTarget}, claimer=${counts.claimerLive}+${counts.claimerQueued}`);
        }

        if (isClaimed && targetRoomObj) {
            const hasSpawn = targetRoomObj.find(FIND_MY_STRUCTURES, {
                filter: (s) => s.structureType === STRUCTURE_SPAWN
            }).length > 0;
            const siteNum = targetRoomObj.find(FIND_MY_CONSTRUCTION_SITES).length;
            if (hasSpawn && siteNum === 0) {
                log('JUMP', `${targetRoom} settled (spawn + no site), remove jump flag`);
                this.remove();
            }
        }

        return true;
    }

    private cleanupJumpLegacyTasks(spawnRoom: Room, flagName: string, targetRoom: string): void {
        const tasks = spawnRoom.getAllMissionFromPool('spawn') || [];
        let removed = 0;
        for (const task of [...(tasks as any[])]) {
            const data = task?.data as any;
            const memory = data?.memory as any;
            if (!memory || memory.spawnFlag !== flagName || memory.targetRoom !== targetRoom) continue;

            const role = memory.role;
            if (role !== 'aid-build' && role !== 'aid-carry' && role !== 'claimer') continue;

            const body = data?.body;
            const emptyBody = body === '' || (Array.isArray(body) && body.length === 0);
            if (!emptyBody) continue;

            spawnRoom.deleteMissionFromPool('spawn', task.id);
            removed++;
        }

        if (removed > 0) {
            log('JUMP', `${spawnRoom.name} cleaned ${removed} legacy jump spawn task(s) for ${targetRoom}`);
        }
    }

    private cleanupJumpCarryTasks(spawnRoom: Room, flagName: string, targetRoom: string): void {
        const tasks = spawnRoom.getAllMissionFromPool('spawn') || [];
        let removed = 0;
        for (const task of [...(tasks as any[])]) {
            const memory = task?.data?.memory as any;
            if (!memory || memory.spawnFlag !== flagName || memory.targetRoom !== targetRoom) continue;
            if (memory.role !== 'aid-carry') continue;
            spawnRoom.deleteMissionFromPool('spawn', task.id);
            removed++;
        }

        if (removed > 0) {
            log('JUMP', `${spawnRoom.name} cleaned ${removed} jump aid-carry task(s) for ${targetRoom}`);
        }
    }

    private getJumpBuilderBody(room: Room): ((BodyPartConstant | number)[])[] {
        const cap = room.energyCapacityAvailable;
        if (cap >= 1600) return [[WORK, 8], [CARRY, 4], [MOVE, 12]];
        if (cap >= 1200) return [[WORK, 6], [CARRY, 3], [MOVE, 9]];
        if (cap >= 900) return [[WORK, 4], [CARRY, 3], [MOVE, 7]];
        if (cap >= 650) return [[WORK, 3], [CARRY, 2], [MOVE, 5]];
        if (cap >= 500) return [[WORK, 2], [CARRY, 2], [MOVE, 4]];
        return [[WORK, 1], [CARRY, 1], [MOVE, 2]];
    }

    private getJumpCarryBody(room: Room): ((BodyPartConstant | number)[])[] {
        const cap = room.energyCapacityAvailable;
        if (cap >= 1300) return [[CARRY, 12], [MOVE, 6]];
        if (cap >= 900) return [[CARRY, 8], [MOVE, 4]];
        if (cap >= 650) return [[CARRY, 6], [MOVE, 3]];
        if (cap >= 450) return [[CARRY, 4], [MOVE, 2]];
        return [[CARRY, 2], [MOVE, 1]];
    }

    private getJumpSpawnRoom(flagName: string, targetRoom: string): Room | undefined {
        const spawnRoomName = parseSpawnRoomName(flagName);
        if (spawnRoomName) {
            const namedRoom = Game.rooms[spawnRoomName];
            if (namedRoom?.my && namedRoom.spawn?.length) return namedRoom;
        }

        let bestRoom: Room | undefined;
        let bestDistance = Infinity;
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room?.my) continue;
            if (!room.spawn || room.spawn.length <= 0) continue;

            const distance = Game.map.getRoomLinearDistance(room.name, targetRoom, true);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestRoom = room;
            }
        }

        const jumpMem = this.memory as any;
        if (!bestRoom && Game.time - (jumpMem['lastJumpNoSpawnRoomLogTime'] || 0) >= 50) {
            jumpMem['lastJumpNoSpawnRoomLogTime'] = Game.time;
            log('JUMP', `${flagName} no valid spawn room (target ${targetRoom})`);
        }
        return bestRoom;
    }

    private getJumpAnchorPos(targetRoomObj: Room | undefined, jumpMem: any): RoomPosition | undefined {
        if (typeof jumpMem.jumpCx === 'number' && typeof jumpMem.jumpCy === 'number') {
            return new RoomPosition(jumpMem.jumpCx, jumpMem.jumpCy, this.pos.roomName);
        }
        if (!targetRoomObj) return this.pos;

        if (this.pos.walkable()) {
            jumpMem.jumpCx = this.pos.x;
            jumpMem.jumpCy = this.pos.y;
            return this.pos;
        }

        const fallback = this.pos.nearPos(1).find((p) => p.walkable());
        if (fallback) {
            jumpMem.jumpCx = fallback.x;
            jumpMem.jumpCy = fallback.y;
            return fallback;
        }

        return this.pos;
    }

    private ensureJumpContainerSite(targetRoom: Room, anchorPos: RoomPosition, jumpMem: any): void {
        if (anchorPos.roomName !== targetRoom.name) return;

        const hasContainer = anchorPos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === STRUCTURE_CONTAINER);
        if (hasContainer) return;

        const hasSite = anchorPos.lookFor(LOOK_CONSTRUCTION_SITES).some((s) => s.structureType === STRUCTURE_CONTAINER);
        if (hasSite) return;

        let ret = anchorPos.createConstructionSite(STRUCTURE_CONTAINER);
        if (ret === OK || ret === ERR_FULL) {
            jumpMem.jumpCx = anchorPos.x;
            jumpMem.jumpCy = anchorPos.y;
            return;
        }
        if (ret !== ERR_INVALID_TARGET) return;

        const fallback = anchorPos.nearPos(1).find((p) => p.walkable());
        if (!fallback) return;
        ret = fallback.createConstructionSite(STRUCTURE_CONTAINER);
        if (ret === OK || ret === ERR_FULL) {
            jumpMem.jumpCx = fallback.x;
            jumpMem.jumpCy = fallback.y;
        }
    }

    private hasJumpContainer(targetRoom: Room): boolean {
        const containers = targetRoom.find(FIND_STRUCTURES, {
            filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER
        });
        return containers.length > 0;
    }

    private getJumpEnergyStock(targetRoom: Room): number {
        let energy = 0;

        const containers = targetRoom.find(FIND_STRUCTURES, {
            filter: (s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER
        });
        for (const container of containers) {
            energy += container.store[RESOURCE_ENERGY] || 0;
        }

        const dropped = targetRoom.find(FIND_DROPPED_RESOURCES, {
            filter: (r) => r.resourceType === RESOURCE_ENERGY
        });
        for (const res of dropped) {
            energy += res.amount || 0;
        }

        const ruins = targetRoom.find(FIND_RUINS);
        for (const ruin of ruins) {
            energy += ruin.store[RESOURCE_ENERGY] || 0;
        }

        const tombstones = targetRoom.find(FIND_TOMBSTONES);
        for (const tombstone of tombstones) {
            energy += tombstone.store[RESOURCE_ENERGY] || 0;
        }

        return energy;
    }

    private getJumpRoleCounts(spawnRoom: Room, flagName: string, targetRoom: string) {
        let builderLive = 0;
        let carryLive = 0;
        let claimerLive = 0;
        let builderAtTarget = 0;
        let carryAtTarget = 0;
        let builderQueued = 0;
        let carryQueued = 0;
        let claimerQueued = 0;

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory?.spawnFlag !== flagName) continue;
            if (creep.memory?.targetRoom !== targetRoom) continue;

            if (creep.memory?.role === 'aid-build') {
                builderLive++;
                if (creep.room.name === targetRoom) builderAtTarget++;
            }
            else if (creep.memory?.role === 'aid-carry') {
                carryLive++;
                if (creep.room.name === targetRoom) carryAtTarget++;
            }
            else if (creep.memory?.role === 'claimer') claimerLive++;
        }

        const tasks = spawnRoom.getAllMissionFromPool('spawn') || [];
        for (const task of tasks as any[]) {
            const memory = task?.data?.memory as any;
            if (!memory) continue;
            if (memory.spawnFlag !== flagName) continue;
            if (memory.targetRoom !== targetRoom) continue;

            if (memory.role === 'aid-build') builderQueued++;
            else if (memory.role === 'aid-carry') carryQueued++;
            else if (memory.role === 'claimer') claimerQueued++;
        }

        return {
            builderLive,
            carryLive,
            claimerLive,
            builderAtTarget,
            carryAtTarget,
            builderQueued,
            carryQueued,
            claimerQueued,
            builder: builderLive + builderQueued,
            carry: carryLive + carryQueued,
            claimer: claimerLive + claimerQueued
        };
    }

    // 预定房间
    private handleReserveFlag(flagName: string): boolean {
        if (!flagName.startsWith('RESERVE/')) return false;

        const spawnInterval = this.getSpawnIntervalFromName(500);
        if (!this.timeCheck(spawnInterval)) return true;
        const room = this.getSpawnRoomFromName();
        if (!room) return true;
        const targetRoom = this.pos.roomName;

        const globalLoad = getGlobalReserverLoad(targetRoom);
        if (globalLoad.total >= 1) return true;

        const spawnLoad = getFlagSpawnLoad(
            room,
            flagName,
            'reserver',
            (memory) => memory.targetRoom === targetRoom && memory.homeRoom === room.name
        );
        if (spawnLoad.total >= 1) return true;

        room.SpawnMissionAdd('', '', -1, 'reserver', { homeRoom: room.name, targetRoom, spawnFlag: flagName });
        return true;
    }

    private getBoostTierFromName(flagName: string): string | undefined {
        return flagName.match(/\/B-(\w+)/)?.[1] as string || undefined;
    }

    private getSpawnIntervalFromName(Default = 500) {
        return parseFlagNumber(this.name, 'T', Default)
    }

    private timeCheck(spawnInterval: number) {
        return tickThrottle(this, spawnInterval)
    }
}
