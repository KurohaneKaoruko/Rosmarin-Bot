type MyOrder = Order & { resourceType: ResourceConstant }

type MarketTickCacheState = {
    time: number
    allOrders: Record<string, Order[]>
    ownOrdersReady: boolean
    ownOrdersByKey: Record<string, MyOrder[]>
    myTerminalRooms?: Room[]
}

let tickCache: MarketTickCacheState | undefined

function getOrderKey(type: ORDER_BUY | ORDER_SELL, resourceType: ResourceConstant): string {
    return `${type}:${resourceType}`
}

function getOwnOrderKey(roomName: string, resourceType: ResourceConstant, type: ORDER_BUY | ORDER_SELL): string {
    return `${roomName}:${resourceType}:${type}`
}

function isOrderType(type: string): type is ORDER_BUY | ORDER_SELL {
    return type === ORDER_BUY || type === ORDER_SELL
}

function getCache(): MarketTickCacheState {
    // tick 级缓存：只在当前 tick 内复用，下一 tick 自动重建
    if (!tickCache || tickCache.time !== Game.time) {
        tickCache = {
            time: Game.time,
            allOrders: {},
            ownOrdersReady: false,
            ownOrdersByKey: {},
        }
    }
    return tickCache
}

function buildOwnOrderIndex(cache: MarketTickCacheState): void {
    if (cache.ownOrdersReady) return
    cache.ownOrdersReady = true

    if (!Game.market || !Game.market.orders) return

    // 用 for-in 直接遍历 Game.market.orders，避免 Object.values 分配
    for (const orderId in Game.market.orders) {
        const order = Game.market.orders[orderId]
        if (!order || !order.roomName || !order.resourceType || order.remainingAmount <= 0) continue
        if (!isOrderType(order.type)) continue
        const key = getOwnOrderKey(order.roomName, order.resourceType as ResourceConstant, order.type)
        if (!cache.ownOrdersByKey[key]) {
            cache.ownOrdersByKey[key] = []
        }
        cache.ownOrdersByKey[key].push(order as MyOrder)
    }
}

function getMyTerminalRooms(cache: MarketTickCacheState): Room[] {
    if (cache.myTerminalRooms) return cache.myTerminalRooms

    // 房间列表按 tick 缓存，供能量平衡判断复用
    const rooms: Room[] = []
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName]
        if (!room.controller?.my) continue
        if (!room.terminal || room.terminal.cooldown > 0) continue
        rooms.push(room)
    }
    cache.myTerminalRooms = rooms
    return rooms
}

export function getAllOrdersCached(type: ORDER_BUY | ORDER_SELL, resourceType: ResourceConstant): Order[] {
    if (!Game.market || typeof Game.market.getAllOrders !== 'function') return []

    const cache = getCache()
    const key = getOrderKey(type, resourceType)
    if (!cache.allOrders[key]) {
        cache.allOrders[key] = Game.market.getAllOrders({ type, resourceType }) || []
    }
    return cache.allOrders[key]
}

export function findMyOrderCached(
    roomName: string,
    resourceType: ResourceConstant,
    type: ORDER_BUY | ORDER_SELL,
): MyOrder | null {
    const cache = getCache()
    buildOwnOrderIndex(cache)
    const key = getOwnOrderKey(roomName, resourceType, type)
    return cache.ownOrdersByKey[key]?.[0] || null
}

export function hasEnergySupplierRoomCached(targetRoom: Room, balanceAt: number): boolean {
    const cache = getCache()
    for (const room of getMyTerminalRooms(cache)) {
        if (room.name === targetRoom.name) continue
        if (room.getResAmount(RESOURCE_ENERGY) > balanceAt) return true
    }
    return false
}

export function hasEnergyReceiverRoomCached(sourceRoom: Room, balanceAt: number): boolean {
    const cache = getCache()
    for (const room of getMyTerminalRooms(cache)) {
        if (room.name === sourceRoom.name) continue
        if (room.terminal.store.getFreeCapacity() <= 0) continue
        if (room.getResAmount(RESOURCE_ENERGY) < balanceAt) return true
    }
    return false
}
