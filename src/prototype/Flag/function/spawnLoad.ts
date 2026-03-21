export type SpawnMemoryMatcher = (memory: any) => boolean;
export type SpawnLiveMatcher = (creep: Creep) => boolean;

export const matchesFlagSpawnMemory = (
    memory: any,
    flagName: string,
    role: string,
    legacyMatch: SpawnMemoryMatcher
) => {
    if (!memory || memory.role !== role) return false;
    if (memory.spawnFlag) return memory.spawnFlag === flagName;
    return legacyMatch(memory);
};

export const getFlagSpawnLoad = (
    spawnRoom: Room,
    flagName: string,
    role: string,
    legacyMatch: SpawnMemoryMatcher,
    liveMatch?: SpawnLiveMatcher
) => {
    let live = 0;
    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        if (
            matchesFlagSpawnMemory(creep?.memory, flagName, role, legacyMatch) &&
            (!liveMatch || liveMatch(creep))
        ) {
            live++;
        }
    }

    let queued = 0;
    const tasks = spawnRoom.getAllMissionFromPool('spawn') || [];
    for (const task of tasks as any[]) {
        if (matchesFlagSpawnMemory(task?.data?.memory, flagName, role, legacyMatch)) {
            queued++;
        }
    }

    return {
        live,
        queued,
        total: live + queued,
    };
};

export const isActiveAidBuildFlagCreep = (creep: Creep) => {
    if (creep.spawning) return true;
    const ttl = creep.ticksToLive || 0;
    return ttl > Math.max(120, creep.body.length * 3);
};
