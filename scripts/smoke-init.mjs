/**
 * 冷启动初始化冒烟：vm 沙箱桩住 Screeps 全局后真实执行 dist/main.js 的
 * 全部模块顶层代码 + 一次 loop()。能检出 TDZ/循环导入/缺失符号/初始化抛错。
 * 用法: node scripts/smoke-init.mjs [dist/main.js]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import url from 'node:url';

const bundle = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', process.argv[2] ?? 'dist/main.js');
const code = fs.readFileSync(bundle, 'utf8');

// ── Screeps 全局桩 ──
class Stub {}
const fn = () => {};

// vm 上下文自己内建的 Error 属于另一个 realm：bot 里的 `err instanceof Error` 判否，
// 会把真实错误 JSON.stringify 成 {} → 冒烟只看得到空对象、定位不到真正抛错点。
// 用一个 hasInstance 放宽的 Error 顶上，让跨 realm 的错误也走「真实错误」分支。
class SandboxError extends Error {
    static [Symbol.hasInstance](value) {
        return value instanceof Error
            || (typeof value?.message === 'string' && typeof value?.stack === 'string');
    }
}
const COSTS = { work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, claim: 600, tough: 10 };

const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Math, Date, Map, Set, WeakMap, WeakSet, Promise, Symbol, Reflect, Proxy,
    Object, Array, String, Number, Boolean, Error: SandboxError, TypeError, RangeError, SyntaxError,
    Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array,
    ArrayBuffer, DataView, RegExp, isNaN, parseInt, parseFloat, structuredClone,
    performance: { now: () => Date.now() },
    process: { env: {}, exit: fn, nextTick: fn },
    Buffer,
    // 引擎对象
    Game: {
        time: 1000, cpu: { getUsed: () => 0, limit: 100, tickLimit: 500, bucket: 10000, getHeapStatistics: () => ({ total_heap_size: 0, used_heap_size: 0, heap_size_limit: 0, externally_allocated_size: 0 }) },
        creeps: {}, rooms: {}, spawns: {}, flags: {}, powerCreeps: {},
        map: { getRoomTerrain: () => ({ get: () => 0 }), getWorldSize: () => 62, describeExits: () => ({}) },
        market: { orders: {}, credits: 0, calcTransactionCost: () => 0 },
        shards: undefined,
        shard: { name: 'shard0', type: 'normal', ptr: false }, gcl: { level: 3, progress: 0, progressTotal: 1 },
        gpl: { level: 0, progress: 0, progressTotal: 1 }, resources: {},
        notify: fn,
    },
    Memory: {},
    // 工厂商品表：race 分支的 constant.js 在模块顶层读 COMMODITIES[energy].amount/components
    // （BATTERY_TO_ENERGY_MULTIPLIER），缺桩会让全大写兜底把它当字符串返回 → 顶层即抛。
    // 初始化期只求「形状对、不求值正确」，故给任意商品键一个通用记录。
    COMMODITIES: new Proxy({}, {
        get: (table, key) => (table[key] ??= { level: 0, amount: 10, components: {} }),
    }),
    RawMemory: {
        get: () => JSON.stringify(Memory ?? {}),
        set: fn, setActiveSegments: fn, setActiveForeignSegment: fn, setPublicSegments: fn,
        segments: {}, foreignSegment: {},
        _parsed: undefined,
    },
    InterShardMemory: { get: () => '', set: fn },
    PathFinder: { search: () => ({ path: [], cost: 0, incomplete: true }), CostMatrix: class { set() {} get() { return 0 } clone() { return this } },
        _useNextRoom: false },
    _: undefined, // 之后用最小 lodash 桩填
    // 类桩（原型补丁目标）
    Room: class Room { constructor(name) { this.name = name; } },
    Creep: class Creep { constructor() { this.body = []; } get pos() { return { x: 0, y: 0, roomName: '', getRangeTo: () => 1 }; } },
    PowerCreep: class PowerCreep {},
    Flag: class Flag {},
    RoomPosition: class RoomPosition { constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; } },
    RoomVisual: class RoomVisual { rect() {} line() {} text() {} poly() {} circle() {} clear() {} export() { return '' } import() { return this } },
    ConstructionSite: class ConstructionSite {},
    Resource: class Resource {},
    Source: class Source {},
    Mineral: class Mineral {},
    Deposit: class Deposit {},
    Nuke: class Nuke {},
    Ruin: class Ruin {},
    Tombstone: class Tombstone {},
    Structure: class Structure {},
    StructureSpawn: class StructureSpawn {},
    StructureExtension: class StructureExtension {},
    StructureContainer: class StructureContainer {},
    StructureStorage: class StructureStorage {},
    StructureTower: class StructureTower {},
    StructureLab: class StructureLab {},
    StructureLink: class StructureLink {},
    StructureTerminal: class StructureTerminal {},
    StructureRoad: class StructureRoad {},
    StructureRampart: class StructureRampart {},
    StructureWall: class StructureWall {},
    StructureController: class StructureController {},
    StructurePowerSpawn: class StructurePowerSpawn {},
    StructurePowerBank: class StructurePowerBank {},
    StructureObserver: class StructureObserver {},
    StructureNuker: class StructureNuker {},
    StructureFactory: class StructureFactory {},
    StructureKeeperLair: class StructureKeeperLair {},
    StructurePortal: class StructurePortal {},
    StructureExtractor: class StructureExtractor {},
};

// 常量：已知表给真值；未知全大写标识回退为键名（初始化期只求不抛，不求值正确）
const CONSTANTS = {
    OK: 0, ERR_NOT_OWNER: -1, ERR_NO_PATH: -2, ERR_NAME_EXISTS: -3, ERR_BUSY: -4,
    ERR_NOT_FOUND: -5, ERR_NOT_ENOUGH_ENERGY: -6, ERR_NOT_ENOUGH_RESOURCES: -6, ERR_INVALID_TARGET: -7,
    ERR_FULL: -8, ERR_NOT_IN_RANGE: -9, ERR_INVALID_ARGS: -10, ERR_TIRED: -11, ERR_NO_BODYPART: -12,
    ERR_NOT_ENOUGH_EXTENSIONS: -13, ERR_RCL_NOT_ENOUGH: -14, ERR_GCL_NOT_ENOUGH: -15,
    WORK: 'work', CARRY: 'carry', MOVE: 'move', ATTACK: 'attack', RANGED_ATTACK: 'ranged_attack',
    HEAL: 'heal', CLAIM: 'claim', TOUGH: 'tough',
    BODYPART_COST: COSTS, BODYPARTS_ALL: ['work', 'carry', 'move', 'attack', 'ranged_attack', 'heal', 'claim', 'tough'],
    CARRY_CAPACITY: 50, HARVEST_POWER: 2, REPAIR_POWER: 100, BUILD_POWER: 100, DISMANTLE_POWER: 50,
    HARVEST_COOLDOWN: 5, REPAIR_COOLDOWN: 0, ATTACK_POWER: 30, RANGED_ATTACK_POWER: 10,
    HEAL_POWER: 12, RANGED_HEAL_POWER: 4, DISMANTLE_COST: 0.005,
    MAX_CREEP_SIZE: 50, CREEP_LIFE_TIME: 1500, CREEP_SPAWN_TIME: 3, CREEP_CLAIM_LIFE_TIME: 500,
    CARRY_HARVEST_PARTS: 2,
    SOURCE_ENERGY_CAPACITY: 3000, SOURCE_ENERGY_NEUTRAL_CAPACITY: 1000, ENERGY_REGEN_TIME: 3000,
    ENERGY_DECAY: 1000,
    REPAIR_COST: 0.01, CONTAINER_DECAY: 5000, CONTAINER_DECAY_TIME: 100, CONTAINER_DECAY_TIME_OWNED: 500,
    CONTAINER_CAPACITY: 2000, NUKER_CAPACITY: 300000,
    TERRAIN_MASK_WALL: 1, TERRAIN_MASK_SWAMP: 2, TERRAIN_MASK_LAVA: 4,
    LOOK_CONSTRUCTION_SITES: 'constructionSite', LOOK_CREEPS: 'creep', LOOK_ENERGY: 'energy',
    LOOK_EXIT_TOP: 'exitTop', LOOK_EXIT_BOTTOM: 'exitBottom', LOOK_EXIT_LEFT: 'exitLeft', LOOK_EXIT_RIGHT: 'exitRight',
    LOOK_EXIT: 'exit', LOOK_FLAGS: 'flag', LOOK_MINERALS: 'mineral', LOOK_NUKES: 'nuke',
    LOOK_RESOURCES: 'resource', LOOK_SOURCES: 'source', LOOK_STRUCTURES: 'structure', LOOK_TERRAIN: 'terrain',
    LOOK_TOMBSTONES: 'tombstone', LOOK_RUINS: 'ruin', LOOK_POWER_CREEPS: 'powerCreep',
    FIND_EXIT_TOP: 1, FIND_EXIT_RIGHT: 3, FIND_EXIT_BOTTOM: 5, FIND_EXIT_LEFT: 7, FIND_EXIT: 10,
    FIND_CREEPS: 101, FIND_MY_CREEPS: 102, FIND_HOSTILE_CREEPS: 103,
    FIND_SOURCES_ACTIVE: 104, FIND_SOURCES: 105,
    FIND_DROPPED_RESOURCES: 106, FIND_STRUCTURES: 107, FIND_MY_STRUCTURES: 108,
    FIND_HOSTILE_STRUCTURES: 109, FIND_FLAGS: 110, FIND_CONSTRUCTION_SITES: 111,
    FIND_MY_SPAWNS: 112, FIND_HOSTILE_SPAWNS: 113, FIND_MINERALS: 115, FIND_DEPOSITS: 116,
    FIND_TOMBSTONES: 117, FIND_RUINS: 118, FIND_POWER_CREEPS: 119, FIND_NUKES: 120,
    STRUCTURE_EXTENSION: 'extension', STRUCTURE_RAMPART: 'rampart', STRUCTURE_ROAD: 'road',
    STRUCTURE_SPAWN: 'spawn', STRUCTURE_LINK: 'link', STRUCTURE_TOWER: 'tower',
    STRUCTURE_STORAGE: 'storage', STRUCTURE_OBSERVER: 'observer', STRUCTURE_POWER_SPAWN: 'powerSpawn',
    STRUCTURE_EXTRACTOR: 'extractor', STRUCTURE_LAB: 'lab', STRUCTURE_TERMINAL: 'terminal',
    STRUCTURE_CONTAINER: 'container', STRUCTURE_NUKER: 'nuker', STRUCTURE_FACTORY: 'factory',
    STRUCTURE_KEEPER_LAIR: 'keeperLair', STRUCTURE_CONTROLLER: 'controller',
    STRUCTURE_POWER_BANK: 'powerBank', STRUCTURE_PORTAL: 'portal', STRUCTURE_WALL: 'constructedWall',
    RESOURCE_ENERGY: 'energy', RESOURCE_POWER: 'power', RESOURCE_OPS: 'ops',
    COLOR_RED: 1, COLOR_PURPLE: 2, COLOR_BLUE: 3, COLOR_CYAN: 4, COLOR_GREEN: 5,
    COLOR_YELLOW: 6, COLOR_ORANGE: 7, COLOR_BROWN: 8, COLOR_GREY: 9, COLOR_WHITE: 10,
    PWR_REGEN_SOURCE: 'regenSource', PWR_OPERATE_SPAWN: 'operateSpawn', PWR_DISRUPT_SPAWN: 'disruptSpawn',
    POWER_INFO: {}, POWER_LEVELS: {},
    MODE_SIMULATION: 'simulation', MODE_SURVIVAL: 'survival', MODE_WORLD: 'world', MODE_ARENA: 'arena',
    TERMINAL_CAPACITY: 300000, STORAGE_CAPACITY: 1000000, LAB_REACTION_AMOUNT: 5,
    CONTROLLER_DOWNGRADE: { 1: 20000, 2: 10000, 3: 20000, 4: 40000, 5: 80000, 6: 120000, 7: 150000, 8: 200000 },
    CONTROLLER_LEVELS: { 1: 200, 2: 45000, 3: 135000, 4: 405000, 5: 1215000, 6: 3645000, 7: 10935000, 8: 32805000 },
    CONTROLLER_CLAIM_DOWNGRADE: 300, CONTROLLER_RESERVE: 1, CONTROLLER_MAX_UPGRADE_PER_TICK: 200,
    CONTROLLER_ATTACK_BLOCKED_UPGRADE: 1000, CONTROLLER_NUKE_BLOCKED_UPGRADE: 200,
    SAFE_MODE_DURATION: 20000, SAFE_MODE_COOLDOWN: 50000, SAFE_MODE_COST: 1000,
    OWNER_TIER: 8, WALL_HITS: 1, WALL_HITS_MAX: 300000000, RAMPART_DECAY_AMOUNT: 0,
    RAMPART_DECAY_TIME: 100, RAMPART_HITS: 1, RAMPART_HITS_MAX: 300000000,
    REPAIRER_HITS_MAX: 1000, ROAD_WEAR_OUT: 1, ROAD_DECAY_AMOUNT: 0, ROAD_DECAY_TIME: 1000,
    MINERAL_REGEN_TIME: 50000, MINERAL_MIN_AMOUNT: 35000,
    DEPOSIT_EXPIRATION: 50000, DEPOSIT_CAPACITY: 5000,
    TOMBSTONE_DECAY_PER_PART: 5, RUIN_DECAY: 10,
    POWER_BANK_CAPACITY_MAX: 5000, POWER_BANK_CAPACITY_MIN: 100, POWER_BANK_DECAY: 5000,
    POWER_BANK_HITS: 2000000, POWER_BANK_RESERVE: 20,
    SPAWN_RENEW_RATIO: 1.03, SPAWN_ENERGY_START: 300, SPAWN_ENERGY_CAPACITY: 300,
    CREEP_START_ENERGY: 300, UPGRADE_CONTROLLER_POWER: 100,
    TRANSFER_COST: 0.1, MIN_CREEP_SIZE: 1,
    BODYPART_HITS: 100,
};
// PWR_*/OBSERVER 等：常量兜底在 get 里
const constantFallback = (name) => {
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) return name; // 全大写常量回退为键名（初始化期只求不抛）
    return undefined;
};

// 最小 lodash 桩（覆盖本仓用到的方法；不足处显式抛错便于发现）
const _ = {
    assign: Object.assign,
    cloneDeep: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
    merge: Object.assign,
    keys: Object.keys,
    values: Object.values,
    entries: Object.entries,
    forEach: (coll, iter) => (Array.isArray(coll) ? coll.forEach(iter) : Object.entries(coll ?? {}).forEach(([k, v]) => iter(v, k))),
    each: function (coll, iter) { return this.forEach(coll, iter); },
    map: (coll, iter) => (Array.isArray(coll) ? coll.map(iter) : Object.entries(coll ?? {}).map(([k, v]) => iter(v, k))),
    filter: (coll, iter) => (Array.isArray(coll) ? coll.filter(iter) : []),
    find: (coll, iter) => (Array.isArray(coll) ? coll.find(iter) : undefined),
    some: (coll, iter) => (Array.isArray(coll) ? coll.some(iter) : false),
    every: (coll, iter) => (Array.isArray(coll) ? coll.every(iter) : true),
    sortBy: (coll, iter) => [...coll].sort(() => 0),
    orderBy: (coll) => [...coll],
    isEqual: (a, b) => a === b,
    get: (o, k, d) => (o?.[k] ?? d),
    set: (o, k, v) => { o[k] = v; return o; },
    max: (a) => (a.length ? Math.max(...a) : undefined),
    min: (a) => (a.length ? Math.min(...a) : undefined),
    sum: (a) => a.reduce((x, y) => x + y, 0),
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    chunk: (a, n) => (a.length ? [a] : []),
    uniq: (a) => [...new Set(a)],
    flatten: (a) => a.flat(),
    first: (a) => a[0],
    isUndefined: (v) => v === undefined,
    isString: (v) => typeof v === 'string',
    isNumber: (v) => typeof v === 'number',
    isObject: (v) => typeof v === 'object' && v !== null,
    isArray: Array.isArray,
    isFunction: (v) => typeof v === 'function',
    range: (a, b) => (b === undefined ? [...Array(a).keys()] : Array.from({ length: b - a }, (_, i) => a + i)),
    sample: (a) => a[0],
    size: (v) => (v?.length ?? Object.keys(v ?? {}).length),
};
sandbox._ = _;

// 全大写常量兜底：get 不到时回退键名
const constFallbackProxy = new Proxy(sandbox, {
    get(target, prop) {
        if (prop in target) return target[prop];
        return constantFallback(prop);
    },
    has() { return true; },
});

// global 自引用 + CJS 导出面（bundle 为 CJS，loop 经 module.exports 暴露）
sandbox.global = constFallbackProxy;
sandbox.globalThis = constFallbackProxy;
sandbox.module = { exports: {} };
sandbox.exports = sandbox.module.exports;

// ── 可选：模拟 xxscreeps 固化的 Room.prototype.memory ──
// xxscreeps 用 `extend(Room, {memory:{get,set}})` 挂载，descriptor 未设 configurable
// → 默认 false，玩家无法覆盖该访问器（会抛 Cannot redefine property: memory）。
// 开启 SMOKE_XXSCREEPS 复现该环境，验证降级路径。
if (process.env.SMOKE_XXSCREEPS) {
    Object.defineProperty(sandbox.Room.prototype, 'memory', {
        get() { return ((sandbox.Memory.rooms ??= {})[this.name] ??= {}); },
        set(value) { (sandbox.Memory.rooms ??= {})[this.name] ??= value; },
    });
    console.log('  · 已注入 xxscreeps 式不可配置 Room.prototype.memory');
}

// ── 执行 ──
let failures = 0;
const step = (name, fn) => {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (error) {
        failures++;
        console.log(`  ✗ ${name}: ${error?.message?.split('\n')[0]}`);
        if (process.env.SMOKE_VERBOSE) console.log(error?.stack?.split('\n').slice(0, 6).join('\n'));
    }
};

console.log(`冷启动冒烟: ${bundle} (${(code.length / 1024).toFixed(0)}KB)`);

step('模块顶层初始化（全部 import 闭包求值）', () => {
    const script = new vm.Script(code, { filename: 'main.js' });
    script.runInContext(vm.createContext(constFallbackProxy));
});

const exportsOf = () => sandbox.module.exports ?? {};

step('loop() 空世界单次执行', () => {
    const loop = exportsOf().loop;
    if (typeof loop !== 'function') throw new Error('loop 未导出');
    loop();
});

step('loop() 连续 5 tick（Game.time 推进）', () => {
    const loop = exportsOf().loop;
    for (let i = 0; i < 5; i++) {
        sandbox.Game.time++;
        loop();
    }
});

if (!process.argv.includes('--skip-roommem')) {
    if (process.env.SMOKE_XXSCREEPS) {
        step('xxscreeps 式不可配置 Room.prototype.memory 下模块正常加载', () => {
            const RoomCtor = sandbox.Room;
            const desc = Object.getOwnPropertyDescriptor(RoomCtor.prototype, 'memory');
            if (!desc || desc.configurable) throw new Error('服务器访问器应保持不可配置、未被 bot 改写');
            const room = new RoomCtor('W1N1');
            room.memory = { probe: 1 };
            const engine = sandbox.Memory?.rooms?.W1N1;
            if (!engine || engine.probe !== 1) throw new Error('room.memory 未落到引擎通道 Memory.rooms');
            const bot = sandbox.Memory?.RosmarinBot?.roomMem;
            if (bot && Object.keys(bot).length > 0) throw new Error('房间记忆不应再写入 RosmarinBot.roomMem');
        });
    } else {
        step('Room.memory 保持引擎通道（bot 未改写原型）', () => {
            const desc = Object.getOwnPropertyDescriptor(sandbox.Room.prototype, 'memory');
            if (desc) throw new Error('bot 不应在 Room.prototype 上定义 memory');
            const bot = sandbox.Memory?.RosmarinBot?.roomMem;
            if (bot && Object.keys(bot).length > 0) throw new Error('房间记忆不应再写入 RosmarinBot.roomMem');
        });
    }
}

if (failures > 0) {
    console.error(`\n冒烟失败: ${failures} 项`);
    process.exit(1);
}
console.log('\n冷启动冒烟通过：模块初始化 / loop 执行 / RosmarinBot 通道全部正常');
