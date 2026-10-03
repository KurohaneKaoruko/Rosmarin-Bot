/**
 * 矿工/搬运编成与净收入口径（本矿与外矿共用公式层）。
 * 口径：maxHarvestPower = 采集速率 + 容器/keeper 修正；maxCarryPower = 2×距离×(速率−损耗)；
 * haulerRatio<minerRatio 时补位孵化；净收入 = 速率 − miner 折旧 − hauler 折旧 − 损耗。
 */
import { getBodyCost } from './creepUtils';
import { getRushRoomHeap } from './roomState';
import { getCreepsByRole } from './spawnManager';
import { requestCreep, getHaulerBody, getMinerBody } from './spawnUtils';
import type { RushSourceInfo } from './types';

/** 容器损耗折算为能量速率口径（每 tick 修理均摊） */
const CONTAINER_REPAIR_LOSS_OWNED = (REPAIR_COST * CONTAINER_DECAY) / CONTAINER_DECAY_TIME_OWNED;
const CONTAINER_REPAIR_LOSS = (REPAIR_COST * CONTAINER_DECAY) / CONTAINER_DECAY_TIME;

/** 接力模式下 hauler 单颗粒载量与运力折算 */
const RELAY_HAULER_CARRY_SIZE = 4;
const RELAY_HAULER_CARRY_FACTOR = 1.05;

export const clamp = (value: number, low: number, high: number): number =>
    value < low ? low : value > high ? high : value;

/** 接力开关：CPU 收紧档关闭，RCL<7 默认开 */
export const shouldRelay = (room: Room): boolean =>
    !(Memory as any).tightCpu && room.controller.level < 7;

/** 采集力上限：速率 + keeper(+6)/已有容器(+1) 修正 */
export const getMaxHarvestPower = (
    energyPerTick: number,
    type: 'normal' | 'keeper' | undefined,
    constructed?: boolean,
): number => energyPerTick + (type === 'keeper' ? 6 : constructed ? 1 : 0);

/** 本矿净收入：速率 − miner 折旧 − hauler 折旧（link 直供为 0）− 容器损耗 */
export const computeSourceIncome = (
    info: RushSourceInfo,
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
    const loss = options.constructed ? CONTAINER_REPAIR_LOSS_OWNED : 1;
    return energyPerTick - minerCost - haulerCost - loss;
};

/** 外矿净收入：普通房型无预订速率减半，损耗取外矿口径 */
export const computeRemoteSourceIncome = (
    info: RushSourceInfo,
    options: { reserve?: boolean; constructed?: boolean } = {},
): number => {
    let energyPerTick = info.energyPerTick;
    if (info.type === 'normal' && !options.reserve) {
        energyPerTick *= 0.5;
    }
    const maxWork = Math.ceil(getMaxHarvestPower(energyPerTick, info.type, options.constructed) / HARVEST_POWER);
    const minerBody = getMinerBody(10000, maxWork, false);
    const minerCost = getBodyCost(minerBody) / (CREEP_LIFE_TIME - info.distance);
    const haulerCost = (info.distance * energyPerTick * 0.04 * (options.constructed ? 75 : 100)) / CREEP_LIFE_TIME;
    const loss = options.constructed ? CONTAINER_REPAIR_LOSS : 1;
    return energyPerTick - minerCost - haulerCost - loss;
};

export type CompositionResult = {
    maxHarvestPower: number;
    minerRatio: number;
    haulerRatio: number;
    maxCarryPower: number;
    carryPowerLeft: number;
    /** 本 source 的收入增量（建造期记 0） */
    incomeDelta: number;
    /** 本 source 的收入上限增量 */
    maxIncomeDelta: number;
};

/**
 * 单 source 编成核算：
 * minerRatio = clamp(在岗采集力/速率)；maxCarryPower 按 link/损耗/路面/积压/接力修正；
 * haulerRatio = clamp(剩余运力/需求运力)（无需求视为满足）；收入按两比值取小计缩。
 */
export const computeSourceComposition = (
    info: RushSourceInfo,
    carryPowerLeft: number,
    options: { shouldRelayFlag?: boolean; enoughRoad?: boolean } = {},
): CompositionResult => {
    let energyPerTick = info.energyPerTick;

    // miner
    info.maxHarvestPower = getMaxHarvestPower(energyPerTick, info.type, info.constructed);
    const minerRatio = clamp((info.harvestPower ?? 0) / energyPerTick, 0, 1);

    // hauler
    let maxCarryPower = 0;
    let netIncome: number | undefined;
    const constructed = info.constructed;

    if (info.my) {
        if (info.linked) {
            maxCarryPower = 0;
        } else {
            maxCarryPower += 2 * info.distance * (energyPerTick - (constructed ? CONTAINER_REPAIR_LOSS_OWNED : 1));
        }

        netIncome = computeSourceIncome(info, { constructed, linked: info.linked });
    } else {
        const REMOTE_BUILDER_CARRY_TOTAL = 500;
        const REMOTE_BUILDER_WORK_TOTAL = 6;
        if (info.constructing && info.constructingIndex) {
            const usage = Math.min(
                energyPerTick,
                REMOTE_BUILDER_CARRY_TOTAL /
                    (REMOTE_BUILDER_CARRY_TOTAL / (REMOTE_BUILDER_WORK_TOTAL * BUILD_POWER) +
                        2 * info.constructingIndex),
            );

            energyPerTick -= usage;
        }

        maxCarryPower += 2 * info.distance * Math.max(0, energyPerTick - (constructed ? CONTAINER_REPAIR_LOSS : 1));

        if (options.enoughRoad && !constructed) {
            maxCarryPower *= 9 / 8;
        }

        if ((info.lastPendingEnergy ?? 0) >= 2000) {
            maxCarryPower *= 2;
        }

        if (options.shouldRelayFlag) {
            maxCarryPower /= RELAY_HAULER_CARRY_FACTOR;
        }

        if (!info.constructing) {
            netIncome = computeRemoteSourceIncome(info, {
                reserve: info.reserved,
                constructed,
            });
        }
    }

    const haulerRatio = maxCarryPower === 0 ? 1 : clamp(carryPowerLeft / maxCarryPower, 0, 1);

    const incomeDelta = info.constructing ? 0 : (netIncome ?? 0) * Math.min(minerRatio, haulerRatio);
    const maxIncomeDelta = info.maxIncome ?? 0;

    return {
        maxHarvestPower: info.maxHarvestPower,
        minerRatio,
        haulerRatio,
        maxCarryPower,
        carryPowerLeft: carryPowerLeft - maxCarryPower,
        incomeDelta,
        maxIncomeDelta,
    };
};

/** 闲置单位复用：按谓词挑一名本房 idler（本 tick 已派岗的跳过） */
export const pullIdler = (room: Room, predicate: (creep: Creep) => boolean): Creep | undefined => {
    for (const idler of getCreepsByRole(room, 'idler')) {
        if (idler.memory.role || idler.room.name !== room.name || !predicate(idler)) {
            continue;
        }
        return idler;
    }
    return undefined;
};

/** 在岗采集力记账：active=该 miner 本 tick 实际完成采集；TTL 不足以走完路程+缓冲的不再计入编制 */
export const accumulateMinerAccounting = (info: RushSourceInfo, creep: Creep, active: boolean): void => {
    const harvestPower = creep.getActiveBodyparts(WORK) * HARVEST_POWER;

    if (active) {
        info.harvestingPower = (info.harvestingPower ?? 0) + harvestPower;
    }

    // 预留换班缓冲：剩余寿命 > 孵化时长 + 路程 + 10 才计入在岗编制
    if ((creep.ticksToLive || CREEP_LIFE_TIME) > creep.body.length * CREEP_SPAWN_TIME + info.distance + 10) {
        info.harvestPower = (info.harvestPower ?? 0) + harvestPower;
        info.numMiner = (info.numMiner ?? 0) + 1;
    }
};

/** 在岗运力记账：返回该 creep 计入的运力（TTL 不足半程不计） */
export const accumulateHaulerAccounting = (creep: Creep): number => {
    if ((creep.ticksToLive || CREEP_LIFE_TIME) >= creep.body.length * CREEP_SPAWN_TIME) {
        return creep.getActiveBodyparts(CARRY) * CARRY_CAPACITY;
    }
    return 0;
};

/**
 * 本矿补位请求级联：miner 缺（ratio 0，或 <1 且坑位未满）优先，
 * 搬运缺（ratio 0，或 <minerRatio）次之；命中闲置单位就地派岗（不再发孵化单）。
 */
export const requestSourceWorkers = (
    room: Room,
    info: RushSourceInfo,
    sourceId: string,
    minerRatio: number,
    haulerRatio: number,
    onlyIdler = false,
): boolean => {
    if (minerRatio >= 1 && haulerRatio >= 1 && !info.constructing) {
        return false;
    }

    const income = getRushRoomHeap(room.name).income || 0;

    // 采集单位容量：有收入预期按容量现算，否则按当前可用能量（低能量不断档）
    const minerEnergyCapacity = Math.max(300, income > 0 ? room.energyCapacityAvailable : room.energyAvailable);

    let maxWork = Math.ceil(info.maxHarvestPower / HARVEST_POWER);

    const source = Game.getObjectById<Source>(sourceId);
    const regenSource = (source as any)?.effects?.find((obj: any) => obj.effect === PWR_REGEN_SOURCE);

    if (regenSource) {
        maxWork += Math.ceil(
            POWER_INFO[PWR_REGEN_SOURCE].effect[regenSource.level - 1] /
                POWER_INFO[PWR_REGEN_SOURCE].period /
                HARVEST_POWER,
        );
    }

    const haulerEnergyCapacity = room.energyAvailable;

    const assignOrRequestMiner = (): boolean => {
        const spare = getCreepsByRole(room, 'miner').find(
            (creep) => creep.room.name === room.name && !creep.memory.sourceId,
        );

        if (spare) {
            spare.memory = { role: 'miner', sourceId };
            return false;
        }
        if (onlyIdler) return false;

        const body = getMinerBody(minerEnergyCapacity, maxWork, info.linked);
        requestCreep(room, body, 'miner', 'ownedSources', { memory: { sourceId } });
        return true;
    };

    const assignOrRequestHauler = (): boolean => {
        const idler = pullIdler(room, (creep) => {
            if (creep.body.some((part) => part.type !== MOVE && part.type !== CARRY)) {
                return false;
            }
            if (creep.getActiveBodyparts(CARRY) === 0 || creep.getActiveBodyparts(MOVE) === 0) {
                return false;
            }
            return true;
        });

        if (idler) {
            idler.memory = { role: 'hauler' };
            return false;
        }
        if (onlyIdler) return false;

        const maxCarry = shouldRelay(room) ? RELAY_HAULER_CARRY_SIZE : 32;
        const body = getHaulerBody(haulerEnergyCapacity, {
            forRoad: !!(room.memory as any).enoughRoad,
            maxCarry,
        });

        requestCreep(room, body, 'hauler', 'ownedSources');
        return true;
    };

    if (minerRatio === 0) return assignOrRequestMiner();

    if (haulerRatio === 0) return assignOrRequestHauler();

    if (minerRatio < 1 && (info.numMiner ?? 0) < info.numOpen) return assignOrRequestMiner();

    if (haulerRatio < minerRatio) return assignOrRequestHauler();

    return false;
};
