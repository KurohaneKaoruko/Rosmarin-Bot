/**
 * RosmarinBot 在 Screeps `Memory` 下的根节点 key。
 * @remarks 本项目所有持久化数据统一存放在 `Memory.RosmarinBot`。
 */
export const BOT_MEMORY_KEY = 'RosmarinBot' as const;

/**
 * 获取 Bot 的根内存对象 `Memory.RosmarinBot`。
 * @remarks 若不存在会自动初始化为空对象（会产生一次写入）。
 */
export function getBotMemory(): BotMemory {
	const root = Memory as any;
	root[BOT_MEMORY_KEY] ??= {};
	return root[BOT_MEMORY_KEY] as BotMemory;
}

/**
 * 获取房间控制内存（RoomData）。
 * @param roomName 可选；传入则仅返回该房间条目（不创建）。
 * @remarks
 * - RoomData 同时承担“房间是否受控”的判定：`getRoomData()[roomName]` 是否存在。\n
 * - 因此 **禁止** 通过读取接口隐式创建房间条目。\n
 * - 若需要把房间加入控制列表，请使用 {@link ensureRoomData}。
 */
export function getRoomData(): BotMemory['RoomData'];
export function getRoomData(roomName: string): RoomControlMemory | undefined;
export function getRoomData(roomName?: string) {
	const mem = getBotMemory();
	mem.RoomData ??= {};
	if (roomName) return mem.RoomData[roomName];
	return mem.RoomData;
}

/**
 * 确保指定房间的 RoomData 条目存在（用于“加入控制列表”）。
 * @remarks 这是唯一允许创建 `RoomData[roomName]` 的入口。
 */
export function ensureRoomData(roomName: string): RoomControlMemory {
	const rooms = getRoomData();
	rooms[roomName] ??= {} as any;
	return rooms[roomName] as RoomControlMemory;
}

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

/**
 * 获取自动化根内存（AutoData）。
 * @remarks 若不存在会自动初始化为空对象（会产生一次写入）。
 */
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
		auto.AutoFactoryData[roomName] ??= {};
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
		auto.AutoPowerData[roomName] ??= {};
		return auto.AutoPowerData[roomName];
	}
	return auto.AutoPowerData;
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
 * @param teamID 可选；实际为 TeamID key；传入则仅返回该条目（不创建）。
 * @remarks TeamData 的 key=teamID，不能在读取时隐式创建空条目；创建必须显式走 {@link ensureTeamData}。
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

/**
 * 确保指定 teamID 的 TeamData 条目存在（用于创建/写入）。
 */
export function ensureTeamData(teamID: string): any {
	const root = getTeamData();
	root[teamID] ??= {} as any;
	return root[teamID];
}
