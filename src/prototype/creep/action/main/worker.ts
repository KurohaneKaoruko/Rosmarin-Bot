import { compress, decompress } from '@/modules/utils/compress';
import { THRESHOLDS } from '@/constant/Thresholds';

const getWorkTargetCache = (() => {
    global._workTargetCache ??= {};
    return (roomName: string) => {
        const root = global._workTargetCache as any;
        if (!root[roomName]) root[roomName] = { tick: -1 };
        return root[roomName];
    };
})();

const getCache = (creep: Creep) => {
    creep.memory.cacheTarget = creep.memory.cacheTarget || {}
    return creep.memory.cacheTarget as any
}

const RepairRampart = function (creep: Creep) {
    const cache = getCache(creep)
    if (cache.buildRampartId) {
        const rampart = Game.getObjectById(cache.buildRampartId) as StructureRampart;
        if (!rampart || rampart.hits >= 5000) {
            delete cache.buildRampartId;
            return false;
        } else {
            creep.goRepair(rampart);
            return true;
        }
    }

    if (cache.buildRampart && !cache.task) {
        const [x, y] = decompress(cache.posInfo);
        const Pos = new RoomPosition(x, y, creep.room.name);
        const rampart = Pos.lookFor(LOOK_STRUCTURES).find((s) => s.structureType == STRUCTURE_RAMPART);
        if (rampart) cache.buildRampartId = rampart.id;
        delete cache.posInfo;
        delete cache.buildRampart;
        return true;
    }
    
    return false;
}

const BuildRepairWork = function (creep: Creep) {
    const cache = getCache(creep)
    let target = null;
    let taskType = null;
    let taskid = null;

    if (RepairRampart(creep)) return true;

    if (!cache.task) {
        let task = creep.room.getBuildMission(creep);
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
            }
        }
        if (!task) return false;

        const taskdata = task.data as any;
        if (taskdata && taskdata.target) {
            const target = Game.getObjectById(taskdata.target) as any;
            if (task.type == 'build' && target?.structureType == 'rampart') {
                cache.buildRampart = true;
                cache.posInfo = taskdata.pos;
            }
            if (!target || (task.type !== 'build' && target.hits >= taskdata.hits)){
                creep.room.deleteMissionFromPool(task.type, task.id);
                delete cache.task;
                delete cache.taskid;
                delete cache.tasktype;
                return true;
            }
            cache.task = taskdata;
            cache.taskid = task.id;
            cache.tasktype = task.type;
        } else if (task.type === 'build') {
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
                const sites = (creep.room as any).constructionSite || creep.room.find(FIND_CONSTRUCTION_SITES);
                const mySites = sites.filter((s) => s && (s as any).my);
                if (!mySites.length) {
                    creep.room.deleteMissionFromPool('build', task.id);
                    return true;
                }
                let best = null as ConstructionSite | null;
                let bestLevel = Infinity;
                let bestDist = Infinity;
                for (const site of mySites) {
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
                    const dist = creep.pos.getRangeTo(site.pos);
                    if (level < bestLevel || (level === bestLevel && dist < bestDist)) {
                        bestLevel = level;
                        bestDist = dist;
                        best = site;
                    }
                }
                if (!best) {
                    creep.room.deleteMissionFromPool('build', task.id);
                    return true;
                }
                roomCache.buildId = best.id;
                roomCache.buildPos = compress(best.pos.x, best.pos.y);
            }

            const best = Game.getObjectById(roomCache.buildId) as any;
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
            cache.tasktype = task.type;
        } else if (task.type === 'repair') {
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

            const best = Game.getObjectById(roomCache.repairId) as any;
            if (!best) {
                delete roomCache.repairId;
                delete roomCache.repairPos;
                delete roomCache.repairHits;
                return true;
            }

            cache.task = { target: best.id, pos: roomCache.repairPos, hits: roomCache.repairHits } as any;
            cache.taskid = task.id;
            cache.tasktype = task.type;
        }
    }
    
    if (cache.task){
        const taskdata = cache.task;
        target = Game.getObjectById(taskdata.target);
        taskType = cache.tasktype;
        taskid = cache.taskid;
        if(!target || (taskType !== 'build' && target.hits >= taskdata.hits)){
            creep.room.deleteMissionFromPool(taskType, taskid);
            delete cache.task;
            delete cache.taskid;
            delete cache.tasktype;
            return true;
        }
    }

    if (taskType && target){
        if(taskType === 'build'){
            creep.goBuild(target);
            return true;
        }
        if(taskType === 'repair'){
            creep.goRepair(target);
            return true;
        }
    }

    return false;
}

const RepairWallWork = function (creep: Creep) {
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
    creep.goRepair(target);
    return true;
}

const WorkerAction = function (creep: Creep) {
    // 如果有任务执行，则执行后退出
    if (BuildRepairWork(creep)) return;
    if (RepairWallWork(creep)) return;
    
    // 如果没有任务，则升级控制器
    const controller = creep.room.controller;
    if (!controller || !controller.my) return;
    
    if (creep.pos.inRangeTo(controller, 3)) {
        creep.upgradeController(controller);
    } else {
        creep.moveTo(controller, { maxRooms: 1, range: 3 });
    }
}

const WorkerFunction = {
    prepare: function (creep: Creep) {
        return creep.goBoost({ [WORK]: ['XLH2O', 'LH2O', 'LH'] }) === OK;
    },
    target: function (creep: Creep) {   // 建造
        if(!creep.memory.ready) return false;
        if(!creep.moveHomeRoom()) return;
        if(creep.store.getUsedCapacity() === 0) {
            creep.TakeEnergy();
            return true;
        } else {
            WorkerAction(creep);
            return false;
        }
    },
    source: function (creep: Creep) {   // 获取能量
        if(!creep.memory.ready) return false;
        if(!creep.moveHomeRoom()) return;
        if(creep.store.getFreeCapacity() === 0) {
            WorkerAction(creep);
            return true;
        } else {
            creep.TakeEnergy();
            return false;
        }
    }
}


export default WorkerFunction
