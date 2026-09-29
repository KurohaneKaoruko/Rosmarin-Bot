type RoomTickCacheBucket = {
    tick: number
    values: Record<string, any>
}

function getBucket(room: Room): RoomTickCacheBucket {
    const roomAny = room as any
    if (!roomAny._roomTickCache || roomAny._roomTickCache.tick !== Game.time) {
        roomAny._roomTickCache = {
            tick: Game.time,
            values: {}
        } as RoomTickCacheBucket
    }
    return roomAny._roomTickCache as RoomTickCacheBucket
}

export function getRoomTickCacheValue<T>(room: Room, key: string, builder: () => T): T {
    const bucket = getBucket(room)
    if (!(key in bucket.values)) {
        bucket.values[key] = builder()
    }
    return bucket.values[key] as T
}

