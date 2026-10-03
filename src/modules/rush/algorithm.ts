/**
 * rush 共享算法：八向泛洪填充（返回可达位置序列或层级代价矩阵）。
 */

/** 八向邻域（与游戏方向常量顺序一致） */
const ADJACENT_VECTORS = [
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
];

export type FloodFillOptions = {
    /** 层级上限（默认 50） */
    maxLevel?: number;
    /** 已知代价矩阵（≥costThreshold 视为不可通行） */
    costMatrix?: CostMatrix;
    costThreshold?: number;
    /** 位置数量上限 */
    threshold?: number;
    includeStartPositions?: boolean;
    returnCostMatrix?: boolean;
};

export const getFloodFillPositions = (
    roomName: string,
    startPositions: { x: number; y: number }[],
    threshold?: number,
    options: FloodFillOptions = {},
): RoomPosition[] | CostMatrix => {
    const maxLevel = options.maxLevel ?? 50;
    const costThreshold = options.costThreshold ?? 255;
    const includeStartPositions = options.includeStartPositions ?? false;

    const levelMap = new PathFinder.CostMatrix();
    const check = new PathFinder.CostMatrix();

    const queue: { x: number; y: number }[] = [];
    const result: RoomPosition[] = [];

    const terrain = Game.map.getRoomTerrain(roomName);

    for (const pos of startPositions) {
        queue.push(pos);
        if (includeStartPositions) {
            result.push(new RoomPosition(pos.x, pos.y, roomName));
        }
        levelMap.set(pos.x, pos.y, 1);
        check.set(pos.x, pos.y, 1);
    }

    outer: while (queue.length) {
        const current = queue.shift()!;
        const currentLevel = levelMap.get(current.x, current.y);

        if (currentLevel >= maxLevel + 1) {
            continue;
        }

        for (const vector of ADJACENT_VECTORS) {
            const x = current.x + vector.x;
            const y = current.y + vector.y;
            if (x < 0 || x > 49 || y < 0 || y > 49) {
                continue;
            }

            if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                continue;
            }

            if (options.costMatrix && options.costMatrix.get(x, y) >= costThreshold) {
                continue;
            }

            if (check.get(x, y) > 0) {
                continue;
            }

            levelMap.set(x, y, currentLevel + 1);
            check.set(x, y, 1);
            queue.push({ x, y });

            result.push(new RoomPosition(x, y, roomName));

            if (threshold !== undefined && result.length >= threshold) {
                break outer;
            }
        }
    }

    if (options.returnCostMatrix) {
        return levelMap;
    }

    return result;
};
