import { compress } from '@/utils';

type PosLike = RoomPosition | { pos: RoomPosition } | number;

export function toPosNumber(pos: PosLike): number {
    if (typeof pos === 'number') return pos;
    const p = 'pos' in pos ? pos.pos : pos;
    return compress(p.x, p.y);
}

export function addTransportMission(
    room: Room,
    level: number,
    params: {
        pos: PosLike;
        source: Id<Structure>;
        target: Id<Structure>;
        resourceType: ResourceConstant;
        amount: number;
    }
) {
    if (!params.amount || params.amount <= 0) return;
    room.TransportMissionAdd(level, {
        pos: toPosNumber(params.pos),
        source: params.source,
        target: params.target,
        resourceType: params.resourceType,
        amount: params.amount,
    } as any);
}

export const LevelMap = {
    boost: 0,
    ext: 1,
    tower: 1,
    labEnergy: 1,
    lab: 2,
    powerSpawn: 2,
    nuker: 3,
}
