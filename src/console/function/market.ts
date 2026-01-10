import {getPrice} from "@/utils"

export default {
    market: {
        // 市场交易
        deal(orderId: string, maxAmount: number=1000, roomName?: string) {
            const order = Game.market.getOrderById(orderId);
            if (!order) return Error(`订单ID无效：${orderId}`);
            let totalAmount = Math.min(maxAmount, order.amount);
            const rooms = roomName ? [Game.rooms[roomName]] : Object.values(Game.rooms);
            if (order.type == ORDER_SELL){
                if (!order.roomName) {
                    let amount = Math.min(totalAmount, Game.resources[order.resourceType]);
                    if (amount <= 0) return Error(`资源不足：${order.resourceType}`);
                    const result = Game.market.deal(orderId, amount);
                    if (result !== OK) return Error(`交易失败：${result}`);
                    console.log(`成功交易了${amount}单位的${order.resourceType}`);
                    return result;
                }
                for (const room of rooms) {
                    if (!room.terminal || room.terminal.cooldown > 0) continue;
                    let amount = Math.min(totalAmount, room.terminal.store.getFreeCapacity());
                    const cost = Game.market.calcTransactionCost(amount, room.name, order.roomName);
                    if (room.terminal.store[RESOURCE_ENERGY] < cost) {
                        amount = Math.floor(amount * room.terminal.store[RESOURCE_ENERGY] / cost);
                    }
                    if (amount <= 0) continue;
                    const result = Game.market.deal(orderId, amount, room.name);
                    if (result !== OK) {
                        console.log(`房间 ${room.name} 交易失败：${result}`);
                        continue;
                    }
                    totalAmount -= amount;
                    console.log(`房间 ${room.name} 购买了 ${amount} 单位的 ${order.resourceType}, 传输成本${Game.market.calcTransactionCost(amount, room.name, order.roomName)}`);
                    if (totalAmount <= 0) break;
                }
                totalAmount = Math.min(maxAmount, order.amount) - totalAmount;
                console.log(`总共成功交易了${totalAmount}, 订单剩余${order.amount-totalAmount}`);
                return OK;
            } else if (order.type == ORDER_BUY){
                if (!order.roomName) {
                    let amount = Math.min(totalAmount, Math.floor(Game.market.credits / order.price));
                    if (amount <= 0) return Error(`资源不足：${order.resourceType}`);
                    const result = Game.market.deal(orderId, amount);
                    if (result !== OK) return Error(`交易失败：${result}`);
                    console.log(`成功交易了${amount}单位的${order.resourceType}`);
                    return result;
                }
                for (const room of rooms) {
                    if (!room.terminal || room.terminal.cooldown !== 0) continue;
                    let amount = Math.min(totalAmount, room.terminal.store[order.resourceType]);
                    const cost = Game.market.calcTransactionCost(amount, room.name, order.roomName);
                    if (room.terminal.store[RESOURCE_ENERGY] < cost) {
                        amount = Math.floor(amount * room.terminal.store[RESOURCE_ENERGY] / cost);
                    }
                    if (amount <= 0) continue;
                    const result = Game.market.deal(orderId, amount, room.name);
                    if (result !== OK) continue;
                    totalAmount -= amount;
                    console.log(`房间 ${room.name} 出售了 ${amount} 单位的 ${order.resourceType}`);
                    if (totalAmount <= 0) break;
                }
                totalAmount = Math.min(maxAmount, order.amount) - totalAmount;
                console.log(`总共成功交易了${totalAmount}, 订单剩余${order.amount-totalAmount}`);
                return OK;
            }
            return OK;
        },
        look(resType: string, orderType: string, roomName?: string, length=20) {
            resType = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS[resType] || resType;
            let orders = Game.market.getAllOrders({type: orderType, resourceType: resType as ResourceConstant});
            // 按照单价排序
            orders.sort((a, b) => {
                if (orderType === ORDER_SELL) {
                    return a.price - b.price;  // 对于购买订单，按照价格从低到高排序
                } else {
                    return b.price - a.price;  // 对于出售订单，按照价格从高到低排序
                }
            });
            let bestOrder = null;        // 最优订单
            let bestPrice = (orderType === ORDER_SELL) ? Infinity : 0;
            let bestDealAmount = 0;    // 最优订单的交易数量
            let bestTransferCost = 0; // 最优订单的传输能量成本
            let bestDealCredit = 0;    // 最优订单的交易金额
            if (INTERSHARD_RESOURCES.includes(resType as InterShardResourceConstant)) {
                bestOrder = orders[0];
                if (!bestOrder) {
                    console.log(`无法找到合适的${orderType === ORDER_SELL ? '出售' : '求购'}的 ${resType} 订单`);
                    return;
                }
                else {
                    bestPrice = bestOrder.price;
                    bestDealAmount = bestOrder.amount;
                    bestDealCredit = bestDealAmount * bestPrice;
                    console.log(`找到合适的${orderType === ORDER_SELL ? '出售' : '求购'}的 ${resType} 订单：${bestOrder.id} 
                        交易数量：${bestDealAmount} 交易总金额：${bestDealCredit.toFixed(4)} 单价：${bestOrder.price}
                        订单余量：${bestOrder.amount}`);
                }
            } else {
                let ENERGY_COST = Game.market.getHistory(RESOURCE_ENERGY)[0].avgPrice;
                for (let i = 0; i < Math.min(orders.length, length); i++) {
                    const order = orders[i];
                    const dealAmount = order.amount;
                    const transferEnergyCost = Game.market.calcTransactionCost(dealAmount, roomName, order.roomName);
                    const dealCredit = dealAmount * order.price;
                    let price = 0;  // 综合单价
                    if(resType === RESOURCE_ENERGY) {
                        if(orderType === ORDER_SELL) {
                            // 购买能量：交易金额 ÷ (交易数量 - 传输消耗) = 实际综合单价
                            price = dealCredit / (dealAmount - transferEnergyCost);
                        } else {
                            // 出售能量：交易金额 ÷ (交易数量 + 传输消耗) = 实际综合单价
                            price = dealCredit / (dealAmount + transferEnergyCost);
                        }
                    } else {
                        if(orderType === ORDER_SELL) {
                            // 购买资源：(交易金额 + 能量估算成本) ÷ 实际到账数量 = 实际综合单价
                            price = (dealCredit + transferEnergyCost * ENERGY_COST) / dealAmount;  
                        } else {
                            // 出售资源：(交易金额 - 能量估算成本) ÷ 实际消耗数量 = 实际综合单价
                            price = (dealCredit - transferEnergyCost * ENERGY_COST) / dealAmount;
                        }
                    }
                    if ((orderType === ORDER_SELL && price < bestPrice) ||
                        (orderType === ORDER_BUY && price > bestPrice)) {
                        bestOrder = order;
                        bestPrice = price;
                        bestDealCredit = dealCredit;
                        bestDealAmount = dealAmount;
                        bestTransferCost = transferEnergyCost;
                    }
                    console.log(`订单：${order.id} 交易数量：${dealAmount} 交易金额：${dealCredit.toFixed(4)} ` +
                            `交易能量成本：${transferEnergyCost} 单价：${order.price} 综合单价：${price.toFixed(4)} ` +
                            `订单余量：${order.amount} 目标房间：${order.roomName}`);
                }
                if (!bestOrder) {
                    console.log(`房间 ${roomName} 无法找到合适的${orderType === ORDER_SELL ? '出售' : '求购'} ${resType} 订单`);
                    return;
                }
                else {
                    console.log(`房间 ${roomName} 找到合适的${orderType === ORDER_SELL ? '出售' : '求购'} ${resType} 订单：${bestOrder.id} 
                        交易数量：${bestDealAmount} 交易总金额：${bestDealCredit.toFixed(4)} 单价：${bestOrder.price}
                        目标房间：${bestOrder.roomName} 能量成本：${bestTransferCost} 综合单价：${bestPrice.toFixed(4)}
                        订单余量：${bestOrder.amount}`);
                }
            }
            return OK;
        },
        buy(data: { roomName: any; type: any; amount: any; price: any; maxPrice: any; }) {
            let {roomName, type, amount, price, maxPrice} = data;

            // 如果没有提供价格，获取市场订单并设置最优价格
            if (!price) {
                price = getPrice(type, ORDER_BUY);
            }
            if (price === null) return Error(`获取价格失败：${type}`);

            if (maxPrice && price > maxPrice) {
                price = maxPrice;
            }

            // 创建购买订单
            const result = Game.market.createOrder({
                type: ORDER_BUY,
                resourceType: type,
                price: price,
                totalAmount: amount,
                roomName: roomName
            });

            return result;
        },
        sell(data: { roomName: any; type: any; amount: any; price: any; minPrice: any; }) {
            let {roomName, type, amount, price, minPrice} = data;

            // 如果没有提供价格，获取市场订单并设置最优价格
            if (!price) {
                price = getPrice(type, ORDER_SELL);
            }
            if (price === null) return Error(`获取价格失败：${type}`);

            if (minPrice && price < minPrice) {
                price = minPrice;
            }

            // 创建销售订单
            const result = Game.market.createOrder({
                type: ORDER_SELL,
                resourceType: type,
                price: price,
                totalAmount: amount,
                roomName: roomName
            });

            return result;
        },
        dealBuy(roomName: any, type: any, amount: any, length=20, price=0) {
            type = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS[type] || type;
            if (INTERSHARD_RESOURCES.includes(type)) {
                return interShardMarket(type, amount, 'buy', price);
            }
            return handleMarketTransaction(roomName, type, amount, ORDER_SELL, length, price);
        },
        dealSell(roomName: any, type: any, amount: any, length=20, price=0) {
            type = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS[type] || type;
            if (INTERSHARD_RESOURCES.includes(type)) {
                return interShardMarket(type, amount, 'sell', price);
            }
            return handleMarketTransaction(roomName, type, amount, ORDER_BUY, length, price);
        },
        // 自动市场交易
        auto: {
            list(roomName: string) {
                if(roomName) {
                    const autoMarket = Memory['AutoData']['AutoMarketData'][roomName];
                    if(!autoMarket || autoMarket.length == 0) {
                        console.log(`房间 ${roomName} 没有开启自动交易`);
                    }
                    else {
                        console.log(`房间 ${roomName} 的自动交易列表：`);
                    }
                    for(const item of autoMarket) {
                        console.log(` - ${item.resourceType}，触发阈值${item.amount}，订单类型${item.orderType}`);
                    }
                    return OK;
                }
    
                const autoMarket = Memory['AutoData']['AutoMarketData']
                if(!autoMarket || Object.keys(autoMarket).length == 0) {
                    console.log(`没有房间开启自动交易`);
                }
                for(const room in autoMarket) {
                    if(!autoMarket[room] || autoMarket[room].length == 0) {
                        continue;
                    }
                    console.log(`房间 ${room} 的自动交易列表：`);
                    for(const item of autoMarket[room]) {
                        console.log(` - ${item.resourceType}，触发阈值${item.amount}，订单类型${item.orderType}`);
                    }
                }
                return OK;
            },
            remove(roomName: string, resourceType: string, orderType: string) {
                if(!Memory['AutoData']['AutoMarketData'][roomName]) {
                    console.log(`房间 ${roomName} 没有开启自动交易`);
                    return OK;
                }
                const autoMarket = Memory['AutoData']['AutoMarketData'][roomName];
                const index = autoMarket.findIndex((item: any) => item.resourceType === resourceType && item.orderType === orderType);
                if(index === -1) {
                    console.log(`房间 ${roomName} 没有开启自动交易：${orderType} - ${resourceType}`);
                    return OK;
                }
                autoMarket.splice(index, 1);
                console.log(`已关闭房间 ${roomName} 自动交易：${orderType} - ${resourceType}`);
                return OK;
            },
            buy(roomName: any, type: 'create'|'deal', resourceType: any, amount: any, price?: number) {
                if(!Memory['AutoData']['AutoMarketData'][roomName]) {
                    Memory['AutoData']['AutoMarketData'][roomName] = [];
                }
                const autoMarket = Memory['AutoData']['AutoMarketData'][roomName];
                if (type === 'create') {
                    const autoOrder = autoMarket.find((item: any) => item.resourceType === resourceType && item.orderType === 'buy');
                    if(!autoOrder) {
                        const item = {resourceType, amount, orderType: 'buy' as const, price};
                        autoMarket.push(item);
                        console.log(`已在房间 ${roomName} 开启自动求购${resourceType}, 购买阈值${amount}, 价格限制:${price ?? '无'}`);
                    } else {
                        autoOrder['amount'] = amount;
                        autoOrder['price'] = price;
                        console.log(`房间 ${roomName} 已存在自动求购${resourceType}, 已修改为: 购买阈值:${amount} 价格限制:${price ?? '无'}`);
                    }
                } else if (type === 'deal') {
                    const autoOrder = autoMarket.find((item: any) => item.resourceType === resourceType && item.orderType === 'dealbuy');
                    if(!autoOrder) {
                        const item = {resourceType, amount, orderType: 'dealbuy' as const, price};
                        autoMarket.push(item);
                        console.log(`已在房间 ${roomName} 开启自动Deal买 ${resourceType}，购买阈值${amount}, 价格限制:${price}`);
                    } else {
                        autoOrder['amount'] = amount;
                        autoOrder['price'] = price;
                        console.log(`房间 ${roomName} 已存在自动Deal买 ${resourceType}，已修改为: 购买阈值:${amount} 价格限制:${price ?? '无'}`);
                    }
                }
                return OK;
            },
            sell(roomName: any, type: 'create'|'deal', resourceType: any, amount: any, price?: number) {
                if(!Memory['AutoData']['AutoMarketData'][roomName]) {
                    Memory['AutoData']['AutoMarketData'][roomName] = [];
                }
                const autoMarket = Memory['AutoData']['AutoMarketData'][roomName];
                if (type === 'create') {
                    const autoOrder = autoMarket.find((item: any) => item.resourceType === resourceType && item.orderType === 'sell')
                    if(!autoOrder) {
                        autoMarket.push({resourceType, amount, orderType: 'sell' as const, price});
                        console.log(`已在房间 ${roomName} 开启自动出售${resourceType}，出售阈值${amount}`);
                    } else {
                        autoOrder['amount'] = amount;
                        autoOrder['price'] = price;
                        console.log(`房间 ${roomName} 已存在自动出售${resourceType}, 已修改为: 购买阈值${amount}`);
                    }
                } else if (type === 'deal') {
                    const autoMarket = Memory['AutoData']['AutoMarketData'][roomName];
                    if(!autoMarket.find((item: any) => item.resourceType === resourceType && item.orderType === 'dealsell')) {
                        autoMarket.push({resourceType, amount, orderType: 'dealsell' as const, price});
                        console.log(`已在房间 ${roomName} 开启自动Deal卖${resourceType}，出售阈值:${amount}, 价格限制:${price ?? '无限制'}`);
                    } else {
                        const index = autoMarket.findIndex((item: any) => item.resourceType === resourceType && item.orderType === 'dealsell');
                        autoMarket[index]['amount'] = amount;
                        autoMarket[index]['price'] = price;
                        console.log(`房间 ${roomName} 已存在自动Deal卖${resourceType}，已修改为: 出售阈值:${amount} 价格限制:${price ?? '无限制'}`);
                    }
                } else {
                    return '未设置交易类型'
                }
                
                return OK;
            },
        },
    }
}

function handleMarketTransaction(roomName: string, type: any, amount: number, orderType: string, length: number, price: number) {
    const room = Game.rooms[roomName];
    if(!room || !room.terminal) {
        console.log(`房间 ${roomName} 没有终端，无法进行交易`);
        return ERR_NOT_FOUND;
    }
    
    let orders = Game.market.getAllOrders({type: orderType, resourceType: type});
    if (price > 0) {
        orders = orders.filter((order: any) => {
            if (orderType === ORDER_SELL) {
                return order.price <= price;
            } else {
                return order.price >= price;
            }
        });
    }
    // 按照单价排序
    orders.sort((a, b) => {
        if (orderType === ORDER_SELL) {
            return a.price - b.price;  // 对于购买订单，按照价格从低到高排序
        } else {
            return b.price - a.price;  // 对于出售订单，按照价格从高到低排序
        }
    });

    let eCost = Game.market.getHistory(RESOURCE_ENERGY)[0].avgPrice;

    let bestOrder = null;        // 最优订单
    let bestPrice = (orderType === ORDER_SELL) ? Infinity : 0;
    let bestDealAmount = 0;    // 最优订单的交易数量
    let bestTransferCost = 0; // 最优订单的传输能量成本
    let bestDealCredit = 0;    // 最优订单的交易金额
    const maxOrders = Math.min(orders.length, length);
    for (let i = 0; i < maxOrders; i++) {
        // 订单对象
        const order = orders[i];
        // 交易数量
        const dealAmount = Math.min(amount, order.amount);
        // 传输成本
        const transferEnergyCost = Game.market.calcTransactionCost(dealAmount, roomName, order.roomName);
        // 交易金额
        const dealCredit = dealAmount * order.price;
        // 能量估算单价
        const ENERGY_COST = eCost;

        let price = 0;  // 综合单价
        if(type === RESOURCE_ENERGY) {
            if(orderType === ORDER_SELL) {
                // 购买能量：交易金额 ÷ (交易数量 - 传输消耗) = 实际综合单价
                price = dealCredit / (dealAmount - transferEnergyCost);
            } else {
                // 出售能量：交易金额 ÷ (交易数量 + 传输消耗) = 实际综合单价
                price = dealCredit / (dealAmount + transferEnergyCost);
            }
        } else {
            if(orderType === ORDER_SELL) {
                // 购买资源：(交易金额 + 能量估算成本) ÷ 实际到账数量 = 实际综合单价
                price = (dealCredit + transferEnergyCost * ENERGY_COST) / dealAmount;  
            } else {
                // 出售资源：(交易金额 - 能量估算成本) ÷ 实际消耗数量 = 实际综合单价
                price = (dealCredit - transferEnergyCost * ENERGY_COST) / dealAmount;
            }
        }

        if ((orderType === ORDER_SELL && price < bestPrice) ||
            (orderType === ORDER_BUY && price > bestPrice)) {
            bestOrder = order;
            bestPrice = price;
            bestDealCredit = dealCredit;
            bestDealAmount = dealAmount;
            bestTransferCost = transferEnergyCost;
        }

        console.log(`订单：${order.id} 交易数量：${dealAmount} 交易金额：${dealCredit.toFixed(4)}` +
                `交易能量成本：${transferEnergyCost} 单价：${order.price} 综合单价：${price.toFixed(4)}` +
                `订单余量：${order.amount} 目标房间：${order.roomName}`);
    }

    if (!bestOrder) {
        console.log(`房间 ${roomName} 无法找到合适的${orderType === ORDER_SELL ? '出售' : '求购'} ${type} 订单`);
        return;
    }
    else {
        console.log(`房间 ${roomName} 找到合适的${orderType === ORDER_SELL ? '出售' : '求购'} ${type} 订单：${bestOrder.id} 
            交易数量：${bestDealAmount} 交易总金额：${bestDealCredit.toFixed(4)} 单价：${bestOrder.price}
            目标房间：${bestOrder.roomName} 能量成本：${bestTransferCost} 综合单价：${bestPrice.toFixed(4)}
            订单余量：${bestOrder.amount}`);
    }

    const order = bestOrder;
    const dealAmount = bestDealAmount;
    const transferEnergyCost = bestTransferCost;
    const dealCredit = bestDealCredit;
    const id = order.id;
    const result = Game.market.deal(id, dealAmount, roomName);

    if (result === OK) {
        console.log(`房间 ${roomName} 成功${orderType === ORDER_SELL ? '从' : '向'} ${order.roomName} ${orderType === ORDER_SELL ? '购买' : '出售'} ${dealAmount} 单位的 ${type}。`);
        console.log(`交易金额：${dealCredit}`);
        console.log(`能量成本：${transferEnergyCost}`);
        console.log(`综合单价：${bestPrice}`);
    } else {
        console.log(`房间 ${roomName} ${orderType === ORDER_SELL ? '从' : '向'} ${order.roomName} ${orderType === ORDER_SELL ? '购买' : '出售'} ${type} 失败，错误代码：${result}`);
    }
    return result;
}

// 特殊资源市场交易
function interShardMarket(type: any, amount: number, order: string, price: number) {
    const orderType = order == 'buy' ? ORDER_SELL : ORDER_BUY;
    let orders = Game.market.getAllOrders({type: orderType, resourceType: type});
    if (price > 0) {
        orders = orders.filter((order: any) => {
            if (orderType === ORDER_SELL) {
                return order.price <= price;
            } else {
                return order.price >= price;
            }
        });
    }

    let bestOrder = null;
    let bestDealAmount = 0;
    let bestPrice = 0;

    const maxOrders = Math.min(orders.length, 50);
    for(let i = 0; i < maxOrders; i++){
        const order = orders[i];
        console.log(`订单：${order.id} 单价${order.price} 订单余量：${order.amount}`);
        
        if (!bestOrder || (orderType === ORDER_SELL && order.price < bestPrice) ||
            (orderType === ORDER_BUY && order.price > bestPrice)){
            bestOrder = order;
            bestDealAmount = Math.min(amount, order.amount);
            bestPrice = order.price;
        }
    }

    if (!bestOrder) {
        console.log(`没有找到合适的${orderType === ORDER_SELL ? '出售': '求购'} ${type} 订单`);
        return ERR_NOT_FOUND;
    }
    console.log(`找到合适的${orderType === ORDER_SELL ? '出售': '求购'} ${type} 订单：${bestOrder.id} 单价${bestPrice} 订单余量：${bestDealAmount}`);

    const result = Game.market.deal(bestOrder.id, bestDealAmount);
    if(result === OK){
        console.log(`成功${orderType === ORDER_SELL ? '购买': '出售'} ${bestDealAmount} 单位的 ${type}，单价${bestPrice}`);
        console.log(`交易金额：${bestDealAmount * bestPrice}`);
    }
    else{
        console.log(`${orderType === ORDER_SELL ? '购买': '出售'} ${type} 失败，错误代码：${result}`);
    }
    return result;
}