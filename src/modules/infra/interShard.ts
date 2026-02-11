export type InterShardCommand =
    | { id: string; seq: number; time: number; fromShard: string; toShard: string; type: 'expand.set'; payload: any }
    | { id: string; seq: number; time: number; fromShard: string; toShard: string; type: 'expand.pause'; payload: any }
    | { id: string; seq: number; time: number; fromShard: string; toShard: string; type: 'expand.resume'; payload: any }
    | { id: string; seq: number; time: number; fromShard: string; toShard: string; type: 'expand.remove'; payload: any };

export type InterShardExpandPlanSummary = {
    id: string;
    homeShard: string;
    homeRoom: string;
    targetRoom: string;
    desired: { claimer: number; builder: number; carry: number; upgrader: number };
    status: 'running' | 'paused' | 'done';
    created: number;
    updated: number;
    ttl?: number;
};

export type InterShardExpandStatus = {
    shard: string;
    time: number;
    state: 'running' | 'paused' | 'done' | 'removed';
    note?: string;
    ttl?: number;
};

export type InterShardCreepTransfer = {
    fromShard: string;
    toShard: string;
    name: string;
    nonce: string;
    ttl: number;
    memory: any;
};

export type InterShardRoot = {
    v: number;
    seq: number;
    outbox?: Record<string, InterShardCommand[]>;
    cmdAcks?: Record<string, number>;
    plans?: Record<string, InterShardExpandPlanSummary>;
    status?: Record<string, InterShardExpandStatus>;
    expandCreepCounts?: Record<string, { time: number; roles: Record<string, number> }>;
    creepTransfers?: Record<string, Record<string, InterShardCreepTransfer>>;
    transferAcks?: Record<string, Record<string, string>>;
};

const safeJsonParse = (raw: string) => {
    try { return JSON.parse(raw); } catch { return null; }
};

let cacheEnabled = false;
let cachedTick = -1;
let cachedRoot: InterShardRoot | null = null;
let dirty = false;

const loadLocalRoot = (): InterShardRoot => {
    const raw = (typeof InterShardMemory !== 'undefined' && InterShardMemory.getLocal) ? InterShardMemory.getLocal() : '';
    const parsed = raw ? safeJsonParse(raw) : null;
    const root: InterShardRoot = { v: 1, seq: 0 };
    if (!parsed || typeof parsed !== 'object') return root;
    if ((parsed as any).v !== 1) return root;
    const p: any = parsed;
    if (typeof p.seq === 'number') root.seq = p.seq;
    if (p.outbox && typeof p.outbox === 'object') root.outbox = p.outbox;
    if (p.cmdAcks && typeof p.cmdAcks === 'object') root.cmdAcks = p.cmdAcks;
    if (p.plans && typeof p.plans === 'object') root.plans = p.plans;
    if (p.status && typeof p.status === 'object') root.status = p.status;
    if (p.expandCreepCounts && typeof p.expandCreepCounts === 'object') root.expandCreepCounts = p.expandCreepCounts;
    if (p.creepTransfers && typeof p.creepTransfers === 'object') root.creepTransfers = p.creepTransfers;
    if (p.transferAcks && typeof p.transferAcks === 'object') root.transferAcks = p.transferAcks;
    return root;
};

export function getKnownShardNames(): string[] {
    const limits = (Game.cpu as any)?.shardLimits;
    const fromLimits = limits && typeof limits === 'object' ? Object.keys(limits) : [];
    const unique = new Set<string>(fromLimits.length ? fromLimits : ['shard0', 'shard1', 'shard2', 'shard3']);
    unique.add(Game.shard.name);
    return Array.from(unique);
}

export function readInterShardLocalRoot(): InterShardRoot {
    if (cacheEnabled && cachedRoot && cachedTick === Game.time) return cachedRoot;
    const root = loadLocalRoot();
    if (cacheEnabled) {
        cachedRoot = root;
        cachedTick = Game.time;
        dirty = false;
    }
    return root;
}

export function writeInterShardLocalRoot(root: InterShardRoot): void {
    if (typeof InterShardMemory === 'undefined' || !InterShardMemory.setLocal) return;
    if (cacheEnabled) {
        cachedRoot = root;
        cachedTick = Game.time;
        dirty = true;
        return;
    }
    InterShardMemory.setLocal(JSON.stringify(root));
}

export function beginInterShardTick(): void {
    cacheEnabled = true;
    cachedTick = Game.time;
    cachedRoot = loadLocalRoot();
    dirty = false;
}

export function endInterShardTick(): void {
    if (!cacheEnabled) return;
    if (dirty && cachedRoot) {
        if (typeof InterShardMemory !== 'undefined' && InterShardMemory.setLocal) {
            InterShardMemory.setLocal(JSON.stringify(cachedRoot));
        }
    }
    cacheEnabled = false;
    dirty = false;
}

export function readInterShardRemoteRoot(shardName: string): InterShardRoot {
    const raw = (typeof InterShardMemory !== 'undefined' && InterShardMemory.getRemote) ? (InterShardMemory.getRemote(shardName) || '') : '';
    const parsed = raw ? safeJsonParse(raw) : null;
    const root: InterShardRoot = { v: 1, seq: 0 };
    if (!parsed || typeof parsed !== 'object') return root;
    if ((parsed as any).v !== 1) return root;
    const p: any = parsed;
    if (typeof p.seq === 'number') root.seq = p.seq;
    if (p.outbox && typeof p.outbox === 'object') root.outbox = p.outbox;
    if (p.cmdAcks && typeof p.cmdAcks === 'object') root.cmdAcks = p.cmdAcks;
    if (p.plans && typeof p.plans === 'object') root.plans = p.plans;
    if (p.status && typeof p.status === 'object') root.status = p.status;
    if (p.expandCreepCounts && typeof p.expandCreepCounts === 'object') root.expandCreepCounts = p.expandCreepCounts;
    if (p.creepTransfers && typeof p.creepTransfers === 'object') root.creepTransfers = p.creepTransfers;
    if (p.transferAcks && typeof p.transferAcks === 'object') root.transferAcks = p.transferAcks;
    return root;
}

const genId = (prefix: string) => {
    const t = Game.time.toString(16);
    const r = Math.random().toString(16).slice(2, 10);
    return `${prefix}${t}${r}`.toUpperCase();
};

export function pushInterShardCommand(cmd: Omit<InterShardCommand, 'id' | 'seq' | 'time' | 'fromShard'>): string {
    const root = readInterShardLocalRoot();
    const id = genId('ISC');
    const seq = (root.seq || 0) + 1;
    root.seq = seq;
    root.outbox ??= {};
    const q = root.outbox[cmd.toShard] || (root.outbox[cmd.toShard] = []);
    q.push({ ...(cmd as any), id, seq, time: Game.time, fromShard: Game.shard.name });
    writeInterShardLocalRoot(root);
    return id;
}

export function pullIncomingCommands(): InterShardCommand[] {
    const local = readInterShardLocalRoot();
    local.cmdAcks ??= {};
    const result: InterShardCommand[] = [];
    const myShard = Game.shard.name;

    const localOut = local.outbox?.[myShard];
    if (localOut && Array.isArray(localOut) && localOut.length > 0) {
        result.push(...localOut.filter((c) => c));
        delete local.outbox![myShard];
    }

    for (const shardName of getKnownShardNames()) {
        if (shardName === myShard) continue;
        const remote = readInterShardRemoteRoot(shardName);
        const out = remote.outbox?.[myShard];
        if (!out || !Array.isArray(out) || out.length === 0) continue;

        const lastAck = local.cmdAcks[shardName] || 0;
        const fresh = out.filter((c) => c && typeof c.seq === 'number' && c.seq > lastAck);
        if (!fresh.length) continue;

        const maxSeq = Math.max(...fresh.map((c) => c.seq));
        local.cmdAcks[shardName] = Math.max(lastAck, maxSeq);
        result.push(...fresh);
    }

    writeInterShardLocalRoot(local);
    return result;
}

export function cleanupOutboxAgainstRemoteAcks(): void {
    const local = readInterShardLocalRoot();
    if (!local.outbox) return;
    const myShard = Game.shard.name;
    for (const [toShard, q] of Object.entries(local.outbox)) {
        if (!Array.isArray(q) || q.length === 0) continue;
        const remote = readInterShardRemoteRoot(toShard);
        const ack = remote.cmdAcks?.[myShard] || 0;
        if (ack <= 0) continue;
        local.outbox[toShard] = q.filter((c) => c && (c.seq || 0) > ack);
    }
    writeInterShardLocalRoot(local);
}

export function publishExpandPlanSummary(summary: InterShardExpandPlanSummary): void {
    const local = readInterShardLocalRoot();
    local.plans ??= {};
    if (typeof summary.ttl !== 'number') summary.ttl = Game.time + 5000;
    local.plans[summary.id] = summary;
    writeInterShardLocalRoot(local);
}

export function publishExpandStatus(planId: string, status: InterShardExpandStatus): void {
    const local = readInterShardLocalRoot();
    local.status ??= {};
    if (typeof status.ttl !== 'number' && status.state === 'removed') status.ttl = Game.time + 500;
    if (typeof status.ttl !== 'number' && status.state === 'done') status.ttl = Game.time + 2000;
    local.status[planId] = status;
    writeInterShardLocalRoot(local);
}

export function publishExpandCreepCounts(counts: Record<string, Record<string, number>>): void {
    const local = readInterShardLocalRoot();
    local.expandCreepCounts = {};
    for (const [planId, roles] of Object.entries(counts || {})) {
        if (!roles || typeof roles !== 'object') continue;
        local.expandCreepCounts[planId] = { time: Game.time, roles: roles as Record<string, number> };
    }
    writeInterShardLocalRoot(local);
}

export function removePublishedExpandPlan(planId: string, keepStatus = false): void {
    const local = readInterShardLocalRoot();
    if (local.plans) delete local.plans[planId];
    if (!keepStatus && local.status) delete local.status[planId];
    writeInterShardLocalRoot(local);
}

export function upsertCreepTransfer(toShard: string, creepName: string, transfer: InterShardCreepTransfer): void {
    const local = readInterShardLocalRoot();
    local.creepTransfers ??= {};
    local.creepTransfers[toShard] ??= {};
    local.creepTransfers[toShard][creepName] = transfer;
    writeInterShardLocalRoot(local);
}

export function ackCreepTransfer(fromShard: string, creepName: string, nonce: string): void {
    const local = readInterShardLocalRoot();
    local.transferAcks ??= {};
    local.transferAcks[fromShard] ??= {};
    local.transferAcks[fromShard][creepName] = nonce;
    writeInterShardLocalRoot(local);
}

export function cleanupCreepTransfers(): void {
    const local = readInterShardLocalRoot();
    if (!local.creepTransfers) return;
    const myShard = Game.shard.name;
    for (const [toShard, map] of Object.entries(local.creepTransfers)) {
        if (!map || typeof map !== 'object') continue;
        const remote = readInterShardRemoteRoot(toShard);
        const acks = remote.transferAcks?.[myShard] || {};
        for (const [name, payload] of Object.entries(map)) {
            if (!payload) {
                delete map[name];
                continue;
            }
            if ((payload as any).ttl != null && (payload as any).ttl < Game.time) {
                delete map[name];
                continue;
            }
            const nonce = (payload as any).nonce;
            if (nonce && acks && acks[name] === nonce) {
                delete map[name];
            }
        }
        if (Object.keys(map).length === 0) delete local.creepTransfers[toShard];
    }
    writeInterShardLocalRoot(local);
}

export function cleanupInterShardLocalRoot(): void {
    const local = readInterShardLocalRoot();
    const now = Game.time;
    if (local.plans) {
        for (const [id, p] of Object.entries(local.plans)) {
            if (!p) {
                delete local.plans[id];
                continue;
            }
            const ttl = (p as any).ttl;
            if (typeof ttl === 'number' && ttl < now) {
                delete local.plans[id];
                if (local.status) delete local.status[id];
            }
        }
    }
    if (local.status) {
        for (const [id, st] of Object.entries(local.status)) {
            if (!st) {
                delete local.status[id];
                continue;
            }
            const ttl = (st as any).ttl;
            if (typeof ttl === 'number' && ttl < now) {
                delete local.status[id];
                continue;
            }
            if (!local.plans?.[id] && (st as any).state !== 'removed') {
                // 避免 status 漂浮：无计划且非 removed，超过一段时间就删除
                const time = (st as any).time;
                if (typeof time === 'number' && now - time > 2000) {
                    delete local.status[id];
                }
            }
        }
    }
    writeInterShardLocalRoot(local);
}
