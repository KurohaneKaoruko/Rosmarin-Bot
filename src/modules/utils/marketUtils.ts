import { getAllOrdersCached } from '@/modules/utils/marketTickCache';
import { AUTO_MARKET_CONFIG } from '@/constant/ResourceConstant';

/**
 * 市场兼容工具。
 * 赛季世界可能关闭订单相关 API，但终端传输成本仍然需要可计算。
 */
const getMarket = () => (Game as any).market as any;

export const hasMarketOrderApi = (): boolean => {
    const market = getMarket();
    return !!market &&
        typeof market.getAllOrders === 'function' &&
        typeof market.createOrder === 'function' &&
        typeof market.deal === 'function';
};

export const hasMarketCredits = (): boolean => {
    const market = getMarket();
    return !!market && typeof market.credits === 'number';
};

export const calcTransactionCostSafe = (amount: number, sourceRoom: string, targetRoom: string): number => {
    if (amount <= 0) return 0;
    const market = getMarket();
    if (market && typeof market.calcTransactionCost === 'function') {
        return market.calcTransactionCost(amount, sourceRoom, targetRoom);
    }
    // 兜底：使用 Screeps 终端传输成本公式估算。
    const distance = Math.max(0, Game.map.getRoomLinearDistance(sourceRoom, targetRoom, true));
    const ratio = 1 - Math.exp(-distance / 30);
    return Math.ceil(amount * ratio);
};

export const getTransactionCostRatio = (sourceRoom: string, targetRoom: string): number => {
    const sampleAmount = AUTO_MARKET_CONFIG.energyPriceCostSampleAmount;
    const cost = calcTransactionCostSafe(sampleAmount, sourceRoom, targetRoom);
    return cost / sampleAmount;
};

export const getEnergyHistoryAvgPrice = (fallback: number = AUTO_MARKET_CONFIG.energyAvgPriceFallback): number => {
    const market = getMarket();
    if (!market || typeof market.getHistory !== 'function') return fallback;
    const avg = market.getHistory(RESOURCE_ENERGY)?.[0]?.avgPrice;
    if (!avg || avg < fallback) return fallback;
    return avg;
};

const isBetterPrice = (a: Order, b: Order, orderType: ORDER_BUY | ORDER_SELL): boolean => {
    if (orderType === ORDER_BUY) return a.price > b.price;
    return a.price < b.price;
};

const pushTopOrder = (
    topOrders: Order[],
    order: Order,
    orderType: ORDER_BUY | ORDER_SELL,
    limit: number,
): void => {
    let insertAt = topOrders.length;
    for (let i = 0; i < topOrders.length; i++) {
        if (isBetterPrice(order, topOrders[i], orderType)) {
            insertAt = i;
            break;
        }
    }

    if (insertAt === topOrders.length) {
        if (topOrders.length < limit) {
            topOrders.push(order);
        }
        return;
    }

    topOrders.splice(insertAt, 0, order);
    if (topOrders.length > limit) {
        topOrders.pop();
    }
};

const pickTopOrdersByRoom = (
    orders: Order[],
    resourceType: ResourceConstant,
    orderType: ORDER_BUY | ORDER_SELL,
    limit: number,
): Order[] => {
    const bestByRoom: Record<string, Order> = {};

    for (const order of orders) {
        if (resourceType === RESOURCE_ENERGY && order.amount < AUTO_MARKET_CONFIG.energyOrderMinAmountForPricing) continue;
        const roomKey = order.roomName || order.id;
        const prev = bestByRoom[roomKey];
        if (!prev || isBetterPrice(order, prev, orderType)) {
            bestByRoom[roomKey] = order;
        }
    }

    const topOrders: Order[] = [];
    for (const roomKey in bestByRoom) {
        pushTopOrder(topOrders, bestByRoom[roomKey], orderType, limit);
    }
    return topOrders;
};

/**
 * 从不同房间的头部订单中估算一个较稳健的挂单价。
 */
export const getOrderPrice = (
    resourceType: ResourceConstant,
    orderType: ORDER_BUY | ORDER_SELL,
): number | null => {
    if (!hasMarketOrderApi()) return null;
    let price: number = AUTO_MARKET_CONFIG.energyAvgPriceFallback;

    // 读取当前 tick 的订单缓存。
    const orders = getAllOrdersCached(orderType, resourceType);
    if (!orders || orders.length === 0) return null;

    const topOrders = pickTopOrdersByRoom(orders, resourceType, orderType, AUTO_MARKET_CONFIG.topOrderRoomLimit);
    if (topOrders.length === 0) return null;

    const avgPrice = topOrders.reduce((sum, order) => sum + order.price, 0) / topOrders.length;
    if (avgPrice === topOrders[0].price) return avgPrice;

    if (orderType === ORDER_BUY) {
        const filtered = topOrders.filter((order) => order.price <= avgPrice * 1.2);
        const maxPrice = topOrders[0].price * 0.995;
        const candidate = filtered[0]?.price ?? topOrders[0].price;
        price = Math.min(candidate, maxPrice);
    } else {
        const filtered = topOrders.filter((order) => order.price >= avgPrice * 0.8);
        const minPrice = topOrders[0].price * 1.005;
        const candidate = filtered[0]?.price ?? topOrders[0].price;
        price = Math.max(candidate, minPrice);
    }

    return price;
};

