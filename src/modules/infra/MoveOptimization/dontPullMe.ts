// @ts-nocheck

/**
 * 原型方法包装工具。
 * @description
 * 抽到独立文件后，BetterMove 的主逻辑文件可以专注于寻路与缓存，
 * dontPullMe 这类“行为层补丁”则独立维护。
 */
export function wrapProtoMethod(proto, originalName, backupName, wrap) {
    if (!proto[backupName] || proto[backupName] === proto[originalName]) {
        proto[backupName] = proto[originalName];
    }
    proto[originalName] = wrap;
}

/**
 * moveTo 前更新 dontPullMe 状态。
 * @description
 * - 真正位于房间边缘时，锁定 dontPullMe，避免被对穿推回出口导致抖动；
 * - 其余情况允许对穿，减少房间门口与核心区的互锁。
 */
export function updateDontPullMeForMoveTo(creep) {
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

function shouldLockActionPosition(actionName, actionResult) {
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
}) {
    wrapProtoMethod(CreepPrototype, 'cancelOrder', '$cancelOrder', betterCancelOrder);
    restorePowerCreepNativeMethods();

    const wrapActionSetDontPullMePolicy = (methodName) => {
        const backupName = `$${methodName}`;
        if (CreepPrototype[backupName]) {
            return;
        }
        wrapProtoMethod(CreepPrototype, methodName, backupName, function (...args) {
            const result = this[backupName](...args);
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
