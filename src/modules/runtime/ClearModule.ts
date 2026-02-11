/**
 * 清理模块
 */
import { clearRoomRelatedMemory } from '@/modules/utils/roomMemory';
import { getMissionPools, getRoomData } from '@/modules/utils/memory';

export const ClearModule = {
    end: () => {
        if(Game.time % 100 == 0) {
            // 全局 Memory 清理
            memoryClear();
            // 清除过期与已完成订单
            orderClear();
        }
        
    },
}

function  memoryClear() {
    // 清理不存在的 creeps 的 memory
    for (let name in Memory.creeps) {
        if (Game.creeps[name]) continue;
        delete Memory.creeps[name];
    }
    // 清理不存在的 powerCreeps 的 memory
    for (let name in Memory.powerCreeps) {
        if (Game.powerCreeps[name]) continue;
        delete Memory.powerCreeps[name];
    }
    // 清理不存在的 flags 的 memory
    for (let name in Memory.flags) {
        if (Game.flags[name]) continue;
        delete Memory.flags[name];
    }
    // 清理无用的任务池memory
    const rooms = getRoomData();
    const pools = getMissionPools();
    for (let roomName in pools) {
        if(rooms[roomName]) continue;
        delete pools[roomName];
    }
    // 清理已失去控制权但仍在控制列表里的房间
    for (const roomName of Object.keys(rooms)) {
        const room = Game.rooms[roomName];
        if (!room) continue;
        if (room.controller?.my) continue;
        clearRoomRelatedMemory(roomName);
        console.log(`[控制列表清理] 房间 ${roomName} 已不属于自己，已清理相关 Memory`);
    }
    // 清理长时间没视野的房间memory
    for (let roomName in Memory.rooms) {
        let room = Game.rooms[roomName];
        let Mem = Memory.rooms[roomName];
        if (room?.my) continue;
        if (room) { // 如果有视野，则重置计数
            if (!Mem['MemoryClearCount']) continue;
            delete Mem['MemoryClearCount'];
            continue;
        }
        Mem['MemoryClearCount'] = (Mem['MemoryClearCount'] || 0) + 1
        if (Mem['MemoryClearCount'] < 10) continue;
        delete Memory.rooms[roomName];
    }
    if (global.CreepNum) {
        for (let roomName in global.CreepNum) {
            if (!Game.rooms[roomName] || !Game.rooms[roomName].my) {
                delete global.CreepNum[roomName];
            }
        }
    }
    if (global.SpawnMissionNum) {
        for (let roomName in global.SpawnMissionNum) {
            if (!Game.rooms[roomName] || !Game.rooms[roomName].my) {
                delete global.SpawnMissionNum[roomName];
            }
        }
    }
}

// 清理订单
function orderClear() {
    const TIME_THRESHOLD = 50000; // 过期时间阈值
    const MAX_ORDERS = 250; // 最大允许订单数
    const TARGET_ORDERS = 50; // 清理到
    const CANCEL_LIMIT = 100;

    const orders = Object.values(Game.market.orders);
    const currentTime = Game.time;

    let needReduce = 0;
    if (orders.length > MAX_ORDERS) {
        needReduce = Math.max(0, orders.length - TARGET_ORDERS);
    }

    const ordersToDelete: string[] = [];
    const selected = new Set<string>();
    let completedCount = 0;
    let expiredCount = 0;
    let reduceCount = 0;

    for (const order of orders) {
        if (ordersToDelete.length >= CANCEL_LIMIT) break;
        if (selected.has(order.id)) continue;

        if (order.remainingAmount !== 0) continue;
        ordersToDelete.push(order.id);
        selected.add(order.id);
        completedCount++;
        if (needReduce > 0) needReduce--;
    }

    for (const order of orders) {
        if (ordersToDelete.length >= CANCEL_LIMIT) break;
        if (selected.has(order.id)) continue;

        const expired = (currentTime - order.created) > TIME_THRESHOLD;
        if (!expired) continue;

        ordersToDelete.push(order.id);
        selected.add(order.id);
        expiredCount++;
        if (needReduce > 0) needReduce--;
    }

    if (needReduce > 0 && ordersToDelete.length < CANCEL_LIMIT) {
        const sortedOrders = orders
            .filter((o) => !selected.has(o.id))
            .sort((a, b) => a.created - b.created);
        for (const order of sortedOrders) {
            if (ordersToDelete.length >= CANCEL_LIMIT) break;
            if (needReduce <= 0) break;

            ordersToDelete.push(order.id);
            selected.add(order.id);
            needReduce--;
            reduceCount++;
        }
    }

    if (ordersToDelete.length <= 0) return;

    for (const orderId of ordersToDelete) {
        Game.market.cancelOrder(orderId);
    }
    console.log(`已清理 ${ordersToDelete.length} 个订单（完成 ${completedCount}，超时 ${expiredCount}，压缩 ${reduceCount}）`);
}
