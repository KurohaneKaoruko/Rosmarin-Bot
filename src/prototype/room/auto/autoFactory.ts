import { AUTO_FACTORY_CONFIG, Goods, PRODUCTION_MIN, RESOURCE_PRODUCTION, zipMap } from "@/constant/ResourceConstant";
import { getAutoFactoryData, getStructData } from "@/modules/utils/memory";

export default class AutoFactory extends Room {
    autoFactory() {
        if (Game.time % AUTO_FACTORY_CONFIG.tickInterval) return;
        if (!this.factory) return;
        const botmem = getStructData(this.name) as any;
        if (!botmem) return;
        if (botmem.factory === undefined) botmem.factory = true;
        if (!botmem.factory) return;

        // 注意：getResAmount 只统计 storage+terminal；但 factory 原料会被搬进 factory.store。
        // 这里使用“可用总量”避免误判缺料导致频繁停工/换任务。
        const getAvail = (res: ResourceConstant) => {
            return this.getResAmount(res) + (this.factory?.store?.[res] || 0);
        };

        // 产物
        const Product = botmem.factoryProduct;
        // 限额
        const amount = Number(botmem.factoryAmount) || 0;
        // 原料
        const components = COMMODITIES[Product]?.components;

        if (Product && amount > 0) {
            const cur = getAvail(Product as any);
            if (cur >= amount) {
                botmem.factoryProduct = null;
                botmem.factoryAmount = 0;
                delete (botmem as any).factoryWaitSince;
                global.log(`[${this.name}] 已自动结束factory生产任务(达到限额): ${Product}. 现库存: ${cur}`)
                return;
            }
        }

        // 原料充足则继续，直到原料不足才结束
        if (checkTask(this, getAvail, Product, components)) {
            delete (botmem as any).factoryWaitSince;
            return;
        }

        // 缺料：优先保持任务等待补料（资源管理/搬运任务可能正在路上）
        if (Product && components) {
            const since = (botmem as any).factoryWaitSince ?? Game.time;
            (botmem as any).factoryWaitSince = since;
            if (Game.time - since < AUTO_FACTORY_CONFIG.waitTimeoutTicks) return;
        }

        if (Product) {
            botmem.factoryProduct = null;
            botmem.factoryAmount = 0;
            delete (botmem as any).factoryWaitSince;
            global.log(`[${this.name}] 已自动结束factory生产任务: ${Product}. 现库存: ${getAvail(Product as any)}`)
        }

        // 获取自动任务列表
        const autoFactoryMap = getAutoFactoryData(this.name);
        const hasAutoList = !!(autoFactoryMap && Object.keys(autoFactoryMap).length);

        // 查找未到达限额且原料足够的任务
        let task: ResourceConstant | null = null;
        let taskAmount = 0;

        if (hasAutoList) {
            task = getTask(this, getAvail, autoFactoryMap);
            taskAmount = task ? autoFactoryMap[task] : 0;
        }

        if (!task) task = getBasicCommoditiesTask(this);

        if (!task) [ task, taskAmount ] = getZipTask(this);

        if (!task && RESOURCE_PRODUCTION.enabled && RESOURCE_PRODUCTION.factory.chain.enabled) {
            task = getFactoryChainTask(this, botmem as any, getAvail);
            taskAmount = 0;
        }

        if (!task) return;

        const canStart = (() => {
            const info = (COMMODITIES as any)?.[task as any];
            const level = Number(info?.level || 0);
            const minQuota = (PRODUCTION_MIN.commodityByLevel as any)?.[level] ?? PRODUCTION_MIN.commodityByLevel[0];
            const comps = info?.components as Record<string, number> | undefined;
            if (!comps) return false;
            let crafts = Infinity;
            for (const [c, need] of Object.entries(comps)) {
                const n = Number(need) || 0;
                if (n <= 0) continue;
                crafts = Math.min(crafts, Math.floor(getAvail(c as any) / n));
            }
            if (!Number.isFinite(crafts)) crafts = 0;
            return crafts > minQuota;
        })();
        if (!canStart) return;

        botmem.factoryProduct = task;
        botmem.factoryAmount = taskAmount;

        global.log(`[${this.name}] 已自动分配factory生产任务: ${task}, 限额: ${taskAmount || '无'}`)
        return OK;
    }
}

// 检查是否继续现有任务
const checkTask = (room: Room, getAvail: (res: ResourceConstant) => number, Product: string, components: any) => {
    if (!Product || !components) return false;
    return Object.entries(components).every(([c, need]) => getAvail(c as any) >= (need as number));
}

const getTask = (room: Room, getAvail: (res: ResourceConstant) => number, autoFactoryMap: any) => {
    let task: ResourceConstant | null = null;
    let bestDef = 0;
    let bestLevel = -Infinity;
    for (const res in autoFactoryMap) {
        const info = (COMMODITIES as any)?.[res];
        const level = Number(info?.level || 0);
        const components = info?.components as Record<string, number> | undefined;
        if (!components) continue;
        const limit = Number(autoFactoryMap[res] || 0);
        const cur = getAvail(res as any);
        const minQuota = (PRODUCTION_MIN.commodityByLevel as any)?.[level] ?? PRODUCTION_MIN.commodityByLevel[0];
        if (limit > 0) {
            if (cur >= limit * 0.9) continue;
        }
        let crafts = Infinity;
        for (const [c, need] of Object.entries(components)) {
            const n = Number(need) || 0;
            if (n <= 0) continue;
            crafts = Math.min(crafts, Math.floor(getAvail(c as any) / n));
        }
        if (!Number.isFinite(crafts)) crafts = 0;
        if (crafts <= minQuota) continue;
        const def = limit > 0 ? Math.max(0, limit - cur) : crafts;
        if (def > bestDef || (def === bestDef && level > bestLevel)) {
            bestDef = def;
            bestLevel = level;
            task = res as any;
        }
    }
    return task;
}

function getFactoryChainTask(room: Room, botmem: any, getAvail: (res: ResourceConstant) => number): ResourceConstant | null {
    const maxLevel = RESOURCE_PRODUCTION.factory.chain.maxLevel;
    const WHITE_ROOTS = new Set<string>([RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID]);
    const COLOR_ROOTS = new Set<string>([RESOURCE_METAL, RESOURCE_BIOMASS, RESOURCE_SILICON, RESOURCE_MIST]);
    const ROOT_BIT: Record<string, number> = {
        [RESOURCE_METAL]: 1,
        [RESOURCE_BIOMASS]: 2,
        [RESOURCE_SILICON]: 4,
        [RESOURCE_MIST]: 8,
    };
    const classCache = Object.create(null) as Record<string, { colored: boolean; white: boolean; rootsMask: number }>;
    const classify = (res: string): { colored: boolean; white: boolean; rootsMask: number } => {
        const hit = classCache[res];
        if (hit) return hit;
        const base = { colored: COLOR_ROOTS.has(res), white: WHITE_ROOTS.has(res), rootsMask: ROOT_BIT[res] || 0 };
        classCache[res] = base;
        const recipe = (COMMODITIES as any)?.[res];
        const components = recipe?.components as Record<string, number> | undefined;
        if (!components) return base;
        for (const comp of Object.keys(components)) {
            const child = classify(comp);
            base.colored ||= child.colored;
            base.white ||= child.white;
            base.rootsMask |= child.rootsMask;
        }
        return base;
    };

    const availableMask =
        (getAvail(RESOURCE_METAL) > 0 ? 1 : 0) |
        (getAvail(RESOURCE_BIOMASS) > 0 ? 2 : 0) |
        (getAvail(RESOURCE_SILICON) > 0 ? 4 : 0) |
        (getAvail(RESOURCE_MIST) > 0 ? 8 : 0);

    const effectiveLevel = Number(room.factory?.level || botmem?.factoryLevel || 0);
    if (effectiveLevel < 0 || effectiveLevel > maxLevel) return null;
    const keep = (RESOURCE_PRODUCTION.factory.chain.keepByLevel as any)?.[effectiveLevel] ?? 0;

    let best: ResourceConstant | null = null;
    let bestHave = Infinity;
    for (const product of Object.keys(COMMODITIES as any)) {
        const info = (COMMODITIES as any)[product];
        const level = Number(info?.level ?? 0);
        if (level !== effectiveLevel) continue;
        const tags = classify(product);
        if (!tags.colored) continue;
        if (RESOURCE_PRODUCTION.factory.chain.excludeWhite && tags.white) continue;
        if ((tags.rootsMask & ~availableMask) !== 0) continue;

        if (keep > 0 && getAvail(product as any) >= keep) continue;
        const components = info?.components as Record<string, number> | undefined;
        if (!components) continue;
        if (Object.entries(components).some(([c, need]) => getAvail(c as any) < Number(need))) continue;

        const have = getAvail(product as any);
        if (have < bestHave) {
            bestHave = have;
            best = product as any;
        }
    }

    return best;
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

function getZipTask(room: Room): [ResourceConstant | null, number] {
    const res = room.mineral?.mineralType;
    if (!res) return [null, 0];
    const zip = (zipMap as any)[res] as ResourceConstant | undefined;
    if (!zip) return [null, 0];

    const resAmount = room.getResAmount(res);
    const zipAmount = room.getResAmount(zip);

    if (resAmount > 100e3 && zipAmount < resAmount / 20) {
        return [zip as any, Math.floor(resAmount / 20)];
    }
    return [null, 0];
}
