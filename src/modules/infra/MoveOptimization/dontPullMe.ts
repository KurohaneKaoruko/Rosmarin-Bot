/**
 * 原型方法包装工具。
 * @description
 * 抽到独立文件后，BetterMove 的主逻辑文件可以专注于寻路与缓存，
 * dontPullMe 这类“行为层补丁”则独立维护。
 */
type ProtoValue = object | string | number | boolean | symbol | bigint | null | undefined;
type ProtoMethodArgs = ProtoValue[];
type ProtoMethod = (...args: ProtoMethodArgs) => ProtoValue;
type AnyProto = object;
type CreepWithMoveMemory = Creep & {
    memory: CreepMemory & {
        _lpv?: number;
        _lpt?: number;
        dontPullMe?: boolean;
    };
} & Record<string, ProtoMethod | undefined>;

export function wrapProtoMethod(proto: AnyProto, originalName: string, backupName: string, wrap: ProtoMethod) {
    const protoMap = proto as Record<string, ProtoMethod | undefined>;
    if (!protoMap[backupName] || protoMap[backupName] === protoMap[originalName]) {
        protoMap[backupName] = protoMap[originalName];
    }
    protoMap[originalName] = wrap;
}

/**
 * moveTo 前更新 dontPullMe 状态。
 * @description
 * - 真正位于房间边缘时，锁定 dontPullMe，避免被对穿推回出口导致抖动；
 * - 其余情况允许对穿，减少房间门口与核心区的互锁。
 */
export function updateDontPullMeForMoveTo(creep: CreepWithMoveMemory) {
    const isEdge = creep.pos.x === 0 || creep.pos.x === 49 || creep.pos.y === 0 || creep.pos.y === 49;

    // 用紧凑数字记录“上一个位置”，避免每 tick 额外创建对象。
    const currentPacked = (creep.pos.x << 6) | creep.pos.y;
    if (creep.memory._lpv === currentPacked) {
        creep.memory._lpt = (creep.memory._lpt || 0) + 1;
    } else {
        creep.memory._lpv = currentPacked;
        creep.memory._lpt = 0;
    }

    creep.memory.dontPullMe = isEdge;
}

const YIELDABLE_ACTIONS = new Set([
    'build',
    'repair',
    'upgradeController'
]);
const ACTION_OK = 0;

function shouldLockActionPosition(actionName: string, actionResult: number) {
    if (actionResult !== ACTION_OK) return false;
    if (YIELDABLE_ACTIONS.has(actionName)) return false;
    return true;
}

/**
 * 安装 dontPullMe 相关包装。
 * @description
 * - `cancelOrder` 需要单独包装，确保 BetterMove 的移动意图缓存被正确清理；
 * - 常见工作动作在执行成功后会刷新 dontPullMe 策略，避免被错误锁死或错误让位。
 */
export function installDontPullMePolicies({
    CreepPrototype,
    betterCancelOrder,
    restorePowerCreepNativeMethods,
}: {
    CreepPrototype: typeof Creep.prototype & AnyProto;
    betterCancelOrder: ProtoMethod;
    restorePowerCreepNativeMethods: () => void;
}) {
    wrapProtoMethod(CreepPrototype, 'cancelOrder', '$cancelOrder', betterCancelOrder);
    restorePowerCreepNativeMethods();

    const wrapActionSetDontPullMePolicy = (methodName: string) => {
        const backupName = `$${methodName}`;
        if (CreepPrototype[backupName]) {
            return;
        }
        wrapProtoMethod(CreepPrototype, methodName, backupName, function (this: CreepWithMoveMemory, ...args: ProtoMethodArgs) {
            const backupMethod = this[backupName];
            if (typeof backupMethod !== 'function') {
                return ERR_INVALID_TARGET;
            }
            const result = backupMethod.apply(this, args) as number;
            this.memory.dontPullMe = shouldLockActionPosition(methodName, result);
            return result;
        });
    };

    wrapActionSetDontPullMePolicy('build');
    wrapActionSetDontPullMePolicy('repair');
    wrapActionSetDontPullMePolicy('upgradeController');
    wrapActionSetDontPullMePolicy('dismantle');
    wrapActionSetDontPullMePolicy('harvest');
    wrapActionSetDontPullMePolicy('attack');
}
