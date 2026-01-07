import { getPrice, log } from "@/utils"

export default class AutoMarket extends Room {
    // 自动市场交易
    autoMarket() {
        if (Game.time % 50 !== 0) return;
        const autoMaket = Memory['AutoData']['AutoMarketData'][this.name];
        if(!autoMaket) return;
        for(const item of autoMaket) {
            if(item.orderType == 'buy') {
                if (Game.time % 100 !== 0) continue;
                AutoBuy(this.name, item);
            }
            else if(item.orderType == 'sell') {
                if (Game.time % 100 !== 0) continue;
                AutoSell(this.name, item);
            }
            else if(item.orderType == 'dealbuy') {
                AutoDealBuy(this.name, item);
            }
            else if(item.orderType == 'dealsell') {
                AutoDealSell(this.name, item);
            }
        }
    }
}


function AutoBuy(roomName: string, item: any) {
    const amount = item.amount;   // 资源自动购买上限
    const room = Game.rooms[roomName];
    const RES = global.BaseConfig.RESOURCE_ABBREVIATIONS;
    const resourceType = RES[item.resourceType] || item.resourceType;

    // 检查房间资源储备
    const terminal = room.terminal;
    const storage = room.storage;
    if (!terminal) return;

    const terminalAmount = (terminal.store[resourceType] || 0);
    const storageAmount = (room.storage?.store[resourceType] || 0);

    // 资源存量
    let totalAmount = 0;
    if (!storage || !terminal.pos.inRangeTo(storage, 2)) {
        totalAmount = terminalAmount
    } else {
        totalAmount = terminalAmount + storageAmount
    }
    if (totalAmount >= amount) return;

    // 计算需要购买的数量
    const totalBuyAmount = amount - totalAmount;  // 总购买量
    if(totalBuyAmount <= 0) return;

    // 根据资源类型确定单次订单数量
    const orderAmount = (() => {
        if (resourceType !== RESOURCE_ENERGY) return 3000;
        return 50000;
    })()    // 单次订单量   

    // 检查是否已有同类型订单未完成
    const existingOrders = Game.market.orders;
    let existingOrder = null;
    for (const order of Object.values(existingOrders)) {
        if (order.roomName === room.name && 
            order.resourceType === resourceType && 
            order.type === ORDER_BUY &&
            order.remainingAmount > 0
        ) {
            existingOrder = order;
            break;
        }
    }

    // 如果已有同类型订单未完成，则更新价格
    if (existingOrder) {
        const price = getPrice(existingOrder.resourceType, ORDER_BUY);
        if (price === null) return;
        if (price > item.price) return;
        if (price > existingOrder.price + 0.1 || price < existingOrder.price - 0.1) {
            Game.market.changeOrderPrice(existingOrder.id, price);
            return OK;
        }
        return;
    }

    // 创建订单
    const result = global.market.buy({
        roomName: room.name,
        type: resourceType,
        amount: orderAmount,
        maxPrice: item.price
    });

    return result;
}

function AutoSell(roomName: string, item: any) {
    const amount = item.amount;
    const room = Game.rooms[roomName];
    const RES = global.BaseConfig.RESOURCE_ABBREVIATIONS;
    const resourceType = RES[item.resourceType] || item.resourceType;

    // 检查房间资源储备
    const terminal = room.terminal;
    if (!terminal) return;

    const terminalAmount = !item.store || item.store == 'terminal' ?
                            (terminal.store[resourceType] || 0) : 0;
    const storageAmount = room.storage && (!item.store || item.store == 'storage') ?
                            (room.storage.store[resourceType] || 0) : 0;
    const totalAmount = terminalAmount + storageAmount;
    
    if (totalAmount < amount) return;

    // 计算需要出售的数量
    const sellAmount = totalAmount - amount;
    if(sellAmount <= 0) return;

    // 根据资源类型确定单次订单数量
    const orderAmount = resourceType === RESOURCE_ENERGY ? 10000 : 3000;    // 单次订单量
    if(sellAmount < orderAmount) return;    // 如果出售的资源量小于单次订单数量，则不创建订单

    // 检查是否已有同类型订单未完成
    const existingOrders = Game.market.orders;
    let existingOrder = null;
    for (const order of Object.values(existingOrders)) {
        if (order.roomName === room.name && 
            order.resourceType === resourceType && 
            order.type === ORDER_SELL &&
            order.remainingAmount > 0
        ) {
            existingOrder = order;
            break;
        }
    };

    if (existingOrder) {
        const price = getPrice(existingOrder.resourceType, ORDER_SELL);
        if (price === null) return;
        if (price < item.price) return;
        if (price > existingOrder.price + 0.1 || price < existingOrder.price - 1) {
            Game.market.changeOrderPrice(existingOrder.id, price);
        }
        return OK;
    }

    // 创建订单
    const result = global.market.sell({
        roomName: room.name,
        type: resourceType,
        amount: orderAmount,
        minPrice: item.price
    });

    return result;
}

function AutoDealBuy(roomName: string, item: any) {
    const amount = item.amount; // 资源数量, 自动出售阈值
    const price = item.price;   // 限制价格
    const room = Game.rooms[roomName];

    const RES = global.BaseConfig.RESOURCE_ABBREVIATIONS;
    const resourceType = RES[item.resourceType] || item.resourceType;

    // 检查房间资源储备
    const terminal = room.terminal;
    if (!terminal || terminal.cooldown > 0) return;

    const terminalAmount = terminal.store[resourceType] || 0;
    const storageAmount = room.storage ? (room.storage.store[resourceType] || 0) : 0;
    const totalAmount = terminalAmount + storageAmount;
    
    if (totalAmount >= amount) return;

    // 计算需要购买的数量
    const buyAmount = Math.min(amount - totalAmount, terminal.store.getFreeCapacity());  // 总购买量
    if (resourceType == RESOURCE_ENERGY && buyAmount <= 10000) return;

    AutoDeal(room.name, resourceType, buyAmount, ORDER_SELL, 10, price)

}

function AutoDealSell(roomName: string, item: any) {
    const amount = item.amount; // 资源数量, 自动出售阈值
    const price = item.price;   // 限制价格
    const room = Game.rooms[roomName];

    const RES = global.BaseConfig.RESOURCE_ABBREVIATIONS;
    const resourceType = RES[item.resourceType] || item.resourceType;

    // 检查房间资源储备
    const terminal = room.terminal;
    if (!terminal || terminal.cooldown > 0) return;
    const terminalAmount = terminal.store[resourceType] || 0;
    const storageAmount = room.storage?.store[resourceType] || 0;
    const totalAmount = terminalAmount + storageAmount;
    
    if (totalAmount <= amount) return;

    // 计算需要出售的数量
    const sellAmount = Math.min(totalAmount - amount, terminalAmount);

    if (resourceType == RESOURCE_ENERGY && sellAmount <= 5000) return;

    AutoDeal(room.name, resourceType, sellAmount, ORDER_BUY, 10, price);
}


function AutoDeal(roomName: string, res: ResourceConstant, amount: number, orderType: ORDER_BUY | ORDER_SELL, length: number, price: number) {
    const room = Game.rooms[roomName];
    if(!room || !room.terminal) return ERR_NOT_FOUND;

    let orders = Game.market.getAllOrders({type: orderType, resourceType: res});
    if(orders.length === 0) return ERR_NOT_FOUND;

    if (price) {
        orders = orders.filter(order => {
            if (orderType === ORDER_SELL) {
                return order.price <= price;
            } else {
                return order.price >= price;
            }
        })
    }

    // 按照单价排序
    orders.sort((a, b) => {
        if (a.price === b.price) {
            return Game.map.getRoomLinearDistance(roomName, a.roomName) -
                   Game.map.getRoomLinearDistance(roomName, b.roomName)
        }
        if (orderType === ORDER_SELL) {
            return a.price - b.price;
        } else {
            return b.price - a.price;
        }
    });
    

    let ecost = Game.market.getHistory(RESOURCE_ENERGY)[0].avgPrice;
    if (!ecost || ecost < 0.01) ecost = 0.01;

    let bestOrder = null;
    let bestCost = (orderType === ORDER_SELL) ? Infinity : 0;
    let TotalDealAmount = 0;
    let TransferEnergyCost = 0;
    let TotalPrice = 0;
    const maxOrders = Math.min(orders.length, length);
    for (let i = 0; i < maxOrders; i++) {
        const order = orders[i];    // 订单

        let dealAmount = Math.min(amount, order.amount);  // 交易数量
        let transferEnergyCost = Game.market.calcTransactionCost(dealAmount, roomName, order.roomName);  // 交易能量成本
        if (res != RESOURCE_ENERGY && transferEnergyCost > room.terminal.store[RESOURCE_ENERGY]) {
            dealAmount *= room.terminal.store[RESOURCE_ENERGY] / transferEnergyCost;
            dealAmount = Math.floor(dealAmount);
            transferEnergyCost = Game.market.calcTransactionCost(dealAmount, roomName, order.roomName);
        }
        else if (res == RESOURCE_ENERGY && orderType == ORDER_SELL &&
            transferEnergyCost > room.terminal.store[RESOURCE_ENERGY]) {
            dealAmount *= room.terminal.store[RESOURCE_ENERGY] / transferEnergyCost;
            dealAmount = Math.floor(dealAmount);
            transferEnergyCost = Game.market.calcTransactionCost(dealAmount, roomName, order.roomName);
        }
        else if (res == RESOURCE_ENERGY && (dealAmount + transferEnergyCost) > room.terminal.store[RESOURCE_ENERGY]) {
            dealAmount *= room.terminal.store[RESOURCE_ENERGY] / (dealAmount + transferEnergyCost);
            dealAmount = Math.floor(dealAmount);
            transferEnergyCost = Game.market.calcTransactionCost(dealAmount, roomName, order.roomName);
        }

        let totalPrice = dealAmount * order.price;  // 交易金额

        let cost = 0;
        const ENERGY_COST_FACTOR = ecost;
        if(res == RESOURCE_ENERGY) {
            if(orderType === ORDER_SELL) {
                cost = totalPrice / (dealAmount - transferEnergyCost);  // 购买能量：交易金额÷(交易数量-传输消耗)=实际价格
            } else {
                cost = totalPrice / (dealAmount + transferEnergyCost);  // 出售能量：交易金额÷(交易数量+传输消耗)=实际价格
            }
        } else {
            if(orderType === ORDER_SELL) {
                cost = (totalPrice + transferEnergyCost * ENERGY_COST_FACTOR) / dealAmount;  // 购买资源：(交易金额+能量估算成本)÷实际到账数量=实际价格
            } else {
                cost = (totalPrice - transferEnergyCost * ENERGY_COST_FACTOR) / dealAmount;  // 出售资源：(交易金额-能量估算成本)÷实际消耗数量=实际价格
            }
        }

        if ((orderType === ORDER_SELL && cost < bestCost) ||
            (orderType === ORDER_BUY && cost > bestCost)) {
            bestOrder = order;
            bestCost = cost;
            TotalPrice = totalPrice;
            TotalDealAmount = dealAmount;
            TransferEnergyCost = transferEnergyCost;
        }
    }

    if (!bestOrder) return;

    if (orderType == ORDER_SELL && TotalPrice >= Game.market.credits) return;

    if (res == RESOURCE_ENERGY && TotalDealAmount < 5000) {
        return;
    } else if (TotalDealAmount <= 0) {
        return;
    }

    const result = Game.market.deal(bestOrder.id, TotalDealAmount, roomName);

    const action = orderType === ORDER_SELL ? '购买' : '出售';
    const direction = orderType === ORDER_SELL ? '从' : '向';
    const r1 = roomName;
    const r2 = bestOrder.roomName;

    if (result === OK) {
        const amount = TotalDealAmount;
        const price = TotalPrice.toFixed(3);
        const energyCost = TransferEnergyCost.toFixed(3);
        const unitPrice = bestCost.toFixed(3);
        log('AutoMarket', `房间 ${r1} ${direction} ${r2} ${action} ${amount} 单位 ${res} (交易金额：${price}，能量成本：${energyCost}，综合单价：${unitPrice})`);
    } else {
        log('AutoMarket', `房间 ${r1} ${direction} ${r2} ${action} ${res} 失败，错误代码：${result}`);
    }

    return result;
}