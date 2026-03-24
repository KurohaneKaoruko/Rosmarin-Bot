import { compressBodyConfig } from "@/shared/compress";
import { log } from "@/utils";
import { getFlagSpawnLoad, isActiveAidBuildFlagCreep } from "../function/spawnLoad";
import { getSpawnRoomOrRemove } from "../utils";

const CLAIM_SPAWN_PRIORITY = 0;
const CLAIM_AID_BUILD_TARGET_COUNT = 3;

export default class ClaimSpawnFunction extends Flag {
    protected getSpawnRoomFromName() {
        return getSpawnRoomOrRemove(this);
    }

    protected getClaimFlagClaimerState(spawnRoom: Room, flagName: string, targetRoom: string) {
        let live = 0;
        const queuedTaskIds: string[] = [];

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory?.role !== 'claimer') continue;
            if (creep.memory?.targetRoom !== targetRoom) continue;
            live++;
        }

        const tasks = spawnRoom.getAllMissionFromPool('spawn') || [];
        for (const task of tasks as any[]) {
            const memory = task?.data?.memory as any;
            if (!memory) continue;
            if (memory.role !== 'claimer') continue;
            if (memory.targetRoom !== targetRoom) continue;

            if (memory.spawnFlag === flagName) queuedTaskIds.push(task.id);
        }

        return { live, queuedTaskIds };
    }

    protected handleClaimFlag(flagName: string): boolean {
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

        const claimerState = this.getClaimFlagClaimerState(room, flagName, targetRoom);
        let queuedClaimers = claimerState.queuedTaskIds.length;

        const redundantTaskIds = targetRoomObj?.my
            ? claimerState.queuedTaskIds
            : claimerState.queuedTaskIds.slice(1);
        if (redundantTaskIds.length > 0) {
            for (const taskId of redundantTaskIds) {
                room.deleteMissionFromPool('spawn', taskId);
                queuedClaimers--;
            }
            log('CLAIM', `${room.name} 清理了 ${redundantTaskIds.length} 个重复 claimer 任务 -> ${targetRoom}`);
        }

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

        const hasClaimer = claimerState.live > 0 || queuedClaimers > 0;
        if (!hasClaimer && (!targetRoomObj || !targetRoomObj.my)) {
            const ret = room.SpawnMissionAdd('', '', CLAIM_SPAWN_PRIORITY, 'claimer', { homeRoom: room.name, targetRoom, spawnFlag: flagName } as any);
            if (ret === OK) {
                log('CLAIM', `${room.name} 派出了一个 claimer 来占领 ${targetRoom}`);
            } else {
                log('CLAIM', `${room.name} 为 ${targetRoom} 下发 claimer 失败 ret=${ret}, e=${room.energyAvailable}/${room.energyCapacityAvailable}`);
            }
        }

        const claimAidLoad = getFlagSpawnLoad(
            room,
            flagName,
            'aid-build',
            (memory) => memory.targetRoom === targetRoom && memory.sourceRoom === targetRoom,
            isActiveAidBuildFlagCreep
        );
        const claimAidNum = claimAidLoad.total;

        if (claimAidNum < CLAIM_AID_BUILD_TARGET_COUNT) {
            const memory = { homeRoom: room.name, sourceRoom: targetRoom, targetRoom, spawnFlag: flagName } as any;
            const ret = room.SpawnMissionAdd('', compressBodyConfig([]), -1, 'aid-build', memory);
            if (ret === OK) {
                log('CLAIM', `${room.name} 派出了一个 aid-build 援助建造 ${targetRoom} (${claimAidNum + 1}/${CLAIM_AID_BUILD_TARGET_COUNT})`);
            } else {
                log('CLAIM', `${room.name} 为 ${targetRoom} 下发 aid-build 失败 ret=${ret}, e=${room.energyAvailable}/${room.energyCapacityAvailable}`);
            }
        }

        return true;
    }
}
