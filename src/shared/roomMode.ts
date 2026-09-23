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
 *
 * 模式由 room.mode 指令手动设置；所有消费方统一通过 getRoomModeProfile 读参数，
 * 不再各自维护字符串比较与魔数。
 */

import { getRoomData } from '@/shared/memory';

export type RoomModeName = 'low' | 'main' | 'high' | 'rush';

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
        productionScheduling: true,
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

export const isHighLikeMode = (mode: string): boolean => mode === 'high' || mode === 'rush';
