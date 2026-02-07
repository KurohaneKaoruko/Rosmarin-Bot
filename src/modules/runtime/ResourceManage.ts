import {Goods, RESOURCE_BALANCE} from '@/constant/ResourceConstant'
import { log } from '@/utils';
import { getMissionPools, getResourceManage, getRoomData } from '@/modules/utils/memory';

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

        // 遍历所有房间的设置
        for (const roomName in getRoomData()) {
            const room = Game.rooms[roomName];
            // 仅对满足条件的“己方房间”启用跨房间资源平衡
            if (!room || !room.my || !room.terminal || !room.storage || room.level < 6 || 
                room.terminal.owner.username != room.controller.owner.username ||
                room.storage.owner.username != room.controller.owner.username ||
                room.tower.length < CONTROLLER_STRUCTURES['tower'][room.level]
            ) continue;

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
                    const base = RESOURCE_BALANCE[res];
                    // 不在 RESOURCE_BALANCE 且没有自定义阈值的资源，直接跳过
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
                    ResManageMap[res].target.push(roomName);
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

        let logged = 0;
        let suppressed = 0;
        const LOG_LIMIT = 10;
        const tryLog = (lines: string[]) => {
            if (logged >= LOG_LIMIT) {
                suppressed++;
                return;
            }
            logged++;
            logRM(lines);
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
                    if (ratio > 0.5) continue;

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
                    if (cost > sendAmount / 2) continue;
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
