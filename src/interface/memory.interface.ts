interface Memory {
    stats: any;
    RoomControlData: { 
        [roomName: string]: {
            /** 运行模式 */
            mode: string; // 'main' | 'low' | 'stop'
            /** 布局 */
            layout: string;
            /** 布局中心 */
            center: { x: number, y: number };
            /** 签名 */
            sign?: string;
            /** 自动建筑开关 */
            autobuild?: boolean;
            /** 开关Power采集 */
            outminePower?: boolean;
            /** 开关Deposit采集 */
            outmineDeposit?: boolean;
        }
    };
    StructControlData: {
        [roomName: string]: {
            /**  powerSpawn开关 */
            powerSpawn?: boolean;
            /** factory开关 */
            factory?: boolean;
            /** 工厂等级 */
            factoryLevel?: number;
            /** 当前生产任务 */
            factoryProduct?: "energy" | MineralConstant | "G" | CommodityConstant;
            /** 当前生产任务的限额 */
            factoryAmount?: number;
            /** lab开关 */
            lab?: boolean;
            /** 当前合成任务的限额 */
            labAmount?: number;
            /** 当前合成任务的底物A */
            labAtype?: ResourceConstant;
            /** 当前合成任务的底物B */
            labBtype?: ResourceConstant;
            /** 底物labA */
            labA?: Id<Structure<StructureConstant>>;
            /** 底物labB */
            labB?: Id<Structure<StructureConstant>>;
            /** boost登记 */
            boostRes?: {
                [id: Id<StructureLab>]: {
                    mineral: ResourceConstant,
                    amount: number
                }
            };
        }
    };
    LayoutData: { [roomName: string]: any };
    OutMineDate: { [roomName: string]: any };
    AutoData: { 
        AutoMarketData: { [roomName: string]: any };
        AutoLabData: { [roomName: string]: any };
        AutoFactoryData: { [roomName: string]: any };
        AutoPowerData: { [roomName: string]: any };
    };
    ResourceManage: { [roomName: string]: any };
}