/**
 * rush 建造态桩测试：building 进出门控（rampart 迟滞）、upgradeNeeded 强制退建、
 * builder 转职（闲量/upgrader）、emergency 冻结、共享 numWork 记账、优先目标选择。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './helpers/rushStubs';


import {
    getPriorityTargets,
    getRampartHitsMin,
    manageBuildSpawn,
    manageBuildState,
} from '@/modules/rush/manageBuild';
import { getRushRoomHeap, getRushTickState } from '@/modules/rush/roomState';
import { pretickSpawn, runSpawnManager } from '@/modules/rush/spawnManager';

const g = globalThis as any;

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
        terminal: undefined,
        energyAvailable: 800,
        energyCapacityAvailable: 800,
        controller: { level: 4, ticksToDowngrade: 100000 },
        find: vi.fn((type: number) => (type === g.FIND_MY_SPAWNS ? [spawn] : [])),
    } as any;
    return { room, spawn };
};

const siteOf = (structureType: string, id = `${structureType}Site`): any => ({
    id,
    structureType,
    progress: 0,
    pos: { x: 30, y: 30, roomName: 'W1N1' },
});

const rampartOf = (hits: number): any => ({ hits, structureType: 'rampart' });

const creepOf = (work: number, carry: number, role: string, ttl = 1500): any => ({
    name: `${role}_${work}_${carry}`,
    memory: { role },
    room: { name: 'W1N1' },
    body: new Array(work + carry).fill({ type: 'work' }),
    getActiveBodyparts: (p: string) => (p === 'work' ? work : p === 'carry' ? carry : 0),
    ticksToLive: ttl,
});

beforeEach(() => {
    g.Game = { time: 1000, creeps: {}, gcl: { level: 4 } };
    g.Memory = { creeps: {}, rooms: {} };
    g.BODYPART_COST = { move: 50, work: 100, carry: 50, claim: 600 };
    g.MAX_CREEP_SIZE = 50;
    g.CARRY_CAPACITY = 50;
    g.HARVEST_POWER = 2;
    g.CREEP_LIFE_TIME = 1500;
    g.CREEP_SPAWN_TIME = 3;
    g.WORK = 'work';
    g.CARRY = 'carry';
    g.MOVE = 'move';
    g.FIND_MY_SPAWNS = 1;
    g.FIND_MY_CONSTRUCTION_SITES = 3;
    g.FIND_STRUCTURES = 2;
    g.OK = 0;
    g.ERR_NOT_ENOUGH_ENERGY = -6;
    g.ERR_NAME_EXISTS = -10;
    g.ERR_INVALID_TARGET = -2;
    g.RESOURCE_ENERGY = 'energy';
    g.CLAIM = 'claim';
});

describe('building 态机', () => {
    it('有工地且非防降级 → 进入 building', () => {
        const { room } = makeRoom();
        manageBuildState(room, [], [siteOf('extension')], []);
        expect(room.memory.building).toBe(true);
    });

    it('双清退出：记录 lastBuildTime、builder 回闲量', () => {
        const { room } = makeRoom();
        room.memory.building = true;
        const builder = creepOf(2, 2, 'builder');
        manageBuildState(room, [builder], [], []);
        expect(room.memory.building).toBe(false);
        expect(room.memory.lastBuildTime).toBe(g.Game.time);
        expect(builder.memory).toEqual({});
    });

    it('upgradeNeeded 强制退出（即使仍有工地）', () => {
        const { room } = makeRoom();
        room.memory.building = true;
        room.memory.upgradeNeeded = true;
        manageBuildState(room, [], [siteOf('extension')], []);
        expect(room.memory.building).toBe(false);
    });

    it('rampart 迟滞：building 态阈值全档，非 building 态阈值半档', () => {
        const { room } = makeRoom();
        // gcl 4 → hitsMin = 100000
        expect(getRampartHitsMin()).toBe(100000);

        // 非建筑态：半档 50000 —— hits 60000 不触发进入
        manageBuildState(room, [], [], [rampartOf(60000)]);
        expect(room.memory.building).toBeUndefined();

        // hits 40000 < 半档 → 进入
        manageBuildState(room, [], [], [rampartOf(40000)]);
        expect(room.memory.building).toBe(true);

        // 建筑态：全档 100000 —— hits 60000 仍保持
        manageBuildState(room, [], [], [rampartOf(60000)]);
        expect(room.memory.building).toBe(true);
    });
});

describe('builder 发放', () => {
    it('共享记账：builder 火力 = work×4 计入 numWork', () => {
        const { room } = makeRoom();
        room.memory.building = true;
        room.memory.numWork = 10; // 升级侧已计入
        pretickSpawn(room);
        room.memory.emergency = true; // 记账后冻结，便于观察 numWork
        manageBuildSpawn(room, [creepOf(3, 2, 'builder')]);
        expect(room.memory.numWork).toBe(10 + 12);
    });

    it('emergency：记账后冻结不发单', () => {
        const { room, spawn } = makeRoom();
        room.memory.building = true;
        pretickSpawn(room);
        room.memory.emergency = true;
        manageBuildSpawn(room, [creepOf(2, 2, 'builder')]);
        expect(spawn.spawnCreep).not.toHaveBeenCalled();
    });

    it('缺口打包：预算 > 在岗火力 → 发 BUILD 单', () => {
        const { room, spawn } = makeRoom();
        room.memory.building = true;
        pretickSpawn(room);
        getRushRoomHeap(room.name).income = 20;
        getRushTickState(room).maxWork = undefined;

        manageBuildSpawn(room, []);

        expect(getRushTickState(room).spawnQueue.toArray()[0].taskType).toBe('build');
        runSpawnManager(room);
        expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
    });

    it('upgrader 转职：work>0 且 2×carry≥work → 转 builder 顶缺口', () => {
        const { room, spawn } = makeRoom();
        room.memory.building = true;
        pretickSpawn(room);
        getRushRoomHeap(room.name).income = 4;
        getRushTickState(room).maxWork = undefined;

        const upgrader = creepOf(2, 4, 'upgrader');
        getRushTickState(room).creeps['upgrader'] = [upgrader];
        getRushTickState(room).creeps['idler'] = [];

        // 预算 4 → workNeeded 4；upgrader 2 work × 4 = 8 ≥ 4 → 转职后补齐，不发单
        manageBuildSpawn(room, []);
        expect(upgrader.memory.role).toBe('builder');
        expect(spawn.spawnCreep).not.toHaveBeenCalled();
    });

    it('carry 过少的单位不转职（2×carry < work）', () => {
        const { room, spawn } = makeRoom();
        room.memory.building = true;
        pretickSpawn(room);
        getRushRoomHeap(room.name).income = 100;
        getRushTickState(room).maxWork = undefined;

        const heavyWork = creepOf(10, 1, 'idler');
        getRushTickState(room).creeps['idler'] = [heavyWork];

        manageBuildSpawn(room, []);
        expect(heavyWork.memory.role).toBe('idler');
        runSpawnManager(room);
        expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
    });
});

describe('优先目标', () => {
    it('容量 <800：extension 抬到 tower 档（低容量房 ext 先行）', () => {
        const { room } = makeRoom();
        room.energyCapacityAvailable = 550;
        const targets = getPriorityTargets(room, [siteOf('spawn'), siteOf('extension')], [], undefined);
        expect(targets.every((t) => t.structureType === 'extension')).toBe(true);
    });

    it('无主 spawn：spawn 工地最优先', () => {
        const { room } = makeRoom();
        room.find = vi.fn(() => []);
        const targets = getPriorityTargets(
            room,
            [siteOf('extension'), siteOf('spawn'), siteOf('tower')],
            [],
            undefined,
        );
        expect(targets.every((t) => t.structureType === 'spawn')).toBe(true);
    });

    it('tower 工地优先于其他同级目标', () => {
        const { room } = makeRoom();
        const targets = getPriorityTargets(room, [siteOf('extension'), siteOf('tower')], [], undefined);
        expect(targets.every((t) => t.structureType === 'tower')).toBe(true);
    });

    it('低耐久 rampart：无工地时直接修墙', () => {
        const { room } = makeRoom();
        const wall = rampartOf(100);
        const targets = getPriorityTargets(room, [], [wall], {});
        expect(targets).toEqual([wall]);
    });
});
