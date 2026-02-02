export const parseFlagNumber = (flagName: string, key: string, defaultValue: number): number => {
    const raw = flagName.match(new RegExp(`/${key}-(\\\\d+)`))?.[1]
    return raw ? parseInt(raw) : defaultValue
}

export const parseFlagToken = (flagName: string, key: string): string | undefined => {
    return (flagName.match(new RegExp(`/${key}-(\\\\w+)`))?.[1] as any) || undefined
}

export const parseSpawnRoomName = (flagName: string): string | undefined => {
    return flagName.match(/\/([EW][1-9]+[NS][1-9]+)/)?.[1]
}

export const getSpawnRoomOrRemove = (flag: Flag): Room | undefined => {
    const spawnRoom = parseSpawnRoomName(flag.name)
    const room = spawnRoom ? Game.rooms[spawnRoom] : undefined
    if (!spawnRoom || !room || !room.my) {
        flag.remove()
        return undefined
    }
    return room
}

export const tickThrottle = (flag: Flag, interval: number, key = 'lastTime'): boolean => {
    const mem = flag.memory as any
    if (Game.time - (mem[key] || 0) < interval) return false
    mem[key] = Game.time
    return true
}

