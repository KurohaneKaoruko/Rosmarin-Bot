import { addTransportMission, LevelMap } from './utils';

const LAB_FILL_AMOUNT = 3000;  // 填充量
const LAB_TRIGGER_AMOUNT = 1000; // 触发填充的最小量
const LAB_MIN_CAPACITY = 100; // 最小剩余容量

/**
 * 检查实验室是否被占用（底物 Lab 或 Boost Lab）
 */
function isSpecialLab(labId: Id<StructureLab>, botmem: any): boolean {
    if (labId === botmem.labA || labId === botmem.labB) return true;
    if (botmem['boostRes']?.[labId]) return true;
    if (botmem['boostTypes']?.[labId]) return true;
    return false;
}

// 检查lab是否需要填充资源
export function UpdateLabMission(room: Room) {
    const storage = room.storage;
    const terminal = room.terminal;
    if (!storage) return;
    if (!room.lab || room.lab.length === 0) return;

    const BotMemStructures = Memory['StructControlData'][room.name];
    if (!BotMemStructures['boostRes']) BotMemStructures['boostRes'] = {};
    if (!BotMemStructures['boostTypes']) BotMemStructures['boostTypes'] = {};

    const labAtype = BotMemStructures.labAtype;
    const labBtype = BotMemStructures.labBtype;
    const labA = Game.getObjectById(BotMemStructures.labA) as StructureLab;
    const labB = Game.getObjectById(BotMemStructures.labB) as StructureLab;

    const isShutDown = !BotMemStructures.lab || !labA || !labB || !labAtype || !labBtype;

    // 统一遍历所有 Lab
    room.lab.forEach(lab => {
        // 1. Lab 关停状态：取出所有非空资源（跳过被占用的 Lab）
        if (isShutDown) {
            if (isSpecialLab(lab.id, BotMemStructures)) return;
            if (!lab.store[lab.mineralType] || lab.store[lab.mineralType] === 0) return;
            
            addTransportMission(room, LevelMap.lab, {
                pos: lab,
                source: lab.id,
                target: storage.id,
                resourceType: lab.mineralType,
                amount: lab.store[lab.mineralType],
            });
            return;
        }

        // 2. Lab 开启状态：处理 Lab A/B
        if (lab.id === labA.id || lab.id === labB.id) {
            const type = (lab.id === labA.id) ? labAtype : labBtype;
            
            // 移除非设定资源
            if (lab.mineralType && lab.mineralType !== type && lab.store[lab.mineralType] > 0) {
                addTransportMission(room, LevelMap.lab, {
                    pos: lab,
                    source: lab.id,
                    target: storage.id,
                    resourceType: lab.mineralType,
                    amount: lab.store[lab.mineralType],
                });
                return;
            }

            // 填充设定资源
            if (lab.store.getFreeCapacity(type) >= LAB_TRIGGER_AMOUNT && room.getResAmount(type) >= LAB_TRIGGER_AMOUNT) {
                const target = [storage, terminal].find(t => t && t.store[type] > 0);
                if (target) {
                    addTransportMission(room, LevelMap.lab, {
                        pos: lab,
                        source: target.id,
                        target: lab.id,
                        resourceType: type,
                        amount: Math.min(lab.store.getFreeCapacity(type), target.store[type]),
                    } as any);
                }
            }
            return;
        }

        // 3. Lab 开启状态：处理反应 Lab（非 A/B，非 Boost）
        if (isSpecialLab(lab.id, BotMemStructures)) return;

        const reactionProduct = REACTIONS[labAtype][labBtype];
        
        // 移除非产物资源
        if (lab.mineralType && lab.mineralType !== reactionProduct && lab.store[lab.mineralType] > 0) {
            addTransportMission(room, LevelMap.lab, {
                pos: lab,
                source: lab.id,
                target: storage.id,
                resourceType: lab.mineralType,
                amount: lab.store[lab.mineralType],
            });
            return;
        }

        // 取出产物（当快满时）
        if (lab.mineralType === reactionProduct && lab.store.getFreeCapacity(reactionProduct) < LAB_MIN_CAPACITY) {
             addTransportMission(room, LevelMap.lab, {
                pos: lab,
                source: lab.id,
                target: storage.id,
                resourceType: reactionProduct,
                amount: lab.store[reactionProduct],
            });
        }
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

    // 1. 分配 Boost 任务
    if (!botmem['boostQueue']) botmem['boostQueue'] = {};
    if (Object.keys(botmem['boostQueue']).length) {
        room.lab.filter(lab => !isSpecialLab(lab.id, botmem))
            .forEach(lab => {
                const mineral = Object.keys(botmem['boostQueue'])[0] as ResourceConstant;
                if (!mineral) return;
                
                botmem['boostRes'][lab.id] = {
                    mineral: mineral,
                    amount: botmem['boostQueue'][mineral],
                }
                delete botmem['boostQueue'][mineral];
            })
    }

    // 2. 处理 Boost 填充与清理
    room.lab.forEach(lab => {
        const boostConfig = botmem['boostRes'][lab.id];
        let mineral = boostConfig?.mineral || botmem['boostTypes']?.[lab.id];

        // 校验资源有效性
        if (boostConfig && (!mineral || !RESOURCES_ALL.includes(mineral))) {
             delete botmem['boostRes'][lab.id];
             return;
        }
        
        // 如果 Lab 意外变成底物 Lab，退回任务
        if (boostConfig && (lab.id === botmem.labA || lab.id === botmem.labB)) {
            botmem['boostQueue'][mineral] = (botmem['boostQueue'][mineral] || 0) + boostConfig.amount;
            delete botmem['boostRes'][lab.id];
            return;
        }

        // 任务完成清理
        if (boostConfig && (boostConfig.amount || 0) <= 0) {
            delete botmem['boostRes'][lab.id];
            return;
        }

        if (!mineral) return;

        // 清理杂质
        if (lab.mineralType && lab.mineralType !== mineral && lab.store[lab.mineralType] > 0) {
             addTransportMission(room, LevelMap.boost, {
                pos: lab,
                source: lab.id,
                target: storeTarget.id,
                resourceType: lab.mineralType,
                amount: lab.store[lab.mineralType],
            });
            return;
        }

        // 填充 Boost 资源
        const targetAmount = boostConfig ? Math.min(LAB_FILL_AMOUNT, boostConfig.amount) : LAB_FILL_AMOUNT;
        
        if (lab.store[mineral] < targetAmount) {
            const need = targetAmount - lab.store[mineral];
            const target = [storage, terminal].find(t => t && t.store[mineral] > 0);
            
            if (target) {
                addTransportMission(room, LevelMap.boost, {
                    pos: lab,
                    source: target.id,
                    target: lab.id,
                    resourceType: mineral,
                    amount: Math.min(need, target.store[mineral]),
                });
            }
        }
    });
}
