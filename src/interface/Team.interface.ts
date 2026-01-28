// Memory中保存的小队数据
interface TeamCacheMemory {
    /** 低于多少血量的建筑视为可以通行 */
    structHitLimit?: number
    /** spawn 是否危险（spawn 周围 1 格是否禁止通行） */
    isSpawnDanger?: boolean
    /** 四人小队卡位重定向节流 tick */
    blockedReorientTick?: number
    /** 小队推进目标点（以纯对象存储，运行时还原为 RoomPosition） */
    targetPos?: { x: number; y: number; roomName: string }
    /** targetPos 自动换点索引 */
    targetPosIndex?: number
    /** 同 tick 治疗下令幂等标记 */
    healOrdersTick?: number
    /** 最近一次进入 avoid/flee 的 tick */
    lastAvoidTime?: number
    /** 调试：虚拟承伤 */
    _virtual_damage?: number
    /** 强制优先打建筑 */
    forceStructure?: boolean
    [key: string]: any
}

interface TeamMemory {
    name: string,
    time: number, // 创建时间
    status: 'ready' | 'attack' | 'flee' | 'avoid' | 'sleep'; // 状态
    toward: '↑' | '←' | '→' | '↓',      // 朝向
    formation: 'line' | 'quad',  // 队形
    moveMode: string;    // 移动模式
    homeRoom: string;    // 孵化房间
    targetRoom?: string,    // 目标房间
    creeps: Id<Creep>[],   // 成员数组
    num: number,   // 成员数量
    /** 该队伍由哪个孵化旗创建（用于失败后抬档） */
    spawnFlag?: string
    cache?: TeamCacheMemory
}

interface Team {
    name: string;
    status: 'ready' | 'attack' | 'flee' | 'avoid' | 'sleep'; // 状态
    toward: '↑' | '←' | '→' | '↓';    // 朝向
    formation: 'line' | 'quad' | string;  // 队形
    moveMode: string;    // 移动模式
    homeRoom: string;    // 孵化房间
    targetRoom: string;    // 目标房间
    creeps: Creep[],   // 成员数组(只包含存活的成员)
    cache: { [key: string]: any };    // 缓存
    flag: Flag;          // 小队指挥旗
}
