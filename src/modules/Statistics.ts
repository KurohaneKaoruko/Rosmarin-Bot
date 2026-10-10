/** 统计模块 */
import { getStatsMemory } from '@/modules/shared/memory';
import { MISSION_POOLS } from '@/constant/MissionConstant';
import { ROLES } from '@/constant/CreepConstant';
import { RoleData } from '@/constant/CreepConstant';
import { getCreepRoleCountsAll } from '@/modules/shared/creepTickIndex';
import { getAllOrdersCached, hasMarketCredits, hasMarketOrderApi } from '@/modules/shared/marketUtils';
import { getOutMineData } from '@/modules/shared/memory';
import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';

// --- Configuration Constants ---
const STAT_INTERVAL = 20;           // 常规统计间隔 (ticks)
const LONG_STAT_INTERVAL = 100;     // 长周期统计间隔 (ticks) - 用于升级速度、市场均价等
const CPU_AVG_WINDOW = 1000;        // CPU 平均值统计窗口 (ticks)
const MARKET_ORDER_LIMIT = 10;      // 市场订单统计数量 (top N)
const HUD_INTERVAL_NORMAL = 1;       // HUD 正常刷新间隔
const HUD_INTERVAL_CONSTRAINED = 5;  // HUD 在低桶/节流时的刷新间隔
const HUD_INTERVAL_EMERGENCY = 10;   // HUD 在极低桶/紧急时的刷新间隔
const HUD_MIN_BUCKET = 1200;         // HUD 极低桶阈值
const TARGET_REFRESH_INTERVAL = 5;  // HUD 目标缓存刷新间隔 (ticks)

let cachedStatTargets: string[] = [];
let cachedStatTargetsTick = -1;

export const Statistics = {
    end: function() {
        const targets = getStatsTargetsCached();
        if (targets.length <= 0) return;
        getStatsMemory();

        updateCPUinfo();       // 统计 CPU 使用量

        if (Game.time % STAT_INTERVAL === 1) {
            updateGclGpl();        // 统计 GCL / GPL 的升级百分比、等级、估计升级时间
            updateRoomStats();     // 房间等级 & 房间能量储备、升级时间估计
            updateCreepCount();    // Creep 数量
            updateCreditInfo();    // credit变动情况
        }

        if (shouldDrawStatsHUD()) {
            drawStatsHUD(targets);
        }
    }
}

function updateCPUinfo() {
    const used = Game.cpu.getUsed();
    getStatsMemory().cpu = used;   // 统计 CPU 总使用量
    // bucket 当前剩余量
    try { getStatsMemory().bucket = Game.cpu.bucket; }
    catch (e) { getStatsMemory().bucket = 0; };

    if(!getStatsMemory().cpuUsed) getStatsMemory().cpuUsed = { total: 0,count: 0 };

    getStatsMemory().cpuUsed['total'] += used;
    getStatsMemory().cpuUsed['count'] += 1;
    if (getStatsMemory().cpuUsed['count'] >= CPU_AVG_WINDOW) {
        let total = getStatsMemory().cpuUsed['total'];
        let count = getStatsMemory().cpuUsed['count'];
        getStatsMemory().AvgCpuUsed = total / count;
        getStatsMemory().cpuUsed = { total: 0,count: 0 };
    }

}

function updateGclGpl() {
    // 统计 GCL / GPL 的升级百分比和等级
    getStatsMemory().gcl = (Game.gcl.progress / Game.gcl.progressTotal) * 100
    getStatsMemory().gclLevel = Game.gcl.level
    getStatsMemory().gpl = (Game.gpl.progress / Game.gpl.progressTotal) * 100
    getStatsMemory().gplLevel = Game.gpl.level

    // 统计 GCL / GPL 的估计升级时间
    const INTERVAL = 1000
    if (Game.time % INTERVAL !== 1) return;
    const timeDelta = (Date.now() - (Number(getStatsMemory().GCLGPLprevTimestamp) || Date.now())) / 1000;    // 时间差
    getStatsMemory().GCLGPLprevTimestamp = Date.now();    // 记录当前时间戳

    const gclIncrement = Game.gcl.progress - (Number(getStatsMemory().gclProgress) || Game.gcl.progress);    // GCL 的进度增量
    const gclRemaining = Game.gcl.progressTotal - Game.gcl.progress;    // GCL 的剩余进度
    getStatsMemory().gclProgress = Game.gcl.progress;   // GCL 的当前进度
    if (gclIncrement > 0) {
        getStatsMemory().gclUpTick = ((gclRemaining / gclIncrement) * INTERVAL) || 0;    // GCL 升级所需的tick数
        getStatsMemory().gclUpTime = ((gclRemaining / gclIncrement) * timeDelta) || 0;    // GCL 预计升级所需时间
    } else {
        getStatsMemory().gclUpTick = 0;
        getStatsMemory().gclUpTime = 0;
    }

    const gplIncrement = Game.gpl.progress - (Number(getStatsMemory().gplProgress) || Game.gpl.progress);    // GPL 的进度增量
    const gplRemaining = Game.gpl.progressTotal - Game.gpl.progress;    // GPL 的剩余进度
    getStatsMemory().gplProgress = Game.gpl.progress;    // GPL 的当前进度
    if (gplIncrement > 0) {
        getStatsMemory().gplUpTick = ((gplRemaining / gplIncrement) * INTERVAL) || 0;    // GPL 升级所需的tick数
        getStatsMemory().gplUpTime = ((gplRemaining / gplIncrement) * timeDelta) || 0;    // GPL 预计升级所需时间
    } else {
        getStatsMemory().gplUpTick = 0;
        getStatsMemory().gplUpTime = 0;
    }
}


function updateRoomStats() {
    // 房间等级 & 房间能量储备
    const stats = getStatsMemory();
    stats.rclLevel = {};
    stats.rclProgress = {};
    stats.energyHistory = stats.energy || {};
    stats.energy = {};
    stats.energyRise = {};
    stats.SpawnEnergy = {};
    stats.energyTrend = stats.energyTrend || {};    // 能量趋势（sparkline 用，保留 24 点）
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;
        const controller = room.controller;
        // 等级信息
        stats.rclLevel[roomName] = controller.level;    // 房间等级
        if (controller.level < 8) {
            stats.rclProgress[roomName] = (controller.progress / controller.progressTotal) * 100;    // 房间升级百分比
        } else {
            stats.rclProgress[roomName] = 0;
        }

        // 能量储备
        const storageEnergy = room.storage?.store[RESOURCE_ENERGY] || 0;
        const terminalEnergy = room.terminal?.store[RESOURCE_ENERGY] || 0;
        stats.energy[roomName] = storageEnergy + terminalEnergy;
        stats.energyRise[roomName] = stats.energy[roomName] - stats.energyHistory[roomName] || 0;
        stats.SpawnEnergy[roomName] = room.energyCapacityAvailable;

        const trend = (stats.energyTrend[roomName] = stats.energyTrend[roomName] || []);
        trend.push(stats.energy[roomName]);
        if (trend.length > 24) trend.shift();
    }

    // 房间升级时间估计
    if (Game.time % LONG_STAT_INTERVAL !== 1) return;
    const lastProgress = stats.lastRclProgress || {};
    const timeDelta = (Date.now() - (Number(stats.RoomPrevTimestamp) || Date.now())) / 1000;  // 时间差
    stats.RoomPrevTimestamp = Date.now();
    const myRooms: Room[] = [];
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (room.my && room.level < 8) myRooms.push(room);
    }

    stats.rclUpTime = {};
    stats.rclUpTick = {};

    for (const room of myRooms) {
        const roomName = room.name;
        const controller = room.controller;
    
        const progressIncrement = controller.progress - (lastProgress[roomName] || controller.progress);    // 进度增量
        const progressRemaining = controller.progressTotal - controller.progress;    // 剩余进度
        if (progressIncrement > 0) {
            const timeToUpgrade = progressRemaining / progressIncrement;
            stats.rclUpTime[roomName] = timeToUpgrade * timeDelta;
            stats.rclUpTick[roomName] = timeToUpgrade * LONG_STAT_INTERVAL;
        } else {
            stats.rclUpTime[roomName] = 0;
            stats.rclUpTick[roomName] = 0;
        }
        
        lastProgress[roomName] = controller.progress;
    }

    stats.lastRclProgress = lastProgress;
}


function updateCreepCount() {
    // 统计所有 creep 的数量
    const roleCounts = getCreepRoleCountsAll();
    getStatsMemory().creeps = { ...roleCounts };
    let creepCount = 0;
    for (const role in roleCounts) {
        creepCount += roleCounts[role] || 0;
    }
    getStatsMemory().creepCount = creepCount;
}

function updateCreditInfo() {
    if (!hasMarketCredits()) {
        getStatsMemory().credit = 0;
        getStatsMemory().creditChanges = 0;
        getStatsMemory().energyAveragePrice = 0;
        getStatsMemory().energyAverageSellPrice = 0;
        return;
    }

    getStatsMemory().credit = Game.market.credits;

    if(Game.time % LONG_STAT_INTERVAL !== 1) return;
    const cr = Game.market.credits;
    getStatsMemory().creditChanges = cr - (Number(getStatsMemory().lastCredit) || cr)
    getStatsMemory().lastCredit = cr;

    if (!hasMarketOrderApi()) {
        getStatsMemory().energyAveragePrice = 0;
        getStatsMemory().energyAverageSellPrice = 0;
        return;
    }

    // 能量前十求购均价
    const orders = getAllOrdersCached(ORDER_BUY, RESOURCE_ENERGY);
    if (!orders || orders.length === 0) {
        getStatsMemory().energyAveragePrice = 0;
    } else {
        const topOrders = selectTopOrders(orders, MARKET_ORDER_LIMIT, (a, b) => b.price - a.price);
        const averagePrice = topOrders.length > 0 ? topOrders.reduce((sum, order) => sum + order.price, 0) / topOrders.length : 0;
        getStatsMemory().energyAveragePrice = averagePrice;
    }

    // 能量前十出售均价
    const sellOrders = getAllOrdersCached(ORDER_SELL, RESOURCE_ENERGY);
    if (!sellOrders || sellOrders.length === 0) {
        getStatsMemory().energyAverageSellPrice = 0;
    } else {
        const topSellOrders = selectTopOrders(sellOrders, MARKET_ORDER_LIMIT, (a, b) => a.price - b.price);
        const averageSellPrice = topSellOrders.length > 0 ? topSellOrders.reduce((sum, order) => sum + order.price, 0) / topSellOrders.length : 0;
        getStatsMemory().energyAverageSellPrice = averageSellPrice;
    }
    
}

function getStatsTargetsCached(): string[] {
    if (cachedStatTargetsTick !== -1 && Game.time - cachedStatTargetsTick < TARGET_REFRESH_INTERVAL) {
        return cachedStatTargets;
    }
    cachedStatTargetsTick = Game.time;
    cachedStatTargets = getStatsTargets();
    return cachedStatTargets;
}

function shouldDrawStatsHUD(): boolean {
    return true;
}

function getStatsTargets(): string[] {
    const suffix = '/stats';
    const targets = new Set<string>();
    let useAll = false;

    for (const flagName in Game.flags) {
        // 纯 `stats` 旗帜：可视化旗帜所在房间
        if (flagName === 'stats') {
            const roomName = Game.flags[flagName].pos.roomName;
            if (Game.rooms[roomName]) targets.add(roomName);
            continue;
        }
        if (!flagName.endsWith(suffix)) continue;
        const prefix = flagName.slice(0, -suffix.length);
        if (prefix === 'ALL') {
            useAll = true;
            continue;
        }
        if (prefix) targets.add(prefix);
    }

    if (useAll) {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller?.my) continue;
            targets.add(room.name);
        }
    }

    return [...targets].filter(roomName => !!Game.rooms[roomName]);
}

// --- Visualization Constants & Helpers ---

const STYLE = {
    font: '0.62 monospace',
    fontBig: 'bold 0.9 monospace',
    fontTitle: 'bold 0.82 monospace',
    fontSmall: '0.55 monospace',
    color: '#e6e6e6',
    colorSub: '#9e9e9e',
    colorWarn: '#f0d44e',
    colorErr: '#e65c5c',
    colorGood: '#76e094',
    colorAccent: '#4dd0e1',
    bg: '#0a0a0c',
    bgOpacity: 0.74,
    barBg: '#3a3a3a',
    barGcl: '#76e094',
    barGpl: '#6b99e6',
    barRcl: '#f0d44e',
    sectionLine: '#3a4a55',
    sectionText: '#7fd4e8',
};

function gatherRoomLive(room: Room) {
    // 每 tick 只算一次（同房间多个 HUD 消费共享）；find 结果来自引擎缓存，成本可控
    return getRoomTickCacheValue(room, 'stats_room_live', () => {
        const mem = room.memory as any;
        const sites = room.find(FIND_CONSTRUCTION_SITES);
        const siteCount: Record<string, number> = {};
        for (const s of sites) siteCount[s.structureType] = (siteCount[s.structureType] || 0) + 1;
        const siteSummary = Object.entries(siteCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([t, n]) => `${shortStructName(t as StructureConstant)}×${n}`)
            .join(' ');

        const spawn0 = room.spawn?.[0];
    const spawning = spawn0?.spawning
        ? `${spawn0.spawning.name.replace(/^.*?@(.*?)@.*$/, '$1')} ${spawn0.spawning.remainingTime}/${spawn0.spawning.needTime}`
        : null;

    // 外矿：列表源数 + 在岗采集/搬运（按 targetRoom 归属外矿列表，且只统计本源房派出的）
    const outData = getOutMineData(room.name) as any;
    const outList: string[] = outData?.energy || [];
    let outHarvest = 0;
    let outCarry = 0;
    if (outList.length > 0) {
        for (const name in Game.creeps) {
            const c = Game.creeps[name];
            const role = c.memory?.role;
            if (role !== ROLES.harvester && role !== ROLES.carrier) continue;
            if (c.memory?.sourceRoom !== room.name) continue;
            if (!outList.includes(c.memory?.targetRoom || '')) continue;
            if (role === ROLES.harvester) outHarvest += 1;
            else outCarry += 1;
        }
    }

    const hostiles = room.find(FIND_HOSTILE_CREEPS).filter(c => !c.isWhiteList());
    const controller = room.controller;

    return {
        energyState: mem.energyState || '-',
        ea: room.energyAvailable,
        ecap: room.energyCapacityAvailable,
        queue: room.getAllMissionFromPool ? room.getAllMissionFromPool(MISSION_POOLS.spawn).length : 0,
        spawning,
        siteCount: sites.length,
        siteSummary,
        outSources: outList.length,
        outHarvest,
        outCarry,
        hostiles: hostiles.length,
        ttd: controller ? (controller.ticksToDowngrade || 0) : 0,
        safeMode: controller?.safeMode || 0,
        creepsInRoom: room.find(FIND_MY_CREEPS).length,
        };
    });
}

function shortStructName(t: StructureConstant): string {
    const map: Partial<Record<StructureConstant, string>> = {
        extension: 'ext', container: 'cont', storage: 'stor', spawn: 'spawn',
        road: 'road', tower: 'twr', link: 'link', rampart: 'ramp', constructedWall: 'wall',
        terminal: 'term', lab: 'lab', factory: 'fact', extractor: 'extr',
        powerSpawn: 'pwsp', observer: 'obs', nuker: 'nuker',
    };
    return map[t] || t;
}

const ENERGY_STATE_STYLE: Record<string, { text: string; color: string }> = {
    NORMAL: { text: 'NORMAL', color: '#76e094' },
    SURPLUS: { text: 'SURPLUS', color: '#4dd0e1' },
    LOW: { text: 'LOW', color: '#f0d44e' },
    CRITICAL: { text: 'CRITICAL', color: '#e65c5c' },
};

function drawStatsHUD(roomNames: string[]) {
    const stats = getStatsMemory() || {};
    const creepCount = stats.creepCount || 0;
    const roleSummaryLines = getTopRolesSummaryLines(stats.creeps);
    for (const roomName of roomNames) {
        if (!Game.rooms[roomName]) continue;
        const live = gatherRoomLive(Game.rooms[roomName]);
        renderStatsHUD(Game.rooms[roomName].visual, roomName, stats, creepCount, roleSummaryLines, live);
    }
}

type StatRow = {
    kind: 'text' | 'bar' | 'section' | 'gap' | 'spark' | 'badge' | 'lamp';
    text?: string;
    color?: string;
    font?: string;
    align?: 'left' | 'center' | 'right';
    sub?: { text: string; color?: string };
    pct?: number;
    barColor?: string;
    barLabel?: string;
    gap?: number;
    values?: number[];
    sparkColor?: string;
    badgeColor?: string;
    lampColor?: string;
    accent?: string;
};

function renderStatsHUD(
    visual: RoomVisual,
    roomName: string,
    stats: any,
    creepCount: number,
    roleSummaryLines: string[],
    live: ReturnType<typeof gatherRoomLive>,
) {
    const x = 0.5;
    const width = 17;
    const lineHeight = 0.58;
    const rows: StatRow[] = [];    const cpu = typeof stats.cpu === 'number' ? stats.cpu : 0;
    const avgCpu = typeof stats.AvgCpuUsed === 'number' ? stats.AvgCpuUsed : 0;
    const bucket = typeof stats.bucket === 'number' ? stats.bucket : 0;
    const qosLevel = stats.qos?.level || '-';
    const rclLvl = typeof stats.rclLevel?.[roomName] === 'number' ? stats.rclLevel[roomName] : undefined;
    const gclLvl = stats.gclLevel || 0;
    const gclPct = stats.gcl || 0;
    const gplLvl = stats.gplLevel || 0;
    const gplPct = stats.gpl || 0;
    const gclEta = typeof stats.gclUpTime === 'number' ? stats.gclUpTime : 0;
    const gplEta = typeof stats.gplUpTime === 'number' ? stats.gplUpTime : 0;
    const credit = stats.credit || 0;
    const creditChange = stats.creditChanges || 0;
    const energy = stats.energy?.[roomName] || 0;
    const energyChange = stats.energyRise?.[roomName] || 0;
    const buy = stats.energyAveragePrice?.toFixed(3) || '-';
    const sell = stats.energyAverageSellPrice?.toFixed(3) || '-';

    // ── 标题区：房名 · RCL · 能量状态徽章 ──
    const es = ENERGY_STATE_STYLE[live.energyState] || { text: live.energyState, color: STYLE.colorSub };
    rows.push({
        kind: 'text',
        text: `${roomName}  RCL${rclLvl ?? '?'}`,
        font: STYLE.fontTitle,
        color: rclLvl === 8 ? STYLE.barRcl : STYLE.color,
        sub: { text: es.text, color: '#000000' },
        badgeColor: es.color,
    });

    // ── 性能区 ──
    const cpuColor = cpu > avgCpu * 1.5 && cpu > 20 ? STYLE.colorWarn : STYLE.color;
    const bucketColor = bucket < 1000 ? STYLE.colorErr : bucket < 5000 ? STYLE.colorWarn : STYLE.colorGood;
    rows.push({ kind: 'text', text: `CPU ${cpu.toFixed(2)} (μ${avgCpu.toFixed(2)})`, color: cpuColor, font: STYLE.font, sub: { text: `Bkt ${bucket}`, color: bucketColor } });
    rows.push({ kind: 'text', text: `QoS ${qosLevel}`, color: qosLevel === 'normal' ? STYLE.colorSub : STYLE.colorWarn, font: STYLE.font, sub: { text: `Creeps ${live.creepsInRoom}`, color: STYLE.colorSub } });

    // ── 全局进度条 ──
    rows.push({ kind: 'bar', pct: gclPct / 100, barColor: STYLE.barGcl, barLabel: `GCL${gclLvl} ${gclEta > 0 ? '· ' + formatSeconds(gclEta) : ''}` });
    if (gplLvl > 0 || gplPct > 0) rows.push({ kind: 'bar', pct: gplPct / 100, barColor: STYLE.barGpl, barLabel: `GPL${gplLvl}` });

    // ── 本房 RCL 进度 ──
    if (typeof rclLvl === 'number' && rclLvl < 8) {
        const rclPct = stats.rclProgress?.[roomName] || 0;
        const upTime = stats.rclUpTime?.[roomName];
        let label = `${rclPct.toFixed(1)}%`;
        if (upTime > 0) label += ` · ${formatSeconds(upTime)}`;
        rows.push({ kind: 'bar', pct: rclPct / 100, barColor: STYLE.barRcl, barLabel: `RCL${rclLvl + 1} ${label}` });
    }

    // ── 经济区 ──
    rows.push({ kind: 'section', text: 'ECONOMY', accent: '#f0d44e' });
    const eColor = energyChange >= 0 ? STYLE.colorGood : STYLE.colorErr;
    rows.push({ kind: 'text', text: `E ${formatK(energy)} (${formatSigned(energyChange)}/cyc)  Cap ${formatK(live.ecap)}`, color: eColor, font: STYLE.font });
    rows.push({ kind: 'spark', values: stats.energyTrend?.[roomName] || [], sparkColor: '#4dd0e1' });
    rows.push({ kind: 'text', text: `Cr ${formatK(credit)} (${formatSigned(creditChange)})  Mkt ${buy}/${sell}`, color: STYLE.colorSub, font: STYLE.font });

    // ── 孵化 / 建造区 ──
    rows.push({ kind: 'section', text: 'SPAWN & BUILD', accent: '#4dd0e1' });
    const eaPct = live.ecap > 0 ? live.ea / live.ecap : 0;
    const eaColor = eaPct < 0.2 ? STYLE.colorErr : eaPct < 0.5 ? STYLE.colorWarn : STYLE.colorGood;
    rows.push({ kind: 'bar', pct: eaPct, barColor: eaColor, barLabel: `Ea ${live.ea}/${live.ecap}` });
    rows.push({
        kind: 'text',
        text: `Queue ${live.queue}${live.spawning ? ` · ⚙ ${live.spawning}` : ''}`,
        color: live.queue >= 6 ? STYLE.colorWarn : STYLE.colorSub,
        font: STYLE.font,
    });
    if (live.siteCount > 0) rows.push({ kind: 'text', text: `Sites ${live.siteCount}: ${live.siteSummary}`, color: STYLE.colorSub, font: STYLE.font });

    // ── 外矿区 ──
    if (live.outSources > 0) {
        rows.push({ kind: 'section', text: 'OUTMINE', accent: '#76e094' });
        rows.push({
            kind: 'text',
            text: `${live.outSources}源 · 采 ${live.outHarvest} · 搬 ${live.outCarry}`,
            color: live.outHarvest === 0 ? STYLE.colorWarn : STYLE.color,
            font: STYLE.font,
            sub: { text: live.outHarvest === 0 ? '断档' : '在岗', color: '#000000' },
            badgeColor: live.outHarvest === 0 ? STYLE.colorErr : STYLE.colorGood,
        });
    }

    // ── 威胁 / 控制器健康 ──
    const ttdColor = live.ttd < 5000 ? STYLE.colorErr : live.ttd < 20000 ? STYLE.colorWarn : STYLE.colorSub;
    const threatBits: string[] = [];
    if (live.hostiles > 0) threatBits.push(`敌 ${live.hostiles}`);
    if (live.safeMode > 0) threatBits.push(`SM ${live.safeMode}`);
    threatBits.push(`TTD ${formatK(live.ttd)}`);
    rows.push({ kind: 'section', text: 'STATUS', accent: '#e65c5c' });
    rows.push({ kind: 'text', text: threatBits.join('  '), color: live.hostiles > 0 ? STYLE.colorErr : ttdColor, font: STYLE.font });

    // ── 角色摘要 ──
    if (roleSummaryLines.length > 0) {
        for (const line of roleSummaryLines) {
            rows.push({ kind: 'text', text: line, color: STYLE.colorSub, font: STYLE.fontSmall });
        }
    }

    // ── 两遍法渲染：量高 → 背景板 → 逐行 ──
    const padding = 0.32;
    const y0 = 0.55;
    let height = padding * 2;
    for (const row of rows) {
        if (row.kind === 'section') height += 0.5;
        else if (row.kind === 'bar') height += 0.56;
        else if (row.kind === 'spark') height += 0.5;
        else if (row.kind === 'gap') height += (row.gap ?? 0.25);
        else height += lineHeight;
    }

    visual.rect(x - padding, y0 - padding, width + padding * 2, height, {
        fill: STYLE.bg,
        opacity: STYLE.bgOpacity,
        stroke: '#1e2a30',
        strokeWidth: 0.06,
    });

    let y = y0;
    for (const row of rows) {
        if (row.kind === 'section') {
            y += 0.24;
            // 分区底板 + 左侧 accent 色条
            visual.rect(x, y, width, 0.3, { fill: row.accent || STYLE.sectionText, opacity: 0.08 });
            visual.rect(x, y, 0.12, 0.3, { fill: row.accent || STYLE.sectionText, opacity: 0.95 });
            visual.text(row.text || '', x + 0.3, y + 0.26, { align: 'left', font: `bold ${STYLE.fontSmall}`, color: STYLE.sectionText });
            y += 0.42;
        } else if (row.kind === 'bar') {
            drawProgressBar(visual, x, y, width, 0.48, row.pct ?? 0, row.barColor || STYLE.barRcl, row.barLabel);
            y += 0.56;
        } else if (row.kind === 'spark') {
            const values = (row.values || []).filter((v) => Number.isFinite(v));
            const max = Math.max(...values, 0);
            if (values.length >= 2 && max > 0) {
                const slot = (width - 0.4) / values.length;
                const baseY = y + 0.62;
                for (let i = 0; i < values.length; i += 1) {
                    const hRatio = Math.min(1, values[i] / max);
                    const h = 0.08 + hRatio * 0.42;
                    visual.rect(x + 0.2 + i * slot, baseY - h, Math.max(0.12, slot - 0.08), h, {
                        fill: row.sparkColor || STYLE.colorAccent,
                        opacity: 0.75,
                    });
                }
                visual.line(x + 0.1, baseY, x + width - 0.2, baseY, { color: '#333333', width: 0.04 });
                y += 0.78;
            } else {
                y += 0.3;
            }
        } else if (row.kind === 'badge') {
            // 保留占位：徽章已在标题行以 sub+badgeColor 渲染
        } else if (row.kind === 'gap') {
            y += row.gap ?? 0.25;
        } else {
            visual.text(row.text || '', x, y + 0.25, { align: row.align || 'left', font: row.font || STYLE.font, color: row.color || STYLE.color });
            if (row.sub) {
                // 右侧副文本：徽章型（badgeColor 底色块）或纯文本
                const isBadge = row.badgeColor !== undefined;
                const w = Math.max(1.2, row.sub.text.length * 0.5 + 0.5);
                const bx = x + width - w;
                if (isBadge) {
                    visual.rect(bx, y - 0.06, w, 0.52, { fill: row.badgeColor, opacity: 0.92 });
                    visual.text(row.sub.text, bx + w / 2, y + 0.3, { align: 'center', font: `bold ${STYLE.fontSmall}`, color: '#000000' });
                } else {
                    visual.text(row.sub.text, x + width, y + 0.25, { align: 'right', font: STYLE.font, color: row.sub.color || STYLE.colorSub });
                }
            }
            y += lineHeight;
        }
    }
}

function drawProgressBar(visual: RoomVisual, x: number, y: number, w: number, h: number, pct: number, color: string, label?: string) {
    // Background
    visual.rect(x, y, w, h, { fill: STYLE.barBg, opacity: 0.8 });
    // Bar
    const barW = Math.max(0, Math.min(1, pct)) * w;
    if (barW > 0) {
        visual.rect(x, y, barW, h, { fill: color, opacity: 0.9 });
    }
    // Label
    if (label) {
        visual.text(label, x + w / 2, y + h / 2 + 0.1, {
            align: 'center',
            color: '#ffffff',
            font: 'bold 0.5 monospace',
            stroke: '#000000',
            strokeWidth: 0.15,
            opacity: 1
        });
    }
}

function getTopRolesSummaryLines(creepsByRole: any): string[] {
    if (!creepsByRole) return [];
    
    // Aggregate by abbreviation
    const aggregated: Record<string, number> = {};
    for (const [role, count] of Object.entries(creepsByRole)) {
        if (typeof count !== 'number') continue;
        const code = RoleData[role]?.code || role;
        aggregated[code] = (aggregated[code] || 0) + count;
    }
    
    const entries = Object.entries(aggregated);
    if (entries.length <= 0) return [];
    
    // Sort by count descending
    entries.sort((a, b) => b[1] - a[1]);
    
    const tokens = entries.map(([code, count]) => `${code}:${count}`);
    const lines: string[] = [];
    for (let i = 0; i < tokens.length; i += 8) {
        lines.push(tokens.slice(i, i + 8).join(' '));
    }
    return lines;
}

function formatSigned(n: number): string {
    if (!Number.isFinite(n)) return '0';
    return n >= 0 ? `+${Math.floor(n)}` : `${Math.floor(n)}`;
}

function formatK(n: number): string {
    if (!Number.isFinite(n)) return '0';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';

    const units: Array<{ value: number; suffix: string }> = [
        { value: 1e12, suffix: 'T' },
        { value: 1e9, suffix: 'B' },
        { value: 1e6, suffix: 'M' },
        { value: 1e3, suffix: 'K' },
    ];

    const formatMax3 = (value: number) => {
        const s = value.toFixed(3);
        return s.replace(/\.?0+$/, '');
    };

    for (const u of units) {
        if (abs >= u.value) return `${sign}${formatMax3(abs / u.value)}${u.suffix}`;
    }
    return `${sign}${formatMax3(abs)}`;
}

function formatSeconds(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
    const total = Math.floor(seconds);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    if (h > 0) return `${h}h${m}m`;
    if (m > 0) return `${m}m${s}s`;
    return `${s}s`;
}

function selectTopOrders<T>(items: T[], limit: number, compare: (a: T, b: T) => number): T[] {
    if (!items || items.length <= 0) return [];
    const result: T[] = [];
    for (const item of items) {
        if (result.length <= 0) {
            result.push(item);
            continue;
        }

        let inserted = false;
        for (let i = 0; i < result.length; i++) {
            if (compare(item, result[i]) < 0) {
                result.splice(i, 0, item);
                inserted = true;
                break;
            }
        }
        if (!inserted) result.push(item);

        if (result.length > limit) result.length = limit;
    }
    return result;
}
