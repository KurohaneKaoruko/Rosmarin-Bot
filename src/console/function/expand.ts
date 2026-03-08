import { parseShardRoomName } from '@/modules/utils/shardRoom';
import { getKnownShardNames, pushInterShardCommand, readInterShardLocalRoot, readInterShardRemoteRoot } from '@/modules/feature/interShard';
import { getBotMemory } from '@/modules/utils/memory';

const genId = () => {
    const t = Game.time.toString(16);
    const r = Math.random().toString(16).slice(2, 10);
    return `E${t}${r}`.toUpperCase();
};

const normalizeShardRoom = (spec: string) => {
    const parsed = parseShardRoomName(String(spec || ''));
    const shard = parsed.shard || Game.shard.name;
    const roomName = parsed.roomName;
    return { shard, roomName, full: parsed.shard ? `${parsed.shard}/${roomName}` : roomName };
};

type ExpandDesiredOptions = {
    claimer?: number;
    builder?: number;
    carry?: number;
    upgrader?: number;
};

export default {
    expand: {
        set(home: string, target: string, opts: ExpandDesiredOptions = {}) {
            const h = normalizeShardRoom(home);
            const t = normalizeShardRoom(target);

            if (!h.roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error(`孵化房间名格式不正确：${home}`);
            if (!t.roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error(`目标房间名格式不正确：${target}`);

            const desired = {
                claimer: typeof opts.claimer === 'number' ? opts.claimer : 1,
                builder: typeof opts.builder === 'number' ? opts.builder : 1,
                carry: typeof opts.carry === 'number' ? opts.carry : 0,
                upgrader: typeof opts.upgrader === 'number' ? opts.upgrader : 0
            };

            const id = genId();

            const plan = {
                id,
                homeShard: h.shard,
                homeRoom: h.roomName,
                targetRoom: t.full,
                desired,
                status: 'running',
                created: Game.time,
                updated: Game.time
            };
            pushInterShardCommand({ toShard: h.shard, type: 'expand.set', payload: plan } as any);
            global.log(`expand 已投递: id=${id} home=${h.shard}/${h.roomName} -> ${t.full} desired=${JSON.stringify(desired)}`);
            return id;
        },

        pause(idOrTarget: string) {
            const plan = findPlan(idOrTarget);
            if (!plan) return Error(`未找到扩张计划：${idOrTarget}`);
            pushInterShardCommand({ toShard: plan.homeShard, type: 'expand.pause', payload: { id: plan.id } } as any);
            global.log(`expand 已投递暂停: id=${plan.id}`);
            return OK;
        },

        resume(idOrTarget: string) {
            const plan = findPlan(idOrTarget);
            if (!plan) return Error(`未找到扩张计划：${idOrTarget}`);
            pushInterShardCommand({ toShard: plan.homeShard, type: 'expand.resume', payload: { id: plan.id } } as any);
            global.log(`expand 已投递恢复: id=${plan.id}`);
            return OK;
        },

        remove(idOrTarget: string) {
            const plan = findPlan(idOrTarget);
            if (!plan) return Error(`未找到扩张计划：${idOrTarget}`);
            pushInterShardCommand({ toShard: plan.homeShard, type: 'expand.remove', payload: { id: plan.id } } as any);
            global.log(`expand 已投递删除: id=${plan.id}`);
            return OK;
        },

        list() {
            const entries = listPlans();
            if (!entries.length) {
                global.log('expand 计划为空');
                return OK;
            }
            for (const p of entries) {
                global.log(`- id=${p.id} status=${p.status} home=${p.homeShard}/${p.homeRoom} target=${p.targetRoom} desired=${JSON.stringify(p.desired)}`);
            }
            return OK;
        }
    }
};

const readRoot = (shardName: string) => shardName === Game.shard.name ? readInterShardLocalRoot() : readInterShardRemoteRoot(shardName);

const listPlans = () => {
    const plans: any[] = [];
    const seen = new Set<string>();
    for (const shardName of getKnownShardNames()) {
        const root = readRoot(shardName);
        const entries = Object.values(root.plans || {});
        for (const p of entries) {
            if (!p) continue;
            if (seen.has(p.id)) continue;
            const st = root.status?.[p.id];
            const status = st ? `${st.state}@${st.shard}` : p.status;
            seen.add(p.id);
            plans.push({ ...p, status });
        }
    }

    const local = getBotMemory() as any;
    const localPlans = local?.Expand?.plans;
    if (localPlans && typeof localPlans === 'object') {
        for (const p of Object.values(localPlans)) {
            if (!p) continue;
            if (seen.has((p as any).id)) continue;
            seen.add((p as any).id);
            plans.push({ ...(p as any), status: (p as any).status });
        }
    }
    return plans;
};

const findPlan = (idOrTarget: string) => {
    for (const p of listPlans()) {
        if (p.id === idOrTarget) return p;
        if (p.targetRoom === idOrTarget) return p;
    }
    return null;
};
