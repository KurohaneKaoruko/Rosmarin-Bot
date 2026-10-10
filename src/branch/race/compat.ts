/**
 * 服务器环境兼容垫片（必须保持为 main.ts 的首个 import）。
 *
 * 部分私服（如升级竞速服）不加载 Power 玩法模块——相关**常量**仍被注册
 * （FIND/LOOK_POWER_CREEPS 等查询返回空集），但 `PowerCreep` 全局类不存在。
 * 原型挂载（prototype/PowerCreep）与 BetterMove 的移动包装在模块初始化期
 * 就会访问 `PowerCreep.prototype`，缺类会直接炸掉整个主循环。
 *
 * 这些服务器上 `Game.powerCreeps` 本身是空对象，占位类不会有任何实例化路径，
 * 仅保证 prototype 操作不抛 ReferenceError。
 */

const ensureGlobalClass = (name: string): void => {
    if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
        (globalThis as Record<string, unknown>)[name] = class Placeholder { };
    }
};

ensureGlobalClass('PowerCreep');



// race 服未实现的全局类一次性补桩（清单取自独立 bot profiler 的类表，
// ensureGlobalClass 只补缺失项，已实现的类不受影响）
const RACE_MISSING_GLOBAL_CANDIDATES = [
    'ConstructionSite',
    'Creep',
    'Deposit',
    'Flag',
    'global',
    'Mineral',
    'Nuke',
    'OwnedStructure',
    'PathFinder',
    'PowerCreep',
    'RawMemory',
    'Resource',
    'RoomObject',
    'RoomPosition',
    'RoomVisual',
    'Ruin',
    'Source',
    'Store',
    'Structure',
    'StructureContainer',
    'StructureController',
    'StructureExtension',
    'StructureExtractor',
    'StructureFactory',
    'StructureInvaderCore',
    'StructureKeeperLair',
    'StructureLab',
    'StructureLink',
    'StructureNuker',
    'StructureObserver',
    'StructurePortal',
    'StructurePowerBank',
    'StructurePowerSpawn',
    'StructureRampart',
    'StructureRoad',
    'StructureSpawn',
    'StructureStorage',
    'StructureTerminal',
    'StructureTower',
    'StructureWall',
    'Tombstone',
];
for (const name of RACE_MISSING_GLOBAL_CANDIDATES) {
    ensureGlobalClass(name);
}

// race 服未实现 Game.market.getHistory（市场历史）：空数组降级，市场侧按无历史数据运作
const compatGlobalAny = globalThis as Record<string, any>;
if (compatGlobalAny.Game?.market && typeof compatGlobalAny.Game.market.getHistory !== 'function') {
    compatGlobalAny.Game.market.getHistory = () => [];
}
// 市场其余缺失 API 一次性补齐（race 服无交易系统）：查询返回空、操作返回失败码，
// 市场侧按「无订单市场」降级，不再逐个爆 ReferenceError/TypeError
if (compatGlobalAny.Game?.market) {
    const compatMarket = compatGlobalAny.Game.market as Record<string, any>;
    const compatMarketStubs: Array<[string, (...args: unknown[]) => unknown]> = [
        ['getAllOrders', () => []],
        ['getOrderById', () => undefined],
        ['calcTransactionCost', () => 1],
        ['cancelOrder', () => -1],
        ['changeOrderPrice', () => -1],
        ['extendOrder', () => -1],
        ['createOrder', () => -1],
        ['deal', () => -6],
    ];
    for (const [name, fn] of compatMarketStubs) {
        if (typeof compatMarket[name] !== 'function') compatMarket[name] = fn;
    }
}

export {};
