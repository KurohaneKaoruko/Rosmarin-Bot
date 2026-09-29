/**
 * 房间运行模式（low / main / high / rush）统一参数表。
 *
 * 四种模式的职责边界：
 * - low  低功耗：关闭非必要功能（lab / factory / powerSpawn / 市场 / 外矿 / 防御可视化 /
 *        资源排产），防御降频，只保留采集、升级（最低保障）与基础建造。
 * - main 主模式：主要功能全部开启，按标准节奏运行。
 * - high 全开：在 main 之上全面提频——升级吞吐 ×1.2、外矿扫描/重派间隔减半、
 *        运力与紧急 UNIV 上限用 high 档、控制器缓冲拉满。
 * - rush 高速冲级：冲级特化——升级吞吐 ×1.5、外矿预算全开且目标上限放开、
 *        建造/孵化调度最高频率，一切资源为控制器等级让路。
 * - mini 迷你房：常驻冲级 farm——spawn 贴控制器的小房，
 *        源旁 ext 直填 + 自爆拉能快递常驻运转（机制见 rushSupport），非必要设施全部关闭。
 *
 * 模式由 room.mode 指令手动设置；所有消费方统一通过 getRoomModeProfile 读参数，
 * 不再各自维护字符串比较与魔数。
 */

import { getRoomData } from '@/modules/shared/memory';

export type RoomModeName = 'low' | 'main' | 'high' | 'rush' | 'mini';

export type RoomModeProfile = {
    name: RoomModeName;
    /** 建筑设施：lab / factory / powerSpawn / power 处理（low 关闭） */
    facilities: boolean;
    /** 自动市场交易（low 关闭） */
    market: boolean;
    /** 外矿采集：能量矿 + 中央九房（low 关闭） */
    remoteMining: boolean;
    /** 防御 cost 矩阵可视化（low 关闭） */
    defenseCostMatrix: boolean;
    /** 主动防御执行周期（tick，low 降频） */
    defenseInterval: number;
    /** 能量矿运行间隔（normal / QoS constrained） */
    remoteEnergyInterval: { normal: number; constrained: number };
    /** 中央九房运行间隔（normal / QoS constrained） */
    remoteCenterInterval: { normal: number; constrained: number };
    /** 孵化任务调度周期（tick） */
    spawnMissionInterval: number;
    /** 搬运任务调度周期（tick） */
    transportMissionInterval: number;
    /** high 强度：紧急 UNIV 上限 / 任务调度间隔 / 运力 / 控制器缓冲 用 high 档（high、rush 为 true） */
    highIntensity: boolean;
    /** 升级吞吐倍率（incomeWork × multiplier） */
    upgradeIncomeMultiplier: number;
    /** 外矿运力吞吐冗余系数（死亡率/绕路/沼泽损耗 */
    remoteCarryThroughputFactor: number;
    /** 外矿采集位积压加编阈值缩放（越小越早加编） */
    remoteCarryBacklogScale: number;
    /** 外矿未预定房间产量口径（1=按满产规划，<1 打折；rush 的 reserver 优先发车故不打折） */
    remoteUnreservedIncomeFactor: number;
    /** 参与跨房间资源排产（low 退出） */
    productionScheduling: boolean;
};

export const ROOM_MODE_PROFILES: Record<RoomModeName, RoomModeProfile> = {
    low: {
        name: 'low',
        facilities: false,
        market: false,
        remoteMining: false,
        defenseCostMatrix: false,
        defenseInterval: 15,
        remoteEnergyInterval: { normal: 20, constrained: 40 },
        remoteCenterInterval: { normal: 10, constrained: 20 },
        spawnMissionInterval: 10,
        transportMissionInterval: 20,
        highIntensity: false,
        upgradeIncomeMultiplier: 1,
        remoteCarryThroughputFactor: 1.0,
        remoteCarryBacklogScale: 1.0,
        remoteUnreservedIncomeFactor: 0.5,
        productionScheduling: false,
    },
    main: {
        name: 'main',
        facilities: true,
        market: true,
        remoteMining: true,
        defenseCostMatrix: true,
        defenseInterval: 1,
        remoteEnergyInterval: { normal: 20, constrained: 40 },
        remoteCenterInterval: { normal: 10, constrained: 20 },
        spawnMissionInterval: 10,
        transportMissionInterval: 20,
        highIntensity: false,
        upgradeIncomeMultiplier: 1,
        remoteCarryThroughputFactor: 1.1,
        remoteCarryBacklogScale: 0.85,
        remoteUnreservedIncomeFactor: 0.75,
        productionScheduling: true,
    },
    high: {
        name: 'high',
        facilities: true,
        market: true,
        remoteMining: true,
        defenseCostMatrix: true,
        defenseInterval: 1,
        remoteEnergyInterval: { normal: 10, constrained: 20 },
        remoteCenterInterval: { normal: 5, constrained: 10 },
        spawnMissionInterval: 5,
        transportMissionInterval: 10,
        highIntensity: true,
        upgradeIncomeMultiplier: 1.2,
        remoteCarryThroughputFactor: 1.15,
        remoteCarryBacklogScale: 0.75,
        remoteUnreservedIncomeFactor: 0.9,
        productionScheduling: true,
    },
    rush: {
        name: 'rush',
        facilities: true,
        market: true,
        remoteMining: true,
        defenseCostMatrix: true,
        defenseInterval: 1,
        remoteEnergyInterval: { normal: 5, constrained: 10 },
        remoteCenterInterval: { normal: 4, constrained: 6 },
        spawnMissionInterval: 5,
        transportMissionInterval: 10,
        highIntensity: true,
        upgradeIncomeMultiplier: 1.5,
        remoteCarryThroughputFactor: 1.3,
        remoteCarryBacklogScale: 0.5,
        remoteUnreservedIncomeFactor: 1.0,
        productionScheduling: true,
    },
    // mini 迷你房：升级 farm 特化——lab/factory/市场/外矿全关，只留采集、建造与常驻冲级机制
    mini: {
        name: 'mini',
        facilities: false,
        market: false,
        remoteMining: false,
        defenseCostMatrix: false,
        defenseInterval: 5,
        remoteEnergyInterval: { normal: 20, constrained: 40 },
        remoteCenterInterval: { normal: 10, constrained: 20 },
        spawnMissionInterval: 5,
        transportMissionInterval: 10,
        highIntensity: true,
        upgradeIncomeMultiplier: 1.5,
        remoteCarryThroughputFactor: 1.3,
        remoteCarryBacklogScale: 0.5,
        remoteUnreservedIncomeFactor: 1.0,
        productionScheduling: false,
    },
};

/** 兼容多处存储路径的房间模式读取（更高优先级的配置优先） */
export const getRoomMode = (room: Room): RoomModeName | 'stop' => {
    const data = getRoomData(room.name) as any;
    return data?.mode || (room.memory as any).mode || 'main';
};

export const getRoomModeProfile = (room: Room): RoomModeProfile => {
    const mode = getRoomMode(room);
    return ROOM_MODE_PROFILES[mode as RoomModeName] ?? ROOM_MODE_PROFILES.main;
};

// high/rush/mini 都吃高强度档（紧急 UNIV 上限、缩水物流、提前换班等）
export const isHighLikeMode = (mode: string): boolean => mode === 'high' || mode === 'rush' || mode === 'mini';

/**
 * 特殊冲级机制是否生效（rush 特殊子模式 / mini 迷你房）。
 * - rush：低等级(RCL≤3) + spawn 距控制器 ≤3 才进入特殊子模式；
 * - mini：机制常驻，但同样依赖 spawn 贴控制器；
 * - 房内有 link 后整体退位（正规供能链接接管）。
 *
 * 命中时生效的事：自爆拉能快递总闸打开（见 rushSupport.rushBoost）。
 * （source 旁 ext 的建造已改为 rush 模式 RCL2 常规行为：见 layoutPlanner.createSourceExtSites，
 *   不再依赖本闸门。）
 */
export const isSpecialRushActive = (room: Room): boolean => {
    const mode = getRoomMode(room);
    if (mode !== 'rush' && mode !== 'mini') return false;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || !room.controller?.my) return false;
    if (spawn.pos.getRangeTo(room.controller.pos) > 3) return false;
    if (mode === 'rush' && room.level > 3) return false;
    const hasLink = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0;
    return !hasLink;
};
