const selectBestSource = function (creep: Creep): Source | null {
    const sources = creep.room.source.filter(s => s.energy > 0);
    if (sources.length === 0) return null;

    // 统计每个 Source 被多少个 Universal Creep 锁定
    const sourceCounts = new Map<string, number>();
    sources.forEach(s => sourceCounts.set(s.id, 0));

    const myCreeps = creep.room.find(FIND_MY_CREEPS, {
        filter: c => c.memory.role === 'universal' && c.memory.targetSourceId
    });

    myCreeps.forEach(c => {
        const sid = c.memory.targetSourceId as string;
        if (sourceCounts.has(sid)) {
            sourceCounts.set(sid, sourceCounts.get(sid)! + 1);
        }
    });

    // 排序：优先选计数最小的；计数相同选距离最近的
    sources.sort((a, b) => {
        const countA = sourceCounts.get(a.id)!;
        const countB = sourceCounts.get(b.id)!;
        if (countA !== countB) return countA - countB;
        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
    });

    return sources[0];
}

const getEnergy = function (creep: Creep) {
    // 1. 优先从各种资源点（掉落、墓碑、废墟、容器、Storage/Terminal）智能收集
    // minContainerAmount 设置低一点 (200)，以便在重启阶段能尽量利用容器里的剩余能量
    if (creep.smartCollect(RESOURCE_ENERGY, {
        minContainerAmount: 200,
        minDroppedAmount: 50
    })) {
        // 如果正在捡垃圾，清除 Source 锁定，避免占用名额
        delete creep.memory.targetSourceId;
        return;
    }

    // 2. 动态选择 Source 采集
    let sourceId = creep.memory.targetSourceId as Id<Source> | undefined;
    let source: Source | null = null;

    // 检查当前锁定的 Source 是否有效
    if (sourceId) {
        source = Game.getObjectById(sourceId);
        if (!source || source.energy === 0) {
            delete creep.memory.targetSourceId; // 无效或枯竭，清除锁定
            source = null;
        }
    }

    // 如果没有有效 Source，重新选择
    if (!source) {
        source = selectBestSource(creep);
        if (source) {
            creep.memory.targetSourceId = source.id;
        }
    }

    // 执行采集
    if (source) {
        creep.goHaverst(source);
    } else {
        // 确实无矿可采，清除锁定
        delete creep.memory.targetSourceId;
    }
}

const doWork = function (creep: Creep) {
    // 1. 尝试从缓存获取填充目标
    let target = Game.getObjectById(creep.memory.cache.targetId) as StructureSpawn | StructureExtension | StructureTower | null;

    // 验证目标有效性 (存在且未满)
    if (!target || target.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        creep.memory.cache.targetId = null;
        target = null;

        // 2. 查找新的填充目标
        // 优先级 1: Spawn 和 Extension
        const spawns = creep.room.spawn || [];
        const extensions = creep.room.extension || [];
        // 显式声明类型以避免 concat 推断错误
        const spawnExtensions: (StructureSpawn | StructureExtension)[] = [...spawns, ...extensions];
        
        let validTargets: (StructureSpawn | StructureExtension | StructureTower)[] = spawnExtensions.filter(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);

        // 优先级 2: Tower (能量不满 900 时填充，保留一部分空间防止溢出浪费，或者直接填满)
        if (validTargets.length === 0) {
            const towers = creep.room.tower || [];
            validTargets = towers.filter(t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 200);
        }

        // 选择最近的目标
        if (validTargets.length > 0) {
            target = creep.pos.findClosestByRange(validTargets);
            if (target) {
                creep.memory.cache.targetId = target.id;
            }
        }
    }

    // 3. 执行填充或建设/升级
    if (target) {
        creep.goTransfer(target, RESOURCE_ENERGY);
    } else {
        // 无需填充时：建设 > 升级
        // 优先建设 Container，其次是 Road 等
        const buildResult = creep.findAndBuild({
            priority: [STRUCTURE_CONTAINER, STRUCTURE_ROAD, STRUCTURE_RAMPART],
            range: 3
        });

        if (!buildResult) {
            // 如果没工地，升级控制器
            creep.goUpgrade();
        }
    }
}

const UniversalFunction = {
    prepare: function (creep: Creep) {
        // 仅检查 Source 是否存在，不再进行绑定
        if (!creep.room.source || creep.room.source.length === 0) return false;
        return true;
    },
    source: function (creep: Creep) {
        if (!creep.moveHomeRoom()) return;
        if (creep.handleRoomEdge()) return;
        
        getEnergy(creep);
        
        // 满载判定
        if (creep.store.getFreeCapacity() === 0) {
            delete creep.memory.targetSourceId; // 采集结束，释放 Source 占用
            return true;
        }
        return false;
    },
    target: function (creep: Creep) {
        // 确保进入 target 状态时 Source 占用已释放
        if (creep.memory.targetSourceId) {
            delete creep.memory.targetSourceId;
        }

        if (!creep.moveHomeRoom()) return;
        if (creep.handleRoomEdge()) return;

        // 房间降级保护：如果 RCL < 2 或 濒临降级，则强制升级
        if (creep.room.controller?.ticksToDowngrade < 2000 || creep.room.level < 2) {
            creep.goUpgrade();
        }

        doWork(creep);
        return creep.store.getUsedCapacity() === 0;
    }
};

export default UniversalFunction;
