export default class RoomExecute extends Room {
    exec() {
        this.MissionUpdate();    // 更新任务池
        this.StructureWork();    // 处理建筑行为
        this.activeDefense();    // 主动防御处理
        this.autoMarket();       // 自动市场交易
        this.autoBuild();        // 自动建筑
        this.autoLab();          // 自动Lab合成
        this.autoFactory();      // 自动Factory生产
        this.autoPower();        // 自动Power处理
        this.outMine();          // 外矿采集
        
        this.showDefenseCostMatrix(); // 显示防御cost矩阵
    }

    // 房间初始化
    init() {
        if (!this.my || !Memory['RoomControlData'][this.name]) return;

        if (!Memory['StructControlData'][this.name]) {
            Memory['StructControlData'][this.name] = {
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