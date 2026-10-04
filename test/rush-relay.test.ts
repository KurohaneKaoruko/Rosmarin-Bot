/**
 * rush relay 接力桩测试：对穿换向与记忆互换、往复防抖、TTL 门、等容量颗粒、miner 搭车。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './helpers/rushStubs';


import { getRelayTarget, markRushIntent } from '@/modules/rush/manageLogistics';
import { clearRushCreepHeap, getRushCreepHeap } from '@/modules/rush/roomState';

const g = globalThis as any;

const pos = (x: number, y: number, roomName = 'W1N1') => ({ x, y, roomName });

const makeCreep = (
    name: string,
    p: { x: number; y: number },
    opts: { role?: string; supplying?: boolean; capacity?: number; ttl?: number } = {},
): any => {
    const c = new g.Creep();
    return Object.assign(c, {
        id: name,
        name,
        my: true,
        memory: { role: opts.role ?? 'hauler', supplying: opts.supplying ?? false },
        pos: pos(p.x, p.y),
        room: null as any,
        store: {
            getCapacity: () => opts.capacity ?? 200,
            getFreeCapacity: () => (opts.supplying ? 0 : opts.capacity ?? 200),
            getUsedCapacity: () => (opts.supplying ? opts.capacity ?? 200 : 0),
        },
        ticksToLive: opts.ttl ?? 1000,
        transfer: vi.fn(() => 0),
        withdraw: vi.fn(() => 0),
        pickup: vi.fn(() => 0),
        pull: vi.fn(() => 0),
        say: vi.fn(),
    });
};

let lookTable: Record<string, any[]>;

beforeEach(() => {
    g.Game = { time: 5000, creeps: {}, getObjectById: () => undefined };
    g.Memory = { creeps: {}, rooms: {} };
    g.CREEP_LIFE_TIME = 1500;
    g.RESOURCE_ENERGY = 'energy';
    g.LOOK_CREEPS = 'creep';
    g.LOOK_TOMBSTONES = 'tombstone';
    g.LOOK_RESOURCES = 'resource';
    g.OK = 0;

    lookTable = {};
    const roomObj = {
        name: 'W1N1',
        lookForAt: vi.fn((type: string, x: number, y: number) => {
            const key = `${type}:${x},${y}`;
            return lookTable[key] ?? [];
        }),
    };
    (g as any).__room = roomObj;
    (g as any).__look = lookTable;

    for (const name of ['A', 'B', 'M1']) {
        clearRushCreepHeap(name);
    }
});

const room = () => (g as any).__room as any;

describe('relay 对穿换向', () => {
    it('相向意图 + 等容量 + 供方 TTL 充足 → transfer 并交换记忆', () => {
        const a = makeCreep('A', { x: 26, y: 26 }, { supplying: true, capacity: 200, ttl: 1000 });
        const b = makeCreep('B', { x: 27, y: 26 }, { supplying: false, capacity: 200, ttl: 1000 });
        a.room = room();
        b.room = room();
        g.Memory.creeps['A'] = { role: 'hauler', supplying: true, targetId: 't1' };
        g.Memory.creeps['B'] = { role: 'hauler', supplying: false };

        markRushIntent(a, 27, 26); // A 打算去 B 的位置
        markRushIntent(b, 26, 26); // B 打算去 A 的位置
        lookTable['creep:27,26'] = [b];

        const target = getRelayTarget(a);

        expect(target).toBe(b);
        expect(a.transfer).toHaveBeenCalledWith(b, 'energy');
        // 记忆互换（身份跟着货走）
        expect(g.Memory.creeps['A'].supplying).toBe(false);
        expect(g.Memory.creeps['B'].supplying).toBe(true);
        // 防抖戳
        expect(getRushCreepHeap('A').relayed).toBe(g.Game.time);
        expect(getRushCreepHeap('B').relayed).toBe(g.Game.time);
    });

    it('同 tick 二次调用：防抖直接返回空', () => {
        const a = makeCreep('A', { x: 26, y: 26 }, { supplying: true });
        const b = makeCreep('B', { x: 27, y: 26 }, { supplying: false });
        a.room = room();
        b.room = room();
        g.Memory.creeps['A'] = { supplying: true };
        g.Memory.creeps['B'] = { supplying: false };

        markRushIntent(a, 27, 26);
        markRushIntent(b, 26, 26);
        lookTable['creep:27,26'] = [b];

        expect(getRelayTarget(a)).toBe(b);
        expect(getRelayTarget(b)).toBeUndefined();
    });

    it('供方 TTL≤50 不接力', () => {
        const a = makeCreep('A', { x: 26, y: 26 }, { supplying: true, ttl: 40 });
        const b = makeCreep('B', { x: 27, y: 26 }, { supplying: false });
        a.room = room();
        b.room = room();
        g.Memory.creeps['A'] = { supplying: true };
        g.Memory.creeps['B'] = { supplying: false };

        markRushIntent(a, 27, 26);
        markRushIntent(b, 26, 26);
        lookTable['creep:27,26'] = [b];

        expect(getRelayTarget(a)).toBeUndefined();
        expect(a.transfer).not.toHaveBeenCalled();
    });

    it('容量颗粒不等：不接力', () => {
        const a = makeCreep('A', { x: 26, y: 26 }, { supplying: true, capacity: 250 });
        const b = makeCreep('B', { x: 27, y: 26 }, { supplying: false, capacity: 200 });
        a.room = room();
        b.room = room();
        g.Memory.creeps['A'] = { supplying: true };
        g.Memory.creeps['B'] = { supplying: false };

        markRushIntent(a, 27, 26);
        markRushIntent(b, 26, 26);
        lookTable['creep:27,26'] = [b];

        expect(getRelayTarget(a)).toBeUndefined();
    });

    it('对方非对穿意图：不接力', () => {
        const a = makeCreep('A', { x: 26, y: 26 }, { supplying: true });
        const b = makeCreep('B', { x: 27, y: 26 }, { supplying: false });
        a.room = room();
        b.room = room();
        g.Memory.creeps['A'] = { supplying: true };
        g.Memory.creeps['B'] = { supplying: false };

        markRushIntent(a, 27, 26);
        markRushIntent(b, 30, 30); // B 去别处
        lookTable['creep:27,26'] = [b];

        expect(getRelayTarget(a)).toBeUndefined();
    });

    it('取能途中意图格站着 miner：pull 搭车', () => {
        const a = makeCreep('A', { x: 26, y: 26 }, { supplying: false, role: 'hauler' });
        const miner = makeCreep('M1', { x: 27, y: 26 }, { role: 'miner' });
        a.room = room();
        miner.room = room();

        markRushIntent(a, 27, 26);
        lookTable['creep:27,26'] = [miner];

        expect(getRelayTarget(a)).toBeUndefined();
        expect(miner.pull).toHaveBeenCalledWith(a);
    });
});
