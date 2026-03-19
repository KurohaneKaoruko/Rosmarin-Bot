// @ts-nocheck

/**
 * BetterMove tick 生命周期入口。
 * @description
 * 把“每 tick 开始时重置哪些移动意图状态”独立出来，
 * 减少主文件在 API、原型包装、解算逻辑之间来回跳转。
 */
export function createMoveIntentLifecycle(deps) {
    function resetMoveIntentState() {
        deps.cachedMoveIntents.clear();
        deps.creepToSquad.clear();
        deps.squadToCreeps.clear();
        deps.squadNextTile.clear();
        deps.rerouteSquad.clear();
        deps.checkedTiles.clear();
        deps.setCreepIdx(1);
        deps.setSquadIdx(1);
    }

    /**
     * tick 前初始化入口。
     * 当前实现会在 `endTickResolve` / `clear` 中兜底清理，
     * 但保留显式 API 能兼容旧调用方，也方便主循环强制重置。
     */
    function preTickBetterMove() {
        resetMoveIntentState();
    }

    return {
        resetMoveIntentState,
        preTickBetterMove,
    };
}
