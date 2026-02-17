import { RoleData, RoleLevelData } from '@/constant/CreepConstant'
import { decompressBodyConfig } from "@/modules/utils/compress";
import { THRESHOLDS } from '@/constant/Thresholds';

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

const hasMyConstructionSitesCached = (room: Room) => {
    const cachedSites = (room as any).constructionSite as ConstructionSite[] | undefined;
    if (cachedSites && cachedSites.length > 0) {
        for (const site of cachedSites) {
            if ((site as any).my) return true;
            else site.remove();
        }
        return false;
    }
    return false;
}

const getDowngradedLogisticsCountByHomeRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Record<string, number>> = {};
    return () => {
        if (cachedTick === Game.time) return cached;
        cachedTick = Game.time;
        cached = {};
        for (const creep of Object.values(Game.creeps)) {
            if (!creep || creep.ticksToLive < creep.body.length * 3) continue;
            if (!creep.memory?.downgraded) continue;
            const role = creep.memory.role;
            if (role !== 'transport' && role !== 'carrier' && role !== 'manager') continue;
            const home = creep.memory.home || creep.memory.homeRoom || creep.room.name;
            if (!cached[home]) cached[home] = {};
            cached[home][role] = (cached[home][role] || 0) + 1;
        }
        return cached;
    };
})();

const RoleSpawnCheck = {
    'harvester': (room: Room, current: number) => {
        if (room.memory.defend) return false;
        return current < room.source.length;
    },
    'upgrader': (room: Room, current: number) => {
        const lv = room.level;
        const mode = (room.memory as any).mode;
        const highMode = mode === 'high';
        // high 模式下，upgrader 数量翻倍（最多8个）
        const num = highMode ? Math.min(RoleLevelData['upgrader'][lv]['num'] * 2, 8) : RoleLevelData['upgrader'][lv]['num'];
        if (room.memory.defend) return false;
        const ttd = room.controller?.ticksToDowngrade || 0;
        // high 模式下放宽升级条件，只要有足够能量就升级
        if (highMode) {
            // high 模式：只要有基础能量就开始升级
            const minEnergy = lv >= 5 ? 30e3 : 10e3;
            if (room[RESOURCE_ENERGY] < minEnergy) return false;
            return current < num;
        }
        // 能量不充裕时不常驻升级
        if (lv == 8 && ttd > 100000 && room[RESOURCE_ENERGY] < 300e3) return false;
        // 能量太低暂时不升级
        if (lv >= 5 && ttd > 10000 && room[RESOURCE_ENERGY] < 50e3) return false;
        return current < num;
    },
    'transport': (room: Room, current: number) => {
        const num = RoleLevelData['transport'][room.level]['num'];
        if (current >= num) return false;
        const state = getEnergyState(room);
        if (state === 'LOW' || state === 'CRITICAL') {
            return !!(room.storage || room.terminal || (room.container && room.container.length > 0));
        }
        let energy = (room.storage?.store[RESOURCE_ENERGY] || 0) +
                        (room.terminal?.store[RESOURCE_ENERGY] || 0);
        if (energy < TRANSPORT_MIN) return false;
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

        const hasBuildMission = room.checkMissionInPool('build');
        const hasConstruction = hasMyConstructionSitesCached(room);
        const needBuilder = hasBuildMission || hasConstruction;

        // 1. 只要有建造需求，就先保证至少 1 个 worker
        if (needBuilder && current < 1) {
            // 条件可以适当放宽：房间当前能量或总能量至少能支撑一个基础体型
            if (room.energyAvailable >= THRESHOLDS.SPAWN.MIN_ENERGY || totalEnergy >= cap) {
                return true;
            }
        }

        // 2. 有大量 build 任务时，根据能量状态扩容 worker 数量
        if (hasBuildMission) {
            const buildNum = room.getMissionNumInPool('build');
            if ((state === 'SURPLUS' || state === 'NORMAL') && buildNum > 10 && current < 2) {
                return true;
            }
            if (state === 'LOW' && current < 1 && totalEnergy >= Math.max(THRESHOLDS.SPAWN.BODY_REDUCTION_THRESHOLD, cap * 2)) {
                // 如果你觉得多余，也可以直接删掉这句，只保留上面的“至少一个”逻辑
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
 * - 提供 SpawnMissionAdd 将孵化任务写入任务池并统计 global.SpawnMissionNum
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
            ? (getDowngradedLogisticsCountByHomeRoom()[this.name] || {})
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
        if (!global.SpawnMissionNum) global.SpawnMissionNum = {};
        if (!global.SpawnMissionNum[this.name]) global.SpawnMissionNum[this.name] = {};
        if (!global.SpawnMissionNum[this.name][role]) global.SpawnMissionNum[this.name][role] = 0;
        global.SpawnMissionNum[this.name][role] = global.SpawnMissionNum[this.name][role] + 1;
        return OK;
    }
}
