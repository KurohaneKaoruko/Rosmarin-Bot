import { getRoomData, getStructData } from '@/modules/shared/memory';
import { isRoomTickAligned } from '@/modules/shared/roomPhase';
import { getRoomMode, getRoomModeProfile } from '@/modules/shared/roomMode';
import { rushBoost, relocateOldSpawn } from '@/prototype/Room/function/rushSupport';

export default class RoomExecute extends Room {
    exec() {
        // 处理上一 tick 的 Observer 回调
        this.ObserveCallbackTick();

        const mode = getRoomData()?.[this.name]?.mode;
        if (mode === 'stop') return;
        const profile = getRoomModeProfile(this);
        this.updateEnergyState(false);
        // 冲级面板（仅 rush）：逐 tick 渲染，放 QoS 节流之前——面板不能有缺帧
        this.raceVisual();
        // 更新任务池
        this.MissionUpdate();

        // 主动防御处理（叠加房间相位错峰，defenseInterval=1 时保持每 tick）
        if (profile.defenseInterval === 1 || isRoomTickAligned(this.name, profile.defenseInterval)) {
            this.activeDefense();
        }

        // 管理房间中的建筑物
        this.SpawnWork();
        this.TowerWork();
        this.LinkWork();
        this.TerminalWork();
        if (profile.facilities) {
            this.LabWork();
            this.FactoryWork();
            this.PowerSpawnWork();
        }

        if(!global.qos.shouldRun({ allowLevels: ['normal', 'constrained'] })) return;
        
        // 自动化处理
        if (profile.market) this.autoMarket();       // 自动市场交易（low 关闭）
        this.autoBuild();        // 自动建筑
        // 控制器旁能量缓冲工地（升级工「围在周边秒取能」的配套，低频放置）
        if (isRoomTickAligned(this.name, 150)) this.ensureControllerBufferSite();
        if (profile.facilities) {
            this.autoLab();          // 自动Lab合成
            this.autoFactory();      // 自动Factory生产
            this.autoPower();        // 自动Power处理
        }
        if (profile.remoteMining) this.outMine();          // 外矿采集（low 关闭）

        // rush 冲级特殊机制（低等级 + spawn 贴控制器时触发）与 mini 迷你房常驻机制：
        // source 旁补 ext + 自爆拉能快递（有 link 自动停）
        if (getRoomMode(this) === 'rush' || getRoomMode(this) === 'mini') rushBoost(this);
        // spawn 错位重建：建完第二个 spawn 后，把不在布局位的旧 spawn 拆到布局位（所有模式）
        if (isRoomTickAligned(this.name, 60)) relocateOldSpawn(this);

        // 显示防御cost矩阵
        if (profile.defenseCostMatrix) this.showDefenseCostMatrix();

        // Observer 工作
        this.ObserveWork();
    }

    // 房间初始化
    init() {
        if (!this.my || !getRoomData()[this.name]) return;

        const structData = getStructData();
        if (!structData[this.name]) {
            structData[this.name] = {
                lab: true,
                factory: true,
                powerSpawn: true,
            } as any;
        }

        // 孵化队列数量由 room.getSpawnMissionNum() 按需统计

        this.initMissionPool(); // 初始化任务池
        this.update();  // 初始化建筑缓存
    }
}
