import { compress } from '@/modules/utils/compress';

export type LabPos = number;

export type LabABResult = {
    labA: StructureLab | null;
    labB: StructureLab | null;
    labAId: Id<StructureLab> | null;
    labBId: Id<StructureLab> | null;
    labAPos: LabPos | null;
    labBPos: LabPos | null;
};

const emptyResult: LabABResult = {
    labA: null,
    labB: null,
    labAId: null,
    labBId: null,
    labAPos: null,
    labBPos: null
};

export function resolveLabFromMem(room: Room, value: unknown): { lab: StructureLab | null; pos: LabPos | null } {
    if (!room.lab || room.lab.length === 0) return { lab: null, pos: null };
    if (typeof value === 'number' && Number.isFinite(value)) {
        const target = room.lab.find(l => l && compress(l.pos.x, l.pos.y) === value) || null;
        return { lab: target, pos: target ? value : null };
    }
    if (typeof value === 'string' && value) {
        const lab = Game.getObjectById(value as Id<StructureLab>) as StructureLab | null;
        if (lab && lab.pos && lab.structureType === STRUCTURE_LAB) {
            const pos = compress(lab.pos.x, lab.pos.y);
            const target = room.lab.find(l => l && compress(l.pos.x, l.pos.y) === pos) || lab;
            return { lab: target, pos };
        }
    }
    return { lab: null, pos: null };
}

function pickLabAB(labs: StructureLab[]): { a: StructureLab; b: StructureLab } | null {
    if (!labs || labs.length !== 10) return null;
    let best: { a: StructureLab; b: StructureLab; score: number; ax: number; ay: number; bx: number; by: number } | null = null;
    const ordered = labs.slice().sort((l1, l2) => (l1.pos.x - l2.pos.x) || (l1.pos.y - l2.pos.y));
    for (let i = 0; i < ordered.length; i++) {
        for (let j = 0; j < ordered.length; j++) {
            if (i === j) continue;
            const a = ordered[i];
            const b = ordered[j];
            let ok = true;
            let score = 0;
            for (const c of ordered) {
                if (c.id === a.id || c.id === b.id) continue;
                const ra = c.pos.getRangeTo(a);
                const rb = c.pos.getRangeTo(b);
                if (ra > 2 || rb > 2) {
                    ok = false;
                    break;
                }
                score += ra + rb;
            }
            if (!ok) continue;
            const cand = { a, b, score, ax: a.pos.x, ay: a.pos.y, bx: b.pos.x, by: b.pos.y };
            if (!best) {
                best = cand;
                continue;
            }
            if (cand.score < best.score) best = cand;
            else if (cand.score === best.score) {
                const t1 = (cand.ax - best.ax) || (cand.ay - best.ay) || (cand.bx - best.bx) || (cand.by - best.by);
                if (t1 < 0) best = cand;
            }
        }
    }
    return best ? { a: best.a, b: best.b } : null;
}

const getCache = (() => {
    let cachedTick = -1;
    let cachedByRoom: Record<string, { mode: 'get' | 'ensure'; value: LabABResult }> = {};
    return {
        get(roomName: string, mode: 'get' | 'ensure'): LabABResult | undefined {
            if (cachedTick !== Game.time) {
                cachedTick = Game.time;
                cachedByRoom = {};
            }
            const hit = cachedByRoom[roomName];
            if (!hit) return undefined;
            if (mode === 'get') return hit.value;
            if (hit.mode === 'ensure') return hit.value;
            return undefined;
        },
        set(roomName: string, mode: 'get' | 'ensure', value: LabABResult): void {
            if (cachedTick !== Game.time) {
                cachedTick = Game.time;
                cachedByRoom = {};
            }
            cachedByRoom[roomName] = { mode, value };
        }
    };
})();

function computeLabAB(roomName: string, room: Room, mode: 'ensure' | 'get'): LabABResult {
    if (!room.lab || room.lab.length === 0) return emptyResult;

    const root = (Memory as any)['StructControlData'];
    const botmem = mode === 'ensure'
        ? (root || ((Memory as any)['StructControlData'] = {}))[roomName] || (((Memory as any)['StructControlData'])[roomName] = {})
        : root?.[roomName];

    if (!botmem) return emptyResult;

    const ra = resolveLabFromMem(room, botmem.labA);
    const rb = resolveLabFromMem(room, botmem.labB);

    if (mode === 'ensure') {
        if (ra.lab && ra.pos != null && botmem.labA !== ra.pos) botmem.labA = ra.pos;
        if (rb.lab && rb.pos != null && botmem.labB !== rb.pos) botmem.labB = rb.pos;
        if (!ra.lab) delete botmem.labA;
        if (!rb.lab) delete botmem.labB;
    }

    let labA = ra.lab;
    let labB = rb.lab;
    let labAPos = ra.pos;
    let labBPos = rb.pos;

    if (mode === 'ensure' && (!labA || !labB) && room.lab.length === 10) {
        const pair = pickLabAB(room.lab);
        if (pair) {
            labA = pair.a;
            labB = pair.b;
            labAPos = compress(labA.pos.x, labA.pos.y);
            labBPos = compress(labB.pos.x, labB.pos.y);
            botmem.labA = labAPos;
            botmem.labB = labBPos;
        }
    }

    return {
        labA,
        labB,
        labAId: labA ? labA.id : null,
        labBId: labB ? labB.id : null,
        labAPos: labAPos ?? null,
        labBPos: labBPos ?? null
    };
}

export function getLabAB(roomName: string, room?: Room): LabABResult {
    const cached = getCache.get(roomName, 'get');
    if (cached) return cached;
    const r = room || Game.rooms[roomName];
    if (!r) return emptyResult;
    const value = computeLabAB(roomName, r, 'get');
    getCache.set(roomName, 'get', value);
    return value;
}

export function ensureLabAB(roomName: string, room?: Room): LabABResult {
    const cached = getCache.get(roomName, 'ensure');
    if (cached) return cached;
    const r = room || Game.rooms[roomName];
    if (!r) return emptyResult;

    const value = computeLabAB(roomName, r, 'ensure');
    getCache.set(roomName, 'ensure', value);
    return value;
}
