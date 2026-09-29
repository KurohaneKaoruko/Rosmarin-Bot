/**
 * 外矿道路模块
 * 提供外矿道路的路径规划、缓存管理、内存管理、维护和可视化功能。
 * @module outMineRoad
 */

import { EXTERNAL_ROAD_CONFIG } from '@/constant/config';
import { RoomArray } from '@/modules/features/Planner/utils/roomArray';
import { compress, decompress } from '@/shared/compress';
import { getLayoutData, getOutMineData } from '@/shared/memory';

const hasLayoutMemory = (roomName: string): boolean => {
    const layout = getLayoutData();
    const roomLayout = layout?.[roomName];
    if (!roomLayout) return false;
    return Object.keys(roomLayout).length > 0;
};

// ============================================================
// CostMatrix 缓存管理器
// ============================================================

/**
 * CostMatrix 缓存管理器
 * @description 提供带 TTL 的 CostMatrix 缓存管理，支持增量更新和自动清理
 */
export class CostMatrixCache {
    /**
     * 获取缓存的 CostMatrix
     * @param roomName 房间名
     * @returns CostMatrix 或 undefined（如果不存在或已过期）
     */
    static get(roomName: string): CostMatrix | undefined {
        this.ensureCache();
        const cache = global.OutMineRoadCache!.costMatrix[roomName];
        if (!cache) return undefined;
        if (this.isExpired(roomName)) {
            this.invalidate(roomName);
            return undefined;
        }
        return cache.matrix;
    }

    /**
     * 设置 CostMatrix 缓存
     * @param roomName 房间名
     * @param matrix CostMatrix 实例
     * @param ttl 过期时间（ticks），默认使用配置值
     */
    static set(roomName: string, matrix: CostMatrix, ttl?: number): void {
        this.ensureCache();
        global.OutMineRoadCache!.costMatrix[roomName] = {
            matrix,
            createdAt: Game.time,
            ttl: ttl ?? EXTERNAL_ROAD_CONFIG.COST_MATRIX_TTL,
        };
    }

    /**
     * 增量更新 CostMatrix 中的单个位置
     * @param roomName 房间名
     * @param x X 坐标
     * @param y Y 坐标
     * @param cost 代价值
     * @returns 是否更新成功（缓存存在时返回 true）
     */
    static updatePosition(roomName: string, x: number, y: number, cost: number): boolean {
        const matrix = this.get(roomName);
        if (!matrix) return false;
        matrix.set(x, y, cost);
        return true;
    }

    /**
     * 检查缓存是否过期
     * @param roomName 房间名
     * @returns 是否过期
     */
    static isExpired(roomName: string): boolean {
        this.ensureCache();
        const cache = global.OutMineRoadCache!.costMatrix[roomName];
        if (!cache) return true;
        return Game.time - cache.createdAt > cache.ttl;
    }

    /**
     * 清理所有过期缓存
     * @returns 清理的缓存数量
     */
    static cleanup(): number {
        this.ensureCache();
        let count = 0;
        const costMatrix = global.OutMineRoadCache!.costMatrix;
        for (const roomName in costMatrix) {
            if (this.isExpired(roomName)) {
                delete costMatrix[roomName];
                count++;
            }
        }
        return count;
    }

    /**
     * 使指定房间的缓存失效
     * @param roomName 房间名
     */
    static invalidate(roomName: string): void {
        this.ensureCache();
        delete global.OutMineRoadCache!.costMatrix[roomName];
    }

    /**
     * 清除所有缓存
     */
    static clear(): void {
        this.ensureCache();
        global.OutMineRoadCache!.costMatrix = {};
    }

    /**
     * 获取缓存统计信息
     * @returns 缓存统计
     */
    static getStats(): { total: number; expired: number; rooms: string[] } {
        this.ensureCache();
        const costMatrix = global.OutMineRoadCache!.costMatrix;
        const rooms = Object.keys(costMatrix);
        let expired = 0;
        for (const roomName of rooms) {
            if (this.isExpired(roomName)) expired++;
        }
        return { total: rooms.length, expired, rooms };
    }

    /**
     * 确保全局缓存对象存在
     */
    private static ensureCache(): void {
        if (!global.OutMineRoadCache) {
            global.OutMineRoadCache = {
                costMatrix: {},
            };
        }
        if (!global.OutMineRoadCache.costMatrix) {
            global.OutMineRoadCache.costMatrix = {};
        }
    }
}


// ============================================================
// 道路内存管理器
// ============================================================

/**
 * 道路内存管理器
 * @description 管理道路数据的新格式存储，按目标位置独立存储路径
 */
export class RoadMemory {
    private static groupPositionsCache: {
        [key: string]: { lastUpdate: number; positions: RoomPosition[] };
    } = {};
    /**
     * 已解码的路线缓存（key 为 `源房:目标房`）。
     *
     * @remarks
     * 路线在内存里存的是 `[房名, 压缩xy]`，读出来要逐点 `new RoomPosition`；
     * 引擎侧每次构造都要解析一遍房名，成本不低。而 `getAllPaths` 会被每个
     * 正在跨房的中转 creep、以及每 tick 的工地维护反复调用，调用方都只读，
     * 所以按 `RoadData.lastUpdate` 缓存整个解码结果。
     *
     * 注意：返回值是进程内共享对象，调用方**不得就地修改**其中的数组或 Map。
     */
    private static allPathsCache: {
        [key: string]: { lastUpdate: number; paths: Map<string, RoomPosition[]> };
    } = {};
    private static roomRoadIndexCacheTick = -1;
    private static roomRoadIndexCache: Record<string, number[]> = {};

    /**
     * 获取指定目标房间的路线组
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 路线组数据或 undefined
     */
    static getRouteGroup(sourceRoom: string, targetRoom: string): OutMineRoadRouteGroup | undefined {
        const mem = this.getMemory(sourceRoom);
        if (!mem?.routes) return undefined;
        return mem.routes[targetRoom] as OutMineRoadRouteGroup;
    }

    /**
     * 设置指定目标的路径数据
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @param targetPos 目标位置 "x:y"
     * @param positions 道路位置数组（按顺序）
     */
    static setPath(sourceRoom: string, targetRoom: string, targetPos: string, positions: RoomPosition[]): void {
        this.ensureMemory(sourceRoom);
        const mem = getOutMineData(sourceRoom).RoadData!;
        
        if (!mem.routes[targetRoom]) {
            mem.routes[targetRoom] = {
                paths: {},
                createdAt: Game.time,
                status: 'pending',
            };
        }

        const group = mem.routes[targetRoom] as OutMineRoadRouteGroup;
        
        // 按顺序存储路径
        const path: Array<[string, number]> = positions.map(pos => [pos.roomName, compress(pos.x, pos.y)]);

        group.paths[targetPos] = {
            path,
            length: positions.length,
        };
        
        mem.lastUpdate = Game.time;
        delete this.groupPositionsCache[`${sourceRoom}:${targetRoom}`];
        delete this.allPathsCache[`${sourceRoom}:${targetRoom}`];
    }

    /**
     * 批量设置多个目标的路径
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @param pathsMap 路径映射 { "x:y": positions[] }
     */
    static setPaths(sourceRoom: string, targetRoom: string, pathsMap: Map<string, RoomPosition[]>): void {
        this.ensureMemory(sourceRoom);
        const mem = getOutMineData(sourceRoom).RoadData!;
        
        mem.routes[targetRoom] = {
            paths: {},
            createdAt: Game.time,
            status: 'pending',
        };

        const group = mem.routes[targetRoom] as OutMineRoadRouteGroup;

        for (const [targetPos, positions] of pathsMap) {
            const path: Array<[string, number]> = positions.map(pos => [pos.roomName, compress(pos.x, pos.y)]);
            group.paths[targetPos] = {
                path,
                length: positions.length,
            };
        }
        
        mem.lastUpdate = Game.time;
        delete this.groupPositionsCache[`${sourceRoom}:${targetRoom}`];
        delete this.allPathsCache[`${sourceRoom}:${targetRoom}`];
    }

    /**
     * 获取指定目标的路径
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @param targetPos 目标位置 "x:y"
     * @returns RoomPosition 数组（按顺序）
     */
    static getPath(sourceRoom: string, targetRoom: string, targetPos: string): RoomPosition[] | undefined {
        const group = this.getRouteGroup(sourceRoom, targetRoom);
        if (!group?.paths?.[targetPos]) return undefined;

        const pathData = group.paths[targetPos];
        return pathData.path.map(([roomName, compressed]) => {
            const [x, y] = decompress(compressed);
            return new RoomPosition(x, y, roomName);
        });
    }

    /**
     * 读取某源房外矿路线数据的版本号（`RoadData.lastUpdate`）。
     *
     * @remarks
     * `setPath` / `setPaths` / `deleteRoute` 都会推进它。调用方若持有从
     * `getAllPaths` 派生出来的缓存（例如按房间切分的路线索引），可以用这个
     * 版本号做失效判断——比重新解码整条路线便宜得多。
     *
     * @param sourceRoom 源头房间名。
     * @returns 版本号；该源房还没有路线数据时返回 0。
     */
    static getRouteVersion(sourceRoom: string): number {
        return this.getMemory(sourceRoom)?.lastUpdate ?? 0;
    }

    /**
     * 获取目标房间内所有目标的路径
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 路径映射 { "x:y": positions[] }
     * @remarks
     * 结果按 `RoadData.lastUpdate` 缓存，同 tick 内多次调用（多个 creep、
     * 多轮工地维护）只解压一次。**返回值为共享对象，调用方只读。**
     */
    static getAllPaths(sourceRoom: string, targetRoom: string): Map<string, RoomPosition[]> {
        const mem = this.getMemory(sourceRoom);
        const group = this.getRouteGroup(sourceRoom, targetRoom);
        if (!group?.paths) return new Map<string, RoomPosition[]>();

        const cacheKey = `${sourceRoom}:${targetRoom}`;
        const lastUpdate = mem?.lastUpdate;
        if (lastUpdate !== undefined) {
            const cached = this.allPathsCache[cacheKey];
            if (cached && cached.lastUpdate === lastUpdate) {
                return cached.paths;
            }
        }

        const result = new Map<string, RoomPosition[]>();
        for (const targetPos in group.paths) {
            const pathData = group.paths[targetPos];
            const positions = pathData.path.map(([roomName, compressed]) => {
                const [x, y] = decompress(compressed);
                return new RoomPosition(x, y, roomName);
            });
            result.set(targetPos, positions);
        }

        if (lastUpdate !== undefined) {
            this.allPathsCache[cacheKey] = { lastUpdate, paths: result };
        }
        return result;
    }

    /**
     * 获取指定路线组的所有唯一道路位置
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 唯一道路位置数组
     */
    static getGroupPositions(sourceRoom: string, targetRoom: string): RoomPosition[] {
        const mem = this.getMemory(sourceRoom);
        const group = this.getRouteGroup(sourceRoom, targetRoom);
        if (!group?.paths) return [];

        if (mem?.lastUpdate !== undefined) {
            const cacheKey = `${sourceRoom}:${targetRoom}`;
            const cached = this.groupPositionsCache[cacheKey];
            if (cached && cached.lastUpdate === mem.lastUpdate) {
                return cached.positions;
            }
        }

        const positions: RoomPosition[] = [];
        const seen = new Set<string>();

        for (const targetPos in group.paths) {
            const pathData = group.paths[targetPos];
            for (const [roomName, compressed] of pathData.path) {
                const key = `${roomName}:${compressed}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    const [x, y] = decompress(compressed);
                    positions.push(new RoomPosition(x, y, roomName));
                }
            }
        }
        if (mem?.lastUpdate !== undefined) {
            this.groupPositionsCache[`${sourceRoom}:${targetRoom}`] = {
                lastUpdate: mem.lastUpdate,
                positions,
            };
        }
        return positions;
    }

    /**
     * 获取某个房间内所有“已规划但未必已建成”的外矿道路坐标。
     *
     * @remarks
     * - 这里直接扫描所有外矿路线，把属于 `roomName` 的路径点统一汇总；
     * - 结果按 tick 做进程内缓存，避免同 tick 内被多次寻路回调反复扫描整份外矿内存；
     * - 返回值是压缩后的 `(x,y)` 整数，调用方可按需解压，减少临时对象分配。
     *
     * @param roomName 需要查询的房间名。
     * @returns 房间内所有已规划道路的压缩坐标数组。
     */
    static getPlannedRoadsInRoom(roomName: string): number[] {
        if (this.roomRoadIndexCacheTick !== Game.time) {
            this.rebuildRoomRoadIndexCache();
        }
        return this.roomRoadIndexCache[roomName] || [];
    }

    /**
     * 重建“房间 -> 规划道路坐标”索引。
     */
    private static rebuildRoomRoadIndexCache(): void {
        const nextCache: Record<string, number[]> = {};
        const roomSeenMap: Record<string, Set<number>> = {};
        const outMineData = getOutMineData();

        for (const sourceRoom in outMineData) {
            const roadData = outMineData[sourceRoom]?.RoadData;
            if (!roadData?.routes) continue;

            for (const targetRoom in roadData.routes) {
                const group = roadData.routes[targetRoom] as OutMineRoadRouteGroup | undefined;
                if (!group?.paths) continue;

                for (const targetPosKey in group.paths) {
                    const pathData = group.paths[targetPosKey];
                    if (!Array.isArray(pathData?.path)) continue;

                    for (const [pathRoomName, compressed] of pathData.path) {
                        const seen = (roomSeenMap[pathRoomName] ||= new Set<number>());
                        if (seen.has(compressed)) continue;
                        seen.add(compressed);
                        (nextCache[pathRoomName] ||= []).push(compressed);
                    }
                }
            }
        }

        this.roomRoadIndexCache = nextCache;
        this.roomRoadIndexCacheTick = Game.time;
    }

    /**
     * 删除指定路线
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 是否删除成功
     */
    static deleteRoute(sourceRoom: string, targetRoom: string): boolean {
        const mem = this.getMemory(sourceRoom);
        if (!mem?.routes?.[targetRoom]) return false;
        delete mem.routes[targetRoom];
        mem.lastUpdate = Game.time;
        delete this.groupPositionsCache[`${sourceRoom}:${targetRoom}`];
        delete this.allPathsCache[`${sourceRoom}:${targetRoom}`];
        return true;
    }

    /**
     * 获取所有路线的目标房间列表
     * @param sourceRoom 源头房间名
     * @returns 目标房间名数组
     */
    static getRouteTargets(sourceRoom: string): string[] {
        const mem = this.getMemory(sourceRoom);
        if (!mem?.routes) return [];
        return Object.keys(mem.routes);
    }

    /**
     * 获取统计信息
     * @param sourceRoom 源头房间名
     * @returns 统计信息
     */
    static getStats(sourceRoom: string): {
        routeCount: number;
        pathCount: number;
        totalLength: number;
        roomCount: number;
    } {
        const mem = this.getMemory(sourceRoom);
        
        let totalLength = 0;
        let pathCount = 0;
        const roomSet = new Set<string>();
        
        if (mem?.routes) {
            for (const targetRoom in mem.routes) {
                const group = mem.routes[targetRoom] as OutMineRoadRouteGroup;
                if (group.paths) {
                    for (const targetPos in group.paths) {
                        const pathData = group.paths[targetPos];
                        pathCount++;
                        totalLength += pathData.length;
                        for (const [roomName] of pathData.path) {
                            roomSet.add(roomName);
                        }
                    }
                }
            }
        }

        return {
            routeCount: mem?.routes ? Object.keys(mem.routes).length : 0,
            pathCount,
            totalLength,
            roomCount: roomSet.size,
        };
    }

    /**
     * 验证数据完整性
     * @param sourceRoom 源头房间名
     * @returns 验证结果
     */
    static validate(sourceRoom: string): {
        valid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];
        const mem = this.getMemory(sourceRoom);

        if (!mem) {
            return { valid: true, errors: [] };
        }

        if (!mem.routes) {
            errors.push('routes 对象不存在');
            return { valid: false, errors };
        }

        for (const targetRoom in mem.routes) {
            const group = mem.routes[targetRoom] as OutMineRoadRouteGroup;
            
            if (!group.paths || typeof group.paths !== 'object') {
                errors.push(`${targetRoom}: paths 无效`);
                continue;
            }

            for (const targetPos in group.paths) {
                const pathData = group.paths[targetPos];
                
                if (!Array.isArray(pathData.path)) {
                    errors.push(`${targetRoom}/${targetPos}: path 数组无效`);
                    continue;
                }

                if (pathData.length !== pathData.path.length) {
                    errors.push(`${targetRoom}/${targetPos}: length 不匹配`);
                }

                for (const [roomName, compressed] of pathData.path) {
                    const [x, y] = decompress(compressed);
                    if (x < 0 || x > 49 || y < 0 || y > 49) {
                        errors.push(`${targetRoom}/${targetPos}/${roomName}: 坐标越界 (${x},${y})`);
                    }
                }
            }
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * 更新路线状态
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @param status 新状态
     */
    static updateStatus(sourceRoom: string, targetRoom: string, status: 'active' | 'pending' | 'damaged'): void {
        const group = this.getRouteGroup(sourceRoom, targetRoom);
        if (group) {
            group.status = status;
            group.lastCheck = Game.time;
        }
    }

    /**
     * 获取道路内存
     */
    private static getMemory(sourceRoom: string): OutMineRoadMemory | undefined {
        return getOutMineData()?.[sourceRoom]?.RoadData;
    }

    /**
     * 确保内存结构存在
     */
    private static ensureMemory(sourceRoom: string): void {
        const outMineData = getOutMineData();
        if (!outMineData[sourceRoom]) outMineData[sourceRoom] = {} as any;
        if (!outMineData[sourceRoom].RoadData) {
            outMineData[sourceRoom].RoadData = {
                routes: {},
            };
        }
    }
}


// ============================================================
// 路径规划器
// ============================================================

/**
 * 路径规划器
 * @description 优化路径计算逻辑，支持道路复用和 CPU 保护
 */
export class PathPlanner {
    /** 当前 tick 已计算的路径数 */
    private static pathsThisTick = 0;
    /** 上次重置的 tick */
    private static lastResetTick = 0;

    /**
     * 计算单个目标的路径
     * @param sourceRoom 源头房间名
     * @param target 目标位置
     * @returns 路径位置数组，或 undefined（如果计算失败或 CPU 不足）
     */
    static planPath(sourceRoom: string, target: RoomPosition): RoomPosition[] | undefined {
        // CPU 保护检查
        if (!this.canPlanPath()) {
            return undefined;
        }

        const room = Game.rooms[sourceRoom];
        if (!room) return undefined;

        const startPos = room.getCenter();

        const result = PathFinder.search(startPos, { pos: target, range: 1 }, {
            plainCost: EXTERNAL_ROAD_CONFIG.PLAIN_COST,
            swampCost: EXTERNAL_ROAD_CONFIG.SWAMP_COST,
            maxOps: EXTERNAL_ROAD_CONFIG.MAX_OPS,
            roomCallback: (roomName) => this.buildCostMatrix(roomName),
        });

        this.pathsThisTick++;

        if (result.incomplete) {
            return undefined;
        }

        return result.path;
    }

    /**
     * 批量计算多个目标的路径（按距离排序，复用已计算路径）
     * @param sourceRoom 源头房间名
     * @param targets 目标位置数组
     * @returns 路径结果映射 { targetKey: positions[] }，targetKey 格式为 "roomName:x:y"
     */
    static planPaths(sourceRoom: string, targets: RoomPosition[]): Map<string, RoomPosition[]> {
        const results = new Map<string, RoomPosition[]>();
        
        if (targets.length === 0) return results;

        const room = Game.rooms[sourceRoom];
        if (!room) return results;

        const startPos = room.getCenter();

        // 按距离排序（近的先计算）
        const sortedTargets = [...targets].sort((a, b) => {
            const distA = Game.map.getRoomLinearDistance(sourceRoom, a.roomName);
            const distB = Game.map.getRoomLinearDistance(sourceRoom, b.roomName);
            return distA - distB;
        });

        const reusedRoadCoordsByRoom = new Map<string, Set<number>>();

        for (const target of sortedTargets) {
            // CPU 保护检查
            if (!this.canPlanPath()) {
                break;
            }

            const perSearchMatrixCache = new Map<string, CostMatrix | false>();
            const result = PathFinder.search(startPos, { pos: target, range: 1 }, {
                plainCost: EXTERNAL_ROAD_CONFIG.PLAIN_COST,
                swampCost: EXTERNAL_ROAD_CONFIG.SWAMP_COST,
                maxOps: EXTERNAL_ROAD_CONFIG.MAX_OPS,
                roomCallback: (roomName) => {
                    const cachedMatrix = perSearchMatrixCache.get(roomName);
                    if (cachedMatrix !== undefined) return cachedMatrix;

                    const baseMatrix = this.buildCostMatrix(roomName);
                    if (!baseMatrix) {
                        perSearchMatrixCache.set(roomName, false);
                        return false;
                    }

                    const matrix = baseMatrix.clone();
                    const reused = reusedRoadCoordsByRoom.get(roomName);
                    if (reused) {
                        for (const compressed of reused) {
                            const [x, y] = decompress(compressed);
                            matrix.set(x, y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                        }
                    }

                    perSearchMatrixCache.set(roomName, matrix);
                    return matrix;
                },
            });

            this.pathsThisTick++;

            if (!result.incomplete && result.path.length > 0) {
                // 使用 "roomName:x:y" 作为 key，确保同一房间的多个目标不会互相覆盖
                const targetKey = `${target.roomName}:${target.x}:${target.y}`;
                results.set(targetKey, result.path);

                // 将新路径加入已计算集合
                for (const pos of result.path) {
                    let roomCoords = reusedRoadCoordsByRoom.get(pos.roomName);
                    if (!roomCoords) {
                        roomCoords = new Set<number>();
                        reusedRoadCoordsByRoom.set(pos.roomName, roomCoords);
                    }
                    roomCoords.add(compress(pos.x, pos.y));
                    // 更新 CostMatrix 缓存
                    CostMatrixCache.updatePosition(pos.roomName, pos.x, pos.y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                }
            }
        }

        return results;
    }

    /**
     * 构建房间的 CostMatrix
     * @param roomName 房间名
     * @returns CostMatrix 或 false（不可通行）
     */
    static buildCostMatrix(roomName: string): CostMatrix | false {
        // 尝试从缓存获取
        const cached = CostMatrixCache.get(roomName);
        if (cached) return cached;

        const room = Game.rooms[roomName];
        const costs = new PathFinder.CostMatrix();

        // 将布局中的道路位置设置为 ROAD_COST
        const layoutData = getLayoutData()?.[roomName];
        if (layoutData) {
            for (const structType in layoutData) {
                const positions = layoutData[structType];
                if (!Array.isArray(positions) || positions.length === 0) continue;
                const isRoadLike = structType === STRUCTURE_ROAD || structType === STRUCTURE_CONTAINER || structType === STRUCTURE_RAMPART;
                const isObstacle = (OBSTACLE_OBJECT_TYPES as string[]).includes(structType) || structType === STRUCTURE_WALL;
                for (const compressed of positions) {
                    const [x, y] = decompress(compressed);
                    if (isRoadLike) {
                        costs.set(x, y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                    } else if (isObstacle) {
                        costs.set(x, y, 255);
                    }
                }
            }
        }

        if (room) {
            // 有视野的房间：添加建筑和 creep 代价
            const structures = room.find(FIND_STRUCTURES);
            for (const struct of structures) {
                if (struct.structureType === STRUCTURE_ROAD) {
                    costs.set(struct.pos.x, struct.pos.y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                } else if (
                    struct.structureType !== STRUCTURE_CONTAINER &&
                    struct.structureType !== STRUCTURE_RAMPART
                ) {
                    // 不可通行建筑
                    costs.set(struct.pos.x, struct.pos.y, 255);
                } else if (
                    struct.structureType === STRUCTURE_RAMPART &&
                    !(struct as StructureRampart).my &&
                    !((struct as StructureRampart).isPublic)
                ) {
                    // 敌方 rampart
                    costs.set(struct.pos.x, struct.pos.y, 255);
                }
            }

            // 建造工地
            const sites = room.find(FIND_CONSTRUCTION_SITES);
            for (const site of sites) {
                if (site.structureType === STRUCTURE_ROAD) {
                    costs.set(site.pos.x, site.pos.y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                }
            }
        }

        // 缓存结果
        CostMatrixCache.set(roomName, costs);
        return costs;
    }

    /**
     * 检查是否可以继续计算路径（CPU 保护）
     * @returns 是否可以继续
     */
    static canPlanPath(): boolean {
        // 重置计数器
        if (Game.time !== this.lastResetTick) {
            this.pathsThisTick = 0;
            this.lastResetTick = Game.time;
        }

        const maxPathsPerTick = EXTERNAL_ROAD_CONFIG.MAX_PATHS_PER_TICK;
        if (maxPathsPerTick && this.pathsThisTick >= maxPathsPerTick) return false;

        // 检查 CPU 使用率（基于 tickLimit）
        const cpuUsed = Game.cpu.getUsed();
        const cpuLimit = Game.cpu.tickLimit || 500;
        if (cpuUsed / cpuLimit > EXTERNAL_ROAD_CONFIG.CPU_THRESHOLD) {
            return false;
        }

        return true;
    }

    /**
     * 获取当前 tick 的路径计算统计
     */
    static getStats(): { pathsThisTick: number; canPlan: boolean; cpuUsage: number } {
        const cpuLimit = Game.cpu.tickLimit || 500;
        return {
            pathsThisTick: this.pathsThisTick,
            canPlan: this.canPlanPath(),
            cpuUsage: Game.cpu.getUsed() / cpuLimit,
        };
    }

    /**
     * 重置路径计算计数器（用于测试）
     */
    static reset(): void {
        this.pathsThisTick = 0;
        this.lastResetTick = Game.time;
    }
}


// ============================================================
// 道路建造器
// ============================================================

/**
 * 道路建造器
 * @description 管理道路建造工地的创建
 */
export class RoadBuilder {
    /**
     * 解析目标房间的外矿基础设施路径。
     * @description
     * - 优先复用已缓存的路径，避免重复寻路。
     * - 若还没有路径内存，则按 source/mineral 重新规划并写回内存。
     */
    private static resolveInfrastructurePaths(sourceRoomName: string, targetRoom: Room): Map<string, RoomPosition[]> {
        const targetRoomName = targetRoom.name;

        // 检查是否已有路线数据。
        const existingPaths = RoadMemory.getAllPaths(sourceRoomName, targetRoomName);
        if (existingPaths.size > 0) return existingPaths;

        if (!hasLayoutMemory(sourceRoomName)) return new Map<string, RoomPosition[]>();

        // 没有缓存时才重新规划路径。
        const targets = this.getTargetPositions(targetRoom);
        if (targets.length === 0) return new Map<string, RoomPosition[]>();

        const pathResults = PathPlanner.planPaths(sourceRoomName, targets);
        if (pathResults.size === 0) return new Map<string, RoomPosition[]>();

        // PathPlanner 输出 key 为 "roomName:x:y"，这里统一压缩回内存使用的 "x:y"。
        const pathsToSave = new Map<string, RoomPosition[]>();
        for (const [targetKey, positions] of pathResults) {
            const parts = targetKey.split(':');
            const posKey = `${parts[1]}:${parts[2]}`;
            pathsToSave.set(posKey, positions);
        }

        if (pathsToSave.size === 0) return new Map<string, RoomPosition[]>();

        RoadMemory.setPaths(sourceRoomName, targetRoomName, pathsToSave);
        return pathsToSave;
    }

    /**
     * 仅为目标房间补齐外矿 container 工地。
     * @description
     * container 不应该受道路 RCL 门槛影响，因此单独暴露一个轻量入口：
     * - 允许在低等级外矿阶段先把 container 工地落下；
     * - road 仍然由 `createRoadSites` 按等级与间隔控制。
     */
    static ensureContainerSites(sourceRoom: Room, targetRoom: Room): number {
        const pathsToUse = this.resolveInfrastructurePaths(sourceRoom.name, targetRoom);
        const containerAnchors = this.resolveContainerAnchors(sourceRoom, targetRoom, pathsToUse);
        return this.createContainerSites(targetRoom, containerAnchors);
    }

    /**
     * 为目标房间创建道路建造工地
     * @param sourceRoom 源头房间
     * @param targetRoom 目标房间
     * @returns 创建的工地数量
     */
    static createRoadSites(sourceRoom: Room, targetRoom: Room): number {
        const sourceRoomName = sourceRoom.name;
        const pathsToUse = this.resolveInfrastructurePaths(sourceRoomName, targetRoom);

        // 外矿基础设施统一由 externalRoad 模块管理：
        // 道路工地与 source/mineral 的 container 工地都在这里集中创建，
        // 避免再由 out-harvest / out-mineral 在运行时临时落地工地。
        const containerAnchors = this.resolveContainerAnchors(sourceRoom, targetRoom, pathsToUse);
        if (pathsToUse.size === 0) {
            // 路径完全失败时无法铺 road，但 container 仍可退化到“资源点邻接保底落点”。
            return this.createContainerSites(targetRoom, containerAnchors);
        }
        const roadSiteCount = this.createSitesFromPaths(
            sourceRoomName,
            pathsToUse,
            new Set(Array.from(containerAnchors.values()).map((pos) => `${pos.roomName}:${pos.x}:${pos.y}`))
        );
        const containerSiteCount = this.createContainerSites(targetRoom, containerAnchors);
        return roadSiteCount + containerSiteCount;
    }

    /**
     * 从多条路径创建建造工地
     * @param sourceRoomName 源头房间名
     * @param paths 路径映射
     * @returns 创建的工地数量
     */
    private static createSitesFromPaths(
        _sourceRoomName: string,
        paths: Map<string, RoomPosition[]>,
        skipPositions?: Set<string>
    ): number {
        let created = 0;
        const processedPositions = new Set<string>();

        for (const [, positions] of paths) {
            for (const pos of positions) {
                // 限制单路线最大工地数
                if (created >= EXTERNAL_ROAD_CONFIG.MAX_SITES_PER_ROUTE) break;

                // 跳过已处理的位置（去重）
                const posKey = `${pos.roomName}:${pos.x}:${pos.y}`;
                if (processedPositions.has(posKey)) continue;
                processedPositions.add(posKey);
                if (skipPositions?.has(posKey)) continue;

                // 跳过房间边缘位置
                if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) continue;

                // 检查是否已有道路或工地
                const room = Game.rooms[pos.roomName];
                // 没有视野的房间无法创建建造工地，跳过
                if (!room) continue;

                const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                const hasRoad = structures.some(s => s.structureType === STRUCTURE_ROAD);
                if (hasRoad) continue;

                const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
                const hasSite = sites.some(s => s.structureType === STRUCTURE_ROAD);
                if (hasSite) continue;

                const result = pos.createConstructionSite(STRUCTURE_ROAD);
                if (result === OK) {
                    created++;
                }
            }
        }

        return created;
    }

    /**
     * 为每个 source / mineral 解析容器落点。
     * @description
     * - 若目标周围已存在 container 或 container 工地，则不再重复放置。
     * - 有路径时，优先取路径末端那个“贴着目标”的落脚格，保持与道路规划一致。
     * - 路径失败时，退化为从资源点 8 邻域里选一个最靠近发起房中心的可放置点位。
     */
    private static resolveContainerAnchors(
        sourceRoom: Room,
        targetRoom: Room,
        paths: Map<string, RoomPosition[]>
    ): Map<string, RoomPosition> {
        const anchors = new Map<string, RoomPosition>();

        for (const targetPos of this.getAnchorTargetPositions(targetRoom, paths)) {
            const targetPosKey = `${targetPos.x}:${targetPos.y}`;
            if (this.hasNearbyContainerInfrastructure(targetPos)) continue;

            const anchor =
                this.findContainerAnchorForTarget(targetPos, paths.get(targetPosKey) || []) ||
                this.findFallbackContainerAnchor(sourceRoom, targetPos);
            if (!anchor) continue;
            if (!this.canPlaceContainerAt(anchor)) continue;

            anchors.set(targetPosKey, anchor);
        }

        return anchors;
    }

    /**
     * 获取 container 锚点候选目标。
     * @description
     * 正常情况下直接以房间内真实 source/mineral 为准；
     * 若测试环境或极端场景下对象枚举为空，但路径内存里已经有目标 key，
     * 也要把这些 key 还原成目标坐标，避免已有路径却无法放 container。
     */
    private static getAnchorTargetPositions(
        targetRoom: Room,
        paths: Map<string, RoomPosition[]>
    ): RoomPosition[] {
        const positions = new Map<string, RoomPosition>();

        for (const targetPos of this.getTargetPositions(targetRoom)) {
            positions.set(`${targetPos.x}:${targetPos.y}`, targetPos);
        }

        for (const targetPosKey of paths.keys()) {
            const [xRaw, yRaw] = targetPosKey.split(':');
            const x = Number(xRaw);
            const y = Number(yRaw);
            if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
            positions.set(targetPosKey, new RoomPosition(x, y, targetRoom.name));
        }

        return Array.from(positions.values());
    }

    /**
     * 判断目标周围是否已经存在 container 或对应工地。
     */
    private static hasNearbyContainerInfrastructure(targetPos: RoomPosition): boolean {
        const hasContainer = targetPos.findInRange(FIND_STRUCTURES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER
        }).length > 0;
        if (hasContainer) return true;

        const hasContainerSite = targetPos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER
        }).length > 0;
        return hasContainerSite;
    }

    /**
     * 从路径末端反推 source / mineral 的容器锚点。
     * @description 只接受目标房内、与目标距离 1 的落脚格。
     */
    private static findContainerAnchorForTarget(targetPos: RoomPosition, positions: RoomPosition[]): RoomPosition | null {
        for (let i = positions.length - 1; i >= 0; i--) {
            const pos = positions[i];
            if (pos.roomName !== targetPos.roomName) continue;
            if (!pos.inRangeTo(targetPos, 1)) continue;
            if (pos.x <= 0 || pos.x >= 49 || pos.y <= 0 || pos.y >= 49) continue;
            return pos;
        }
        return null;
    }

    /**
     * 路径规划失败时，为 source / mineral 选择一个保底的 container 落点。
     * @description
     * 规则：
     * - 只在资源点 8 邻域中挑选；
     * - 必须是可放置 container 的格子；
     * - 选取“全局坐标距离发起房中心最近”的那个点位，尽量贴近回程方向。
     */
    private static findFallbackContainerAnchor(sourceRoom: Room, targetPos: RoomPosition): RoomPosition | null {
        const candidates: RoomPosition[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = targetPos.x + dx;
                const y = targetPos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                const pos = new RoomPosition(x, y, targetPos.roomName);
                if (!this.canPlaceContainerAt(pos)) continue;
                candidates.push(pos);
            }
        }

        if (candidates.length <= 0) return null;

        const sourceCenter = sourceRoom.getCenter();
        const sourceWorld = this.toWorldCoord(sourceCenter);
        if (!sourceWorld) return candidates[0];

        candidates.sort((a, b) => {
            const aWorld = this.toWorldCoord(a);
            const bWorld = this.toWorldCoord(b);
            const aDistance = aWorld ? Math.max(Math.abs(aWorld.x - sourceWorld.x), Math.abs(aWorld.y - sourceWorld.y)) : Infinity;
            const bDistance = bWorld ? Math.max(Math.abs(bWorld.x - sourceWorld.x), Math.abs(bWorld.y - sourceWorld.y)) : Infinity;
            if (aDistance !== bDistance) return aDistance - bDistance;
            if (a.x !== b.x) return b.x - a.x;
            return b.y - a.y;
        });

        return candidates[0];
    }

    /**
     * 把房间坐标转换成跨房间可比较的“全局平面坐标”。
     * @description
     * 这里只用于比较“哪个资源邻格更接近发起房中心”，不参与真实寻路。
     */
    private static toWorldCoord(pos: RoomPosition): { x: number; y: number } | null {
        const parsed = this.parseRoomName(pos.roomName);
        if (!parsed) return null;
        return {
            x: parsed.x * 50 + pos.x,
            y: parsed.y * 50 + pos.y,
        };
    }

    /**
     * 解析 Screeps 房间名到跨房间坐标。
     * @example W0N0 -> (-1, -1), E0S0 -> (0, 0)
     */
    private static parseRoomName(roomName: string): { x: number; y: number } | null {
        const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
        if (!match) return null;

        const [, ew, ewNum, ns, nsNum] = match;
        return {
            x: ew === 'W' ? -Number(ewNum) - 1 : Number(ewNum),
            y: ns === 'N' ? -Number(nsNum) - 1 : Number(nsNum),
        };
    }

    /**
     * 检查容器锚点是否允许放置 container。
     * @description
     * - road / road 工地允许共址
     * - 其他阻塞结构或阻塞工地直接跳过
     */
    private static canPlaceContainerAt(pos: RoomPosition): boolean {
        const room = Game.rooms[pos.roomName];
        if (!room) return false;
        if (room.getTerrain().get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;

        const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
        if (structures.some((s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_CONTAINER &&
            s.structureType !== STRUCTURE_RAMPART
        )) {
            return false;
        }

        const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
        if (sites.some((s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_CONTAINER &&
            s.structureType !== STRUCTURE_RAMPART
        )) {
            return false;
        }

        if (sites.some((s) => s.structureType === STRUCTURE_CONTAINER)) return false;
        if (structures.some((s) => s.structureType === STRUCTURE_CONTAINER)) return false;
        return true;
    }

    /**
     * 基于路径锚点创建外矿 container 工地。
     */
    private static createContainerSites(targetRoom: Room, anchors: Map<string, RoomPosition>): number {
        let created = 0;
        const processedPositions = new Set<string>();

        for (const [, pos] of anchors) {
            const posKey = `${pos.roomName}:${pos.x}:${pos.y}`;
            if (processedPositions.has(posKey)) continue;
            processedPositions.add(posKey);
            if (pos.roomName !== targetRoom.name) continue;
            if (!this.canPlaceContainerAt(pos)) continue;

            const result = pos.createConstructionSite(STRUCTURE_CONTAINER);
            if (result === OK) created++;
        }

        return created;
    }

    /**
     * 获取目标房间的采集目标位置
     * @param targetRoom 目标房间
     * @returns 目标位置数组
     */
    static getTargetPositions(targetRoom: Room): RoomPosition[] {
        const targets: RoomPosition[] = [];
        
        // 判断是否为中央九房（SK房）
        const isCenterRoom = /^[EW]\d*[456][NS]\d*[456]$/.test(targetRoom.name);
        
        // 添加能量源
        const sources = targetRoom.find(FIND_SOURCES);
        for (const source of sources) {
            targets.push(source.pos);
        }

        // 中央九房还需要添加矿物
        if (isCenterRoom) {
            const minerals = targetRoom.find(FIND_MINERALS);
            for (const mineral of minerals) {
                targets.push(mineral.pos);
            }
        }

        return targets;
    }

    /**
     * 重新计算指定路线
     * @param sourceRoomName 源头房间名
     * @param targetRoomName 目标房间名
     * @returns 是否成功
     */
    static recalculateRoute(sourceRoomName: string, targetRoomName: string): boolean {
        const sourceRoom = Game.rooms[sourceRoomName];
        const targetRoom = Game.rooms[targetRoomName];
        
        if (!sourceRoom || !targetRoom) return false;

        // 删除旧路线
        RoadMemory.deleteRoute(sourceRoomName, targetRoomName);
        
        // 使缓存失效
        CostMatrixCache.clear();

        // 计算新路径
        const targets = this.getTargetPositions(targetRoom);
        if (targets.length === 0) return false;

        const pathResults = PathPlanner.planPaths(sourceRoomName, targets);
        if (pathResults.size === 0) return false;

        // 转换 key 格式：从 "roomName:x:y" 到 "x:y"
        const pathsToSave = new Map<string, RoomPosition[]>();
        for (const [targetKey, positions] of pathResults) {
            const parts = targetKey.split(':');
            const posKey = `${parts[1]}:${parts[2]}`;
            pathsToSave.set(posKey, positions);
        }

        if (pathsToSave.size === 0) return false;

        // 保存到内存
        RoadMemory.setPaths(sourceRoomName, targetRoomName, pathsToSave);

        // 重新计算路线后，road / container 两类基础设施都应该由 externalRoad 统一补齐。
        this.createSitesFromPaths(sourceRoomName, pathsToSave);
        const containerAnchors = this.resolveContainerAnchors(sourceRoom, targetRoom, pathsToSave);
        this.createContainerSites(targetRoom, containerAnchors);
        
        return true;
    }

    /**
     * 检查是否应该建造道路
     * @param sourceRoom 源头房间
     * @param targetRoomName 目标房间名
     * @returns 是否应该建造
     */
    static shouldBuildRoad(sourceRoom: Room, targetRoomName: string): boolean {
        const level = sourceRoom.controller?.level || 0;
        const isCenterRoom = /^[EW]\d*[456][NS]\d*[456]$/.test(targetRoomName);

        if (isCenterRoom) {
            return level >= EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL;
        } else {
            return level >= EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL;
        }
    }
}

// ============================================================
// 道路维护器
// ============================================================

/**
 * 道路维护器
 * @description 实现道路健康检查和自动修复
 */
export class RoadMaintain {
    /** 上次检查时间缓存 */
    private static lastCheckTime: { [key: string]: number } = {};

    /**
     * 检查指定路线的道路健康状态
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 健康检查结果
     */
    static checkHealth(sourceRoom: string, targetRoom: string): {
        total: number;
        built: number;
        damaged: number;
        missing: number;
        noVision: number;
        healthPercent: number;
    } {
        const positions = RoadMemory.getGroupPositions(sourceRoom, targetRoom);
        if (positions.length === 0) {
            return { total: 0, built: 0, damaged: 0, missing: 0, noVision: 0, healthPercent: 100 };
        }

        let built = 0;
        let damaged = 0;
        let missing = 0;
        let noVision = 0;

        for (const pos of positions) {
            const room = Game.rooms[pos.roomName];
            if (!room) {
                noVision++;
                continue;
            }

            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const road = structures.find(s => s.structureType === STRUCTURE_ROAD) as StructureRoad | undefined;
            
            if (road) {
                built++;
                if (road.hits < road.hitsMax * EXTERNAL_ROAD_CONFIG.REPAIR_THRESHOLD) {
                    damaged++;
                }
            } else {
                // 检查是否有建造工地
                const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
                const hasSite = sites.some(s => s.structureType === STRUCTURE_ROAD);
                if (!hasSite) {
                    missing++;
                }
            }
        }

        const total = positions.length;
        const healthPercent = total > 0 ? (built / total) * 100 : 100;

        // 更新路线状态
        if (damaged > 0 || missing > 0) {
            RoadMemory.updateStatus(sourceRoom, targetRoom, 'damaged');
        } else if (built === total) {
            RoadMemory.updateStatus(sourceRoom, targetRoom, 'active');
        }

        return { total, built, damaged, missing, noVision, healthPercent };
    }

    /**
     * 获取需要修复的道路队列
     * @param sourceRoom 源头房间名
     * @returns 需要修复的道路位置数组（按优先级排序）
     */
    static getRepairQueue(sourceRoom: string): RoomPosition[] {
        const repairQueue: { pos: RoomPosition; priority: number }[] = [];
        const targets = RoadMemory.getRouteTargets(sourceRoom);

        for (const targetRoom of targets) {
            const positions = RoadMemory.getGroupPositions(sourceRoom, targetRoom);
            if (positions.length === 0) continue;

            for (const pos of positions) {
                const room = Game.rooms[pos.roomName];
                if (!room) continue;

                const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                const road = structures.find(s => s.structureType === STRUCTURE_ROAD) as StructureRoad | undefined;
                
                if (road && road.hits < road.hitsMax * EXTERNAL_ROAD_CONFIG.REPAIR_THRESHOLD) {
                    // 优先级：hits 越低优先级越高
                    const priority = 1 - (road.hits / road.hitsMax);
                    repairQueue.push({ pos, priority });
                }
            }
        }

        // 按优先级排序（高优先级在前）
        repairQueue.sort((a, b) => b.priority - a.priority);
        return repairQueue.map(item => item.pos);
    }

    /**
     * 检查被摧毁的道路并创建建造工地
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 创建的工地数量
     */
    static checkDestroyed(sourceRoom: string, targetRoom: string): number {
        const positions = RoadMemory.getGroupPositions(sourceRoom, targetRoom);
        if (positions.length === 0) return 0;

        let created = 0;

        for (const pos of positions) {
            // 限制单次创建数量
            if (created >= EXTERNAL_ROAD_CONFIG.MAX_SITES_PER_ROUTE) break;

            // 跳过房间边缘位置（x=0, x=49, y=0, y=49），无法在边缘创建建造工地
            if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) continue;

            const room = Game.rooms[pos.roomName];
            if (!room) continue;

            // 检查是否已有道路
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            const hasRoad = structures.some(s => s.structureType === STRUCTURE_ROAD);
            if (hasRoad) continue;

            // 检查是否已有建造工地
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            const hasSite = sites.some(s => s.structureType === STRUCTURE_ROAD);
            if (hasSite) continue;

            // 创建建造工地
            const result = pos.createConstructionSite(STRUCTURE_ROAD);
            if (result === OK) {
                created++;
            }
        }

        return created;
    }

    /**
     * 执行定期维护检查
     * @param sourceRoom 源头房间名
     * @returns 维护结果
     */
    static runMaintenance(sourceRoom: string): {
        checked: number;
        sitesCreated: number;
        needsRepair: number;
    } {
        const cacheKey = sourceRoom;
        const lastCheck = this.lastCheckTime[cacheKey] || 0;

        // 检查是否需要执行维护（默认每 500 ticks）
        if (Game.time - lastCheck < EXTERNAL_ROAD_CONFIG.MAINTAIN_INTERVAL) {
            return { checked: 0, sitesCreated: 0, needsRepair: 0 };
        }

        this.lastCheckTime[cacheKey] = Game.time;

        const targets = RoadMemory.getRouteTargets(sourceRoom);
        let sitesCreated = 0;
        let needsRepair = 0;

        for (const targetRoom of targets) {
            const health = this.checkHealth(sourceRoom, targetRoom);
            needsRepair += health.damaged;

            // 检查缺失道路并补建工地
            if (health.missing > 0) {
                sitesCreated += this.checkDestroyed(sourceRoom, targetRoom);
            }
        }

        return { checked: targets.length, sitesCreated, needsRepair };
    }

    /**
     * 获取所有路线的健康摘要
     * @param sourceRoom 源头房间名
     * @returns 健康摘要
     */
    static getHealthSummary(sourceRoom: string): {
        routes: { [targetRoom: string]: ReturnType<typeof RoadMaintain.checkHealth> };
        totalBuilt: number;
        totalDamaged: number;
        totalMissing: number;
        overallHealth: number;
    } {
        const routes: { [targetRoom: string]: ReturnType<typeof RoadMaintain.checkHealth> } = {};
        const targets = RoadMemory.getRouteTargets(sourceRoom);
        
        let totalBuilt = 0;
        let totalDamaged = 0;
        let totalMissing = 0;
        let totalRoads = 0;

        for (const targetRoom of targets) {
            const health = this.checkHealth(sourceRoom, targetRoom);
            routes[targetRoom] = health;
            totalBuilt += health.built;
            totalDamaged += health.damaged;
            totalMissing += health.missing;
            totalRoads += health.total;
        }

        const overallHealth = totalRoads > 0 ? (totalBuilt / totalRoads) * 100 : 100;

        return { routes, totalBuilt, totalDamaged, totalMissing, overallHealth };
    }

    /**
     * 重置检查时间缓存
     * @param sourceRoom 可选，指定房间；不指定则清除所有
     */
    static resetCheckTime(sourceRoom?: string): void {
        if (sourceRoom) {
            delete this.lastCheckTime[sourceRoom];
        } else {
            this.lastCheckTime = {};
        }
    }
}



// ============================================================
// 道路可视化
// ============================================================

/**
 * 道路可视化器
 * @description 支持道路路径可视化调试
 */
export class RoadVisual {
    /** 可视化颜色配置 */
    private static readonly COLORS = {
        /** 计划道路（未建造） */
        PLANNED: '#ffff00',     // 黄色
        /** 已建道路 */
        BUILT: '#00ff00',       // 绿色
        /** 共享路段 */
        SHARED: '#00ffff',      // 青色
        /** 损坏道路 */
        DAMAGED: '#ff0000',     // 红色
        /** 建造工地 */
        SITE: '#ffa500',        // 橙色
    };

    /** 可视化开关状态 */
    private static enabled: { [sourceRoom: string]: boolean } = {};

    private static readonly DRAW_INTERVAL = 1;
    private static readonly MAP_DRAW_INTERVAL = 1;
    private static readonly MAX_ROOM_POSITIONS_FOR_LINES = 220;

    private static lastDrawTickBySource: { [sourceRoom: string]: number } = {};
    private static lastMapDrawTickBySource: { [sourceRoom: string]: number } = {};

    private static perfTick = -1;
    private static perfDrawInterval = RoadVisual.DRAW_INTERVAL;
    private static perfMapDrawInterval = RoadVisual.MAP_DRAW_INTERVAL;
    private static perfAllowLines = true;
    private static perfEnabled = true;

    private static roomStateCache: {
        [roomName: string]: {
            tick: number;
            roadsByXy: Map<string, StructureRoad>;
            roadSiteXy: Set<string>;
        };
    } = {};

    /**
     * 可视化指定路线
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     */
    static visualize(sourceRoom: string, targetRoom: string, allowLines = true): void {
        const positions = RoadMemory.getGroupPositions(sourceRoom, targetRoom);
        if (positions.length === 0) return;

        this.drawPositions(positions, sourceRoom, undefined, allowLines);
    }

    /**
     * 可视化所有路线
     * @param sourceRoom 源头房间名
     */
    static visualizeAll(sourceRoom: string, allowLines = true): void {
        const targets = RoadMemory.getRouteTargets(sourceRoom);
        if (targets.length === 0) return;

        const sharedCount: { [key: string]: number } = {};
        const byRoom: { [roomName: string]: RoomPosition[] } = {};
        const seenByRoom: { [roomName: string]: Set<string> } = {};

        for (const targetRoom of targets) {
            const positions = RoadMemory.getGroupPositions(sourceRoom, targetRoom);
            if (positions.length === 0) continue;

            for (const pos of positions) {
                const sharedKey = `${pos.roomName}:${pos.x}:${pos.y}`;
                sharedCount[sharedKey] = (sharedCount[sharedKey] || 0) + 1;

                if (!byRoom[pos.roomName]) byRoom[pos.roomName] = [];
                if (!seenByRoom[pos.roomName]) seenByRoom[pos.roomName] = new Set();
                const xyKey = `${pos.x}:${pos.y}`;
                if (seenByRoom[pos.roomName].has(xyKey)) continue;
                seenByRoom[pos.roomName].add(xyKey);
                byRoom[pos.roomName].push(pos);
            }
        }

        for (const roomName in byRoom) {
            const room = Game.rooms[roomName];
            if (!room) continue;
            this.drawRoomPositions(room, byRoom[roomName], sharedCount, allowLines);
        }
    }

    private static drawPositions(
        positions: RoomPosition[],
        sourceRoom: string,
        sharedCount?: { [key: string]: number },
        allowLines = true
    ): void {
        const byRoom: { [roomName: string]: RoomPosition[] } = {};
        const seenByRoom: { [roomName: string]: Set<string> } = {};

        for (const pos of positions) {
            if (!byRoom[pos.roomName]) byRoom[pos.roomName] = [];
            if (!seenByRoom[pos.roomName]) seenByRoom[pos.roomName] = new Set();
            const xyKey = `${pos.x}:${pos.y}`;
            if (seenByRoom[pos.roomName].has(xyKey)) continue;
            seenByRoom[pos.roomName].add(xyKey);
            byRoom[pos.roomName].push(pos);
        }

        for (const roomName in byRoom) {
            const room = Game.rooms[roomName];
            if (!room) continue;
            this.drawRoomPositions(room, byRoom[roomName], sharedCount, allowLines);
        }
    }

    private static drawRoomPositions(
        room: Room,
        roomPositions: RoomPosition[],
        sharedCount?: { [key: string]: number },
        allowLines = true
    ): void {
        const visual = room.visual;
        const roadIndex = new RoomArray().init();
        for (const pos of roomPositions) roadIndex.set(pos.x, pos.y, 'road');

        const cache = this.roomStateCache[room.name];
        const state =
            cache && cache.tick === Game.time
                ? cache
                : (() => {
                      const roadsByXy = new Map<string, StructureRoad>();
                      const roads = room.find(FIND_STRUCTURES, {
                          filter: (s) => s.structureType === STRUCTURE_ROAD
                      }) as StructureRoad[];
                      for (const road of roads) {
                          const xyKey = `${road.pos.x}:${road.pos.y}`;
                          roadsByXy.set(xyKey, road);
                      }

                      const roadSiteXy = new Set<string>();
                      const roadSites = room.find(FIND_CONSTRUCTION_SITES, {
                          filter: (s) => s.structureType === STRUCTURE_ROAD
                      });
                      for (const site of roadSites) {
                          const xyKey = `${site.pos.x}:${site.pos.y}`;
                          roadSiteXy.add(xyKey);
                      }

                      const next = { tick: Game.time, roadsByXy, roadSiteXy };
                      this.roomStateCache[room.name] = next;
                      return next;
                  })();

        const colorByXy = new Map<string, string>();
        const priorityByXy = new Map<string, number>();

        for (const pos of roomPositions) {
            const sharedKey = `${pos.roomName}:${pos.x}:${pos.y}`;
            const isShared = !!sharedCount && sharedCount[sharedKey] > 1;

            const xyKey = `${pos.x}:${pos.y}`;
            const road = state.roadsByXy.get(xyKey);
            const hasSite = state.roadSiteXy.has(xyKey);

            let color: string;
            let priority: number;

            if (road) {
                if (road.hits < road.hitsMax * EXTERNAL_ROAD_CONFIG.REPAIR_THRESHOLD) {
                    color = this.COLORS.DAMAGED;
                    priority = 5;
                } else if (isShared) {
                    color = this.COLORS.SHARED;
                    priority = 2;
                } else {
                    color = this.COLORS.BUILT;
                    priority = 1;
                }
            } else if (hasSite) {
                color = this.COLORS.SITE;
                priority = 3;
            } else {
                color = this.COLORS.PLANNED;
                priority = 4;
            }

            colorByXy.set(xyKey, color);
            priorityByXy.set(xyKey, priority);

            visual.text('•', pos.x, pos.y + 0.25, {
                color,
                opacity: 0.75,
                font: 0.7
            });
        }

        if (!allowLines || roomPositions.length <= 1 || roomPositions.length > this.MAX_ROOM_POSITIONS_FOR_LINES) return;

        for (const pos of roomPositions) {
            roadIndex.forNear((x: number, y: number, val: number | string) => {
                if (val !== 'road') return;
                if ((pos.x >= x && pos.y >= y) || (pos.x > x && pos.y < y)) {
                    const fromKey = `${pos.x}:${pos.y}`;
                    const toKey = `${x}:${y}`;
                    const fromPriority = priorityByXy.get(fromKey) ?? 0;
                    const toPriority = priorityByXy.get(toKey) ?? 0;
                    const useKey = fromPriority >= toPriority ? fromKey : toKey;
                    const color = colorByXy.get(useKey) ?? '#ffffff';
                    visual.line(x, y, pos.x, pos.y, { color });
                }
            }, pos.x, pos.y);
        }
    }



    /**
     * 启用可视化
     * @param sourceRoom 源头房间名
     */
    static enable(sourceRoom: string): void {
        this.enabled[sourceRoom] = true;
    }

    /**
     * 禁用可视化
     * @param sourceRoom 源头房间名
     */
    static disable(sourceRoom: string): void {
        this.enabled[sourceRoom] = false;
    }

    /**
     * 切换可视化状态
     * @param sourceRoom 源头房间名
     * @returns 新状态
     */
    static toggle(sourceRoom: string): boolean {
        this.enabled[sourceRoom] = !this.enabled[sourceRoom];
        return this.enabled[sourceRoom];
    }

    /**
     * 检查是否启用可视化
     * @param sourceRoom 源头房间名
     * @returns 是否启用
     */
    static isEnabled(sourceRoom: string): boolean {
        return this.enabled[sourceRoom] || false;
    }

    /**
     * 运行可视化（每 tick 调用）
     * @description 检查 Flag 触发和启用状态，自动绘制房间内和世界地图可视化
     */
    static run(): void {
        this.refreshPerfProfile();
        if (!this.perfEnabled) return;
        const sourceRoomsToDraw = new Set<string>();

        if (Game.flags['ALL/roadVisual']) {
            const outMineData = getOutMineData();
            for (const sourceRoom in outMineData) {
                const data = outMineData[sourceRoom];
                if ((data.energy && data.energy.length > 0) || (data.centerRoom && data.centerRoom.length > 0)) {
                    sourceRoomsToDraw.add(sourceRoom);
                }
            }
        }

        for (const flagName in Game.flags) {
            const match = flagName.match(/^(.+)\/roadVisual$/);
            if (match) sourceRoomsToDraw.add(match[1]);
        }

        // 检查启用状态
        for (const sourceRoom in this.enabled) {
            if (this.enabled[sourceRoom]) sourceRoomsToDraw.add(sourceRoom);
        }

        const drawInterval = this.perfDrawInterval;
        const mapInterval = this.perfMapDrawInterval;
        const allowLines = this.perfAllowLines;

        for (const sourceRoom of sourceRoomsToDraw) {
            const lastDraw = this.lastDrawTickBySource[sourceRoom] ?? -Infinity;
            if (Game.time - lastDraw >= drawInterval) {
                this.lastDrawTickBySource[sourceRoom] = Game.time;
                this.visualizeAll(sourceRoom, allowLines);
            }

            const lastMap = this.lastMapDrawTickBySource[sourceRoom] ?? -Infinity;
            if (Game.time - lastMap >= mapInterval) {
                this.lastMapDrawTickBySource[sourceRoom] = Game.time;
                this.visualizeOnMap(sourceRoom);
            }
        }
    }

    private static refreshPerfProfile(): void {
        if (this.perfTick === Game.time) return;
        this.perfTick = Game.time;

        const qosLevel =
            (global as any).qos?.getQoS?.()?.level ||
            (global as any).QoS?.level ||
            'normal';
        const bucket = Number(Game.cpu.bucket || 0);
        if (qosLevel === 'emergency' || bucket < 1000) {
            this.perfEnabled = false;
            return;
        }

        this.perfEnabled = true;
        const constrained = qosLevel === 'constrained' || bucket < 5000;
        this.perfDrawInterval = constrained ? Math.max(5, this.DRAW_INTERVAL) : this.DRAW_INTERVAL;
        this.perfMapDrawInterval = constrained ? Math.max(5, this.MAP_DRAW_INTERVAL) : this.MAP_DRAW_INTERVAL;
        this.perfAllowLines = !constrained && bucket >= 5000;
    }

    /**
     * 绘制图例
     * @param roomName 房间名
     */
    static drawLegend(roomName: string): void {
        const room = Game.rooms[roomName];
        if (!room) return;

        const visual = room.visual;
        const startX = 1;
        const startY = 1;
        const spacing = 1.5;

        const legends = [
            { color: this.COLORS.PLANNED, label: '计划' },
            { color: this.COLORS.BUILT, label: '已建' },
            { color: this.COLORS.SHARED, label: '共享' },
            { color: this.COLORS.DAMAGED, label: '损坏' },
            { color: this.COLORS.SITE, label: '工地' },
        ];

        for (let i = 0; i < legends.length; i++) {
            const { color, label } = legends[i];
            const y = startY + i * spacing;
            
            visual.circle(startX, y, {
                radius: 0.3,
                fill: color,
                opacity: 0.8,
            });
            
            visual.text(label, startX + 0.8, y + 0.2, {
                color: '#ffffff',
                font: 0.6,
                align: 'left',
            });
        }
    }

    /** 世界地图可视化颜色 */
    private static readonly MAP_COLORS = [
        '#ff6b6b',  // 红
        '#4ecdc4',  // 青
        '#45b7d1',  // 蓝
        '#96ceb4',  // 绿
        '#ffeaa7',  // 黄
        '#dfe6e9',  // 灰白
        '#fd79a8',  // 粉
        '#a29bfe',  // 紫
        '#00b894',  // 深绿
        '#e17055',  // 橙
    ];

    /**
     * 在世界地图上可视化道路路径
     * @param sourceRoom 源头房间名
     * @param targetRoom 可选，指定目标房间
     */
    static visualizeOnMap(sourceRoom: string, targetRoom?: string): void {
        const targets = targetRoom ? [targetRoom] : RoadMemory.getRouteTargets(sourceRoom);
        
        if (targets.length === 0) {
            return;
        }

        let colorIndex = 0;
        for (const target of targets) {
            const paths = RoadMemory.getAllPaths(sourceRoom, target);
            
            if (paths.size === 0) continue;

            // 同一目标房间使用相同颜色
            const color = this.MAP_COLORS[colorIndex % this.MAP_COLORS.length];
            colorIndex++;

            for (const [targetPos, positions] of paths) {
                if (positions.length < 2) continue;

                // 路径已经是按顺序存储的，直接绘制
                this.drawMapPath(positions, color);

                // 在终点标注
                const endpoint = positions[positions.length - 1];
                Game.map.visual.circle(endpoint, {
                    radius: 1.2,
                    fill: color,
                    opacity: 0.8,
                    stroke: '#ffffff',
                    strokeWidth: 0.3,
                });
            }
        }
    }

    /**
     * 在世界地图上绘制路径
     * @param positions 位置数组（应已按路径顺序排序）
     * @param color 线条颜色
     */
    private static drawMapPath(positions: RoomPosition[], color: string): void {
        if (positions.length < 2) return;

        const validPath = positions.map((p: any) => (p instanceof RoomPosition ? p : new RoomPosition(p.x, p.y, p.roomName)));

        // 使用 poly() API 绘制整条路径，获得连续的线条效果
        Game.map.visual.poly(validPath, {
            stroke: color,
            strokeWidth: 0.7,
            opacity: 0.7,
            lineStyle: 'solid',
        });

        // 在起点绘制标记
        const start = validPath[0];
        Game.map.visual.circle(start, {
            radius: 1,
            fill: color,
            opacity: 0.6,
        });
    }
}
