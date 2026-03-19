// @ts-nocheck

/**
 * BetterMove 过期缓存清理。
 * @description
 * 把路径/CostMatrix 的定时回收从主文件抽走，避免 `index.ts` 在核心移动流程中混入大量 housekeeping 细节。
 */
export function clearObjectKeys(obj) {
    for (const key in obj) {
        delete obj[key];
    }
}

export function createCleanupModule(deps) {
    function clearDeadCreepPathCache() {
        if (Game.time % deps.getPathClearDelay() == 0) {
            for (const name in deps.creepPathCache) {
                if (!(name in Game.creeps)) {
                    delete deps.creepPathCache[name];
                }
            }
        }
    }

    function clearExpiredPaths() {
        deps.drainDueTickQueue(deps.pathCacheTimerDueQueue, Game.time, (time) => {
            const paths = deps.pathCacheTimer[time];
            if (!paths || !paths.length) {
                delete deps.pathCacheTimer[time];
                return;
            }
            for (let i = paths.length; i--;) {
                const path = paths[i];
                if (path.lastTime == time - deps.getPathClearDelay()) {
                    deps.deletePath(path);
                }
            }
            delete deps.pathCacheTimer[time];
        });
    }

    function clearExpiredCostMatrix() {
        deps.drainDueTickQueue(deps.costMatrixCacheTimerDueQueue, Game.time, (time) => {
            let avoidChanged = false;
            const dataList = deps.costMatrixCacheTimer[time];
            if (!dataList || !dataList.length) {
                delete deps.costMatrixCacheTimer[time];
                return;
            }
            for (let i = dataList.length; i--;) {
                const data = dataList[i];
                delete deps.costMatrixCache[data.roomName];
                delete deps.costMatrixRevision[data.roomName];
                delete deps.sameRoomEdgeCostMatCache[data.roomName];
                const avoids = data.avoids;
                for (let j = avoids.length; j--;) {
                    const avoidRoomName = avoids[j];
                    if (avoidRoomName in deps.avoidRooms) {
                        delete deps.avoidRooms[avoidRoomName];
                        avoidChanged = true;
                    }
                }
            }
            if (avoidChanged) {
                deps.markAvoidRoomsChanged();
            }
            delete deps.costMatrixCacheTimer[time];
        });
    }

    function clearUnused() {
        clearDeadCreepPathCache();
        clearExpiredPaths();
        clearExpiredCostMatrix();
    }

    return {
        clearObjectKeys,
        clearDeadCreepPathCache,
        clearExpiredPaths,
        clearExpiredCostMatrix,
        clearUnused,
    };
}
