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
    const cfg = getRoomData(room.name) as any;
    const enabled = cfg?.devRush ?? cfg?.rcl3Rush;
    if (!enabled) return false;

    const rawMax = cfg?.devRushMaxRcl;
    const maxRcl = Math.max(1, Math.min(8, typeof rawMax === 'number' ? Math.floor(rawMax) : 3));
    return room.level <= maxRcl;
}


const getEarlyRushMaxRcl = (room: Room) => {
    const cfg = getRoomData(room.name) as any;
    const rawMax = cfg?.devRushMaxRcl;
    return Math.max(1, Math.min(8, typeof rawMax === 'number' ? Math.floor(rawMax) : 3));
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

const getHarvesterTargetBySource = (room: Room): number => {
    let target = 0;
    const lowRcl = room.level <= 3;
    for (const source of room.source || []) {
        const slots = getWalkableSourceSlots(room, source);
        // RCL 1~3：按可站位直接决定采集孵化数量。
        // 其他等级：每 source 恢复为 1 个（若无可站位则为 0）。
        target += lowRcl ? slots : Math.min(1, slots);
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
        let num = highMode ? Math.min(baseNum * 2, 8) : baseNum;
        if (room.memory.defend) return false;
        const state = getEnergyState(room);
        if (earlyRush) {
            if (lv <= 2) num = Math.max(num, 4);
            else if (lv === 3) num = Math.max(num, 5);

            const coreSiteCount = getCoreConstructionSiteCount(room);
            if (coreSiteCount > 0) {
                num = Math.max(2, num - 1);
            }

            if (state === 'CRITICAL' && room.energyAvailable < THRESHOLDS.SPAWN.MIN_ENERGY && current >= 2) {
                return false;
            }
            return current < num;
        }
        const ttd = room.controller?.ticksToDowngrade || 0;
        if (highMode) {
            if (state === 'CRITICAL') return false;
            if (state === 'LOW' && ttd > 10000 && current >= 1) return false;

            const minEnergy = lv >= 8 ? 120e3 : lv >= 6 ? 60e3 : lv >= 5 ? 30e3 : 10e3;
            if (getTotalEnergy(room) < minEnergy) return false;

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
        const earlyRush = isEarlyRushEnabled(room);

        const hasBuildMission = room.checkMissionInPool('build');
        const siteCount = getMyConstructionSites(room).length;
        const coreSiteCount = getCoreConstructionSiteCount(room);
        const hasConstruction = siteCount > 0;
        const needBuilder = hasBuildMission || hasConstruction;

        // 1. 只要有建造需求，就先保证至少 1 个 worker
        if (needBuilder && current < 1) {
            // 条件可以适当放宽：房间当前能量或总能量至少能支撑一个基础体型
            if (room.energyAvailable >= THRESHOLDS.SPAWN.MIN_ENERGY || totalEnergy >= cap) {
                return true;
            }
        }

        // 2. 有建造需求时，根据工地规模和模式扩容 worker 数量
        if (needBuilder) {
            if (room.level === 3) {
                // RCL3 建造阶段：按工地规模动态提高 worker，显著加速起房速度。
                let rcl3Target = 2;
                if (siteCount >= 8 || coreSiteCount >= 3) rcl3Target = 3;
                if (siteCount >= 16 || coreSiteCount >= 7) rcl3Target = 4;
                if (earlyRush) rcl3Target = Math.min(5, rcl3Target + 1);
                if (state === 'LOW') rcl3Target = Math.min(rcl3Target, 3);
                if (state === 'CRITICAL') rcl3Target = 1;

                if (current < rcl3Target &&
                    (room.energyAvailable >= THRESHOLDS.SPAWN.MIN_ENERGY || totalEnergy >= cap)) {
                    return true;
                }
            }

            if (earlyRush) {
                // 通用前期冲刺：不锁死 RCL3，按 devRushMaxRcl 内的等级与工地规模动态扩容 worker。
                const maxRcl = getEarlyRushMaxRcl(room);
                let rushTarget = room.level <= 2 ? 2 : 3;
                if (siteCount >= 8 || coreSiteCount >= 3) rushTarget += 1;
                if (siteCount >= 16 || coreSiteCount >= 7) rushTarget += 1;
                const hardCap = room.level <= 2 ? 4 : 5;
                rushTarget = Math.min(rushTarget, hardCap);
                // 越接近冲刺上限，适当保守，避免在更高 RCL 过度挤占物流角色。
                if (room.level >= maxRcl) rushTarget = Math.max(2, rushTarget - 1);
                if (state === 'CRITICAL') rushTarget = 1;
                if (state === 'LOW') rushTarget = Math.min(rushTarget, room.level <= 2 ? 2 : 3);
                if (current < rushTarget &&
                    (room.energyAvailable >= THRESHOLDS.SPAWN.MIN_ENERGY || totalEnergy >= cap)) {
                    return true;
                }
            }

            if ((state === 'SURPLUS' || state === 'NORMAL') && siteCount >= 6 && current < 2) {
                return true;
            }
            if (state === 'SURPLUS' && siteCount >= 16 && current < 3) {
                return true;
            }
            if (state === 'LOW' && current < 1 && totalEnergy >= Math.max(THRESHOLDS.SPAWN.BODY_REDUCTION_THRESHOLD, cap * 2)) {
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
        const hasMineralContainer = room.container?.some(c => c.pos.isNearTo(mineralPos));
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
        if (current < 2 && lv < 3) {
            return (!room.container || room.container.length < 1);
        }
        return false;
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
