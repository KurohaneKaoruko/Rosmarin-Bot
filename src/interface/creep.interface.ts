interface Creep {
    /** 初始化*/
    init(): void;
    /** 运行 */
    exec(): void;
    /** 爬唱歌 */
    randomSing(): void;

    moveHomeRoom(): boolean;
    moveToRoom(roomName: string, options?:{[key: string]: any}): any;
    doubleMove(Direction: DirectionConstant): number
    doubleMoveTo(target: RoomPosition, color?: string, ops?: any): number | boolean;
    doubleMoveToRoom(roomName: string, color?: string): boolean;
    doubleFlee(): number;
    doubleToAttack(target: Creep | Structure): number | boolean
    doubleToDismantle(target: Structure): number | boolean

    TakeEnergy(pickup?: boolean): void;
    Boost(boostmap: any): number;
    unboost(): boolean;
    isWhiteList(): boolean;

    goBoost(boostTypes: string[], must?: boolean, reserve?: boolean): boolean;
    goHaverst(target: Source | Mineral): boolean;
    goWithdraw(target: Structure | Tombstone | Ruin, resoureType?: ResourceConstant, amount?: number): boolean;
    goTransfer(target: Structure, resoureType?: ResourceConstant, amount?: number): boolean;
    goBuild(target: ConstructionSite): boolean;
    goRepair(target: Structure): boolean;
    goPickup(target: Resource): boolean;
}

interface CreepMemory {
    role: string;
    dontPullMe: boolean;
    mission: Task;
    cache: { [key: string]: any };
    ready: boolean;
    lastTargetPos: any;
    home: string;
    targetSourceId: string;
    working: boolean;
    homeRoom: string;
    sourceRoom: string;
    targetRoom: string;
    bind: Id<Creep>;
    notified: boolean;
    boosted: boolean;
    squad: string;
    boostAttempts: any;
    Rerunt: number;
    sayText: string[];
    boostLevel: number;
    action: string;
    idle: number;
}
