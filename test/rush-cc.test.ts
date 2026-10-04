/**
 * rush controller 容器生命周期桩测试：RCL2 起放置、唯一 cc、链接期销毁、堆 id 登记。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './helpers/rushStubs';


import { manageControllerContainer } from '@/modules/rush/manageConstruction';
import { clearRushRoomHeap, getRushRoomHeap } from '@/modules/rush/roomState';

const g = globalThis as any;

const pos = (x: number, y: number, roomName = 'W1N1') => ({
    x,
    y,
    roomName,
    inRangeTo: (o: any, range: number) =>
        Math.max(Math.abs(x - (o.x ?? o.pos?.x)), Math.abs(y - (o.y ?? o.pos?.y))) <= range,
});

const makeContainer = (id: string, x: number, y: number): any => {
    const s = new g.Structure();
    return Object.assign(s, { id, structureType: 'container', pos: pos(x, y), destroy: vi.fn(() => 0) });
};

const makeSite = (id: string, x: number, y: number): any => {
    const s = new g.ConstructionSite();
    return Object.assign(s, { id, structureType: 'container', pos: pos(x, y) });
};

const makeLink = (id: string, x: number, y: number): any => {
    const s = new g.Structure();
    return Object.assign(s, { id, structureType: 'link', pos: pos(x, y) });
};

let structures: any[];
let sites: any[];
let links: any[];
let created: any[];
let room: any;

beforeEach(() => {
    g.Game = { time: 1000, creeps: {}, getObjectById: () => undefined };
    g.Memory = { creeps: {}, rooms: {} };
    g.FIND_STRUCTURES = 2;
    g.FIND_CONSTRUCTION_SITES = 3;
    g.FIND_MY_CONSTRUCTION_SITES = 4;
    g.FIND_SOURCES = 5;
    g.STRUCTURE_CONTAINER = 'container';
    g.STRUCTURE_LINK = 'link';
    g.STRUCTURE_RAMPART = 'rampart';
    g.TERRAIN_MASK_WALL = 1;
    g.RESOURCE_ENERGY = 'energy';
    g.OK = 0;

    structures = [];
    sites = [];
    links = [];
    created = [];
    const linkList = links;

    room = {
        name: 'W1N1',
        memory: (g.Memory.rooms['W1N1'] ||= {}),
        controller: { my: true, level: 2, pos: pos(25, 30) },
        source: [{ id: 'src1' }],
        get link() {
            return linkList;
        },
        spawn: [{ id: 'sp1', pos: pos(25, 25) }],
        getTerrain: () => ({ get: () => 0 }),
        find: vi.fn((type: number) => {
            if (type === g.FIND_STRUCTURES) return structures;
            if (type === g.FIND_CONSTRUCTION_SITES) return sites;
            if (type === g.FIND_MY_CONSTRUCTION_SITES) return sites;
            return [];
        }),
        createConstructionSite: vi.fn((x: number, y: number, t: string) => {
            created.push({ x, y, t });
            return 0;
        }),
        lookForAt: () => [],
    };
    clearRushRoomHeap('W1N1');
});

describe('cc 生命周期', () => {
    it('RCL1 不放置', () => {
        room.controller.level = 1;
        manageControllerContainer(room);
        expect(created).toHaveLength(0);
    });

    it('RCL2 无容器：按评分放置（含 spawn 距离修正）', () => {
        manageControllerContainer(room);
        expect(created).toHaveLength(1);
        expect(created[0].t).toBe('container');
        // 25,30 上方紧邻 spawn 侧更优：站位分相近时偏向 spawn
        expect(created[0].y).toBeLessThanOrEqual(30);
    });

    it('已有 cc：幂等不重复放量，并登记堆 id', () => {
        const cc = makeContainer('cc1', 25, 31);
        structures.push(cc);

        manageControllerContainer(room);

        expect(created).toHaveLength(0);
        expect(getRushRoomHeap('W1N1').controllerContainerId).toBe('cc1');
    });

    it('已有同型工地：幂等不重复放量', () => {
        sites.push(makeSite('site1', 25, 31));
        manageControllerContainer(room);
        expect(created).toHaveLength(0);
    });

    it('链接期（RCL5 + 旁 link）：销毁 cc 并清堆 id', () => {
        room.controller.level = 5;
        links.push(makeLink('lk1', 25, 28));
        const cc = makeContainer('cc1', 25, 31);
        structures.push(cc);
        getRushRoomHeap('W1N1').controllerContainerId = 'cc1';

        manageControllerContainer(room);

        expect(cc.destroy).toHaveBeenCalled();
        expect(getRushRoomHeap('W1N1').controllerContainerId).toBeUndefined();
        expect(created).toHaveLength(0);
    });

    it('链接期但无 cc：直接收尾不放置', () => {
        room.controller.level = 5;
        links.push(makeLink('lk1', 25, 28));
        manageControllerContainer(room);
        expect(created).toHaveLength(0);
    });
});
