import { getNukerData } from "@/modules/utils/memory";

export default class NukerControl extends Room {
    /**
     * 判断本房间 nuker 是否已满足发射资源条件
     * @description Screeps 规则：发射核弹需要 300000 能量 + 5000 Ghodium
     */
    NukerHasEnoughResource() {
        const nuker = this.nuker;
        if (!nuker) return false;

        const ghodium = nuker.store[RESOURCE_GHODIUM] || 0;
        const energy = nuker.store[RESOURCE_ENERGY] || 0;

        return ghodium >= 5000 && energy >= 300000;
    }

    /**
     * 判断本房间 nuker 是否在目标房间的可发射距离内
     * @param target 目标位置或目标房间名
     * @description 核弹最大射程为 10 房间线性距离
     */
    NukerInLaunchRange(target: RoomPosition | string) {
        const targetRoomName = typeof target === 'string' ? target : target.roomName;
        return Game.map.getRoomLinearDistance(this.name, targetRoomName, true) <= 10;
    }

    /**
     * 判断本房间是否可以向目标位置发射核弹
     * @description 一次性判断以下条件：
     * - 房间中存在 nuker
     * - nuker 无冷却
     * - nuker 资源满足发射（能量 + Ghodium）
     * - 目标在射程内（<= 10 房间线性距离）
     * @param targetPos 目标位置（必须是 RoomPosition，nuker.launchNuke 需要坐标）
     */
    NukerCanLaunchTo(targetPos: RoomPosition) {
        const nuker = this.nuker;
        if (!nuker || !nuker.my) return false;
        if (!nuker.isActive()) return false;
        if (nuker.cooldown !== 0) return false;
        if (!this.NukerHasEnoughResource()) return false;
        if (!this.NukerInLaunchRange(targetPos)) return false;
        return true;
    }

    /**
     * 尝试向目标位置发射核弹
     * @description 内部会先调用 NukerCanLaunchTo 做完整校验，然后再调用 nuker.launchNuke
     * @param targetPos 目标位置
     * @returns ScreepsReturnCode
     */
    NukerLaunchTo(targetPos: RoomPosition): ScreepsReturnCode {
        const nuker = this.nuker;
        if (!nuker) return ERR_NOT_FOUND;
        if (!nuker.isActive()) return ERR_RCL_NOT_ENOUGH;
        if (nuker.cooldown !== 0) return ERR_TIRED;
        if (!this.NukerHasEnoughResource()) return ERR_NOT_ENOUGH_RESOURCES;
        if (!this.NukerInLaunchRange(targetPos)) return ERR_NOT_IN_RANGE;
        const code = nuker.launchNuke(targetPos);
        if (code === OK) {
            const nukerData = getNukerData();
            nukerData.landTime[targetPos.roomName] = Game.time + NUKE_LAND_TIME;
        }
        return code;
    }
}

