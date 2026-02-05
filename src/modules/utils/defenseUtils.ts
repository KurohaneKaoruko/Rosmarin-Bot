import { buildCombatProfile, estimateDismantlePower } from '@/modules/utils/combatCalc';

export type DefenseRampartMode = 'melee' | 'ranged';

/**
 * 为防御站位分配一个稳定的起始索引。
 * @description 用于避免多个防御 creep 同时从列表 index0 开始抢同一个 rampart，导致来回抖动。
 */
export const getStableStartIndex = (seed: string, len: number): number => {
    if (len <= 0) return 0;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return hash % len;
};

/**
 * 判断该位置是否可以站人（rampart 同格只允许 rampart/road/container）。
 */
export const isDefenseRampartStandable = (room: Room, pos: RoomPosition): boolean => {
    const lookStructure = room.lookForAt(LOOK_STRUCTURES, pos);
    if (
        lookStructure.length &&
        lookStructure.some(
            structure =>
                structure.structureType !== STRUCTURE_RAMPART &&
                structure.structureType !== STRUCTURE_ROAD &&
                structure.structureType !== STRUCTURE_CONTAINER
        )
    ) {
        return false;
    }
    return true;
};

/**
 * 判断 rampart 是否可用（我方、血量达标、且格子不被其它建筑堵住）。
 */
export const isDefenseRampartValid = (room: Room, rampart: StructureRampart, minHits: number): boolean => {
    if (!rampart?.my) return false;
    if (rampart.hits < minHits) return false;
    return isDefenseRampartStandable(room, rampart.pos);
};

/**
 * 判断目标格子是否被其它 creep 占用（允许自己站在自己目标点）。
 */
export const isPosOccupiedByOtherCreep = (room: Room, pos: RoomPosition, selfName: string): boolean => {
    const lookCreeps = room.lookForAt(LOOK_CREEPS, pos);
    if (!lookCreeps.length) return false;
    return lookCreeps.some(c => c.name !== selfName);
};

/**
 * 计算 rampart 的站位评分（只依赖敌人列表），用于在候选不足时挑选最佳点位。
 * @description melee 希望越近越好；ranged 希望与最近敌人保持在 3 格左右。
 */
export const scoreRampart = (pos: RoomPosition, hostiles: Creep[], mode: DefenseRampartMode): number => {
    let minDist = Infinity;
    for (const e of hostiles) {
        const d = pos.getRangeTo(e.pos);
        if (d < minDist) minDist = d;
    }
    if (!Number.isFinite(minDist)) minDist = 50;
    if (mode === 'melee') return -minDist;
    return -Math.abs(minDist - 3) - minDist * 0.05;
};

/**
 * 判断站位锁是否仍然有效。
 */
export const isDefenseRampartLockActive = (lockUntil: number | undefined): boolean => {
    return typeof lockUntil === 'number' && lockUntil > Game.time;
};

/**
 * 根据分数差决定是否允许切换站位（避免轻微波动导致来回走）。
 */
export const shouldSwitchDefenseRampart = (currentScore: number, nextScore: number, threshold: number): boolean => {
    return nextScore - currentScore >= threshold;
};

export const pickDefenseAnchorRampart = (
    room: Room,
    mode: DefenseRampartMode,
    seed: string,
    minHits: number
): StructureRampart | null => {
    const mem = room.memory['defenseRamparts'];
    if (!mem || !mem.tick) return null;
    // 只使用短期缓存的候选点：避免每 tick 扫全房 rampart 造成 CPU 抖动。
    if (mem.tick + 15 < Game.time) return null;
    const list = mode === 'melee' ? mem.melee : mem.ranged;
    if (!Array.isArray(list) || list.length === 0) return null;

    const startIndex = getStableStartIndex(seed, list.length);
    for (let i = 0; i < list.length; i++) {
        const id = list[(startIndex + i) % list.length];
        const r = Game.getObjectById(id as Id<StructureRampart>);
        if (!r || !isDefenseRampartValid(room, r, minHits)) continue;
        if (!isPosOccupiedByOtherCreep(room, r.pos, seed)) return r;
        if (room.lookForAt(LOOK_CREEPS, r.pos).some(c => c.name === seed)) return r;
    }
    return null;
};

export type DefenseTargetPickReason = 'killable-fast' | 'killable-value' | 'unbreakable-delay' | 'fallback-closest';

export type DefenseTargetPick = {
    id: Id<Creep | PowerCreep>;
    reason: DefenseTargetPickReason;
    score: number;
    netDamage: number;
};

type TowerFocusMemory = {
    id?: Id<Creep | PowerCreep>;
    until?: number;
    lastSeen?: number;
};

const getRoomTowerFocusMem = (room: Room): TowerFocusMemory => {
    if (!room.memory) (room as any).memory = {};
    if (!room.memory['_towerFocus']) room.memory['_towerFocus'] = {};
    return room.memory['_towerFocus'] as TowerFocusMemory;
};

const isClaimer = (c: Creep): boolean => {
    return (c.body || []).some(p => p.hits > 0 && p.type === CLAIM);
};

const getValueBonus = (c: Creep): number => {
    let v = 0;
    const body = c.body || [];
    for (const p of body) {
        if (p.hits <= 0) continue;
        if (p.type === HEAL) v += 6;
        else if (p.type === CLAIM) v += 10;
        else if (p.type === RANGED_ATTACK) v += 4;
        else if (p.type === ATTACK) v += 3;
        else if (p.type === WORK) v += 2;
    }
    const dismantle = estimateDismantlePower(c as any);
    if (dismantle > 0) v += 6;
    return v;
};

const getNetTowerDamage = (room: Room, target: Creep | PowerCreep): number => {
    const fn = (room as any).TowerDamageToCreep;
    if (typeof fn !== 'function') return 0;
    return Number(fn.call(room, target)) || 0;
};

export const pickTowerFocusTarget = (room: Room, hostiles: (Creep | PowerCreep)[]): DefenseTargetPick | null => {
    if (!hostiles || hostiles.length === 0) return null;

    const mem = getRoomTowerFocusMem(room);
    const focusActive = typeof mem.until === 'number' && mem.until > Game.time && mem.id;
    if (focusActive) {
        const keep = Game.getObjectById(mem.id!);
        if (keep && (keep as any).pos && (keep as any).pos.roomName === room.name) {
            const netDamage = getNetTowerDamage(room, keep as any);
            if (netDamage > 0) {
                mem.lastSeen = Game.time;
                return { id: mem.id!, reason: 'killable-value', score: 1e9, netDamage };
            }
        }
    }

    let best: DefenseTargetPick | null = null;
    for (const h of hostiles) {
        if (!h) continue;
        if ((h as any).pos?.roomName !== room.name) continue;

        const netDamage = getNetTowerDamage(room, h as any);
        const killable = netDamage > 0;
        const hits = Number((h as any).hits) || 0;
        const ttk = killable ? hits / Math.max(1, netDamage) : Infinity;
        let score = 0;

        if (killable) {
            score += 100000;
            score += Math.max(0, 5000 - ttk * 10);
        } else {
            score -= 20000;
        }

        if ((h as any).body) {
            const v = getValueBonus(h as any);
            score += v * 50;

            const profile = buildCombatProfile(h as any);
            if (profile.boosted) score += 200;
            if (isClaimer(h as any)) score += 800;
        }

        const distToCore = room.storage ? room.storage.pos.getRangeTo((h as any).pos) : 25;
        score += Math.max(0, 30 - distToCore) * 8;

        if (!best || score > best.score) {
            best = { id: (h as any).id, reason: killable ? 'killable-fast' : 'unbreakable-delay', score, netDamage };
        }
    }

    if (best) {
        mem.id = best.id;
        mem.until = Game.time + 8;
        mem.lastSeen = Game.time;
    }
    return best;
};
