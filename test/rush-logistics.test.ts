/**
 * rush 物流匹配桩测试：配送优先级、高优抢占、同级近者赢、容量回滚（useRate 修正）、
 * porter 阈值跳过、死目标清理、请求收集。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './helpers/rushStubs';


import {
    createRequest,
    ENERGY_FILL_PRIORITY,
    getFillRequests,
    manageLogistics,
    matchHaulers,
} from '@/modules/rush/manageLogistics';
import { clearRushCreepHeap, getRushCreepHeap, getRushRoomHeap, getRushTickState } from '@/modules/rush/roomState';
import { pretickSpawn } from '@/modules/rush/spawnManager';

const g = globalThis as any;

const pos = (x: number, y: number, roomName = 'W1N1') => ({ x, y, roomName });

const makeStructure = (id: string, structureType: string, freeCapacity: number, p: { x: number; y: number }): any => {
    const s = new g.Structure();
    return Object.assign(s, {
        id,
        structureType,
        spawning: null,
        isActive: () => true,
        pos: pos(p.x, p.y),
        store: { getFreeCapacity: () => freeCapacity, getUsedCapacity: () => 0 },
    });
};

const makeCreep = (
    name: string,
    p: { x: number; y: number },
    opts: { role?: string; amount?: number; ttl?: number } = {},
): any => {
    const c = new g.Creep();
    return Object.assign(c, {
        id: name,
        name,
        memory: { role: opts.role ?? 'hauler' },
        pos: pos(p.x, p.y),
        room: { name: 'W1N1' },
        amount: opts.amount ?? 100,
        store: {
            getUsedCapacity: () => opts.amount ?? 100,
            getFreeCapacity: () => 0,
            getCapacity: () => opts.amount ?? 100,
        },
        ticksToLive: opts.ttl ?? 1500,
        moveTo: vi.fn(() => 0),
        transfer: vi.fn(() => 0),
        body: [{ type: 'carry' }, { type: 'move' }],
        getActiveBodyparts: (part: string) => (part === 'carry' ? 1 : part === 'move' ? 1 : 0),
    });
};

let __room: any;
let __structures: any[];

beforeEach(() => {
    g.Game = { time: 1000, creeps: {}, getObjectById: () => undefined };
    g.Memory = { creeps: {}, rooms: {} };
    g.BODYPART_COST = { move: 50, work: 100, carry: 50, claim: 600 };
    g.CREEP_LIFE_TIME = 1500;
    g.CREEP_SPAWN_TIME = 3;
    g.WORK = 'work';
    g.CARRY = 'carry';
    g.MOVE = 'move';
    g.FIND_MY_SPAWNS = 1;
    g.FIND_STRUCTURES = 2;
    g.FIND_MY_CONSTRUCTION_SITES = 3;
    g.RESOURCE_ENERGY = 'energy';
    g.OK = 0;
    g.ERR_NOT_ENOUGH_ENERGY = -6;
    g.ERR_NAME_EXISTS = -10;
    g.ERR_INVALID_TARGET = -2;
    g.ERR_BUSY = -4;

    __structures = [];
    const spawn = { name: 'S1', spawning: null, isActive: () => true, pos: pos(25, 25) };
    __room = {
        name: 'W1N1',
        memory: (g.Memory.rooms['W1N1'] ||= {}),
        storage: undefined,
        terminal: undefined,
        energyAvailable: 300,
        energyCapacityAvailable: 300,
        controller: { level: 4 },
        find: vi.fn((type: number, opts?: any) => {
            if (type === g.FIND_MY_SPAWNS) return [spawn];
            const filterType = opts?.filter?.structureType;
            return filterType ? __structures.filter((s) => s.structureType === filterType) : __structures;
        }),
    };

    for (const name of ['h1', 'h2', 'p1', 'u1']) {
        clearRushCreepHeap(name);
    }
});

const room = () => __room;

describe('优先级表', () => {
    it('口径：spawn/ext=1 < tower/lab=2 < builder=3 < container/upgrader=5 < storage=10', () => {
        expect(ENERGY_FILL_PRIORITY['spawn']).toBe(1);
        expect(ENERGY_FILL_PRIORITY['extension']).toBe(1);
        expect(ENERGY_FILL_PRIORITY['tower']).toBe(2);
        expect(ENERGY_FILL_PRIORITY['builder']).toBe(3);
        expect(ENERGY_FILL_PRIORITY['container']).toBe(5);
        expect(ENERGY_FILL_PRIORITY['upgrader']).toBe(5);
        expect(ENERGY_FILL_PRIORITY['terminal']).toBe(6);
        expect(ENERGY_FILL_PRIORITY['storage']).toBe(10);
    });
});

describe('matchHaulers 争夺与回滚', () => {
    it('高优者赢：container 单已被占，extension 单抢走搬运工并回滚容量', () => {
        const container = makeStructure('c1', 'container', 500, { x: 30, y: 30 });
        const extension = makeStructure('e1', 'extension', 200, { x: 26, y: 26 });
        const hauler = makeCreep('h1', { x: 27, y: 27 }, { amount: 100 });

        const requests = { c1: createRequest(container), e1: createRequest(extension) };
        getRushCreepHeap('h1').targetRequest = requests['c1'];
        requests['c1'].amount -= 100;

        g.Game.getObjectById = (id: string) => (id === 'c1' ? container : undefined);

        matchHaulers(requests, [hauler], 5, false);

        expect(getRushCreepHeap('h1').targetRequest.id).toBe('e1');
        expect(requests['c1'].amount).toBe(500);
    });

    it('同级近者赢：两个 container 单，更近者抢走', () => {
        const far = makeStructure('cf', 'container', 500, { x: 40, y: 40 });
        const near = makeStructure('cn', 'container', 500, { x: 28, y: 28 });
        const hauler = makeCreep('h1', { x: 27, y: 27 }, { amount: 100 });

        const requests = { cf: createRequest(far), cn: createRequest(near) };
        getRushCreepHeap('h1').targetRequest = requests['cf'];
        requests['cf'].amount -= 100;

        g.Game.getObjectById = (id: string) => (id === 'cf' ? far : undefined);

        matchHaulers(requests, [hauler], 5, false);

        expect(getRushCreepHeap('h1').targetRequest.id).toBe('cn');
        expect(requests['cf'].amount).toBe(500);
    });

    it('同级不远于现有单：保持原单', () => {
        const near = makeStructure('cn', 'container', 500, { x: 28, y: 28 });
        const same = makeStructure('cs', 'container', 500, { x: 28, y: 28 });
        const hauler = makeCreep('h1', { x: 27, y: 27 }, { amount: 100 });

        const requests = { cn: createRequest(near), cs: createRequest(same) };
        getRushCreepHeap('h1').targetRequest = requests['cn'];
        requests['cn'].amount -= 100;

        g.Game.getObjectById = (id: string) => (id === 'cn' ? near : undefined);

        matchHaulers(requests, [hauler], 5, false);

        expect(getRushCreepHeap('h1').targetRequest.id).toBe('cn');
        expect(requests['cn'].amount).toBe(400);
    });

    it('低优不抢高优', () => {
        const extension = makeStructure('e1', 'extension', 200, { x: 26, y: 26 });
        const container = makeStructure('c1', 'container', 500, { x: 27, y: 27 });
        const hauler = makeCreep('h1', { x: 26, y: 27 }, { amount: 100 });

        const requests = { e1: createRequest(extension), c1: createRequest(container) };
        getRushCreepHeap('h1').targetRequest = requests['e1'];
        requests['e1'].amount -= 100;

        g.Game.getObjectById = (id: string) => (id === 'e1' ? extension : undefined);

        matchHaulers(requests, [hauler], 5, false);

        expect(getRushCreepHeap('h1').targetRequest.id).toBe('e1');
        expect(requests['c1'].amount).toBe(500);
    });

    it('回滚带 useRate 途中修正', () => {
        const container = makeStructure('c1', 'container', 500, { x: 40, y: 40 });
        const extension = makeStructure('e1', 'extension', 200, { x: 27, y: 27 });
        const hauler = makeCreep('h1', { x: 28, y: 28 }, { amount: 100 });

        const requests = { c1: createRequest(container), e1: createRequest(extension) };
        requests['c1'].useRate = 2;
        getRushCreepHeap('h1').targetRequest = requests['c1'];
        requests['c1'].amount -= 100;

        g.Game.getObjectById = (id: string) => (id === 'c1' ? container : undefined);

        matchHaulers(requests, [hauler], 5, false);

        // 回滚 = +载量 100 − useRate 2 × 距离 12
        expect(requests['c1'].amount).toBe(476);
    });

    it('旧单目标已销毁：清除挂单记录，正常接新单', () => {
        const extension = makeStructure('e1', 'extension', 200, { x: 26, y: 26 });
        const hauler = makeCreep('h1', { x: 26, y: 27 }, { amount: 100 });

        const stale = createRequest(makeStructure('gone', 'container', 500, { x: 40, y: 40 }));
        const requests = { e1: createRequest(extension) };
        getRushCreepHeap('h1').targetRequest = stale;

        matchHaulers(requests, [hauler], 5, false);

        expect(getRushCreepHeap('h1').targetRequest.id).toBe('e1');
    });

    it('单搬运工多请求：活跃原单按距离保持，不崩溃', () => {
        const c1 = makeStructure('c1', 'container', 500, { x: 30, y: 30 });
        const c2 = makeStructure('c2', 'container', 500, { x: 32, y: 30 });
        const c3 = makeStructure('c3', 'container', 500, { x: 40, y: 40 });
        const hauler = makeCreep('h1', { x: 26, y: 26 }, { amount: 100 });

        const requests = { c1: createRequest(c1), c2: createRequest(c2), c3: createRequest(c3) };
        g.Game.getObjectById = (id: string) =>
            id === 'c1' ? c1 : id === 'c2' ? c2 : id === 'c3' ? c3 : undefined;

        expect(() => matchHaulers(requests, [hauler], 5, false)).not.toThrow();
        // 同级下更近的原单不被后续请求抢走
        expect(getRushCreepHeap('h1').targetRequest.id).toBe('c1');
        expect(requests['c1'].amount).toBe(400);
        expect(requests['c2'].amount).toBe(500);
    });

    it('porter 阈值跳过：porter 兼职不接低优单，普通 hauler 不受限', () => {
        const storage = makeStructure('s1', 'storage', 1000, { x: 25, y: 28 });
        const porter = makeCreep('p1', { x: 26, y: 26 }, { role: 'porter', ttl: 1000 });
        const hauler = makeCreep('h1', { x: 26, y: 26 }, { role: 'hauler' });

        const requests = { s1: createRequest(storage) };
        matchHaulers(requests, [porter, hauler], 10, false);

        expect(getRushCreepHeap('p1').targetRequest).toBeUndefined();
        expect(getRushCreepHeap('h1').targetRequest.id).toBe('s1');
    });

    it('临近寿终的 porter 不受阈值跳过', () => {
        const storage = makeStructure('s1', 'storage', 1000, { x: 25, y: 28 });
        const dyingPorter = makeCreep('p1', { x: 26, y: 26 }, { role: 'porter', ttl: 15 });

        const requests = { s1: createRequest(storage) };
        matchHaulers(requests, [dyingPorter], 10, false);

        expect(getRushCreepHeap('p1').targetRequest.id).toBe('s1');
    });
});

describe('请求收集', () => {    it('孵化能量已满时不收集 spawn/extension', () => {
        const r = room();
        r.energyAvailable = 300;
        r.energyCapacityAvailable = 300;
        pretickSpawn(r);

        const requests = getFillRequests(r, []);

        expect(Object.keys(requests)).toHaveLength(0);
    });

    it('孵化能量未满时 spawn/extension 最先', () => {
        const r = room();
        r.energyAvailable = 100;
        r.energyCapacityAvailable = 300;
        __structures.push(makeStructure('sp1', 'spawn', 200, { x: 25, y: 25 }));

        const requests = getFillRequests(r, []);

        expect(requests['sp1']).toBeDefined();
        expect(requests['sp1'].priority).toBe(1);
    });

    it('creepsToFill 追加就位取能单位（含 useRate）', () => {
        const r = room();
        pretickSpawn(r);
        const upgrader = makeCreep('u1', { x: 25, y: 31 }, { role: 'upgrader' });
        (upgrader as any).store.getFreeCapacity = () => 50;
        (upgrader as any).useRate = 2;

        const requests = getFillRequests(r, [upgrader]);

        expect(requests['u1'].priority).toBe(5);
        expect(requests['u1'].useRate).toBe(2);
    });

    it('tower 填充阈值 400：freeCapacity 不足不发单', () => {
        const r = room();
        __structures.push(makeStructure('t1', 'tower', 300, { x: 26, y: 30 }));
        __structures.push(makeStructure('t2', 'tower', 500, { x: 27, y: 30 }));

        const requests = getFillRequests(r, []);

        expect(requests['t1']).toBeUndefined();
        expect(requests['t2']).toBeDefined();
    });
});

describe('溢流沉淀主流程', () => {
    const ccAt = (x: number, y: number): any => {
        const cc = makeStructure('cc1', 'container', 0, { x, y });
        return cc;
    };

    it('无消费者（无请求）：闲量搬运工记加码信号并向容器位沉淀', () => {
        const r = room();
        r.energyAvailable = 300;
        r.energyCapacityAvailable = 300;
        pretickSpawn(r);

        const cc = ccAt(25, 31);
        g.Game.getObjectById = (id: string) => (id === 'cc1' ? cc : undefined);
        getRushRoomHeap('W1N1').controllerContainerId = 'cc1';

        const hauler = makeCreep('h1', { x: 25, y: 31 }, { amount: 100 });
        (hauler.memory as any).startSupplying = true;
        (hauler as any).drop = vi.fn(() => 0);

        manageLogistics(r, [hauler], []);

        expect(getRushTickState(r).spawnBalanceAdded).toBe(true);
        // 已在容器位上 → 直接 drop
        expect((hauler as any).drop).toHaveBeenCalledWith('energy');
    });

    it('无容器锚点：加码但不移动不掉落', () => {
        const r = room();
        r.energyAvailable = 300;
        r.energyCapacityAvailable = 300;
        pretickSpawn(r);

        const hauler = makeCreep('h1', { x: 25, y: 30 }, { amount: 100 });
        (hauler.memory as any).startSupplying = true;
        (hauler as any).drop = vi.fn(() => 0);

        manageLogistics(r, [hauler], []);

        expect(getRushTickState(r).spawnBalanceAdded).toBe(true);
        expect((hauler as any).drop).not.toHaveBeenCalled();
        expect(hauler.moveTo).not.toHaveBeenCalled();
    });

    it('有消费者：匹配供货不加码', () => {
        const r = room();
        r.energyAvailable = 100;
        r.energyCapacityAvailable = 300;
        const extension = makeStructure('e1', 'extension', 200, { x: 26, y: 26 });
        __structures.push(extension);
        pretickSpawn(r);

        const hauler = makeCreep('h1', { x: 26, y: 27 }, { amount: 100 });
        (hauler.memory as any).startSupplying = true;

        manageLogistics(r, [hauler], []);

        expect(getRushTickState(r).spawnBalanceAdded).toBe(false);
    });
});
