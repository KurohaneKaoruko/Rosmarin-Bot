import {Goods, RESOURCE_BALANCE} from '@/constant/ResourceConstant'

/** 资源管理模块 */
export const ResourceManage = {
    tick: function () {
        // 降低全局资源平衡的 CPU 占用：固定间隔执行
        if (Game.time % 50) return;
        const ResManageMem = Memory['ResourceManage'] || {};
        // 全局默认参与平衡的资源类型（可被 Memory.ResourceManage 的房间自定义条目扩展）
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
        for (const roomName in Memory['RoomControlData']) {
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
                    // Memory.ResourceManage 配置优先级高于全局 RESOURCE_BALANCE
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
        // sendOK: 限制每 tick 每个供应房间最多安排一次跨房间发送（避免任务堆积/CPU 抖动）
        const sendOK = Object.create(null) as Record<string, boolean>;
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

        const setResAmountCached = (roomName: string, res: string, amount: number) => {
            if (!amountCache[roomName]) amountCache[roomName] = Object.create(null) as Record<string, number>;
            amountCache[roomName][res] = amount;
        }

        for (let res in ResManageMap) {
            // Goods：终端单次发送最多 100；其它资源保持原先阈值约束
            const isGoods = Goods.includes(res as any);
            const minSendAmount = isGoods ? 100 : (res == RESOURCE_ENERGY ? 5000 : 1000);
            const maxSendAmount = isGoods ? 100 : Infinity;

            const sourceRooms = ResManageMap[res].source
                .filter(roomName => !sendOK[roomName])
                .map(roomName => Game.rooms[roomName])
                .filter((room: Room) => !!room);

            const targetRooms = ResManageMap[res].target
                .map(roomName => Game.rooms[roomName])
                .filter((room: Room) => !!room);

            if (sourceRooms.length == 0 || targetRooms.length == 0) continue;

            // sources: 以“可供给余量 surplus”排序，优先从最富余的房间开始调度
            const sources = sourceRooms
                .map(room => {
                    const amount = getResAmountCached(room, res);
                    const thresholds = ThresholdMap[room.name]?.[res];
                    const targetThreshold = thresholds ? thresholds[0] : 0;
                    return { room, amount, surplus: amount - targetThreshold };
                })
                .filter(s => s.surplus > 0 && s.room.terminal && s.room.terminal.cooldown == 0)
                .sort((a, b) => b.surplus - a.surplus);

            // targets: 以“缺口 deficit”排序，优先补最缺的房间；同时受终端剩余容量与供给阈值上限限制
            const targets = targetRooms
                .map(room => {
                    const amount = getResAmountCached(room, res);
                    const thresholds = ThresholdMap[room.name]?.[res];
                    const targetThreshold = thresholds ? thresholds[0] : 0;
                    const sourceThreshold = thresholds ? thresholds[1] : Infinity;
                    const terminalFree = room.terminal.store.getFreeCapacity();
                    const deficit = Math.min(targetThreshold - amount, sourceThreshold - amount, terminalFree);
                    return { room, amount, deficit };
                })
                .filter(t => t.deficit > 0)
                .sort((a, b) => b.deficit - a.deficit);

            if (sources.length == 0 || targets.length == 0) continue;

            for (const source of sources) {
                if (sendOK[source.room.name]) continue;
                let scheduled = false;

                for (const target of targets) {
                    if (target.room.name === source.room.name) continue;
                    if (target.deficit <= 0) continue;
                    if (source.surplus <= 0) break;

                    // 用固定样本估算 cost/amount，先快速过滤“成本占比过高”的组合
                    const ratio = getCostRatio(source.room.name, target.room.name);
                    if (ratio > 0.5) continue;

                    let sendAmount = Math.min(source.surplus, target.deficit);
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
                    const ok = source.room.SendMissionAdd(target.room.name, res as any, sendAmount);
                    if (!ok) {
                        global.log(`[资源管理] ${source.room.name} -> ${target.room.name}, ${sendAmount} ${res}, cost: ${cost}, result: failed`);
                        continue;
                    }

                    global.log(`[资源管理] ${source.room.name} -> ${target.room.name}, ${sendAmount} ${res}, cost: ${cost}`);
                    sendOK[source.room.name] = true;
                    scheduled = true;

                    // 仅更新本 tick 的“估算状态”，用于后续匹配更准确；真实资源变化由实际发送发生后决定
                    if (res == RESOURCE_ENERGY) source.surplus -= sendAmount + cost;
                    else source.surplus -= sendAmount;
                    target.deficit -= sendAmount;
                    if (res == RESOURCE_ENERGY) source.amount -= sendAmount + cost;
                    else source.amount -= sendAmount;
                    target.amount += sendAmount;
                    setResAmountCached(source.room.name, res, source.amount);
                    setResAmountCached(target.room.name, res, target.amount);
                    break;
                }

                if (scheduled) continue;
            }
        }
    }
}
