export type MoveWorkTileCandidate = {
    pos: RoomPosition;
    range: number;
};

type MoveWorkTileRuntimeIntent = {
    tick: number;
    candidates: MoveWorkTileCandidate[];
};

type CreepWithMoveWorkTileIntent = Creep & {
    __moveWorkTileRuntimeIntent?: MoveWorkTileRuntimeIntent;
};

const normalizeRange = (range: number): number => {
    if (!Number.isFinite(range)) return 0;
    return Math.max(0, Math.floor(range));
};

const getCandidateKey = (candidate: MoveWorkTileCandidate): string => {
    return `${candidate.pos.roomName}:${candidate.pos.x}:${candidate.pos.y}:${candidate.range}`;
};

export const writeMoveWorkTileCandidates = (creep: Creep, candidates: MoveWorkTileCandidate[]) => {
    const uniqueCandidates: MoveWorkTileCandidate[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
        if (!candidate?.pos) continue;
        const normalizedCandidate: MoveWorkTileCandidate = {
            pos: candidate.pos,
            range: normalizeRange(candidate.range),
        };
        const key = getCandidateKey(normalizedCandidate);
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueCandidates.push(normalizedCandidate);
    }

    (creep as CreepWithMoveWorkTileIntent).__moveWorkTileRuntimeIntent = {
        tick: Game.time,
        candidates: uniqueCandidates,
    };
};

export const readMoveWorkTileCandidates = (creep: Creep): MoveWorkTileCandidate[] => {
    const intent = (creep as CreepWithMoveWorkTileIntent).__moveWorkTileRuntimeIntent;
    if (!intent || intent.tick !== Game.time) return [];
    return intent.candidates;
};
