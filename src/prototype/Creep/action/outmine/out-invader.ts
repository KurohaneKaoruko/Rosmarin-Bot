import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

/**
 * out-invader 行为树上下文：
 * 统一透传当前 creep。
 */
type OutInvaderContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<OutInvaderContext>();

/**
 * 行为树热插拔槽位定义。
 */
const OUT_INVADER_BT_SLOTS = {
    MAIN: 'main'
} as const;

/**
 * 旧版 out-invader 行为实现。
 *
 * @remarks
 * 当前由行为树叶子节点承载该逻辑，
 * 后续可逐步拆分为更细粒度节点。
 *
 * @param creep 当前 out-invader creep。
 */
const runLegacy = (creep: Creep) => {
    if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        creep.memory.dontPullMe = false;
        creep.moveToRoom(creep.memory.targetRoom);
        return;
    }

    const invaderCores = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType === STRUCTURE_INVADER_CORE
    });

    let targets: Array<Creep | StructureInvaderCore> = [...invaderCores];
    if (targets.length === 0) {
        const hostileCreeps = getRoomTickCacheValue(creep.room, 'out_invader_hostile_creeps', () =>
            creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: (c: Creep) => !Memory['whitelist']?.includes(c.owner.username) && (
                    c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0
                )
            }) as Creep[]
        );
        targets = hostileCreeps;
    }

    if (targets.length > 0) {
        const target = creep.pos.findClosestByRange(targets);
        if (!target) return;
        if (creep.pos.inRangeTo(target, 1)) {
            const result = creep.attack(target);
            // OI 贴身攻击位属于关键工位，攻击成功后锁定当前位置，避免被对穿挤走。
            creep.memory.dontPullMe = result === OK;
        } else {
            // 追击过程允许让位，避免阻塞主路。
            creep.memory.dontPullMe = false;
            creep.moveTo(target);
        }
        return;
    }

    if (targets.length === 0) {
        // 房间已无有效目标，累计自杀计数避免长期空转。
        creep.memory.dontPullMe = false;
        creep.memory['suicideCount'] = (creep.memory['suicideCount'] || 0) + 1;
        if (creep.memory['suicideCount'] >= 10) creep.suicide();
    }
};

/**
 * 主行为叶子：每 tick 执行 legacy 逻辑。
 */
const mainNode = leaf<OutInvaderContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

/**
 * out-invader 行为树实例。
 *
 * @remarks
 * 使用 `hotSwap` 预留在线替换主节点能力。
 */
const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, OUT_INVADER_BT_SLOTS.MAIN, mainNode)
    )
);

/**
 * out-invader 角色入口。
 */
const outInvader = {
    /**
     * 运行 out-invader 行为树。
     *
     * @param creep 当前 creep。
     */
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default outInvader;
