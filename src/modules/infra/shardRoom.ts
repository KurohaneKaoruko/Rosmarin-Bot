export type ShardRoomSpec = {
    full: string;
    shard?: string;
    roomName: string;
};

export function parseShardRoomName(input: string): ShardRoomSpec {
    const full = String(input || '');
    const idx = full.indexOf('/');
    if (idx <= 0) return { full, roomName: full };
    const shard = full.slice(0, idx);
    const roomName = full.slice(idx + 1);
    return { full, shard, roomName };
}

export function getLocalRoomName(input: string): string {
    return parseShardRoomName(input).roomName;
}

export function isSameShardRoom(input: string): boolean {
    const spec = parseShardRoomName(input);
    return !spec.shard || spec.shard === Game.shard.name;
}
