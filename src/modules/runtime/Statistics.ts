/** 统计模块 */
import { RoleData } from '@/constant/CreepConstant';
import { getCreepRoleCountsAll } from '@/modules/utils/creepTickIndex';
import { getAllOrdersCached } from '@/modules/utils/marketTickCache';
import { hasMarketCredits, hasMarketOrderApi } from '@/modules/utils/marketUtils';

// --- Configuration Constants ---
const STAT_INTERVAL = 20;           // 常规统计间隔 (ticks)
const LONG_STAT_INTERVAL = 100;     // 长周期统计间隔 (ticks) - 用于升级速度、市场均价等
const CPU_AVG_WINDOW = 1000;        // CPU 平均值统计窗口 (ticks)
const MARKET_ORDER_LIMIT = 10;      // 市场订单统计数量 (top N)

export const Statistics = {
    end: function() {
        const targets = getStatsTargets();
        if (targets.length <= 0) return;
        if (!Memory.stats) Memory.stats = {}

        updateCPUinfo();       // 统计 CPU 使用量

        if (Game.time % STAT_INTERVAL === 1) {
            updateGclGpl();        // 统计 GCL / GPL 的升级百分比、等级、估计升级时间
            updateRoomStats();     // 房间等级 & 房间能量储备、升级时间估计
            updateCreepCount();    // Creep 数量
            updateCreditInfo();    // credit变动情况
        }

        drawStatsHUD(targets);
    }
}

function updateCPUinfo() {
    const used = Game.cpu.getUsed();
    Memory.stats.cpu = used;   // 统计 CPU 总使用量
    // bucket 当前剩余量
    try { Memory.stats.bucket = Game.cpu.bucket; }
    catch (e) { Memory.stats.bucket = 0; };

    if(!Memory.stats.cpuUsed) Memory.stats.cpuUsed = { total: 0,count: 0 };

    Memory.stats.cpuUsed['total'] += used;
    Memory.stats.cpuUsed['count'] += 1;
    if (Memory.stats.cpuUsed['count'] >= CPU_AVG_WINDOW) {
        let total = Memory.stats.cpuUsed['total'];
        let count = Memory.stats.cpuUsed['count'];
        Memory.stats.AvgCpuUsed = total / count;
        Memory.stats.cpuUsed = { total: 0,count: 0 };
    }

}

function updateGclGpl() {
    // 统计 GCL / GPL 的升级百分比和等级
    Memory.stats.gcl = (Game.gcl.progress / Game.gcl.progressTotal) * 100
    Memory.stats.gclLevel = Game.gcl.level
    Memory.stats.gpl = (Game.gpl.progress / Game.gpl.progressTotal) * 100
    Memory.stats.gplLevel = Game.gpl.level

    // 统计 GCL / GPL 的估计升级时间
    const INTERVAL = 1000
    if (Game.time % INTERVAL !== 1) return;
    const timeDelta = (Date.now() - (Number(Memory.stats.GCLGPLprevTimestamp) || Date.now())) / 1000;    // 时间差
    Memory.stats.GCLGPLprevTimestamp = Date.now();    // 记录当前时间戳

    const gclIncrement = Game.gcl.progress - (Number(Memory.stats.gclProgress) || Game.gcl.progress);    // GCL 的进度增量
    const gclRemaining = Game.gcl.progressTotal - Game.gcl.progress;    // GCL 的剩余进度
    Memory.stats.gclProgress = Game.gcl.progress;   // GCL 的当前进度
    if (gclIncrement > 0) {
        Memory.stats.gclUpTick = ((gclRemaining / gclIncrement) * INTERVAL) || 0;    // GCL 升级所需的tick数
        Memory.stats.gclUpTime = ((gclRemaining / gclIncrement) * timeDelta) || 0;    // GCL 预计升级所需时间
    } else {
        Memory.stats.gclUpTick = 0;
        Memory.stats.gclUpTime = 0;
    }

    const gplIncrement = Game.gpl.progress - (Number(Memory.stats.gplProgress) || Game.gpl.progress);    // GPL 的进度增量
    const gplRemaining = Game.gpl.progressTotal - Game.gpl.progress;    // GPL 的剩余进度
    Memory.stats.gplProgress = Game.gpl.progress;    // GPL 的当前进度
    if (gplIncrement > 0) {
        Memory.stats.gplUpTick = ((gplRemaining / gplIncrement) * INTERVAL) || 0;    // GPL 升级所需的tick数
        Memory.stats.gplUpTime = ((gplRemaining / gplIncrement) * timeDelta) || 0;    // GPL 预计升级所需时间
    } else {
        Memory.stats.gplUpTick = 0;
        Memory.stats.gplUpTime = 0;
    }
}


function updateRoomStats() {
    // 房间等级 & 房间能量储备
    const stats = Memory.stats;
    stats.rclLevel = {};
    stats.rclProgress = {};
    stats.energyHistory = stats.energy || {};
    stats.energy = {};
    stats.energyRise = {};
    stats.SpawnEnergy = {};
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
    Memory.stats.creeps = { ...roleCounts };
    let creepCount = 0;
    for (const role in roleCounts) {
        creepCount += roleCounts[role] || 0;
    }
    Memory.stats.creepCount = creepCount;
}

function updateCreditInfo() {
    if (!hasMarketCredits()) {
        Memory.stats.credit = 0;
        Memory.stats.creditChanges = 0;
        Memory.stats.energyAveragePrice = 0;
        Memory.stats.energyAverageSellPrice = 0;
        return;
    }

    Memory.stats.credit = Game.market.credits;

    if(Game.time % LONG_STAT_INTERVAL !== 1) return;
    const cr = Game.market.credits;
    Memory.stats.creditChanges = cr - (Number(Memory.stats.lastCredit) || cr)
    Memory.stats.lastCredit = cr;

    if (!hasMarketOrderApi()) {
        Memory.stats.energyAveragePrice = 0;
        Memory.stats.energyAverageSellPrice = 0;
        return;
    }

    // 能量前十求购均价
    const orders = getAllOrdersCached(ORDER_BUY, RESOURCE_ENERGY);
    if (!orders || orders.length === 0) {
        Memory.stats.energyAveragePrice = 0;
    } else {
        const topOrders = selectTopOrders(orders, MARKET_ORDER_LIMIT, (a, b) => b.price - a.price);
        const averagePrice = topOrders.length > 0 ? topOrders.reduce((sum, order) => sum + order.price, 0) / topOrders.length : 0;
        Memory.stats.energyAveragePrice = averagePrice;
    }

    // 能量前十出售均价
    const sellOrders = getAllOrdersCached(ORDER_SELL, RESOURCE_ENERGY);
    if (!sellOrders || sellOrders.length === 0) {
        Memory.stats.energyAverageSellPrice = 0;
    } else {
        const topSellOrders = selectTopOrders(sellOrders, MARKET_ORDER_LIMIT, (a, b) => a.price - b.price);
        const averageSellPrice = topSellOrders.length > 0 ? topSellOrders.reduce((sum, order) => sum + order.price, 0) / topSellOrders.length : 0;
        Memory.stats.energyAverageSellPrice = averageSellPrice;
    }
    
}

function getStatsTargets(): string[] {
    const suffix = '/stats';
    const targets = new Set<string>();
    let useAll = false;

    for (const flagName in Game.flags) {
        if (!flagName.endsWith(suffix)) continue;
        const prefix = flagName.slice(0, -suffix.length);
        if (prefix === 'ALL') {
            useAll = true;
            break;
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
    font: '0.65 monospace',
    fontBold: 'bold 0.7 monospace',
    color: '#e6e6e6',
    colorSub: '#aaaaaa',
    colorWarn: '#f0d44e',
    colorErr: '#e65c5c',
    colorGood: '#76e094',
    bg: '#000000',
    bgOpacity: 0.6,
    barBg: '#444444',
    barGcl: '#76e094',
    barGpl: '#6b99e6',
    barRcl: '#f0d44e',
};

function drawStatsHUD(roomNames: string[]) {
    const stats = Memory.stats || {};
    const creepCount = stats.creepCount || 0;
    const roleSummaryLines = getTopRolesSummaryLines(stats.creeps);
    for (const roomName of roomNames) {
        if (!Game.rooms[roomName]) continue;
        renderStatsHUD(Game.rooms[roomName].visual, roomName, stats, creepCount, roleSummaryLines);
    }
}

function renderStatsHUD(
    visual: RoomVisual,
    roomName: string,
    stats: any,
    creepCount: number,
    roleSummaryLines: string[]
) {
    let x = 1;
    let y = 1;
    const width = 14; 
    const lineHeight = 0.8;
    
    const startY = y;
    const padding = 0.4; // Increased padding slightly
    
    // --- Pre-calculate Height ---
    let totalHeight = 0;
    
    // Header (Room+RCL, CPU, QoS/Perf) - 3 rows
    totalHeight += lineHeight * 3;
    
    // GCL & GPL (2 rows + padding)
    totalHeight += 0.8 * 2;
    
    // RCL Progress Bar (Only if < 8)
    const rclLvl = stats.rclLevel?.[roomName];
    if (typeof rclLvl === 'number' && rclLvl < 8) {
        totalHeight += 0.8; 
    }
    // Note: If RCL is 8, it's just in the header, no extra row needed.
    
    // Extra spacing before Economy section
    totalHeight += 0.4;
    
    // Economy & Stats (3 rows: Credits, Energy, Market)
    totalHeight += lineHeight * 3;
    
    // Creeps (1 or 2 rows)
    totalHeight += lineHeight; 
    if (roleSummaryLines.length > 0) {
        totalHeight += lineHeight * roleSummaryLines.length; 
    }
    
    totalHeight += 0.2;

    // Draw Background Rect FIRST
    visual.rect(x - padding, startY - padding, width + padding * 2, totalHeight + padding * 2, {
        fill: STYLE.bg,
        opacity: STYLE.bgOpacity,
        stroke: '#000000',
        strokeWidth: 0.05
    });

    // --- Row 1: Room Name + RCL Status ---
    let title = roomName;
    let rclColor = STYLE.color;
    if (typeof rclLvl === 'number') {
        title += ` RCL ${rclLvl}`;
        if (rclLvl === 8) {
            rclColor = STYLE.barRcl;
        }
    }
    visual.text(title, x, y + 0.2, { align: 'left', font: 'bold 0.8 monospace', color: rclColor });
    y += lineHeight;

    // --- Row 2: CPU & Bucket ---
    const cpu = typeof stats.cpu === 'number' ? stats.cpu : 0;
    const bucket = typeof stats.bucket === 'number' ? stats.bucket : 0;
    const avgCpu = typeof stats.AvgCpuUsed === 'number' ? stats.AvgCpuUsed : 0;

    const cpuColor = cpu > (avgCpu * 1.5) && cpu > 20 ? STYLE.colorWarn : STYLE.color;
    const bucketColor = bucket < 1000 ? STYLE.colorErr : (bucket < 5000 ? STYLE.colorWarn : STYLE.colorGood);
    
    visual.text(`CPU: ${cpu.toFixed(2)}`, x, y + 0.2, { align: 'left', font: STYLE.font, color: cpuColor });
    visual.text(`Avg: ${avgCpu.toFixed(2)}`, x + 7, y + 0.2, { align: 'left', font: STYLE.font, color: STYLE.colorSub });
    y += lineHeight;

    const qosLevel = stats.qos?.level || '-';
    visual.text(`Bkt: ${bucket}`, x, y + 0.2, { align: 'left', font: STYLE.font, color: bucketColor });
    visual.text(`QoS: ${qosLevel}`, x + 7, y + 0.2, { align: 'left', font: STYLE.font, color: STYLE.colorSub });
    y += lineHeight;

    // --- Global Progress: GCL & GPL (Vertical Stack) ---
    const gclLvl = stats.gclLevel || 0;
    const gclPct = stats.gcl || 0;
    const gplLvl = stats.gplLevel || 0;
    const gplPct = stats.gpl || 0;
    const gclEta = typeof stats.gclUpTime === 'number' ? stats.gclUpTime : 0;
    const gplEta = typeof stats.gplUpTime === 'number' ? stats.gplUpTime : 0;
    const gclLabel = gclEta > 0 ? `GCL ${gclLvl} - ${formatSeconds(gclEta)}` : `GCL ${gclLvl}`;
    const gplLabel = gplEta > 0 ? `GPL ${gplLvl} - ${formatSeconds(gplEta)}` : `GPL ${gplLvl}`;

    // Row 3: GCL
    drawProgressBar(visual, x, y, width, 0.5, gclPct / 100, STYLE.barGcl, gclLabel);
    y += 0.8; // Increased padding to prevent overlap with GPL or Credits

    // Row 4: GPL
    drawProgressBar(visual, x, y, width, 0.5, gplPct / 100, STYLE.barGpl, gplLabel);
    y += 0.8; // Increased padding

    // --- Room Progress: RCL (If < 8) ---
    if (typeof rclLvl === 'number' && rclLvl < 8) {
        const rclPct = stats.rclProgress?.[roomName] || 0;
        const upTime = stats.rclUpTime?.[roomName];
        let label = `${(rclPct).toFixed(1)}%`;
        if (upTime > 0) label += ` - ${formatSeconds(upTime)}`;
        
        drawProgressBar(visual, x, y, width, 0.5, rclPct / 100, STYLE.barRcl, label);
        y += 0.8; // Increased padding
    }

    // Extra spacing before Economy section
    y += 0.4;

    // --- Economy & Stats ---
    const credit = stats.credit || 0;
    const creditChange = stats.creditChanges || 0;
    const energy = stats.energy?.[roomName] || 0;
    const energyChange = stats.energyRise?.[roomName] || 0;
    const spawnCap = stats.SpawnEnergy?.[roomName] || 0;

    // Row: Credits
    const crColor = creditChange >= 0 ? STYLE.colorGood : STYLE.colorErr;
    const crStr = `Cr: ${formatK(credit)} (${formatSigned(creditChange)})`;
    visual.text(crStr, x, y + 0.2, { align: 'left', font: STYLE.font, color: STYLE.color });
    y += lineHeight;

    // Row: Room Energy (Swapped to be above Market)
    const eColor = energyChange >= 0 ? STYLE.colorGood : STYLE.colorErr;
    const eStr = `E: ${formatK(energy)} (${formatSigned(energyChange)})`;
    const capStr = `Cap: ${formatK(spawnCap)}`;
    visual.text(`${eStr}  ${capStr}`, x, y + 0.2, { align: 'left', font: STYLE.font, color: STYLE.color });
    y += lineHeight;

    // Row: Market Prices (Moved below Energy)
    const buy = stats.energyAveragePrice?.toFixed(3) || '-';
    const sell = stats.energyAverageSellPrice?.toFixed(3) || '-';
    const mktStr = `Mkt: Buy ${buy} / Sell ${sell}`;
    visual.text(mktStr, x, y + 0.2, { align: 'left', font: STYLE.font, color: STYLE.colorSub });
    y += lineHeight;

    // Row: Creeps
    visual.text(`Creeps: ${creepCount}`, x, y + 0.2, { align: 'left', font: STYLE.font, color: STYLE.color });
    y += lineHeight;
    if (roleSummaryLines.length > 0) {
        for (const line of roleSummaryLines) {
            visual.text(line, x, y + 0.2, { align: 'left', font: '0.6 monospace', color: STYLE.colorSub });
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
