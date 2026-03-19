import { inWhitelist } from '@/modules/utils/whitelist';
import { Effect, pipeEffect } from '@/framework/ai/pipeline';

// 管道上下文：传递 creep
type SignerContext = { creep: Creep };

 type SignerSnapshot = {
    creep: Creep;
    roomName: string;
    targetRoom?: string;
    avoidRooms: Set<string>;
    controller?: StructureController;
    needsAvoidInit: boolean;
 };

 type SignerDecision = SignerSnapshot & {
    shouldSign: boolean;
 };

type SignerPlan = SignerDecision & {
    markAvoid: boolean;
    nextRoom?: string;
};

// 纯判断：是否应该给控制器签名
const shouldSignController = (creep: Creep, controller: StructureController | undefined): boolean => {
    if (!controller) return false;
    if (!controller.sign) return false;
    if (controller.sign.username === creep.owner.username) return false;
    if (controller.sign.username === 'Screeps') return false;
    if (inWhitelist(controller.sign.username)) return false;
    return true;
};

// 纯计算：快照当前状态
const snapshotSigner = (ctx: SignerContext): SignerSnapshot => {
    const { creep } = ctx;
    const avoidRooms = new Set<string>(creep.memory['avoidRooms'] || []);
    return {
        creep,
        roomName: creep.room.name,
        targetRoom: creep.memory.targetRoom,
        avoidRooms,
        controller: creep.room.controller,
        needsAvoidInit: !Array.isArray(creep.memory['avoidRooms'])
    };
};

// 纯计算：是否应该签名
const decideSign = (snapshot: SignerSnapshot): SignerDecision => ({
    ...snapshot,
    shouldSign: shouldSignController(snapshot.creep, snapshot.controller)
});

// 纯计算：是否需要标记避让房间，以及下一步目标房
const decideNavigation = (decision: SignerDecision): SignerPlan => {
    const markAvoid = !decision.shouldSign && !decision.avoidRooms.has(decision.roomName);

    // 如果已有目标房间，则继续朝目标房间移动
    if (decision.targetRoom) {
        return { ...decision, markAvoid };
    }

    const exits = Object.values(Game.map.describeExits(decision.roomName) || {});
    const normalExits = exits.filter((r) => Game.map.getRoomStatus(r).status === 'normal');

    const nextRooms = normalExits.length > 0 ? normalExits : exits;
    if (nextRooms.length === 0) {
        return { ...decision, markAvoid };
    }

    const activeNextRooms = nextRooms.filter((r) => !decision.avoidRooms.has(r));
    const pool = activeNextRooms.length > 0 ? activeNextRooms : nextRooms;
    const index = Math.floor(Math.random() * pool.length);
    const nextRoom = pool[index];

    return { ...decision, markAvoid, nextRoom };
};

// 纯计算：标准化计划字段，方便统一进入副作用阶段
const normalizePlan = (plan: SignerPlan): SignerPlan => ({
    ...plan,
    nextRoom: plan.nextRoom
});

// 副作用集中执行：签名 + 路径移动 + 内存更新
const executeSignerPlan = (plan: SignerPlan) =>
    Effect.perform<SignerContext, SignerPlan>('execute-signer-plan', () => {
        const { creep } = plan;
        creep.disableAttackNotificationsOnce();

        if (plan.needsAvoidInit) {
            creep.memory['avoidRooms'] = [];
        }

        if (plan.shouldSign && plan.controller) {
            const controller = plan.controller;
            if (creep.pos.isNearTo(controller)) {
                creep.signController(controller, '');
            } else {
                creep.moveTo(controller);
            }
            return plan;
        }

        if (plan.markAvoid) {
            creep.memory['avoidRooms'] = creep.memory['avoidRooms'] || [];
            creep.memory['avoidRooms'].push(plan.roomName);
        }

        if (plan.targetRoom) {
            const onEdge = creep.pos.x <= 0 || creep.pos.x >= 49 || creep.pos.y <= 0 || creep.pos.y >= 49;
            if (onEdge || creep.room.name !== plan.targetRoom) {
                const result = creep.moveTo(
                    new RoomPosition(25, 25, plan.targetRoom),
                    { plainCost: 1, swampCost: 1 }
                );
                if (result !== ERR_NO_PATH) return plan;
            }
            delete creep.memory.targetRoom;
        }

        if (plan.nextRoom) {
            creep.memory.targetRoom = plan.nextRoom;
        }

        return plan;
    });

const signer = {
    run: (creep: Creep) => {
        pipeEffect(
            Effect.of<SignerContext, SignerContext>({ creep }),
            (eff) => eff.map(snapshotSigner),
            (eff) => eff.map(decideSign),
            (eff) => eff.map(decideNavigation),
            (eff) => eff.map(normalizePlan),
            (eff) => eff.flatMap(executeSignerPlan)
        ).run({ creep });
    }
};

export default signer;
