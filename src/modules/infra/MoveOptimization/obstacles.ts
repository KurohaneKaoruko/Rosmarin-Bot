// @ts-nocheck

/**
 * BetterMove 障碍物判定。
 * @description
 * 单独拆出来后，costMatrix 构建、checkRoom、临时绕路都复用同一套规则，
 * 同时方便同步外部轮子的 bugfix。
 */

export function buildObstacleMap() {
    const obstacles = Object.create(null);
    for (let i = OBSTACLE_OBJECT_TYPES.length; i--;) {
        obstacles[OBSTACLE_OBJECT_TYPES[i]] = 1;
    }
    return obstacles;
}

export function isClosedRampart(structure) {
    return structure.structureType == STRUCTURE_RAMPART && !structure.my && !structure.isPublic;
}

/**
 * 查看指定位置是否有挡路建筑。
 * @description
 * 与 1.0.0 轮子保持一致：
 * - `ignoreStructures` 只忽略“可破坏的他人阻塞建筑”；
 * - 己方阻塞建筑仍然视为不可通行，否则会把己方 spawn/extension 误判成可穿。
 */
export function isObstacleStructure(room, pos, ignoreStructures, obstacles) {
    const consSite = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos);
    if (0 in consSite && consSite[0].my && obstacles[consSite[0].structureType]) {
        return true;
    }

    const structures = room.lookForAt(LOOK_STRUCTURES, pos);
    for (let i = structures.length; i--;) {
        const s = structures[i];
        if (!s.hits || s.ticksToDeploy) {
            return true;
        } else if (obstacles[s.structureType]) {
            if (s.my || !ignoreStructures) {
                return true;
            }
        } else if (!ignoreStructures && isClosedRampart(s)) {
            return true;
        }
    }

    return false;
}
