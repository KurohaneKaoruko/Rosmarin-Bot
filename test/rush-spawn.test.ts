/**
 * rush 孵化链路桩测试：优先级公式与排序、请求丢弃分支、消费循环、EMA 口径。
 * Screeps 全局以最小桩替代（只覆盖被测路径用到的字段）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './helpers/rushStubs';

const g = globalThis as any;

// constants.ts 在模块加载期读取 STRUCTURE_* 游戏常量，需先于 import 打桩

import { TASK_PRIORITY } from '@/modules/rush/constants';
import { getBodyCost } from '@/modules/rush/creepUtils';
import { RushMinHeap } from '@/modules/rush/minHeap';
import { getRushTickState } from '@/modules/rush/roomState';
import { getCreepsByRole, pretickSpawn, runSpawnManager } from '@/modules/rush/spawnManager';
import { createSpawnRequest, requestCreep } from '@/modules/rush/spawnUtils';

const OK = 0;
const ERR_NOT_ENOUGH_ENERGY = -6;
const ERR_NAME_EXISTS = -10;

type MockSpawn = {
    name: string;
    spawning: null;
    isActive: () => boolean;
    spawnCreep: ReturnType<typeof vi.fn>;
    pos: { x: number; y: number; roomName: string };
};

const makeSpawn = (result: number = OK): MockSpawn => ({
    name: 'Spawn1',
    spawning: null,
    isActive: () => true,
    spawnCreep: vi.fn(() => result),
    pos: { x: 25, y: 25, roomName: 'W1N1' },
});

type MockRoom = {
    name: string;
    memory: any;
    storage: undefined | {};
    energyCapacityAvailable: number;
    find: ReturnType<typeof vi.fn>;
};

const makeRoom = (spawns: MockSpawn[], energyCapacityAvailable = 800): MockRoom => ({
    name: 'W1N1',
    // 与游戏一致：room.memory 即 Memory.rooms 条目
    memory: (g.Memory.rooms['W1N1'] ||= {}),
    storage: undefined,
    energyCapacityAvailable,
    find: vi.fn(() => spawns),
});

const BODY: BodyPartConstant[] = ['work', 'carry', 'move'];
const BODY_COST = 100 + 50 + 50;

beforeEach(() => {
    g.Game = { time: 1000, creeps: {}, map: { visual: { text: () => {} } } };
    g.Memory = { creeps: {}, rooms: {} };
    g.OK = OK;
    g.ERR_NOT_ENOUGH_ENERGY = ERR_NOT_ENOUGH_ENERGY;
    g.ERR_NAME_EXISTS = ERR_NAME_EXISTS;
    g.ERR_INVALID_TARGET = -2;
    g.BODYPART_COST = { move: 50, work: 100, carry: 50 };
    g.FIND_MY_SPAWNS = 1;
});

describe('优先级公式', () => {
    it('任务类型档位取枚举序（logistics < ownedSources < upgradePreference < remoteSources < upgrade）', () => {
        expect(TASK_PRIORITY['logistics']).toBeLessThan(TASK_PRIORITY['ownedSources']);
        expect(TASK_PRIORITY['ownedSources']).toBeLessThan(TASK_PRIORITY['upgradePreference']);
        expect(TASK_PRIORITY['upgradePreference']).toBeLessThan(TASK_PRIORITY['remoteSources']);
        expect(TASK_PRIORITY['remoteSources']).toBeLessThan(TASK_PRIORITY['upgrade']);
    });

    it('priority = 任务类型*1e5 + 任务优先级*100 + 角色序', () => {
        const room = makeRoom([makeSpawn()]) as any;
        const miner = createSpawnRequest(room, BODY, 'miner', 'ownedSources');
        expect(miner.priority).toBe(TASK_PRIORITY['ownedSources'] * 100000 + 0);

        const hauler = createSpawnRequest(room, BODY, 'hauler', 'ownedSources');
        expect(hauler.priority).toBe(TASK_PRIORITY['ownedSources'] * 100000 + 1);

        const upgrader = createSpawnRequest(room, BODY, 'upgrader', 'upgrade', { taskPriority: 5 });
        expect(upgrader.priority).toBe(TASK_PRIORITY['upgrade'] * 100000 + 500);
    });

    it('MinHeap 按优先级升序弹出', () => {
        const room = makeRoom([makeSpawn()]) as any;
        const queue = new RushMinHeap<any>((r) => r.priority);
        queue.insert(createSpawnRequest(room, BODY, 'upgrader', 'upgrade'));
        queue.insert(createSpawnRequest(room, BODY, 'miner', 'ownedSources'));
        queue.insert(createSpawnRequest(room, BODY, 'hauler', 'ownedSources'));

        expect(queue.getSize()).toBe(3);
        expect(queue.remove()!.memory.role).toBe('miner');
        expect(queue.remove()!.memory.role).toBe('hauler');
        expect(queue.remove()!.memory.role).toBe('upgrader');
        expect(queue.isEmpty()).toBe(true);
    });
});

describe('requestCreep 入队与丢弃', () => {
    it('无空闲 spawn 时请求直接不入队', () => {
        const room = makeRoom([makeSpawn()]) as any;
        getRushTickState(room).freeSpawns = [];

        requestCreep(room, BODY, 'miner', 'ownedSources');

        expect(getRushTickState(room).spawnQueue.getSize()).toBe(0);
    });

    it('有空闲 spawn 时入队一次', () => {
        const room = makeRoom([makeSpawn()]) as any;
        getRushTickState(room).freeSpawns = [makeSpawn() as any];

        requestCreep(room, BODY, 'miner', 'ownedSources');

        expect(getRushTickState(room).spawnQueue.getSize()).toBe(1);
    });
});

describe('孵化消费循环', () => {
    it('成功孵化：双 spawn 各孵一个（高优先先孵），队列与空闲池同 tick 清空', () => {
        const s1 = makeSpawn(OK);
        const s2 = makeSpawn(OK);
        const room = makeRoom([s1, s2]) as any;
        pretickSpawn(room);

        requestCreep(room, BODY, 'upgrader', 'upgrade');
        requestCreep(room, BODY, 'miner', 'ownedSources');

        runSpawnManager(room);

        expect(s1.spawnCreep).toHaveBeenCalledTimes(1);
        expect(s2.spawnCreep).toHaveBeenCalledTimes(1);
        // miner 优先级更高，先被弹出消费
        expect(/m#[0-9a-zA-Z]+$/.test(String(s2.spawnCreep.mock.calls[0][1]))).toBe(true);
        expect(getRushTickState(room).freeSpawns.length).toBe(0);
        expect(getRushTickState(room).spawnQueue.isEmpty()).toBe(true);
    });

    it('能量不足但房型可造：spawn 回池等待，剩余请求留在队列', () => {
        const spawn = makeSpawn(ERR_NOT_ENOUGH_ENERGY);
        const room = makeRoom([spawn], 800) as any; // 造价 200 ≤ 容量 800
        pretickSpawn(room);

        requestCreep(room, BODY, 'miner', 'ownedSources');
        requestCreep(room, BODY, 'hauler', 'ownedSources');

        runSpawnManager(room);

        expect(spawn.spawnCreep).toHaveBeenCalledTimes(1);
        expect(getRushTickState(room).freeSpawns.length).toBe(1);
        expect(getRushTickState(room).spawnQueue.getSize()).toBe(1);
    });

    it('房型造不出（造价 > 容量）：该请求丢弃，继续消费后续请求且挂起等待', () => {
        const spawn = makeSpawn(ERR_NOT_ENOUGH_ENERGY);
        const room = makeRoom([spawn], 300) as any;
        pretickSpawn(room);

        const heavy: BodyPartConstant[] = [
            'work', 'work', 'work', 'work', 'work', 'move', 'move', 'move',
        ]; // 造价 650 > 容量 300
        requestCreep(room, heavy, 'miner', 'ownedSources');
        requestCreep(room, BODY, 'hauler', 'ownedSources'); // 造价 200 ≤ 300

        runSpawnManager(room);

        expect(spawn.spawnCreep).toHaveBeenCalledTimes(2);
        expect(/m#[0-9a-zA-Z]+$/.test(String(spawn.spawnCreep.mock.calls[0][1]))).toBe(true);
        // 请求按参考口径逐 tick 重发：弹出即离队，等待中的 spawn 回池
        expect(getRushTickState(room).spawnQueue.getSize()).toBe(0);
        expect(getRushTickState(room).freeSpawns.length).toBe(1);
    });

    it('结果码非 OK 且非能量不足（如重名）：请求丢弃、spawn 回池', () => {
        const spawn = makeSpawn(ERR_NAME_EXISTS);
        const room = makeRoom([spawn]) as any;
        pretickSpawn(room);

        requestCreep(room, BODY, 'miner', 'ownedSources');
        requestCreep(room, BODY, 'hauler', 'ownedSources');

        runSpawnManager(room);

        expect(spawn.spawnCreep).toHaveBeenCalledTimes(2);
        expect(getRushTickState(room).freeSpawns.length).toBe(1);
        expect(getRushTickState(room).spawnQueue.isEmpty()).toBe(true);
    });
});

describe('EMA 口径', () => {
    it('spawnUsage：满负荷一 tick 后 = 旧值*(1-α) + 1*α，α=2/(寿命+1)', () => {
        const room = makeRoom([makeSpawn(OK)]) as any;
        pretickSpawn(room);
        room.memory.spawnUsage = 0.5;

        requestCreep(room, BODY, 'miner', 'ownedSources');
        runSpawnManager(room);

        const alpha = 2 / (1500 + 1);
        expect(room.memory.spawnUsage).toBeCloseTo(0.5 * (1 - alpha) + 1 * alpha, 12);
    });

    it('spawnBalance：无信号向 0 衰减，加码信号向 1 靠拢', () => {
        const room = makeRoom([makeSpawn(OK)]) as any;
        pretickSpawn(room);
        room.memory.spawnBalance = 1;

        runSpawnManager(room);
        const alpha = 1 - Math.pow(2, -1 / 50);
        expect(room.memory.spawnBalance).toBeCloseTo(1 * (1 - alpha), 12);

        const room2 = makeRoom([makeSpawn(OK)]) as any;
        pretickSpawn(room2);
        room2.memory.spawnBalance = 0;
        getRushTickState(room2).spawnBalanceAdded = true;

        runSpawnManager(room2);
        expect(room2.memory.spawnBalance).toBeCloseTo(alpha, 12);
    });

    it('有仓储时 spawnBalance 字段清除且不再更新', () => {
        const room = makeRoom([makeSpawn(OK)]) as any;
        room.storage = {};
        pretickSpawn(room);
        expect(room.memory.spawnBalance).toBeUndefined();

        getRushTickState(room).spawnBalanceAdded = true;
        runSpawnManager(room);
        expect(room.memory.spawnBalance).toBeUndefined();
    });
});

describe('花名册', () => {
    it('孵化成功登记、次 tick 重建 roster、亡者清理', () => {
        const spawn = makeSpawn(OK);
        const room = makeRoom([spawn]) as any;
        pretickSpawn(room);

        requestCreep(room, BODY, 'miner', 'ownedSources');
        runSpawnManager(room);

        const name = spawn.spawnCreep.mock.calls[0][1] as string;
        expect(Memory.rooms['W1N1'].creepNames).toContain(name);

        // 同 tick：roster 在 preTick 已重建，不含刚请求的名字
        expect(getCreepsByRole(room, 'miner')).toHaveLength(0);

        // 次 tick：creep 实体化 → roster 命中
        g.Game.creeps[name] = { name, memory: { role: 'miner' } };
        pretickSpawn(room);
        expect(getCreepsByRole(room, 'miner')).toHaveLength(1);

        // 再次 tick：creep 死亡 → 名册与 Memory.creeps 同步清理
        delete g.Game.creeps[name];
        pretickSpawn(room);
        expect(Memory.rooms['W1N1'].creepNames).not.toContain(name);
        expect(Memory.creeps[name]).toBeUndefined();
    });

    it('名称生成：本地命名约定（花名 + 角色短码#计数），同批唯一', () => {
        const s1 = makeSpawn(OK);
        const s2 = makeSpawn(OK);
        const room = makeRoom([s1, s2]) as any;
        pretickSpawn(room);

        requestCreep(room, BODY, 'miner', 'ownedSources');
        requestCreep(room, BODY, 'hauler', 'ownedSources');
        runSpawnManager(room);

        const name1 = s2.spawnCreep.mock.calls[0][1] as string;
        const name2 = s1.spawnCreep.mock.calls[0][1] as string;
        expect(/m#[0-9a-zA-Z]+$/.test(name1)).toBe(true);
        expect(/h#[0-9a-zA-Z]+$/.test(name2)).toBe(true);
        expect(name1).not.toBe(name2);
    });
});

describe('体型造价', () => {
    it('逐部件累加', () => {
        expect(getBodyCost(BODY)).toBe(BODY_COST);
        expect(getBodyCost(['move', 'move'])).toBe(100);
    });
});
