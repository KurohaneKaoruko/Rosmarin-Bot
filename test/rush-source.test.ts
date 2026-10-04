/**
 * rush 编成公式桩测试：maxHarvestPower、maxCarryPower、min/haulerRatio、净收入、补位级联。
 * 游戏常量按官方文档真值打桩（REPAIR_COST=0.01、CONTAINER_DECAY=5000、TIME=100/OWNED=500）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './helpers/rushStubs';

// 常量在模块加载期读取游戏全局，需先于 import 打桩（真值取自游戏常量表）

import {
    accumulateHaulerAccounting,
    accumulateMinerAccounting,
    clamp,
    computeRemoteSourceIncome,
    computeSourceComposition,
    computeSourceIncome,
    getMaxHarvestPower,
    requestSourceWorkers,
} from '@/modules/rush/manageSource';
import { getBodyCost } from '@/modules/rush/creepUtils';
import { getRushRoomHeap, getRushTickState } from '@/modules/rush/roomState';
import { pretickSpawn, runSpawnManager } from '@/modules/rush/spawnManager';
import type { RushSourceInfo } from '@/modules/rush/types';

const g = globalThis as any;

const makeInfo = (overrides: Partial<RushSourceInfo> = {}): RushSourceInfo => ({
    sourceId: 'src1',
    roomName: 'W1N1',
    my: true,
    distance: 50,
    energyPerTick: 10,
    numOpen: 2,
    ...overrides,
});

const makeCreep = (overrides: any = {}): any => ({
    name: 'c1',
    memory: {},
    room: { name: 'W1N1' },
    body: [{ type: 'carry' }, { type: 'move' }],
    getActiveBodyparts: (part: string) =>
        overrides.body?.filter((p: any) => p.type === part).length ?? 0,
    ticksToLive: 1500,
    ...overrides,
});

const makeRoom = () => {
    const spawn = {
        name: 'S1',
        spawning: null,
        isActive: () => true,
        spawnCreep: vi.fn(() => 0),
        pos: { x: 25, y: 25, roomName: 'W1N1' },
    };
    const room = {
        name: 'W1N1',
        memory: (g.Memory.rooms['W1N1'] ||= {}),
        storage: undefined,
        energyAvailable: 600,
        energyCapacityAvailable: 800,
        controller: { level: 6 },
        find: vi.fn(() => [spawn]),
    } as any;
    return { room, spawn };
};

beforeEach(() => {
    g.Game = { time: 1000, creeps: {}, getObjectById: () => undefined };
    g.Memory = { creeps: {}, rooms: {} };
    g.BODYPART_COST = { move: 50, work: 100, carry: 50 };
    g.MAX_CREEP_SIZE = 50;
    g.CARRY_CAPACITY = 50;
    g.HARVEST_POWER = 2;
    g.CREEP_LIFE_TIME = 1500;
    g.CREEP_SPAWN_TIME = 3;
    g.BUILD_POWER = 5;
    g.WORK = 'work';
    g.CARRY = 'carry';
    g.MOVE = 'move';
    g.FIND_MY_SPAWNS = 1;
    g.OK = 0;
    g.ERR_NOT_ENOUGH_ENERGY = -6;
    g.ERR_NAME_EXISTS = -10;
    g.ERR_INVALID_TARGET = -2;
});

describe('采集力上限', () => {
    it('普通房型无容器 = 速率；有容器 +1；keeper +6', () => {
        expect(getMaxHarvestPower(10, 'normal', false)).toBe(10);
        expect(getMaxHarvestPower(10, 'normal', true)).toBe(11);
        expect(getMaxHarvestPower(10, 'keeper', false)).toBe(16);
    });
});

describe('净收入口径', () => {
    it('本矿未建容器：速率 − miner 折旧 − hauler 折旧 − 1', () => {
        const info = makeInfo();
        const income = computeSourceIncome(info, { constructed: false, linked: false });
        // maxWork = ⌈10/2⌉=5 → minerBody(10000,5,false) 造价 700
        const expected = 10 - 700 / (1500 - 50) - (10 * 50 * 0.04 * 100) / 1500 - 1;
        expect(income).toBeCloseTo(expected, 10);
    });

    it('本矿已建容器：损耗 0.1，hauler 折旧按 75 系数（采集力 +1 → maxWork=6 → 造价 800）', () => {
        const info = makeInfo();
        const income = computeSourceIncome(info, { constructed: true, linked: false });
        const expected = 10 - 800 / (1500 - 50) - (10 * 50 * 0.04 * 75) / 1500 - 0.1;
        expect(income).toBeCloseTo(expected, 10);
    });

    it('link 直供：hauler 折旧为 0', () => {
        const info = makeInfo();
        const income = computeSourceIncome(info, { constructed: false, linked: true });
        const expected = 10 - 700 / (1500 - 50) - 1;
        expect(income).toBeCloseTo(expected, 10);
    });

    it('外矿无预订：速率减半后核算', () => {
        const info = makeInfo({ my: false, type: 'normal' });
        const income = computeRemoteSourceIncome(info, { reserve: false, constructed: false });
        // 减半速率 5 → maxWork=⌈5/2⌉=3 → minerBody 移速先补 → 造价 400
        const expected = 5 - 400 / (1500 - 50) - (5 * 50 * 0.04 * 100) / 1500 - 1;
        expect(income).toBeCloseTo(expected, 10);
    });

    it('外矿有预订：速率全额', () => {
        const info = makeInfo({ my: false, type: 'normal' });
        const income = computeRemoteSourceIncome(info, { reserve: true, constructed: false });
        const expected = 10 - 700 / (1500 - 50) - (10 * 50 * 0.04 * 100) / 1500 - 1;
        expect(income).toBeCloseTo(expected, 10);
    });
});

describe('编成核算', () => {
    it('运力需求 = 2×距离×(速率−损耗)，link 归零', () => {
        const unlinked = computeSourceComposition(makeInfo(), 1000);
        expect(unlinked.maxCarryPower).toBeCloseTo(2 * 50 * (10 - 1), 10);

        const linked = computeSourceComposition(makeInfo({ linked: true }), 1000);
        expect(linked.maxCarryPower).toBe(0);
        // 无需求视为运力满足
        expect(linked.haulerRatio).toBe(1);
    });

    it('haulerRatio = clamp(剩余运力/需求运力)，剩余运力随 source 递减', () => {
        const r1 = computeSourceComposition(makeInfo(), 500);
        expect(r1.haulerRatio).toBeCloseTo(500 / 900, 10);
        expect(r1.carryPowerLeft).toBeCloseTo(500 - 900, 10);

        const r2 = computeSourceComposition(makeInfo({ sourceId: 'src2' }), r1.carryPowerLeft);
        expect(r2.haulerRatio).toBe(0);
    });

    it('minerRatio = clamp(在岗采集力/速率)', () => {
        expect(computeSourceComposition(makeInfo({ harvestPower: 0 }), 1000).minerRatio).toBe(0);
        expect(computeSourceComposition(makeInfo({ harvestPower: 5 }), 1000).minerRatio).toBe(0.5);
        expect(computeSourceComposition(makeInfo({ harvestPower: 30 }), 1000).minerRatio).toBe(1);
    });

    it('收入增量 = 净收入 × min(minerRatio, haulerRatio)，建造期记 0', () => {
        const info = makeInfo({ harvestPower: 5 });
        const r = computeSourceComposition(info, 1000);
        const net = computeSourceIncome(info, { constructed: false, linked: false });
        expect(r.incomeDelta).toBeCloseTo(net * 0.5, 10);

        const building = computeSourceComposition(
            makeInfo({ my: false, constructing: true, constructingIndex: 2, type: 'normal' }),
            1000,
        );
        expect(building.incomeDelta).toBe(0);
    });

    it('外矿修正：路面加成 ×9/8、积压 ×2、接力 ÷1.05', () => {
        const base = {
            my: false as const,
            type: 'normal' as const,
            distance: 10,
            energyPerTick: 10,
            reserved: true,
            numOpen: 1,
        };
        const plain = computeSourceComposition(makeInfo(base), 1000).maxCarryPower;
        const road = computeSourceComposition(makeInfo(base), 1000, { enoughRoad: true }).maxCarryPower;
        expect(road).toBeCloseTo(plain * (9 / 8), 10);

        const pending = computeSourceComposition(makeInfo({ ...base, lastPendingEnergy: 2000 }), 1000).maxCarryPower;
        expect(pending).toBeCloseTo(plain * 2, 10);

        const relay = computeSourceComposition(makeInfo(base), 1000, { shouldRelayFlag: true }).maxCarryPower;
        expect(relay).toBeCloseTo(plain / 1.05, 10);
    });

    it('clamp 边界', () => {
        expect(clamp(-1, 0, 1)).toBe(0);
        expect(clamp(0.5, 0, 1)).toBe(0.5);
        expect(clamp(2, 0, 1)).toBe(1);
    });
});

describe('记账口径', () => {
    it('miner 在岗：TTL 不足以覆盖孵化+路程+缓冲则不计入编制', () => {
        const info = makeInfo({ distance: 50 });
        accumulateMinerAccounting(
            info,
            makeCreep({
                ticksToLive: 1500,
                body: new Array(6).fill({ type: 'move' }),
                getActiveBodyparts: (p: string) => (p === 'work' ? 5 : 6),
            }),
            false,
        );
        expect(info.numMiner).toBe(1);
        expect(info.harvestPower).toBe(10);

        const short = makeInfo({ distance: 50 });
        accumulateMinerAccounting(
            short,
            makeCreep({
                ticksToLive: 3 * 4 + 50 + 10, // 恰好不足
                body: new Array(4).fill({ type: 'move' }),
                getActiveBodyparts: (p: string) => (p === 'work' ? 5 : 4),
            }),
            false,
        );
        expect(short.numMiner).toBeUndefined();
    });

    it('实际采集产出单独记账（harvestingPower）', () => {
        const info = makeInfo();
        accumulateMinerAccounting(
            info,
            makeCreep({
                body: new Array(6).fill({ type: 'move' }),
                getActiveBodyparts: (p: string) => (p === 'work' ? 5 : 6),
            }),
            true,
        );
        expect(info.harvestingPower).toBe(10);
    });

    it('hauler 运力 = CARRY 数 × 载量，TTL 不足一个孵化周期不计', () => {
        const ok = makeCreep({
            body: [{ type: 'carry' }, { type: 'carry' }, { type: 'move' }],
            getActiveBodyparts: (p: string) => (p === 'carry' ? 2 : 1),
        });
        expect(accumulateHaulerAccounting(ok)).toBe(100);

        const dying = makeCreep({
            ticksToLive: 5,
            body: [{ type: 'carry' }, { type: 'move' }],
            getActiveBodyparts: (p: string) => (p === 'carry' ? 1 : 1),
        });
        expect(accumulateHaulerAccounting(dying)).toBe(0);
    });
});

describe('补位级联', () => {
    it('双满足 → 不发单', () => {
        const { room, spawn } = makeRoom();
        pretickSpawn(room);
        const info = makeInfo({ maxHarvestPower: 11 });
        expect(requestSourceWorkers(room, info, 'src1', 1, 1)).toBe(false);
        runSpawnManager(room);
        expect(spawn.spawnCreep).not.toHaveBeenCalled();
    });

    it('minerRatio=0 → 发 miner 单（income=0 → 按现量口径，不超现量）', () => {
        const { room, spawn } = makeRoom();
        pretickSpawn(room);
        const info = makeInfo({ maxHarvestPower: 11 });
        expect(requestSourceWorkers(room, info, 'src1', 0, 1)).toBe(true);
        runSpawnManager(room);
        expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
        const [body] = spawn.spawnCreep.mock.calls[0];
        expect(getBodyCost(body)).toBeLessThanOrEqual(600);
    });

    it('haulerRatio=0（miner 在岗）→ 发 hauler 单（RCL<7 默认接力 → maxCarry=4 → 越野 4 组 8 部件）', () => {
        const { room, spawn } = makeRoom();
        pretickSpawn(room);
        const info = makeInfo({ maxHarvestPower: 11 });
        expect(requestSourceWorkers(room, info, 'src1', 1, 0)).toBe(true);
        runSpawnManager(room);
        expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
        const [body] = spawn.spawnCreep.mock.calls[0];
        expect(body).toHaveLength(8);
    });

    it('miner 缺但坑位已满（numMiner≥numOpen）且运力不够 → 补 hauler', () => {
        const { room, spawn } = makeRoom();
        pretickSpawn(room);
        const info = makeInfo({ maxHarvestPower: 11, numMiner: 2 });
        expect(requestSourceWorkers(room, info, 'src1', 0.5, 0.4)).toBe(true);
        runSpawnManager(room);
        const [body] = spawn.spawnCreep.mock.calls[0];
        expect(body.some((p: string) => p === 'work')).toBe(false);
    });

    it('haulerRatio < minerRatio（miner 坑位已满）→ 补 hauler', () => {
        const { room, spawn } = makeRoom();
        pretickSpawn(room);
        const info = makeInfo({ maxHarvestPower: 11, numMiner: 1, numOpen: 1 });
        expect(requestSourceWorkers(room, info, 'src1', 0.9, 0.5)).toBe(true);
        runSpawnManager(room);
        const [body] = spawn.spawnCreep.mock.calls[0];
        expect(body.some((p: string) => p === 'work')).toBe(false);
    });

    it('miner 缺且有未派岗 miner 闲量 → 就地派岗不发单', () => {
        const { room, spawn } = makeRoom();
        pretickSpawn(room);
        // preTick 后注入 roster（等价「在岗但未绑定 source」的 miner）
        getRushTickState(room).creeps['miner'] = [makeCreep({ memory: {} })];
        const info = makeInfo({ maxHarvestPower: 11 });
        expect(requestSourceWorkers(room, info, 'src1', 0, 1)).toBe(false);
        runSpawnManager(room);
        expect(spawn.spawnCreep).not.toHaveBeenCalled();
        expect(getRushTickState(room).creeps['miner'][0].memory.sourceId).toBe('src1');
    });

    it('收入>0 时 miner 按容量现算（体型可超现量）', () => {
        const { room, spawn } = makeRoom();
        pretickSpawn(room);
        room.energyAvailable = 300;
        getRushRoomHeap(room.name).income = 5;
        const info = makeInfo({ maxHarvestPower: 11 });
        requestSourceWorkers(room, info, 'src1', 0, 1);
        runSpawnManager(room);
        const [body] = spawn.spawnCreep.mock.calls[0];
        expect(getBodyCost(body)).toBeGreaterThan(300);
        expect(getBodyCost(body)).toBeLessThanOrEqual(800);
    });

    it('onlyIdler：只复用闲量，不发孵化单', () => {
        const { room, spawn } = makeRoom();
        pretickSpawn(room);
        const info = makeInfo({ maxHarvestPower: 11 });
        expect(requestSourceWorkers(room, info, 'src1', 0, 1, true)).toBe(false);
        runSpawnManager(room);
        expect(spawn.spawnCreep).not.toHaveBeenCalled();
    });
});
