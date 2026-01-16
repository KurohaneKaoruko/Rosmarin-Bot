/**
 * 清理模块
 */
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
    for (let roomName in Memory.MissionPools) {
        if(Memory.RoomControlData[roomName]) continue;
        delete Memory.MissionPools[roomName];
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
}

// 清理订单
function orderClear() {
    const TIME_THRESHOLD = 50000; // 过期时间阈值
    const MAX_ORDERS = 250; // 最大允许订单数
    const TARGET_ORDERS = 50; // 清理到

    const orders = Object.values(Game.market.orders);
    if (orders.length < MAX_ORDERS) return;

    const currentTime = Game.time;
    const completedOrders = orders.filter(order => order.remainingAmount === 0)
        .sort((a, b) => a.created - b.created);

    const ordersToDelete = completedOrders.filter((order, index) =>
        (currentTime - order.created > TIME_THRESHOLD) || (index < orders.length - TARGET_ORDERS)
    ).map(order => order.id);

    if (ordersToDelete.length > 0) {
        ordersToDelete.forEach(orderId => Game.market.cancelOrder(orderId));
        console.log(`已清理 ${ordersToDelete.length} 个已完成的订单`);
    }
}