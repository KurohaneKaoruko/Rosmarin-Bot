import { betterMoveApi } from '@/modules/infra/BetterMove/index';
import { MoveWorkTileCandidate, readMoveWorkTileCandidates } from '@/modules/shared/moveWork';

const isSamePosition = (left: RoomPosition, right: RoomPosition): boolean => {
    return left.roomName === right.roomName && left.x === right.x && left.y === right.y;
};

const isPositionInCandidate = (pos: RoomPosition, candidate: MoveWorkTileCandidate): boolean => {
    return candidate.pos.roomName === pos.roomName && candidate.pos.getRangeTo(pos) <= candidate.range;
};

const isPositionInCandidates = (pos: RoomPosition, candidates: MoveWorkTileCandidate[]): boolean => {
    return candidates.some((candidate) => isPositionInCandidate(pos, candidate));
};

const isCompatHardLockTile = (creep: Creep, pos: RoomPosition): boolean => {
    if (!creep.memory?.dontPullMe) return false;
    return isSamePosition(creep.pos, pos);
};

/**
 * 判断某个位置是否应被视为该 creep 的工位保护格。
 *
 * @remarks
 * 这里保持与 `超级移动优化 1.0.1` 一致的接入方式：
 * - 默认在这里直接解析 creep 当前的工作范围；
 * - 不在工作态时应返回 `true`，避免误伤正常让路；
 * - `dontPullMe` 仅作为项目内兼容硬锁，显式要求“只允许留在原地”。
 */
function isProjectWorkTile(creep: Creep | PowerCreep, pos: RoomPosition): boolean {
    if (!(creep instanceof Creep)) return true;

    if (isCompatHardLockTile(creep, pos)) return true;
    if (creep.memory?.dontPullMe) return false;
    const candidates = readMoveWorkTileCandidates(creep);
    return candidates.length === 0 || isPositionInCandidates(pos, candidates);
}

/**
 * BetterMove 运行时接入模块：
 * - `start` 重置每 tick 的移动意图状态；
 * - `end` 在工位保护约束下统一结算移动。
 */
const MoveModule: RuntimeModule = {
    start: () => {
        betterMoveApi.preTickBetterMove();
    },
    end: () => {
        betterMoveApi.endTickResolve(isProjectWorkTile);
    }
};

export { MoveModule };
