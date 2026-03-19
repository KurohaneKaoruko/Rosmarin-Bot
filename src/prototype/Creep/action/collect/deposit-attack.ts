import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';
import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep，便于热插拔扩展
type DepositAttackContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<DepositAttackContext>();

// 热插拔槽位
const DEPOSIT_ATTACK_BT_SLOTS = {
    MAIN: 'main'
} as const;

// 复用旧逻辑：以叶子节点承载，减少行为差异
const runLegacy = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();

    // 等待绑定
    if (!creep.memory.bind) return;

    const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
    if (!bindcreep) {
        delete creep.memory.bind;
        return;
    }

    // 移动到目标房间，未到达不继续行动
    if (creep.doubleMoveToRoom(creep.memory.targetRoom, '#ff0000')) return;

    const combatHostiles = getRoomTickCacheValue(creep.room, 'deposit_attack_combat_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (c) =>
                !Memory['whitelist'].includes(c.owner.username) &&
                c.body.some((part) =>
                    part.type == ATTACK ||
                    part.type == RANGED_ATTACK ||
                    part.type == HEAL ||
                    part.type == WORK
                )
        }) as Creep[]
    );
    const deposits = getRoomTickCacheValue(creep.room, 'deposit_attack_deposits', () =>
        creep.room.find(FIND_DEPOSITS) as Deposit[]
    );
    const hostileNearDeposit = getRoomTickCacheValue(creep.room, 'deposit_attack_hostile_near_deposit', () => {
        const result: Record<string, true> = {};
        for (const hostile of combatHostiles) {
            if (deposits.some((d) => d.pos.inRangeTo(hostile.pos, 5))) result[hostile.id] = true;
        }
        return result;
    });
    const hostiles = combatHostiles.filter((c) => hostileNearDeposit[c.id] || c.pos.inRangeTo(creep, 3));

    if (hostiles.length) {
        const hostile = creep.pos.findClosestByRange(hostiles);
        if (creep.pos.isNearTo(hostile)) {
            creep.attack(hostile);
        } else {
            creep.doubleMoveTo(hostile.pos, '#ff0000');
        }
    }
};

// 主行为节点：持续执行，等待下一 tick 再评估
const mainNode = leaf<DepositAttackContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, DEPOSIT_ATTACK_BT_SLOTS.MAIN, mainNode)
    )
);

const deposit_attack = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default deposit_attack;
