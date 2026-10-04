/**
 * rush 体型生成桩测试：miner/hauler/upgrader/builder 各容量档位输出与口径一致。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './helpers/rushStubs';

// constants.ts 在模块加载期读取 STRUCTURE_* 游戏常量，需先于 import 打桩

import { getBodyCost } from '@/modules/rush/creepUtils';
import {
    getBuilderBody,
    getHaulerBody,
    getMinerBody,
    getUpgraderBody,
} from '@/modules/rush/spawnUtils';

const g = globalThis as any;

beforeEach(() => {
    g.BODYPART_COST = { move: 50, work: 100, carry: 50 };
    g.MAX_CREEP_SIZE = 50;
    g.CARRY_CAPACITY = 50;
    g.HARVEST_POWER = 2;
    g.WORK = 'work';
    g.CARRY = 'carry';
    g.MOVE = 'move';
});

const count = (body: string[], part: string) => body.filter((p) => p === part).length;

describe('miner 体型', () => {
    it('低容量 300：work 只堆到 2，带 1C1M', () => {
        // 起点 1M1C(100)，work 两次到 300 封顶
        expect(getMinerBody(300, 10, true)).toEqual(['work', 'carry', 'move', 'work']);
    });

    it('容量 550：work 4 + 移速补 M（1/4 < 0.5 → 2M）', () => {
        expect(getMinerBody(550, 10, true)).toEqual(['work', 'work', 'work', 'carry', 'move', 'move', 'work']);
    });

    it('容量 800：work 5 后补移速到 0.5 档，再堆 work 到容量', () => {
        // work5(600) → M(650) M(700)，3/5≥0.5 停 → desiredCarry=1 已满 → work6(800)
        expect(getMinerBody(800, 10, true)).toEqual([
            'work', 'work', 'work', 'work', 'work', 'carry', 'move', 'move', 'move', 'work',
        ]);
    });

    it('maxWork=5 封顶：到 5 即停（含移速与 carry 补齐）', () => {
        expect(getMinerBody(2000, 5, true)).toEqual(['work', 'work', 'work', 'work', 'carry', 'move', 'move', 'move', 'work']);
    });

    it('needCarry=false 极小容量 150：1M1W', () => {
        expect(getMinerBody(150, 10, false)).toEqual(['move', 'work']);
    });

    it('任意容量成本不超容量且不超 50 部件', () => {
        for (const cap of [200, 350, 700, 900, 1300, 1800, 2300]) {
            const body = getMinerBody(cap, 12, true);
            expect(getBodyCost(body)).toBeLessThanOrEqual(cap);
            expect(body.length).toBeLessThanOrEqual(50);
        }
    });
});

describe('hauler 体型', () => {
    it('路面组 [C,C,M]：容量 300 → 2 组', () => {
        expect(getHaulerBody(300, { forRoad: true })).toEqual([
            'carry', 'carry', 'move', 'carry', 'carry', 'move',
        ]);
    });

    it('路面组受组数 16 封顶', () => {
        const body = getHaulerBody(3000, { forRoad: true });
        expect(body.length).toBe(48);
        expect(count(body, 'carry')).toBe(32);
    });

    it('越野组 [C,M]：容量 300 → 3 组', () => {
        expect(getHaulerBody(300)).toEqual(['carry', 'move', 'carry', 'move', 'carry', 'move']);
    });

    it('maxCarry=4（接力口径）：路面组 2 组即停', () => {
        expect(getHaulerBody(5000, { forRoad: true, maxCarry: 4 })).toEqual([
            'carry', 'carry', 'move', 'carry', 'carry', 'move',
        ]);
    });

    it('任意容量成本不超容量', () => {
        for (const cap of [150, 400, 800, 1600]) {
            expect(getBodyCost(getHaulerBody(cap, { forRoad: true }))).toBeLessThanOrEqual(cap);
        }
    });
});

describe('upgrader 体型', () => {
    it('容量 300 常态（carryRatio=4）：2W1C1M（carry 门未触发）', () => {
        expect(getUpgraderBody(300)).toEqual(['work', 'carry', 'move', 'work']);
    });

    it('容量 550 常态：3W 在前 + 移速补齐 → 4W1C2M', () => {
        expect(getUpgraderBody(550)).toEqual([
            'work', 'work', 'work', 'carry', 'move', 'move', 'work',
        ]);
    });

    it('冲级期 carryRatio=1 vs 常态 4：大容量下 carry 门触发行为分野', () => {
        // 常态 4：work 过 12 后开始补 carry
        const normal = getUpgraderBody(3000, undefined, 4);
        expect(count(normal, 'carry')).toBeGreaterThan(1);
        // 冲级 1：carry 门在 50 部件内永不触发，纯 work/move 机
        const rush = getUpgraderBody(3000, undefined, 1);
        expect(count(rush, 'carry')).toBe(1);
        expect(getBodyCost(rush)).toBeLessThanOrEqual(3000);
    });

    it('maxWork 封顶：work 到上限即停', () => {
        const body = getUpgraderBody(3000, 10);
        expect(count(body, 'work')).toBe(10);
        expect(getBodyCost(body)).toBeLessThanOrEqual(3000);
    });

    it('任意容量成本不超容量且不超 50 部件', () => {
        for (const cap of [250, 400, 650, 1000, 1500, 3000]) {
            const body = getUpgraderBody(cap);
            expect(getBodyCost(body)).toBeLessThanOrEqual(cap);
            expect(body.length).toBeLessThanOrEqual(50);
        }
    });
});

describe('builder 体型', () => {
    it('容量 300：整组装不下 → 半组 (M,C) 凑容 → 1W2C2M', () => {
        expect(getBuilderBody(300)).toEqual(['carry', 'carry', 'move', 'work', 'move']);
    });

    it('容量 550：整组 + 半组 (W,M) → 3W2C3M', () => {
        expect(getBuilderBody(550)).toEqual([
            'work', 'work', 'carry', 'carry', 'move', 'move', 'work', 'move',
        ]);
    });

    it('maxWork 封顶：work 到上限即停', () => {
        const body = getBuilderBody(2000, 3);
        expect(count(body, 'work')).toBe(3);
        expect(getBodyCost(body)).toBeLessThanOrEqual(2000);
    });

    it('任意容量成本不超容量且不超 50 部件', () => {
        for (const cap of [200, 400, 800, 1200, 2000]) {
            const body = getBuilderBody(cap);
            expect(getBodyCost(body)).toBeLessThanOrEqual(cap);
            expect(body.length).toBeLessThanOrEqual(50);
        }
    });
});
