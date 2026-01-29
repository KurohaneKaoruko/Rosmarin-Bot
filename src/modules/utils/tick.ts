export const isTickAligned = (mod: number, offset = 0, tick = Game.time) => {
    const normalized = ((offset % mod) + mod) % mod
    return tick % mod === normalized
}

