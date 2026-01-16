import {Goods, RESOURCE_BALANCE} from '@/constant/ResourceConstant'

/** 资源管理模块 */
export const ResourceManage = {
    tick: function () {
        if (Game.time % 50) return;
        const ResManageMem = Memory['ResourceManage'] || {};
        // 记录每种资源对应的供应房间与需求房间
        const ResManageMap = {};
        const ThresholdMap = {};
        // 遍历所有房间的设置
        for (const roomName in Memory['RoomControlData']) {
            const room = Game.rooms[roomName];
            if (!room || !room.my || !room.terminal || !room.storage || room.level < 6 ||
                Game.flags[`${roomName}/NOBALANCE`] || 
                room.terminal.owner.username != room.controller.owner.username ||
                room.storage.owner.username != room.controller.owner.username ||
                room.tower.length < CONTROLLER_STRUCTURES['tower'][room.level]
            ) continue;

            let Ress: string[] = [];

            if (!room.terminal.pos.inRangeTo(room.storage.pos, 2) || Game.flags[`${roomName}/BALANCE_ENERGY`]) {
                Ress = [RESOURCE_ENERGY];
            } else {
                Ress = [...Object.keys(ResManageMem[roomName]||{}), ...Object.keys(RESOURCE_BALANCE)];
                Ress = [...new Set(Ress)];
            }
            
            for (const res of Ress) {
                if (!ResManageMap[res]) ResManageMap[res] = { source: [], target: [] };
                let sourceThreshold: number, targetThreshold: number;
                if (ResManageMem[roomName] && ResManageMem[roomName][res]) {
                    sourceThreshold = ResManageMem[roomName][res][1] ?? Infinity;
                    targetThreshold = ResManageMem[roomName][res][0] ?? 0;
                } else {
                    sourceThreshold = RESOURCE_BALANCE[res][1] ?? Infinity;
                    targetThreshold = RESOURCE_BALANCE[res][0] ?? 0;
                }
                if (!ThresholdMap[roomName]) ThresholdMap[roomName] = {};
                ThresholdMap[roomName][res] = [targetThreshold, sourceThreshold];
                let resAmount = room.getResAmount(res);
                if (resAmount > sourceThreshold) {
                    if (room.terminal.cooldown) continue;
                    ResManageMap[res].source.push(roomName);
                } else if (resAmount < targetThreshold) {
                    ResManageMap[res].target.push(roomName);
                }
            }
        }

        // 处理每种资源的调度
        const sendOK = {}; // 记录本tick已经进行过发送的房间
        for (let res in ResManageMap) {
            const sourceRooms = ResManageMap[res].source.filter((r:any) => !sendOK[r]).map((r:any) => Game.rooms[r]);
            const targetRooms = ResManageMap[res].target.map((r:any) => Game.rooms[r]);
            if (sourceRooms.length == 0 || targetRooms.length == 0) continue;
            // 按资源数量降序排序
            sourceRooms.sort((a: Room, b: Room) => b.getResAmount(res) - a.getResAmount(res));
            // 按资源数量升序排序
            targetRooms.sort((a: Room, b: Room) =>  a.getResAmount(res) - b.getResAmount(res))
            // 多的分给少的
            let i = 0, j = 0;
            while (i < sourceRooms.length) {
                const sourceRoom = sourceRooms[i] as Room;
                const targetRoom = targetRooms[j] as Room;
                const sourceAmount = sourceRoom.getResAmount(res); // 供应房间的资源数量
                const terminalAmount = sourceRoom.terminal.store[res];  // 供应房间的终端资源数量
                if (Goods.includes(res as any)) { if(terminalAmount < 100) {i++; continue;} }
                else if (terminalAmount < 1000) { i++; continue; }
                const targetAmount = targetRoom.getResAmount(res); // 需求房间的资源数量
                const terminalCapacity = targetRoom.terminal.store.getFreeCapacity(); // 需求房间的终端空闲容量
                let sendAmount = Math.min(
                    // 不使供应房间的资源数量低于需求阈值
                    sourceAmount - ThresholdMap[sourceRoom.name][res][0],
                    // 发送数量不超过终端资源数量
                    terminalAmount,
                    // 不超过需求房间的终端容量
                    terminalCapacity,
                    // 不使需求房间的资源数量超过供应阈值
                    ThresholdMap[targetRoom.name][res][1] - targetAmount,
                    // 不使需求房间的资源数量超过需求阈值, 使得资源量刚刚好到达阈值线
                    ThresholdMap[targetRoom.name][res][0] - targetAmount,
                );
                if (Goods.includes(res as any)) sendAmount = Math.min(sendAmount, 100)
                let cost = Game.market.calcTransactionCost(sendAmount, sourceRoom.name, targetRoom.name);
                if (cost > sendAmount / 2) {
                    if (j >= targetRooms.length - 1) { i++; j = 0; }
                    else j++;
                    continue;
                } else if (sendAmount <= 0) {
                    if (j >= targetRooms.length - 1) { i++; j = 0; }
                    else j++;
                    continue;
                }

                if (res == RESOURCE_ENERGY) {
                    sendAmount = (sendAmount / (sendAmount + cost)) * sourceRoom.terminal.store[RESOURCE_ENERGY];
                    sendAmount = Math.floor(sendAmount);
                    cost = Game.market.calcTransactionCost(sendAmount, sourceRoom.name, targetRoom.name);
                } else if(cost > sourceRoom.terminal.store[RESOURCE_ENERGY]) {
                    sendAmount = sendAmount * sourceRoom.terminal.store[RESOURCE_ENERGY] / cost;
                    sendAmount = Math.floor(sendAmount);
                    cost = Game.market.calcTransactionCost(sendAmount, sourceRoom.name, targetRoom.name);
                }

                i++;
                if (Goods.includes(res as any)) { if (sendAmount < 100) continue; }
                else if (res != RESOURCE_ENERGY && sendAmount < 1000) continue;
                else if (res == RESOURCE_ENERGY && sendAmount < 5000) continue;
                
                const result = sourceRoom.terminal.send(res as any, sendAmount, targetRoom.name, '资源自动管理');
                if (result == OK) {
                    global.log(`[资源管理] ${sourceRoom.name} -> ${targetRoom.name}, ${sendAmount} ${res}, cost: ${cost}`);
                    sendOK[sourceRoom.name] = true;
                    j = (j + 1) % targetRooms.length;
                } else {
                    global.log(`[资源管理] ${sourceRoom.name} -> ${targetRoom.name}, ${sendAmount} ${res}, cost: ${cost}, result: ${result}`);
                }
                
            }
        }
    }
}