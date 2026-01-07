import { compress } from '@/utils';

// 更新运输任务
function UpdateTransportMission(room: Room) {
    const storage = room.storage;
    if(!storage) return;

    UpdateEnergyMission(room);
    UpdatePowerMission(room);
    UpdateLabMission(room);
    UpdateLabBoostMission(room);
    UpdateNukerMission(room);
}

const LevelMap = {
    boost: 0,
    ext: 1,
    tower: 1,
    labEnergy: 1,
    lab: 2,
    powerSpawn: 2,
    nuker: 3,
}

function UpdateEnergyMission(room: Room) {
    const storage = room.storage;
    const terminal = room.terminal;
    let energy = (storage?.store[RESOURCE_ENERGY]||0) + (terminal?.store[RESOURCE_ENERGY]||0);
    if(energy < 3000) return;

    let storageOrTerminal = null;

    if(terminal && storage) {
        storageOrTerminal = terminal.store[RESOURCE_ENERGY] > storage.store[RESOURCE_ENERGY] ? terminal : storage;
    } else {
        storageOrTerminal = storage || terminal;
    }

    if (!storageOrTerminal) return;

    // 检查spawn和扩展是否需要填充能量
    if(room.spawn && room.spawn.length > 0 && room.energyAvailable < room.energyCapacityAvailable) {
        room.spawn.forEach((s) => {
            if (s.store.getFreeCapacity(RESOURCE_ENERGY) == 0) return;
            if (energy < s.store.getFreeCapacity(RESOURCE_ENERGY)) return;
            energy -= s.store.getFreeCapacity(RESOURCE_ENERGY);
            room.TransportMissionAdd(LevelMap.ext, {
                pos: compress(s.pos.x, s.pos.y),
                source: storageOrTerminal.id,
                target: s.id,
                resourceType: RESOURCE_ENERGY,
                amount: s.store.getFreeCapacity(RESOURCE_ENERGY),
            })
        })
        room.extension.forEach((e) => {
            if (e.store.getFreeCapacity(RESOURCE_ENERGY) == 0) return;
            if (energy < e.store.getFreeCapacity(RESOURCE_ENERGY)) return;
            energy -= e.store.getFreeCapacity(RESOURCE_ENERGY);
            room.TransportMissionAdd(LevelMap.ext, {
                pos: compress(e.pos.x, e.pos.y),
                source: storageOrTerminal.id,
                target: e.id,
                resourceType: RESOURCE_ENERGY,
                amount: e.store.getFreeCapacity(RESOURCE_ENERGY),
            })
        })
    }

    // 检查tower是否需要填充能量
    if(room.level >= 3 && room.tower && room.tower.length > 0) {
        const towers = room.tower
            .filter((t: StructureTower) => t && t.store.getFreeCapacity(RESOURCE_ENERGY) > 200);
        towers.forEach((t: StructureTower) => {
            if(energy < t.store.getFreeCapacity(RESOURCE_ENERGY)) return;
            energy -= t.store.getFreeCapacity(RESOURCE_ENERGY);
            const posInfo = compress(t.pos.x, t.pos.y);
            const taskdata = {
                pos: posInfo,
                source: storageOrTerminal.id,
                target: t.id,
                resourceType: RESOURCE_ENERGY,
                amount: t.store.getFreeCapacity(RESOURCE_ENERGY),
            }
            room.TransportMissionAdd(LevelMap.tower, taskdata)
        })
    }

    // 能量缺少时不填充以下的
    if(room.getResAmount(RESOURCE_ENERGY) < 10000) return;

    // 检查lab是否需要填充能量
    if (Game.time % 20 === 0 && room.level >= 6 && room.lab) {
        const labs = room.lab
            .filter((l: StructureLab) => l && l.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
        labs.forEach((l: StructureLab) => {
            if(energy < l.store.getFreeCapacity(RESOURCE_ENERGY)) return;
            energy -= l.store.getFreeCapacity(RESOURCE_ENERGY);
            const posInfo = compress(l.pos.x, l.pos.y);
            const taskdata = {
                pos: posInfo,
                source: storage.id,
                target: l.id,
                resourceType: RESOURCE_ENERGY,
                amount: l.store.getFreeCapacity(RESOURCE_ENERGY),
            }
            room.TransportMissionAdd(LevelMap.labEnergy, taskdata)
        })
    }

    // 检查powerSpawn是否需要填充能量
    let center = Memory['RoomControlData'][room.name].center;
    let centerPos: RoomPosition;
    if (center) centerPos = new RoomPosition(center.x, center.y, room.name);
    // 没设置中心或者powerSpawn不在中心时填充
    if (Game.time % 20 === 0 && room.level == 8 && room.powerSpawn &&
        (!centerPos || !room.powerSpawn.pos.inRangeTo(centerPos, 1))) {
        const powerSpawn = room.powerSpawn;
        const amount = powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY);
        if(powerSpawn && powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY) > 400 && energy >= amount) {
            energy -= amount;
            const posInfo = compress(powerSpawn.pos.x, powerSpawn.pos.y);
            const taskdata = {
                pos: posInfo,
                source: storage.id,
                target: powerSpawn.id,
                resourceType: RESOURCE_ENERGY,
                amount: amount,
            }
            room.TransportMissionAdd(LevelMap.powerSpawn, taskdata)
        }
    }

    // 能量缺少时不填充以下的
    if(room.getResAmount(RESOURCE_ENERGY) < 100000) return;

    // 检查nuker是否需要填充能量
    if(Game.time % 20 === 0 && room.level == 8 && room.nuker) {
        const nuker = room.nuker;
        const amount = Math.min(nuker.store.getFreeCapacity(RESOURCE_ENERGY), 3000);
        if(nuker && amount > 0 && energy >= amount) {
            energy -= amount;
            const posInfo = compress(nuker.pos.x, nuker.pos.y);
            const taskdata = {
                pos: posInfo,
                source: storage.id,
                target: nuker.id,
                resourceType: RESOURCE_ENERGY,
                amount: amount,
            }
            room.TransportMissionAdd(LevelMap.nuker, taskdata)
        }
    }

    return OK;
}

// 检查powerSpawn是否需要填充power
function UpdatePowerMission(room: Room) {
    if(room.level < 8 || !room.powerSpawn) return;
    let center = Memory['RoomControlData'][room.name].center;
    let centerPos: RoomPosition;
    if (center) centerPos = new RoomPosition(center.x, center.y, room.name);
    if (centerPos && room.powerSpawn.pos.inRangeTo(centerPos, 1)) return;
    // 在中心附近1格内，不填充

    const storage = room.storage;
    const terminal = room.terminal;
    if(!storage && !terminal) return;

    const powerSpawn = room.powerSpawn;
    if(!powerSpawn) return;
    let neededAmount = 100 - powerSpawn.store[RESOURCE_POWER];
    if (neededAmount < 50) return;

    let target = [storage, terminal].reduce((a, b) => {
        if (!a && !b) return null;
        if (!a || !b) return a || b;
        if (a.store[RESOURCE_POWER] > b.store[RESOURCE_POWER]) return a;
        return b;
    }, null)

    if(!target || target.store[RESOURCE_POWER] <= 0) return;

    const posInfo = compress(target.pos.x, target.pos.y);
    const taskdata = {
        pos: posInfo,
        source: target.id,
        target: powerSpawn.id,
        resourceType: RESOURCE_POWER,
        amount: Math.min(neededAmount, target.store[RESOURCE_POWER]),
    }
    room.TransportMissionAdd(LevelMap.powerSpawn, taskdata)
}

// 检查lab是否需要填充资源
function UpdateLabMission(room: Room) {
    const storage = room.storage;
    const terminal = room.terminal;
    if (!storage) return;
    if(!room.lab || room.lab.length === 0) return;

    const BotMemStructures =  Memory['StructControlData'][room.name];
    if (!BotMemStructures['boostRes']) BotMemStructures['boostRes'] = {};
    if (!BotMemStructures['boostTypes']) BotMemStructures['boostTypes'] = {};

    const labAtype = BotMemStructures.labAtype;
    const labBtype = BotMemStructures.labBtype;
    const labA = Game.getObjectById(BotMemStructures.labA) as StructureLab;
    const labB = Game.getObjectById(BotMemStructures.labB) as StructureLab;

    // lab关停时取出所有资源, 不包括boost
    if (!BotMemStructures.lab || !labA || !labB || !labAtype || !labBtype) {
        room.lab.forEach(lab => {
            if(BotMemStructures['boostRes'][lab.id]) return;
            if(BotMemStructures['boostTypes'][lab.id]) return;
            if (!lab.store[lab.mineralType] || lab.store[lab.mineralType] === 0) return;
            const posInfo = compress(lab.pos.x, lab.pos.y);
            const taskdata = {
                pos: posInfo,
                source: lab.id,
                target: storage.id,
                resourceType: lab.mineralType,
                amount: lab.store[lab.mineralType],
            }
            room.TransportMissionAdd(LevelMap.lab, taskdata);
        })
        return;
    }

    // 开启lab并有任务时才执行如下逻辑

    // 检查labA和labB中是否存在非设定资源
    [labA, labB].forEach((lab, index) => {
        const type = index === 0 ? labAtype : labBtype;
        if(!lab.mineralType || lab.mineralType === type) return; // 资源类型正确时不操作
        if(!lab.store[lab.mineralType] || lab.store[lab.mineralType] === 0) return; // 资源为空
        const posInfo = compress(lab.pos.x, lab.pos.y);
        const taskdata = {
            pos: posInfo,
            source: lab.id,
            target: storage.id,
            resourceType: lab.mineralType,
            amount: lab.store[lab.mineralType],
        }
        room.TransportMissionAdd(LevelMap.lab, taskdata)
    });

    // 检查labA和labB是否需要填充设定的资源
    [labA, labB].forEach((lab, index) => {
        const type = index === 0 ? labAtype : labBtype;
        if(lab.mineralType && lab.mineralType !== type) return;    // 有其他资源时不填充
        if(lab.store.getFreeCapacity(type) < 1000) return;   // 需要填充的量太少时不添加任务
        if(room.getResAmount(type) < 1000) return; // 资源不足时不添加任务
        const posInfo = compress(lab.pos.x, lab.pos.y);
        const target = [storage, terminal].find(target => target.store[type] > 0);
        const taskdata = {
            pos: posInfo,
            source: target.id,
            target: lab.id,
            resourceType: type,
            amount: Math.min(lab.store.getFreeCapacity(type), target.store[type]),
        } as any;
        room.TransportMissionAdd(LevelMap.lab, taskdata)
    });

    const boostmem = BotMemStructures['boostRes'];
    const boostmem2 = BotMemStructures['boostTypes'];

    // 从已满的lab中取出产物到storage（不包括labA、labB，以及设定了boost的）
    const Labs = room.lab.filter(lab => lab);
    Labs.forEach(lab => {
        if (lab.id === labA.id || lab.id === labB.id ||
            boostmem[lab.id] || boostmem2[lab.id]) return;
        if (!lab.store[lab.mineralType] || lab.store[lab.mineralType] == 0) return;
        if (lab.store.getFreeCapacity(lab.mineralType) >= 100) return;
        const posInfo = compress(lab.pos.x, lab.pos.y);
        const taskdata = {
            pos: posInfo,
            source: lab.id,
            target: storage.id,
            resourceType: lab.mineralType,
            amount: lab.store[lab.mineralType],
        }
        room.TransportMissionAdd(LevelMap.lab, taskdata)
    });

    // 如果lab的资源不同于产物，则全部取出（不包括labA、labB，以及设定了boost的）
    Labs.forEach(lab => {
        if(lab.id === labA.id || lab.id === labB.id ||
            boostmem[lab.id] || boostmem2[lab.id]) return;
        if(lab.mineralType == REACTIONS[labAtype][labBtype]) return;
        if(!lab.store[lab.mineralType] || lab.store[lab.mineralType] == 0) return;
        const posInfo = compress(lab.pos.x, lab.pos.y);
        const taskdata = {
            pos: posInfo,
            source: lab.id,
            target: storage.id,
            resourceType: lab.mineralType,
            amount: lab.store[lab.mineralType],
        }
        room.TransportMissionAdd(LevelMap.lab, taskdata)
    });
}

// 填充boost用的资源
function UpdateLabBoostMission(room: Room) {
    const storage = room.storage;
    const terminal = room.terminal;
    if (!storage && !terminal) return;
    
    const botmem = Memory['StructControlData'][room.name];
    if (!botmem['boostRes']) return;

    if (!room.lab || room.lab.length === 0) return;

    const Labs = room.lab.filter(lab => lab);

    // 把boost队列更新到空余lab中
    if (!botmem['boostQueue']) botmem['boostQueue'] = {};
    if (Object.keys(botmem['boostQueue']).length) {
        // 筛选出没有分配boost的lab, 排除底物lab
        Labs.filter(lab => !botmem['boostRes'][lab.id] &&
            lab.id !== botmem.labA && lab.id !== botmem.labB)
            .forEach(lab => {
            const mineral = Object.keys(botmem['boostQueue'])[0] as ResourceConstant;
            botmem['boostRes'][lab.id] = {
                mineral: mineral,
                amount: botmem['boostQueue'][mineral],
            }
            delete botmem['boostQueue'][mineral];
        })
    }

    // 根据分配的boost类型与数量填充lab
    Labs.forEach(lab => {
        let mineral = botmem['boostRes'][lab.id]?.mineral;
        if(mineral) {
            // 资源设定不正确那么删除
            if (!RESOURCES_ALL.includes(mineral)) {
                delete botmem['boostRes'][lab.id];
                return;
            }
            // 如果该lab是底物lab, 那么不填充, 将boost任务放回队列
            if (lab.id == botmem.labA || lab.id == botmem.labB) {
                let amount = botmem['boostRes'][lab.id].amount;
                botmem['boostQueue'][mineral] = (botmem['boostQueue'][mineral] || 0) + amount;
                delete botmem['boostRes'][lab.id];
                return;
            }
            // 如果boost剩余任务量为0，则删除
            if ((botmem['boostRes'][lab.id].amount||0) <= 0) {
                delete botmem['boostRes'][lab.id];
                return;
            }
        } else {
            mineral = botmem['boostTypes'][lab.id];
        }

        // 如果没有设定boost，则不填充
        if(!mineral) return;
        
        // 如果lab中存在非设定的资源，则搬走
        if(lab.mineralType !== mineral && lab.store[lab.mineralType] > 0) {
            const posInfo = compress(lab.pos.x, lab.pos.y);
            const taskdata = {
                pos: posInfo,
                source: lab.id,
                target: storage.id,
                resourceType: lab.mineralType,
                amount: lab.store[lab.mineralType],
            }
            room.TransportMissionAdd(LevelMap.boost, taskdata)
            return;
        }

        let totalAmount = 0;
        if (botmem['boostRes'][lab.id]) {
            totalAmount = Math.min(3000, botmem['boostRes'][lab.id].amount);
        } else {
            totalAmount = 3000;
        }
        // 如果设定的资源不足，则补充
        if(lab.store[mineral] < totalAmount) {
            const amount = totalAmount - lab.store[mineral];
            const target = [storage, terminal].find(t => t.store[mineral] > 0);
            const posInfo = compress(lab.pos.x, lab.pos.y);
            if (!target) return;
            const taskdata = {
                pos: posInfo,
                source: target.id,
                target: lab.id,
                resourceType: mineral,
                amount: Math.min(amount, target.store[mineral])
            }
            room.TransportMissionAdd(LevelMap.boost, taskdata)
            return;
        }
    });
}

// 填充nuker用的资源
function UpdateNukerMission(room: Room) {
    if(Game.time % 50 !== 0) return;
    if(room.level < 8) return;
    if(!room.nuker) return;
    const storage = room.storage;
    const terminal = room.terminal;
    if(!storage && !terminal) return;
    
    const nuker = room.nuker;
    if(!nuker) return;
    if(nuker.store[RESOURCE_GHODIUM] === 5000) return;  // 如果nuker中已经满了，则不补充

    let amount = 5000 - nuker.store[RESOURCE_GHODIUM];

    let source: Id<Structure>;
    if (storage && storage.store[RESOURCE_GHODIUM] > 0) {
        source = storage.id; // 从storage获取
        amount = Math.min(amount, storage.store[RESOURCE_GHODIUM])
    } else if (terminal && terminal.store[RESOURCE_GHODIUM] > 0) {
        source = terminal.id; // 从terminal获取
        amount = Math.min(amount, terminal.store[RESOURCE_GHODIUM])
    } else {
        return; // 如果storage和terminal都不足，则不补充
    }

    const posInfo = compress(nuker.pos.x, nuker.pos.y);
    const taskdata = {
        pos: posInfo,
        source: source,
        target: nuker.id,
        resourceType: RESOURCE_GHODIUM,
        amount: amount,
    }
    room.TransportMissionAdd(LevelMap.nuker, taskdata)
}


// 检查任务是否有效
function TransportMissionCheck(room: Room) {
    const checkFunc = (task: Task) => {
        // 如果任务被锁定，检查锁定是否有效，无效则解锁
        if(task.lock) {
            const creep = Game.getObjectById(task.bindCreep) as Creep;
            const mission = creep?.memory?.mission;
            if(!creep || !mission || mission?.id !== task.id) {
                task.lock = false;
                task.bindCreep = null;
            }
        };
        // 检查目标是否有效
        const data = task.data as TransportTask
        const source = Game.getObjectById(data.source) as any;
        const target = Game.getObjectById(data.target) as any;;
        if(!source || !target) return false;
        return target.store.getFreeCapacity(data.resourceType) > 0 && data.amount > 0;
    }

    room.checkMissionPool('transport', checkFunc);
}

export {
    UpdateTransportMission,
    TransportMissionCheck,
}