/**
 * 生产阶段门：产出就绪 / 外矿解锁判定（自 spawnRules 迁出，供孵化规则与外矿模块共用）。
 * 开局序列：先矿工孵化到位、产出稳住，之后才放行升级/搬运扩张/外矿。
 */
import { ROLES } from '@/constant/CreepConstant';
import { getRoomMode } from '@/modules/shared/roomWorkforce';
import { buildRushBody } from '@/modules/shared/rush';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';

// 单矿最大采集 work 上限
const HARVESTER_MAX_WORK_PER_SOURCE = Math.ceil(
    SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER
);

// 统计 source 周围可站位，用于估算 harvester 数量上限
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

// 用已建成的 spawn/extension 容量估算“实际可用等级”，避免 controller 刚升 4 但建筑未补齐时误判。
export const getBuiltRoomLevel = (room: Room) => {
    return room.getEffectiveRoomLevel?.() ?? room.level;
};

// 低等级允许多采集位，高等级默认一矿一采。
// 这里必须看“已建成等级”而不是 controller 等级：
// controller 刚升 4 但 spawn/extension 还没补满时，harvester 体型仍可能偏小；
// 一旦房间已经具备完整 4 级产能，就不应该再让单矿超过 1 个 harvester。
export const getHarvesterTargetBySource = (room: Room): number => {
    let target = 0;
    const builtLevel = getBuiltRoomLevel(room);
    const allowMultiHarvesterPerSource = builtLevel <= 3;
    // 定编口径必须与实际孵化体一致：rush 走 rushBody 现算（容量≥550 即 5W 满速体）。
    // 按等级表 W2 低估单体会把每源上限算成 2-3 只，5W 采集工成对孵出压爆 10e/t 源速率
    const rushBodyConfig = getRoomMode(room) === 'rush'
        ? buildRushBody(ROLES.harvester, room.energyCapacityAvailable)
        : null;
    const bodyConfig = rushBodyConfig ?? room.GetRoleBodys(ROLES.harvester);
    const harvesterBody = room.GenerateBodys(bodyConfig, ROLES.harvester);
    const workPerHarvester = Math.max(1, getWorkPartCount(harvesterBody));
    const maxByWorkCap = Math.max(1, Math.ceil(HARVESTER_MAX_WORK_PER_SOURCE / workPerHarvester));
    for (const source of room.source || []) {
        const slots = getWalkableSourceSlots(room, source);
        if (slots <= 0) continue;
        const bySlot = allowMultiHarvesterPerSource ? slots : 1;
        target += Math.min(bySlot, maxByWorkCap);
    }
    return target;
};

// 产出就绪：采矿工满编（在岗数 ≥ 编制目标）。
export const isRoomProductionSecured = (room: Room): boolean => {
    const target = getHarvesterTargetBySource(room);
    if (target <= 0) return true;
    const alive = getRoomTickCacheValue(room, 'production_secured_harvesters', () =>
        room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) => c.memory?.role === ROLES.harvester && !c.spawning,
        }).length,
    );
    return alive >= target;
};

/**
 * 外矿解锁闩：本矿产出就绪即置位，永不清除。
 * 语义落地——开启前外矿单不出（本矿链没饱和轮不到外矿），
 * 解锁后永不清剿（外矿替补在本矿崩坏时排队等待，在场爬继续采，链不断）。
 */
export const isRoomRemoteUnlocked = (room: Room): boolean => {
    const mem = room.memory as any;
    if (mem.remoteUnlocked) return true;
    if (isRoomProductionSecured(room)) {
        mem.remoteUnlocked = true;
        return true;
    }
    return false;
};
