/**
 * rush 升级预算桩测试：收入×反馈系数、容量/几何上限、urgent 切档、缺口半身位门。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './helpers/rushStubs';


import { getEnergyLevel, getMaxWork, getUpgradeEnergyDepot, manageUpgradeSpawn, shouldUpgradeFirst } from '@/modules/rush/manageUpgrade';
import { getRushRoomHeap, getRushTickState } from '@/modules/rush/roomState';
import { pretickSpawn, runSpawnManager } from '@/modules/rush/spawnManager';

const g = globalThis as any;

const makeSpawn = (result = 0) => ({
    name: 'S1',
    spawning: null,
    isActive: () => true,
    spawnCreep: vi.fn(() => result),
    pos: { x: 25, y: 25, roomName: 'W1N1' },
});

const makeRoom = () => {
    const spawn = makeSpawn();
    const room = {
        name: 'W1N1',
        memory: (g.Memory.rooms['W1N1'] ||= {}),
        storage: undefined,
        terminal: undefined,
        energyAvailable: 800,
        energyCapacityAvailable: 800,
        controller: { level: 4, ticksToDowngrade: 100000, pos: { x: 25, y: 30, roomName: 'W1N1' } },
        findPath: vi.fn(() => [{ x: 25, y: 29 }, { x: 25, y: 30 }]),
        find: vi.fn((type: number, opts?: any) =>
            type === g.FIND_MY_SPAWNS ? [spawn] : type === g.FIND_STRUCTURES ? [] : [],
        ),
    } as any;
    return { room, spawn };
};

beforeEach(() => {
    g.Game = { time: 1000, creeps: {}, map: { getRoomTerrain: () => ({ get: () => 0 }) }, getObjectById: () => undefined };
    g.Memory = { creeps: {}, rooms: {} };
    g.BODYPART_COST = { move: 50, work: 100, carry: 50 };
    g.MAX_CREEP_SIZE = 50;
    g.CARRY_CAPACITY = 50;
    g.HARVEST_POWER = 2;
    g.CREEP_LIFE_TIME = 1500;
    g.CREEP_SPAWN_TIME = 3;
    g.WORK = 'work';
    g.CARRY = 'carry';
    g.MOVE = 'move';
    g.FIND_MY_SPAWNS = 1;
    g.FIND_STRUCTURES = 2;
    g.OK = 0;
    g.ERR_NOT_ENOUGH_ENERGY = -6;
    g.ERR_NAME_EXISTS = -10;
    g.ERR_INVALID_TARGET = -2;
    g.TERRAIN_MASK_WALL = 1;
    g.RESOURCE_ENERGY = 'energy';
    g.LOOK_RESOURCES = 'resource';
    g.PWR_REGEN_SOURCE = 'regenSource';
    g.POWER_INFO = {};
    g.PathFinder = {
        search: () => ({ path: [{ x: 25, y: 29 }, { x: 25, y: 30 }], ops: 0, cost: 0, incomplete: false }),
    };
});

describe('能量水位', () => {
    it('低于标准：按比例 0~100', () => {
        const { room } = makeRoom();
        room.controller.level = 4; // 标准 20000
        room.storage = { store: { energy: 10000 } } as any;
        room.find = vi.fn(() => []);
        expect(getEnergyLevel(room)).toBe(50);
    });

    it('超标准：100 + 每 1500 记 1', () => {
        const { room } = makeRoom();
        room.controller.level = 4;
        const store = { energy: 20000 + 3000 };
        room.storage = { store };
        expect(getEnergyLevel(room)).toBe(102);
    });
});

describe('升级预算', () => {
    it('RCL1 固定 5', () => {
        const { room } = makeRoom();
        room.controller.level = 1;
        expect(getMaxWork(room)).toBe(5);
    });

    it('无仓期：预算 = floor(收入 × clamp(spawnBalance/2+0.8, 1, 1.2))，封顶 90', () => {
        const { room } = makeRoom();
        room.controller.level = 4;
        room.memory.spawnBalance = 1; // 系数 = 1.3 → clamp 1.2
        getRushRoomHeap(room.name).income = 100;
        expect(getMaxWork(room)).toBe(90); // 120 → 上限 90

        getRushTickState(room).maxWork = undefined;
        room.memory.spawnBalance = 0.4; // 系数 = 1.0
        expect(getMaxWork(room)).toBe(90); // 收入 100 × 1.0 → 上限 90

        getRushTickState(room).maxWork = undefined;
        getRushRoomHeap(room.name).income = 50;
        expect(getMaxWork(room)).toBe(50);

        // 减码方向：spawnBalance −1 → 系数 clamp 1 → floor(50)
        getRushTickState(room).maxWork = undefined;
        room.memory.spawnBalance = -1;
        expect(getMaxWork(room)).toBe(50);
    });

    it('upgradeNeeded 期下限 5（收入归零不熄火）', () => {
        const { room } = makeRoom();
        room.controller.level = 4;
        room.memory.upgradeNeeded = true;
        getRushRoomHeap(room.name).income = 0;
        expect(getMaxWork(room)).toBe(5);
    });

    it('有仓期（storage）：水位 <90 按 收入×水位% ，90~120 按收入，>120 加码', () => {
        const { room } = makeRoom();
        room.controller.level = 5;
        room.storage = { store: { energy: 0 } } as any;

        room.find = vi.fn(() => []);
        getRushRoomHeap(room.name).income = 20;

        // 水位 25（storage 10000 / 标准 40000）
        room.storage.store.energy = 10000;
        getRushTickState(room).energyLevel = undefined;
        getRushTickState(room).maxWork = undefined;
        expect(getMaxWork(room)).toBe(Math.ceil((20 * 25) / 100)); // 5

        room.storage.store.energy = 60000; // 水位 = 100 + round(20000/1500) = 113
        getRushTickState(room).energyLevel = undefined;
        getRushTickState(room).maxWork = undefined;
        expect(getMaxWork(room)).toBe(20);

        room.storage.store.energy = 100000; // 水位 = 100 + round(60000/1500) = 140 > 120
        getRushTickState(room).energyLevel = undefined;
        getRushTickState(room).maxWork = undefined;
        expect(getMaxWork(room)).toBe(Math.ceil(20 + 140 - 90)); // 70
    });

    it('有 terminal：预算 = clamp(水位−90, 下限, 上限)', () => {
        const { room } = makeRoom();
        room.controller.level = 5;
        room.terminal = { store: { energy: 45000 } } as any; // 标准 40000 → 水位 103
        room.find = vi.fn(() => []);
        getRushRoomHeap(room.name).income = 100;
        expect(getMaxWork(room)).toBe(13); // 103−90
    });
});

describe('TTD 切档门', () => {
    it('TTD < 半阈值−safemode+buffer → shouldUpgradeFirst', () => {
        const { room } = makeRoom();
        room.controller.level = 4; // 阈值 40000 → 半 20000 − 5000 = 15000
        room.controller.ticksToDowngrade = 16000;
        expect(shouldUpgradeFirst(room)).toBe(true);

        // 默认 buffer 1500 → 门线 16500：15500 未踩线
        room.controller.ticksToDowngrade = 15500;
        expect(shouldUpgradeFirst(room)).toBe(true);
        // buffer 收紧到 100 → 门线 15100：15500 在线外
        expect(shouldUpgradeFirst(room, 100)).toBe(false);
    });
});

describe('升级取能点顺序', () => {
    it('link > 容器位掉落 > 容器', () => {
        const { room } = makeRoom();
        const container = { id: 'cc1', pos: { x: 25, y: 30, roomName: 'W1N1' }, store: { getUsedCapacity: () => 500 } };
        const dropped = { resourceType: 'energy', amount: 300 };
        const link = { id: 'link1' };

        let droppedList: any[] = [];
        container.pos.lookFor = () => droppedList;

        // 无 link 无掉落无容器 → undefined
        expect(getUpgradeEnergyDepot(room)).toBeUndefined();

        // 有容器
        getRushRoomHeap('W1N1').controllerContainerId = 'cc1';
        g.Game.getObjectById = (id: string) => (id === 'cc1' ? container : id === 'link1' ? link : undefined);
        expect(getUpgradeEnergyDepot(room)).toBe(container);

        // 容器位有掉落 → 掉落优先
        droppedList = [dropped];
        expect(getUpgradeEnergyDepot(room)).toBe(dropped);

        // 有 link → 最优先
        getRushRoomHeap('W1N1').controllerLinkId = 'link1';
        expect(getUpgradeEnergyDepot(room)).toBe(link);
    });
});

describe('升级单发放', () => {
    const creepOf = (work: number, ttl = 1500): any => ({
        name: `u${work}_${ttl}`,
        memory: { role: 'upgrader' },
        room: { name: 'W1N1' },
        body: new Array(work + 1).fill({ type: 'work' }),
        getActiveBodyparts: (p: string) => (p === 'work' ? work : 0),
        ticksToLive: ttl,
    });

    it('加码场景：收入高、spawnBalance 加码 → 预算升，发 upgradePreference（urgent）', () => {
        const { room, spawn } = makeRoom();
        room.controller.level = 4;
        pretickSpawn(room);
        room.memory.spawnBalance = 1;
        getRushRoomHeap(room.name).income = 30; // 收入 30 > numWork 0 → urgent
        getRushTickState(room).maxWork = undefined;

        manageUpgradeSpawn(room, [], []);

        expect(spawn.spawnCreep).toHaveBeenCalledTimes(0);
        // urgent → 任务类型 upgradePreference
        expect(getRushTickState(room).spawnQueue.toArray()[0].taskType).toBe('upgradePreference');
        runSpawnManager(room);
        expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
        expect(spawn.spawnCreep.mock.calls[0][2].memory.role).toBe('upgrader');
    });

    it('减码场景：spawnBalance 减码 + 缺口小于半个 body → 不发单', () => {
        const { room, spawn } = makeRoom();
        room.controller.level = 4;
        pretickSpawn(room);
        room.memory.spawnBalance = -1; // 系数 clamp 1
        getRushRoomHeap(room.name).income = 8; // 预算 8
        getRushTickState(room).maxWork = undefined;

        // 在岗 6 work → 缺口 2；body（容量 800，ratio 1）work 数 ≥ 4 → 2×2 < work 数 → 门拦截
        const upgraders = [creepOf(6)];
        manageUpgradeSpawn(room, upgraders, []);

        expect(spawn.spawnCreep).not.toHaveBeenCalled();
    });

    it('切档场景：TTD 过半 → upgradeNeeded → 任务类型切 preventDowngrade（且解锁下限 5）', () => {
        const { room, spawn } = makeRoom();
        room.controller.level = 4;
        pretickSpawn(room);
        room.controller.ticksToDowngrade = 14000; // < 15000 → upgradeNeeded
        getRushRoomHeap(room.name).income = 0; // 收入 0：无 needed 时预算 0
        getRushTickState(room).maxWork = undefined;

        manageUpgradeSpawn(room, [], []);

        expect(room.memory.upgradeNeeded).toBe(true);
        expect(getRushTickState(room).spawnQueue.toArray()[0].taskType).toBe('preventDowngrade');
        runSpawnManager(room);
        expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
    });

    it('building 态且非 needed：冻结（controllerNumCarry 归零、不发单）', () => {
        const { room, spawn } = makeRoom();
        room.controller.level = 4;
        pretickSpawn(room);
        room.memory.building = true;
        getRushRoomHeap(room.name).income = 50;

        manageUpgradeSpawn(room, [], []);

        expect(room.memory.controllerNumCarry).toBe(0);
        expect(spawn.spawnCreep).not.toHaveBeenCalled();
    });

    it('有 WORK+CARRY 的 idler 直接转职顶缺口，不发单', () => {
        const { room, spawn } = makeRoom();
        room.controller.level = 4;
        pretickSpawn(room);
        getRushRoomHeap(room.name).income = 6;
        getRushTickState(room).maxWork = undefined;

        const idler = {
            name: 'i1',
            memory: { role: 'idler' },
            room: { name: 'W1N1' },
            body: [{ type: 'work' }, { type: 'carry' }],
            getActiveBodyparts: (p: string) => (p === 'work' ? 1 : p === 'carry' ? 1 : 0),
            ticksToLive: 1500,
        };
        getRushTickState(room).creeps['idler'] = [idler];

        // 预算 7（收入 6 × 系数上限 1.2），在岗 0：idler 带 1 work，转职后 workNeeded 6 >0 → 仍会发单补
        manageUpgradeSpawn(room, [], []);
        expect(idler.memory.role).toBe('upgrader');
        runSpawnManager(room);
        expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
    });

    it('emergency：numWork 归零且不发单', () => {
        const { room, spawn } = makeRoom();
        room.controller.level = 4;
        pretickSpawn(room);
        room.memory.emergency = true;

        manageUpgradeSpawn(room, [creepOf(5)], []);

        expect(room.memory.numWork).toBe(0);
        expect(spawn.spawnCreep).not.toHaveBeenCalled();
    });
});
