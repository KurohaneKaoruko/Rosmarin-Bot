/**
 * 市场兼容工具。
 * 赛季世界可能关闭订单相关 API，但终端传输成本依然需要可计算。
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
    const cost = calcTransactionCostSafe(1000, sourceRoom, targetRoom);
    return cost / 1000;
};

export const getEnergyHistoryAvgPrice = (fallback = 0.01): number => {
    const market = getMarket();
    if (!market || typeof market.getHistory !== 'function') return fallback;
    const avg = market.getHistory(RESOURCE_ENERGY)?.[0]?.avgPrice;
    if (!avg || avg < fallback) return fallback;
    return avg;
};

/**
 * 从不同房间的头部订单中估算一个较稳健的挂单价。
 */
export const getOrderPrice = (
    resourceType: ResourceConstant,
    orderType: ORDER_BUY | ORDER_SELL,
): number | null => {
    if (!hasMarketOrderApi()) return null;
    const market = getMarket();
    let price = 0.01;
    const orders = market.getAllOrders({ type: orderType, resourceType }) as Order[];
    if (!orders || orders.length === 0) return null;

    orders.sort((a, b) => orderType === ORDER_BUY ? b.price - a.price : a.price - b.price);

    const seenRooms = Object.create(null) as Record<string, true>;
    const topOrders = orders.filter((order) => {
        if (resourceType === RESOURCE_ENERGY && order.amount < 10000) return false;
        const roomKey = order.roomName || order.id;
        if (seenRooms[roomKey]) return false;
        seenRooms[roomKey] = true;
        return true;
    }).slice(0, 10);

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
