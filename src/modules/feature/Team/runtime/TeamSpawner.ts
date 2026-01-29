import { log } from "@/utils";
import { compressBodyConfig } from "@/modules/utils/compress";
import { TEAM_CONFIG } from "../config/TeamConfig";

export default class TeamSpawner {
    /**
     * Team 孵化队列的 Memory Key（按房间分桶）。
     *
     * @remarks
     * 结构示意：\n
     * `Memory[TeamSpawnQueue][roomName] = { queue: {flagName, enqueueTime}[], active?: {teamID, flagName, startTime, timedOut?}, ignoreTeams?: { [teamID]: expireTick } }`
     */
    private static readonly QUEUE_MEMORY_KEY = 'TeamSpawnQueue';
    /**
     * 写入到孵化旗 flag.memory 的“已入队”标记，用于去重。
     *
     * @remarks
     * 该字段仅用于避免重复入队；真正的队列状态以 Memory.TeamSpawnQueue 为准。
     */
    private static readonly FLAG_QUEUED_MARK = 'teamSpawnQueuedAt';
    /**
     * 房间孵化锁最大持有 tick（超过则自动释放，避免卡死导致队列永久阻塞）。
     */
    private static readonly ACTIVE_TTL = 8000;
    /**
     * 锁超时后短期忽略该 teamID（避免同 tick 反复“推断 active → 超时释放 → 再推断”）。
     */
    private static readonly IGNORE_TTL_AFTER_TIMEOUT = 1000;

    /**
     * 小队孵化入口。
     *
     * - 每 10 tick 扫描一次所有旗帜：\n
     *   - `Team-xxxx`：队伍标记旗（队伍不存在则清理）\n
     *   - `TEAM_...`：孵化指令旗（按旗名协议解析参数并下发孵化/boost/队伍数据）\n
     * - 本方法只负责调度，不在此处堆叠业务细节。
     *
     * @remarks
     * 旗名协议（孵化旗）：`TEAM_配置_孵化房间_N最大孵化数量_T孵化间隔`。\n
     * 示例：`TEAM_A28/4_E12N34_N1_T1000`（配置/孵化房间/上限/间隔）。
     */
    static run(): void {
        // 孵化四人小队
        if (Game.time % 10) return;
        if (!Memory['TeamData']) Memory['TeamData'] = {};
        if (!Memory[TeamSpawner.QUEUE_MEMORY_KEY]) Memory[TeamSpawner.QUEUE_MEMORY_KEY] = {};

        for (const flagName in Game.flags) {
            const flag = Game.flags[flagName];
            if (!flag) continue;

            // Team-xxxx 队伍标记旗
            if (this.handleTeamFlag(flagName, flag)) continue;

            // TEAM_... 孵化指令旗
            // TEAM_配置_孵化房间_N最大孵化数量_T孵化间隔
            if (!flagName.startsWith('TEAM_')) continue;
            this.tryEnqueueSpawnFlag(flagName, flag);
        }

        this.dispatchQueues();
    }

    /**
     * 处理 `Team-xxxx` 队伍标记旗。
     *
     * @param flagName 旗帜名（用于判断是否 `Team-` 前缀并解析 teamID）
     * @param flag 旗帜对象
     * @returns 是否已处理该旗帜。\n
     * - `true`：已处理（调用方应 `continue`）\n
     * - `false`：非 `Team-` 前缀（调用方继续执行其他逻辑）
     *
     * @remarks
     * 该旗帜一般由孵化流程创建（`createTeam`），用于在地图上标记队伍集合/移动点。\n
     * 若 `Memory.TeamData[teamID]` 不存在，则说明队伍已被清理或从未成功创建，应删除该旗帜避免残留。
     */
    private static handleTeamFlag(flagName: string, flag: Flag): boolean {
        if (!flagName.startsWith('Team-')) return false;
        const teamID = flagName.match(/Team-(\w+)/)?.[1];
        if (!teamID) return true;
        if (!Memory['TeamData'][teamID]) flag.remove();
        return true;
    }

    /**
     * 处理 `TEAM_...` 孵化指令旗。
     *
     * 工作流程：
     * - `canSpawnNow`：检查目标房间 safeMode 与孵化间隔。\n
     * - 解析孵化房间并校验归属（非己方房则移除孵化旗）。\n
     * - 解析配置并读取 `TEAM_CONFIG`（缺失则移除孵化旗）。\n
     * - 计算 boost 需求并检查资源充足。\n
     * - 通过房间队列入队，避免同一房间并行下发多支队伍。\n
     * - 真正的孵化派发（boost 任务 / TeamData / SpawnMission / 计数更新）在队列出队时执行。
     *
     * @param flagName 旗帜名（包含配置/房间/次数/间隔等参数）
     * @param flag 旗帜对象
     */
    private static tryEnqueueSpawnFlag(flagName: string, flag: Flag): void {
        const flagMemory = flag.memory;

        if (!this.canSpawnNow(flagName, flag, flagMemory)) return;

        const spawnRoomName = flagName.match(/([EW][1-9]+[NS][1-9]+)/)?.[1]?.toUpperCase();
        const room = spawnRoomName ? Game.rooms[spawnRoomName] : undefined;
        if (!room || !room.my) {
            this.removeFlagAndMemory(flagName, flag, false);
            return;
        }

        const config = flagName.match(/TEAM_([0-9A-Za-z/]+)/)?.[1];
        if (!config) {
            console.log(`未设置小队配置.`);
            this.removeFlagAndMemory(flagName, flag, false);
            return;
        }
        const Team_Config = TEAM_CONFIG[config];
        if (!Team_Config) {
            console.log(`小队配置 ${config} 不存在.`);
            this.removeFlagAndMemory(flagName, flag, false);
            return;
        }

        const RES_MAP = this.calcBoostNeeds(Team_Config);
        if (!this.ensureBoostResources(room, RES_MAP, flagName, flag)) return;

        const alreadyQueued = this.isFlagQueued(room.name, flagName) || this.isFlagActive(room.name, flagName);
        if (flagMemory[TeamSpawner.FLAG_QUEUED_MARK] && !alreadyQueued) {
            delete flagMemory[TeamSpawner.FLAG_QUEUED_MARK];
        }
        if (alreadyQueued) return;

        this.enqueue(room.name, flagName);
        flagMemory[TeamSpawner.FLAG_QUEUED_MARK] = Game.time;
    }

    /**
     * 队列派发主逻辑：按房间串行派发一次孵化。
     *
     * @remarks
     * - active 存在则检查是否完成/失败/超时，满足条件则释放锁。\n
     * - active 不存在且 queue 非空：取队首重新校验并派发（生成 teamID、下发 boost/spawn、更新计数）。\n
     * - 每房间每次 run 只会派发 1 支队伍，避免并行孵化打爆 lab/任务池。
     */
    private static dispatchQueues(): void {
        const root = Memory[TeamSpawner.QUEUE_MEMORY_KEY] as any;
        if (!root) return;

        for (const roomName in root) {
            const entry = root[roomName] || {};
            if (!entry.queue) entry.queue = [];
            root[roomName] = entry;

            if (!entry.active) {
                const inferredTeamID = this.inferActiveTeamID(roomName, entry.ignoreTeams);
                if (inferredTeamID) {
                    entry.active = { teamID: inferredTeamID, flagName: '', startTime: Memory['TeamData']?.[inferredTeamID]?.time || Game.time };
                }
            }

            if (entry.active) {
                const done = this.isActiveDone(entry.active);
                if (done) {
                    if (entry.active.teamID && entry.active.timedOut) {
                        this.ignoreTeam(entry, entry.active.teamID);
                    }
                    delete entry.active;
                }
            }

            this.cleanupQueue(roomName, entry);

            if (entry.active) continue;
            if (!entry.queue.length) continue;

            const request = entry.queue.shift();
            if (!request) continue;

            const flagName: string = request.flagName;
            const flag = Game.flags[flagName];
            if (!flag) continue;

            if (flag.memory && flag.memory[TeamSpawner.FLAG_QUEUED_MARK]) delete flag.memory[TeamSpawner.FLAG_QUEUED_MARK];

            const dispatched = this.dispatchOne(flagName, flag, roomName);
            if (dispatched) {
                entry.active = { teamID: dispatched.teamID, flagName, startTime: Game.time };
            }
        }

        for (const roomName in root) {
            const entry = root[roomName];
            if (!entry) continue;
            if (entry.active) continue;
            if (entry.queue && entry.queue.length) continue;
            delete root[roomName];
        }
    }

    /**
     * 实际派发一条孵化请求（出队执行）。
     *
     * @remarks
     * 出队时会重新做一次校验（房间归属/配置存在/资源充足/间隔允许），防止等待期间环境变化导致派发错误。
     */
    private static dispatchOne(flagName: string, flag: Flag, roomName: string): { teamID: string } | undefined {
        const flagMemory = flag.memory;
        if (!this.canSpawnNow(flagName, flag, flagMemory)) return;

        const spawnRoomName = flagName.match(/([EW][1-9]+[NS][1-9]+)/)?.[1]?.toUpperCase();
        const room = spawnRoomName ? Game.rooms[spawnRoomName] : undefined;
        if (!room || !room.my || room.name !== roomName) {
            this.removeFlagAndMemory(flagName, flag, false);
            return;
        }

        const config = flagName.match(/TEAM_([0-9A-Za-z/]+)/)?.[1];
        if (!config) {
            console.log(`未设置小队配置.`);
            this.removeFlagAndMemory(flagName, flag, false);
            return;
        }
        const Team_Config = TEAM_CONFIG[config];
        if (!Team_Config) {
            console.log(`小队配置 ${config} 不存在.`);
            this.removeFlagAndMemory(flagName, flag, false);
            return;
        }

        const teamID = this.genTeamID();

        const RES_MAP = this.calcBoostNeeds(Team_Config);
        if (!this.ensureBoostResources(room, RES_MAP, flagName, flag)) return;

        if (RES_MAP && Object.keys(RES_MAP).length) {
            for (const m in RES_MAP) {
                room.AssignBoostTask(m as ResourceConstant, RES_MAP[m], `Team-${teamID}`);
            }
        }

        this.createTeam(teamID, Team_Config, room, flag);
        this.spawnTeamCreeps(teamID, Team_Config, room);
        this.updateSpawnCounter(flagName, flag, teamID, config);

        return { teamID };
    }

    /**
     * 将孵化旗入队（按房间分桶）。
     *
     * @remarks
     * 入队只存 flagName，避免复制配置/颜色等信息；flag 本身是唯一真源。
     */
    private static enqueue(roomName: string, flagName: string): void {
        const root = Memory[TeamSpawner.QUEUE_MEMORY_KEY] as any;
        if (!root[roomName]) root[roomName] = { queue: [], active: undefined };
        if (!root[roomName].queue) root[roomName].queue = [];
        root[roomName].queue.push({ flagName, enqueueTime: Game.time });
    }

    /**
     * 清理队列中的失效请求（flag 不存在/房间不匹配等）。
     */
    private static cleanupQueue(roomName: string, entry: any): void {
        if (!entry.queue || !entry.queue.length) return;
        entry.queue = entry.queue.filter((r: any) => {
            if (!r || !r.flagName) return false;
            const flag = Game.flags[r.flagName];
            if (!flag) return false;
            const spawnRoomName = r.flagName.match(/([EW][1-9]+[NS][1-9]+)/)?.[1]?.toUpperCase();
            if (!spawnRoomName || spawnRoomName !== roomName) return false;
            return true;
        });
    }

    /**
     * 判断旗帜是否已在指定房间的队列中。
     */
    private static isFlagQueued(roomName: string, flagName: string): boolean {
        const root = Memory[TeamSpawner.QUEUE_MEMORY_KEY] as any;
        const entry = root?.[roomName];
        if (!entry?.queue) return false;
        return entry.queue.some((r: any) => r?.flagName === flagName);
    }

    /**
     * 判断旗帜是否正在作为该房间的 active 孵化请求执行中。
     */
    private static isFlagActive(roomName: string, flagName: string): boolean {
        const root = Memory[TeamSpawner.QUEUE_MEMORY_KEY] as any;
        const entry = root?.[roomName];
        if (!entry?.active) return false;
        return entry.active.flagName === flagName;
    }

    /**
     * 在队列重启/Memory 丢失 active 时，尝试从现存 TeamData 推断一个 active team。
     *
     * @remarks
     * - 只选择 homeRoom 匹配且 status=ready 的队伍。\n
     * - 选择 time 最新的一支，避免误锁住更早的残留队伍。
     */
    private static inferActiveTeamID(roomName: string, ignoreTeams?: Record<string, number>): string | undefined {
        const teams = Memory['TeamData'] as any;
        if (!teams) return;
        let best: { id: string; time: number } | undefined;
        for (const teamID in teams) {
            if (ignoreTeams && ignoreTeams[teamID] && ignoreTeams[teamID] > Game.time) continue;
            const t = teams[teamID];
            if (!t) continue;
            if (t.homeRoom !== roomName) continue;
            if (t.status !== 'ready') continue;
            if (!best || (t.time || 0) > best.time) best = { id: teamID, time: t.time || 0 };
        }
        return best?.id;
    }

    /**
     * 判断 active 是否应当结束（释放房间孵化锁）。
     *
     * @remarks
     * 结束条件：\n
     * - TeamData 不存在（失败/被清理）\n
     * - status 已不为 ready 或成员齐全\n
     * - 超时（ACTIVE_TTL）：强制释放，并记录一次日志
     */
    private static isActiveDone(active: any): boolean {
        const teamID: string | undefined = active?.teamID;
        if (!teamID) return true;
        const teamData = Memory['TeamData']?.[teamID] as any;
        if (!teamData) return true;
        if (teamData.status && teamData.status !== 'ready') return true;
        if (teamData.creeps && teamData.num && teamData.creeps.length >= teamData.num) return true;

        const startTime = typeof active.startTime === 'number' ? active.startTime : teamData.time;
        if (startTime && Game.time - startTime > TeamSpawner.ACTIVE_TTL) {
            active.timedOut = true;
            active.timedOutAt = Game.time;
            log('TeamModule', `${teamID} 孵化锁超时已释放`, `home:${teamData.homeRoom}`);
            return true;
        }
        return false;
    }

    /**
     * 超时后短期忽略某个 teamID，避免同 tick 反复推断 active。
     */
    private static ignoreTeam(entry: any, teamID: string): void {
        if (!entry.ignoreTeams) entry.ignoreTeams = {};
        entry.ignoreTeams[teamID] = Game.time + TeamSpawner.IGNORE_TTL_AFTER_TIMEOUT;
    }

    /**
     * 判断当前 tick 是否允许执行一次孵化（基于目标房间状态与间隔）。
     *
     * 规则：
     * - 若目标房间（旗帜所在房间）有 safeMode：将 `lastTime` 置为 safeMode 结束后，并跳过本次。\n
     * - 若目标房间 controller 等级 < 1：将 `spawnCount` 置为超大值，用于阻止继续孵化。\n
     * - 默认间隔 `1000` tick；可通过旗名 `_Txxx` 指定。
     *
     * @param flagName 孵化旗名（解析 `_Txxx`）
     * @param flag 孵化旗对象（用于读取 `flag.room`）
     * @param flagMemory 旗帜 memory（读写 `lastTime/spawnCount`）
     * @returns 是否满足孵化条件
     */
    private static canSpawnNow(flagName: string, flag: Flag, flagMemory: FlagMemory): boolean {
        // 如果有视野, 检查目标房间
        const targetRoom = flag.room;
        if (targetRoom) {
            if (targetRoom.controller?.level < 1) {
                flagMemory['spawnCount'] = 2e32;
            } else if (targetRoom.controller?.safeMode) {
                flagMemory['lastTime'] = Game.time + targetRoom.controller.safeMode;
                return false;
            }
        }

        // 孵化间隔
        let spawnInterval = flagName.match(/_T(\d+)/)?.[1] as any;
        if (!spawnInterval) spawnInterval = 1000;
        else spawnInterval = parseInt(spawnInterval);

        return Game.time - (flagMemory['lastTime'] || 0) >= spawnInterval;
    }

    /**
     * 计算整支小队所需的 boost 资源数量。
     *
     * @param Team_Config 小队配置数组（来自 `TEAM_CONFIG[config]`）
     * @returns 资源需求映射：`{ [boostResource]: amount }`
     *
     * @remarks
     * 当前规则按 bodypart 数量 * 30 估算化合物消耗。\n
     * `boostmap` 的 key 为 bodypart 常量（如 `ATTACK/HEAL`），value 为对应 boost 资源名（如 `XUH2O`）。
     */
    private static calcBoostNeeds(Team_Config: any[]): Record<string, number> {
        const RES_MAP: Record<string, number> = {};
        for (const c of Team_Config) {
            if (!c || !c.boostmap) continue;
            for (const part of c.bodypart) {
                const partType = part[0];
                const partNum = part[1];
                const boostType = c.boostmap[partType];
                if (!boostType) continue;
                if (RES_MAP[boostType]) RES_MAP[boostType] += partNum * 30;
                else RES_MAP[boostType] = partNum * 30;
            }
        }
        return RES_MAP;
    }

    /**
     * 检查房间内 boost 资源是否满足需求。
     *
     * @param room 孵化房间（资源检查在房间对象上进行）
     * @param RES_MAP 需求映射（由 `calcBoostNeeds` 产出）
     * @param flagName 旗名（用于清理 `Memory.flags` 的 key）
     * @param flag 孵化旗对象（资源不足会移除旗帜）
     * @returns 是否资源充足；不足则会移除孵化旗并返回 false
     *
     * @remarks
     * 这里沿用原实现的资源读取方式：`room[res]`。\n
     * 如果你后续把资源存储抽象成 `room.storage/terminal` 统计，这里是最适合统一改造的入口。
     */
    private static ensureBoostResources(room: Room, RES_MAP: Record<string, number>, flagName: string, flag: Flag): boolean {
        if (!RES_MAP || Object.keys(RES_MAP).length === 0) return true;

        const ok = Object.keys(RES_MAP).every(res => {
            if (room[res] > RES_MAP[res]) return true;
            console.log(`BOOST资源${res}不足.`);
            return false;
        });

        if (!ok) {
            this.removeFlagAndMemory(flagName, flag, false);
            return false;
        }
        return true;
    }

    /**
     * 创建队伍数据并在地图上创建 `Team-xxxx` 标记旗。
     *
     * @param teamID 队伍唯一 ID
     * @param Team_Config 小队配置数组（用于记录队伍人数）
     * @param room 孵化房间（记录 homeRoom，并在必要时使用 room.createFlag 兜底）
     * @param flag 原始孵化指令旗（用于定位 targetRoom 与创建标记旗位置/颜色）
     *
     * @remarks
     * - 队伍初始状态设为 `ready`，由 TeamController 检测成员齐全后切到 `attack`。\n
     * - `try/catch` 分支用于处理 `createFlag` 失败时的兜底：先在 (0,0) 建旗，再写入 Memory.flags 的 setPosition。
     */
    private static createTeam(teamID: string, Team_Config: any[], room: Room, flag: Flag): void {
        // 创建小队
        Memory['TeamData'][teamID] = {
            'name': teamID,
            'status': 'ready',
            'toward': '↑',
            'formation': 'line',
            'creeps': [],
            'num': Team_Config.length,
            'time': Game.time,
            'homeRoom': room.name,
            'targetRoom': flag.pos.roomName,
        };
        try {
            flag.pos.createFlag(`Team-${teamID}`, flag.color, flag.secondaryColor);
        } catch (e) {
            room.createFlag(0, 0, `Team-${teamID}`, flag.color, flag.secondaryColor);
            const { x, y, roomName } = flag.pos;
            Memory.flags[`Team-${teamID}`] = { 'setPosition': `${x}/${y}/${roomName}` }
        }
    }

    /**
     * 下发孵化任务：为配置中的每个角色创建 SpawnMission。
     *
     * @param teamID 队伍 ID（写入 creep memory，用于归队）
     * @param Team_Config 小队配置数组（包含 role/bodypart/boostmap）
     * @param room 孵化房间（通过 `room.SpawnMissionAdd` 下发任务）
     *
     * @remarks
     * `compressBodyConfig` 用于把 `[ [part, count], ... ]` 压缩成孵化系统可识别的格式。\n
     * 这里保持原调用参数不变，避免影响孵化系统的调度优先级与任务结构。
     */
    private static spawnTeamCreeps(teamID: string, Team_Config: any[], room: Room): void {
        // 孵化小队成员
        for (const c of Team_Config) {
            room.SpawnMissionAdd('',
                compressBodyConfig(c.bodypart), -1, c.role, {
                teamID, boostmap: { ...c.boostmap }
            } as any);
        }
    }

    /**
     * 更新孵化计数与清理孵化旗。
     *
     * @param flagName 孵化旗名（解析 `_Nxxx` 上限并作为 Memory.flags key）
     * @param flag 孵化旗对象（读写 memory，必要时移除）
     * @param teamID 本次派送的队伍 ID（用于日志）
     * @param config 配置 key（用于日志）
     *
     * @remarks
     * - 每次成功派送后：`lastTime = Game.time`，`spawnCount++`。\n
     * - 若旗名不包含 `_Nxxx`：认为一次性指令，移除旗并清理 `Memory.flags[flagName]`。\n
     * - 若达到上限：移除旗并清理 `Memory.flags[flagName]`。
     */
    private static updateSpawnCounter(flagName: string, flag: Flag, teamID: string, config: string): void {
        const flagMemory = flag.memory;

        // 孵化计数
        flagMemory['lastTime'] = Game.time;
        flagMemory['spawnCount'] = (flagMemory['spawnCount'] || 0) + 1;
        log('TeamModule', `${flagName} 已派送小队 ${teamID} 到 ${flag.pos.roomName}, 配置:${config},`);

        // 孵化数量
        const spawnCount = flagName.match(/_N(\d+)/)?.[1] as any;
        if (!spawnCount) {
            this.removeFlagAndMemory(flagName, flag, true);
            return;
        }

        if (flagMemory['spawnCount'] >= parseInt(spawnCount)) {
            flag.remove();
            log('TeamModule', flagName, '孵化数量已满');
            delete Memory.flags[flagName];
        }
    }

    /**
     * 移除旗帜并按需清理对应的 `Memory.flags` 数据。
     *
     * @param flagName 旗帜名（用于删除 `Memory.flags[flagName]`）
     * @param flag 旗帜对象
     * @param withMemory 是否同时清理 `Memory.flags[flagName]`
     */
    private static removeFlagAndMemory(flagName: string, flag: Flag, withMemory: boolean): void {
        flag.remove();
        if (withMemory) delete Memory.flags[flagName];
    }

    /**
     * 生成不与现存队伍冲突的 4 位队伍 ID（36 进制大写）。
     *
     * @returns 新队伍 ID，如 `A1B2`
     *
     * @remarks
     * 以 `Game.time` 混合随机数，存在极低概率碰撞；若碰撞则递归重试。\n
     * 这里依赖 `Memory.TeamData` 作为“已占用 ID 集合”。
     */
    private static genTeamID(): string {
        const gen = (): string => {
            const id = (Game.time * 36 * 36 + Math.floor(Math.random() * 36 * 36))
                .toString(36).slice(-4).toUpperCase();
            if (Memory['TeamData'][id]) return gen();
            return id;
        };
        return gen();
    }
}
