import { LabMap, Goods, BarList } from "@/constant/ResourceConstant";

const MANAGE_BALANCE = {
    // 自动调度资源阈值
    THRESHOLD: {
        SOURCE: {
            DEFAULT: 4000,
            ENERGY: 30000,
            LAB: 3000,
            BAR: 3000,
            GOODS: 1200
        },
        TARGET: {
            DEFAULT: 3000,
            ENERGY: 25000,
            LAB: 3000,
            BAR: 3000,
            GOODS: 1000
        }
    },
    // Factory 搬运
    FACTORY_MIN: 3000,
    FACTORY_MAX: 3000,
    // PowerSpawn
    POWER_SPAWN_ENERGY_LIMIT: 5000,
    POWER_SPAWN_POWER_LIMIT: 100,
    // Terminal 自动平衡
    TERMINAL_ENERGY_LIMIT: 50e3,
    TERMINAL_RES_LIMIT: 10000
}

// 更新中央搬运工的任务
function UpdateManageMission(room: Room) {
    // 检查终端资源预留数量，不足则补充，超过则搬出
    CheckTerminalResAmount(room);
    // 检查工厂资源数量，补充或搬出
    CheckFactoryResAmount(room);
    // 补充powerSpawn资源，只在特定布局生效
    CheckPowerSpawnResAmount(room);
}

// 检查终端资源, 自动调度资源
function CheckTerminalResAmount(room: Room) {
    if (!room.storage || !room.terminal) return false;
    if (!room.storage.pos.inRange(room.terminal.pos, 2)) return false;

    // 发送任务资源数
    const sendTotal = room.getSendMissionTotalAmount();
    // 自动调度资源阈值
    const THRESHOLD = {
        source: {
            [RESOURCE_ENERGY]: MANAGE_BALANCE.THRESHOLD.SOURCE.ENERGY,
            default: MANAGE_BALANCE.THRESHOLD.SOURCE.DEFAULT
        },
        target: {
            [RESOURCE_ENERGY]: MANAGE_BALANCE.THRESHOLD.TARGET.ENERGY,
            default: MANAGE_BALANCE.THRESHOLD.TARGET.DEFAULT
        }
    }
    
    // 初始化阈值
    const initThresholds = (list: string[], srcVal: number, tgtVal: number) => {
        list.forEach((r) => { 
            THRESHOLD.source[r] = srcVal; 
            THRESHOLD.target[r] = tgtVal; 
        });
    };

    initThresholds(Object.keys(LabMap), MANAGE_BALANCE.THRESHOLD.SOURCE.LAB, MANAGE_BALANCE.THRESHOLD.TARGET.LAB);
    initThresholds(BarList, MANAGE_BALANCE.THRESHOLD.SOURCE.BAR, MANAGE_BALANCE.THRESHOLD.TARGET.BAR);
    initThresholds(Goods, MANAGE_BALANCE.THRESHOLD.SOURCE.GOODS, MANAGE_BALANCE.THRESHOLD.TARGET.GOODS);

    // 存在该旗帜时, 清空终端
    let TerminalClearFlag = Game.flags[`${room.name}_terminal_clear`];

    // 检查终端自动转入
    for (const resourceType in room.storage.store) {
        let amount = 0;
        if(resourceType === RESOURCE_ENERGY && Object.keys(sendTotal).length > 0) {
            amount = Math.min(
                room.storage.store[resourceType],
                Object.values(sendTotal).reduce((a, b) => (a + b) || 0, 0) - room.terminal.store[resourceType],
                MANAGE_BALANCE.TERMINAL_ENERGY_LIMIT - room.terminal.store[resourceType],
            )
        }
        // 有发送任务时，根据总量来定
        else if (sendTotal[resourceType]) {
            amount = Math.min(
                room.storage.store[resourceType],
                sendTotal[resourceType] - room.terminal.store[resourceType],
                MANAGE_BALANCE.TERMINAL_RES_LIMIT - room.terminal.store[resourceType]
            )
        } else {
            if (TerminalClearFlag) break;
            // 当终端资源不足时，将storage资源补充到终端
            const threshold = THRESHOLD.target[resourceType] || THRESHOLD.target.default;
            if (room.terminal.store[resourceType] >= threshold) continue;
            amount = Math.min(
                room.storage.store[resourceType],
                threshold - room.terminal.store[resourceType]
            );
        }
        if(amount <= 0) continue;
        room.ManageMissionAdd('s', 't', resourceType as ResourceConstant, amount);
    }

    // 检查终端自动转出
    for (const resourceType in room.terminal.store) {
        if(sendTotal[resourceType]) continue;
        // 当终端资源过多，且storage有空间时，将终端多余资源转入storage
        const threshold = TerminalClearFlag ? 0 : THRESHOLD.source[resourceType] || THRESHOLD.source.default;
        if(room.terminal.store[resourceType] <= threshold) continue;

        const amount = room.terminal.store[resourceType] - threshold;
        if(amount <= 0) continue;
        room.ManageMissionAdd('t', 's', resourceType as ResourceConstant, amount);
    }
}

function CheckFactoryResAmount(room: Room) {
    const factory = room.factory;
    if (!factory) return;
    const storage = room.storage;
    if (!storage) return;

    const mem = Memory['StructControlData'][room.name];
    if (!mem) return;
    
    const product = mem.factoryProduct;

    // 关停时全部取出
    if (!mem.factory || !product) {
        for(const type in factory.store) {
            room.ManageMissionAdd('f', 's', type as ResourceConstant, factory.store[type]);
        }
        return;
    }

    const components = COMMODITIES[product]?.components || {};

    // 将不是材料也不是产物的搬走
    for(const type in factory.store) {
        if(components[type]) continue;
        if(type === product) continue;
        room.ManageMissionAdd('f', 's', type as ResourceConstant, factory.store[type]);
    }


    // 材料不足时补充
    for(const component in components){
        if((room.getResAmount(component as ResourceConstant)) <= 0) continue;
        if(factory.store[component] >= 1000) continue;
        const amount = MANAGE_BALANCE.FACTORY_MIN - factory.store[component];

        room.ManageMissionAdd('s', 'f', component as ResourceConstant, Math.min(amount, storage.store[component]));
        if(storage.store[component] < amount) {
            room.ManageMissionAdd('t', 'f', component as ResourceConstant,
                Math.min(amount - storage.store[component],
                        room.terminal?.store[component]||0));
        }
    }

    // 产物过多时搬出
    if(factory.store[product] >= MANAGE_BALANCE.FACTORY_MAX) {
        if (room.storage && storage.store.getFreeCapacity() >= MANAGE_BALANCE.FACTORY_MAX) {
            room.ManageMissionAdd('f', 's', product, MANAGE_BALANCE.FACTORY_MAX);
        } else if (room.terminal && room.terminal.store.getFreeCapacity() >= MANAGE_BALANCE.FACTORY_MAX) {
            if (!storage.pos.inRange(room.terminal.pos, 2)) return false;
            room.ManageMissionAdd('f', 't', product, MANAGE_BALANCE.FACTORY_MAX);
        }
    }
}

function CheckPowerSpawnResAmount(room: Room) {
    const powerSpawn = room.powerSpawn;
    if (!powerSpawn) return;
    let center = Memory['RoomControlData'][room.name].center;
    let centerPos: RoomPosition;
    if (center) centerPos = new RoomPosition(center.x, center.y, room.name);
    if (!centerPos || !powerSpawn.pos.inRangeTo(centerPos, 1)) return;

    const fillPowerSpawn = (resource: ResourceConstant, limit: number, amount: number) => {
        if (powerSpawn.store[resource] < limit) {
            if (room.storage && room.storage.store[resource] >= amount) {
                room.ManageMissionAdd('s', 'p', resource, amount);
            } else if (room.terminal && room.terminal.store[resource] >= amount) {
                room.ManageMissionAdd('t', 'p', resource, amount);
            }
        }
    };

    fillPowerSpawn(RESOURCE_ENERGY, 1000, MANAGE_BALANCE.POWER_SPAWN_ENERGY_LIMIT);
    fillPowerSpawn(RESOURCE_POWER, 50, MANAGE_BALANCE.POWER_SPAWN_POWER_LIMIT);
}

export  {UpdateManageMission};
