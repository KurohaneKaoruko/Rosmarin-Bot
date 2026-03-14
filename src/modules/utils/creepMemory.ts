const LEGACY_SOURCE_ROOM_ROLE_SET = new Set([
    'aid-build',
    'aid-carry',
    'deposit-attack',
    'deposit-harvest',
    'deposit-heal',
    'deposit-ranged',
    'deposit-transfer',
    'logistic',
    'out-2attack',
    'out-2heal',
    'out-attack',
    'out-build',
    'out-car',
    'out-carry',
    'out-defend',
    'out-harvest',
    'out-invader',
    'out-mineral',
    'out-ranged',
    'power-attack',
    'power-carry',
    'power-heal',
    'power-ranged',
]);

export const getCreepSourceRoom = (
    memory?: Pick<CreepMemory, 'home' | 'sourceRoom' | 'homeRoom'> | null
): string | undefined => {
    if (!memory) return undefined;
    if (memory.home) return memory.sourceRoom;
    const role = (memory as CreepMemory).role;
    const canUseLegacyHomeRoom = !!role && LEGACY_SOURCE_ROOM_ROLE_SET.has(role);
    return memory.sourceRoom || (canUseLegacyHomeRoom ? memory.homeRoom : undefined);
};

export const getCreepAssignedRoom = (
    memory?: Pick<CreepMemory, 'home' | 'homeRoom' | 'sourceRoom'> | null
): string | undefined => {
    if (!memory) return undefined;
    return memory.home || memory.homeRoom || memory.sourceRoom;
};
