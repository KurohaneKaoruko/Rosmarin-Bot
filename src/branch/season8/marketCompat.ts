// 赛季服 market 兼容：赛季世界可能关闭订单 API，但 terminal 转账成本在逻辑上仍存在。
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

/** 交易成本：优先走引擎 API，缺失时回退 terminal 距离公式。 */
export const calcTransactionCostSafe = (amount: number, sourceRoom: string, targetRoom: string): number => {
    if (amount <= 0) return 0;
    const market = getMarket();
    if (market && typeof market.calcTransactionCost === 'function') {
        return market.calcTransactionCost(amount, sourceRoom, targetRoom);
    }
    const distance = Math.max(0, Game.map.getRoomLinearDistance(sourceRoom, targetRoom, true));
    const ratio = 1 - Math.exp(-distance / 30);
    return Math.ceil(amount * ratio);
};

export const getTransactionCostRatio = (sourceRoom: string, targetRoom: string): number => {
    const cost = calcTransactionCostSafe(1000, sourceRoom, targetRoom);
    return cost / 1000;
};
