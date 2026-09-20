import { compress, decompress } from '@/shared/compress';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getRoomData } from '@/shared/memory';
import { runWorkLayer } from '@/framework/ai/adapters';
import { MoveWorkTileCandidate, writeMoveWorkTileCandidates } from '@/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';
import type { CreepCacheTarget } from '@/interface/creep-cache.interface';

type WorkerTaskData = BuildTask | RepairTask;

type WorkerCache = CreepCacheTarget & {
    _roomName?: string;
    wallPos?: number;
    repairId?: Id<Structure>;
};

type WorkerRoomTargetCache = {
    tick: number;
    buildId?: Id<ConstructionSite>;
    buildPos?: number;
    repairId?: Id<Structure>;
    repairPos?: number;
    repairHits?: number;
};

const getWorkTargetCache = (() => {
    const root: Record<string, WorkerRoomTargetCache> = {};
    return (roomName: string) => {
        if (!root[roomName]) root[roomName] = { tick: -1 };
        return root[roomName];
    };
})();

const getCache = (creep: Creep) => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    return (cache.target && typeof cache.target === 'object' ? cache.target : (cache.target = {})) as WorkerCache;
}

const resetCacheIfRoomChanged = (creep: Creep, cache: WorkerCache) => {
    const roomName = creep.room.name;
    if (cache._roomName && cache._roomName !== roomName) {
        delete cache.task;
        delete cache.taskid;
        delete cache.tasktype;
        delete cache.wallPos;
        delete cache.targetHits;
        delete cache.buildRampartId;
        delete cache.buildRampart;
        delete cache.posInfo;
    }
    cache._roomName = roomName;
}

const isEarlyRushEnabled = (room: Room) => {
    if (!room.controller?.my) return false;
    const mode = (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
    return mode === 'rush';
}

const getBuildSitePriority = (room: Room, site: ConstructionSite) => {
    const remaining = Math.max(0, site.progressTotal - site.progress);
    const remainingBucket = Math.min(90, Math.floor(remaining / 500));

    if (isEarlyRushEnabled(room)) {
        let base = 6;
        if (site.structureType === STRUCTURE_SPAWN) base = 0;
        else if (site.structureType === STRUCTURE_EXTENSION || site.structureType === STRUCTURE_TOWER) base = 1;
        else if (site.structureType === STRUCTURE_CONTAINER) base = 2;
        else if (site.structureType === STRUCTURE_ROAD) base = 4;
        else if (site.structureType === STRUCTURE_LINK) base = 5;
        return base * 100 + remainingBucket;
    }

    let level = Math.round((1 - site.progress / site.progressTotal) * 4);
    if (site.structureType === STRUCTURE_TERMINAL ||
        site.structureType === STRUCTURE_STORAGE ||
        site.structureType === STRUCTURE_SPAWN) {
        level = 0;
    } else if (site.structureType === STRUCTURE_EXTENSION ||
        site.structureType === STRUCTURE_ROAD) {
        level += 0;
    } else if (site.structureType === STRUCTURE_LINK ||
        site.structureType === STRUCTURE_TOWER) {
        level += 4;
    } else {
        level += 8;
    }
    return level * 100 + remainingBucket;
}

const pushWorkerCandidate = (candidates: MoveWorkTileCandidate[], pos: RoomPosition | null | undefined, range = 3) => {
    if (!pos) return;
    candidates.push({ pos, range });
};

const isRampart = (structure: Structure | null | undefined): structure is StructureRampart =>
    !!structure && structure.structureType === STRUCTURE_RAMPART;

const getRepairTaskHits = (task: WorkerTaskData): number | undefined =>
    'hits' in task ? task.hits : undefined;

const RepairRampart = function (creep: Creep, candidates: MoveWorkTileCandidate[]) {
    const cache = getCache(creep)
    if (cache.buildRampartId) {
        const rampart = Game.getObjectById(cache.buildRampartId);
        if (!isRampart(rampart) || rampart.hits >= THRESHOLDS.REPAIR.RAMPART_BUILD_BUFFER) {
            delete cache.buildRampartId;
            return false;
        } else {
            pushWorkerCandidate(candidates, rampart.pos);
            creep.goRepair(rampart);
            return true;
        }
    }

    if (cache.buildRampart && !cache.task) {
        const [x, y] = decompress(cache.posInfo);
        const Pos = new RoomPosition(x, y, creep.room.name);
        const rampart = Pos.lookFor(LOOK_STRUCTURES).find(isRampart);
        if (rampart) {
            cache.buildRampartId = rampart.id;
            pushWorkerCandidate(candidates, rampart.pos);
        }
        delete cache.posInfo;
        delete cache.buildRampart;
        return true;
    }
    
    return false;
}

const BuildRepairWork = function (creep: Creep, candidates: MoveWorkTileCandidate[]) {
    const LOCAL_BUILD_TASK_ID = '__local_build__';
    const cache = getCache(creep)
    resetCacheIfRoomChanged(creep, cache);
    let target = null;
    let taskType: 'build' | 'repair' | null = null;
    let taskid: string | null = null;
    const sites = (creep.room as any).constructionSite || creep.room.find(FIND_CONSTRUCTION_SITES);
    const hasBuildTarget = sites.some((s: ConstructionSite) => s && (s as any).my);

    if (RepairRampart(creep, candidates)) return true;

    if (hasBuildTarget && cache.task && cache.tasktype !== 'build') {
        delete cache.task;
        delete cache.taskid;
        delete cache.tasktype;
        delete cache.wallPos;
        delete cache.targetHits;
    }

    if (!cache.task) {
        let task = creep.room.getBuildMission(creep);
        let resolvedTaskType: 'build' | 'repair' | null = task ? 'build' : null;
        if (!task && hasBuildTarget) {
            task = { type: 'build', id: LOCAL_BUILD_TASK_ID, data: {} as any } as any;
            resolvedTaskType = 'build';
        }
        if (!task) {
            let allowRepair = true;
            const towers = creep.room.tower;
            if (towers && towers.length > 0) {
                const sleep = (creep.room.memory as any)?.towerRepairSleep || 0;
                if (sleep <= 0) {
                    allowRepair = towers.every((t) => {
                        const cap = t.store.getCapacity(RESOURCE_ENERGY) || 0;
                        const cur = t.store[RESOURCE_ENERGY] || 0;
                        return cap > 0 ? cur < cap * 0.75 : true;
                    });
                }
            }
            if (allowRepair) {
                task = creep.room.getRepairMission(creep);
                if (task) resolvedTaskType = 'repair';
            }
        }
        if (!task || !resolvedTaskType) return false;

        const taskdata = task.data as WorkerTaskData;
        if (taskdata && taskdata.target) {
            const target = Game.getObjectById(taskdata.target);
            const taskPoolName = resolvedTaskType;
            if (resolvedTaskType === 'build' && target?.structureType == 'rampart') {
                cache.buildRampart = true;
                cache.posInfo = taskdata.pos;
            }
            const repairTaskHits = getRepairTaskHits(taskdata);
            if (!target || (resolvedTaskType === 'repair' && 'hits' in target && repairTaskHits != null && target.hits >= repairTaskHits)){
                creep.room.deleteMissionFromPool(taskPoolName, task.id);
                delete cache.task;
                delete cache.taskid;
                delete cache.tasktype;
                return true;
            }
            cache.task = taskdata;
            cache.taskid = task.id;
            cache.tasktype = resolvedTaskType;
        } else if (resolvedTaskType === 'build') {
            const roomCache = getWorkTargetCache(creep.room.name);
            if (roomCache.tick !== Game.time) {
                roomCache.tick = Game.time;
                delete roomCache.buildId;
                delete roomCache.buildPos;
                delete roomCache.repairId;
                delete roomCache.repairPos;
                delete roomCache.repairHits;
            }

            if (!roomCache.buildId) {
                const mySites = sites.filter((s: ConstructionSite) => s && (s as any).my);
                if (!mySites.length) {
                    if (task.id !== LOCAL_BUILD_TASK_ID) creep.room.deleteMissionFromPool('build', task.id);
                    return true;
                }
                let best = null as ConstructionSite | null;
                let bestScore = Infinity;
                let bestDist = Infinity;
                for (const site of mySites) {
                    const score = getBuildSitePriority(creep.room, site);
                    const dist = creep.pos.getRangeTo(site.pos);
                    if (score < bestScore || (score === bestScore && dist < bestDist)) {
                        bestScore = score;
                        bestDist = dist;
                        best = site;
                    }
                }
                if (!best) {
                    if (task.id !== LOCAL_BUILD_TASK_ID) creep.room.deleteMissionFromPool('build', task.id);
                    return true;
                }
                roomCache.buildId = best.id;
                roomCache.buildPos = compress(best.pos.x, best.pos.y);
            }

            const best = Game.getObjectById(roomCache.buildId);
            if (!best) {
                delete roomCache.buildId;
                delete roomCache.buildPos;
                return true;
            }

            if (best.structureType == 'rampart') {
                cache.buildRampart = true;
                cache.posInfo = roomCache.buildPos;
            }
            cache.task = { target: best.id, pos: roomCache.buildPos } as any;
            cache.taskid = task.id;
            cache.tasktype = 'build';
        } else if (resolvedTaskType === 'repair') {
            const NORMAL_STRUCTURE_THRESHOLD = THRESHOLDS.REPAIR.NORMAL_STRUCTURE;
            const URGENT_STRUCTURE_THRESHOLD = THRESHOLDS.REPAIR.URGENT_STRUCTURE;
            const roomCache = getWorkTargetCache(creep.room.name);
            if (roomCache.tick !== Game.time) {
                roomCache.tick = Game.time;
                delete roomCache.buildId;
                delete roomCache.buildPos;
                delete roomCache.repairId;
                delete roomCache.repairPos;
                delete roomCache.repairHits;
            }

            if (!roomCache.repairId) {
                const all = (creep.room as any).structures || creep.room.find(FIND_STRUCTURES);
                let best = null as Structure | null;
                let bestLevel = Infinity;
                let bestDist = Infinity;
                let bestTargetHits = 0;

                for (const s of all) {
                    if (!s || s.hits >= s.hitsMax) continue;
                    if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) continue;

                    let level = Infinity;
                    let targetHits = 0;
                    if (s.structureType === STRUCTURE_ROAD && s.hits < 3000) {
                        level = 2;
                        targetHits = s.hitsMax;
                    } else if (s.hits < s.hitsMax * URGENT_STRUCTURE_THRESHOLD) {
                        level = 1;
                        targetHits = s.hitsMax * URGENT_STRUCTURE_THRESHOLD;
                    } else if (s.hits < s.hitsMax * NORMAL_STRUCTURE_THRESHOLD) {
                        level = 3;
                        targetHits = s.hitsMax * NORMAL_STRUCTURE_THRESHOLD;
                    } else {
                        continue;
                    }

                    const dist = creep.pos.getRangeTo(s.pos);
                    if (level < bestLevel || (level === bestLevel && dist < bestDist)) {
                        bestLevel = level;
                        bestDist = dist;
                        best = s;
                        bestTargetHits = targetHits;
                    }
                }

                if (!best) {
                    creep.room.deleteMissionFromPool('repair', task.id);
                    return true;
                }

                roomCache.repairId = best.id;
                roomCache.repairPos = compress(best.pos.x, best.pos.y);
                roomCache.repairHits = bestTargetHits;
            }

            const best = Game.getObjectById(roomCache.repairId);
            if (!best) {
                delete roomCache.repairId;
                delete roomCache.repairPos;
                delete roomCache.repairHits;
                return true;
            }

            cache.task = { target: best.id, pos: roomCache.repairPos, hits: roomCache.repairHits } as any;
            cache.taskid = task.id;
            cache.tasktype = 'repair';
        }
    }
    
    if (cache.task){
        const taskdata = cache.task as WorkerTaskData;
        target = Game.getObjectById(taskdata.target);
        taskType = cache.tasktype;
        taskid = cache.taskid;
        const repairTaskHits = getRepairTaskHits(taskdata);
        if(!target || (taskType !== 'build' && 'hits' in target && repairTaskHits != null && target.hits >= repairTaskHits)){
            creep.room.deleteMissionFromPool(taskType, taskid);
            delete cache.task;
            delete cache.taskid;
            delete cache.tasktype;
            return true;
        }
    }

    if (taskType && target){
        if(taskType === 'build'){
            pushWorkerCandidate(candidates, target.pos);
            creep.goBuild(target);
            return true;
        }
        if(taskType === 'repair'){
            pushWorkerCandidate(candidates, target.pos);
            creep.goRepair(target);
            return true;
        }
    }

    return false;
}

const RepairWallWork = function (creep: Creep, candidates: MoveWorkTileCandidate[]) {
    const cache = getCache(creep)
    if (!cache.wallPos) {
        const task = creep.room.getWallMission(creep);
        if (!task) return false;
        cache.wallPos = task.pos;
        cache.targetHits = task.hits;
    }

    const [x, y] = decompress(cache.wallPos);
    const target = creep.room.lookForAt(LOOK_STRUCTURES, x, y)
        .find((s) => s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) as any;
    if (!target) {
        delete cache.wallPos;
        delete cache.targetHits;
        return true;
    }
    if (cache.targetHits != null && target.hits >= cache.targetHits) {
        delete cache.wallPos;
        delete cache.targetHits;
        return true;
    }
    pushWorkerCandidate(candidates, target.pos);
    creep.goRepair(target);
    return true;
}

const hasWorkerBuildOrRepairTarget = (cache: WorkerCache): boolean => {
    return !!(
        cache?.task?.target ||
        cache?.buildRampartId ||
        cache?.repairId ||
        cache?.wallPos ||
        cache?.posInfo ||
        cache?.tasktype === 'build' ||
        cache?.tasktype === 'repair'
    );
};

const resolveWorkerPackedPos = (roomName: string, packed: number | null | undefined): RoomPosition | null => {
    if (typeof packed !== 'number') return null;
    const [x, y] = decompress(packed);
    return new RoomPosition(x, y, roomName);
};

const WorkerAction = function (creep: Creep): MoveWorkTileCandidate[] {
    const candidates: MoveWorkTileCandidate[] = [];
    if (BuildRepairWork(creep, candidates)) return candidates;
    if (RepairWallWork(creep, candidates)) return candidates;
    
    if (!creep.room.controller?.my) return candidates;
    pushWorkerCandidate(candidates, creep.room.controller.pos);
    // worker 已接管常规升级（原 upgrader 职责），顺带维护房间签名
    creep.runControllerUpgrade({ sign: true, pickupDropped: false });
    return candidates;
}

const onTarget = (creep: Creep, publishMoveWork: (candidates: MoveWorkTileCandidate[]) => void): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.handleRoomEdge()) return WORK_EVENTS.STAY;
    if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
    if (creep.store.getUsedCapacity() === 0) {
        return WORK_EVENTS.TO_SOURCE;
    }
    publishMoveWork(WorkerAction(creep));
    return WORK_EVENTS.STAY;
};

const onSource = (creep: Creep, publishMoveWork: (candidates: MoveWorkTileCandidate[]) => void): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.handleRoomEdge()) return WORK_EVENTS.STAY;
    if (creep.store.getFreeCapacity() === 0) {
        if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
        publishMoveWork(WorkerAction(creep));
        return WORK_EVENTS.TO_TARGET;
    }
    const fullAfterTake = creep.acquireEnergy({ pickup: true });
    if (fullAfterTake) {
        if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
        publishMoveWork(WorkerAction(creep));
        return WORK_EVENTS.TO_TARGET;
    }
    return WORK_EVENTS.STAY;
};

export const syncWorkerMoveWork = (creep: Creep) => {
    const cache = getCache(creep);
    const candidates = [];

    if (cache?.task?.target) {
        const target = Game.getObjectById(cache.task.target as Id<any>);
        if (target?.pos) candidates.push({ pos: target.pos, range: 3 });
    }

    if (cache?.buildRampartId) {
        const rampart = Game.getObjectById(cache.buildRampartId as Id<StructureRampart>);
        if (rampart?.pos) candidates.push({ pos: rampart.pos, range: 3 });
    }

    if (cache?.repairId) {
        const repairTarget = Game.getObjectById(cache.repairId as Id<Structure>);
        if (repairTarget?.pos) candidates.push({ pos: repairTarget.pos, range: 3 });
    }

    const wallPos = resolveWorkerPackedPos(creep.room.name, cache?.wallPos);
    if (wallPos) candidates.push({ pos: wallPos, range: 3 });

    const posInfo = resolveWorkerPackedPos(creep.room.name, cache?.posInfo);
    if (posInfo) candidates.push({ pos: posInfo, range: 3 });

    if (
        creep.room.controller?.my &&
        creep.memory.working &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
        !hasWorkerBuildOrRepairTarget(cache)
    ) {
        candidates.push({ pos: creep.room.controller.pos, range: 3 });
    }

    if (candidates.length > 0) {
        writeMoveWorkTileCandidates(creep, candidates);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

const WorkerFunction = {
    prepare: (creep) => {
        return creep.ensureBoosted(creep.memory['boostmap']);
    },
    run(creep) {
        writeMoveWorkTileCandidates(creep, []);

        const publishMoveWork = (candidates: MoveWorkTileCandidate[]) => {
            writeMoveWorkTileCandidates(creep, candidates);
        };

        runWorkLayer(creep, {
            onSource: (current) => onSource(current, publishMoveWork),
            onTarget: (current) => onTarget(current, publishMoveWork),
        });
    }
};

export default WorkerFunction;
