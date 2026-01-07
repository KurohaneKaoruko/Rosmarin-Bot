import {Goods,zipMap} from "@/constant/ResourceConstant";

export default class AutoFactory extends Room {
    autoFactory() {
        if (Game.time % 50) return;
        if (!this.factory) return;
        const botmem = Memory['StructControlData'][this.name];
        // 关停时不处理
        if (!botmem || !botmem.factory) return;

        // 产物
        const Product = botmem.factoryProduct;
        // 限额
        const amount = (botmem.factoryAmount||0);
        // 原料
        const components = COMMODITIES[Product]?.components;

        // 未超限额, 原料充足, 则不变更任务
        if (checkTask(this, Product, components, amount)) return;

        if (Product) {
            botmem.factoryProduct = null;
            botmem.factoryAmount = 0;
            global.log(`[${this.name}] 已自动结束factory生产任务: ${Product}. 现库存: ${this.getResAmount(Product)}`)
        }

        // 获取自动任务列表
        const autoFactoryMap = Memory['AutoData']['AutoFactoryData'][this.name];
        if (!autoFactoryMap || !Object.keys(autoFactoryMap).length) return;

        // 查找未到达限额且原料足够的任务
        let task = getTask(this, autoFactoryMap);
        let taskAmount = task ? autoFactoryMap[task] : 0;

        if (!task) task = getBasicCommoditiesTask(this);

        if (!task) [ task, taskAmount ] = getZipTask(this);

        if (!task) return;

        botmem.factoryProduct = task;
        botmem.factoryAmount = taskAmount;

        global.log(`[${this.name}] 已自动分配factory生产任务: ${task}, 限额: ${taskAmount || '无'}`)
        return OK;
    }
}

// 检查是否继续现有任务
const checkTask = (room: Room, Product: string, components: any, amount: number) => {
    if (!Product || !components) return false;
    if (amount <= 0 || room.getResAmount(Product) < amount) {
        return Object.keys(components).every((c: any) =>
            (Goods.includes(c) && room.getResAmount(c) >= components[c]) ||
            room.getResAmount(c) >= 1000 || room.factory.store[c] >= components[c]
        )
    } else {
        return false;
    }
}

const getTask = (room: Room, autoFactoryMap: any) => {
    let task = null;
    let lv = -Infinity;
    for (const res in autoFactoryMap) {
        const level = COMMODITIES[res].level || 0;
        if (level <= lv) continue;
        const components = COMMODITIES[res].components;
        const amount = autoFactoryMap[res];
        if (amount > 0 && room.getResAmount(res) >= amount * 0.9) continue;
        if (Goods.includes(res as any)) {
            if (Object.keys(components).some((c: any) =>
                room.getResAmount(c) < components[c] * 10)) continue;
        } else {
            if (Object.keys(components).some((c: any) =>
                room.getResAmount(c) < 10000)) continue;
        }
        task = res;
        lv = level;
    }
    return task;
}

function getBasicCommoditiesTask(room: Room) {
    if (room.getResAmount(RESOURCE_SILICON) >= 5000 &&
        room.getResAmount(RESOURCE_UTRIUM_BAR) >= 1000
    ) return RESOURCE_WIRE;
    
    if (room.getResAmount(RESOURCE_BIOMASS) >= 5000 &&
        room.getResAmount(RESOURCE_LEMERGIUM_BAR) >= 1000
    ) return RESOURCE_CELL;

    if (room.getResAmount(RESOURCE_METAL) >= 5000 &&
        room.getResAmount(RESOURCE_ZYNTHIUM_BAR) >= 1000
    ) return RESOURCE_ALLOY;

    if (room.getResAmount(RESOURCE_MIST) >= 5000 &&
        room.getResAmount(RESOURCE_KEANIUM_BAR) >= 1000
    ) return RESOURCE_CONDENSATE;

    return null
}

function getZipTask(room: Room): any {
    let res = room.mineral.mineralType;
    let zip = zipMap[res];

    let resAmount = room.getResAmount(res);
    let zipAmount = room.getResAmount(zip);

    if (resAmount > 100e3 && zipAmount < resAmount / 20) {
        return [zip, resAmount / 20];
    }   return [null, 0];
}