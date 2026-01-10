/**
 * 外矿道路优化模块
 * 
 * 提供外矿道路的路径规划、缓存管理、内存管理、维护和可视化功能。
 * 
 * @module outMineRoad
 */

import { ROAD_CONFIG } from '@/constant/config';
import { compress, decompress } from '@/utils';

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
            ttl: ttl ?? ROAD_CONFIG.COST_MATRIX_TTL,
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
    /**
     * 获取指定目标房间的路线组
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @returns 路线组数据或 undefined
     */
    static getRouteGroup(homeRoom: string, targetRoom: string): OutMineRoadRouteGroup | undefined {
        const mem = this.getMemory(homeRoom);
        if (!mem?.routes) return undefined;
        return mem.routes[targetRoom] as OutMineRoadRouteGroup;
    }

    /**
     * 获取指定路线的道路数据（兼容旧接口）
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @returns 道路路线数据或 undefined
     * @deprecated 请使用 getRouteGroup
     */
    static getRoads(homeRoom: string, targetRoom: string): OutMineRoadRoute | undefined {
        const group = this.getRouteGroup(homeRoom, targetRoom);
        if (!group) return undefined;
        
        // 转换为旧格式
        return this.groupToRoute(group);
    }

    /**
     * 将路线组转换为旧格式路线
     */
    private static groupToRoute(group: OutMineRoadRouteGroup): OutMineRoadRoute {
        const positions: { [roomName: string]: number[] } = {};
        let totalLength = 0;

        for (const targetPos in group.paths) {
            const pathData = group.paths[targetPos];
            for (const [roomName, compressed] of pathData.path) {
                if (!positions[roomName]) positions[roomName] = [];
                if (!positions[roomName].includes(compressed)) {
                    positions[roomName].push(compressed);
                }
            }
            totalLength += pathData.length;
        }

        return {
            positions,
            length: totalLength,
            createdAt: group.createdAt,
            status: group.status,
            lastCheck: group.lastCheck,
        };
    }

    /**
     * 设置指定目标的路径数据（新格式）
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @param targetPos 目标位置 "x:y"
     * @param positions 道路位置数组（按顺序）
     */
    static setPath(homeRoom: string, targetRoom: string, targetPos: string, positions: RoomPosition[]): void {
        this.ensureMemory(homeRoom);
        const mem = Memory['OutMineData'][homeRoom].RoadData!;
        
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
    }

    /**
     * 设置指定路线的道路数据（兼容旧接口）
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @param positions 道路位置数组
     * @deprecated 请使用 setPath
     */
    static setRoads(homeRoom: string, targetRoom: string, positions: RoomPosition[]): void {
        // 旧接口：将所有位置存储为单个路径 "legacy"
        this.setPath(homeRoom, targetRoom, 'legacy', positions);
    }

    /**
     * 批量设置多个目标的路径
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @param pathsMap 路径映射 { "x:y": positions[] }
     */
    static setPaths(homeRoom: string, targetRoom: string, pathsMap: Map<string, RoomPosition[]>): void {
        this.ensureMemory(homeRoom);
        const mem = Memory['OutMineData'][homeRoom].RoadData!;
        
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
    }

    /**
     * 获取指定目标的路径
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @param targetPos 目标位置 "x:y"
     * @returns RoomPosition 数组（按顺序）
     */
    static getPath(homeRoom: string, targetRoom: string, targetPos: string): RoomPosition[] | undefined {
        const group = this.getRouteGroup(homeRoom, targetRoom);
        if (!group?.paths?.[targetPos]) return undefined;

        const pathData = group.paths[targetPos];
        return pathData.path.map(([roomName, compressed]) => {
            const [x, y] = decompress(compressed);
            return new RoomPosition(x, y, roomName);
        });
    }

    /**
     * 获取目标房间内所有目标的路径
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @returns 路径映射 { "x:y": positions[] }
     */
    static getAllPaths(homeRoom: string, targetRoom: string): Map<string, RoomPosition[]> {
        const result = new Map<string, RoomPosition[]>();
        const group = this.getRouteGroup(homeRoom, targetRoom);
        if (!group?.paths) return result;

        for (const targetPos in group.paths) {
            const pathData = group.paths[targetPos];
            const positions = pathData.path.map(([roomName, compressed]) => {
                const [x, y] = decompress(compressed);
                return new RoomPosition(x, y, roomName);
            });
            result.set(targetPos, positions);
        }

        return result;
    }

    /**
     * 添加单个道路位置到路线
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @param pos 道路位置
     * @returns 是否添加成功
     * @deprecated 新格式不支持此操作
     */
    static addRoad(homeRoom: string, targetRoom: string, pos: RoomPosition): boolean {
        const route = this.getRoads(homeRoom, targetRoom);
        if (!route) return false;

        if (!route.positions[pos.roomName]) {
            route.positions[pos.roomName] = [];
        }
        const compressed = compress(pos.x, pos.y);
        if (!route.positions[pos.roomName].includes(compressed)) {
            route.positions[pos.roomName].push(compressed);
            route.length++;
        }
        return true;
    }

    /**
     * 删除指定路线
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @returns 是否删除成功
     */
    static deleteRoute(homeRoom: string, targetRoom: string): boolean {
        const mem = this.getMemory(homeRoom);
        if (!mem?.routes?.[targetRoom]) return false;
        delete mem.routes[targetRoom];
        mem.lastUpdate = Game.time;
        return true;
    }

    /**
     * 获取所有路线的目标房间列表
     * @param homeRoom 主房间名
     * @returns 目标房间名数组
     */
    static getRouteTargets(homeRoom: string): string[] {
        const mem = this.getMemory(homeRoom);
        if (!mem?.routes) return [];
        return Object.keys(mem.routes);
    }

    /**
     * 将路线数据转换为 RoomPosition 数组
     * @param route 路线数据
     * @returns RoomPosition 数组
     */
    static routeToPositions(route: OutMineRoadRoute): RoomPosition[] {
        const positions: RoomPosition[] = [];
        for (const roomName in route.positions) {
            for (const compressed of route.positions[roomName]) {
                const [x, y] = decompress(compressed);
                positions.push(new RoomPosition(x, y, roomName));
            }
        }
        return positions;
    }

    /**
     * 迁移旧格式数据到新格式
     * @param homeRoom 主房间名
     * @returns 迁移的路线数量
     */
    static migrate(homeRoom: string): number {
        const outMineData = Memory['OutMineData']?.[homeRoom];
        if (!outMineData?.Road) return 0;

        // 检查是否已迁移
        if (outMineData.RoadVersion === ROAD_CONFIG.DATA_VERSION) return 0;

        this.ensureMemory(homeRoom);
        const newMem = outMineData.RoadData!;
        let count = 0;

        for (const targetRoom in outMineData.Road) {
            const oldData = outMineData.Road[targetRoom];
            if (!oldData || oldData.length === 0) continue;

            // 旧格式迁移为 legacy 路径
            const path: Array<[string, number]> = oldData.map(([roomName, compressed]: [string, number]) => [roomName, compressed]);

            newMem.routes[targetRoom] = {
                paths: {
                    'legacy': {
                        path,
                        length: oldData.length,
                    }
                },
                createdAt: Game.time,
                status: 'active',
            };
            count++;
        }

        // 标记版本
        outMineData.RoadVersion = ROAD_CONFIG.DATA_VERSION;
        newMem.lastUpdate = Game.time;

        return count;
    }

    /**
     * 获取统计信息
     * @param homeRoom 主房间名
     * @returns 统计信息
     */
    static getStats(homeRoom: string): {
        routeCount: number;
        pathCount: number;
        totalLength: number;
        roomCount: number;
        version: number;
        hasOldData: boolean;
    } {
        const outMineData = Memory['OutMineData']?.[homeRoom];
        const mem = this.getMemory(homeRoom);
        
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
            version: outMineData?.RoadVersion ?? 0,
            hasOldData: !!outMineData?.Road && Object.keys(outMineData.Road).length > 0,
        };
    }

    /**
     * 验证数据完整性
     * @param homeRoom 主房间名
     * @returns 验证结果
     */
    static validate(homeRoom: string): {
        valid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];
        const mem = this.getMemory(homeRoom);

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
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @param status 新状态
     */
    static updateStatus(homeRoom: string, targetRoom: string, status: 'active' | 'pending' | 'damaged'): void {
        const group = this.getRouteGroup(homeRoom, targetRoom);
        if (group) {
            group.status = status;
            group.lastCheck = Game.time;
        }
    }

    /**
     * 获取道路内存
     */
    private static getMemory(homeRoom: string): OutMineRoadMemory | undefined {
        return Memory['OutMineData']?.[homeRoom]?.RoadData;
    }

    /**
     * 确保内存结构存在
     */
    private static ensureMemory(homeRoom: string): void {
        if (!Memory['OutMineData']) Memory['OutMineData'] = {};
        if (!Memory['OutMineData'][homeRoom]) Memory['OutMineData'][homeRoom] = {};
        if (!Memory['OutMineData'][homeRoom].RoadData) {
            Memory['OutMineData'][homeRoom].RoadData = {
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
     * @param homeRoom 主房间名
     * @param target 目标位置
     * @returns 路径位置数组，或 undefined（如果计算失败或 CPU 不足）
     */
    static planPath(homeRoom: string, target: RoomPosition): RoomPosition[] | undefined {
        // CPU 保护检查
        if (!this.canPlanPath()) {
            return undefined;
        }

        const room = Game.rooms[homeRoom];
        if (!room) return undefined;

        const center = Memory['RoomControlData']?.[homeRoom]?.center || { x: 25, y: 25 };
        const startPos = new RoomPosition(center.x, center.y, homeRoom);

        const result = PathFinder.search(startPos, { pos: target, range: 1 }, {
            plainCost: ROAD_CONFIG.PLAIN_COST,
            swampCost: ROAD_CONFIG.SWAMP_COST,
            maxOps: ROAD_CONFIG.MAX_OPS,
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
     * @param homeRoom 主房间名
     * @param targets 目标位置数组
     * @returns 路径结果映射 { targetKey: positions[] }，targetKey 格式为 "roomName:x:y"
     */
    static planPaths(homeRoom: string, targets: RoomPosition[]): Map<string, RoomPosition[]> {
        const results = new Map<string, RoomPosition[]>();
        
        if (targets.length === 0) return results;

        const room = Game.rooms[homeRoom];
        if (!room) return results;

        const center = Memory['RoomControlData']?.[homeRoom]?.center || { x: 25, y: 25 };
        const startPos = new RoomPosition(center.x, center.y, homeRoom);

        // 按距离排序（近的先计算）
        const sortedTargets = [...targets].sort((a, b) => {
            const distA = Game.map.getRoomLinearDistance(homeRoom, a.roomName);
            const distB = Game.map.getRoomLinearDistance(homeRoom, b.roomName);
            return distA - distB;
        });

        // 收集所有已计算的道路位置，用于复用
        const allRoadPositions = new Set<string>();

        for (const target of sortedTargets) {
            // CPU 保护检查
            if (!this.canPlanPath()) {
                break;
            }

            const result = PathFinder.search(startPos, { pos: target, range: 1 }, {
                plainCost: ROAD_CONFIG.PLAIN_COST,
                swampCost: ROAD_CONFIG.SWAMP_COST,
                maxOps: ROAD_CONFIG.MAX_OPS,
                roomCallback: (roomName) => {
                    const matrix = this.buildCostMatrix(roomName);
                    if (!matrix) return false;

                    // 将已计算的道路位置设为低代价（复用）
                    for (const posKey of allRoadPositions) {
                        const [posRoomName, x, y] = posKey.split(':');
                        if (posRoomName === roomName) {
                            matrix.set(parseInt(x), parseInt(y), ROAD_CONFIG.ROAD_COST);
                        }
                    }

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
                    allRoadPositions.add(`${pos.roomName}:${pos.x}:${pos.y}`);
                    // 更新 CostMatrix 缓存
                    CostMatrixCache.updatePosition(pos.roomName, pos.x, pos.y, ROAD_CONFIG.ROAD_COST);
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

        if (room) {
            // 有视野的房间：添加建筑和 creep 代价
            const structures = room.find(FIND_STRUCTURES);
            for (const struct of structures) {
                if (struct.structureType === STRUCTURE_ROAD) {
                    costs.set(struct.pos.x, struct.pos.y, ROAD_CONFIG.ROAD_COST);
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
                    costs.set(site.pos.x, site.pos.y, ROAD_CONFIG.ROAD_COST);
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

        // 检查 CPU 使用率（基于 tickLimit）
        const cpuUsed = Game.cpu.getUsed();
        const cpuLimit = Game.cpu.tickLimit || 500;
        if (cpuUsed / cpuLimit > ROAD_CONFIG.CPU_THRESHOLD) {
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
     * 为目标房间创建道路建造工地
     * @param homeRoom 主房间
     * @param targetRoom 目标房间
     * @returns 创建的工地数量
     */
    static createRoadSites(homeRoom: Room, targetRoom: Room): number {
        const homeRoomName = homeRoom.name;
        const targetRoomName = targetRoom.name;

        // 尝试迁移旧数据
        RoadMemory.migrate(homeRoomName);

        // 检查是否已有路线数据
        const existingPaths = RoadMemory.getAllPaths(homeRoomName, targetRoomName);
        
        // 检查是否是旧的 legacy 格式（需要重新计算）
        const isLegacyFormat = existingPaths.size === 1 && existingPaths.has('legacy');
        
        if (existingPaths.size > 0 && !isLegacyFormat) {
            // 使用已有路线数据创建工地
            return this.createSitesFromPaths(homeRoomName, existingPaths);
        }

        // 如果是 legacy 格式，删除旧数据
        if (isLegacyFormat) {
            RoadMemory.deleteRoute(homeRoomName, targetRoomName);
        }

        // 计算新路径
        const targets = this.getTargetPositions(targetRoom);
        if (targets.length === 0) return 0;

        const pathResults = PathPlanner.planPaths(homeRoomName, targets);
        if (pathResults.size === 0) return 0;

        // 转换 key 格式：从 "roomName:x:y" 到 "x:y"
        const pathsToSave = new Map<string, RoomPosition[]>();
        for (const [targetKey, positions] of pathResults) {
            // targetKey 格式为 "roomName:x:y"，提取 "x:y"
            const parts = targetKey.split(':');
            const posKey = `${parts[1]}:${parts[2]}`;
            pathsToSave.set(posKey, positions);
        }

        if (pathsToSave.size === 0) return 0;

        // 保存到内存（按目标分别存储）
        RoadMemory.setPaths(homeRoomName, targetRoomName, pathsToSave);

        // 创建工地
        return this.createSitesFromPaths(homeRoomName, pathsToSave);
    }

    /**
     * 从多条路径创建建造工地
     * @param homeRoomName 主房间名
     * @param paths 路径映射
     * @returns 创建的工地数量
     */
    private static createSitesFromPaths(homeRoomName: string, paths: Map<string, RoomPosition[]>): number {
        let created = 0;
        const processedPositions = new Set<string>();

        for (const [, positions] of paths) {
            for (const pos of positions) {
                // 限制单路线最大工地数
                if (created >= ROAD_CONFIG.MAX_SITES_PER_ROUTE) break;

                // 跳过已处理的位置（去重）
                const posKey = `${pos.roomName}:${pos.x}:${pos.y}`;
                if (processedPositions.has(posKey)) continue;
                processedPositions.add(posKey);

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
     * @param homeRoomName 主房间名
     * @param targetRoomName 目标房间名
     * @returns 是否成功
     */
    static recalculateRoute(homeRoomName: string, targetRoomName: string): boolean {
        const homeRoom = Game.rooms[homeRoomName];
        const targetRoom = Game.rooms[targetRoomName];
        
        if (!homeRoom || !targetRoom) return false;

        // 删除旧路线
        RoadMemory.deleteRoute(homeRoomName, targetRoomName);
        
        // 使缓存失效
        CostMatrixCache.clear();

        // 计算新路径
        const targets = this.getTargetPositions(targetRoom);
        if (targets.length === 0) return false;

        const pathResults = PathPlanner.planPaths(homeRoomName, targets);
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
        RoadMemory.setPaths(homeRoomName, targetRoomName, pathsToSave);

        // 创建工地
        this.createSitesFromPaths(homeRoomName, pathsToSave);
        
        return true;
    }

    /**
     * 检查是否应该建造道路
     * @param homeRoom 主房间
     * @param targetRoomName 目标房间名
     * @returns 是否应该建造
     */
    static shouldBuildRoad(homeRoom: Room, targetRoomName: string): boolean {
        const level = homeRoom.controller?.level || 0;
        const isCenterRoom = /^[EW]\d*[456][NS]\d*[456]$/.test(targetRoomName);

        if (isCenterRoom) {
            return level >= ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL;
        } else {
            return level >= ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL;
        }
    }
}

/**
 * 创建外矿道路工地（兼容旧接口）
 * @param room 主房间
 * @param targetRoom 目标房间
 * @deprecated 请使用 RoadBuilder.createRoadSites
 */
export function createRoadSiteNew(room: Room, targetRoom: Room): void {
    RoadBuilder.createRoadSites(room, targetRoom);
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
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @returns 健康检查结果
     */
    static checkHealth(homeRoom: string, targetRoom: string): {
        total: number;
        built: number;
        damaged: number;
        missing: number;
        noVision: number;
        healthPercent: number;
    } {
        const route = RoadMemory.getRoads(homeRoom, targetRoom);
        if (!route) {
            return { total: 0, built: 0, damaged: 0, missing: 0, noVision: 0, healthPercent: 100 };
        }

        const positions = RoadMemory.routeToPositions(route);
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
                if (road.hits < road.hitsMax * ROAD_CONFIG.REPAIR_THRESHOLD) {
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
            RoadMemory.updateStatus(homeRoom, targetRoom, 'damaged');
        } else if (built === total) {
            RoadMemory.updateStatus(homeRoom, targetRoom, 'active');
        }

        return { total, built, damaged, missing, noVision, healthPercent };
    }

    /**
     * 获取需要修复的道路队列
     * @param homeRoom 主房间名
     * @returns 需要修复的道路位置数组（按优先级排序）
     */
    static getRepairQueue(homeRoom: string): RoomPosition[] {
        const repairQueue: { pos: RoomPosition; priority: number }[] = [];
        const targets = RoadMemory.getRouteTargets(homeRoom);

        for (const targetRoom of targets) {
            const route = RoadMemory.getRoads(homeRoom, targetRoom);
            if (!route) continue;

            const positions = RoadMemory.routeToPositions(route);
            for (const pos of positions) {
                const room = Game.rooms[pos.roomName];
                if (!room) continue;

                const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                const road = structures.find(s => s.structureType === STRUCTURE_ROAD) as StructureRoad | undefined;
                
                if (road && road.hits < road.hitsMax * ROAD_CONFIG.REPAIR_THRESHOLD) {
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
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     * @returns 创建的工地数量
     */
    static checkDestroyed(homeRoom: string, targetRoom: string): number {
        const route = RoadMemory.getRoads(homeRoom, targetRoom);
        if (!route) return 0;

        const positions = RoadMemory.routeToPositions(route);
        let created = 0;

        for (const pos of positions) {
            // 限制单次创建数量
            if (created >= ROAD_CONFIG.MAX_SITES_PER_ROUTE) break;

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
     * @param homeRoom 主房间名
     * @returns 维护结果
     */
    static runMaintenance(homeRoom: string): {
        checked: number;
        sitesCreated: number;
        needsRepair: number;
    } {
        const cacheKey = homeRoom;
        const lastCheck = this.lastCheckTime[cacheKey] || 0;

        // 检查是否需要执行维护（默认每 500 ticks）
        if (Game.time - lastCheck < ROAD_CONFIG.MAINTAIN_INTERVAL) {
            return { checked: 0, sitesCreated: 0, needsRepair: 0 };
        }

        this.lastCheckTime[cacheKey] = Game.time;

        const targets = RoadMemory.getRouteTargets(homeRoom);
        let sitesCreated = 0;
        let needsRepair = 0;

        for (const targetRoom of targets) {
            const health = this.checkHealth(homeRoom, targetRoom);
            needsRepair += health.damaged;

            // 检查并修复被摧毁的道路
            if (health.missing > 0) {
                sitesCreated += this.checkDestroyed(homeRoom, targetRoom);
            }
        }

        return { checked: targets.length, sitesCreated, needsRepair };
    }

    /**
     * 获取所有路线的健康摘要
     * @param homeRoom 主房间名
     * @returns 健康摘要
     */
    static getHealthSummary(homeRoom: string): {
        routes: { [targetRoom: string]: ReturnType<typeof RoadMaintain.checkHealth> };
        totalBuilt: number;
        totalDamaged: number;
        totalMissing: number;
        overallHealth: number;
    } {
        const routes: { [targetRoom: string]: ReturnType<typeof RoadMaintain.checkHealth> } = {};
        const targets = RoadMemory.getRouteTargets(homeRoom);
        
        let totalBuilt = 0;
        let totalDamaged = 0;
        let totalMissing = 0;
        let totalRoads = 0;

        for (const targetRoom of targets) {
            const health = this.checkHealth(homeRoom, targetRoom);
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
     * @param homeRoom 可选，指定房间；不指定则清除所有
     */
    static resetCheckTime(homeRoom?: string): void {
        if (homeRoom) {
            delete this.lastCheckTime[homeRoom];
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
    private static enabled: { [homeRoom: string]: boolean } = {};

    /**
     * 可视化指定路线
     * @param homeRoom 主房间名
     * @param targetRoom 目标房间名
     */
    static visualize(homeRoom: string, targetRoom: string): void {
        const route = RoadMemory.getRoads(homeRoom, targetRoom);
        if (!route) return;

        const positions = RoadMemory.routeToPositions(route);
        this.drawRoute(positions, homeRoom);
    }

    /**
     * 可视化所有路线
     * @param homeRoom 主房间名
     */
    static visualizeAll(homeRoom: string): void {
        const targets = RoadMemory.getRouteTargets(homeRoom);
        
        // 收集所有位置并统计共享
        const positionCount: { [key: string]: number } = {};
        const allPositions: Map<string, RoomPosition[]> = new Map();

        for (const targetRoom of targets) {
            const route = RoadMemory.getRoads(homeRoom, targetRoom);
            if (!route) continue;

            const positions = RoadMemory.routeToPositions(route);
            allPositions.set(targetRoom, positions);

            for (const pos of positions) {
                const key = `${pos.roomName}:${pos.x}:${pos.y}`;
                positionCount[key] = (positionCount[key] || 0) + 1;
            }
        }

        // 绘制所有路线
        for (const [, positions] of allPositions) {
            this.drawRoute(positions, homeRoom, positionCount);
        }
    }

    /**
     * 绘制路线
     * @param positions 位置数组
     * @param homeRoom 主房间名
     * @param sharedCount 共享计数（可选）
     */
    private static drawRoute(
        positions: RoomPosition[],
        homeRoom: string,
        sharedCount?: { [key: string]: number }
    ): void {
        // 按房间分组
        const byRoom: { [roomName: string]: RoomPosition[] } = {};
        for (const pos of positions) {
            if (!byRoom[pos.roomName]) byRoom[pos.roomName] = [];
            byRoom[pos.roomName].push(pos);
        }

        for (const roomName in byRoom) {
            const room = Game.rooms[roomName];
            if (!room) continue;

            const visual = room.visual;
            const roomPositions = byRoom[roomName];

            for (const pos of roomPositions) {
                const key = `${pos.roomName}:${pos.x}:${pos.y}`;
                const isShared = sharedCount && sharedCount[key] > 1;

                // 检查实际状态
                const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                const road = structures.find(s => s.structureType === STRUCTURE_ROAD) as StructureRoad | undefined;
                const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
                const hasSite = sites.some(s => s.structureType === STRUCTURE_ROAD);

                let color: string;
                let radius = 0.3;

                if (road) {
                    if (road.hits < road.hitsMax * ROAD_CONFIG.REPAIR_THRESHOLD) {
                        color = this.COLORS.DAMAGED;
                        radius = 0.4;
                    } else if (isShared) {
                        color = this.COLORS.SHARED;
                    } else {
                        color = this.COLORS.BUILT;
                    }
                } else if (hasSite) {
                    color = this.COLORS.SITE;
                } else {
                    color = this.COLORS.PLANNED;
                }

                visual.circle(pos.x, pos.y, {
                    radius,
                    fill: color,
                    opacity: 0.3,
                });
            }

            // 绘制连接线
            if (roomPositions.length > 1) {
                const sortedPositions = this.sortPositionsByPath(roomPositions);
                for (let i = 0; i < sortedPositions.length - 1; i++) {
                    const from = sortedPositions[i];
                    const to = sortedPositions[i + 1];
                    // 只连接相邻的位置
                    if (Math.abs(from.x - to.x) <= 1 && Math.abs(from.y - to.y) <= 1) {
                        visual.line(from.x, from.y, to.x, to.y, {
                            color: '#ffffff',
                            opacity: 0.3,
                            lineStyle: 'dashed',
                        });
                    }
                }
            }
        }
    }

    /**
     * 按路径顺序排序位置
     * @param positions 位置数组
     * @returns 排序后的位置数组
     */
    private static sortPositionsByPath(positions: RoomPosition[]): RoomPosition[] {
        if (positions.length <= 1) return positions;

        // 简单的贪心排序：从第一个位置开始，每次选择最近的下一个位置
        const sorted: RoomPosition[] = [positions[0]];
        const remaining = new Set(positions.slice(1));

        while (remaining.size > 0) {
            const current = sorted[sorted.length - 1];
            let nearest: RoomPosition | null = null;
            let minDist = Infinity;

            for (const pos of remaining) {
                const dist = Math.max(Math.abs(pos.x - current.x), Math.abs(pos.y - current.y));
                if (dist < minDist) {
                    minDist = dist;
                    nearest = pos;
                }
            }

            if (nearest) {
                sorted.push(nearest);
                remaining.delete(nearest);
            } else {
                break;
            }
        }

        return sorted;
    }

    /**
     * 启用可视化
     * @param homeRoom 主房间名
     */
    static enable(homeRoom: string): void {
        this.enabled[homeRoom] = true;
    }

    /**
     * 禁用可视化
     * @param homeRoom 主房间名
     */
    static disable(homeRoom: string): void {
        this.enabled[homeRoom] = false;
    }

    /**
     * 切换可视化状态
     * @param homeRoom 主房间名
     * @returns 新状态
     */
    static toggle(homeRoom: string): boolean {
        this.enabled[homeRoom] = !this.enabled[homeRoom];
        return this.enabled[homeRoom];
    }

    /**
     * 检查是否启用可视化
     * @param homeRoom 主房间名
     * @returns 是否启用
     */
    static isEnabled(homeRoom: string): boolean {
        return this.enabled[homeRoom] || false;
    }

    /**
     * 运行可视化（每 tick 调用）
     * @description 检查 Flag 触发和启用状态，自动绘制房间内和世界地图可视化
     */
    static run(): void {
        // 检查 ALL/roadVisual 旗帜，可视化所有房间
        if (Game.flags['ALL/roadVisual']) {
            const outMineData = Memory['OutMineData'];
            if (outMineData) {
                for (const homeRoom in outMineData) {
                    const data = outMineData[homeRoom];
                    if ((data.energy && data.energy.length > 0) || 
                        (data.centerRoom && data.centerRoom.length > 0)) {
                        this.visualizeAll(homeRoom);
                        this.visualizeOnMap(homeRoom);
                    }
                }
            }
            return;
        }

        // 检查 Flag 触发
        for (const flagName in Game.flags) {
            const match = flagName.match(/^(.+)\/roadVisual$/);
            if (match) {
                const homeRoom = match[1];
                this.visualizeAll(homeRoom);
                this.visualizeOnMap(homeRoom);
            }
        }

        // 检查启用状态
        for (const homeRoom in this.enabled) {
            if (this.enabled[homeRoom]) {
                this.visualizeAll(homeRoom);
                this.visualizeOnMap(homeRoom);
            }
        }
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
     * @param homeRoom 主房间名
     * @param targetRoom 可选，指定目标房间
     */
    static visualizeOnMap(homeRoom: string, targetRoom?: string): void {
        const targets = targetRoom ? [targetRoom] : RoadMemory.getRouteTargets(homeRoom);
        
        if (targets.length === 0) {
            return;
        }

        let colorIndex = 0;
        for (const target of targets) {
            // 使用新的 API 获取独立路径
            const paths = RoadMemory.getAllPaths(homeRoom, target);
            
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
                    radius: 1.5,
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

        // 重建 RoomPosition 对象（防止序列化问题）
        const validPath = positions.map(p => new RoomPosition(p.x, p.y, p.roomName));

        // 使用 poly() API 绘制整条路径，获得连续的线条效果
        Game.map.visual.poly(validPath, {
            stroke: color,
            strokeWidth: 0.8,
            opacity: 0.7,
            lineStyle: undefined,
        });

        // 在起点绘制标记
        const start = validPath[0];
        Game.map.visual.circle(start, {
            radius: 1,
            fill: color,
            opacity: 0.6,
        });
    }

    /**
     * 清除世界地图可视化
     */
    static clearMap(): void {
        Game.map.visual.clear();
    }
}
