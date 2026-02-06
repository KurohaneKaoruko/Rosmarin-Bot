import { shouldRun } from '@/modules/infra/qos';
import { getRoomData, getStructData } from '@/modules/utils/memory';

export default class RoomExecute extends Room {
    exec() {
        this.updateEnergyState(false);
        // 更新任务池
        this.MissionUpdate();

        // 主动防御处理
        this.activeDefense();

        // 管理房间中的建筑物
        this.SpawnWork();
        this.TowerWork();
        this.LinkWork();
        this.LabWork();
        this.TerminalWork();
        this.FactoryWork();
        this.PowerSpawnWork();

        if(!shouldRun({ allowLevels: ['normal', 'constrained'] })) return;
        
        // 自动化处理
        this.autoMarket();       // 自动市场交易
        this.autoBuild();        // 自动建筑
        this.autoLab();          // 自动Lab合成
        this.autoFactory();      // 自动Factory生产
        this.autoPower();        // 自动Power处理
        this.outMine();          // 外矿采集
        
        // 显示防御cost矩阵
        this.showDefenseCostMatrix();
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

        // 房间基础工作所需的全局变量
        if (!global.CreepNum) global.CreepNum = {};
        if (!global.SpawnMissionNum) global.SpawnMissionNum = {};

        // 当前房间各类型的creep数量
        global.CreepNum[this.name] = {};
        // 当前房间孵化队列中各类型的creep数量
        global.SpawnMissionNum[this.name] = {};

        this.initMissionPool(); // 初始化任务池
        this.update();  // 初始化建筑缓存
    }
}
