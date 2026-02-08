import {Goods, LAB_T1_PRIORITY, LabMap, PRODUCTION_MIN, RESOURCE_BALANCE, RESOURCE_PRODUCTION, t1, t2, t3} from '@/constant/ResourceConstant'
import { log } from '@/utils';
import { getAutoFactoryData, getAutoLabData, getMissionPools, getResourceManage, getRoomData, getStructData } from '@/modules/utils/memory';
import { getLabAB } from '@/modules/utils/labReservations';

const br = '<br/>';
const LOG_COLORS = {
    theme: '#D0CAE0',
    good: '#4CC9F0',
    warning: '#FFC300',
    danger: '#FF003C',
    neutral: '#B8B8B8',
    text: '#F0F0F0',
    textMuted: '#B0B0B0',
} as const;

const c = (text: string, color: string, bold = false) =>
    `<span style="color:${color};${bold ? 'font-weight:700;' : ''}">${text}</span>`;

const mono = (text: string, color: string = LOG_COLORS.text) =>
    `<span style="color:${color};font-family:Consolas,monospace;">${text}</span>`;

const kv = (key: string, value: string) =>
    `${c(key, LOG_COLORS.textMuted, true)} ${mono(value)}`;

const fmtPct = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

const logRM = (lines: string[]) => log('资源管理', lines.join(br));

const getResourceIcon = (resourceType: any) => {
    if (resourceType === 'empty') {
        return `<span style="display:inline-block;width:12px;height:12px;border:1px dashed #555;border-radius:2px;margin-right:2px;vertical-align:middle;"></span>`;
    }
    const safeType = String(resourceType);
    const baseUrl = 'https://s3.amazonaws.com/static.screeps.com/upload/mineral-icons/';
    const iconUrl = baseUrl + encodeURIComponent(safeType) + '.png';
    return `<img src="${iconUrl}" alt="${safeType}" style="height:12px;width:14px;object-fit:contain;vertical-align:middle;margin-right:3px;border-radius:2px;" />`;
};

const resTag = (resType: any, color: string = LOG_COLORS.text) => `${getResourceIcon(resType)}${mono(String(resType), color)}`;

/** 资源管理模块 */
export const ResourceManage = {
    tick: function () {
        // 降低全局资源平衡的 CPU 占用：固定间隔执行
        if (Game.time % 50) return;
        const ResManageMem = getResourceManage() || {};
        // 全局默认参与平衡的资源类型（可被 Memory.RosmarinBot.ResourceManage 的房间自定义条目扩展）
        const balanceResKeys = Object.keys(RESOURCE_BALANCE);

        // ResManageMap: 按资源维度收集“可供应房间/需求房间”
        const ResManageMap = Object.create(null) as Record<string, { source: string[], target: string[] }>;
        // ThresholdMap: 记录每个房间每种资源的 [需求阈值, 供应阈值]
        const ThresholdMap = Object.create(null) as Record<string, Record<string, [number, number]>>;
        // amountCache: 同 tick 内缓存 room.getResAmount，避免排序/循环重复计算
        const amountCache = Object.create(null) as Record<string, Record<string, number>>;

        const getResAmountCached = (room: Room, res: string) => {
            if (!amountCache[room.name]) amountCache[room.name] = Object.create(null) as Record<string, number>;
            if (amountCache[room.name][res] !== undefined) return amountCache[room.name][res];
            const amount = room.getResAmount(res);
            amountCache[room.name][res] = amount;
            return amount;
        }

        const eligibleRooms: Room[] = [];
        const productionRooms: Room[] = [];

        // 遍历所有房间的设置
        for (const roomName in getRoomData()) {
            const room = Game.rooms[roomName];
            // 跨房间资源平衡“是否转入资源”的风险，由房间攻防态决定。
            // - productionRooms：用于排产/缺口统计（要求有 storage+terminal 且可用）
            // - eligibleRooms：用于跨房间资源平衡的资源扫描与调度候选（转入是否允许在 target 分支单独判定）
            if (!room || !room.my || !room.terminal || !room.storage || room.level < 6 ||
                room.terminal.owner.username != room.controller.owner.username ||
                room.storage.owner.username != room.controller.owner.username
            ) continue;

            productionRooms.push(room);
            eligibleRooms.push(room);

            let Ress: string[] = [];

            // 如果 terminal 与 storage 不贴近（2 格内）或手动挂旗，只平衡能量
            if (!room.terminal.pos.inRangeTo(room.storage.pos, 2) || Game.flags[`${roomName}/BALANCE_ENERGY`]) {
                Ress = [RESOURCE_ENERGY];
            } else {
                // 房间自定义阈值里出现的资源也纳入扫描
                Ress = [...Object.keys(ResManageMem[roomName]||{}), ...balanceResKeys];
                Ress = [...new Set(Ress)];
            }
            
            for (const res of Ress) {
                if (!ResManageMap[res]) ResManageMap[res] = { source: [], target: [] };
                let sourceThreshold: number, targetThreshold: number;
                if (ResManageMem[roomName] && ResManageMem[roomName][res]) {
                    // Memory.RosmarinBot.ResourceManage 配置优先级高于全局 RESOURCE_BALANCE
                    sourceThreshold = ResManageMem[roomName][res][1] ?? Infinity;
                    targetThreshold = ResManageMem[roomName][res][0] ?? 0;
                } else {
                    const base = (RESOURCE_BALANCE as any)[res];
                    if (!base) continue;
                    sourceThreshold = base[1] ?? Infinity;
                    targetThreshold = base[0] ?? 0;
                }
                if (!ThresholdMap[roomName]) ThresholdMap[roomName] = {};
                ThresholdMap[roomName][res] = [targetThreshold, sourceThreshold];
                let resAmount = getResAmountCached(room, res);
                if (resAmount > sourceThreshold) {
                    // terminal 冷却时不把该房间作为供应方
                    if (room.terminal.cooldown) continue;
                    ResManageMap[res].source.push(roomName);
                } else if (resAmount < targetThreshold) {
                    if (!room.isResourceTransferInSafe()) continue;
                    ResManageMap[res].target.push(roomName);
                }
            }
        }

        let logged = 0;
        let suppressed = 0;
        const LOG_LIMIT = RESOURCE_PRODUCTION.enabled && RESOURCE_PRODUCTION.log?.enabled
            ? RESOURCE_PRODUCTION.log.limitPerTick
            : 10;
        const tryLog = (lines: string[]) => {
            if (LOG_LIMIT <= 0) return;
            if (logged >= LOG_LIMIT) {
                suppressed++;
                return;
            }
            logged++;
            logRM(lines);
        }

        if (RESOURCE_PRODUCTION.enabled) {
            const globalCache = Object.create(null) as Record<string, number>;
            const getGlobalAmount = (res: string) => {
                if (globalCache[res] !== undefined) return globalCache[res];
                let total = 0;
                    for (const room of productionRooms) total += getResAmountCached(room, res);
                globalCache[res] = total;
                return total;
            };

            const getRoomAvailAmount = (room: Room, res: string) => {
                let total = getResAmountCached(room, res);
                const labs = (room as any).lab as StructureLab[] | undefined;
                if (Array.isArray(labs)) {
                    for (const lab of labs) {
                        if (!lab || lab.mineralType !== (res as any)) continue;
                        total += (lab.store as any)[res] || 0;
                    }
                }
                return total;
            };

            const getBalance = (res: string) => (RESOURCE_BALANCE as any)[res] as [number, number] | undefined;
            const getDemand = (res: string) => getBalance(res)?.[0] ?? 0;
            const getSupply = (res: string) => getBalance(res)?.[1] ?? 0;

            const pickByDeficit = (targets: Record<string, number>, remaining: Record<string, number>) => {
                let best: string | null = null;
                let bestDef = 0;
                for (const [res, target] of Object.entries(targets)) {
                    if (!target || target <= 0) continue;
                    const def = remaining[res] ?? (target - getGlobalAmount(res));
                    remaining[res] = def;
                    if (def > bestDef) {
                        bestDef = def;
                        best = res;
                    }
                }
                return best && bestDef > 0 ? best : null;
            };

            const prodNeeds = Object.create(null) as Record<string, Record<string, number>>;
            const noteNeed = (roomName: string, res: string, minAmount: number) => {
                if (!prodNeeds[roomName]) prodNeeds[roomName] = Object.create(null) as Record<string, number>;
                prodNeeds[roomName][res] = Math.max(prodNeeds[roomName][res] || 0, minAmount);
            };

            const planLabEnabled = RESOURCE_PRODUCTION.lab.enabled && RESOURCE_PRODUCTION.lab.chain.enabled;
            if (planLabEnabled) {
                const managedKeys = new Set<string>([
                    ...LAB_T1_PRIORITY as any,
                    ...t1 as any,
                    ...t2 as any,
                    ...t3 as any,
                ]);

                const remaining = Object.create(null) as Record<string, number>;
                const getDeficit = (res: string) => {
                    if (remaining[res] !== undefined) return remaining[res];
                    const supply = getSupply(res);
                    const def = supply > 0 ? Math.max(0, supply - getGlobalAmount(res)) : 0;
                    remaining[res] = def;
                    return def;
                };

                const canConsume = (res: string) => {
                    const keep = getDemand(res) + 1000;
                    return getGlobalAmount(res) > keep;
                };

                const buildLabPlanList = () => {
                    const list: { product: string; tier: 'T1' | 'T2' | 'T3'; minPull: number; def: number }[] = [];

                    const pushTier = (products: readonly string[], tier: 'T1' | 'T2' | 'T3', minPull: number, prioritize: readonly string[] | null) => {
                        const unique = new Set<string>(products as any);
                        const ordered: string[] = [];
                        if (prioritize) {
                            for (const p of prioritize) if (unique.has(p)) ordered.push(p);
                            for (const p of products) if (!prioritize.includes(p)) ordered.push(p);
                        } else {
                            ordered.push(...products as any);
                        }

                        for (const p of ordered) {
                            const def = getDeficit(p);
                            if (def <= 0) continue;
                            const recipe = (LabMap as any)[p];
                            if (!recipe) continue;
                            const raw1 = recipe.raw1 as string;
                            const raw2 = recipe.raw2 as string;
                            if (!canConsume(raw1) || !canConsume(raw2)) continue;
                            list.push({ product: p, tier, minPull, def });
                        }
                    };

                    pushTier(t3 as any, 'T3', RESOURCE_PRODUCTION.lab.chain.inputMin.t3, null);
                    pushTier(t2 as any, 'T2', RESOURCE_PRODUCTION.lab.chain.inputMin.t2, null);
                    pushTier(t1 as any, 'T1', RESOURCE_PRODUCTION.lab.chain.inputMin.t1, LAB_T1_PRIORITY as any);

                    const tierRank: Record<string, number> = { T3: 0, T2: 1, T1: 2 };
                    list.sort((a, b) => (tierRank[a.tier] - tierRank[b.tier]) || (b.def - a.def) || a.product.localeCompare(b.product));
                    return list;
                };

                const planList = buildLabPlanList();
                if (planList.length) {
                    const planRooms: { room: Room; autoLabMap: Record<string, number>; botmem: any }[] = [];
                    for (const room of productionRooms) {
                        const labs = (room as any).lab as StructureLab[] | undefined;
                        if (!Array.isArray(labs) || labs.length === 0) continue;
                        const botmem = getStructData(room.name) as any;
                        if (botmem && botmem.lab === false) continue;
                        const { labA, labB } = getLabAB(room.name, room);
                        if (!labA || !labB) continue;
                        if (botmem?.labAtype && botmem?.labBtype) continue;

                        const autoLabMap = getAutoLabData(room.name) as any;
                        if (RESOURCE_PRODUCTION.lab.chain.respectManualAutoData) {
                            const keys = Object.keys(autoLabMap);
                            const hasManual = keys.some(k => !managedKeys.has(k));
                            if (hasManual) continue;
                        }

                        const plannedKeys = Object.keys(autoLabMap).filter(k => managedKeys.has(k));
                        if (plannedKeys.length === 1) {
                            const planned = plannedKeys[0];
                            const plannedLimit = Number(autoLabMap[planned] || 0);
                            const remain = plannedLimit - getRoomAvailAmount(room, planned);
                            if (remain >= PRODUCTION_MIN.compound) continue;
                        }

                        planRooms.push({ room, autoLabMap, botmem });
                    }

                    let cursor = 0;
                    const pickForRoom = () => {
                        if (!planList.length) return null;
                        for (let i = 0; i < planList.length; i++) {
                            const idx = (cursor + i) % planList.length;
                            const p = planList[idx];
                            const def = getDeficit(p.product);
                            if (def <= 0) continue;
                            cursor = (idx + 1) % planList.length;
                            return { ...p, def };
                        }
                        return null;
                    };

                    for (const { room, autoLabMap } of planRooms) {
                        const picked = pickForRoom();
                        if (!picked) break;

                        const deficit = picked.def;
                        const batch = Math.max(0, Math.min(RESOURCE_PRODUCTION.lab.chain.batchPerRoom, deficit));
                        if (batch < PRODUCTION_MIN.compound) continue;
                        remaining[picked.product] = deficit - batch;

                        for (const k of Object.keys(autoLabMap)) {
                            if (managedKeys.has(k)) delete autoLabMap[k];
                        }
                        autoLabMap[picked.product] = getRoomAvailAmount(room, picked.product) + batch;

                        const recipe = (LabMap as any)[picked.product];
                        const raw1 = recipe?.raw1 as string | undefined;
                        const raw2 = recipe?.raw2 as string | undefined;
                        if (raw1) noteNeed(room.name, raw1, picked.minPull);
                        if (raw2) noteNeed(room.name, raw2, picked.minPull);

                        tryLog([
                            `${c('生产计划', LOG_COLORS.theme, true)} ${c('LAB', LOG_COLORS.good, true)} ${c(room.name, LOG_COLORS.theme, true)}`,
                            `${kv('tier', picked.tier)} | ${kv('产物', resTag(picked.product))} | ${kv('全局缺口', String(deficit))} | ${kv('本轮批量', String(batch))}`,
                        ]);
                    }
                }
            }

            const planFactoryRooms = RESOURCE_PRODUCTION.factory.enabled ? productionRooms : [];
            if (planFactoryRooms.length && RESOURCE_PRODUCTION.factory.chain.enabled) {
                const getRoomAvailWithFactory = (room: Room, res: string) => {
                    return getResAmountCached(room, res) + ((room.factory?.store as any)?.[res] || 0);
                };

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
                    const base = {
                        colored: COLOR_ROOTS.has(res),
                        white: WHITE_ROOTS.has(res),
                        rootsMask: ROOT_BIT[res] || 0,
                    };
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

                const globalAvailCache = Object.create(null) as Record<string, number>;
                const getGlobalAvail = (res: string) => {
                    if (globalAvailCache[res] !== undefined) return globalAvailCache[res];
                    let total = 0;
                    for (const room of productionRooms) {
                        total += getResAmountCached(room, res);
                        total += ((room.factory?.store as any)?.[res] || 0);
                    }
                    globalAvailCache[res] = total;
                    return total;
                };

                const availableMask =
                    (getGlobalAvail(RESOURCE_METAL) > 0 ? 1 : 0) |
                    (getGlobalAvail(RESOURCE_BIOMASS) > 0 ? 2 : 0) |
                    (getGlobalAvail(RESOURCE_SILICON) > 0 ? 4 : 0) |
                    (getGlobalAvail(RESOURCE_MIST) > 0 ? 8 : 0);

                const maxLevel = RESOURCE_PRODUCTION.factory.chain.maxLevel;
                const candidatesByLevel = Object.create(null) as Record<number, string[]>;
                const managedFactoryKeys = new Set<string>();
                for (const product of Object.keys(COMMODITIES as any)) {
                    const info = (COMMODITIES as any)[product];
                    const level = Number(info?.level ?? 0);
                    if (level < 0 || level > maxLevel) continue;
                    const tags = classify(product);
                    if (!tags.colored) continue;
                    if (RESOURCE_PRODUCTION.factory.chain.excludeWhite && tags.white) continue;
                    if ((tags.rootsMask & ~availableMask) !== 0) continue;
                    const components = info?.components as Record<string, number> | undefined;
                    if (!components) continue;
                    if (Object.keys(components).some(c => getGlobalAvail(c) <= 0)) continue;
                    managedFactoryKeys.add(product);
                    (candidatesByLevel[level] ||= []).push(product);
                }

                const remaining = Object.create(null) as Record<string, number>;
                const getKeep = (level: number) => (RESOURCE_PRODUCTION.factory.chain.keepByLevel as any)?.[level] ?? 0;
                const getDeficit = (product: string, level: number) => {
                    const key = `${level}:${product}`;
                    if (remaining[key] !== undefined) return remaining[key];
                    const keep = getKeep(level);
                    const def = keep > 0 ? Math.max(0, keep - getGlobalAvail(product)) : 0;
                    remaining[key] = def;
                    return def;
                };

                const buildFactoryPlanList = (level: number) => {
                    const list = (candidatesByLevel[level] || [])
                        .map(p => ({ product: p, def: getDeficit(p, level) }))
                        .filter(x => x.def > 0)
                        .sort((a, b) => (b.def - a.def) || a.product.localeCompare(b.product));
                    return list;
                };

                const planRoomsByLevel = Object.create(null) as Record<number, { room: Room; autoFactoryMap: Record<string, number>; mem: any }[]>;
                for (const room of planFactoryRooms) {
                    if (!room.factory) continue;
                    const mem = getStructData(room.name) as any;
                    if (mem && mem.factory === false) continue;
                    if (mem?.factoryProduct) continue;

                    const effectiveLevel = Number(room.factory.level || mem?.factoryLevel || 0);
                    if (effectiveLevel < 0 || effectiveLevel > maxLevel) continue;
                    if (!candidatesByLevel[effectiveLevel]?.length) continue;

                    const autoFactoryMap = getAutoFactoryData(room.name) as any;
                    if (RESOURCE_PRODUCTION.factory.chain.respectManualAutoData) {
                        const keys = Object.keys(autoFactoryMap);
                        const hasManual = keys.some(k => !managedFactoryKeys.has(k));
                        if (hasManual) continue;
                    }

                    const plannedKeys = Object.keys(autoFactoryMap).filter(k => managedFactoryKeys.has(k));
                    if (plannedKeys.length === 1) {
                        const planned = plannedKeys[0];
                        const plannedLimit = Number(autoFactoryMap[planned] || 0);
                        const plannedLevel = Number((COMMODITIES as any)?.[planned]?.level ?? effectiveLevel);
                        const minBatch = (PRODUCTION_MIN.commodityByLevel as any)?.[plannedLevel] ?? PRODUCTION_MIN.commodityByLevel[0];
                        const remain = plannedLimit - getRoomAvailWithFactory(room, planned);
                        if (remain >= minBatch) continue;
                    }

                    planRoomsByLevel[effectiveLevel] ??= [];
                    planRoomsByLevel[effectiveLevel].push({ room, autoFactoryMap, mem });
                }

                for (const [levelStr, list] of Object.entries(planRoomsByLevel)) {
                    const level = Number(levelStr);
                    if (!Number.isFinite(level)) continue;
                    const planList = buildFactoryPlanList(level);
                    if (!planList.length) continue;
                    let cursor = 0;
                    const pickForRoom = () => {
                        for (let i = 0; i < planList.length; i++) {
                            const idx = (cursor + i) % planList.length;
                            const item = planList[idx];
                            const def = getDeficit(item.product, level);
                            if (def <= 0) continue;
                            cursor = (idx + 1) % planList.length;
                            return { product: item.product, def };
                        }
                        return null;
                    };

                    for (const { room, autoFactoryMap } of list) {
                        const picked = pickForRoom();
                        if (!picked) break;

                        const def = picked.def;
                        const batch = Math.max(0, Math.min(RESOURCE_PRODUCTION.factory.chain.batchPerRoom, def));
                        const minBatch = (PRODUCTION_MIN.commodityByLevel as any)?.[level] ?? PRODUCTION_MIN.commodityByLevel[0];
                        if (batch < minBatch) continue;
                        remaining[`${level}:${picked.product}`] = def - batch;

                        for (const k of Object.keys(autoFactoryMap)) {
                            if (managedFactoryKeys.has(k)) delete autoFactoryMap[k];
                        }
                        autoFactoryMap[picked.product] = getRoomAvailWithFactory(room, picked.product) + batch;

                        const components = (COMMODITIES as any)?.[picked.product]?.components || {};
                        for (const [comp, need] of Object.entries(components)) {
                            noteNeed(room.name, comp, Math.max(Number(need) * 5, 100));
                        }

                        tryLog([
                            `${c('生产计划', LOG_COLORS.theme, true)} ${c('FACTORY', LOG_COLORS.warning, true)} ${c(room.name, LOG_COLORS.theme, true)}`,
                            `${kv('等级', String(level))} | ${kv('产物', resTag(picked.product))} | ${kv('全局缺口', String(def))} | ${kv('本轮批量', String(batch))}`,
                        ]);
                    }
                }
            }

            for (const [roomName, needs] of Object.entries(prodNeeds)) {
                for (const [res, minAmount] of Object.entries(needs)) {
                    ThresholdMap[roomName] ??= {};
                    const cur = ThresholdMap[roomName][res];
                    if (cur) {
                        cur[0] = Math.max(cur[0], minAmount);
                    } else {
                        ThresholdMap[roomName][res] = [minAmount, Infinity];
                    }
                }
            }

            for (const k of Object.keys(ResManageMap)) delete ResManageMap[k];
            const allResources = new Set<string>();
            for (const roomName of Object.keys(ThresholdMap)) {
                for (const res of Object.keys(ThresholdMap[roomName])) allResources.add(res);
            }
            for (const res of allResources) ResManageMap[res] = { source: [], target: [] };
            for (const room of eligibleRooms) {
                const roomThresholds = ThresholdMap[room.name];
                if (!roomThresholds) continue;
                for (const [res, [targetThreshold, sourceThreshold]] of Object.entries(roomThresholds)) {
                    const amount = getResAmountCached(room, res);
                    if (amount > sourceThreshold) {
                        if (room.terminal?.cooldown) continue;
                        ResManageMap[res].source.push(room.name);
                    } else if (amount < targetThreshold) {
                        if (!room.isResourceTransferInSafe()) continue;
                        ResManageMap[res].target.push(room.name);
                    }
                }
            }
        }

        // 处理每种资源的调度
        // costRatioCache: 估算传输成本比例 cost/amount（用 sampleAmount 近似），用于快速过滤高成本目标
        const costRatioCache = Object.create(null) as Record<string, Record<string, number>>;

        const getCostRatio = (sourceRoomName: string, targetRoomName: string) => {
            if (sourceRoomName === targetRoomName) return Infinity;
            if (!costRatioCache[sourceRoomName]) costRatioCache[sourceRoomName] = Object.create(null) as Record<string, number>;
            const cached = costRatioCache[sourceRoomName][targetRoomName];
            if (cached !== undefined) return cached;
            const sampleAmount = 1000;
            const ratio = Game.market.calcTransactionCost(sampleAmount, sourceRoomName, targetRoomName) / sampleAmount;
            costRatioCache[sourceRoomName][targetRoomName] = ratio;
            return ratio;
        }

        const queuedPair = Object.create(null) as Record<string, Record<string, Record<string, number>>>;
        const queuedOut = Object.create(null) as Record<string, Record<string, number>>;
        const queuedIn = Object.create(null) as Record<string, Record<string, number>>;

        const addQueued = (sourceRoomName: string, targetRoomName: string, res: string, amount: number) => {
            // queuedPair：用于限制同一 source->target 同资源的累计排队上限（避免对单目标过量调度）
            // queuedIn/queuedOut：用于把“已排队待发送量”视作已调度，从而在下一轮计算 surplus/deficit 时去重，避免重复下发任务
            if (!queuedPair[sourceRoomName]) queuedPair[sourceRoomName] = Object.create(null) as Record<string, Record<string, number>>;
            if (!queuedPair[sourceRoomName][res]) queuedPair[sourceRoomName][res] = Object.create(null) as Record<string, number>;
            queuedPair[sourceRoomName][res][targetRoomName] = (queuedPair[sourceRoomName][res][targetRoomName] || 0) + amount;

            if (!queuedIn[targetRoomName]) queuedIn[targetRoomName] = Object.create(null) as Record<string, number>;
            queuedIn[targetRoomName][res] = (queuedIn[targetRoomName][res] || 0) + amount;

            if (!queuedOut[sourceRoomName]) queuedOut[sourceRoomName] = Object.create(null) as Record<string, number>;
            if (res === RESOURCE_ENERGY) {
                const ratio = getCostRatio(sourceRoomName, targetRoomName);
                queuedOut[sourceRoomName][res] = (queuedOut[sourceRoomName][res] || 0) + Math.floor(amount * (1 + ratio));
            } else {
                queuedOut[sourceRoomName][res] = (queuedOut[sourceRoomName][res] || 0) + amount;
            }
        }

        const missionPools = getMissionPools() || {};
        for (const sourceRoomName in missionPools) {
            const roomPools = missionPools[sourceRoomName];
            const terminalTasks = roomPools?.terminal;
            if (!Array.isArray(terminalTasks)) continue;
            for (const task of terminalTasks) {
                if (!task || task.type !== 'send') continue;
                const data = task.data as any;
                const targetRoom = data?.targetRoom;
                const resourceType = data?.resourceType;
                const amount = data?.amount;
                if (!targetRoom || !resourceType || typeof amount !== 'number' || amount <= 0) continue;
                addQueued(sourceRoomName, targetRoom, resourceType, amount);
            }
        }

        const setResAmountCached = (roomName: string, res: string, amount: number) => {
            if (!amountCache[roomName]) amountCache[roomName] = Object.create(null) as Record<string, number>;
            amountCache[roomName][res] = amount;
        }

        for (let res in ResManageMap) {
            // Goods：终端单次发送最多 100；其它资源保持原先阈值约束
            const isGoods = Goods.includes(res as any);
            const minSendAmount = isGoods ? 100 : (res == RESOURCE_ENERGY ? 5000 : 1000);
            const maxSendAmount = isGoods ? 100 : Infinity;
            // 调度上限：用于实现“一次性尽量下发完，但不至于某个富余房间排队爆炸”
            const perPairCap = isGoods ? 100 : (res == RESOURCE_ENERGY ? 50000 : 10000);
            const perSourceCap = isGoods ? 100 : (res == RESOURCE_ENERGY ? 100000 : 20000);
            const perSourceMaxPairs = 3;

            const sourceRooms = ResManageMap[res].source
                .map(roomName => Game.rooms[roomName])
                .filter((room: Room) => !!room);

            const targetRooms = ResManageMap[res].target
                .map(roomName => Game.rooms[roomName])
                .filter((room: Room) => !!room);

            if (sourceRooms.length == 0 || targetRooms.length == 0) continue;

            // sources: 以“可供给余量 surplus”排序，优先从最富余的房间开始调度
            const sources = sourceRooms
                .map(room => {
                    const baseAmount = getResAmountCached(room, res);
                    const pending = queuedOut[room.name]?.[res] || 0;
                    const amount = Math.max(0, baseAmount - pending);
                    const thresholds = ThresholdMap[room.name]?.[res];
                    const targetThreshold = thresholds ? thresholds[0] : 0;
                    return { room, amount, surplus: amount - targetThreshold };
                })
                .filter(s => s.surplus > 0 && s.room.terminal && s.room.terminal.cooldown == 0)
                .sort((a, b) => b.surplus - a.surplus);

            // targets: 以“缺口 deficit”排序，优先补最缺的房间；同时受终端剩余容量与供给阈值上限限制
            const targets = targetRooms
                .map(room => {
                    const baseAmount = getResAmountCached(room, res);
                    const pendingIn = queuedIn[room.name]?.[res] || 0;
                    const amount = baseAmount + pendingIn;
                    const thresholds = ThresholdMap[room.name]?.[res];
                    const targetThreshold = thresholds ? thresholds[0] : 0;
                    const sourceThreshold = thresholds ? thresholds[1] : Infinity;
                    const terminalFree = room.terminal.store.getFreeCapacity();
                    const terminalFreeAfter = Math.max(0, terminalFree - pendingIn);
                    const deficit = Math.min(targetThreshold - amount, sourceThreshold - amount, terminalFreeAfter);
                    return { room, amount, deficit };
                })
                .filter(t => t.deficit > 0)
                .sort((a, b) => b.deficit - a.deficit);

            if (sources.length == 0 || targets.length == 0) continue;

            for (const source of sources) {
                let budgetLeft = perSourceCap - (queuedOut[source.room.name]?.[res] || 0);
                if (budgetLeft < minSendAmount) continue;
                let pairsScheduled = 0;

                for (const target of targets) {
                    if (target.room.name === source.room.name) continue;
                    if (target.deficit <= 0) continue;
                    if (source.surplus <= 0) break;
                    if (budgetLeft <= 0) break;
                    if (pairsScheduled >= perSourceMaxPairs) break;

                    // 用固定样本估算 cost/amount，先快速过滤“成本占比过高”的组合
                    const ratio = getCostRatio(source.room.name, target.room.name);
                    if (ratio > 1) continue;

                    const queuedToTarget = queuedPair[source.room.name]?.[res]?.[target.room.name] || 0;
                    const pairLeft = perPairCap - queuedToTarget;
                    if (pairLeft < minSendAmount) continue;

                    let sendAmount = Math.min(source.surplus, target.deficit, budgetLeft, pairLeft);
                    if (maxSendAmount !== Infinity) sendAmount = Math.min(sendAmount, maxSendAmount);
                    if (res == RESOURCE_ENERGY) {
                        // 能量发送会额外消耗 cost，需保证 send + cost 不超过可供给余量
                        sendAmount = Math.min(sendAmount, Math.floor(source.surplus / (1 + ratio)));
                    }
                    sendAmount = Math.floor(sendAmount);
                    if (sendAmount < minSendAmount) continue;

                    // 精确计算该发送量的成本（前面 ratio 只是估算，用于减少 calcTransactionCost 调用次数）
                    const cost = Game.market.calcTransactionCost(sendAmount, source.room.name, target.room.name);
                    if (cost > sendAmount) continue;
                    if (res == RESOURCE_ENERGY && sendAmount + cost > source.surplus) continue;

                    // 不在这里直接 terminal.send：改为下发 send 任务，复用 TerminalWork 执行与成本修正逻辑
                    const desiredTotal = queuedToTarget + sendAmount;
                    const rc = source.room.SendMissionUpsertMax(target.room.name, res as any, desiredTotal, perPairCap);
                    if (rc === OK) {
                        const costRatio = sendAmount > 0 ? cost / sendAmount : 0;
                        tryLog([
                            `${c('资源调度', LOG_COLORS.theme, true)} ${c('成功', LOG_COLORS.good, true)} ${c(source.room.name, LOG_COLORS.theme, true)} ${c('→', LOG_COLORS.neutral)} ${c(target.room.name, LOG_COLORS.theme, true)}`,
                            `${kv('资源', resTag(res))} | ${kv('发送', String(sendAmount))} | ${kv('cost', `${cost} (${fmtPct(costRatio)})`)}`,
                            `${kv('队列', `${queuedToTarget} + ${sendAmount} = ${desiredTotal}/${perPairCap}`)} | ${kv('估算ratio', fmtPct(ratio))}`,
                        ]);
                    } else {
                        const costRatio = sendAmount > 0 ? cost / sendAmount : 0;
                        tryLog([
                            `${c('资源调度', LOG_COLORS.theme, true)} ${c('失败', LOG_COLORS.danger, true)} ${c(source.room.name, LOG_COLORS.theme, true)} ${c('→', LOG_COLORS.neutral)} ${c(target.room.name, LOG_COLORS.theme, true)}`,
                            `${kv('资源', resTag(res))} | ${kv('发送', String(sendAmount))} | ${kv('cost', `${cost} (${fmtPct(costRatio)})`)}`,
                            `${kv('队列', `${queuedToTarget} + ${sendAmount} = ${desiredTotal}/${perPairCap}`)} | ${kv('估算ratio', fmtPct(ratio))} | ${kv('错误码', String(rc))}`,
                        ]);
                        continue;
                    }

                    
                    addQueued(source.room.name, target.room.name, res, sendAmount);
                    pairsScheduled++;

                    // 仅更新本 tick 的“估算状态”，用于后续匹配更准确；真实资源变化由实际发送发生后决定
                    if (res == RESOURCE_ENERGY) {
                        source.surplus -= sendAmount + cost;
                        source.amount -= sendAmount + cost;
                        budgetLeft -= sendAmount + cost;
                    } else {
                        source.surplus -= sendAmount;
                        source.amount -= sendAmount;
                        budgetLeft -= sendAmount;
                    }
                    target.deficit -= sendAmount;
                    target.amount += sendAmount;
                    setResAmountCached(source.room.name, res, source.amount);
                    setResAmountCached(target.room.name, res, target.amount);
                }
            }
        }

        if (suppressed > 0) {
            logRM([`${c('资源调度', LOG_COLORS.theme, true)} ${c('提示', LOG_COLORS.warning, true)} ${kv('本 tick 省略日志', String(suppressed))}`]);
        }
    }
}
