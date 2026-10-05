import { MISSION_POOLS } from '@/constant/MissionConstant';
import { ROLES } from '@/constant/CreepConstant';
import { compressBodyConfig } from "@/modules/shared/compress";
import { getRoomData } from "@/modules/shared/memory";
import { log } from "@/modules/utils";
import { getFlagSpawnLoad, isActiveAidBuildFlagCreep } from "../function/spawnLoad";
import { getSpawnRoomOrRemove, tickThrottle } from "../utils";

const CLAIM_SPAWN_PRIORITY = 0;
const CLAIM_AID_BUILD_TARGET_COUNT = 3;

// 房间坐标：直接用房名数字带正负（E/S 为正，W/N 为负：W9 = -9，N9 = -9）。
// 高速路 = 名字数字为 0/10/20/30… 的行/列（x 或 y ≡ 0 mod 10），
// SK 中心区 = 两个数字 mod 10 都在 4..6（E4-E6 / W4-W6 / N4-N6 / S4-S6）。
// 注意不能用 -n-1 偏移坐标：W/N 侧会整体错位一格，把 W9/N9 误判成高速。
const parseRoomCoords = (roomName: string): { x: number; y: number } | null => {
    const match = roomName.match(/^([EW])(\d+)([NS])(\d+)$/);
    if (!match) return null;
    return {
        x: match[1] === 'E' ? Number(match[2]) : -Number(match[2]) - 1,
        y: match[3] === 'N' ? Number(match[4]) : -Number(match[4]) - 1,
    };
};

const getRoomZoneKind = (roomName: string): 'center' | 'highway' | 'normal' => {
    const coords = parseRoomCoords(roomName);
    if (!coords) return 'normal';
    const mx = ((coords.x % 10) + 10) % 10;
    const my = ((coords.y % 10) + 10) % 10;
    if (mx === 0 || my === 0) return 'highway';
    if (mx >= 4 && mx <= 6 && my >= 4 && my <= 6) return 'center';
    return 'normal';
};

export default class ClaimSpawnFunction extends Flag {
    protected getSpawnRoomFromName() {
        return getSpawnRoomOrRemove(this);
    }

    protected getClaimFlagClaimerState(spawnRoom: Room, flagName: string, targetRoom: string) {
        let live = 0;
        const queuedTaskIds: string[] = [];

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory?.role !== ROLES.claimer) continue;
            if (creep.memory?.targetRoom !== targetRoom) continue;
            live++;
        }

        const tasks = spawnRoom.getAllMissionFromPool(MISSION_POOLS.spawn) || [];
        for (const task of tasks as any[]) {
            const memory = task?.data?.memory as any;
            if (!memory) continue;
            if (memory.role !== ROLES.claimer) continue;
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
        if (getRoomZoneKind(targetRoom) !== 'normal') {
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
                room.deleteMissionFromPool(MISSION_POOLS.spawn, taskId);
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
            const ret = room.SpawnMissionAdd('', '', CLAIM_SPAWN_PRIORITY, ROLES.claimer, { homeRoom: room.name, targetRoom, spawnFlag: flagName } as any);
            if (ret === OK) {
                log('CLAIM', `${room.name} 派出了一个 claimer 来占领 ${targetRoom}`);
            } else {
                log('CLAIM', `${room.name} 为 ${targetRoom} 下发 claimer 失败 ret=${ret}, e=${room.energyAvailable}/${room.energyCapacityAvailable}`);
            }
        }

        const claimAidLoad = getFlagSpawnLoad(
            room,
            flagName,
            ROLES['aid-build'],
            (memory) => memory.targetRoom === targetRoom && memory.sourceRoom === targetRoom,
            isActiveAidBuildFlagCreep
        );
        const claimAidNum = claimAidLoad.total;

        if (claimAidNum < CLAIM_AID_BUILD_TARGET_COUNT) {
            const memory = { homeRoom: room.name, sourceRoom: targetRoom, targetRoom, spawnFlag: flagName } as any;
            const ret = room.SpawnMissionAdd('', compressBodyConfig([]), -1, ROLES['aid-build'], memory);
            if (ret === OK) {
                log('CLAIM', `${room.name} 派出了一个 aid-build 援助建造 ${targetRoom} (${claimAidNum + 1}/${CLAIM_AID_BUILD_TARGET_COUNT})`);
            } else {
                log('CLAIM', `${room.name} 为 ${targetRoom} 下发 aid-build 失败 ret=${ret}, e=${room.energyAvailable}/${room.energyCapacityAvailable}`);
            }
        }

        return true;
    }

    // ── 自动占领旗（flag 名为 claim / claim-备注）────────────────────
    // 与 CLAIM/<孵化房> 手动指定孵化房不同：系统自动选「距目标最近、能孵化 claimer
    // （energyCapacityAvailable ≥ 700，即最低 [MOVE,CLAIM] 体型）」的己方房间派 claimer，
    // 占领成功后自动 start() 开启房间运行（加控制列表 + 布局 + 自动建造）并移除旗帜。
    protected handleAutoClaimFlag(flagName: string): boolean {
        const targetRoom = this.pos.roomName;

        // 中心房（SK 区）/ 高速房不可占领：直接撤旗
        const zone = getRoomZoneKind(targetRoom);
        if (zone !== 'normal') {
            log('CLAIM', `${targetRoom} 是${zone === 'center' ? 'SK 中心区' : '高速'}房，无法占领，已移除 ${flagName}`);
            this.remove();
            return true;
        }

        const targetRoomObj = Game.rooms[targetRoom];
        const controller = targetRoomObj?.controller;

        // 已被其他玩家拥有：普通 claimer 无能为力（强攻走 ACLAIM 流程）
        if (controller?.owner && !controller.my) {
            log('CLAIM', `${targetRoom} 已被 ${controller.owner.username} 拥有，无法直接占领，已移除 ${flagName}`);
            this.remove();
            return true;
        }

        // 已占领：清理完成的 claimer + 自动 start() 开启房间运行 + 撤旗
        if (controller?.my) {
            for (const name in Game.creeps) {
                const creep = Game.creeps[name];
                if (creep.memory?.role !== ROLES.claimer) continue;
                if (creep.memory?.targetRoom !== targetRoom) continue;
                creep.suicide();
            }

            const managed = getRoomData()[targetRoom];
            if (managed?.autobuild) {
                this.remove();
                return true;
            }
            const startResult = (global as any).room?.start?.(targetRoom, undefined, { quiet: true });
            log('CLAIM', `${targetRoom} 占领完成，自动开启房间运行 -> ${startResult === OK ? 'OK' : String(startResult)}`);
            if (startResult === OK) this.remove();
            return true;
        }

        // 未占领：同目标已有存活/排队 claimer 则不重复下发
        let liveClaimerCount = 0;
        let queuedClaimerCount = 0;
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory?.role !== ROLES.claimer) continue;
            if (creep.memory?.targetRoom !== targetRoom) continue;
            liveClaimerCount++;
        }
        for (const room of Object.values(Game.rooms)) {
            if (!room.my) continue;
            const tasks = room.getAllMissionFromPool(MISSION_POOLS.spawn) || [];
            for (const task of tasks as any[]) {
                const memory = task?.data?.memory as any;
                if (memory?.role !== ROLES.claimer) continue;
                if (memory.targetRoom !== targetRoom) continue;
                queuedClaimerCount++;
            }
        }
        if (liveClaimerCount + queuedClaimerCount > 0) return true;

        // 自动选「最近 + 能孵化 claimer」的己方房间（linear distance 最近优先）
        const CLAIM_BODY_MIN_COST = 700;   // 最低 [MOVE 1, CLAIM 1] 的造价
        let bestRoom: Room | null = null;
        let bestDistance = Infinity;
        for (const room of Object.values(Game.rooms)) {
            if (!room.my) continue;
            if ((room.energyCapacityAvailable || 0) < CLAIM_BODY_MIN_COST) continue;
            const distance = Game.map.getRoomLinearDistance(room.name, targetRoom, true);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestRoom = room;
            }
        }
        if (!bestRoom) {
            if (tickThrottle(this, 300, 'noSpawnRoomWarn')) {
                log('CLAIM', `没有能孵化 claimer 的己方房间（需 energyCapacityAvailable ≥ ${CLAIM_BODY_MIN_COST}），${flagName} 稍后重试`);
            }
            return true;
        }

        const ret = bestRoom.SpawnMissionAdd('', '', CLAIM_SPAWN_PRIORITY, ROLES.claimer, { homeRoom: bestRoom.name, targetRoom, spawnFlag: flagName } as any);
        if (ret === OK) {
            log('CLAIM', `自动占领：${bestRoom.name}（距离 ${bestDistance}）派出 claimer -> ${targetRoom}`);
        } else {
            log('CLAIM', `自动占领：${bestRoom.name} 下发 claimer 失败 ret=${ret}, e=${bestRoom.energyAvailable}/${bestRoom.energyCapacityAvailable}`);
        }
        return true;
    }
}
