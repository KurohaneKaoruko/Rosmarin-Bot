import { parseShardRoomName } from '@/modules/infra/shardRoom';
import { getKnownShardNames, pushInterShardCommand, readInterShardLocalRoot, readInterShardRemoteRoot } from '@/modules/infra/interShard';

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

export default {
    expand: {
        set(home: string, target: string, opts?: any, legacyC?: any, legacyD?: any) {
            const finalOpts = (typeof opts === 'object' && opts) ? opts : {};

            let homeSpec = home;
            let targetSpec = target;

            if (typeof opts === 'string' && typeof legacyC === 'string') {
                homeSpec = `${opts}/${home}`;
                targetSpec = legacyC.includes('/') ? legacyC : `${legacyD || Game.shard.name}/${legacyC}`;
            }

            const h = normalizeShardRoom(homeSpec);
            const t = normalizeShardRoom(targetSpec);

            if (!h.roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error(`孵化房间名格式不正确：${homeSpec}`);
            if (!t.roomName.match(/^[EW][0-9]+[NS][0-9]+$/)) return Error(`目标房间名格式不正确：${targetSpec}`);

            const desired = {
                claimer: typeof finalOpts.claimer === 'number' ? finalOpts.claimer : 1,
                builder: typeof finalOpts.builder === 'number' ? finalOpts.builder : 1,
                carry: typeof finalOpts.carry === 'number' ? finalOpts.carry : 0,
                upgrader: typeof finalOpts.upgrader === 'number' ? finalOpts.upgrader : 0
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
    for (const shardName of getKnownShardNames()) {
        const root = readRoot(shardName);
        const entries = Object.values(root.plans || {});
        for (const p of entries) {
            if (!p) continue;
            const st = root.status?.[p.id];
            const status = st ? `${st.state}@${st.shard}` : p.status;
            plans.push({ ...p, status });
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
