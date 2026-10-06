/**
 * BotMemory 域 accessor 与散键收口的统一出口。
 * 规则：**自建**持久化数据一律存 `Memory.RosmarinBot`（本文件所有 accessor）；
 * 引擎通道（`Memory.rooms`/`creeps`/`flags`…）由引擎语义支配，经 `room.memory` 等原生 API 使用；
 * 不直访 `Memory` 自建根键（守卫检查 [5]）。
 */

// ── BotMemory 根 ──────────────────────────────

/** RosmarinBot 在 `Memory` 下的根节点 key */
export const BOT_MEMORY_KEY = 'RosmarinBot' as const;

/** 获取 Bot 根内存对象；不存在会自动初始化（产生一次写入） */
export function getBotMemory(): BotMemory {
	const root = Memory as any;
	root[BOT_MEMORY_KEY] ??= {};
	return root[BOT_MEMORY_KEY] as BotMemory;
}

// ── 房间配置域：RoomData / LayoutData ──────────

/**
 * 获取房间控制内存（RoomData）。
 * @param roomName 可选；传入则仅返回该房间条目（不创建）。
 * @remarks 禁止通过读取接口隐式创建房间条目；写入用 {@link ensureRoomData}。
 */
export function getRoomData(): BotMemory['RoomData'];
export function getRoomData(roomName: string): RoomControlMemory | undefined;
export function getRoomData(roomName?: string) {
	const mem = getBotMemory();
	mem.RoomData ??= {};
	if (roomName) return mem.RoomData[roomName];
	return mem.RoomData;
}

/** 确保指定房间的 RoomData 条目存在（唯一允许创建的入口） */
export function ensureRoomData(roomName: string): RoomControlMemory {
	const rooms = getRoomData();
	rooms[roomName] ??= {} as any;
	return rooms[roomName] as RoomControlMemory;
}

/**
 * 获取布局内存（LayoutData）。
 * @param roomName 可选；传入则返回并确保指定房间的条目存在。
 */
export function getLayoutData(): BotMemory['LayoutData'];
export function getLayoutData(roomName: string): LayoutMemory;
export function getLayoutData(roomName?: string) {
	const mem = getBotMemory();
	mem.LayoutData ??= {};
	if (roomName) {
		mem.LayoutData[roomName] ??= {} as any;
		return mem.LayoutData[roomName];
	}
	return mem.LayoutData;
}

// ── 任务池域：MissionPools ─────────────────────

/**
 * 获取任务池内存（MissionPools）。
 * @param roomName 可选；传入则返回并确保指定房间的任务池条目存在。
 */
export function getMissionPools(): BotMemory['MissionPools'];
export function getMissionPools(roomName: string): MissionPoolMemory;
export function getMissionPools(roomName?: string) {
	const mem = getBotMemory();
	mem.MissionPools ??= {};
	if (roomName) {
		mem.MissionPools[roomName] ??= {} as any;
		return mem.MissionPools[roomName];
	}
	return mem.MissionPools;
}

// ── 设施配置域：StructData / ResourceManage / NukerData ──

/**
 * 获取建筑控制内存（StructData）。
 * @param roomName 可选；传入则返回并确保指定房间的条目存在。
 */
export function getStructData(): BotMemory['StructData'];
export function getStructData(roomName: string): StructControlMemory;
export function getStructData(roomName?: string) {
	const mem = getBotMemory();
	mem.StructData ??= {};
	if (roomName) {
		mem.StructData[roomName] ??= {} as any;
		return mem.StructData[roomName];
	}
	return mem.StructData;
}

/**
 * 获取资源管理内存（ResourceManage）。
 * @param roomName 可选；传入则返回并确保指定房间的条目存在。
 */
export function getResourceManage(): BotMemory['ResourceManage'];
export function getResourceManage(roomName: string): ResourceManageMemory;
export function getResourceManage(roomName?: string) {
	const mem = getBotMemory();
	mem.ResourceManage ??= {};
	if (roomName) {
		mem.ResourceManage[roomName] ??= {} as any;
		return mem.ResourceManage[roomName];
	}
	return mem.ResourceManage;
}

/**
 * 获取核弹相关内存（NukerData）。
 * @remarks 若不存在会自动初始化默认结构（会产生一次写入）。
 */
export function getNukerData(): BotMemory['NukerData'] {
	const mem = getBotMemory();
	mem.NukerData ??= { landTime: {}, requests: [] } as any;
	mem.NukerData.landTime ??= {};
	mem.NukerData.requests ??= [];
	return mem.NukerData as any;
}

// ── 自动化域：AutoData 四子表 ───────────────────

/** 获取自动化根内存（AutoData）；不存在会自动初始化 */
export function getAutoData(): BotMemory['AutoData'] {
	const mem = getBotMemory();
	mem.AutoData ??= {} as any;
	return mem.AutoData;
}

/**
 * 获取自动市场内存（AutoMarketData）。
 * @param roomName 可选；传入则返回并确保指定房间的任务列表存在。
 */
export function getAutoMarketData(): AutoDataMemory['AutoMarketData'];
export function getAutoMarketData(roomName: string): AutoMarketTask[];
export function getAutoMarketData(roomName?: string) {
	const auto = getAutoData() as any;
	auto.AutoMarketData ??= {};
	if (roomName) {
		auto.AutoMarketData[roomName] ??= [];
		return auto.AutoMarketData[roomName];
	}
	return auto.AutoMarketData;
}

/**
 * 获取自动 Lab 合成内存（AutoLabData）。
 * @param roomName 可选；传入则返回并确保指定房间的条目存在。
 */
export function getAutoLabData(): AutoDataMemory['AutoLabData'];
export function getAutoLabData(roomName: string): AutoDataMemory['AutoLabData'][string];
export function getAutoLabData(roomName?: string) {
	const auto = getAutoData() as any;
	auto.AutoLabData ??= {};
	if (roomName) {
		auto.AutoLabData[roomName] ??= {};
		return auto.AutoLabData[roomName];
	}
	return auto.AutoLabData;
}

/**
 * 获取自动 Factory 生产内存（AutoFactoryData）。
 * @param roomName 可选；传入则返回并确保指定房间的条目存在。
 */
export function getAutoFactoryData(): AutoDataMemory['AutoFactoryData'];
export function getAutoFactoryData(roomName: string): AutoDataMemory['AutoFactoryData'][string];
export function getAutoFactoryData(roomName?: string) {
	const auto = getAutoData() as any;
	auto.AutoFactoryData ??= {};
	if (roomName) {
		auto.AutoFactoryData[roomName] ??= {} as any;
		return auto.AutoFactoryData[roomName];
	}
	return auto.AutoFactoryData;
}

/**
 * 获取自动 PowerSpawn 内存（AutoPowerData）。
 * @param roomName 可选；传入则返回并确保指定房间的条目存在。
 */
export function getAutoPowerData(): AutoDataMemory['AutoPowerData'];
export function getAutoPowerData(roomName: string): AutoDataMemory['AutoPowerData'][string];
export function getAutoPowerData(roomName?: string) {
	const auto = getAutoData() as any;
	auto.AutoPowerData ??= {};
	if (roomName) {
		auto.AutoPowerData[roomName] ??= {} as any;
		return auto.AutoPowerData[roomName];
	}
	return auto.AutoPowerData;
}

// ── 外矿域：OutMineData ────────────────────────

/**
 * 获取外矿内存（OutMineData）。
 * @param roomName 可选；传入则返回并确保指定房间的条目存在。
 */
export function getOutMineData(): BotMemory['OutMineData'];
export function getOutMineData(roomName: string): OutMineMemory;
export function getOutMineData(roomName?: string) {
	const mem = getBotMemory();
	mem.OutMineData ??= {};
	if (roomName) {
		mem.OutMineData[roomName] ??= {} as any;
		return mem.OutMineData[roomName];
	}
	return mem.OutMineData;
}

// ── Team 域：TeamData / TeamSpawnQueue ─────────

/**
 * 获取 Team 孵化队列（TeamSpawnQueue）。
 * @param roomName 可选；传入则返回并确保指定房间的队列条目存在。
 */
export function getTeamSpawnQueue(): BotMemory['TeamSpawnQueue'];
export function getTeamSpawnQueue(roomName: string): any;
export function getTeamSpawnQueue(roomName?: string) {
	const mem = getBotMemory();
	mem.TeamSpawnQueue ??= {};
	if (roomName) {
		mem.TeamSpawnQueue[roomName] ??= {} as any;
		return mem.TeamSpawnQueue[roomName];
	}
	return mem.TeamSpawnQueue;
}

/**
 * 获取 Team 数据（TeamData）。
 * @param teamID 可选；传入则仅返回该条目（不创建）；创建走 {@link ensureTeamData}。
 */
export function getTeamData(): BotMemory['TeamData'];
export function getTeamData(teamID: string): any | undefined;
export function getTeamData(teamID?: string) {
	const mem = getBotMemory();
	mem.TeamData ??= {};
	if (teamID) {
		return mem.TeamData[teamID];
	}
	return mem.TeamData;
}

/** 确保指定 teamID 的 TeamData 条目存在（用于创建/写入） */
export function ensureTeamData(teamID: string): any {
	const root = getTeamData();
	root[teamID] ??= {} as any;
	return root[teamID];
}

// ── 散键收口：原 Memory 根级自建键 → RosmarinBot ──
// 迁移为一次性引用搬移；旧键残留由 ClearModule 清理。

const migrateRootKey = (bot: Record<string, any>, key: string): void => {
	if (bot[key] === undefined && (Memory as any)[key] !== undefined) {
		bot[key] = (Memory as any)[key];
	}
};

const getRootSection = <T>(key: string, init: () => T): T => {
	const bot = getBotMemory() as any;
	migrateRootKey(bot, key);
	if (bot[key] === undefined) bot[key] = init();
	return bot[key] as T;
};

/** 统计内存（原 Memory.stats；Statistics/HUD/qos/profiler 经此访问） */
export function getStatsMemory(): StatsMemory {
	return getRootSection('stats', () => ({}) as StatsMemory);
}


/** 心跳（原 Memory.lastinit；createApp 挂载耗时统计） */
export function getHeartbeatTick(): number | undefined {
	const bot = getBotMemory() as any;
	migrateRootKey(bot, 'lastinit');
	return bot.lastinit as number | undefined;
}

export function setHeartbeatTick(tick: number): void {
	(getBotMemory() as any).lastinit = tick;
}

/** 搓像素开关（原 Memory['GenPixel']；控制台开关 + Pixel 读取） */
export function isPixelGenEnabled(): boolean {
	const bot = getBotMemory() as any;
	migrateRootKey(bot, 'GenPixel');
	return bot.GenPixel === true;
}

export function setPixelGenEnabled(on: boolean): void {
	(getBotMemory() as any).GenPixel = on;
}

/** 白名单（原 Memory.whitelist；控制台维护 + whitelist 缓存读取） */
export function getWhitelistIds(): string[] {
	return getRootSection('whitelist', () => [] as string[]);
}

export function setWhitelistIds(ids: string[]): void {
	(getBotMemory() as any).whitelist = ids;
}

/** 战争模式开关（原 Memory.warmode；控制台开关 + 外矿/孵化规则读取） */
export function isWarMode(): boolean {
	const bot = getBotMemory() as any;
	migrateRootKey(bot, 'warmode');
	return bot.warmode === true;
}

export function setWarMode(on: boolean): void {
	(getBotMemory() as any).warmode = on;
}

/** 规则档名（原 Memory['mode']；控制台 set-mode 写入） */
export function getModeName(): string | undefined {
	const bot = getBotMemory() as any;
	migrateRootKey(bot, 'mode');
	return bot.mode as string | undefined;
}

export function setModeName(mode: string): void {
	(getBotMemory() as any).mode = mode;
}

/** 漏斗冷却表（原 Memory.funnelCooldown；FunnelModule 专用） */
export function getFunnelCooldownMap(): Record<string, number> {
	return getRootSection('funnelCooldown', () => ({}) as Record<string, number>);
}

// ── source 采集位记录（外矿孵化离线口径）──────
// 数据在房间记忆通道（room.memory.sourcePosCount，游戏原生 Memory.rooms 持久）

// 采集位可站立判定：与外矿孵化侧口径一致（道路/容器/自有或公共 rampart 不算阻挡）
const isSourceSlotTileStandable = (room: Room, x: number, y: number): boolean => {
    if (x <= 0 || x >= 49 || y <= 0 || y >= 49) return false;
    if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
    const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
    if (structures.some(s => {
        if (s.structureType === STRUCTURE_RAMPART) {
            const r = s as StructureRampart;
            return !(r.my || r.isPublic);
        }
        return s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_CONTAINER;
    })) return false;
    const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y) as ConstructionSite[];
    if (sites.some(site => site.structureType !== STRUCTURE_ROAD &&
        site.structureType !== STRUCTURE_CONTAINER &&
        site.structureType !== STRUCTURE_RAMPART)) return false;
    return true;
};

/**
 * 有视野时记录：房间内每个 source 的可站立采集位数量。
 * 写入该房 room.memory.sourcePosCount，失去视野后仍可离线读取——
 * scout 到访、外矿孵化可见分支都会调用，供「外矿采集工孵化考虑 source 最大工位」使用。
 */
export const recordSourceSlotCounts = (room: Room): void => {
    if (!room.memory.sourcePosCount) room.memory.sourcePosCount = {};
    const sources = (room.source || room.find(FIND_SOURCES) || []) as Source[];
    for (const source of sources) {
        let walkable = 0;
        const pos = source.pos;
        const offsets: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
        for (const [dx, dy] of offsets) {
            if (isSourceSlotTileStandable(room, pos.x + dx, pos.y + dy)) walkable++;
        }
        room.memory.sourcePosCount[source.id] = walkable;
    }
};

/**
 * 无视野时读取 scout 记录的采集位数据。
 * @returns 每个 source 的工位数组；从未记录过返回 null。
 */
export const readRecordedSourceSlotCounts = (roomName: string): number[] | null => {
    const mem = (Memory as any).rooms?.[roomName];
    const rec = mem?.sourcePosCount as { [id: string]: number } | undefined;
    if (!rec) return null;
    const values = Object.values(rec).filter((v): v is number => typeof v === 'number' && v >= 0);
    return values.length > 0 ? values : null;
};

/**
 * 清理单个房间相关的所有分区内存。
 * @remarks 用于房间被移出控制列表或失去控制权后做级联清理。
 */
export function clearRoomRelatedMemory(roomName: string): void {
	if (!roomName) return;

	if (Memory.rooms) delete Memory.rooms[roomName];

	delete getRoomData()[roomName];
	delete getStructData()[roomName];
	delete getLayoutData()[roomName];
	delete getOutMineData()[roomName];
	delete getResourceManage()[roomName];
	delete getMissionPools()[roomName];

	const auto = getAutoData() as any;
	if (auto?.AutoMarketData) delete auto.AutoMarketData[roomName];
	if (auto?.AutoLabData) delete auto.AutoLabData[roomName];
	if (auto?.AutoFactoryData) delete auto.AutoFactoryData[roomName];
	if (auto?.AutoPowerData) delete auto.AutoPowerData[roomName];
}

// ── 任务池归属映射与池内存整形（MissionPools/ClearModule/展示层共用）──

/** 任务类型 → 池归属（新增任务类型必须在此登记） */
export const TASK_TYPE_TO_POOL: Record<MissionTaskType, MissionPoolName> = {
    transport: 'transport',
    manage: 'transport',
    build: 'build',
    repair: 'repair',
    send: 'terminal',
    spawn: 'spawn',
    power: 'mine',
    deposit: 'mine',
    boost: 'boost',
};

export const createEmptyMissionPoolMemory = (): MissionPoolMemory => ({
    transport: [],
    build: [],
    repair: [],
    terminal: [],
    spawn: [],
    mine: [],
    boost: [],
});

/** 池内存整形：按 task.type 归池重建，清掉非法键 */
export const sanitizeMissionPoolMemory = (memory?: MissionPoolMemory | Record<string, Task[]> | null): MissionPoolMemory => {
    const normalized = createEmptyMissionPoolMemory();
    if (!memory || typeof memory !== 'object') return normalized;

    for (const tasks of Object.values(memory)) {
        if (!Array.isArray(tasks)) continue;
        for (const task of tasks) {
            const poolName = TASK_TYPE_TO_POOL[task?.type as MissionTaskType];
            if (!poolName) continue;
            normalized[poolName].push(task);
        }
    }

    for (const key of Object.keys(memory)) {
        delete memory[key];
    }
    Object.assign(memory, normalized);
    return memory as MissionPoolMemory;
};