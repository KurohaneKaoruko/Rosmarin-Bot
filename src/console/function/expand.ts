import { parseShardRoomName } from '@/shared/shardRoom';
import { getKnownShardNames, pushInterShardCommand, readInterShardLocalRoot, readInterShardRemoteRoot } from '@/features/interShard';
import { getBotMemory } from '@/shared/memory';

/**
 * 生成扩张计划 ID。
 */
const genId = () => {
    const t = Game.time.toString(16);
    const r = Math.random().toString(16).slice(2, 10);
    return `E${t}${r}`.toUpperCase();
};

/**
 * 归一化 `shard/room` 字符串。
 *
 * @param spec 输入规格，支持 `W1N1` 或 `shard3/W1N1`。
 * @returns 解析后的 shard 与房间信息。
 */
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

/**
 * 控制台扩张命令集合。
 *
 * @remarks
 * 通过 inter-shard 指令把扩张操作投递到目标 home shard。
 */
export default {
    expand: {
        /**
         * 创建并投递扩张计划。
         */
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

        /**
         * 暂停扩张计划。
         */
        pause(idOrTarget: string) {
            const plan = findPlan(idOrTarget);
            if (!plan) return Error(`未找到扩张计划：${idOrTarget}`);
            pushInterShardCommand({ toShard: plan.homeShard, type: 'expand.pause', payload: { id: plan.id } } as any);
            global.log(`expand 已投递暂停: id=${plan.id}`);
            return OK;
        },

        /**
         * 恢复扩张计划。
         */
        resume(idOrTarget: string) {
            const plan = findPlan(idOrTarget);
            if (!plan) return Error(`未找到扩张计划：${idOrTarget}`);
            pushInterShardCommand({ toShard: plan.homeShard, type: 'expand.resume', payload: { id: plan.id } } as any);
            global.log(`expand 已投递恢复: id=${plan.id}`);
            return OK;
        },

        /**
         * 删除扩张计划。
         */
        remove(idOrTarget: string) {
            const plan = findPlan(idOrTarget);
            if (!plan) return Error(`未找到扩张计划：${idOrTarget}`);
            pushInterShardCommand({ toShard: plan.homeShard, type: 'expand.remove', payload: { id: plan.id } } as any);
            global.log(`expand 已投递删除: id=${plan.id}`);
            return OK;
        },

        /**
         * 列出当前可见的扩张计划。
         */
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

/**
 * 根据 shard 读取对应 inter-shard 根数据。
 */
const readRoot = (shardName: string) => shardName === Game.shard.name ? readInterShardLocalRoot() : readInterShardRemoteRoot(shardName);

/**
 * 聚合本地与远端 shard 的扩张计划视图。
 */
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

/**
 * 按计划 ID 或目标房间查找扩张计划。
 */
const findPlan = (idOrTarget: string) => {
    for (const p of listPlans()) {
        if (p.id === idOrTarget) return p;
        if (p.targetRoom === idOrTarget) return p;
    }
    return null;
};
