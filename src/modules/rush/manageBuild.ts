/**
 * 建造态门控与 builder 发放。
 * 口径：building 态进出门控带 rampart 迟滞（阈值半/全），upgradeNeeded 强制退建；
 * builder 火力 = work×4，与升级共享 numWork 记账；缺口最小 2（保持建造火种）；
 * 闲量与 upgrader 均可转职 builder（2×carry ≥ work 门）。
 */
import { BUILD_PRIORITY, RCL_TO_BUILD_RAMPART } from './constants';
import { getMaxWork } from './manageUpgrade';
import { getControllerContainer, getRushTickState } from './roomState';
import { getCreepsByRole } from './spawnManager';
import { requestCreep, getBuilderBody } from './spawnUtils';
import { runBuilder } from './creepExec';

/** builder 火力折算（BUILD_POWER 的经验放大） */
const BUILD_POWER_MULTIPLIER = 4;

/** rampart 最低耐久基准（× clamp(gcl/4)） */
const RAMPART_HITS_MIN_BASE = 100000;

export const getRampartHitsMin = (): number =>
    RAMPART_HITS_MIN_BASE * clampNum(Game.gcl.level / 4, 0, 1);

/**
 * building 态机：有工地/低耐久 rampart 且非防降级期 → 进入；
 * 工地与低耐久双清或转防降级 → 退出（builder 全员回闲量），记录 lastBuildTime 供工位缓存失效。
 */
export const manageBuildState = (
    room: Room,
    builders: Creep[],
    constructionSites: ConstructionSite[],
    ramparts: StructureRampart[],
): void => {
    const mem = room.memory as any;
    const threshold = mem.building ? getRampartHitsMin() : getRampartHitsMin() / 2;

    const lowRamparts = ramparts.filter((rampart) => rampart.hits < threshold);

    if (mem.building && ((constructionSites.length === 0 && lowRamparts.length === 0) || mem.upgradeNeeded)) {
        mem.lastBuildTime = Game.time;
        mem.building = false;
        delete mem.buildPower;
        for (const creep of builders) {
            creep.memory = {};
        }
    } else if (!mem.building && (constructionSites.length > 0 || lowRamparts.length > 0) && !mem.upgradeNeeded) {
        mem.building = true;
    }
};

/** 建造能量沉淀点：容器位掉落 > storage > terminal > controller 容器（执行器取能顺序的供给面） */
export const getBuildEnergyDepot = (
    room: Room,
    dropped: Resource | undefined,
    controllerContainer: StructureContainer | undefined,
): Resource | StructureStorage | StructureTerminal | StructureContainer | undefined => {
    if (dropped) return dropped;
    if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY)) return room.storage;
    if (room.terminal && room.terminal.store.getUsedCapacity(RESOURCE_ENERGY)) return room.terminal;
    return controllerContainer;
};

/**
 * 工地优先目标：低耐久 rampart 条件性最优先；容量 <800 时 extension 抬到 tower 档；
 * 无主 spawn 时 spawn 工地最优先；低容量房 extension 次优先；tower 再次；其余按 BUILD_PRIORITY 取最高档全体。
 */
export const getPriorityTargets = (
    room: Room,
    constructionSites: ConstructionSite[],
    ramparts: StructureRampart[],
    energyDepot: unknown,
): (ConstructionSite | StructureRampart)[] => {
    const mem = room.memory as any;
    let targets: ConstructionSite[] = [];
    let currentPriority = Infinity;

    if (ramparts.length > 0) {
        if (constructionSites.length === 0) {
            return ramparts;
        }
        if ((mem.constructionLevel || 0) >= RCL_TO_BUILD_RAMPART - 1 && energyDepot) {
            return ramparts;
        }
    }

    const extensionFirst = room.energyCapacityAvailable < 800;

    const sitesByType: Partial<Record<StructureConstant, ConstructionSite[]>> = {};

    for (const site of constructionSites) {
        let priority = BUILD_PRIORITY[site.structureType] ?? Infinity;

        if (site.structureType === STRUCTURE_EXTENSION && extensionFirst) {
            priority = BUILD_PRIORITY[STRUCTURE_TOWER];
        }

        if (priority < currentPriority) {
            currentPriority = priority;
            targets = [site];
        } else if (priority === currentPriority) {
            targets.push(site);
        }

        sitesByType[site.structureType] = sitesByType[site.structureType] || [];
        sitesByType[site.structureType]!.push(site);
    }

    if (room.find(FIND_MY_SPAWNS).length === 0 && sitesByType[STRUCTURE_SPAWN]) {
        return sitesByType[STRUCTURE_SPAWN]!;
    }

    if (
        room.energyCapacityAvailable < BODYPART_COST[CLAIM] + BODYPART_COST[MOVE] &&
        sitesByType[STRUCTURE_EXTENSION]
    ) {
        return sitesByType[STRUCTURE_EXTENSION]!;
    }

    if (sitesByType[STRUCTURE_TOWER]) {
        return sitesByType[STRUCTURE_TOWER]!;
    }

    return targets;
};

/**
 * builder 发放（参考 manageBuild 的孵化侧）：
 * buildPower 记账（work×4，并计入共享 numWork）→ emergency 冻结 →
 * 缺口打包（最小 2）→ 闲量/upgrader 转职 → 按容量打包入队 BUILD 档。
 */
export const manageBuildSpawn = (room: Room, builders: Creep[], constructionSites: ConstructionSite[] = [], ramparts: StructureRampart[] = []): void => {
    const mem = room.memory as any;
    const state = getRushTickState(room);

    if (!mem.building) {
        return;
    }

    // 执行器：取能（沉淀点）→ 优先目标建造/维修
    const energyDepot = getBuildEnergyDepot(room, undefined, getControllerContainer(room));
    const priorityTargets = getPriorityTargets(room, constructionSites, ramparts, energyDepot);

    for (const creep of builders) {
        if (creep.spawning) continue;
        runBuilder(creep, energyDepot, priorityTargets.length > 0 ? priorityTargets[0] : undefined);
    }

    if (!state.canSpawn) {
        return;
    }

    mem.buildPower = 0;

    for (const creep of builders) {
        if ((creep.ticksToLive || CREEP_LIFE_TIME) > creep.body.length * CREEP_SPAWN_TIME) {
            const buildPower = creep.getActiveBodyparts(WORK) * BUILD_POWER_MULTIPLIER;
            mem.numWork += buildPower;
            mem.buildPower += buildPower;
        }
    }

    if (mem.emergency) {
        return;
    }

    if (mem.buildPower >= getMaxWork(room) && mem.buildPower !== 0) {
        return;
    }

    let workNeeded: number;
    if (mem.jumping && room.controller!.level === 3) {
        workNeeded = Infinity;
    } else {
        const diff = getMaxWork(room) - mem.buildPower;
        workNeeded = diff > 0 ? diff : 2;
    }

    // 闲量与 upgrader 转职：有手且兜不至太空（2×carry ≥ work）
    const candidates = [...getCreepsByRole(room, 'idler'), ...getCreepsByRole(room, 'upgrader')];
    for (const idler of candidates) {
        const numWork = idler.getActiveBodyparts(WORK);

        if (numWork === 0) continue;
        if (2 * idler.getActiveBodyparts(CARRY) < numWork) continue;

        idler.memory.role = 'builder';

        workNeeded -= numWork * BUILD_POWER_MULTIPLIER;

        if (workNeeded <= 0) {
            return;
        }
    }

    const body = getBuilderBody(room.energyCapacityAvailable);
    requestCreep(room, body, 'builder', 'build');
};

const clampNum = (value: number, low: number, high: number): number =>
    value < low ? low : value > high ? high : value;
