import { BehaviorTree, BehaviorTreeRegistry, BtStatus, leaf, hotSwap, sequence } from '@/framework/ai/behaviorTree';

// 行为树上下文：统一传递 creep
type ClaimerContext = { creep: Creep };

const registry = new BehaviorTreeRegistry<ClaimerContext>();

const CLAIMER_BT_SLOTS = {
    MAIN: 'main'
} as const;

const runLegacy = (creep: Creep) => {
    // 如果没有目标房间
    if (!creep.memory.targetRoom) {
        creep.say('🚨 无目标');
        return;
    }

    // 如果有治疗组件并且受伤，那么治疗
    if (creep.getActiveBodyparts(HEAL) > 0 && creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }

    // 根据旗帜移动
    const name = creep.name.match(/_(\w+)/)?.[1];
    const moveflag = Game.flags[name + '-move'];
    if (moveflag) {
        if (creep.room.name !== moveflag.pos.roomName) {
            creep.memory.targetRoom = moveflag.pos.roomName;
        }
        creep.moveTo(moveflag.pos, { visualizePathStyle: { stroke: '#00ff00' } });
        return;
    }

    // 如果不在目标房间，向目标房间移动
    if (!creep.moveToTargetRoom()) return;

    const controller = creep.room.controller;
    if (!controller) return;

    if (controller.reservation && controller.reservation.username != creep.owner.username) {
        if (creep.pos.isNearTo(controller)) {
            creep.attackController(controller);
        } else {
            creep.moveTo(controller, {
                visualizePathStyle: { stroke: '#ffffff' },
                range: 1,
                maxRooms: 1
            });
        }
        return;
    }

    if (controller.my) return;

    if (creep.pos.isNearTo(controller)) {
        const result = creep.claimController(controller);
        if (creep.memory['sign']) {
            creep.signControllerIfNeeded(creep.memory['sign'], { overwrite: true });
        }
        if (result !== OK) { creep.reserveController(controller); }
    }
    else {
        creep.moveTo(controller, {
            visualizePathStyle: { stroke: '#ffffff' },
            range: 1,
            maxRooms: 1
        });
    }
};

const mainNode = leaf<ClaimerContext>(({ creep }) => {
    runLegacy(creep);
    return BtStatus.Running;
});

const tree = new BehaviorTree(
    sequence(
        hotSwap(registry, CLAIMER_BT_SLOTS.MAIN, mainNode)
    )
);

const claimer = {
    run: function (creep: Creep) {
        tree.tick({ creep });
    }
};

export default claimer;
