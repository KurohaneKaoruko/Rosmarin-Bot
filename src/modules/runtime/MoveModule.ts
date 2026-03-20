type WorkTileAwareCreep = Creep & {
    isMoveWorkTile?: (pos: RoomPosition) => boolean;
};

/**
 * 判断某个位置是否应被视为该 creep 的工位保护格。
 *
 * @remarks
 * - PowerCreep 默认放行，避免阻塞其行动；
 * - `dontPullMe` 由行为层直接锁定当前位置；
 * - 其余工位判定全部下沉到 creep 自身（`isMoveWorkTile`）。
 */
function isProjectWorkTile(creep: Creep | PowerCreep, pos: RoomPosition): boolean {
    if (!(creep instanceof Creep)) return true;

    if (creep.memory?.dontPullMe) {
        return creep.pos.roomName === pos.roomName && creep.pos.x === pos.x && creep.pos.y === pos.y;
    }

    const awareCreep = creep as WorkTileAwareCreep;
    if (typeof awareCreep.isMoveWorkTile !== 'function') return true;
    return awareCreep.isMoveWorkTile(pos);
}

/**
 * BetterMove 运行时接入模块：
 * - `start` 重置每 tick 的移动意图状态；
 * - `end` 在工位保护约束下统一结算移动。
 */
const MoveModule: RuntimeModule = {
    start: () => {
        global.BetterMove.preTickBetterMove();
    },
    end: () => {
        global.BetterMove.endTickResolve(isProjectWorkTile);
    }
};

export { MoveModule };

