/**
 * 房间功能注册表（执行面组合式）：房间级功能的唯一编排点。
 * - 顺序即原 execute.ts 调用顺序（逐项映射，不得随意重排）；
 * - phase 'pre' = QoS 门之前（防御/孵化/结构等保命面），'post' = QoS 门之后（自动化/扩张等可延后面）；
 * - gate 不通过即跳过本功能；run 接收 room（组合式入口，逻辑主体在各自模块/门面方法）。
 */
import { isRoomTickAligned } from '@/modules/shared/roomPhase';
import { getRoomMode } from '@/modules/shared/roomMode';
import type { RoomModeProfile } from '@/modules/shared/roomMode';
import { RoadBuilder } from '@/modules/features/external/externalRoad';
import { rushBoost, relocateOldSpawn } from '@/prototype/Room/function/rushSupport';

type RoomFeature = {
    id: string;
    phase: 'pre' | 'post';
    /** 返回 false 跳过；未定义则恒运行 */
    gate?: (room: Room, profile: RoomModeProfile) => boolean;
    run: (room: Room) => void;
};

export const ROOM_FEATURES: readonly RoomFeature[] = [
    // ── pre：QoS 门之前（保命面） ──
    { id: 'energyState', phase: 'pre', run: (r) => r.updateEnergyState(false) },
    // 冲级面板（仅 rush 内部自判）：逐 tick 渲染，放 QoS 节流之前——面板不能有缺帧
    { id: 'raceVisual', phase: 'pre', run: (r) => r.raceVisual() },
    // 更新任务池
    { id: 'missionUpdate', phase: 'pre', run: (r) => r.MissionUpdate() },
    // 主动防御处理（叠加房间相位错峰，defenseInterval=1 时保持每 tick）
    {
        id: 'activeDefense',
        phase: 'pre',
        gate: (r, p) => p.defenseInterval === 1 || isRoomTickAligned(r.name, p.defenseInterval),
        run: (r) => r.activeDefense(),
    },
    // 管理房间中的建筑物
    { id: 'spawnWork', phase: 'pre', run: (r) => r.SpawnWork() },
    { id: 'towerWork', phase: 'pre', run: (r) => r.TowerWork() },
    { id: 'linkWork', phase: 'pre', run: (r) => r.LinkWork() },
    { id: 'terminalWork', phase: 'pre', run: (r) => r.TerminalWork() },
    { id: 'labWork', phase: 'pre', gate: (_r, p) => !!p.facilities, run: (r) => r.LabWork() },
    { id: 'factoryWork', phase: 'pre', gate: (_r, p) => !!p.facilities, run: (r) => r.FactoryWork() },
    { id: 'powerSpawnWork', phase: 'pre', gate: (_r, p) => !!p.facilities, run: (r) => r.PowerSpawnWork() },

    // ── post：QoS 门之后（可延后面） ──
    // 自动市场交易（low 关闭）
    { id: 'autoMarket', phase: 'post', gate: (_r, p) => !!p.market, run: (r) => r.autoMarket() },
    // 自动建筑
    { id: 'autoBuild', phase: 'post', run: (r) => r.autoBuild() },
    // 控制器旁能量缓冲工地（升级工「围在周边秒取能」的配套，低频放置）
    {
        id: 'controllerBufferSite',
        phase: 'post',
        gate: (r) => isRoomTickAligned(r.name, 150),
        run: (r) => r.ensureControllerBufferSite(),
    },
    // rush：控制器容器 RCL2 起例行保活（升级专线的主缓冲，被毁/低耐久自动补）
    {
        id: 'rushControllerContainer',
        phase: 'post',
        gate: (r) => getRoomMode(r) === 'rush' && isRoomTickAligned(r.name, 150),
        run: (r) => RoadBuilder.ensureControllerContainer(r),
    },
    { id: 'autoLab', phase: 'post', gate: (_r, p) => !!p.facilities, run: (r) => r.autoLab() },
    { id: 'autoFactory', phase: 'post', gate: (_r, p) => !!p.facilities, run: (r) => r.autoFactory() },
    { id: 'autoPower', phase: 'post', gate: (_r, p) => !!p.facilities, run: (r) => r.autoPower() },
    // 外矿采集（low 关闭）
    { id: 'outMine', phase: 'post', gate: (_r, p) => !!p.remoteMining, run: (r) => r.outMine() },
    // 自爆拉能快递仅 mini 使用（rush 的升级供能走能量中枢与控制器专线，
    // 不再依赖自爆墓碑——rush 在 spawn 旁堆快递会挤占孵化与交通）
    { id: 'rushBoost', phase: 'post', gate: (r) => getRoomMode(r) === 'mini', run: (r) => rushBoost(r) },
    // spawn 错位重建：建完第二个 spawn 后，把不在布局位的旧 spawn 拆到布局位（所有模式）
    {
        id: 'relocateOldSpawn',
        phase: 'post',
        gate: (r) => isRoomTickAligned(r.name, 60),
        run: (r) => relocateOldSpawn(r),
    },
    // 显示防御 cost 矩阵
    {
        id: 'defenseCostMatrix',
        phase: 'post',
        gate: (_r, p) => !!p.defenseCostMatrix,
        run: (r) => r.showDefenseCostMatrix(),
    },
    // Observer 工作
    { id: 'observeWork', phase: 'post', run: (r) => r.ObserveWork() },
];

/** 按 phase 取功能序列（exec 两次遍历用） */
export const roomFeaturesOf = (phase: 'pre' | 'post'): readonly RoomFeature[] =>
    ROOM_FEATURES.filter((f) => f.phase === phase);

export const runRoomFeature = (room: Room, feature: RoomFeature, profile: RoomModeProfile): void => {
    if (feature.gate && !feature.gate(room, profile)) return;
    feature.run(room);
};
