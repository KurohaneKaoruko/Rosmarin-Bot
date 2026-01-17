import { addTransportMission, LevelMap } from './utils';

// 检查lab是否需要填充资源
export function UpdateLabMission(room: Room) {
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
            addTransportMission(room, LevelMap.lab, {
                pos: lab,
                source: lab.id,
                target: storage.id,
                resourceType: lab.mineralType,
                amount: lab.store[lab.mineralType],
            });
        })
        return;
    }

    // 开启lab并有任务时才执行如下逻辑

    // 检查labA和labB中是否存在非设定资源
    [labA, labB].forEach((lab, index) => {
        const type = index === 0 ? labAtype : labBtype;
        if(!lab.mineralType || lab.mineralType === type) return; // 资源类型正确时不操作
        if(!lab.store[lab.mineralType] || lab.store[lab.mineralType] === 0) return; // 资源为空
        addTransportMission(room, LevelMap.lab, {
            pos: lab,
            source: lab.id,
            target: storage.id,
            resourceType: lab.mineralType,
            amount: lab.store[lab.mineralType],
        });
    });

    // 检查labA和labB是否需要填充设定的资源
    [labA, labB].forEach((lab, index) => {
        const type = index === 0 ? labAtype : labBtype;
        if(lab.mineralType && lab.mineralType !== type) return;    // 有其他资源时不填充
        if(lab.store.getFreeCapacity(type) < 1000) return;   // 需要填充的量太少时不添加任务
        if(room.getResAmount(type) < 1000) return; // 资源不足时不添加任务
        const target = [storage, terminal].find(target => target && target.store[type] > 0);
        if (!target) return;
        addTransportMission(room, LevelMap.lab, {
            pos: lab,
            source: target.id,
            target: lab.id,
            resourceType: type,
            amount: Math.min(lab.store.getFreeCapacity(type), target.store[type]),
        } as any);
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
        addTransportMission(room, LevelMap.lab, {
            pos: lab,
            source: lab.id,
            target: storage.id,
            resourceType: lab.mineralType,
            amount: lab.store[lab.mineralType],
        });
    });

    // 如果lab的资源不同于产物，则全部取出（不包括labA、labB，以及设定了boost的）
    Labs.forEach(lab => {
        if(lab.id === labA.id || lab.id === labB.id ||
            boostmem[lab.id] || boostmem2[lab.id]) return;
        if(lab.mineralType == REACTIONS[labAtype][labBtype]) return;
        if(!lab.store[lab.mineralType] || lab.store[lab.mineralType] == 0) return;
        addTransportMission(room, LevelMap.lab, {
            pos: lab,
            source: lab.id,
            target: storage.id,
            resourceType: lab.mineralType,
            amount: lab.store[lab.mineralType],
        });
    });
}

// 填充boost用的资源
export function UpdateLabBoostMission(room: Room) {
    const storage = room.storage;
    const terminal = room.terminal;
    if (!storage && !terminal) return;
    const storeTarget = storage || terminal;
    
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
            addTransportMission(room, LevelMap.boost, {
                pos: lab,
                source: lab.id,
                target: storeTarget.id,
                resourceType: lab.mineralType,
                amount: lab.store[lab.mineralType],
            });
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
            if (!target) return;
            addTransportMission(room, LevelMap.boost, {
                pos: lab,
                source: target.id,
                target: lab.id,
                resourceType: mineral,
                amount: Math.min(amount, target.store[mineral]),
            });
            return;
        }
    });
}
