let cachedWhitelistTick = -1
let cachedWhitelistSet: Set<string> = new Set()

export const getWhitelistSet = (): Set<string> => {
    if (cachedWhitelistTick === Game.time) return cachedWhitelistSet
    cachedWhitelistTick = Game.time
    cachedWhitelistSet = new Set<string>((Memory as any)['whitelist'] || [])
    return cachedWhitelistSet
}

export const inWhitelist = (username?: string): boolean => {
    if (!username) return false
    return getWhitelistSet().has(username)
}
