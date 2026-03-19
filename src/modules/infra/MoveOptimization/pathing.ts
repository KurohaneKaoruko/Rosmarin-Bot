// @ts-nocheck

/**
 * BetterMove 路径缓存与寻路维护控制面。
 * @description
 * 当前把以下相近职责收口到同一个“大模块”里：
 * - 路径缓存维护、缓存统计、缓存失效
 * - route cache 与跨房 route 查找
 * - 普通 creep 的 PathFinder 搜索与缓存命中逻辑
 * - observer 校验与 tick 维护调度
 *
 * index.ts 只保留共享状态、共享工具和入口装配，
 * 避免出现“入口文件里再套一层 movement.ts”的空转结构。
 */
export function createPathingModule(deps) {
    const routeState = deps.routeCacheState;
    const temporalState = deps.temporalAvoidState;
    const observerState = deps.observerState;

    // 这组状态只在一次 route / path 搜索过程中使用，保留在模块内部即可。
    let bypassRoomName;
    let bypassCostMat;
    let bypassIgnoreCondition;
    let userCostCallback;
    let costMat;
    let route;
    let findPathPortalPos = null;
    let findPathPortalMat = null;
    let findPathAllowPortal = false;
    let findPathSameRoomEdgeRoomName = '';
    let findPathIgnoreCondition;
    let findPathStartPos;
    let findPathStartMat;

    function bmSetPathClearDelay(number) {
        if (typeof number === 'number' && number > 0) {
            deps.setPathClearDelay(Math.ceil(number));
            return OK;
        }
        if (number === undefined) {
            deps.setPathClearDelay(undefined);
        }
        return ERR_INVALID_ARGS;
    }

    function bmSetHostileCostMatrixClearDelay(number) {
        if (typeof number === 'number' && number > 0) {
            deps.setHostileCostMatrixClearDelay(Math.ceil(number));
            return OK;
        }
        if (number === undefined) {
            deps.setHostileCostMatrixClearDelay(undefined);
            return OK;
        }
        return ERR_INVALID_ARGS;
    }

    function bmDeleteCostMatrix(roomName) {
        delete deps.costMatrixCache[roomName];
        delete deps.costMatrixRevision[roomName];
        delete deps.sameRoomEdgeCostMatCache[roomName];
        return OK;
    }

    function bmGetCacheStats() {
        const safeDiv = (num, den) => den ? (num / den) : 0;
        const routeStats = deps.getRouteCacheStats();
        const pathStats = deps.getPathCacheStats();
        return {
            enabled: deps.isCacheStatsEnabled(),
            tick: Game.time,
            route: {
                lookups: routeStats.lookups,
                hits: routeStats.hits,
                misses: routeStats.lookups - routeStats.hits,
                hitRate: safeDiv(routeStats.hits, routeStats.lookups),
                writes: routeStats.writes,
                skipByBudget: routeStats.skipByBudget,
                skipByCapacity: routeStats.skipByCapacity,
                skipRate: safeDiv(routeStats.skipByBudget + routeStats.skipByCapacity, routeStats.lookups),
                evictTTL: routeStats.evictTTL,
                evictBypass: routeStats.evictBypass,
                size: routeStats.size,
                nonBypassSize: routeStats.nonBypassSize,
            },
            path: {
                inserts: pathStats.inserts,
                trimRuns: pathStats.trimRuns,
                trimScans: pathStats.trimScans,
                trimDeletes: pathStats.trimDeletes,
                trimHitRate: safeDiv(pathStats.trimDeletes, pathStats.trimScans),
                size: deps.getGlobalPathCachePathCount(),
                insertQueueSize: Math.max(0, deps.pathCacheInsertQueue.length - deps.getPathCacheInsertHead()),
            },
        };
    }

    function bmResetCacheStats() {
        deps.resetCacheRuntimeStats();
        return OK;
    }

    function bmResolvePosArg(posOrObj) {
        if (!posOrObj) return null;
        const pos = posOrObj.pos || posOrObj;
        if (!pos || typeof pos !== 'object') return null;
        if (typeof pos.x !== 'number' || typeof pos.y !== 'number' || typeof pos.roomName !== 'string') return null;
        return pos;
    }

    /**
     * 删除指定起止条件下的缓存路径。
     * @description
     * 保持与历史 `deltePath` 行为一致：扫描起点 3x3 邻域，再按终点范围过滤，
     * 避免全表遍历导致的额外开销。
     */
    function bmDeltePath(fromPos, toPos, opts) {
        const from = bmResolvePosArg(fromPos);
        const to = bmResolvePosArg(toPos);
        if (!from || !to) return ERR_INVALID_ARGS;

        const ops = (opts && typeof opts === 'object') ? opts : {};
        ops.range = ops.range || 1;

        const fromFormalPos = deps.formalize(from);
        const toFormalPos = deps.formalize(to);
        if (typeof fromFormalPos.x !== 'number' || typeof fromFormalPos.y !== 'number' || typeof toFormalPos.x !== 'number' || typeof toFormalPos.y !== 'number') {
            return ERR_INVALID_ARGS;
        }

        const minY = toFormalPos.x + toFormalPos.y - 1 - ops.range;
        const maxY = toFormalPos.x + toFormalPos.y + 1 + ops.range;
        let deleted = 0;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const startKey = ((fromFormalPos.x + dx) << 16) | ((fromFormalPos.y + dy) & 0xFFFF);
                const xBucket = deps.globalPathCache[startKey];
                if (!xBucket) continue;

                for (const combinedYKey in xBucket) {
                    const combinedY = +combinedYKey;
                    if (combinedY < minY || combinedY > maxY) continue;
                    const pathArray = xBucket[combinedYKey];
                    if (!pathArray || !pathArray.length) continue;

                    for (let i = pathArray.length; i--;) {
                        const path = pathArray[i];
                        if (!path || !path.posArray || !path.posArray.length) continue;
                        if (!deps.isSameOps(path, ops)) continue;
                        if (!deps.isNear(path.start, fromFormalPos)) continue;
                        if (!deps.inRange(path.end, toFormalPos, ops.range)) continue;
                        deps.deletePath(path);
                        deleted++;
                    }
                }
            }
        }

        return deleted ? OK : ERR_NOT_FOUND;
    }

    function bmDeletePath(fromPos, toPos, opts) {
        return bmDeltePath(fromPos, toPos, opts);
    }

    function bmDeletePathInRoom(roomName) {
        const parsed = deps.parseRoomName(roomName);
        if (!parsed) {
            return ERR_INVALID_ARGS;
        }

        bmDeleteCostMatrix(roomName);

        if (!deps.getGlobalPathCachePathCount()) {
            return OK;
        }

        const sameRoomRefs = deps.roomSameRoomPathRefs[roomName];
        if (sameRoomRefs) {
            const versions = Object.keys(sameRoomRefs);
            for (let i = 0; i < versions.length; i++) {
                const path = sameRoomRefs[versions[i]];
                if (!path) continue;
                deps.deletePath(path);
            }
            const remainStart = deps.roomStartKeyCount[roomName] || 0;
            const remainEnd = deps.roomEndKeyCount[roomName] || 0;
            if (!remainStart && !remainEnd) {
                return OK;
            }
        }

        const roomKeyCount = deps.roomStartKeyCount[roomName] || 0;
        const roomEndCount = deps.roomEndKeyCount[roomName] || 0;
        if (!roomKeyCount && !roomEndCount) {
            return OK;
        }

        const bucketCount = deps.getGlobalPathCacheBucketCount();
        const useEndIndex = roomEndCount && (!roomKeyCount || roomEndCount < roomKeyCount);
        const useRoomIndex = !useEndIndex && roomKeyCount && roomKeyCount <= bucketCount;
        const useBucketScan = !useRoomIndex && !useEndIndex && bucketCount && bucketCount < 2500;

        if (useRoomIndex) {
            const roomKeys = deps.roomStartKeyRefs[roomName];
            if (!roomKeys) return OK;
            for (const startKey in roomKeys) {
                const targetCount = roomKeys[startKey] | 0;
                if (targetCount <= 0) continue;
                let deletedCount = 0;
                const xBucket = deps.globalPathCache[startKey];
                if (!xBucket) continue;
                for (const combinedYKey in xBucket) {
                    const pathArray = xBucket[combinedYKey];
                    if (!pathArray || !pathArray.length) continue;
                    for (let i = pathArray.length; i--;) {
                        const path = pathArray[i];
                        const posArray = path?.posArray;
                        if (!posArray || !posArray.length) continue;
                        if (posArray[0].roomName === roomName && posArray[posArray.length - 1].roomName === roomName) {
                            deps.deletePath(path);
                            deletedCount++;
                            if (deletedCount >= targetCount) break;
                        }
                    }
                    if (deletedCount >= targetCount) break;
                }
            }
            return OK;
        }

        if (useEndIndex) {
            const roomEndKeys = deps.roomEndKeyRefs[roomName];
            if (!roomEndKeys) return OK;
            const baseX = parsed.baseX;
            const baseY = parsed.baseY;
            const maxX = baseX + 50;
            const maxY = baseY + 50;
            for (const endKey in roomEndKeys) {
                const targetCount = roomEndKeys[endKey] | 0;
                if (targetCount <= 0) continue;
                let deletedCount = 0;
                const startKeys = deps.endKeyStartKeyRefs[endKey];
                if (!startKeys) continue;
                for (const startKey in startKeys) {
                    const key = +startKey;
                    const globalX = key >> 16;
                    const globalY = key & 0xFFFF;
                    if (globalX < baseX || globalX >= maxX || globalY < baseY || globalY >= maxY) continue;
                    const xBucket = deps.globalPathCache[key];
                    if (!xBucket) continue;
                    const pathArray = xBucket[endKey];
                    if (!pathArray || !pathArray.length) continue;
                    for (let i = pathArray.length; i--;) {
                        const path = pathArray[i];
                        const posArray = path?.posArray;
                        if (!posArray || !posArray.length) continue;
                        if (posArray[0].roomName === roomName && posArray[posArray.length - 1].roomName === roomName) {
                            deps.deletePath(path);
                            deletedCount++;
                            if (deletedCount >= targetCount) break;
                        }
                    }
                    if (deletedCount >= targetCount) break;
                }
            }
            return OK;
        }

        if (useBucketScan) {
            for (const startKey in deps.globalPathCache) {
                const xBucket = deps.globalPathCache[startKey];
                for (const combinedYKey in xBucket) {
                    const pathArray = xBucket[combinedYKey];
                    if (!pathArray || !pathArray.length) continue;
                    for (let i = pathArray.length; i--;) {
                        const path = pathArray[i];
                        const posArray = path?.posArray;
                        if (!posArray || !posArray.length) continue;
                        if (posArray[0].roomName === roomName && posArray[posArray.length - 1].roomName === roomName) {
                            deps.deletePath(path);
                        }
                    }
                }
            }
            return OK;
        }

        const baseX = parsed.baseX;
        const baseY = parsed.baseY;
        for (let x = 0; x < 50; x++) {
            const globalX = baseX + x;
            for (let y = 0; y < 50; y++) {
                const globalY = baseY + y;
                const startKey = (globalX << 16) | (globalY & 0xFFFF);
                const xBucket = deps.globalPathCache[startKey];
                if (!xBucket) continue;
                for (const combinedYKey in xBucket) {
                    const pathArray = xBucket[combinedYKey];
                    if (!pathArray || !pathArray.length) continue;
                    for (let i = pathArray.length; i--;) {
                        const path = pathArray[i];
                        const posArray = path?.posArray;
                        if (!posArray || !posArray.length) continue;
                        if (posArray[0].roomName === roomName && posArray[posArray.length - 1].roomName === roomName) {
                            deps.deletePath(path);
                        }
                    }
                }
            }
        }
        return OK;
    }

    function setRouteCacheEntry(key, entry) {
        const statsEnabled = deps.isCacheStatsEnabled();
        if (!(key in routeState.routeCache)) {
            routeState.entryCount = (routeState.entryCount | 0) + 1;
            if (!entry.bypass) {
                routeState.nonBypassEntryCount = (routeState.nonBypassEntryCount | 0) + 1;
            }
        }
        routeState.routeCache[key] = entry;
        if (statsEnabled) {
            routeState.writeStoreCount = (routeState.writeStoreCount | 0) + 1;
        }
    }

    function removeRouteCacheEntry(key, reason) {
        const statsEnabled = deps.isCacheStatsEnabled();
        if (!(key in routeState.routeCache)) return;
        const prev = routeState.routeCache[key];
        delete routeState.routeCache[key];
        if (routeState.entryCount > 0) {
            routeState.entryCount = routeState.entryCount - 1;
        }
        if (prev && !prev.bypass && routeState.nonBypassEntryCount > 0) {
            routeState.nonBypassEntryCount = routeState.nonBypassEntryCount - 1;
        }
        if (statsEnabled) {
            if (reason === 'bypass') {
                routeState.evictBypassCount = (routeState.evictBypassCount | 0) + 1;
            } else if (reason === 'ttl') {
                routeState.evictTTLCount = (routeState.evictTTLCount | 0) + 1;
            }
        }
    }

    function clearRouteCacheEntries() {
        for (const key in routeState.routeCache) {
            delete routeState.routeCache[key];
        }
        routeState.entryCount = 0;
        routeState.nonBypassEntryCount = 0;
        routeState.writeTick = -1;
        routeState.writeCount = 0;
        routeState.maintainTick = -1;
    }

    function canCacheRouteKey(key) {
        const statsEnabled = deps.isCacheStatsEnabled();
        if (key in routeState.routeCache) return true;

        const maxEntries = deps.config.routeCacheMaxEntries | 0;
        if (maxEntries > 0 && routeState.nonBypassEntryCount >= maxEntries) {
            if (statsEnabled) {
                routeState.skipByCapacityCount = (routeState.skipByCapacityCount | 0) + 1;
            }
            return false;
        }

        const maxNewPerTick = deps.config.routeCacheMaxNewPerTick | 0;
        if (maxNewPerTick <= 0) {
            if (statsEnabled) {
                routeState.skipByBudgetCount = (routeState.skipByBudgetCount | 0) + 1;
            }
            return false;
        }
        if (routeState.writeTick !== Game.time) {
            routeState.writeTick = Game.time;
            routeState.writeCount = 0;
        }
        if (routeState.writeCount >= maxNewPerTick) {
            if (statsEnabled) {
                routeState.skipByBudgetCount = (routeState.skipByBudgetCount | 0) + 1;
            }
            return false;
        }
        routeState.writeCount = (routeState.writeCount | 0) + 1;
        return true;
    }

    function trackRouteCacheKey(key, dueTick) {
        const tick = dueTick | 0;
        if (tick < 0) return;
        if (!(tick in routeState.routeCacheKeysByDueTick)) {
            routeState.routeCacheKeysByDueTick[tick] = [];
            deps.enqueueDueTick(routeState.routeCacheDueQueue, tick);
        }
        routeState.routeCacheKeysByDueTick[tick].push(key);
    }

    function trackBypassRouteCacheKey(key) {
        if (!(Game.time in routeState.bypassRouteCacheKeysByTick)) {
            routeState.bypassRouteCacheKeysByTick[Game.time] = [];
            deps.enqueueDueTick(routeState.bypassRouteCacheDueQueue, Game.time);
        }
        routeState.bypassRouteCacheKeysByTick[Game.time].push(key);
    }

    function clearExpiredBypassRouteCache() {
        const due = Game.time - 1;
        if (due < 0) return;
        deps.drainDueTickQueue(routeState.bypassRouteCacheDueQueue, due, (tick) => {
            const keys = routeState.bypassRouteCacheKeysByTick[tick];
            if (keys && keys.length) {
                for (let i = keys.length; i--;) {
                    removeRouteCacheEntry(keys[i], 'bypass');
                }
            }
            delete routeState.bypassRouteCacheKeysByTick[tick];
        });
    }

    function clearExpiredRouteCache(force) {
        clearExpiredBypassRouteCache();

        if (!deps.config.enableRouteCache) {
            clearRouteCacheEntries();
            routeState.trackedTtl = -1;
            deps.clearObjectKeys(routeState.routeCacheKeysByDueTick);
            deps.clearDueTickQueue(routeState.routeCacheDueQueue);
            deps.clearObjectKeys(routeState.bypassRouteCacheKeysByTick);
            deps.clearDueTickQueue(routeState.bypassRouteCacheDueQueue);
            return;
        }

        const ttl = deps.config.routeCacheTTL | 0;
        if (ttl <= 0) {
            routeState.trackedTtl = ttl;
            deps.clearObjectKeys(routeState.routeCacheKeysByDueTick);
            deps.clearDueTickQueue(routeState.routeCacheDueQueue);
            return;
        }

        if (routeState.trackedTtl !== ttl) {
            routeState.trackedTtl = ttl;
            deps.clearObjectKeys(routeState.routeCacheKeysByDueTick);
            deps.clearDueTickQueue(routeState.routeCacheDueQueue);
            for (const key in routeState.routeCache) {
                const entry = routeState.routeCache[key];
                if (!entry || entry.bypass) continue;
                if ((Game.time - (entry.tick | 0)) > ttl) {
                    removeRouteCacheEntry(key, 'ttl');
                    continue;
                }
                trackRouteCacheKey(key, (entry.tick | 0) + ttl + 1);
            }
        }

        if (force) {
            for (const key in routeState.routeCache) {
                const entry = routeState.routeCache[key];
                if (!entry || entry.bypass) continue;
                if ((Game.time - (entry.tick | 0)) > ttl) {
                    removeRouteCacheEntry(key, 'ttl');
                }
            }
            return;
        }

        deps.drainDueTickQueue(routeState.routeCacheDueQueue, Game.time, (tick) => {
            const keys = routeState.routeCacheKeysByDueTick[tick];
            if (keys && keys.length) {
                for (let i = keys.length; i--;) {
                    const key = keys[i];
                    const entry = routeState.routeCache[key];
                    if (!entry || entry.bypass) continue;
                    if ((Game.time - (entry.tick | 0)) > ttl) {
                        removeRouteCacheEntry(key, 'ttl');
                    }
                }
            }
            delete routeState.routeCacheKeysByDueTick[tick];
        });
    }

    function ensureRouteCacheMaintenance(force) {
        if (!force && routeState.maintainTick === Game.time) return;
        routeState.maintainTick = Game.time;
        clearExpiredRouteCache(force);
    }

    function getRouteCacheKey(fromRoomName, toRoomName, bypass) {
        if (!bypass) {
            return `${fromRoomName}|${toRoomName}|0|${deps.getAvoidRoomsVersion()}|${deps.getAvoidExitsVersion()}`;
        }
        return `${fromRoomName}|${toRoomName}|1|${deps.getAvoidRoomsVersion()}|${deps.getAvoidExitsVersion()}|${temporalState.from}|${temporalState.to}|${temporalState.bounceFrom}|${temporalState.bounceTo}|${temporalState.bounceUntil || 0}|${Game.time}`;
    }

    function routeCallback(nextRoomName, fromRoomName) {
        if (deps.isExitAvoided(fromRoomName, nextRoomName)) {
            return Infinity;
        }
        if (deps.isRoomAvoided(nextRoomName)) {
            return Infinity;
        }
        return deps.isHighWay(nextRoomName) ? 1 : 1.15;
    }

    function bypassRouteCallback(nextRoomName, fromRoomName) {
        if (fromRoomName == temporalState.from && nextRoomName == temporalState.to) {
            return Infinity;
        }
        if (temporalState.bounceUntil && Game.time <= temporalState.bounceUntil && fromRoomName == temporalState.bounceFrom && nextRoomName == temporalState.bounceTo) {
            return Infinity;
        }
        return routeCallback(nextRoomName, fromRoomName);
    }

    function findRoute(fromRoomName, toRoomName, bypass, ops) {
        const currentShard = Game.shard?.name;
        const parsedFrom = deps.parseShardRoomName(fromRoomName);
        const parsedTo = deps.parseShardRoomName(toRoomName);
        if ((parsedFrom.shard && parsedFrom.shard !== currentShard) || (parsedTo.shard && parsedTo.shard !== currentShard)) {
            return ERR_NO_PATH;
        }
        fromRoomName = parsedFrom.room;
        toRoomName = parsedTo.room;

        deps.ensureAvoidRoomsUpToDate();
        ensureRouteCacheMaintenance(false);
        const useScopedAvoids = deps.hasScopedAvoids(ops);
        if (deps.config.enableRouteCache && !useScopedAvoids) {
            const statsEnabled = deps.isCacheStatsEnabled();
            const key = getRouteCacheKey(fromRoomName, toRoomName, bypass);
            const cached = routeState.routeCache[key];
            const ttl = deps.config.routeCacheTTL | 0;
            if (statsEnabled) {
                routeState.lookupCount = (routeState.lookupCount | 0) + 1;
            }
            if (cached && (bypass || ttl <= 0 || (Game.time - cached.tick) <= ttl)) {
                if (statsEnabled) {
                    routeState.hitCount = (routeState.hitCount | 0) + 1;
                }
                return cached.route;
            }
            const result = bypass
                ? Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: bypassRouteCallback })
                : Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: routeCallback });
            const routeTick = Game.time;
            if (!bypass && !canCacheRouteKey(key)) {
                return result;
            }
            setRouteCacheEntry(key, { tick: routeTick, route: result, bypass: bypass ? 1 : 0 });
            if (bypass) {
                trackBypassRouteCacheKey(key);
            } else if (ttl > 0) {
                trackRouteCacheKey(key, routeTick + ttl + 1);
            }
            return result;
        }
        if (bypass) {
            return Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: bypassRouteCallback });
        }
        return Game.map.findRoute(fromRoomName, toRoomName, { routeCallback: routeCallback });
    }

    /**
     * 记录“本房到某个出口暂时不可走”的状态。
     * 该状态只用于临时绕路，不会污染普通 route cache。
     */
    function checkTemporalAvoidExit(pos, room, currentCostMat, targetRoomName) {
        temporalState.from = '';
        temporalState.to = '';

        const cacheTTL = deps.getPositiveConfigNumber(deps.config.temporalAvoidExitCheckTTL, 1);
        if (temporalState.cacheTick === -1 || (Game.time - temporalState.cacheTick) >= cacheTTL) {
            temporalState.cacheTick = Game.time;
            temporalState.cache = Object.create(null);
        }

        const cacheKey = `${room.name}|${pos.x}|${pos.y}|${targetRoomName || ''}|${deps.getCurrentAvoidScopeSignature()}`;
        if (cacheKey in temporalState.cache) {
            const cached = temporalState.cache[cacheKey];
            if (cached) {
                temporalState.from = room.name;
                temporalState.to = cached;
            }
            return;
        }

        const neighbors = Game.map.describeExits(room.name);
        const refine = !!deps.config.enableTemporalBypassRefine;

        if (targetRoomName) {
            const preferredExitDir = room.findExitTo(targetRoomName);
            if (deps.isNearExitDirection(pos, preferredExitDir, 2)) {
                temporalState.cache[cacheKey] = '';
                return;
            }
        }

        if (!refine) {
            for (const direction in neighbors) {
                const nextRoom = neighbors[direction];
                if (deps.isRoomAvoided(nextRoom) || deps.isExitAvoided(room.name, nextRoom)) continue;
                const exits = room.find(+direction);
                if (PathFinder.search(pos, exits, {
                    maxRooms: 1,
                    roomCallback: () => currentCostMat
                }).incomplete) {
                    temporalState.from = room.name;
                    temporalState.to = nextRoom;
                }
            }
            temporalState.cache[cacheKey] = temporalState.to || '';
            return;
        }

        const exitCandidates = [];
        for (const direction in neighbors) {
            const nextRoom = neighbors[direction];
            if (!nextRoom || deps.isRoomAvoided(nextRoom) || deps.isExitAvoided(room.name, nextRoom)) continue;
            const score = targetRoomName ? Game.map.getRoomLinearDistance(nextRoom, targetRoomName, true) : 0;
            exitCandidates.push({ direction: +direction, nextRoom, score });
        }
        exitCandidates.sort((a, b) => a.score - b.score);

        for (let i = 0; i < exitCandidates.length; i++) {
            const candidate = exitCandidates[i];
            const exits = room.find(candidate.direction);
            if (PathFinder.search(pos, exits, {
                maxRooms: 1,
                roomCallback: () => currentCostMat
            }).incomplete) {
                temporalState.from = room.name;
                temporalState.to = candidate.nextRoom;
                break;
            }
        }

        temporalState.cache[cacheKey] = temporalState.to || '';
    }

    function buildRouteRoomSet(routeList, startRoomName) {
        const roomSet = Object.create(null);
        roomSet[startRoomName] = 1;
        for (let i = routeList.length; i--;) {
            roomSet[routeList[i].room] = 1;
        }
        return roomSet;
    }

    function bypassHostile(creep) {
        return !creep.my;
    }

    function bypassMy() {
        return false;
    }

    function getReusableBypassCostMatrix(roomName, ignoreCondition) {
        const key = `${roomName}|${ignoreCondition ? 1 : 0}`;
        const baseRev = deps.costMatrixRevision[roomName] | 0;
        let entry = deps.bypassCostMatReuseCache[key];
        if (!entry || entry.tick !== Game.time || entry.baseRev !== baseRev) {
            entry = deps.bypassCostMatReuseCache[key] = {
                tick: Game.time,
                baseRev,
                mat: deps.costMatrixCache[roomName][ignoreCondition].clone(),
                changedKeys: [],
                oldCosts: []
            };
        } else {
            entry.changedKeys.length = 0;
            entry.oldCosts.length = 0;
        }
        return entry;
    }

    function applyTemporaryCreepBlocks(mat, creeps, changedKeys, oldCosts) {
        for (let i = creeps.length; i--;) {
            const creep = creeps[i];
            const x = creep.pos.x;
            const y = creep.pos.y;
            const key = x * 50 + y;
            changedKeys.push(key);
            oldCosts.push(mat.get(x, y));
            mat.set(x, y, deps.unWalkableCCost);
        }
    }

    function applyTemporaryRoomEdgePenalty(mat, changedKeys, oldCosts, edgeCost) {
        if (!mat || edgeCost <= 1 || edgeCost >= deps.unWalkableCCost) {
            return;
        }

        const patch = (x, y) => {
            const oldCost = mat.get(x, y);
            if (oldCost == deps.unWalkableCCost || oldCost >= edgeCost) {
                return;
            }
            changedKeys.push(x * 50 + y);
            oldCosts.push(oldCost);
            mat.set(x, y, edgeCost);
        };

        for (let x = 0; x < 50; x++) {
            patch(x, 0);
            patch(x, 49);
        }
        for (let y = 1; y < 49; y++) {
            patch(0, y);
            patch(49, y);
        }
    }

    function rollbackTemporaryCreepBlocks(mat, changedKeys, oldCosts) {
        for (let i = changedKeys.length; i--;) {
            const key = changedKeys[i];
            const x = (key / 50) | 0;
            const y = key - x * 50;
            mat.set(x, y, oldCosts[i]);
        }
    }

    function bypassRoomCallback(roomName) {
        if (deps.isRoomAvoided(roomName)) {
            return false;
        }
        if (roomName == bypassRoomName) {
            costMat = bypassCostMat;
        } else {
            const roomCache = deps.costMatrixCache[roomName];
            costMat = roomCache ? roomCache[findPathIgnoreCondition] : deps.emptyCostMatrix;
        }

        if (userCostCallback) {
            const roomCache = deps.costMatrixCache[roomName];
            const resultCostMat = userCostCallback(roomName, roomCache ? costMat.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                costMat = resultCostMat;
            }
        }
        return costMat;
    }

    function bypassRoomCallbackWithRoute(roomName) {
        if (roomName in route) {
            if (roomName == bypassRoomName) {
                costMat = bypassCostMat;
            } else {
                const roomCache = deps.costMatrixCache[roomName];
                costMat = roomCache ? roomCache[findPathIgnoreCondition] : deps.emptyCostMatrix;
            }

            if (userCostCallback) {
                const roomCache = deps.costMatrixCache[roomName];
                const resultCostMat = userCostCallback(roomName, roomCache ? costMat.clone() : new PathFinder.CostMatrix);
                if (resultCostMat instanceof PathFinder.CostMatrix) {
                    costMat = resultCostMat;
                }
            }
            return costMat;
        }
        return false;
    }

    function applyStartPosWalkable(currentCostMat, roomName) {
        const start = findPathStartPos;
        if (!start || start.roomName !== roomName) return currentCostMat;
        if (currentCostMat.get(start.x, start.y) !== deps.unWalkableCCost) return currentCostMat;
        if (!findPathStartMat) {
            findPathStartMat = currentCostMat.clone();
            findPathStartMat.set(start.x, start.y, 1);
        }
        return findPathStartMat;
    }

    function getCostMatrixForFindPath(roomName) {
        if (!(roomName in deps.costMatrixCache)) {
            return deps.emptyCostMatrix;
        }
        if (
            deps.config.enableSameRoomEdgePenalty &&
            findPathSameRoomEdgeRoomName &&
            roomName == findPathSameRoomEdgeRoomName
        ) {
            return deps.getSameRoomEdgeCostMatrix(roomName, findPathIgnoreCondition);
        }
        return deps.costMatrixCache[roomName][findPathIgnoreCondition];
    }

    function roomCallback(roomName) {
        if (deps.isRoomAvoided(roomName)) {
            return false;
        }

        costMat = getCostMatrixForFindPath(roomName);
        if (userCostCallback) {
            const roomCache = deps.costMatrixCache[roomName];
            const resultCostMat = userCostCallback(roomName, roomCache ? costMat.clone() : new PathFinder.CostMatrix);
            if (resultCostMat instanceof PathFinder.CostMatrix) {
                costMat = resultCostMat;
            }
        }
        costMat = applyStartPosWalkable(costMat, roomName);
        if (findPathAllowPortal && findPathPortalPos && roomName === findPathPortalPos.roomName) {
            if (!findPathPortalMat) {
                findPathPortalMat = costMat.clone();
                findPathPortalMat.set(findPathPortalPos.x, findPathPortalPos.y, 1);
            }
            return findPathPortalMat;
        }
        return costMat;
    }

    function roomCallbackWithRoute(roomName) {
        if (roomName in route) {
            costMat = getCostMatrixForFindPath(roomName);
            if (userCostCallback) {
                const roomCache = deps.costMatrixCache[roomName];
                const resultCostMat = userCostCallback(roomName, roomCache ? costMat.clone() : new PathFinder.CostMatrix);
                if (resultCostMat instanceof PathFinder.CostMatrix) {
                    costMat = resultCostMat;
                }
            }
            costMat = applyStartPosWalkable(costMat, roomName);
            if (findPathAllowPortal && findPathPortalPos && roomName === findPathPortalPos.roomName) {
                if (!findPathPortalMat) {
                    findPathPortalMat = costMat.clone();
                    findPathPortalMat.set(findPathPortalPos.x, findPathPortalPos.y, 1);
                }
                return findPathPortalMat;
            }
            return costMat;
        }
        return false;
    }

    function findTemporalPath(creep, toPos, ops) {
        deps.ensureAvoidRoomsUpToDate();
        ops.bypassRange = typeof ops.bypassRange === 'number' ? ops.bypassRange : 5;
        let nearbyCreeps;
        if (ops.ignoreCreeps) {
            nearbyCreeps = creep.pos.findInRange(FIND_CREEPS, ops.bypassRange, {
                filter: ops.bypassHostileCreeps ? bypassHostile : bypassMy
            }).concat(creep.pos.findInRange(FIND_POWER_CREEPS, ops.bypassRange, {
                filter: ops.bypassHostileCreeps ? bypassHostile : bypassMy
            }));
        } else {
            nearbyCreeps = creep.pos.findInRange(FIND_CREEPS, ops.bypassRange).concat(
                creep.pos.findInRange(FIND_POWER_CREEPS, ops.bypassRange)
            );
        }
        if (!(creep.room.name in deps.costMatrixCache)) {
            deps.generateCostMatrix(creep.room, creep.pos);
        }
        bypassIgnoreCondition = !!ops.ignoreDestructibleStructures;
        findPathIgnoreCondition = bypassIgnoreCondition;
        const applySameRoomEdgePenalty =
            !!deps.config.enableSameRoomEdgePenalty && creep.pos.roomName == toPos.roomName;
        const sameRoomEdgePenaltyCost = applySameRoomEdgePenalty
            ? deps.getPositiveConfigNumber(deps.config.sameRoomEdgePenaltyCost, 20)
            : 0;
        let reuseEntry;
        if (deps.config.enableBypassCostMatReuse) {
            reuseEntry = getReusableBypassCostMatrix(creep.room.name, bypassIgnoreCondition);
            bypassCostMat = reuseEntry.mat;
            applyTemporaryCreepBlocks(bypassCostMat, nearbyCreeps, reuseEntry.changedKeys, reuseEntry.oldCosts);
            if (applySameRoomEdgePenalty) {
                applyTemporaryRoomEdgePenalty(
                    bypassCostMat,
                    reuseEntry.changedKeys,
                    reuseEntry.oldCosts,
                    sameRoomEdgePenaltyCost
                );
            }
        } else {
            bypassCostMat = deps.costMatrixCache[creep.room.name][bypassIgnoreCondition].clone();
            for (let i = nearbyCreeps.length; i--;) {
                const creepInWay = nearbyCreeps[i];
                bypassCostMat.set(creepInWay.pos.x, creepInWay.pos.y, deps.unWalkableCCost);
            }
            if (applySameRoomEdgePenalty) {
                deps.applyRoomEdgePenalty(bypassCostMat, sameRoomEdgePenaltyCost);
            }
        }
        bypassRoomName = creep.room.name;
        userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;

        const pathFinderOpts = deps.createPathFinderBaseOpts(ops);
        deps.applyMoveToTerrainCosts(pathFinderOpts, ops);

        return deps.withScopedAvoids(ops, () => {
            try {
                if (creep.pos.roomName != toPos.roomName) {
                    checkTemporalAvoidExit(creep.pos, creep.room, bypassCostMat, toPos.roomName);
                    route = findRoute(creep.pos.roomName, toPos.roomName, true, ops);
                    if (route == ERR_NO_PATH) {
                        return false;
                    }
                    pathFinderOpts.maxRooms = pathFinderOpts.maxRooms || route.length + 1;
                    pathFinderOpts.maxOps = ops.maxOps || 4000 + route.length ** 2 * 100;
                    route = buildRouteRoomSet(route, creep.pos.roomName);
                    pathFinderOpts.roomCallback = bypassRoomCallbackWithRoute;
                } else {
                    pathFinderOpts.maxOps = ops.maxOps;
                    pathFinderOpts.roomCallback = bypassRoomCallback;
                }

                const searchResult = PathFinder.search(creep.pos, { pos: toPos, range: ops.range }, pathFinderOpts);
                if (searchResult.incomplete && searchResult.path.length <= 1) {
                    return false;
                }
                const result = searchResult.path;
                if (result.length) {
                    const creepCache = deps.creepPathCache[creep.name];
                    const posArray = creepCache.path.posArray;
                    const resultFinalPos = result[result.length - 1];
                    if (resultFinalPos && resultFinalPos.getRangeTo(toPos) > ops.range) {
                        let appendIdx = -1;
                        for (let idx = creepCache.idx + 2; idx < posArray.length; idx++) {
                            if (posArray[idx].getRangeTo(resultFinalPos) === 0) {
                                appendIdx = idx + 1;
                                break;
                            }
                        }
                        if (appendIdx >= 0) {
                            while (appendIdx < posArray.length) {
                                result.push(posArray[appendIdx++]);
                            }
                        }
                    }
                    creepCache.path = {
                        end: deps.formalize(result[result.length - 1]),
                        posArray: result,
                        ignoreStructures: !!ops.ignoreDestructibleStructures
                    };
                    deps.ensurePathVersion(creepCache.path);
                    deps.generateDirectionArray(creepCache.path);
                    return true;
                }
                return false;
            } finally {
                if (reuseEntry) {
                    rollbackTemporaryCreepBlocks(bypassCostMat, reuseEntry.changedKeys, reuseEntry.oldCosts);
                }
            }
        });
    }

    function findPath(fromPos, toPos, ops) {
        deps.ensureAvoidRoomsUpToDate();

        if (!(fromPos.roomName in deps.costMatrixCache) && fromPos.roomName in Game.rooms) {
            deps.generateCostMatrix(Game.rooms[fromPos.roomName], fromPos);
        }

        findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;
        findPathStartPos = fromPos;
        findPathStartMat = null;
        userCostCallback = typeof ops.costCallback == 'function' ? ops.costCallback : undefined;
        findPathAllowPortal = !!ops._bmAllowPortal;
        findPathPortalPos = findPathAllowPortal ? toPos : null;
        findPathPortalMat = null;
        findPathSameRoomEdgeRoomName =
            deps.config.enableSameRoomEdgePenalty && fromPos.roomName == toPos.roomName ? fromPos.roomName : '';

        const pathFinderOpts = deps.createPathFinderBaseOpts(ops);
        deps.applyMoveToTerrainCosts(pathFinderOpts, ops);

        return deps.withScopedAvoids(ops, () => {
            if (fromPos.roomName != toPos.roomName) {
                route = findRoute(fromPos.roomName, toPos.roomName, false, ops);
                if (route == ERR_NO_PATH) {
                    return { path: [] };
                }
                pathFinderOpts.maxOps = ops.maxOps || 4000 + route.length ** 2 * 100;
                pathFinderOpts.maxRooms = pathFinderOpts.maxRooms || route.length + 1;
                route = buildRouteRoomSet(route, fromPos.roomName);
                pathFinderOpts.roomCallback = roomCallbackWithRoute;
            } else {
                pathFinderOpts.maxOps = ops.maxOps;
                pathFinderOpts.roomCallback = roomCallback;
            }

            return PathFinder.search(fromPos, { pos: toPos, range: ops.range }, pathFinderOpts);
        });
    }

    function findPathInCache(formalFromPos, formalToPos, fromPos, toRoomName, creepCache, ops, requireSecondStepCheck) {
        const statsEnabled = deps.isCpuStatsEnabled();
        if (statsEnabled) {
            deps.setStartCacheSearch(Game.cpu.getUsed());
        }

        const range = ops.range | 0;
        const endKey = formalToPos.x + formalToPos.y;
        const minY = endKey - 1 - range;
        const maxY = endKey + 1 + range;
        const variantKey = deps.buildPathVariantKeyFromQuery(ops, toRoomName);

        const visit = (pathArray, skipOpsCheck) => {
            for (let i = pathArray.length; i--;) {
                const path = pathArray[i];
                if (statsEnabled) deps.runtimeMetrics.pathCounter++;
                if (!skipOpsCheck && !deps.isSameOps(path, ops)) {
                    continue;
                }
                if (!deps.isNear(path.start, formalFromPos)) {
                    continue;
                }
                if (requireSecondStepCheck && fromPos && !deps.isNear(fromPos, path.posArray[1])) {
                    continue;
                }
                if (!deps.inRange(path.end, formalToPos, ops.range)) {
                    continue;
                }
                creepCache.path = path;
                return true;
            }
            return false;
        };

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const startKey = ((formalFromPos.x + dx) << 16) | ((formalFromPos.y + dy) & 0xFFFF);
                const variantBuckets = deps.globalPathCacheByVariant[startKey];
                const variantYBuckets = variantBuckets && variantBuckets[variantKey];
                if (variantYBuckets) {
                    for (let combinedY = minY; combinedY <= maxY; combinedY++) {
                        const pathArray = variantYBuckets[combinedY];
                        if (!pathArray) continue;
                        if (visit(pathArray, true)) return true;
                    }
                    continue;
                }

                const xBucket = deps.globalPathCache[startKey];
                if (!xBucket) continue;
                for (let combinedY = minY; combinedY <= maxY; combinedY++) {
                    const pathArray = xBucket[combinedY];
                    if (!pathArray) continue;
                    if (visit(pathArray, false)) return true;
                }
            }
        }

        return false;
    }

    function findShortPathInCache(formalFromPos, formalToPos, fromPos, toRoomName, creepCache, ops) {
        return findPathInCache(formalFromPos, formalToPos, fromPos, toRoomName, creepCache, ops, true);
    }

    function findLongPathInCache(formalFromPos, formalToPos, toRoomName, creepCache, ops) {
        return findPathInCache(formalFromPos, formalToPos, undefined, toRoomName, creepCache, ops, false);
    }

    /**
     * 为跨房缓存路径记录最近使用时间，供延迟回收逻辑按需清理。
     */
    function setPathTimer(creepCache) {
        const pathClearDelay = deps.getPathClearDelay();
        if (!pathClearDelay) {
            return;
        }

        const posArray = creepCache.path.posArray;
        const startRoomName = posArray[0].roomName;
        const endRoomName = posArray[posArray.length - 1].roomName;
        if (startRoomName != endRoomName || (startRoomName in Game.rooms && Game.rooms[startRoomName].controller && !Game.rooms[startRoomName].controller.my)) {
            const pathDueTick = Game.time + pathClearDelay;
            if (!(pathDueTick in deps.pathCacheTimer)) {
                deps.pathCacheTimer[pathDueTick] = [];
                deps.enqueueDueTick(deps.pathCacheTimerDueQueue, pathDueTick);
            }
            deps.pathCacheTimer[pathDueTick].push(creepCache.path);
            creepCache.path.lastTime = Game.time;
        }
    }

    /**
     * 执行 observer 队列中的房间校验任务。
     * 若路径已失效或已能直接判断，则立即丢弃任务，避免队列长期堆积。
     */
    function doObTask() {
        for (let i = observerState.observers.length - 1; i >= 0; i--) {
            const obData = observerState.observers[i];
            while (deps.getObserverQueueSize(obData) > 0) {
                const task = deps.peekObserverTask(obData);
                if (!task) {
                    deps.dropObserverTask(obData);
                    continue;
                }
                const roomName = task.roomName;
                if (deps.isObserverTaskExpired(task) || deps.isObserverTaskStale(task)) {
                    deps.dropObserverTask(obData);
                    continue;
                }
                if (roomName in Game.rooms) {
                    const ok = deps.checkRoom(Game.rooms[roomName], task.path, task.idx - 1);
                    if (!ok) {
                        deps.deletePath(task.path);
                    }
                    deps.dropObserverTask(obData);
                    continue;
                }
                if (roomName in deps.costMatrixCache) {
                    if (!task.path.directionArray[task.idx]) {
                        const ok = deps.checkRoom({ name: roomName }, task.path, task.idx - 1);
                        if (!ok) {
                            deps.deletePath(task.path);
                        }
                    }
                    deps.dropObserverTask(obData);
                    continue;
                }
                const ob = Game.getObjectById(obData.id);
                if (!ob) {
                    observerState.observers.splice(i, 1);
                    break;
                }
                const code = ob.observeRoom(roomName);
                if (code !== OK) {
                    deps.dropObserverTask(obData);
                    continue;
                }
                obData.lastIssuedTick = Game.time;
                const obDueTick = Game.time + 1;
                if (!(obDueTick in observerState.obTimer)) {
                    observerState.obTimer[obDueTick] = [];
                    deps.enqueueDueTick(observerState.obTimerDueQueue, obDueTick);
                }
                observerState.obTimer[obDueTick].push({
                    path: task.path,
                    idx: task.idx,
                    roomName,
                    pathVersion: task.pathVersion,
                    expireTick: task.expireTick
                });
                deps.dropObserverTask(obData);
                break;
            }
        }
    }

    /**
     * 处理上一 tick observer 返回的房间视野结果，并即时失效被确认堵住的缓存路径。
     */
    function checkObResult() {
        deps.drainDueTickQueue(observerState.obTimerDueQueue, Game.time, (tick) => {
            if (tick < Game.time) {
                delete observerState.obTimer[tick];
                return;
            }
            const results = observerState.obTimer[tick];
            if (!results || !results.length) {
                delete observerState.obTimer[tick];
                return;
            }
            for (let i = results.length; i--;) {
                const result = results[i];
                if (deps.isObserverTaskExpired(result) || deps.isObserverTaskStale(result)) {
                    continue;
                }
                if (result.roomName in Game.rooms) {
                    const ok = deps.checkRoom(Game.rooms[result.roomName], result.path, result.idx - 1);
                    if (!ok) {
                        deps.deletePath(result.path);
                    }
                }
            }
            delete observerState.obTimer[tick];
        });
    }

    /**
     * BetterMove 每 tick 的轻量维护入口。
     * 继续保留“同 tick 只跑一次”的旧语义，避免重复扫描 route/observer/portal。
     */
    function runMoveOptTickMaintenance() {
        if (observerState.obTick < Game.time) {
            observerState.obTick = Game.time;
            ensureRouteCacheMaintenance(false);
            checkObResult();
            doObTask();
            deps.scanPortals(false);
        }
    }

    return {
        bmSetPathClearDelay,
        bmSetHostileCostMatrixClearDelay,
        bmDeleteCostMatrix,
        bmGetCacheStats,
        bmResetCacheStats,
        bmDeltePath,
        bmDeletePath,
        bmDeletePathInRoom,
        clearRouteCacheEntries,
        ensureRouteCacheMaintenance,
        findTemporalPath,
        findPath,
        findShortPathInCache,
        findLongPathInCache,
        setPathTimer,
        runMoveOptTickMaintenance,
    };
}
