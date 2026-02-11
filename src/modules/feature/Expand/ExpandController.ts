import { parseShardRoomName } from '@/modules/infra/shardRoom';
import { cleanupOutboxAgainstRemoteAcks, publishExpandPlanSummary, publishExpandStatus, pullIncomingCommands, removePublishedExpandPlan } from '@/modules/infra/interShard';
import { getBotMemory } from '@/modules/utils/memory';

type LocalExpandPlan = {
    id: string;
    homeShard: string;
    homeRoom: string;
    targetRoom: string;
    desired: { claimer: number; builder: number; carry: number; upgrader: number };
    status: 'running' | 'paused' | 'done';
    created: number;
    updated: number;
    lastSpawnTick?: number;
};

type LocalExpandMemory = {
    v: number;
    plans: Record<string, LocalExpandPlan>;
};

const getLocalExpandMemory = (): LocalExpandMemory => {
    const mem = getBotMemory() as any;
    if (!mem.Expand || typeof mem.Expand !== 'object') mem.Expand = { v: 1, plans: {} };
    if (!mem.Expand.plans || typeof mem.Expand.plans !== 'object') mem.Expand.plans = {};
    return mem.Expand as LocalExpandMemory;
};

const getExpandCreepCounts = (() => {
    let cachedTick = -1;
    let cached: Record<string, Record<string, number>> = {};
    return () => {
        if (cachedTick === Game.time) return cached;
        cachedTick = Game.time;
        cached = {};
        for (const creep of Object.values(Game.creeps)) {
            if (!creep) continue;
            const id = (creep.memory as any).expandId;
            if (!id) continue;
            const role = creep.memory.role || 'unknown';
            if (!cached[id]) cached[id] = {};
            cached[id][role] = (cached[id][role] || 0) + 1;
        }
        return cached;
    };
})();

const getExpandSpawnCounts = (room: Room, expandId: string): Record<string, number> => {
    const counts: Record<string, number> = {};
    const tasks = room.getAllMissionFromPool('spawn') || [];
    for (const task of tasks) {
        if (!task || task.type !== 'spawn') continue;
        const mem = (task.data as any)?.memory;
        if (!mem || mem.expandId !== expandId) continue;
        const role = mem.role || 'unknown';
        counts[role] = (counts[role] || 0) + 1;
    }
    return counts;
};

const shouldComplete = (plan: LocalExpandPlan): boolean => {
    const { shard, roomName } = parseShardRoomName(plan.targetRoom);
    if (shard && shard !== Game.shard.name) return false;
    const room = Game.rooms[roomName];
    if (!room || !room.controller?.my) return false;
    if (!room.spawn || room.spawn.length === 0) return false;
    if (room.find(FIND_CONSTRUCTION_SITES).length > 0) return false;
    return true;
};

const applyCmds = (mem: LocalExpandMemory) => {
    const cmds = pullIncomingCommands();
    for (const cmd of cmds) {
        if (!cmd) continue;
        if (cmd.type === 'expand.set') {
            const p = cmd.payload as any;
            if (!p || !p.id) continue;
            if (p.homeShard && p.homeShard !== Game.shard.name) continue;
            mem.plans[p.id] = {
                id: p.id,
                homeShard: p.homeShard,
                homeRoom: p.homeRoom,
                targetRoom: p.targetRoom,
                desired: p.desired,
                status: p.status || 'running',
                created: p.created || Game.time,
                updated: Game.time
            };
            publishExpandPlanSummary({ ...mem.plans[p.id] });
        } else if (cmd.type === 'expand.pause' || cmd.type === 'expand.resume') {
            const p = cmd.payload as any;
            const plan = mem.plans[p?.id];
            if (!plan) continue;
            plan.status = cmd.type === 'expand.pause' ? 'paused' : 'running';
            plan.updated = Game.time;
            publishExpandPlanSummary({ ...plan });
            publishExpandStatus(plan.id, { shard: Game.shard.name, time: Game.time, state: plan.status });
        } else if (cmd.type === 'expand.remove') {
            const p = cmd.payload as any;
            const id = p?.id;
            if (!id) continue;
            delete mem.plans[id];
            removePublishedExpandPlan(id);
        }
    }
};

const runOnePlanInRoom = (room: Room, plan: LocalExpandPlan, creepCounts: any) => {
    if (plan.status !== 'running') return;
    if (plan.homeRoom !== room.name) return;

    if (shouldComplete(plan)) {
        plan.status = 'done';
        plan.updated = Game.time;
        publishExpandPlanSummary({ ...plan });
        publishExpandStatus(plan.id, { shard: Game.shard.name, time: Game.time, state: 'done' });
        return;
    }

    const spawnCounts = getExpandSpawnCounts(room, plan.id);
    const roleCount = (role: string) => (creepCounts[plan.id]?.[role] || 0) + (spawnCounts[role] || 0);

    const needClaimer = Math.max(0, plan.desired.claimer - roleCount('claimer'));
    const needBuilder = Math.max(0, plan.desired.builder - roleCount('aid-build'));
    const needCarry = Math.max(0, plan.desired.carry - roleCount('aid-carry'));
    const needUpgrader = Math.max(0, plan.desired.upgrader - roleCount('aid-upgrade'));

    if (needClaimer > 0) {
        const spawnName = `EXP-CLAIM#${plan.id}`;
        const rc = room.SpawnMissionAdd(spawnName, '', -1, 'claimer', { targetRoom: plan.targetRoom, expandId: plan.id } as any);
        if (rc === OK) plan.lastSpawnTick = Game.time;
        return;
    }
    if (needBuilder > 0) {
        const spawnName = `EXP-BUILD#${plan.id}`;
        const rc = room.SpawnMissionAdd(spawnName, '', -1, 'aid-build', { sourceRoom: plan.targetRoom, targetRoom: plan.targetRoom, expandId: plan.id } as any);
        if (rc === OK) plan.lastSpawnTick = Game.time;
        return;
    }
    if (needCarry > 0) {
        const spawnName = `EXP-CARRY#${plan.id}`;
        const rc = room.SpawnMissionAdd(spawnName, '', -1, 'aid-carry', { sourceRoom: room.name, targetRoom: plan.targetRoom, resource: RESOURCE_ENERGY, expandId: plan.id } as any);
        if (rc === OK) plan.lastSpawnTick = Game.time;
        return;
    }
    if (needUpgrader > 0) {
        const spawnName = `EXP-UPGRADE#${plan.id}`;
        const rc = room.SpawnMissionAdd(spawnName, '', -1, 'aid-upgrade', { targetRoom: plan.targetRoom, expandId: plan.id, home: plan.targetRoom } as any);
        if (rc === OK) plan.lastSpawnTick = Game.time;
        return;
    }
};

export const ExpandController = {
    run() {
        if (Game.time % 5 !== 0) return;
        if (Game.time % 50 === 0) cleanupOutboxAgainstRemoteAcks();
        const mem = getLocalExpandMemory();
        applyCmds(mem);

        const plans = Object.values(mem.plans || {});
        if (!plans.length) return;

        const creepCounts = getExpandCreepCounts();
        for (const plan of plans) {
            if (!plan) continue;
            const room = Game.rooms[plan.homeRoom];
            if (!room || !room.controller?.my) continue;
            runOnePlanInRoom(room, plan, creepCounts);
            publishExpandPlanSummary({ ...plan });
            publishExpandStatus(plan.id, { shard: Game.shard.name, time: Game.time, state: plan.status });
        }
    }
};
