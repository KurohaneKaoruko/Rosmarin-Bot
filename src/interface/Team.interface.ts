// Memory中保存的小队数据
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
    cache?: { [key: string]: any }
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
