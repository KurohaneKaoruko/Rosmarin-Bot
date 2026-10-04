/**
 * rush 测试共享桩。
 * 本模块被首个 import 时即在模块作用域打桩（先于依赖游戏全局的常量模块求值）；
 * 每个用例的运行时桩（Game/Memory/造价表等）仍由各文件的 beforeEach 负责。
 * 常量值取自游戏真值（结构与资源常量参与 BUILD_PRIORITY/请求表键匹配，值必须与线上一致）。
 */
const g = globalThis as any;

// 结构常量（真值：小写/驼峰名）
const STRUCTURES: Record<string, string> = {
    STRUCTURE_SPAWN: 'spawn',
    STRUCTURE_TOWER: 'tower',
    STRUCTURE_TERMINAL: 'terminal',
    STRUCTURE_STORAGE: 'storage',
    STRUCTURE_EXTENSION: 'extension',
    STRUCTURE_CONTAINER: 'container',
    STRUCTURE_LINK: 'link',
    STRUCTURE_ROAD: 'road',
    STRUCTURE_RAMPART: 'rampart',
    STRUCTURE_EXTRACTOR: 'extractor',
    STRUCTURE_LAB: 'lab',
    STRUCTURE_WALL: 'constructedWall',
    STRUCTURE_OBSERVER: 'observer',
    STRUCTURE_FACTORY: 'factory',
    STRUCTURE_POWER_SPAWN: 'powerSpawn',
    STRUCTURE_NUKER: 'nuker',
};

// 资源常量（真值：去前缀小写）
const RESOURCE_BASE = [
    'HYDROGEN', 'OXYGEN', 'UTRIUM', 'LEMERGIUM', 'KEANIUM', 'ZYNTHIUM', 'CATALYST', 'GHODIUM',
];
const RESOURCES: Record<string, string> = { RESOURCE_ENERGY: 'energy', RESOURCE_POWER: 'power' };
for (const base of RESOURCE_BASE) {
    RESOURCES[`RESOURCE_${base}`] = base.toLowerCase();
}
const RESOURCE_PRODUCTS: Record<string, string> = {
    HYDROXIDE: 'hydroxide',
    'UTRIUM_HYDRIDE': 'utrium_hydride',
    'LEMERGIUM_HYDRIDE': 'lemergium_hydride',
    'KEANIUM_HYDRIDE': 'keanium_hydride',
    'ZYNTHIUM_HYDRIDE': 'zynthium_hydride',
    'GHODIUM_HYDRIDE': 'ghodium_hydride',
    'UTRIUM_OXIDE': 'utrium_oxide',
    'LEMERGIUM_OXIDE': 'lemergium_oxide',
    'KEANIUM_OXIDE': 'keanium_oxide',
    'ZYNTHIUM_OXIDE': 'zynthium_oxide',
    'GHODIUM_OXIDE': 'ghodium_oxide',
    'UTRIUM_ACID': 'utrium_acid',
    'LEMERGIUM_ACID': 'lemergium_acid',
    'KEANIUM_ACID': 'keanium_acid',
    'ZYNTHIUM_ACID': 'zynthium_acid',
    'GHODIUM_ACID': 'ghodium_acid',
    'UTRIUM_ALKALIDE': 'utrium_alkalide',
    'LEMERGIUM_ALKALIDE': 'lemergium_alkalide',
    'KEANIUM_ALKALIDE': 'keanium_alkalide',
    'ZYNTHIUM_ALKALIDE': 'zynthium_alkalide',
    'GHODIUM_ALKALIDE': 'ghodium_alkalide',
    'CATALYZED_UTRIUM_ACID': 'catalyzed_utrium_acid',
    'CATALYZED_LEMERGIUM_ACID': 'catalyzed_lemergium_acid',
    'CATALYZED_KEANIUM_ACID': 'catalyzed_keanium_acid',
    'CATALYZED_ZYNTHIUM_ACID': 'catalyzed_zynthium_acid',
    'CATALYZED_GHODIUM_ACID': 'catalyzed_ghodium_acid',
    'CATALYZED_UTRIUM_ALKALIDE': 'catalyzed_utrium_alkalide',
    'CATALYZED_LEMERGIUM_ALKALIDE': 'catalyzed_lemergium_alkalide',
    'CATALYZED_KEANIUM_ALKALIDE': 'catalyzed_keanium_alkalide',
    'CATALYZED_ZYNTHIUM_ALKALIDE': 'catalyzed_zynthium_alkalide',
    'CATALYZED_GHODIUM_ALKALIDE': 'catalyzed_ghodium_alkalide',
};
for (const [k, v] of Object.entries(RESOURCE_PRODUCTS)) {
    RESOURCES[`RESOURCE_${k}`] = v;
}

// 商品类资源（真值：去前缀小写）
const COMMODITIES = [
    'ALLOY', 'BATTERY', 'BIOMASS', 'CELL', 'CIRCUIT', 'COMPOSITE', 'CONCENTRATE', 'CONDENSATE',
    'CRYSTAL', 'DEVICE', 'EMANATION', 'ESSENCE', 'EXTRACT', 'FIXTURES', 'FRAME', 'GHODIUM_MELT',
    'HYDRAULICS', 'KEANIUM_BAR', 'LEMERGIUM_BAR', 'LIQUID', 'MACHINE', 'METAL', 'MICROCHIP',
    'MIST', 'MUSCLE', 'ORGANISM', 'ORGANOID', 'OXIDANT', 'PHLEGM', 'PURIFIER', 'REDUCTANT',
    'SILICON', 'SPIRIT', 'SWITCH', 'TISSUE', 'TRANSISTOR', 'TUBE', 'UTRIUM_BAR', 'WIRE',
    'ZYNTHIUM_BAR',
];
for (const base of COMMODITIES) {
    RESOURCES[`RESOURCE_${base}`] = base.toLowerCase();
}

// 其余枚举（仅参与存在性比较，值用名字派生串）
const FLAGS: Record<string, string | number> = {};
for (const name of [
    'LOOK_CREEPS', 'LOOK_TOMBSTONES', 'LOOK_RESOURCES', 'LOOK_STRUCTURES', 'LOOK_ENERGY',
]) {
    FLAGS[name] = name.replace('LOOK_', '').toLowerCase();
}
for (const name of [
    'FIND_SOURCES', 'FIND_MY_SPAWNS', 'FIND_STRUCTURES', 'FIND_MY_CONSTRUCTION_SITES',
    'FIND_CONSTRUCTION_SITES', 'FIND_TOMBSTONES', 'FIND_RUINS', 'FIND_DROPPED_RESOURCES',
]) {
    FLAGS[name] = name;
}

const NUMBERS: Record<string, number> = {
    REPAIR_COST: 0.01,
    CONTAINER_DECAY: 5000,
    CONTAINER_DECAY_TIME: 100,
    CONTAINER_DECAY_TIME_OWNED: 500,
    CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD: 5000,
    CONTROLLER_MAX_UPGRADE_PER_TICK: 15,
    CARRY_CAPACITY: 50,
    HARVEST_POWER: 2,
    HARVEST_MINERAL_POWER: 1,
    BUILD_POWER: 5,
    ENERGY_REGEN_TIME: 300,
    SOURCE_ENERGY_CAPACITY: 3000,
    CREEP_LIFE_TIME: 1500,
    CREEP_SPAWN_TIME: 3,
    CREEP_CLAIM_LIFE_TIME: 500,
    MAX_CREEP_SIZE: 50,
    TERRAIN_MASK_WALL: 1,
};

for (const [k, v] of Object.entries(STRUCTURES)) g[k] = v;
for (const [k, v] of Object.entries(RESOURCES)) g[k] = v;
for (const [k, v] of Object.entries(FLAGS)) g[k] = v;
for (const [k, v] of Object.entries(NUMBERS)) g[k] = v;

// 数值表型常量（真值）
g.CONTROLLER_DOWNGRADE = { 1: 20000, 2: 10000, 3: 20000, 4: 40000, 5: 80000, 6: 120000, 7: 150000, 8: 200000 };
g.CONTROLLER_STRUCTURES = {};
g.CONTROLLER_LEVELS = {};
g.POWER_INFO = {};
g.PWR_REGEN_SOURCE = 'regenSource';
g.PWR_OPERATE_SPAWN = 'operateSpawn';
g.PWR_DISRUPT_SPAWN = 'disruptSpawn';

/** instanceof 判定用基类桩 */
g.Structure = class Structure {};
g.Creep = class Creep {};
g.Resource = class Resource {};
g.ConstructionSite = class ConstructionSite {};

export {};
