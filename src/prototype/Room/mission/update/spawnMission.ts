import { RoleData, RoleLevelData } from '@/constant/CreepConstant'
import { decompressBodyConfig } from "@/modules/utils/compress";
import { THRESHOLDS } from '@/constant/Thresholds';
import { getRoomData } from '@/modules/utils/memory';
import { getDowngradedLogisticsCountByHomeRoom, hasSoonDeadCreepByHomeRoomRole } from '@/modules/utils/creepTickIndex';

// 孵化相关
const SPAWN_MIN_ENERGY = THRESHOLDS.SPAWN.EMERGENCY_ENERGY_THRESHOLD * 50;
// 维修相关
const REPAIR_MIN_ENERGY = THRESHOLDS.ENERGY.WALL_MIN * 2;
// 刷墙相关
const WALL_MIN_ENERGY = THRESHOLDS.ENERGY.WALL_MIN;
// 搬运任务生成阈值
const TRANSPORT_MIN = THRESHOLDS.TRANSPORT.MIN_AMOUNT;
const TRANSPORT_HIGH = THRESHOLDS.TRANSPORT.HIGH_AMOUNT;
const WORKER_MIN_SPAWN_ENERGY = BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE] * 2;
const HARVESTER_MAX_WORK_PER_SOURCE = 8;
const WORKER_BUILD_REFERENCE_WORK = 3;

const getEnergyState = (room: Room) => {
    return (room.memory as any).energyState || (room as any).updateEnergyState?.(false) || 'NORMAL';
}

const getTotalEnergy = (room: Room) => {
    return (room as any).getEnergyProfile?.().totalEnergy ?? (room as any)[RESOURCE_ENERGY] ?? 0;
}

const getStoredEnergy = (room: Room) => {
    return (room.storage?.store[RESOURCE_ENERGY] || 0) +
        (room.terminal?.store[RESOURCE_ENERGY] || 0);
}

const getRoomMode = (room: Room) => {
    return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
}

const isHighLikeMode = (mode: string) => mode === 'high' || mode === 'rush';

const isEarlyRushEnabled = (room: Room) => {
    return getRoomMode(room) === 'rush';
}

const hasControllerEnergyBuffer = (room: Room) => {
    if (!room.controller) return false;
    const hasLink = room.link?.some(link => link.pos.inRangeTo(room.controller!.pos, 2));
    if (hasLink) return true;
    return !!room.container?.some(container => container.pos.inRangeTo(room.controller!.pos, 3));
}

const getMyConstructionSites = (room: Room) => {
    const cachedSites = (room as any).constructionSite as ConstructionSite[] | undefined;
    const sites = (cachedSites && cachedSites.length > 0)
        ? cachedSites
        : room.find(FIND_CONSTRUCTION_SITES);
    return sites.filter((s) => s && (s as any).my);
}

const hasMyConstructionSitesCached = (room: Room) => {
    return getMyConstructionSites(room).length > 0;
}

const getControllerUpgradeSlots = (room: Room) => {
    const cached = (room as any)._controllerUpgradeSlots;
    if (typeof cached === 'number') return cached;
    const controller = room.controller;
    if (!controller) return 0;

    const terrain = room.getTerrain();
    const cx = controller.pos.x;
    const cy = controller.pos.y;
    let slots = 0;

    for (let x = Math.max(0, cx - 3); x <= Math.min(49, cx + 3); x++) {
        for (let y = Math.max(0, cy - 3); y <= Math.min(49, cy + 3); y++) {
            const pos = new RoomPosition(x, y, room.name);
            if (pos.getRangeTo(controller) > 3) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

            const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
            const blocked = structures.some((s: any) =>
                s.structureType !== STRUCTURE_ROAD &&
                s.structureType !== STRUCTURE_CONTAINER &&
                !(s.structureType === STRUCTURE_RAMPART && s.my)
            );
            if (blocked) continue;
            slots++;
        }
    }

    (room as any)._controllerUpgradeSlots = slots;
    return slots;
}

const getStorageDrivenUpgraderTarget = (room: Room, baseNum: number) => {
    if (!room.storage || room.level >= 8) return baseNum;
    const storageEnergy = room.storage.store[RESOURCE_ENERGY] || 0;
    const offset = Math.max(0, room.level - 3.5) * 10000;
    const linearNeed = Math.floor(Math.max(0, storageEnergy - offset) / 100000);
    if (linearNeed <= 0) return baseNum;
    return Math.max(baseNum, Math.min(baseNum + 2, linearNeed));
}

const countMyConstructionSitesByType = (room: Room, structureType: StructureConstant) => {
    let count = 0;
    for (const site of getMyConstructionSites(room)) {
        if (site.structureType === structureType) count++;
    }
    return count;
}

const hasIncompletePrimaryStructures = (room: Room) => {
    const level = room.level;
    const spawnCount = (room.spawn?.length || 0) + countMyConstructionSitesByType(room, STRUCTURE_SPAWN);
    const extensionCount = (room.extension?.length || 0) + countMyConstructionSitesByType(room, STRUCTURE_EXTENSION);
    if (spawnCount < (CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][level] || 0)) return true;
    if (extensionCount < (CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][level] || 0)) return true;
    if (level >= 4) {
        const storageCount = (room.storage ? 1 : 0) + countMyConstructionSitesByType(room, STRUCTURE_STORAGE);
        if (storageCount < 1) return true;
    }
    if (level >= 6) {
        const terminalCount = (room.terminal ? 1 : 0) + countMyConstructionSitesByType(room, STRUCTURE_TERMINAL);
        if (terminalCount < 1) return true;
    }
    return false;
}

const shouldDelayUpgraderForPrimaryBuild = (room: Room) => {
    const state = getEnergyState(room);
    const lowPhase = room.level <= 6 || state === 'LOW' || state === 'CRITICAL';
    if (!lowPhase) return false;
    return hasIncompletePrimaryStructures(room);
}

const getDowngradeUniversalTarget = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my) return 0;
    const ttd = controller.ticksToDowngrade || 0;
    const slotCap = Math.max(1, getControllerUpgradeSlots(room));
    const urgentThreshold = room.level <= 3 ? 5000 : 3000;
    if (ttd < 1500) return Math.min(2, slotCap);
    if (ttd < urgentThreshold) return 1;
    return 0;
}

const getCoreConstructionSiteCount = (room: Room) => {
    let count = 0;
    for (const site of getMyConstructionSites(room)) {
        if (site.structureType === STRUCTURE_SPAWN ||
            site.structureType === STRUCTURE_EXTENSION ||
            site.structureType === STRUCTURE_TOWER ||
            site.structureType === STRUCTURE_CONTAINER) {
            count++;
        }
    }
    return count;
}

const getWalkableSourceSlots = (room: Room, source: Source): number => {
    const terrain = room.getTerrain();
    let slots = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = source.pos.x + dx;
            const y = source.pos.y + dy;
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

            const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
            const blocked = structures.some((s: any) =>
                s.structureType !== STRUCTURE_ROAD &&
                s.structureType !== STRUCTURE_CONTAINER &&
                !(s.structureType === STRUCTURE_RAMPART && s.my)
            );
            if (blocked) continue;
            slots++;
        }
    }
    return slots;
};

const getWorkPartCount = (body: BodyPartConstant[]) => {
    let work = 0;
    for (const part of body) {
        if (part === WORK) work++;
    }
    return work;
};

const getGeneratedWorkerWorkPartCount = (room: Room) => {
    const cached = (room as any)._generatedWorkerWorkPartCount;
    if (typeof cached === 'number') return cached;

    const workerBodyConfig = room.GetRoleBodys('worker');
    const workerBody = room.GenerateBodys(workerBodyConfig, 'worker');
    const workParts = Math.max(1, getWorkPartCount(workerBody));
    (room as any)._generatedWorkerWorkPartCount = workParts;
    return workParts;
};

const scaleWorkerConstructionTarget = (room: Room, baseTarget: number, maxTarget: number) => {
    const workPerWorker = getGeneratedWorkerWorkPartCount(room);
    const scaledTarget = Math.ceil(baseTarget * WORKER_BUILD_REFERENCE_WORK / workPerWorker);
    return Math.max(baseTarget, Math.min(maxTarget, scaledTarget));
};

const getHarvesterTargetBySource = (room: Room): number => {
    let target = 0;
    const lowRcl = room.level <= 3;
    const harvesterBody = room.GenerateBodys(room.GetRoleBodys('harvester'), 'harvester');
    const workPerHarvester = Math.max(1, getWorkPartCount(harvesterBody));
    const maxByWorkCap = Math.max(1, Math.floor(HARVESTER_MAX_WORK_PER_SOURCE / workPerHarvester));
    for (const source of room.source || []) {
        const slots = getWalkableSourceSlots(room, source);
        if (slots <= 0) continue;
        // RCL 1~3：按可站位直接决定采集孵化数量。
        // 其他等级：恢复为每 source 1 个（若无可站位则为 0）。
        const bySlot = lowRcl ? slots : 1;
        target += Math.min(bySlot, maxByWorkCap);
    }
    return target;
};

const RoleSpawnCheck = {
    'harvester': (room: Room, current: number) => {
        if (room.memory.defend) return false;
        let num = getHarvesterTargetBySource(room);
        if (num <= 0) return false;
        if (isHighLikeMode(getRoomMode(room))) {
            // High mode pre-spawns one replacement when a local harvester is near expiry.
            const shouldPreSpawn = hasSoonDeadCreepByHomeRoomRole(room.name, 'harvester', 10);
            if (shouldPreSpawn) num += 1;
        }
        return current < num;
    },
    'upgrader': (room: Room, current: number) => {
        const lv = room.level;
        const mode = getRoomMode(room);
        const highMode = isHighLikeMode(mode);
        const earlyRush = isEarlyRushEnabled(room);
        const baseNum = RoleLevelData['upgrader'][lv]['num'];
        // high/rush 下提高 upgrader 基线：high 稳步增加，rush 采用更激进目标。
        const highBaseTarget = Math.min(baseNum * 2 + 1, 10);
        const rushBaseTarget = Math.min(baseNum * 3, 12);
        let num = highMode ? (mode === 'rush' ? rushBaseTarget : highBaseTarget) : baseNum;
        if (room.memory.defend) return false;
        if (getDowngradeUniversalTarget(room) > 0) return false;
        if (shouldDelayUpgraderForPrimaryBuild(room)) return false;
        const state = getEnergyState(room);
        const ttd = room.controller?.ticksToDowngrade || 0;
        const slotCap = Math.max(1, getControllerUpgradeSlots(room));

        num = Math.max(num, getStorageDrivenUpgraderTarget(room, baseNum));
        num = Math.min(num, slotCap);

        if (earlyRush) {
            // rush 前期冲级时提高最低升级人数，保证 controller 提速。
            if (lv <= 2) num = Math.max(num, 6);
            else if (lv === 3) num = Math.max(num, 7);
            else num = Math.max(num, 6);

            const coreSiteCount = getCoreConstructionSiteCount(room);
            if (coreSiteCount > 0) {
                num = Math.max(2, num - 1);
            }

            num = Math.min(num, slotCap);
            if (state === 'CRITICAL' && room.energyAvailable < THRESHOLDS.SPAWN.MIN_ENERGY && current >= 2) {
                return false;
            }
            return current < num;
        }
        if (highMode) {
            if (state === 'CRITICAL' && ttd > 2000) return false;
            if (state === 'LOW' && ttd > 10000 && current >= 1) return false;

            const minEnergy = lv >= 8 ? 120e3 : lv >= 6 ? 60e3 : lv >= 5 ? 30e3 : 10e3;
            if (getTotalEnergy(room) < minEnergy && ttd > 3000) return false;

            if (!hasControllerEnergyBuffer(room) && lv >= 6) {
                num = Math.min(num, baseNum + 1);
            }

            const creepNum = room.getCreepNum() || {};
            const spawnMissionNum = room.getSpawnMissionNum() || {};
            const logisticsNum =
                (creepNum['transport'] || 0) +
                (creepNum['manager'] || 0) +
                (spawnMissionNum['transport'] || 0) +
                (spawnMissionNum['manager'] || 0);
            if (logisticsNum === 0 && lv >= 5) {
                num = Math.min(num, baseNum + 1);
            }

            return current < num;
        }
        if (lv == 8 && ttd > 100000 && room[RESOURCE_ENERGY] < 300e3) return false;
        if (lv >= 5 && ttd > 10000 && room[RESOURCE_ENERGY] < 50e3) return false;
        return current < num;
    },
    'transport': (room: Room, current: number) => {
        const highMode = isHighLikeMode(getRoomMode(room));
        const state = getEnergyState(room);
        const storedEnergy = getStoredEnergy(room);
        let num = RoleLevelData['transport'][room.level]['num'];
        if (highMode && state !== 'LOW' && state !== 'CRITICAL') {
            if (storedEnergy >= TRANSPORT_HIGH) num += 1;
            if (storedEnergy >= TRANSPORT_HIGH * 3 && hasControllerEnergyBuffer(room)) num += 1;
            num = Math.min(num, 3);
        }
        if (current >= num) return false;
        if (state === 'LOW' || state === 'CRITICAL') {
            return !!(room.storage || room.terminal || (room.container && room.container.length > 0));
        }
        if (storedEnergy < TRANSPORT_MIN) return false;
        return !!(room.storage || room.terminal);
    },
    'manager': (room: Room, current: number) => {
        const num = RoleLevelData['manager'][room.level]['num'];
        if (num == 0) return false;
        const center = room.getCenter();
        const storage = room.storage;
        const terminal = room.terminal;
        const link = room.link.find(l => l.pos.inRangeTo(center, 1));
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

        const state = getEnergyState(room);
        const cap = room.energyCapacityAvailable || 0;
        const totalEnergy = getTotalEnergy(room);
        const mode = getRoomMode(room);
        const highMode = isHighLikeMode(mode);
        const earlyRush = isEarlyRushEnabled(room);
        const workerSpawnEnergyMin = Math.max(THRESHOLDS.SPAWN.MIN_ENERGY, WORKER_MIN_SPAWN_ENERGY);

        const hasBuildMission = room.checkMissionInPool('build');
        const siteCount = getMyConstructionSites(room).length;
        const coreSiteCount = getCoreConstructionSiteCount(room);
        const hasConstruction = siteCount > 0;
        const needBuilder = hasBuildMission || hasConstruction;
        const minWorkerTarget = scaleWorkerConstructionTarget(room, 1, room.level <= 2 ? 3 : 2);

        // 1. 只要有建造需求，就先保证至少 1 个 worker
        if (needBuilder && current < minWorkerTarget) {
            // 条件可以适当放宽：房间当前能量或总能量至少能支撑一个基础体型
            if (room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap) {
                return true;
            }
        }

        // 2. 有建造需求时，根据工地规模和模式扩容 worker 数量
        if (needBuilder) {
            if (earlyRush) {
                let rushTarget = 5;
                if (state === 'CRITICAL') rushTarget = 1;
                if (state === 'LOW') rushTarget = Math.min(rushTarget, room.level <= 2 ? 2 : 3);
                rushTarget = scaleWorkerConstructionTarget(room, rushTarget, room.level <= 2 ? 6 : 5);
                if (current < rushTarget &&
                    (room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap)) {
                    return true;
                }
            }

            if (highMode) {
                let highTarget = room.level <= 2 ? 2 : 3;
                if (siteCount >= 6 || coreSiteCount >= 2) highTarget += 1;
                if (siteCount >= 12 || coreSiteCount >= 5) highTarget += 1;
                // high 需要增产，但上限低于 rush（rush 最多）
                highTarget = Math.min(highTarget, room.level <= 2 ? 3 : 4);
                if (state === 'CRITICAL') highTarget = 1;
                if (state === 'LOW') highTarget = Math.min(highTarget, room.level <= 2 ? 2 : 3);
                highTarget = scaleWorkerConstructionTarget(room, highTarget, room.level <= 2 ? 5 : 4);
                if (current < highTarget &&
                    (room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap)) {
                    return true;
                }
            }

            const normalBuildTarget = scaleWorkerConstructionTarget(room, 2, room.level <= 2 ? 4 : 3);
            if ((state === 'SURPLUS' || state === 'NORMAL') && siteCount >= 6 && current < normalBuildTarget) {
                return true;
            }
            const surplusBuildTarget = scaleWorkerConstructionTarget(room, 3, room.level <= 2 ? 5 : 4);
            if (state === 'SURPLUS' && siteCount >= 16 && current < surplusBuildTarget) {
                return true;
            }
            const lowBuildTarget = Math.min(minWorkerTarget, room.level <= 2 ? 2 : 1);
            if (state === 'LOW' && current < lowBuildTarget && totalEnergy >= Math.max(THRESHOLDS.SPAWN.BODY_REDUCTION_THRESHOLD, cap * 2)) {
                return true;
            }
        }

        // 3. 没有建造需求时，走刷墙逻辑
        if (!needBuilder) {
            if (current >= 1 || room[RESOURCE_ENERGY] < REPAIR_MIN_ENERGY) return false;

            if (room.level < 8 || Game.flags[`${room.name}/REPAIR`]) {
                if (room.getWallMission(null as any)) return true;
            }
            if (!room.tower || room.tower.length === 0) {
                return room.getMissionNumInPool('repair') >= 20;
            }
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
        const mineralPos = room.mineral.pos;
        const sources = room.source || room.find(FIND_SOURCES);
        const hasMineralContainer = room.container?.some((c) => {
            if (!c.pos.isNearTo(mineralPos)) return false;
            const isSourceContainer = sources.some((s) => s && c.pos.isNearTo(s.pos));
            const isControllerContainer = !!room.controller && c.pos.inRangeTo(room.controller.pos, 1);
            return !isSourceContainer && !isControllerContainer;
        });
        if (!hasMineralContainer) return false;
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
        let target = getDowngradeUniversalTarget(room);
        if (lv >= 3) return current < target;
        if (room.container && room.container.length > 0) return current < target;

        const mode = getRoomMode(room);
        target = Math.max(target, 2);
        if (isHighLikeMode(mode)) target = 3;
        if (mode === 'rush') target = 5;
        return current < target;
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

/**
 * 房间孵化任务模块（spawn）
 * @description
 * - 根据房间状态与 RoleSpawnCheck 规则动态生成孵化任务
 * - 提供 SpawnMissionAdd 将孵化任务写入任务池，并失效 SpawnMissionNum 缓存
 */
export default class SpawnMission extends Room {
    /**
     * spawn 更新入口
     * @description 按角色规则检查缺口并生成对应孵化任务
     * @returns true 表示已执行检查，false 表示不满足条件（例如无 spawn）
     */
    UpdateSpawnMission(offset = 0) {
        if (!this.spawn) return false;
        
        const CreepNum = this.getCreepNum();
        const SpawnMissionNum = this.getSpawnMissionNum();
        const state = getEnergyState(this);
        const shouldRecover = state === 'NORMAL' || state === 'SURPLUS';
        const downgradedCount: Record<string, number> = shouldRecover
            ? (getDowngradedLogisticsCountByHomeRoom(this.name))
            : {};
    
        for (const role in RoleSpawnCheck) {
            const current = (CreepNum[role] || 0) + (SpawnMissionNum[role] || 0);
            const adjusted = shouldRecover ? Math.max(0, current - (downgradedCount[role] || 0)) : current;
            if (RoleSpawnCheck[role](this, adjusted)) {
                this.SpawnMissionAdd(
                    RoleData[role].code,
                    '',
                    RoleData[role]['level'],
                    role,
                    { home: this.name } as CreepMemory
                );
            }
        }
    
        return true;
    }

    /**
     * 添加孵化任务（spawn）
     * @param name - 孵化任务标识（常用 RoleData[role].code）
     * @param body - 身体配置（数组或压缩字符串）
     * @param level - 任务优先级；<0 时使用默认等级
     * @param role - creep 角色
     * @param memory - creep memory（会克隆并写入 role）
     * @param upbody - 是否启用升级 body（可选）
     * @returns OK 表示入队成功，-1 表示失败
     */
    SpawnMissionAdd(name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, role: string, memory?: CreepMemory, upbody?: boolean) {
        if (!RoleData[role]) {
            console.log(`role ${role} 不存在`);
            return -1;
        }

        if(!memory) memory = {} as CreepMemory;
        else memory = { ...(memory as any) } as CreepMemory;
        memory.role = role;
        
        if(level < 0) level = RoleData[role].level;
        let bodypart: BodyPartConstant[];
        let energy: number = 0;
        if (typeof body === 'string') {
            bodypart = this.GenerateBodys(decompressBodyConfig(body), role)
            energy = this.CalculateEnergy(bodypart);
        } else {
            bodypart = this.GenerateBodys(body, role);
            energy = this.CalculateEnergy(bodypart);
        }

        if(energy > this.energyCapacityAvailable) return -1;
        
        if (upbody === undefined) {
            this.addMissionToPool('spawn', 'spawn', level, {name, body, memory, energy})
        } else {
            upbody = upbody || false;
            this.addMissionToPool('spawn', 'spawn', level, {name, body, memory, energy, upbody})
        }
        return OK;
    }
}
