import { ackCreepTransfer, cleanupCreepTransfers, getKnownShardNames, readInterShardRemoteRoot, upsertCreepTransfer } from '@/modules/infra/interShard';

const snapshot = (obj: any) => {
    try { return JSON.parse(JSON.stringify(obj)); } catch { return {}; }
};

const genNonce = () => {
    const t = Game.time.toString(16);
    const r = Math.random().toString(16).slice(2, 10);
    return `N${t}${r}`.toUpperCase();
};

const findNearbyInterShardPortalDest = (creep: Creep): { shard: string; portalPos: RoomPosition } | null => {
    const portals = creep.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s: AnyStructure) => s.structureType === STRUCTURE_PORTAL
    }) as StructurePortal[];
    for (const p of portals) {
        const dest = (p as any).destination;
        const shard = dest?.shard;
        if (shard && shard !== Game.shard.name) return { shard, portalPos: p.pos };
    }
    return null;
};

const restoreIncoming = () => {
    const myShard = Game.shard.name;
    const remotes = getKnownShardNames().filter((s) => s !== myShard);
    if (!remotes.length) return;

    for (const creep of Object.values(Game.creeps)) {
        if (!creep) continue;
        const mem = Memory.creeps?.[creep.name] as any;
        if (mem && mem.role) continue;

        for (const fromShard of remotes) {
            const remote = readInterShardRemoteRoot(fromShard);
            const payload = remote.creepTransfers?.[myShard]?.[creep.name];
            if (!payload) continue;
            if (payload.ttl != null && payload.ttl < Game.time) continue;

            Memory.creeps ??= {} as any;
            (Memory.creeps as any)[creep.name] = payload.memory || {};
            (Memory.creeps as any)[creep.name]._ism = { fromShard: payload.fromShard, nonce: payload.nonce, time: Game.time };
            ackCreepTransfer(payload.fromShard, creep.name, payload.nonce);
            break;
        }
    }
};

const sendOutgoing = () => {
    for (const creep of Object.values(Game.creeps)) {
        if (!creep) continue;
        const expandId = (creep.memory as any).expandId;
        if (!expandId) continue;

        const portal = findNearbyInterShardPortalDest(creep);
        if (!portal) continue;

        const nonce = (creep.memory as any)._ismNonce || genNonce();
        (creep.memory as any)._ismNonce = nonce;
        (creep.memory as any)._ismToShard = portal.shard;

        const mem = snapshot(Memory.creeps?.[creep.name] || creep.memory);
        upsertCreepTransfer(portal.shard, creep.name, {
            fromShard: Game.shard.name,
            toShard: portal.shard,
            name: creep.name,
            nonce,
            ttl: Game.time + 200,
            memory: mem
        });
    }
};

export const CreepMemoryTransfer = {
    run() {
        restoreIncoming();
        sendOutgoing();
        cleanupCreepTransfers();
    }
};
