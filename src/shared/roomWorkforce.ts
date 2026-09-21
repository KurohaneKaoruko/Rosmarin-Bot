/**
 * 房间劳动力定编（worker 三侧：建造 / 刷墙 / 升级）。
 *
 * 定编原则：
 * - 升级是能量的默认出口：采集收入持续流入时，升级吞吐（总 WORK 数）跟随
 *   「收入 × 能量水平」缩放，富余能量优先被控制器吃掉，而不是堆积在
 *   容器/地面腐烂（吞吐 ≈ 收入，terminal 房按盈余追加）。
 * - 能量水平低于标准储量（level<90）→ 吞吐按比例收缩而不是归零；
 *   高于 moreUpgraders（level>120）→ 在收入之上追加「吃盈余」的工位。
 * - 建造/刷墙与升级是两份独立定编（相加），运行时由 worker 动作层做职责切分：
 *   建造配额之外的个体专职升级，避免「全员建造维修 → 升级饿死 → 能量堆积」。
 *
 * 本模块不依赖 CreepConstant（避免测试环境缺全局常量时模块加载失败），
 * 体型信息一律通过 room.GetRoleBodys / room.GenerateBodys 运行时获取。
 */
import { getEnergyLevel } from '@/shared/energyLevel';
import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { decompress } from '@/shared/compress';
import { getRoomData } from '@/shared/memory';
import { THRESHOLDS } from '@/constant/Thresholds';

// —— 能量水平档位 ——
/** startFunnel：低于该档升级吞吐按收入等比收缩（不归零） */
const LEVEL_THROTTLE = 90;
/** moreUpgraders：高于该档在收入之上追加「吃盈余」的升级工 */
const LEVEL_MORE_UPGRADERS = 120;
/** workerFirst：RCL8 维持满吞吐（15 work/tick）的富余档 */
const LEVEL_RCL8_ACTIVE = 110;
/** 控制器临近降级：升级吞吐保底 5 work（配合 universal 降级兜底） */
export const UPGRADE_NEEDED_TTD = 10000;

// 无控制器缓冲（link/container）时，升级工要往返主仓取能，吞吐折半，封顶收紧
const NO_BUFFER_WORK_CAP = 30;
// 有控制器缓冲时的吞吐上限
const BUFFERED_WORK_CAP = 90;
// RCL8 每 tick 最多向控制器投入 15 能量
const getRcl8MaxWork = () =>
    typeof CONTROLLER_MAX_UPGRADE_PER_TICK === 'number' ? CONTROLLER_MAX_UPGRADE_PER_TICK : 15;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// ==================== 通用房间状态 ====================

export const getRoomEnergyState = (room: Room): string =>
    (room.memory as any).energyState || (room as any).updateEnergyState?.(false) || 'NORMAL';

export const getRoomMode = (room: Room): string =>
    (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';

export const isHighLikeMode = (mode: string) => mode === 'high' || mode === 'rush';

// 以 room.getEnergyProfile 为准，否则退化为 room[RESOURCE_ENERGY] 统计
export const getTotalEnergy = (room: Room): number =>
    (room as any).getEnergyProfile?.().totalEnergy ?? (room as any)[RESOURCE_ENERGY] ?? 0;

// storage/terminal 的能量用于判断运输体系是否成立
export const getStoredEnergy = (room: Room) => {
    return (room.storage?.store[RESOURCE_ENERGY] || 0) +
        (room.terminal?.store[RESOURCE_ENERGY] || 0);
};

// 判断 controller 附近是否具备稳定的能量缓存（link/container）
export const hasControllerEnergyBuffer = (room: Room) => {
    if (!room.controller) return false;
    const hasLink = room.link?.some(link => link.pos.inRangeTo(room.controller!.pos, 2));
    if (hasLink) return true;
    return !!room.container?.some(container => container.pos.inRangeTo(room.controller!.pos, 3));
};

// ==================== 工地统计 ====================

// 仅统计自己的工地，避免被他人干扰孵化逻辑
export const getMyConstructionSites = (room: Room) => {
    const cachedSites = (room as any).constructionSite as ConstructionSite[] | undefined;
    const sites = (cachedSites && cachedSites.length > 0)
        ? cachedSites
        : room.find(FIND_CONSTRUCTION_SITES);
    return sites.filter((site) => site && (site as any).my);
};

const countMyConstructionSitesByType = (room: Room, structureType: StructureConstant) => {
    let count = 0;
    for (const site of getMyConstructionSites(room)) {
        if (site.structureType === structureType) count++;
    }
    return count;
};

// 仅统计核心建筑工地，避免小规模工地影响判断
export const getCoreConstructionSiteCount = (room: Room) => {
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
};

// 核心建筑未齐全时，升级器会被延迟以优先补齐基础设施
const hasIncompletePrimaryStructures = (room: Room) => {
    const level = room.level;
    const spawnCount = (room.spawn?.length || 0) + countMyConstructionSitesByType(room, STRUCTURE_SPAWN);
    const extensionCount = (room.extension?.length || 0) + countMyConstructionSitesByType(room, STRUCTURE_EXTENSION);
    if (spawnCount < (CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][level] || 0)) return true;
    if (extensionCount < (CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][level] || 0)) return true;
    if (level >= 3) {
        const towerCount = (room.tower?.length || 0) + countMyConstructionSitesByType(room, STRUCTURE_TOWER);
        if (towerCount < (CONTROLLER_STRUCTURES[STRUCTURE_TOWER][level] || 0)) return true;
    }
    if (level >= 4) {
        const storageCount = (room.storage ? 1 : 0) + countMyConstructionSitesByType(room, STRUCTURE_STORAGE);
        if (storageCount < 1) return true;
    }
    if (level >= 6) {
        const terminalCount = (room.terminal ? 1 : 0) + countMyConstructionSitesByType(room, STRUCTURE_TERMINAL);
        if (terminalCount < 1) return true;
    }
    return false;
};

/**
 * 低能量阶段且核心建筑未齐时，推迟 upgrader 生成。
 *
 * 基建优先但仅限「真的穷」的时候：NORMAL/SURPLUS 下即使基建未齐也保持升级吞吐
 * （building 态只影响建造优先级，不阻断升级收入侧）——
 * 否则能量只进不出，堆积在容器/地面腐烂。
 */
export const shouldDelayUpgraderForPrimaryBuild = (room: Room) => {
    const state = getRoomEnergyState(room);
    if (state !== 'LOW' && state !== 'CRITICAL') return false;
    return hasIncompletePrimaryStructures(room);
};

// ==================== 降级兜底 / 冲级编队 ====================

// 控制器降级风险时，强制补 UNIV 作为兜底维修/升级
export const getDowngradeUniversalTarget = (room: Room) => {
    const controller = room.controller;
    if (!controller?.my) return 0;
    const ttd = controller.ticksToDowngrade || 0;
    if (ttd < THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TTD) {
        return THRESHOLDS.UNIVERSAL.CONTROLLER_DOWNGRADE_FORCE_TARGET;
    }
    return 0;
};

// 计算降级兜底还缺多少 UNIV
export const getDowngradeUniversalSpawnMissing = (room: Room, current: number) => {
    return Math.max(0, getDowngradeUniversalTarget(room) - current);
};

// 冲级编队（up-upgrade）在场时，升级吞吐完全交给编队
export const getRushUpgraderCount = (room: Room) => {
    const creepNum = room.getCreepNum?.() || {};
    const spawnMissionNum = room.getSpawnMissionNum?.() || {};
    return (creepNum['up-upgrade'] || 0) + (spawnMissionNum['up-upgrade'] || 0);
};

// ==================== 升级吞吐 ====================

const getSourceEnergyPerTick = () =>
    ((typeof SOURCE_ENERGY_CAPACITY === 'number' ? SOURCE_ENERGY_CAPACITY : 3000) /
        (typeof ENERGY_REGEN_TIME === 'number' ? ENERGY_REGEN_TIME : 300));

/**
 * 估算房间每 tick 的能量收入（升级侧要吃掉的流入量）：
 * - 本矿：按绑定 harvester 的 WORK 产能折算，单矿封顶 10/tick（再生上限）；
 * - 外矿：在编 out-harvest 每个 按 5/tick 折算路损，封顶 20。
 */
export const estimateRoomEnergyIncome = (room: Room): number => {
    return getRoomTickCacheValue(room, 'workforce_income_estimate', () => {
        let income = 0;
        const sources = (room as any).source as Source[] | undefined;
        if (sources && sources.length && typeof room.find === 'function') {
            const harvesters = room.find(FIND_MY_CREEPS, {
                filter: (c: Creep) => !!(c && c.memory && c.memory.role === 'harvester' && c.memory.targetSourceId),
            }) as Creep[];
            const perSourceCap = getSourceEnergyPerTick();
            for (const source of sources) {
                if (!source) continue;
                let work = 0;
                for (const harvester of harvesters) {
                    if (harvester.memory.targetSourceId !== source.id) continue;
                    work += typeof harvester.getActiveBodyparts === 'function'
                        ? harvester.getActiveBodyparts(WORK)
                        : 0;
                }
                income += Math.min(perSourceCap, work * 2);
            }
        }
        const creepNum = (room as any).getCreepNum?.() || {};
        income += Math.min(20, (creepNum['out-harvest'] || 0) * 5);
        return income;
    });
};

// 升级吞吐上限：RCL8 固定 15；有控制器缓冲 90；无缓冲（需往返主仓）30
export const getUpgradeWorkCapacity = (room: Room): number => {
    const controller = room.controller;
    if (!controller?.my) return 0;
    if (room.level >= 8) return getRcl8MaxWork();
    return hasControllerEnergyBuffer(room) ? BUFFERED_WORK_CAP : NO_BUFFER_WORK_CAP;
};

/**
 * 升级侧的目标 WORK 总数：
 * - 收入跟踪项：energyLevel<90 等比收缩；90~120 吃满收入；>120 收入+盈余；
 * - 盈余消耗项：仓储超出标准线后，每 1500 盈余折 1 个常驻升级 work
 *   （terminal 房 energyLevel-90），两项取大；
 * - 让位闸门（defend / 降级兜底 / 低能量基建期 / 冲级编队 / spawn 饥饿）返回 0。
 */
export const getUpgradeWorkTarget = (room: Room): number => {
    const controller = room.controller;
    if (!controller?.my) return 0;

    // —— 让位闸门 ——
    if ((room.memory as any).defend) return 0;
    if (getDowngradeUniversalTarget(room) > 0) return 0;
    if (shouldDelayUpgraderForPrimaryBuild(room)) return 0;
    if (getRushUpgraderCount(room) > 0) return 0;

    const capacity = getUpgradeWorkCapacity(room);
    if (capacity <= 0) return 0;

    const lv = room.level;
    const ttd = controller.ticksToDowngrade || 0;
    const upgradeNeeded = ttd < UPGRADE_NEEDED_TTD;
    // spawn/塔都喂不饱且无降级风险时，升级是奢侈品，让位
    if (getRoomEnergyState(room) === 'CRITICAL' && ttd > UPGRADE_NEEDED_TTD) return 0;

    const energyLevel = getEnergyLevel(room);
    const income = estimateRoomEnergyIncome(room);

    // RCL1：给固定小队起步
    if (lv < 2) return clamp(5, upgradeNeeded ? 5 : 0, capacity);

    // RCL8：满级房只在确有富余或降级风险时维持 15 work 满吞吐
    if (lv >= 8) {
        return upgradeNeeded || energyLevel >= LEVEL_RCL8_ACTIVE
            ? Math.min(capacity, getRcl8MaxWork())
            : 0;
    }

    const lowerLimit = upgradeNeeded ? 5 : 0;

    // —— 收入跟踪项（rush/high 模式上浮系数）——
    const mode = getRoomMode(room);
    const incomeMultiplier = mode === 'rush' ? 1.5 : mode === 'high' ? 1.2 : 1;
    const scaledIncome = income * incomeMultiplier;
    let incomeWork: number;
    if (!room.storage && !room.terminal) {
        // 无仓期（RCL<4 常态）：周转能量在 container 里，energyLevel 看不见，
        // 无仓期全额跟收入，不做等比收缩。
        incomeWork = Math.ceil(scaledIncome);
    } else if (energyLevel < LEVEL_THROTTLE) {
        incomeWork = Math.ceil((scaledIncome * Math.max(energyLevel, 20)) / 100);
    } else if (energyLevel > LEVEL_MORE_UPGRADERS) {
        incomeWork = Math.ceil(scaledIncome + (energyLevel - 90));
    } else {
        incomeWork = Math.ceil(scaledIncome);
    }

    // —— 盈余消耗项 ——
    const surplusWork = Math.max(0, energyLevel - 90);

    return Math.max(lowerLimit, Math.min(capacity, Math.max(incomeWork, surplusWork)));
};

// ==================== worker 体型折算 ====================

// 根据指定角色当前体型估算其 work 能力（每 tick 每房间缓存）
export const getGeneratedRoleWorkPartCount = (room: Room, role: string): number => {
    return getRoomTickCacheValue(room, `workforce_${role}_work_parts`, () => {
        if (typeof (room as any).GetRoleBodys !== 'function' ||
            typeof (room as any).GenerateBodys !== 'function') {
            return 1;
        }
        const bodyConfig = (room as any).GetRoleBodys(role);
        const body = (room as any).GenerateBodys(bodyConfig, role) as BodyPartConstant[];
        let work = 0;
        for (const part of body || []) {
            if (part === WORK) work++;
        }
        return Math.max(1, work);
    });
};

const getWorkerWorkPartCount = (room: Room) => getGeneratedRoleWorkPartCount(room, 'worker');

// builder 目标数的参考 work 基线
const WORKER_BUILD_REFERENCE_WORK = 3;

const scaleWorkerConstructionTarget = (room: Room, baseTarget: number, maxTarget: number) => {
    const workPerWorker = getWorkerWorkPartCount(room);
    const scaledTarget = Math.ceil(baseTarget * WORKER_BUILD_REFERENCE_WORK / workPerWorker);
    return Math.max(baseTarget, Math.min(maxTarget, scaledTarget));
};

// ==================== 控制器工位 ====================

// 控制器升级工位表：range 3 内可站立点位，按到锚点（controller link 优先，否则控制器）的距离排序。
// 升级职责 worker 按「名册序 → 工位序」一一对应领取专属工位，
// 配合 moveWork 的 range 0 候选格，让堵车解算器把每个 creep 保护在自己的格子里，杜绝挤占抢位。
export const getControllerUpgradeSlotList = (room: Room): RoomPosition[] => {
    return getRoomTickCacheValue(room, 'controller_upgrade_slot_list', () => {
        const controller = room.controller;
        if (!controller) return [];
        if (typeof room.getTerrain !== 'function' || typeof room.lookForAt !== 'function') return [];

        const link = (room.link || []).find(l => l.pos.inRangeTo(controller.pos, 2));
        const anchor = link ? link.pos : controller.pos;
        const terrain = room.getTerrain();
        const slots: RoomPosition[] = [];

        for (let x = Math.max(0, controller.pos.x - 3); x <= Math.min(49, controller.pos.x + 3); x++) {
            for (let y = Math.max(0, controller.pos.y - 3); y <= Math.min(49, controller.pos.y + 3); y++) {
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
                slots.push(pos);
            }
        }

        slots.sort((a, b) =>
            a.getRangeTo(anchor) - b.getRangeTo(anchor) ||
            a.getRangeTo(controller) - b.getRangeTo(controller) ||
            a.x - b.x ||
            a.y - b.y
        );
        return slots;
    });
};

// 估算 controller 周围可站位，作为 upgrader 数量上限
export const getControllerUpgradeSlotCap = (room: Room) => {
    return getRoomTickCacheValue(room, 'controller_upgrade_slots', () => getControllerUpgradeSlotList(room).length);
};

/**
 * 查询某个 worker 家族 creep 的专属升级工位。
 * 名册（worker/upgrader，按名字排序）第 i 位对应工位表第 i 项（超出取模），
 * 同 tick 内结果稳定且互不重复（工位充足时）。
 */
export const getWorkerUpgradeSlot = (room: Room, creepName: string): RoomPosition | null => {
    if (typeof room.find !== 'function') return null;
    const assignment = getRoomTickCacheValue(room, 'worker_upgrade_slot_map', () => {
        const map = new Map<string, RoomPosition>();
        const slots = getControllerUpgradeSlotList(room);
        if (!slots.length) return map;

        const family = new Set<string>(WORKER_FAMILY_ROLES);
        const roster = getRoomTickCacheValue(room, 'worker_family_roster', () =>
            ((room.find(FIND_MY_CREEPS, {
                filter: (c: Creep) => !!(c && c.memory && family.has(c.memory.role || '')),
            }) as Creep[]).slice())
                .sort((a, b) => a.name.localeCompare(b.name))
        );
        roster.forEach((creep, index) => {
            const slot = slots[index % slots.length];
            if (slot) map.set(creep.name, slot);
        });
        return map;
    });
    return assignment.get(creepName) || null;
};

// ==================== worker 三侧定编 ====================

// worker 的建造侧目标数量（0 表示当前不需要为建造定编）
export const getWorkerBuildTarget = (room: Room): number => {
    const state = getRoomEnergyState(room);
    const cap = room.energyCapacityAvailable || 0;
    const totalEnergy = getTotalEnergy(room);
    const mode = getRoomMode(room);
    const highMode = isHighLikeMode(mode);
    const earlyRush = mode === 'rush';
    // worker 允许孵化的最低能量（= WORK + CARRY + MOVE*2 的部件成本）
    const workerSpawnEnergyMin = Math.max(THRESHOLDS.SPAWN.MIN_ENERGY, 250);

    const hasBuildMission = room.checkMissionInPool?.('build');
    const siteCount = getMyConstructionSites(room).length;
    const coreSiteCount = getCoreConstructionSiteCount(room);
    const needBuilder = hasBuildMission || siteCount > 0;
    if (!needBuilder) return 0;

    // 能量不足以孵化 worker 时，建造侧不产生需求
    const canAffordWorker = room.energyAvailable >= workerSpawnEnergyMin || totalEnergy >= cap;
    if (!canAffordWorker) return 0;

    const minWorkerTarget = scaleWorkerConstructionTarget(room, 1, room.level <= 2 ? 3 : 2);
    let target = minWorkerTarget;

    if (earlyRush) {
        let rushTarget = 5;
        if (state === 'CRITICAL') rushTarget = 1;
        if (state === 'LOW') rushTarget = Math.min(rushTarget, room.level <= 2 ? 2 : 3);
        rushTarget = scaleWorkerConstructionTarget(room, rushTarget, room.level <= 2 ? 6 : 5);
        target = Math.max(target, rushTarget);
    }

    if (highMode) {
        let highTarget = room.level <= 2 ? 2 : 3;
        if (siteCount >= 6 || coreSiteCount >= 2) highTarget += 1;
        if (siteCount >= 12 || coreSiteCount >= 5) highTarget += 1;
        highTarget = Math.min(highTarget, room.level <= 2 ? 3 : 4);
        if (state === 'CRITICAL') highTarget = 1;
        if (state === 'LOW') highTarget = Math.min(highTarget, room.level <= 2 ? 2 : 3);
        highTarget = scaleWorkerConstructionTarget(room, highTarget, room.level <= 2 ? 5 : 4);
        target = Math.max(target, highTarget);
    }

    const normalBuildTarget = scaleWorkerConstructionTarget(room, 2, room.level <= 2 ? 4 : 3);
    if ((state === 'SURPLUS' || state === 'NORMAL') && siteCount >= 6) {
        target = Math.max(target, normalBuildTarget);
    }
    const surplusBuildTarget = scaleWorkerConstructionTarget(room, 3, room.level <= 2 ? 5 : 4);
    if (state === 'SURPLUS' && siteCount >= 16) {
        target = Math.max(target, surplusBuildTarget);
    }
    if (state === 'LOW') {
        const lowBuildTarget = Math.min(minWorkerTarget, room.level <= 2 ? 2 : 1);
        if (totalEnergy >= Math.max(THRESHOLDS.SPAWN.BODY_REDUCTION_THRESHOLD, cap * 2)) {
            target = Math.max(target, lowBuildTarget);
        }
    }

    return target;
};

// 维修相关：wallTask.hits 是目标血量，不是结构当前血量。
const isUrgentWallTask = (room: Room, wallTask: RepairTask) => {
    const [x, y] = decompress(wallTask.pos);
    const structure = room.lookForAt(LOOK_STRUCTURES, x, y)
        .find((s): s is StructureWall | StructureRampart =>
            s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART
        );
    if (!structure) return false;

    const urgentHits = structure.structureType === STRUCTURE_RAMPART
        ? THRESHOLDS.REPAIR.URGENT_RAMPART
        : THRESHOLDS.REPAIR.URGENT_WALL;
    return structure.hits <= urgentHits;
};

// 无建造需求时的刷墙保底（最多 1 个 worker）
export const getWorkerWallTarget = (room: Room): number => {
    const wallTask = room.getWallMission?.(null as any);
    if (!wallTask) return 0;

    const urgentWallTask = isUrgentWallTask(room, wallTask);
    const minRepairEnergy = urgentWallTask
        ? THRESHOLDS.ENERGY.WALL_MIN
        : THRESHOLDS.ENERGY.WALL_MIN * 2;
    if (((room as any)[RESOURCE_ENERGY] || 0) < minRepairEnergy) return 0;

    if (room.level < 8 || Game.flags[`${room.name}/REPAIR`] || urgentWallTask) {
        return 1;
    }
    if (!room.tower || room.tower.length === 0) {
        return (room.getMissionNumInPool?.('repair') || 0) >= 20 ? 1 : 0;
    }
    return 0;
};

/**
 * worker 的升级侧目标数量（0 表示当前不需要为升级定编）。
 * 定编依据 getUpgradeWorkTarget 的 WORK 总数折算到当前 worker 体型，
 * 再受控制器工位上限约束。
 */
export const getWorkerUpgradeTarget = (room: Room): number => {
    const workTarget = getUpgradeWorkTarget(room);
    if (workTarget <= 0) return 0;
    const slotCap = Math.max(1, getControllerUpgradeSlotCap(room));
    const workerWork = getWorkerWorkPartCount(room);
    return Math.min(slotCap, Math.ceil(workTarget / Math.max(1, workerWork)));
};

/**
 * 建造/刷墙配额：运行时 worker 职责切分使用。
 * 配额内的个体承担 build/repair/wall，配额外（且存在升级需求）的个体专职升级。
 */
export const getWorkerConstructionQuota = (room: Room): number => {
    const buildTarget = getWorkerBuildTarget(room);
    if (buildTarget > 0) return buildTarget;
    return getWorkerWallTarget(room);
};

/** 房间当前是否需要保留 worker 做升级吞吐（含让位闸门判定） */
export const hasWorkerUpgradeDemand = (room: Room): boolean => getUpgradeWorkTarget(room) > 0;

/** worker 家族角色（共享 worker 执行器的定编个体） */
export const WORKER_FAMILY_ROLES = ['worker', 'upgrader'] as const;
