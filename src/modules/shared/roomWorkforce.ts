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
import { getEnergyLevel } from '@/modules/shared/energyLevel';
import { getRoomModeProfile, getRoomMode, isHighLikeMode } from '@/modules/shared/roomMode';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { decompress } from '@/modules/shared/compress';
import { buildRushCarrierBody } from '@/modules/shared/rushBody';
import { getRoomData, getOutMineData } from '@/modules/shared/memory';
import { ROLES } from '@/constant/CreepConstant';
import { THRESHOLDS } from '@/constant/Thresholds';

/**
 * 填充请求提供方（解耦倒置）：定编侧只关心「房间有无待填能量请求」，
 * 具体实现由组合根 init 注入（能量中枢的请求收集），消除 shared→功能层反向依赖。
 */
export type FillRequestProvider = (room: Room) => unknown[];

let fillRequestProvider: FillRequestProvider | null = null;

/** 组合根 init 时注入填充请求实现；须先于首次定编调用 */
export const registerFillRequestProvider = (provider: FillRequestProvider): void => {
    fillRequestProvider = provider;
};

/** 房间当前填充请求；未注入（启动极早期/测试环境）时返回空数组 */
export const getRegisteredFillRequests = (room: Room): unknown[] =>
    fillRequestProvider ? fillRequestProvider(room) : [];

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

// ==================== link 供能几何吞吐封顶 ====================
//
// 升级编制不只看「需求」（收入/盈余），还要看「供能几何」：controller link 的补给速率存在
// 硬上限——link 一个 cooldown（15t）才能发一次车、路上有 3% 损耗、manager 从 storage 搬运
// 补链也有往返距离。超出几何上限刷出来的编制只会集体饿肚子（喂不饱的空转人口）。
//
// 公式（work 单位 = 每 tick 能量口径）：
//   throughput = LINK_CAPACITY×(1−0.03) / ((max(4, dist)+2)×LINK_COOLDOWN)   —— link 泵送基线
//              + 0.2×manager载量/(2×dist) + (RCL7 ? 8 : 0)                    —— manager 搬运回补
// 其中 dist 是 storage→controller link 的切比雪夫距离（设计期量纲，不寻路）；
// 「距离下限 4 + 搬运修正 2」防近距布局吞吐虚高。
//
// ⚠️ 只收紧 getUpgradeWorkCapacity 的上限，不改收入驱动项——定编曲线方向不变，
// 只是几何喂不饱时不再全额放量。若实测低 RCL 误伤，回滚本 helper 即可（单项可回退）。
const LINK_LOSS_RATIO = 0.03;
const LINK_THROUGHPUT_MIN_DIST = 4;
const LINK_HAUL_DISTANCE_CORRECTION = 2;
/** manager 时间占比折算（manager 约 20% 的时间在喂 link 链） */
const LINK_MANAGER_TIME_SHARE = 0.2;
/** RCL7 直加项（双 spawn 期 spawn 填充链额外产能） */
const LINK_RCL7_BONUS = 8;
/** manager 载量探测失败时的兜底值（≈基础 manager 配置 4×CARRY 的两倍，宁保守不冒进） */
const LINK_MANAGER_CARRY_FALLBACK = 400;
/** 几何封顶的吞吐下限：极端远距也保底这点升级吞吐（≈1 只小体型升级工），配合降级保底兜底 */
const LINK_THROUGHPUT_WORK_FLOOR = 4;

// 估算 manager 体型载量（与 getGeneratedRoleWorkPartCount 同款探测式，桩环境返回兜底值）
const getManagerCarryCapacity = (room: Room): number => {
    if (typeof (room as any).GetRoleBodys !== 'function' ||
        typeof (room as any).GenerateBodys !== 'function') {
        return LINK_MANAGER_CARRY_FALLBACK;
    }
    const bodyConfig = (room as any).GetRoleBodys(ROLES.manager);
    const body = (room as any).GenerateBodys(bodyConfig, ROLES.manager) as BodyPartConstant[];
    let carry = 0;
    for (const part of body || []) {
        if (part === CARRY) carry += 50;
    }
    return carry > 0 ? carry : LINK_MANAGER_CARRY_FALLBACK;
};

export const getLinkThroughputWorkCap = (room: Room): number => {
    const controller = room.controller!;
    // 没有 controller link 就没有这条几何约束（container 供能分支维持原 30/90 常量）
    const link = (room.link || []).find(l => l.pos.inRangeTo(controller.pos, 2));
    if (!link) return Infinity;

    const storage = room.storage;
    const dist = storage
        ? Math.max(LINK_THROUGHPUT_MIN_DIST, storage.pos.getRangeTo(link.pos))
        : LINK_THROUGHPUT_MIN_DIST;

    const linkCapacity = typeof LINK_CAPACITY === 'number' ? LINK_CAPACITY : 800;
    const linkCooldown = typeof LINK_COOLDOWN === 'number' ? LINK_COOLDOWN : 15;
    const pumpThroughput = linkCapacity * (1 - LINK_LOSS_RATIO) /
        ((dist + LINK_HAUL_DISTANCE_CORRECTION) * linkCooldown);
    const managerThroughput = LINK_MANAGER_TIME_SHARE * getManagerCarryCapacity(room) / (2 * dist);
    const rclBonus = room.level === 7 ? LINK_RCL7_BONUS : 0;

    return clamp(
        Math.floor(pumpThroughput + managerThroughput + rclBonus),
        LINK_THROUGHPUT_WORK_FLOOR,
        BUFFERED_WORK_CAP
    );
};

// ==================== upgrader starved 负反馈环 ====================
//
// 取能落空 = 供能断流的直接信号：
// 计数 → 缩升级编制，避免「空转升级工继续抢 spawn 队列与地面能量」的二次伤害；
// 供能恢复后计数自动衰减，编制随之回扩——形成闭合负反馈。
//
// 防线语义（保守化取值）：
// - 控制器缓冲（link/container）还有能量就不算饿——可能只是还没走到；
// - ttd 已进降级风险区（< UPGRADE_NEEDED_TTD）不缩编——此时升级是保命项，降级保底优先；
// - RCL≥8 不计数：满级房是固定小编制 + link 常供，缩编无意义。
const STARVED_MAX = 200;
/** starved 超过该值追加第二轮缩编 */
const STARVED_SECOND_STAGE = 100;

// 控制器缓冲（link/container）是否彻底断流——starved 记账的前提
export const isControllerBufferEmpty = (room: Room): boolean => {
    const controller = room.controller;
    if (!controller) return true;
    const link = (room.link || []).find(l => l.pos.inRangeTo(controller.pos, 2));
    if (link && (link.store[RESOURCE_ENERGY] || 0) > 0) return false;
    const container = (room.container || []).find(c => c.pos.inRangeTo(controller.pos, 3));
    if (container && (container.store[RESOURCE_ENERGY] || 0) > 0) return false;
    return true;
};

// 惰性衰减：按流逝 tick 数补扣（每 tick −1），不依赖固定调用频率
const decayUpgradersStarved = (room: Room): number => {
    const mem = room.memory as any;
    if (typeof mem.upgradersStarved !== 'number') mem.upgradersStarved = 0;
    const last = mem.upgradersStarvedTick;
    if (mem.upgradersStarved > 0 && typeof last === 'number' && Game.time > last) {
        mem.upgradersStarved = Math.max(0, mem.upgradersStarved - (Game.time - last));
    }
    mem.upgradersStarvedTick = Game.time;
    return mem.upgradersStarved;
};

export const getUpgradersStarved = (room: Room): number => decayUpgradersStarved(room);

/**
 * 升级取能失败记账（由 upgrader 行为层在「取能落空」时调用，见 action/economy/upgrader.ts）。
 */
export const registerUpgraderStarve = (room: Room): void => {
    const controller = room.controller;
    if (!controller?.my) return;
    if (room.level >= 8) return;
    if ((controller.ticksToDowngrade || 0) < UPGRADE_NEEDED_TTD) return;
    if (!isControllerBufferEmpty(room)) return;
    const starved = decayUpgradersStarved(room);
    (room.memory as any).upgradersStarved =
        Math.min(STARVED_MAX, Math.max(1, starved + Math.floor(room.level / 2)));
};

// 缩编：starved>0 缩一轮、>100 再缩一轮，
// 每轮 round(×0.75)−1；下限为 1 只升级工的产能（不归零，降级保底另有闸门）
const shrinkByStarved = (room: Room, demandWork: number): number => {
    const starved = getUpgradersStarved(room);
    if (starved <= 0) return demandWork;
    const floorWork = Math.max(1, getGeneratedRoleWorkPartCount(room, ROLES.upgrader));
    let shrunk = demandWork;
    if (starved > 0) shrunk = Math.round(shrunk * 0.75) - 1;
    if (starved > STARVED_SECOND_STAGE) shrunk = Math.round(shrunk * 0.75) - 1;
    return Math.max(Math.min(floorWork, demandWork), shrunk);
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// ==================== 通用房间状态 ====================

export const getRoomEnergyState = (room: Room): string =>
    (room.memory as any).energyState || (room as any).updateEnergyState?.(false) || 'NORMAL';

export { getRoomMode, isHighLikeMode } from '@/modules/shared/roomMode';

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
// rush 开局恒 0：rush 的停摆兜底 = 看门狗重开 attempt，UNIV 永不参与开局起步
export const getDowngradeUniversalTarget = (room: Room) => {
    if (getRoomMode(room) === 'rush') return 0;
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


// ==================== 冲级工位 ====================

/**
 * 冲级工位：**同时**满足「与控制器旁的 storage 或 terminal 相邻」和「位于控制器 3 格以内」的
 * 可站立格位。
 *
 * @remarks
 * 冲级工的取能路径是控制器缓冲（见 `withdrawControllerEnergy`）：link > container > terminal > storage。
 * 其中只有 terminal / storage 是**大容量且可持续**的来源，所以「能不能冲级」取决于布局——
 * 仓库必须挨着控制器，而且**旁边要站得下人**：格位要同时贴着仓库、又在控制器 3 格圈内，
 * 冲级工才能一边取能一边升级，不必来回跑。
 *
 * 因此这个数量是**自动判定**出来的：没有这样的格位就说明布局不支持冲级，
 * 编制侧会回退成普通升级工（见 {@link getUpgraderTarget}）。
 */
export const getRushUpgradeSlotList = (room: Room): RoomPosition[] => {
    return getRoomTickCacheValue(room, 'rush_upgrade_slot_list', () => {
        const controller = room.controller;
        if (!controller) return [];
        if (typeof room.getTerrain !== 'function' || typeof room.lookForAt !== 'function') return [];

        // 前提：仓库本身要位于控制器旁边（3 格内）
        const stores = ([room.storage, room.terminal] as (StructureStorage | StructureTerminal | undefined)[])
            .filter((s): s is StructureStorage | StructureTerminal => !!s && s.pos.inRangeTo(controller.pos, 3));
        if (stores.length === 0) return [];

        const terrain = room.getTerrain();
        const seen = new Set<string>();
        const slots: RoomPosition[] = [];

        for (const store of stores) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue; // 仓库自己那格站不了人
                    const x = store.pos.x + dx;
                    const y = store.pos.y + dy;
                    if (x < 0 || x > 49 || y < 0 || y > 49) continue;

                    const pos = new RoomPosition(x, y, room.name);
                    if (pos.getRangeTo(controller) > 3) continue;

                    const key = `${x},${y}`;
                    if (seen.has(key)) continue;
                    if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                    const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
                    const blocked = structures.some((s: any) =>
                        s.structureType !== STRUCTURE_ROAD &&
                        s.structureType !== STRUCTURE_CONTAINER &&
                        !(s.structureType === STRUCTURE_RAMPART && s.my)
                    );
                    if (blocked) continue;

                    seen.add(key);
                    slots.push(pos);
                }
            }
        }
        return slots;
    });
};

export const getRushUpgradeSlotCap = (room: Room): number =>
    getRoomTickCacheValue(room, 'rush_upgrade_slot_cap', () => getRushUpgradeSlotList(room).length);

/** 房间布局是否支持冲级（控制器旁有 storage/terminal，且它们旁边有可站格位） */
export const canRushUpgrade = (room: Room): boolean =>
    getRushUpgradeSlotCap(room) > 0 || hasControllerEnergyBuffer(room);

// ==================== 升级吞吐 ====================

const getSourceEnergyPerTick = () =>
    ((typeof SOURCE_ENERGY_CAPACITY === 'number' ? SOURCE_ENERGY_CAPACITY : 3000) /
        (typeof ENERGY_REGEN_TIME === 'number' ? ENERGY_REGEN_TIME : 300));

/**
 * 估算房间每 tick 的能量收入（升级侧要吃掉的流入量）：
 * - 本矿：按绑定 harvester 的 WORK 产能折算，单矿封顶 10/tick（再生上限）；
 * - 外矿：优先用 externalMine 注册的富口径——「净收入 × min(采集比, 搬运比)」，
 *   瓶颈侧（采集断档/运力不足）决定真实到账；未注册（单测最小桩环境）时
 *   退化为按在册采集工人数估算（每工 5/tick，封顶 20）。
 */

// ==================== 外矿收入提供器 ====================
// 富口径计算依赖 externalMine 的重依赖链（CreepConstant/调度器等），
// 本模块刻意保持零游戏依赖（单测最小桩环境可直接加载），
// 因此由 externalMine 侧在运行时注册计算函数，这里只持有引用。

export type RemoteIncomeProvider = (sourceRoom: Room) => number | null;
let remoteIncomeProvider: RemoteIncomeProvider | null = null;

/** 注册外矿收入富口径计算器（由 externalMine 的运行时入口调用一次）。 */
export const registerRemoteIncomeProvider = (provider: RemoteIncomeProvider): void => {
    remoteIncomeProvider = provider;
};

export const estimateRoomEnergyIncome = (room: Room): number => {
    return getRoomTickCacheValue(room, 'workforce_income_estimate', () => {
        let income = 0;
        const sources = (room as any).source as Source[] | undefined;
        if (sources && sources.length && typeof room.find === 'function') {
            const harvesters = room.find(FIND_MY_CREEPS, {
                filter: (c: Creep) => !!(c && c.memory && c.memory.role === ROLES.harvester && c.memory.targetSourceId),
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
        const remoteIncome = remoteIncomeProvider?.(room);
        if (typeof remoteIncome === 'number') {
            income += Math.max(0, remoteIncome);
        } else {
            const creepNum = (room as any).getCreepNum?.() || {};
            income += Math.min(20, (creepNum[ROLES['out-harvest']] || 0) * 5);
        }
        return income;
    });
};

// 地面堆积能量：采集速度超过「搬运 + 消耗」速度的直接信号。
// 仓储口径的 energyLevel 看不见地上能量，必须单独计量。
export const getDroppedPileEnergy = (room: Room): number => {
    return getRoomTickCacheValue(room, 'workforce_dropped_pile', () => {
        if (typeof room.find !== 'function') return 0;
        const dropped = room.find(FIND_DROPPED_RESOURCES) as Resource[] | undefined;
        if (!dropped) return 0;
        let total = 0;
        for (const res of dropped) {
            if (res && res.resourceType === RESOURCE_ENERGY && res.amount >= 100) total += res.amount;
        }
        return total;
    });
};

// 地面堆积超过该阈值时，worker 总人口允许临时突破硬上限加班消化（堆积清空后自动回落）
export const getDroppedPileWorkerBoost = (room: Room): number =>
    getDroppedPileEnergy(room) > 1500 ? 2 : 0;

// 外矿房（energy + centerRoom 列表内、有视野的）掉落能量堆积计量（tick 缓存）
export const getRemotePileEnergy = (sourceRoom: Room): number => {
    return getRoomTickCacheValue(sourceRoom, 'remote_dropped_pile', () => {
        if (typeof getOutMineData !== 'function') return 0;
        const data = getOutMineData(sourceRoom.name) as Record<string, string[]> | undefined;
        if (!data) return 0;
        let total = 0;
        for (const bucket of ['energy', 'centerRoom'] as const) {
            for (const roomName of data[bucket] || []) {
                const room = Game.rooms[roomName];
                if (!room || typeof room.find !== 'function') continue;
                for (const res of room.find(FIND_DROPPED_RESOURCES) as Resource[]) {
                    if (res && res.resourceType === RESOURCE_ENERGY && res.amount >= 100) total += res.amount;
                }
            }
        }
        return total;
    });
};

// 升级吞吐上限：RCL8 固定 15；有控制器缓冲 90，且叠加「link 供能几何」封顶
// （只认 controller link 供能分支；container-only / 无 link 分支维持原常量不变）
export const getUpgradeWorkCapacity = (room: Room): number => {
    const controller = room.controller;
    if (!controller?.my) return 0;
    if (room.level >= 8) return getRcl8MaxWork();
    if (!hasControllerEnergyBuffer(room)) return NO_BUFFER_WORK_CAP;
    return Math.min(BUFFERED_WORK_CAP, getLinkThroughputWorkCap(room));
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

    // —— 建造优先标记（换班制开关）：基建工地存在 = building 态。
    // building 态下 worker 全额转建造（升级侧归零，升级由固定升级岗承担）；
    // 工地清零后 worker 整体转回升级。upgrader 固定升级岗不参与换班
    const prioritySites = (room.find(FIND_MY_CONSTRUCTION_SITES) || []).filter((s: ConstructionSite) =>
        s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_TOWER ||
        s.structureType === STRUCTURE_CONTAINER,
    );
    (room.memory as any).building = prioritySites.length > 0
        && (controller.ticksToDowngrade || 0) >= UPGRADE_NEEDED_TTD;

    // —— 让位闸门 ——
    if ((room.memory as any).defend) return 0;
    if (getDowngradeUniversalTarget(room) > 0) return 0;
    // 低能量基建期推迟升级仅限常规房：rush 的 upgrader 固定升级，开局不参与让位
    if (shouldDelayUpgraderForPrimaryBuild(room) && !isHighLikeMode(getRoomMode(room))) return 0;
    

    const capacity = getUpgradeWorkCapacity(room);
    if (capacity <= 0) return 0;

    const lv = room.level;
    const ttd = controller.ticksToDowngrade || 0;
    const upgradeNeeded = ttd < UPGRADE_NEEDED_TTD;
    // spawn/塔都喂不饱且无降级风险时，升级是奢侈品，让位。
    // rush/high 不让位：饥荒应对走孵化优先级插队，编队归零会造成恢复真空
    //（CRITICAL→归零→升级工死光→能量恢复后无工可恢复，段速崩塌）
    if (getRoomEnergyState(room) === 'CRITICAL' && ttd > UPGRADE_NEEDED_TTD && !isHighLikeMode(getRoomMode(room))) return 0;

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

    // —— 收入跟踪项（rush/high 模式上浮系数，倍率由模式参数表统一定义）——
    const scaledIncome = income * getRoomModeProfile(room).upgradeIncomeMultiplier;
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

    // —— 地面堆积项：每 2000 点掉落能量折算 1 个升级 work，直接消化地上存货 ——
    const pileWork = Math.ceil(getDroppedPileEnergy(room) / 2000);

    // —— rush 冲级：火力 = clamp(净收入 × 乘数, 5W 底火, 容量)，乘数随 spawnBalance EMA 浮动
    //    （参考实现原版口径：+1 物流闲置——无取货请求且有载货搬运 → 1.2 加码；
    //    −1 升级工取能落空（starved） → 1.0 让孵化；EMA 50t 时间常数自然回摆）。
    //    不做 cc 单点水位节流：cc 干涸时收缩升级工是反向反馈（升级工变少 →
    //    抽水更少 → cc 更空的死锁）；cc 供能不足由专线配额与手填闭环解决。
    if (getRoomMode(room) === 'rush') {
        const pileAll = getDroppedPileEnergy(room) + getRemotePileEnergy(room);
        let loadedCarrier = false;
        for (const creep of Object.values(Game.creeps)) {
            if (creep.room.name !== room.name || creep.spawning) continue;
            if (creep.memory?.role !== ROLES.carrier) continue;
            if ((creep.store[RESOURCE_ENERGY] || 0) > 0) { loadedCarrier = true; break; }
        }
        // 信号优先级：饥饿压过富余——升级工取能落空时即便搬运有货也先减码
        //（供能在途但取不到，继续加码只会堆更多饿肚子的升级工）
        const target = getUpgradersStarved(room) > 0
            ? -1
            : (getRegisteredFillRequests(room).length === 0 && loadedCarrier ? 1 : 0);
        const memAny = room.memory as any;
        const alpha = 1 - Math.pow(2, -1 / 50);
        memAny.spawnBalanceEma = clamp((memAny.spawnBalanceEma ?? 0) * (1 - alpha) + target * alpha, -1, 1);
        const multiplier = Math.min(1.2, Math.max(1, memAny.spawnBalanceEma / 2 + 0.8));
        // rush 冲级：用参考口径的净收入（扣除 miner/hauler 折旧与容器损耗）
        // 替代毛收入估算，避免过度孵化升级工导致「火力虚高但实际产出低」
        const netIncome = getRoomNetIncome(room);
        const rushWork = Math.ceil((netIncome + pileAll / 2000) * multiplier);

        const rushCapacity = Math.max(capacity, getControllerUpgradeSlotCap(room));
        return Math.max(Math.max(lowerLimit, 5), Math.min(rushCapacity, Math.max(rushWork, surplusWork)));
    }
    // —— starved 负反馈：供能断流时缩需求，恢复后自动回扩。
    //    rush/high 不缩：孵化优先级已护住 spawn，缩编只会拉长饥荒（饿→缩→更饿）——
    const demand = Math.max(incomeWork, surplusWork, pileWork);
    return Math.max(lowerLimit, Math.min(capacity, isHighLikeMode(getRoomMode(room)) ? demand : shrinkByStarved(room, demand)));
};

// ==================== rush 搬运编制 ====================

/**
 * rush 期搬运工编制目标（运力公式）：
 * 运力需求（CARRY 部件）= Σ(单矿净产速率 × 往返路程 × 2) / 50，
 * 路程用换班实测的 `sourceTiming.pathTime`（spawn→source 路长近似 source→交付点），
 * 除以当前容量下 rush carrier 体型的人均 CARRY 数得只数。
 * 路程未实测的 source 不参与（此时回退固定定编表，避免开局瞎猜）。
 */
export const getRushCarrierTarget = (room: Room): number => {
    const timing = (room.memory as any).sourceTiming;
    if (!timing) return 0;
    const body = buildRushCarrierBody(room.energyCapacityAvailable || 0);
    const carryPerCarrier = body ? Number(body[0][1]) : 0;
    if (carryPerCarrier <= 0) return 0;
    const perSourceCap = getSourceEnergyPerTick();
    const harvesters = typeof room.find === 'function'
        ? room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) => !!(c && c.memory && c.memory.role === ROLES.harvester && c.memory.targetSourceId),
        }) as Creep[]
        : [];
    let carryParts = 0;
    for (const source of ((room as any).source as Source[] | undefined) || []) {
        const pathTime = timing[source.id]?.pathTime;
        if (typeof pathTime !== 'number' || pathTime <= 0) continue;
        let work = 0;
        for (const harvester of harvesters) {
            if (harvester.memory.targetSourceId !== source.id) continue;
            work += typeof harvester.getActiveBodyparts === 'function'
                ? harvester.getActiveBodyparts(WORK)
                : 0;
        }
        const rate = Math.min(perSourceCap, work * 2);
        if (rate <= 0) continue;
        carryParts += (rate * 2 * pathTime) / 50;
    }
    if (carryParts <= 0) return 0;
    return Math.ceil(carryParts / carryPerCarrier);
};

// ==================== 升级孵化加急（富余能量快速消化） ====================
//
// 升级吞吐目标按收入给了编制，但孵化端若一直排在队列尾（外矿搬运工体型大、
// 孵化久），升级工补员会滞后于能量流入——水位越堆越高。加急成立时升级任务
// 插到外矿流水线之前，让能量尽快转化为升级吞吐：
// - 有稳定物流（storage/terminal）：能量水位 > workerFirst（110 = 标准线 + 15k 盈余）；
// - 无仓期：实际收入 > 在役升级功率（钱比花得快，立即加码消耗端）。
// level 链：加急层(10) 优先于 外矿流水线(12)、低于 worker(8)——
// 建造仍优先于加急升级，与「BUILD > UPGRADE_PRIORITY > REMOTE_SOURCE > UPGRADE」对齐。
// 升级孵化加急（富余能量快速消化）。
// level 7：必须压过外矿管线（out-harvest 换班 5 除外——那是真实维护）才能兑现「加急」。
// 曾经设为 10，语义是压过旧外矿层（12/13）；外矿管线提到 6/9 后，10 反而垫底，
// 升级任务被 L5/L9 维护单永久堵死（race 实测：容器满 1 万、地上 2.3 万腐烂、uWork=0）。
export const UPGRADE_URGENT_SPAWN_LEVEL = 7;
const LEVEL_WORKER_FIRST = 110;

/**
 * 当前在役升级功率（WORK 总和）。
 * TTL 已覆盖不住自身孵化期的垂死个体不计（它撑不满一个孵化周期）；
 * 非 rush 模式下 worker 可切升级职责，其 WORK 一并计入消耗侧。
 */
export const getActiveUpgradeWorkCount = (room: Room): number => {
    if (typeof room.find !== 'function') return 0;
    const family = getRoomMode(room) === 'rush'
        ? [ROLES.upgrader]
        : [ROLES.upgrader, ROLES.worker];
    const familySet = new Set<string>(family);
    const creeps = room.find(FIND_MY_CREEPS, {
        filter: (c: Creep) => !!(c && c.memory && familySet.has(c.memory.role || '')),
    }) as Creep[];
    let work = 0;
    for (const creep of creeps) {
        if (creep.spawning) continue;
        const ttl = creep.ticksToLive ?? 1500;
        const spawnTicks = creep.body ? creep.body.length * 3 : 3;
        if (ttl <= spawnTicks) continue;
        work += typeof creep.getActiveBodyparts === 'function' ? creep.getActiveBodyparts(WORK) : 0;
    }
    return work;
};

/** 升级孵化是否加急：先确认确有升级需求（吞吐目标 > 0），再按两种口径判定。 */
export const isUpgraderSpawnUrgent = (room: Room): boolean => {
    if (getUpgradeWorkTarget(room) <= 0) return false;
    if (room.storage || room.terminal) {
        return getEnergyLevel(room) > LEVEL_WORKER_FIRST;
    }
    return estimateRoomEnergyIncome(room) > getActiveUpgradeWorkCount(room);
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

const getWorkerWorkPartCount = (room: Room) => getGeneratedRoleWorkPartCount(room, ROLES.worker);

// builder 目标数的参考 work 基线
const WORKER_BUILD_REFERENCE_WORK = 3;

const scaleWorkerConstructionTarget = (room: Room, baseTarget: number, maxTarget: number) => {
    const workPerWorker = getWorkerWorkPartCount(room);
    const scaledTarget = Math.ceil(baseTarget * WORKER_BUILD_REFERENCE_WORK / workPerWorker);
    return Math.max(baseTarget, Math.min(maxTarget, scaledTarget));
};

// ==================== worker 总人头上限 ====================

// work 部件预算是为「大体型升级工」设计的；低 RCL 的 worker 每只只有 1 WORK，
// 直接按 work÷perCreep 折算会孵出几十只。这里给总人口一个按 RCL 的硬上限：
// 数量受限后，work 预算的缺口表现为「同级 worker 优先升级」而非无限膨胀。
const WORKER_POP_CAP_BY_LEVEL: Record<number, number> = {
    1: 4,
    2: 4,
    3: 5,
    4: 6,
    5: 6,
    6: 7,
    7: 7,
    8: 6,
};

export const getWorkerPopulationCap = (room: Room): number =>
    WORKER_POP_CAP_BY_LEVEL[room.level] ?? 6;

// ==================== 升级工人头上限 ====================

// 与 WORKER_POP_CAP_BY_LEVEL 同源的坑：升级侧的预算是按 **work** 给的（30/90 work），
// 人口要靠 work ÷ 每只 WORK 部件数折算。低 RCL 能量容量撑不起大体型（容量 400 时
// GetRoleBodys 会一路退到 1 WORK 的体型），同一笔 work 预算就会折出几十只——
// 线上 RCL3 冲级房实测 38 只升级工，根因就是「40 work ÷ 1 work/只」。
// 这里按 RCL 给硬上限；高 RCL 的体型本身就大（例如 15 WORK），
// 折算结果 90÷15=6，正常落在上限之内，因此该上限只对低 RCL 生效，不会误伤正常编制。
//
// ⚠️ 取值权衡：`high`/`mini` 模式下超出上限的缺口会转由 worker 承接升级
// （见 `getWorkerUpgradeTarget`），上限不影响总升级吞吐；但 `rush` 模式里 worker 不兜底，
// **上限就是吞吐上限**。所以表不能压到最小：低 RCL 的体型太小（1 WORK），
// 按「income ÷ 每只 WORK」配会配出几十只并独占 spawn 队列（线上实测 38 只、房间停摆）；
// 压到 3~4 只又会让冲级明显变慢。取 5~6 是折中——既不吃穿收入，也不独占 spawn。
const UPGRADER_POP_CAP_BY_LEVEL: Record<number, number> = {
    1: 3,
    2: 6,
    3: 8,
    4: 8,
    5: 8,
    6: 8,
    7: 8,
    8: 6,
};

export const getUpgraderPopulationCap = (room: Room): number =>
    UPGRADER_POP_CAP_BY_LEVEL[room.level] ?? 6;

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

/**
 * 控制器容器相邻格（同时距控制器 ≤3）：静态升级工的**稳定取能站位**——
 * 站在这里 withdraw（容器相邻）与 upgradeController（控制器 ≤3）原地完成，
 * 零移动、零断供窗口。容器不存在时返回空。
 */
export const getControllerContainerSlotList = (room: Room): RoomPosition[] => {
    return getRoomTickCacheValue(room, 'controller_container_slot_list', () => {
        const controller = room.controller;
        const container = (room.container || []).find(
            c => controller && c.pos.inRangeTo(controller.pos, 3),
        );
        if (!container) return [];
        if (typeof room.getTerrain !== 'function' || typeof room.lookForAt !== 'function') return [];

        const terrain = room.getTerrain();
        const slots: RoomPosition[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = container.pos.x + dx;
                const y = container.pos.y + dy;
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
                const pos = new RoomPosition(x, y, room.name);
                if (pos.getRangeTo(controller) > 3) continue;
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
        return slots;
    });
};

// 估算 controller 周围可站位，作为 upgrader 数量上限
export const getControllerUpgradeSlotCap = (room: Room) => {
    return getRoomTickCacheValue(room, 'controller_upgrade_slots', () => getControllerUpgradeSlotList(room).length);
};

/**
 * 本次 tick 参与升级工位分配的格位池。
 *
 * @remarks
 * `rush` 且布局支持冲级时改用**冲级工位**（控制器旁仓库旁边那些格）——冲级工的取能点在那里，
 * 站在别处就变成往返跑。其余情况仍用控制器周围的通用升级工位。
 *
 * 开头的能力探测不只是防御：工位表全靠「地形 + 结构查询」算出来，
 * 桩环境 / 未初始化房间连这两个接口都没有，此时连模式都不必读（也就不会去碰 Memory）。
 */
const getUpgradeSlotPool = (room: Room): RoomPosition[] => {
    if (typeof room.getTerrain !== 'function' || typeof room.lookForAt !== 'function') return [];
    // 工位必须在控制器 upgrade 射程（3 格）内：cc 旁的格位可能落在射程外，
    // 站上去满仓也升不了级（满仓罚站、火力归零的死锁）
    const controller = room.controller;
    const inUpgradeRange = (pos: RoomPosition): boolean =>
        !controller || pos.inRangeTo(controller.pos, 3);
    // 工位不挡搬运道（对齐参考实现洪泛口径的等价过滤）：
    // 与 spawn 锚点的距离小于「锚点→cc 距离」的格位一律剔除——
    // cc 靠 spawn 一侧留给补给通道，升级工全部站在容器外侧
    const anchor = (room.spawn || [])[0]?.pos;
    const ccForLane = controller
        ? (room.container || []).find((c) => c.pos.inRangeTo(controller.pos, 3))
        : undefined;
    const notBlockingApproach = (pos: RoomPosition): boolean => {
        if (!anchor || !ccForLane) return true;
        return pos.getRangeTo(anchor) >= ccForLane.pos.getRangeTo(anchor);
    };
    const prune = (list: RoomPosition[]): RoomPosition[] => {
        const filtered = list.filter(inUpgradeRange).filter(notBlockingApproach);
        return filtered.length > 0 ? filtered : list.filter(inUpgradeRange);
    };

    if (getRoomMode(room) === 'rush' && canRushUpgrade(room)) {
        // 仓库冲级工位（storage/terminal 旁）为空时（RCL2-4 只有控制器容器的阶段）
        // 回退控制器容器相邻格——站这里 withdraw（容器相邻）与 upgrade（控制器 ≤3）
        // 原地完成，零移动；容器不存在再退控制器 3 格通用位
        const rushSlots = prune(getRushUpgradeSlotList(room));
        if (rushSlots.length > 0) return rushSlots;
        const ccSlots = prune(getControllerContainerSlotList(room));
        if (ccSlots.length > 0) return ccSlots;
    }
    return prune(getControllerUpgradeSlotList(room));
};

/**
 * 查询某个升级个体（worker / upgrader 共用名册）的专属升级工位。
 * 名册（按名字排序）第 i 位对应工位表第 i 项（超出取模），
 * 同 tick 内结果稳定且互不重复（工位充足时）。
 */
export const getWorkerUpgradeSlot = (room: Room, creepName: string): RoomPosition | null => {
    if (typeof room.find !== 'function') return null;
    const assignment = getRoomTickCacheValue(room, 'worker_upgrade_slot_map', () => {
        const map = new Map<string, RoomPosition>();
        const slots = getUpgradeSlotPool(room);
        if (!slots.length) return map;

        const family = new Set<string>(UPGRADE_SLOT_ROLES);
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

    // 能量不足以孵化 worker 时的让位闸——但「有工地等着建」时放行：
    // 预算体型路径（GetSpawnTaskData 对 worker+工地 用 energyAvailable 出小体型）
    // 就是为此设计的，闸死它会让房间陷入「没工地建不成基建 → 没基建能量上不去 →
    // 永远孵不出 worker」的自锁（race 实测：CRITICAL 时 250 门槛锁死 bootstrap，
    // 扩展装不上、控制器容器不存在、升级工全程跑腿）。
    const canAffordWorker = room.energyAvailable >= workerSpawnEnergyMin
        || totalEnergy >= cap
        || siteCount > 0;
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
 * `upgrader`（专人升级工）的编制。
 *
 * @remarks
 * 定编口径（只有 `high` / `mini` / `rush` 单独配人，其余交 worker 兼任）：
 *
 * | 模式 | 定编 |
 * |---|---|
 * | low / main / stop | 0（升级由 worker 兼任） |
 * | high / mini | `min(RCL 人口上限, ceil(升级 work ÷ 每只 WORK 部件), 控制器工位数)` |
 * | rush | 同上，但工位数取 `max(冲级工位, 控制器工位)`；RCL8 直接 0 |
 *
 * - **人口上限**（{@link getUpgraderPopulationCap}）是后加的硬闸：升级预算按 WORK 给，
 *   低 RCL 的 1-WORK 体型会把同一笔预算折成几十只，必须按 RCL 封顶。
 * - 工位判定由 {@link getRushUpgradeSlotCap} / {@link getControllerUpgradeSlotCap} 自动完成，
 *   布局不支持冲级时不会加倍，只是正常缩编。
 * - 折算口径与 worker 升级侧同源（都用 `getUpgradeWorkTarget`），只是换角色承接，
 *   避免两档之间口径漂移。
 */
export const getUpgraderTarget = (room: Room): number => {
    const controller = room.controller;
    if (!controller?.my) return 0;

    const mode = getRoomMode(room);

    const workTarget = getUpgradeWorkTarget(room);
    if (workTarget <= 0) return 0;

    const workPerUpgrader = Math.max(1, getGeneratedRoleWorkPartCount(room, ROLES.upgrader));
    // 人口上限：升级侧的预算是按 **work** 给的（30/90 work），折算只数时要除上每只的 WORK 部件数。
    // 低 RCL 的能量容量撑不起大体型（例如容量 400 时 GetRoleBodys 会一路退到 1 WORK 的体型），
    // 于是同样一笔 work 预算会折出几十只——线上 RCL3 冲级房实测 38 只升级工，
    // 原因就是「40 work ÷ 1 work/只」。这里补一个按 RCL 的人口上限，
    // 与 worker 的 WORKER_POP_CAP_BY_LEVEL 同源问题同一套解法：
    // 数量受限后，work 预算的缺口表现为「先升级」而不是「无限加人」。
    const popCap = Math.max(1, UPGRADER_POP_CAP_BY_LEVEL[room.level] ?? 8);
    const target = Math.min(popCap, Math.ceil(workTarget / workPerUpgrader));

    if (mode === 'rush') {
        // 满级房冲级爬一孵出来就会走退役流程，别再下单
        if (room.level >= 8) return 0;
        // 预算决定编制（参考 manageUpgrade 口径）：numWork < maxWork 才补，
        // maxWork = 净收入 × 1.0~1.2——收入是升级火力的硬上界，数量超预算 =
        // 火力空转（「大部分升级工没能量用」的根因就是把工位下限当编制）。
        // 工位/人口帽只作上限：站不下的多孵也白孵
        const slots = Math.max(
            getRushUpgradeSlotCap(room),
            getControllerUpgradeSlotCap(room),
        );
        return clamp(target, 1, Math.max(1, Math.min(popCap, slots)));
    }

    if (mode === 'high' || mode === 'mini') {
        // mini 迷你房：常驻升级 farm，同 high 口径配专人升级工
        return clamp(target, 1, Math.max(1, getControllerUpgradeSlotCap(room)));
    }

    // low / main：明确由 worker 兼任升级，不单独配人
    return 0;
};

// ==================== upgrader 无缝替班 ====================
//
// 模式与 spawnRules.getHarvesterSuccessionNeeds（harvester 换班）同源：
// 实测一次 spawn→controller 的路程，场上所有 upgrader 的 TTL 都覆盖不住
// 「路程 + 孵化期 + 缓冲」时立即预孵 1 只接班者——接班爬还在路上时前任仍在升级，
// 控制器功率不出现「死后空窗」的周期性锯齿。
//
// 边界：
// - 没有专人编制（getUpgraderTarget=0，low/main 由 worker 兼任）不产生替班需求；
// - rush 的 up-upgrade（boost 流程）不接入——boost 前置的孵化工序不同，保持原退役/补员机制；
// - 路程实测低频重测（5000 tick），寻路不可用（桩环境/异常）时静默退化为无替班需求。
const UPGRADE_TIMING_REFRESH_INTERVAL = 5000;
const UPGRADER_SUCCESSION_BUFFER = 10;
const UPGRADER_MIN_INCUBATION = 12;

/** 实测 spawn→controller 路程（缓存 room.memory.upgradeTiming，低频重测） */
export const getUpgraderPathTime = (room: Room): number | undefined => {
    const mem = room.memory as any;
    const timing = mem.upgradeTiming;
    if (timing && typeof timing.pathTime === 'number'
        && Game.time - (timing.measuredAt || 0) < UPGRADE_TIMING_REFRESH_INTERVAL) {
        return timing.pathTime;
    }
    const spawn = room.spawn?.[0];
    const controller = room.controller;
    if (!spawn || !controller || typeof room.findPath !== 'function') return timing?.pathTime;
    const path = room.findPath(spawn.pos, controller.pos, { ignoreCreeps: true });
    if (!path || path.length === 0) return timing?.pathTime;
    mem.upgradeTiming = { pathTime: path.length, measuredAt: Game.time };
    return path.length;
};

/**
 * 控制器容器专职搬运缺口。
 *
 * @remarks
 * 口径：`缺口 = floor(2 × maxWork × distance / 50)`——
 * 升级端每 tick 从控制器容器抽走 maxWork 点能量，搬运往返 2×distance tick，
 * 在途总量 = 2 × maxWork × distance 能量，折 CARRY 部件（50/件）即需专职搬运力。
 *
 * 容器补给已并入能量分配中枢（energyLogistics：控制容器是 priority 5 的常规请求），
 * 不再需要独立的「缺水」判断。
 */

/**
 * upgrader 的接班缺口数（0/1）：没有任何在编 upgrader 的 TTL 覆盖得住
 * 「实测路程 + 孵化期 + 缓冲」时返回 1（spawnRules 用它把下单时机提前到「死前」）。
 */
export const getUpgraderSuccessionNeeds = (room: Room): number => {
    if (getUpgraderTarget(room) <= 0) return 0;
    const pathTime = getUpgraderPathTime(room);
    if (typeof pathTime !== 'number') return 0;
    const upgraders = getRoomTickCacheValue(room, 'succession_upgraders', () =>
        typeof room.find !== 'function' ? [] as Creep[] :
        ((room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) => !!(c && c.memory && c.memory.role === ROLES.upgrader),
        }) as Creep[]) || []).slice()
    );
    if (upgraders.length === 0) return 0;
    const incubation = Math.max(
        UPGRADER_MIN_INCUBATION,
        ...upgraders.map(h => (h.body ? h.body.length * 3 : UPGRADER_MIN_INCUBATION))
    );
    const covered = upgraders.some(h =>
        (h.ticksToLive || 0) > pathTime + incubation + UPGRADER_SUCCESSION_BUFFER);
    return covered ? 0 : 1;
};

/**
 * worker 的升级侧目标数量（0 表示当前不需要为升级定编）。
 * 定编依据 getUpgradeWorkTarget 的 WORK 总数折算到当前 worker 体型，
 * 再受控制器工位上限约束。
 *
 * @remarks
 * 已由 `upgrader` 承担的升级 work 会从 worker 这边扣掉——`high`/`rush` 下配了专人升级，
 * worker 就能把人口留给建造与刷墙（这就是「减轻 worker 负担」的落地）。
 */
export const getWorkerUpgradeTarget = (room: Room): number => {
    // rush 模式：升级整体交给专人 upgrader（冲级工位），worker 只负责建造/刷墙；
    // 没有建造任务时，存活的 worker 仍可在行为层兜底升级（不占定编）。
    if (getRoomMode(room) === 'rush') return 0;
    const workTarget = getUpgradeWorkTarget(room);
    if (workTarget <= 0) return 0;

    const upgraderWork = getUpgraderTarget(room) * getGeneratedRoleWorkPartCount(room, ROLES.upgrader);
    const remaining = workTarget - upgraderWork;
    if (remaining <= 0) return 0;

    const slotCap = Math.max(1, getControllerUpgradeSlotCap(room));
    const workerWork = getWorkerWorkPartCount(room);
    return Math.min(slotCap, Math.ceil(remaining / Math.max(1, workerWork)));
};

/**
 * 建造/刷墙配额：运行时 worker 职责切分使用。
 * 配额内的个体承担 build/repair/wall，配额外（且存在升级需求）的个体专职升级。
 */
export const getWorkerConstructionQuota = (room: Room): number => {
    // 降级风险区（ttd < UPGRADE_NEEDED_TTD）：建造/刷墙让位，全员转升级——
    // 该档位下 getUpgradeWorkTarget 有 lowerLimit=5 保底，hasWorkerUpgradeDemand 必为真，
    // 职责切分（isWorkerConstructionSlot）会把全部 worker 推向控制器。
    // 更深一档（ttd < 5000）由 universal 降级救援接管，维持原分层。
    const downgradeTtd = room.controller?.ticksToDowngrade || 0;
    if (downgradeTtd > 0 && downgradeTtd < UPGRADE_NEEDED_TTD) return 0;
    const buildTarget = getWorkerBuildTarget(room);
    if (buildTarget > 0) return buildTarget;
    return getWorkerWallTarget(room);
};

/**
 * 房间当前是否还需要 worker 保留专职升级人口。
 *
 * @remarks
 * 用的是**扣除 upgrader 已承担部分之后**的升级侧目标：`high`/`rush` 下配了专人升级时，
 * worker 应该把人口让给建造/刷墙，而不是继续留一批人站控制器。
 */
export const hasWorkerUpgradeDemand = (room: Room): boolean => getWorkerUpgradeTarget(room) > 0;

/** worker 家族角色（共享 worker 执行器的定编个体） */
export const WORKER_FAMILY_ROLES = [ROLES.worker] as const;

/** 控制器升级工位的名册角色：worker 与 upgrader 共用一张名册，避免两族抢同一格 */
export const UPGRADE_SLOT_ROLES = [ROLES.worker, ROLES.upgrader] as const;

// ==================== 房间净收入口径（verbatim 自 src/modules/rush/manageSource 迁移） ====================
// rush 移植版模块删除（用户决定 2026-10-05）后，升级预算仍依赖此参考口径净收入
// （替代毛收入估算，636c7d0 调优基线）。除 source 路径距离缓存由进程内堆改为模块级 Map
// （同进程生命周期语义）与 exports 收敛为模块私有外，逐行保持原实现。

/** 容器损耗折算为能量速率口径（每 tick 修理均摊） */
const NET_INCOME_CONTAINER_REPAIR_LOSS_OWNED = (REPAIR_COST * CONTAINER_DECAY) / CONTAINER_DECAY_TIME_OWNED;

type NetIncomeSourceInfo = {
    sourceId: string;
    roomName: string;
    my: boolean;
    distance: number;
    energyPerTick: number;
    numOpen: number;
    constructed?: boolean;
    linked?: boolean;
    type?: 'normal' | 'keeper';
};

/** 体型造价（逐部件累加） */
const getBodyCost = (body: BodyPartConstant[]): number =>
    body.reduce((sum, part) => sum + BODYPART_COST[part], 0);

/** miner 体型：1M 起步 → work<5 前置堆叠 → 速度门补 M → carry 补到 4×work 口径 → work 堆到 maxWork */
const getMinerBody = (
    energyCapacity: number,
    maxWork: number,
    needCarry: boolean,
    speed = 0.5,
): BodyPartConstant[] => {
    let cost = 0;
    let work = 0;
    let move = 0;
    let carry = 0;

    move += 1;
    cost += BODYPART_COST[MOVE];

    if (needCarry) {
        carry += 1;
        cost += BODYPART_COST[CARRY];
    }

    while (cost < energyCapacity && work + move + carry < MAX_CREEP_SIZE) {
        if (work < 5 && work < maxWork && energyCapacity >= cost + BODYPART_COST[WORK]) {
            work++;
            cost += BODYPART_COST[WORK];
            continue;
        }

        if ((move === 0 || move / work < speed) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
            move++;
            cost += BODYPART_COST[MOVE];
            continue;
        }

        const desiredCarry = needCarry ? Math.ceil((4 * work * HARVEST_POWER) / CARRY_CAPACITY) : 1;

        if (work >= 5 && carry < desiredCarry && energyCapacity >= cost + BODYPART_COST[CARRY]) {
            carry++;
            cost += BODYPART_COST[CARRY];
            continue;
        }

        if (maxWork && work >= maxWork) {
            break;
        }

        if (energyCapacity >= cost + BODYPART_COST[WORK]) {
            work++;
            cost += BODYPART_COST[WORK];
            continue;
        }

        break;
    }

    const body: BodyPartConstant[] = [];

    for (let i = 0; i < work - 1; i++) body.push(WORK);
    for (let i = 0; i < carry; i++) body.push(CARRY);
    for (let i = 0; i < move; i++) body.push(MOVE);

    body.push(WORK);

    return body;
};

/** 采集力上限：速率 + 已有容器(+1) 修正（keeper 分支为外矿口径，本矿净收入不触达，verbatim 保留） */
const getMaxHarvestPower = (
    energyPerTick: number,
    type: 'normal' | 'keeper' | undefined,
    constructed?: boolean,
): number => energyPerTick + (type === 'keeper' ? 6 : constructed ? 1 : 0);

/** 本矿净收入：速率 − miner 折旧 − hauler 折旧（link 直供为 0）− 容器损耗 */
const computeSourceIncome = (
    info: NetIncomeSourceInfo,
    options: { constructed?: boolean; linked?: boolean } = {},
): number => {
    const energyPerTick = info.energyPerTick;
    const maxWork = Math.ceil(getMaxHarvestPower(energyPerTick, info.type, options.constructed) / HARVEST_POWER);
    const minerBody = getMinerBody(10000, maxWork, !!options.linked);
    const cost = getBodyCost(minerBody);
    const minerCost = cost / (CREEP_LIFE_TIME - info.distance);
    const haulerCost = options.linked
        ? 0
        : (energyPerTick * info.distance * 0.04 * (options.constructed ? 75 : 100)) / CREEP_LIFE_TIME;
    const loss = options.constructed ? NET_INCOME_CONTAINER_REPAIR_LOSS_OWNED : 1;
    return energyPerTick - minerCost - haulerCost - loss;
};

/** source 旁容器锚点：已建/工地取最近（≤2）；无则取首个非墙相邻格 */
const getSourceAnchor = (room: Room, source: Source): { x: number; y: number } | undefined => {
    let best: { x: number; y: number } | undefined;
    let bestRange = Infinity;

    const containers = room.find(FIND_STRUCTURES, {
        filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER,
    }) as StructureContainer[];
    for (const container of containers) {
        const range = Math.max(Math.abs(container.pos.x - source.pos.x), Math.abs(container.pos.y - source.pos.y));
        if (range <= 2 && range < bestRange) {
            best = { x: container.pos.x, y: container.pos.y };
            bestRange = range;
        }
    }

    if (best) return best;

    const sites = room.find(FIND_CONSTRUCTION_SITES, {
        filter: (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER,
    }) as ConstructionSite[];
    for (const site of sites) {
        const range = Math.max(Math.abs(site.pos.x - source.pos.x), Math.abs(site.pos.y - source.pos.y));
        if (range <= 2 && range < bestRange) {
            best = { x: site.pos.x, y: site.pos.y };
            bestRange = range;
        }
    }

    if (best) return best;

    const terrain = Game.map.getRoomTerrain(room.name);
    for (const delta of [
        { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
        { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
    ]) {
        const x = source.pos.x + delta.x;
        const y = source.pos.y + delta.y;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        return { x, y };
    }
    return undefined;
};

const NET_INCOME_EIGHT = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

/** source 周围可站立邻格数（工作位口径：非墙即计） */
const getSourceNumOpen = (room: Room, source: Source): number => {
    const terrain = Game.map.getRoomTerrain(room.name);
    let open = 0;
    for (const delta of NET_INCOME_EIGHT) {
        const x = source.pos.x + delta.x;
        const y = source.pos.y + delta.y;
        if (x < 0 || x > 49 || y < 0 || y > 49) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        open++;
    }
    return open;
};

/** source 路径距离缓存（roomName → sourceId → path 长度；进程生命周期，原 rush 堆等价物） */
const NET_INCOME_SOURCE_DISTANCE = new Map<string, Record<string, number>>();

/**
 * 房间净收入（参考口径公开 API）：
 * 逐 source 按 net = 速率 − miner 折旧 − hauler 折旧 − 容器损耗 累加。
 * 供升级预算等下游替代毛收入估算使用。
 */
export const getRoomNetIncome = (room: Room): number => {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return 0;

    let sourceDistance = NET_INCOME_SOURCE_DISTANCE.get(room.name);
    if (!sourceDistance) {
        sourceDistance = {};
        NET_INCOME_SOURCE_DISTANCE.set(room.name, sourceDistance);
    }

    let net = 0;
    for (const source of room.find(FIND_SOURCES)) {
        const anchor = getSourceAnchor(room, source);
        if (!anchor) continue;

        const container = (room.find(FIND_STRUCTURES, {
            filter: (s: Structure) =>
                s.structureType === STRUCTURE_CONTAINER &&
                s.pos.x === anchor.x &&
                s.pos.y === anchor.y,
        }) as StructureContainer[])[0];

        if (sourceDistance[source.id] === undefined) {
            sourceDistance[source.id] = PathFinder.search(
                spawn.pos,
                { pos: new RoomPosition(anchor.x, anchor.y, room.name), range: 1 },
                { heuristicWeight: 1 },
            ).path.length;
        }

        const info: NetIncomeSourceInfo = {
            sourceId: source.id,
            roomName: room.name,
            my: true,
            distance: sourceDistance[source.id],
            energyPerTick: SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME,
            numOpen: getSourceNumOpen(room, source),
            constructed: !!container,
            linked: false,
        };

        net += computeSourceIncome(info, { constructed: !!container, linked: false });
    }
    return net;
};
