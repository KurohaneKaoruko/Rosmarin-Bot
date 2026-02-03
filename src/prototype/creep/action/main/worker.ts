import { decompress } from '@/modules/utils/compress';

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
        if (!task && (!creep.room.tower || creep.room.tower.length == 0)) {
            task = creep.room.getRepairMission(creep);
        }
        if (!task) return false;
        const taskdata = task.data as BuildTask | RepairTask;
        const target = Game.getObjectById(taskdata.target) as any;
        if (task.type == 'build' && target?.structureType == 'rampart') {
            cache.buildRampart = true;
            cache.posInfo = taskdata.pos;
        }
        if (!target || (task.type !== 'build' && target.hits >= (taskdata as RepairTask).hits)){
            creep.room.deleteMissionFromPool(task.type, task.id);
            delete cache.task;
            delete cache.taskid;
            delete cache.tasktype;
            return true;
        }
        cache.task = taskdata;
        cache.taskid = task.id;
        cache.tasktype = task.type;
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
    if (!cache.wallTask) {
        const task = creep.room.getWallMission(creep);
        if (!task) return false;
        cache.wallTask = task.target;
    }

    const target = Game.getObjectById(cache.wallTask) as StructureRampart;
    if (!target) {
        const task = creep.room.getWallMission(creep);
        if (!task) {
            delete cache.wallTask;
            delete cache.targetHits;
            return false;
        }
        cache.wallTask = task.target;
        return true;
    } else {
        creep.goRepair(target);
        return true;
    }
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
