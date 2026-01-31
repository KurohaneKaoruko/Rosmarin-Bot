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

