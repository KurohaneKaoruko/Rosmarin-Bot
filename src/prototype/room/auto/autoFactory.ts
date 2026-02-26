import { AUTO_FACTORY_CONFIG, AUTO_FACTORY_FALLBACK, Goods, PRODUCTION_MIN, zipMap } from "@/constant/ResourceConstant";
import { getAutoFactoryData, getMissionPools, getStructData } from "@/modules/utils/memory";

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
        const flv = Number(this.factory.level || (botmem as any)?.factoryLevel || 0);

        const autoFactoryMap = getAutoFactoryData(this.name);
        const hasAutoList = !!(autoFactoryMap && Object.keys(autoFactoryMap).length);

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

        if (Product) {
            const missReasons: string[] = [];
            if (!components) {
                missReasons.push('no_recipe');
            } else {
                const store = (this.factory.store as any) || {};
                const missing = Object.entries(components).filter(([c, need]) => (store as any)[c] < Number(need));
                if (missing.length === 0) {
                    delete (botmem as any).factoryWaitSince;
                    return;
                }
                const pools = getMissionPools() as any;
                const manageTasks = pools?.[this.name]?.manage;
                // 收集当前正在向 factory 补料的资源类型
                const supplyingResources = new Set<string>();
                if (Array.isArray(manageTasks)) {
                    for (const t of manageTasks) {
                        if (t?.type !== 'manage') continue;
                        const d = t?.data as any;
                        if (!d || d.target !== 'factory') continue;
                        if (typeof d.amount !== 'number' || d.amount <= 0) continue;
                        const res = String(d.resourceType || '');
                        if (!res) continue;
                        const source = d.source;
                        const sourceObj = source ? (this as any)[source] : null;
                        const sourceAmount = sourceObj?.store?.[res] || 0;
                        if (sourceAmount > 0) supplyingResources.add(res);
                    }
                }

                const missingDetails = missing.map(([c, need]) => {
                    const res = String(c);
                    const needTotal = Number(need) || 0;
                    const haveInFactory = Number((store as any)[res] || 0);
                    const needRemain = Math.max(0, needTotal - haveInFactory);
                    return { res, needRemain };
                });

                const supplyPossible = missingDetails.every(({ res, needRemain }) => {
                    if (needRemain <= 0) return true;
                    if (supplyingResources.has(res)) return true;
                    return this.getResAmount(res as any) >= needRemain;
                });

                if (!supplyPossible) {
                    missReasons.push('no_supply');
                }
            }

            if (missReasons.length === 0) {
                delete (botmem as any).factoryWaitSince;
                return;
            }

            if (missReasons.includes('no_supply')) {
                const hasAlternativeRunnable = hasAutoList && Object.keys(autoFactoryMap).some((p) => {
                    if (!p || p === Product) return false;
                    const info = (COMMODITIES as any)?.[p];
                    const level = Number(info?.level || 0);
                    if (!isFactoryLevelCompatible(flv, level)) return false;
                    return canStartTask(getAvail, p as any);
                });
                const waitLimit = hasAlternativeRunnable
                    ? Number((AUTO_FACTORY_CONFIG as any).waitTimeoutTicksWhenAlternatives ?? AUTO_FACTORY_CONFIG.waitTimeoutTicks)
                    : AUTO_FACTORY_CONFIG.waitTimeoutTicks;
                const since = (botmem as any).factoryWaitSince ?? Game.time;
                (botmem as any).factoryWaitSince = since;
                if (Game.time - since < waitLimit) return;

                botmem.factoryProduct = null;
                botmem.factoryAmount = 0;
                delete (botmem as any).factoryWaitSince;
                global.log(`[${this.name}] 已自动结束factory生产任务(超时缺料): ${Product}. 现库存: ${getAvail(Product as any)}`)
            } else {
                botmem.factoryProduct = null;
                botmem.factoryAmount = 0;
                delete (botmem as any).factoryWaitSince;
                global.log(`[${this.name}] 已自动结束factory生产任务(无配方): ${Product}.`)
            }
        }

        // 查找未到达限额且原料足够的任务
        let task: ResourceConstant | null = null;
        let taskAmount = 0;

        const isBanned = (p: string) => {
            const until = (botmem as any)?.factoryBan?.[p];
            return typeof until === 'number' && Game.time < until;
        };

        if (hasAutoList) {
            task = getTask(this, getAvail, flv, autoFactoryMap, isBanned);
            taskAmount = task ? autoFactoryMap[task] : 0;
        }

        if (!task) {
            const picked = getFallbackTask(this, botmem as any, flv, getAvail, isBanned);
            if (picked) {
                task = picked.product as any;
                taskAmount = picked.limit;
            }
        }

        if (!task) return;

        if (!canStartTask(getAvail, task as any)) return;

        botmem.factoryProduct = task;
        botmem.factoryAmount = taskAmount;

        global.log(`[${this.name}] 已自动分配factory生产任务: ${task}, 限额: ${taskAmount || '无'}`)
        return OK;
    }
}

const getTask = (room: Room, getAvail: (res: ResourceConstant) => number, factoryLevel: number, autoFactoryMap: any, isBanned?: (p: string) => boolean) => {
    let task: ResourceConstant | null = null;
    let bestDef = 0;
    let bestLevel = -Infinity;
    for (const res in autoFactoryMap) {
        const info = (COMMODITIES as any)?.[res];
        const level = Number(info?.level || 0);
        if (!isFactoryLevelCompatible(factoryLevel, level)) continue;
        if (isBanned && isBanned(res)) continue;
        const limit = Number(autoFactoryMap[res] || 0);
        const cur = getAvail(res as any);
        if (limit > 0) {
            if (cur >= limit * 0.9) continue;
        }
        if (!canStartTask(getAvail, res as any)) continue;
        const output = getCraftableOutput(getAvail, res as any);
        const def = limit > 0 ? Math.max(0, limit - cur) : output;
        if (def > bestDef || (def === bestDef && level > bestLevel)) {
            bestDef = def;
            bestLevel = level;
            task = res as any;
        }
    }
    return task;
}

const isFactoryLevelCompatible = (factoryLevel: number, commodityLevel: number) => {
    if (!commodityLevel) return true;
    return Number(factoryLevel) === Number(commodityLevel);
};

// 判定某产物是否值得开工：房间内原料足够至少达到“最小生产额度”
const canStartTask = (getAvail: (res: ResourceConstant) => number, product: ResourceConstant) => {
    const info = (COMMODITIES as any)?.[product as any];
    const level = Number(info?.level || 0);
    const minQuota = (PRODUCTION_MIN.commodityByLevel as any)?.[level] ?? PRODUCTION_MIN.commodityByLevel[0];
    return getCraftableOutput(getAvail, product) >= minQuota;
};

const getCraftableOutput = (getAvail: (res: ResourceConstant) => number, product: ResourceConstant) => {
    const info = (COMMODITIES as any)?.[product as any];
    const per = Number(info?.amount || 1);
    const comps = info?.components as Record<string, number> | undefined;
    if (!comps) return 0;
    let crafts = Infinity;
    for (const [c, need] of Object.entries(comps)) {
        const n = Number(need) || 0;
        if (n <= 0) continue;
        crafts = Math.min(crafts, Math.floor(getAvail(c as any) / n));
    }
    if (!Number.isFinite(crafts)) crafts = 0;
    return crafts * per;
};

const getMinQuota = (product: ResourceConstant) => {
    const info = (COMMODITIES as any)?.[product as any];
    const level = Number(info?.level || 0);
    return (PRODUCTION_MIN.commodityByLevel as any)?.[level] ?? PRODUCTION_MIN.commodityByLevel[0];
};

const getCraftsNeedForOutput = (product: ResourceConstant, targetOutput: number) => {
    const info = (COMMODITIES as any)?.[product as any];
    const per = Math.max(1, Number(info?.amount || 1));
    return Math.max(1, Math.ceil(targetOutput / per));
};

type FallbackPick = { product: ResourceConstant; limit: number };

// 兜底策略：当计划为空/计划不可做时，按阈值驱动“压缩/白色根/基础中间件/四色链条”自动补链
const getFallbackTask = (room: Room, botmem: any, factoryLevel: number, getAvail: (res: ResourceConstant) => number, isBanned?: (p: string) => boolean): FallbackPick | null => {
    if (!AUTO_FACTORY_FALLBACK.enabled) return null;
    if (!room.factory) return null;

    const keepInRoom = AUTO_FACTORY_FALLBACK.keepInRoom as unknown as Record<string, number>;
    const keepByLevelInRoom = AUTO_FACTORY_FALLBACK.keepByLevelInRoom as unknown as Record<number, number>;
    const zipRawSurplusMin = AUTO_FACTORY_FALLBACK.zipRawSurplusMin as unknown as Record<string, number>;

    const effectiveLevel = Number(factoryLevel || 0);

    const classCache = Object.create(null) as Record<string, { colored: boolean; white: boolean; rootsMask: number }>;
    const WHITE_ROOTS = new Set<string>([RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID]);
    const COLOR_ROOTS = new Set<string>([RESOURCE_METAL, RESOURCE_BIOMASS, RESOURCE_SILICON, RESOURCE_MIST]);
    const ROOT_BIT: Record<string, number> = {
        [RESOURCE_METAL]: 1,
        [RESOURCE_BIOMASS]: 2,
        [RESOURCE_SILICON]: 4,
        [RESOURCE_MIST]: 8,
    };
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

    const visited = new Set<string>();
    const resolveProducible = (product: string, depth: number, targetOutput: number): { product: ResourceConstant; needOutput: number } | null => {
        if (depth > AUTO_FACTORY_FALLBACK.maxResolveDepth) return null;
        if (visited.has(product)) return null;
        visited.add(product);

        const productLevel = Number((COMMODITIES as any)?.[product]?.level ?? 0);
        if (!isFactoryLevelCompatible(effectiveLevel, productLevel)) return null;

        const minQuota = getMinQuota(product as any);
        const desired = Math.max(minQuota, Math.floor(targetOutput) || 0);

        if (canStartTask(getAvail, product as any)) return { product: product as any, needOutput: desired };

        const info = (COMMODITIES as any)?.[product];
        const components = info?.components as Record<string, number> | undefined;
        if (!components) return null;

        const craftsNeed = getCraftsNeedForOutput(product as any, desired);
        const missingList: { comp: string; missing: number }[] = [];
        for (const [comp, needRaw] of Object.entries(components)) {
            const needPerCraft = Number(needRaw) || 0;
            if (needPerCraft <= 0) continue;
            const needTotal = needPerCraft * craftsNeed;
            const cur = getAvail(comp as any);
            const missing = needTotal - cur;
            if (missing > 0) missingList.push({ comp, missing });
        }

        missingList.sort((a, b) => b.missing - a.missing || a.comp.localeCompare(b.comp));

        for (const { comp, missing } of missingList) {
            if (!(COMMODITIES as any)?.[comp]) continue;
            const compLevel = Number((COMMODITIES as any)?.[comp]?.level ?? 0);
            if (!isFactoryLevelCompatible(effectiveLevel, compLevel)) continue;
            const compMinQuota = getMinQuota(comp as any);
            const compDesired = Math.max(compMinQuota, missing);
            const resolved = resolveProducible(comp, depth + 1, compDesired);
            if (resolved) return resolved;
        }

        return null;
    };

    const pickKeeped = (product: string) => {
        if (isBanned && isBanned(product)) return null;
        const keep = Number(keepInRoom[product] || 0);
        if (keep <= 0) return null;
        if (getAvail(product as any) >= keep) return null;
        const level = Number((COMMODITIES as any)?.[product]?.level ?? 0);
        if (!isFactoryLevelCompatible(effectiveLevel, level)) return null;
        const resolved = resolveProducible(product, 0, getMinQuota(product as any));
        if (!resolved) return null;
        if (resolved.product === (product as any)) return { product: resolved.product, limit: keep };
        const cur = getAvail(resolved.product as any);
        return { product: resolved.product, limit: cur + resolved.needOutput };
    };

    // 1) 压缩：zipMap 全量（不局限 mineralType），但需要底物明显富余
    for (const [raw, zip] of Object.entries(zipMap as any)) {
        const rawKeep = zipRawSurplusMin[raw];
        if (rawKeep && getAvail(raw as any) < rawKeep) continue;
        const picked = pickKeeped(String(zip));
        if (picked) return picked;
    }

    // 2) 白色根商品（作为高阶商品/后续链条底物）
    for (const product of [RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID]) {
        const picked = pickKeeped(product);
        if (picked) return picked;
    }

    // 3) 基础四色中间件（wire/cell/alloy/condensate）
    for (const product of [RESOURCE_WIRE, RESOURCE_CELL, RESOURCE_ALLOY, RESOURCE_CONDENSATE]) {
        const picked = pickKeeped(product);
        if (picked) return picked;
    }

    // 4) 四色链条兜底：按工厂有效等级，挑“最缺的可生产项”
    if (Number.isFinite(effectiveLevel) && effectiveLevel >= 0) {
        const keep = Number(keepByLevelInRoom[effectiveLevel] || 0);
        if (keep > 0) {
            let best: FallbackPick | null = null;
            let bestHave = Infinity;
            for (const product of Object.keys(COMMODITIES as any)) {
                const info = (COMMODITIES as any)[product];
                const level = Number(info?.level ?? 0);
                if (level !== effectiveLevel) continue;
                const tags = classify(product);
                if (!tags.colored) continue;
                if ((tags.rootsMask & ~availableMask) !== 0) continue;
                const have = getAvail(product as any);
                if (have >= keep) continue;
                const resolved = resolveProducible(product, 0, getMinQuota(product as any));
                if (!resolved) continue;
                const resolvedHave = getAvail(resolved.product as any);
                if (resolvedHave < bestHave) {
                    bestHave = resolvedHave;
                    const limit = resolved.product === (product as any)
                        ? keep
                        : getAvail(resolved.product as any) + resolved.needOutput;
                    best = { product: resolved.product, limit };
                }
            }
            if (best) return best;
        }
    }

    // 5) 降级策略：当所有任务都达到目标库存时，降低阈值重新尝试
    const degradeRatio = 0.5;
    let degradeAttempt = 0;
    const getReducedThreshold = (targetKeep: number, attempt: number) => Math.max(targetKeep * Math.pow(degradeRatio, attempt), 100);

    while (degradeAttempt < 3) {
        for (const product of [RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID]) {
            if (isBanned && isBanned(product)) continue;
            const keep = Number(keepInRoom[product] || 0);
            if (keep <= 0) continue;
            const level = Number((COMMODITIES as any)?.[product]?.level ?? 0);
            if (!isFactoryLevelCompatible(effectiveLevel, level)) continue;
            const reducedKeep = getReducedThreshold(keep, degradeAttempt);
            if (getAvail(product as any) >= keep) {
                const reducedKeep = getReducedThreshold(keep, degradeAttempt);
                if (getAvail(product as any) < reducedKeep) {
                    const resolved = resolveProducible(product, 0, getMinQuota(product as any));
                    if (resolved && resolved.product === (product as any)) {
                        return { product: resolved.product, limit: reducedKeep };
                    }
                }
            }
        }

        for (const product of [RESOURCE_WIRE, RESOURCE_CELL, RESOURCE_ALLOY, RESOURCE_CONDENSATE]) {
            if (isBanned && isBanned(product)) continue;
            const keep = Number(keepInRoom[product] || 0);
            if (keep <= 0) continue;
            const level = Number((COMMODITIES as any)?.[product]?.level ?? 0);
            if (!isFactoryLevelCompatible(effectiveLevel, level)) continue;
            const reducedKeep = getReducedThreshold(keep, degradeAttempt);
            if (getAvail(product as any) >= keep) {
                const reducedKeep = getReducedThreshold(keep, degradeAttempt);
                if (getAvail(product as any) < reducedKeep) {
                    const resolved = resolveProducible(product, 0, getMinQuota(product as any));
                    if (resolved && resolved.product === (product as any)) {
                        return { product: resolved.product, limit: reducedKeep };
                    }
                }
            }
        }

        if (Number.isFinite(effectiveLevel) && effectiveLevel >= 0) {
            const keep = Number(keepByLevelInRoom[effectiveLevel] || 0);
            if (keep > 0) {
                for (const product of Object.keys(COMMODITIES as any)) {
                    const info = (COMMODITIES as any)[product];
                    const level = Number(info?.level ?? 0);
                    if (level !== effectiveLevel) continue;
                    const tags = classify(product);
                    if (!tags.colored) continue;
                    if ((tags.rootsMask & ~availableMask) !== 0) continue;
                    const have = getAvail(product as any);
                    if (have >= keep) {
                        const reducedKeep = getReducedThreshold(keep, degradeAttempt);
                        if (have < reducedKeep) {
                            const resolved = resolveProducible(product, 0, getMinQuota(product as any));
                            if (resolved && resolved.product === (product as any)) {
                                return { product: resolved.product, limit: reducedKeep };
                            }
                        }
                    }
                }
            }
        }

        degradeAttempt++;
    }

    return null;
};
