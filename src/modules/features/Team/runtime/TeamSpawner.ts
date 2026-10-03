import { log } from "@/modules/utils";
import { compressBodyConfig } from "@/modules/shared/compress";
import { ensureTeamData, getTeamData, getTeamSpawnQueue } from "@/modules/shared/memory";
import { isBoostResCheckEnabled } from "@/modules/shared/gameCapabilities";
import { TEAM_CONFIG } from "../config/TeamConfig";

/** ATK 旗默认配置：双远程输出 + 双顶级治疗（要塞攻坚最稳的远程编队） */
const ATK_DEFAULT_CONFIG = 'R25/4';
/** ATK 旗默认孵化间隔：0 = 无定时，孵化队列空闲即派下一队 */
const ATK_DEFAULT_INTERVAL = 0;
/** ATK 同时存在的队伍上限 */
const ATK_TEAM_CAP = 10;

/** 旗名解析出的孵化参数（TEAM_/ATK 两种旗型归一） */
type TeamSpawnSpec = {
    kind: 'TEAM' | 'ATK';
    config: string;
    /** 孵化房；ATK 缺省表示主房暂无视野，本轮跳过不拆旗 */
    spawnRoomName?: string;
    /** 目标房；TEAM_ 恒为旗所在房，ATK 可由旗名指定或自动选取 */
    targetRoom?: string;
    /** 最大派兵次数；undefined = TEAM_ 一次性 / ATK 无限 */
    maxCount?: number;
    /** 孵化间隔 tick */
    interval: number;
};

export default class TeamSpawner {
    /**
     * Team 孵化队列的 Memory Key（按房间分桶）。
     *
     * @remarks
     * 结构示意：\n
     * `Memory.RosmarinBot.TeamSpawnQueue[roomName] = { queue: {flagName, enqueueTime}[], active?: {teamID, flagName, startTime, timedOut?}, ignoreTeams?: { [teamID]: expireTick } }`
     */
    private static readonly QUEUE_MEMORY_KEY = 'TeamSpawnQueue';
    /**
     * 写入到孵化旗 flag.memory 的“已入队”标记，用于去重。
     *
     * @remarks
     * 该字段仅用于避免重复入队；真正的队列状态以 Memory.RosmarinBot.TeamSpawnQueue 为准。
     */
    private static readonly FLAG_QUEUED_MARK = 'teamSpawnQueuedAt';
    /**
     * 房间孵化锁最大持有 tick（超过则自动释放，避免卡死导致队列永久阻塞）。
     * 有 boost 阶段的服（强化+归队耗时不可控）用长时限；无 boost 的服成员纯孵化即齐，短时限。
     */
    private static get activeTtl(): number {
        return isBoostResCheckEnabled() ? 8000 : 2000;
    }
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
     *   - `ATK...`：攻击指令旗（旗所在房即目标；孵化房/配置/次数/间隔可带参）
     * - 本方法只负责调度，不在此处堆叠业务细节。
     *
     * @remarks
     * 旗名协议（孵化旗）：`TEAM_配置_孵化房间_N最大孵化数量_T孵化间隔`。\n
     * 示例：`TEAM_A28/4_E12N34_N1_T1000`（配置/孵化房间/上限/间隔）。\n
     * 旗名协议（攻击旗）：`ATK[/_孵化房][/_配置][/_N次数][/_T间隔]`，`/` 与 `_` 均可作分隔。
     */
    static run(): void {
        // 孵化四人小队
        if (Game.time % 10) return;
        getTeamData();
        getTeamSpawnQueue();

        const specs = new Map<string, TeamSpawnSpec>();
        for (const flagName in Game.flags) {
            const flag = Game.flags[flagName];
            if (!flag) continue;

            // Team-xxxx 队伍标记旗
            if (this.handleTeamFlag(flagName, flag)) continue;

            // TEAM_... 孵化指令旗 / ATK... 攻击指令旗
            const spec = flagName.startsWith('TEAM_')
                ? this.parseTeamFlag(flagName)
                : this.parseAtkFlag(flagName, flag);
            if (!spec) continue;
            specs.set(flagName, spec);
            this.tryEnqueueSpawnFlag(flagName, flag, spec);
        }

        this.dispatchQueues(specs);
    }

    // ── 旗名解析 ──

    /**
     * 解析 `TEAM_配置_孵化房间_N最大孵化数量_T孵化间隔`。
     */
    private static parseTeamFlag(flagName: string): TeamSpawnSpec | undefined {
        const config = flagName.match(/TEAM_([0-9A-Za-z/]+)/)?.[1];
        const spawnRoomName = flagName.match(/([EW][1-9]+[NS][1-9]+)/)?.[1]?.toUpperCase();
        if (!config || !spawnRoomName) return undefined;
        const interval = parseInt(flagName.match(/_T(\d+)/)?.[1] ?? '') || 1000;
        const nRaw = flagName.match(/_N(\d+)/)?.[1];
        return {
            kind: 'TEAM',
            config,
            spawnRoomName,
            maxCount: nRaw === undefined ? undefined : parseInt(nRaw),
            interval,
        };
    }

    /**
     * 解析 ATK 攻击旗：`ATK[/_孵化房][/_配置][/_N次数][/_T间隔]`。
     *
     * @remarks
     * - 目标 = 旗所在房间（旗插哪打到哪）。\n
     * - 孵化房：旗名参数优先；缺省自动选取离旗最近的己方房。\n
     * - 配置缺省 R25/4；短名（如 R28）自动补全 /4、/2。\n
     * - 次数缺省无限（N0 同义）；间隔缺省 500t。
     */
    private static parseAtkFlag(flagName: string, flag: Flag): TeamSpawnSpec | undefined {
        if (!/^ATK([/_].*)?$/.test(flagName)) return undefined;

        let spawnParam: string | undefined;
        let maxCount: number | undefined;
        let interval: number | undefined;
        const rest: string[] = [];
        for (const seg of flagName.slice(3).split(/[/_]/)) {
            if (!seg) continue;
            const n = seg.match(/^N(\d+)$/);
            if (n) { maxCount = parseInt(n[1]); continue; }
            const t = seg.match(/^T(\d+)$/);
            if (t) { interval = parseInt(t[1]); continue; }
            if (/^[EW]\d+[NS]\d+$/.test(seg)) { spawnParam ??= seg.toUpperCase(); continue; }
            rest.push(seg);
        }

        // 配置段拼回（'R28'+'4' → 'R28/4'）；无子段的短名自动补 /4、/2
        let config = rest.length ? rest.join('/') : ATK_DEFAULT_CONFIG;
        if (!TEAM_CONFIG[config] && !config.includes('/')) {
            config = TEAM_CONFIG[`${config}/4`] ? `${config}/4` : `${config}/2`;
        }
        if (!TEAM_CONFIG[config]) {
            console.log(`[ATK] ${flagName} 配置 ${config} 不存在（如 R25/4、R28/4、RH/4）`);
            this.removeFlagAndMemory(flagName, flag, false);
            return undefined;
        }

        // 孵化房：旗名参数优先，否则离旗最近的己方房
        const myRooms = Object.values(Game.rooms).filter(r => r.my);
        let spawnRoomName = spawnParam;
        if (!spawnRoomName && myRooms.length) {
            spawnRoomName = myRooms
                .map(r => ({ name: r.name, dist: Game.map.getRoomLinearDistance(r.name, flag.pos.roomName) }))
                .sort((a, b) => a.dist - b.dist)[0].name;
        }

        return { kind: 'ATK', config, spawnRoomName, targetRoom: flag.pos.roomName, maxCount, interval: interval ?? ATK_DEFAULT_INTERVAL };
    }    /**
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
     * 若 `Memory.RosmarinBot.TeamData[teamID]` 不存在，则说明队伍已被清理或从未成功创建，应删除该旗帜避免残留。
     */
    private static handleTeamFlag(flagName: string, flag: Flag): boolean {
        if (!flagName.startsWith('Team-')) return false;
        const teamID = flagName.match(/Team-(\w+)/)?.[1];
        if (!teamID) return true;
        if (!getTeamData(teamID)) flag.remove();
        return true;
    }

    /**
     * 处理孵化指令旗（TEAM_/ATK）。
     *
     * 工作流程：
     * - `canSpawnNow`：检查目标房间 safeMode 与孵化间隔。
     * - 解析孵化房间并校验归属（ATK 缺主房视野时等待，不拆旗）。
     * - 读取 `TEAM_CONFIG`（缺失则移除孵化旗）。
     * - 计算 boost 需求并检查资源充足（ATK 缺货只等待不拆旗）。
     * - 通过房间队列入队，避免同一房间并行下发多支队伍。
     * - 真正的孵化派发（boost 任务 / TeamData / SpawnMission / 计数更新）在队列出队时执行。
     */
    private static tryEnqueueSpawnFlag(flagName: string, flag: Flag, spec: TeamSpawnSpec): void {
        const flagMemory = flag.memory;

        if (!this.canSpawnNow(spec, flag, flagMemory)) return;

        const room = spec.spawnRoomName ? Game.rooms[spec.spawnRoomName] : undefined;
        if (!room || !room.my) {
            if (spec.kind === 'ATK') return;
            this.removeFlagAndMemory(flagName, flag, false);
            return;
        }
        if (spec.kind === 'ATK' && !spec.targetRoom) return;

        const Team_Config = TEAM_CONFIG[spec.config];
        if (!Team_Config) {
            console.log(`未设置小队配置.`);
            this.removeFlagAndMemory(flagName, flag, false);
            return;
        }

        // boost 资源检查关闭时跳过
        const RES_MAP = isBoostResCheckEnabled() ? this.calcBoostNeeds(Team_Config) : undefined;
        if (RES_MAP && !this.ensureBoostResources(room, RES_MAP, flagName, flag, spec.kind === 'ATK')) return;

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
    private static dispatchQueues(specs: Map<string, TeamSpawnSpec>): void {
        const root = getTeamSpawnQueue() as any;
        if (!root) return;

        for (const roomName in root) {
            const entry = root[roomName] || {};
            if (!entry.queue) entry.queue = [];
            root[roomName] = entry;

            if (!entry.active) {
                const inferredTeamID = this.inferActiveTeamID(roomName, entry.ignoreTeams);
                if (inferredTeamID) {
                    entry.active = { teamID: inferredTeamID, flagName: '', startTime: getTeamData(inferredTeamID)?.time || Game.time };
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

            this.cleanupQueue(roomName, entry, specs);

            if (entry.active) continue;
            if (!entry.queue.length) continue;

            const request = entry.queue.shift();
            if (!request) continue;

            const flagName: string = request.flagName;
            const flag = Game.flags[flagName];
            if (!flag) continue;

            if (flag.memory && flag.memory[TeamSpawner.FLAG_QUEUED_MARK]) delete flag.memory[TeamSpawner.FLAG_QUEUED_MARK];

            const spec = specs.get(flagName);
            if (!spec) continue;

            const dispatched = this.dispatchOne(flagName, flag, roomName, spec);
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
    private static dispatchOne(flagName: string, flag: Flag, roomName: string, spec: TeamSpawnSpec): { teamID: string } | undefined {
        const flagMemory = flag.memory;
        if (!this.canSpawnNow(spec, flag, flagMemory)) return;

        const room = spec.spawnRoomName ? Game.rooms[spec.spawnRoomName] : undefined;
        if (!room || !room.my || room.name !== roomName) {
            if (spec.kind !== 'ATK') this.removeFlagAndMemory(flagName, flag, false);
            return;
        }
        if (spec.kind === 'ATK' && !spec.targetRoom) return;

        const Team_Config = TEAM_CONFIG[spec.config];
        if (!Team_Config) {
            console.log(`未设置小队配置.`);
            this.removeFlagAndMemory(flagName, flag, false);
            return;
        }

        const teamID = this.genTeamID();

        // boost 资源检查关闭时跳过检查与 boost 任务下发
        const RES_MAP = isBoostResCheckEnabled() ? this.calcBoostNeeds(Team_Config) : undefined;
        if (RES_MAP && !this.ensureBoostResources(room, RES_MAP, flagName, flag, spec.kind === 'ATK')) return;

        if (RES_MAP && Object.keys(RES_MAP).length) {
            for (const m in RES_MAP) {
                room.AssignBoostTask(m as ResourceConstant, RES_MAP[m], `Team-${teamID}`);
            }
        }

        this.createTeam(teamID, Team_Config, room, flag);
        this.spawnTeamCreeps(teamID, Team_Config, room);
        this.updateSpawnCounter(flagName, spec, flag, teamID);

        return { teamID };
    }

    /**
     * 将孵化旗入队（按房间分桶）。
     *
     * @remarks
     * 入队只存 flagName，避免复制配置/颜色等信息；flag 本身是唯一真源。
     */
    private static enqueue(roomName: string, flagName: string): void {
        const root = getTeamSpawnQueue() as any;
        if (!root[roomName]) root[roomName] = { queue: [], active: undefined };
        if (!root[roomName].queue) root[roomName].queue = [];
        root[roomName].queue.push({ flagName, enqueueTime: Game.time });
    }

    /**
     * 清理队列中的失效请求（flag 不存在/孵化房不匹配等）。
     */
    private static cleanupQueue(roomName: string, entry: any, specs: Map<string, TeamSpawnSpec>): void {
        if (!entry.queue || !entry.queue.length) return;
        entry.queue = entry.queue.filter((r: any) => {
            if (!r || !r.flagName) return false;
            if (!Game.flags[r.flagName]) return false;
            return specs.get(r.flagName)?.spawnRoomName === roomName;
        });
    }

    /**
     * 判断旗帜是否已在指定房间的队列中。
     */
    private static isFlagQueued(roomName: string, flagName: string): boolean {
        const root = getTeamSpawnQueue() as any;
        const entry = root?.[roomName];
        if (!entry?.queue) return false;
        return entry.queue.some((r: any) => r?.flagName === flagName);
    }

    /**
     * 判断旗帜是否正在作为该房间的 active 孵化请求执行中。
     */
    private static isFlagActive(roomName: string, flagName: string): boolean {
        const root = getTeamSpawnQueue() as any;
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
        const teams = getTeamData() as any;
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
        const teamData = getTeamData(teamID) as any;
        if (!teamData) return true;
        if (teamData.status && teamData.status !== 'ready') return true;
        if (teamData.creeps && teamData.num && teamData.creeps.length >= teamData.num) return true;

        const startTime = typeof active.startTime === 'number' ? active.startTime : teamData.time;
        if (startTime && Game.time - startTime > TeamSpawner.activeTtl) {
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
     * - 目标房有 safeMode：将 `lastTime` 置为 safeMode 结束后，并跳过本次。\n
     * - TEAM_ 且目标房 controller 等级 < 1：`spawnCount` 置为超大值阻止继续孵化
     *   （ATK 不做此拦截——要塞目标可能本就无主，插旗即打）。\n
     * - 间隔：TEAM_ 缺省 1000，ATK 缺省 500（解析期已归一进 spec）。
     */
    private static canSpawnNow(spec: TeamSpawnSpec, flag: Flag, flagMemory: FlagMemory): boolean {
        // 如果有视野, 检查目标房间（ATK 的目标房可能不是旗所在房）
        const targetRoom = spec.targetRoom ? Game.rooms[spec.targetRoom] : flag.room;
        if (targetRoom) {
            if (spec.kind === 'TEAM' && targetRoom.controller?.level < 1) {
                flagMemory['spawnCount'] = 2e32;
            } else if (targetRoom.controller?.safeMode) {
                flagMemory['lastTime'] = Game.time + targetRoom.controller.safeMode;
                return false;
            }
        }

        // 孵化间隔：0（缺省）= 队列空闲即派，仅受场上队伍上限约束
        if (spec.interval > 0 && Game.time - (flagMemory['lastTime'] || 0) < spec.interval) return false;
        if (spec.kind === 'ATK') {
            const teams = getTeamData() as any;
            if (teams && Object.keys(teams).length >= ATK_TEAM_CAP) return false;
        }
        return true;
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
     * @param flag 孵化旗对象（资源不足且不保旗时会移除旗帜）
     * @param keepFlag 资源不足时只等待不拆旗（ATK 长期战役口径）
     * @returns 是否资源充足
     *
     * @remarks
     * 这里沿用原实现的资源读取方式：`room[res]`。\n
     * 如果你后续把资源存储抽象成 `room.storage/terminal` 统计，这里是最适合统一改造的入口。
     */
    private static ensureBoostResources(room: Room, RES_MAP: Record<string, number>, flagName: string, flag: Flag, keepFlag = false): boolean {
        if (!RES_MAP || Object.keys(RES_MAP).length === 0) return true;

        const ok = Object.keys(RES_MAP).every(res => {
            if (room[res] > RES_MAP[res]) return true;
            console.log(`BOOST资源${res}不足.`);
            return false;
        });

        if (!ok) {
            if (keepFlag) return false;
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
     * @param flag 原始指令旗（定位 targetRoom 与标记旗位置/颜色）
     *
     * @remarks
     * - 队伍初始状态设为 `ready`，由 TeamController 检测成员齐全后切到 `attack`。\n
     * - `try/catch` 分支用于处理 `createFlag` 失败时的兜底：先在 (0,0) 建旗，再写入 Memory.flags 的 setPosition。
     */
    private static createTeam(teamID: string, Team_Config: any[], room: Room, flag: Flag): void {
        // 创建小队
        const teamMem = ensureTeamData(teamID);
        Object.assign(teamMem, {
            name: teamID,
            status: 'ready',
            toward: '↑',
            formation: 'line',
            creeps: [],
            num: Team_Config.length,
            time: Game.time,
            homeRoom: room.name,
            targetRoom: flag.pos.roomName,
        });
        try {
            const result = flag.pos.createFlag(`Team-${teamID}`, flag.color, flag.secondaryColor) as number;
            // 部分引擎对无视野房间建旗必然失败（且无法迁移旗）：建不出就不建——
            // 无旗队伍按 targetRoom 推进开打（GatherLine/execMove/chooseTargets 均有无旗锚点）
        } catch (e) {
            // 引擎抛异常口径：同样放弃建旗
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
                teamID,
                // boost 检查关闭时不下发 boostmap：成员出生即视为已强化（见 TeamController）
                ...(isBoostResCheckEnabled() ? { boostmap: { ...c.boostmap } } : {}),
            } as any);
        }
    }

    /**
     * 更新孵化计数与清理指令旗。
     *
     * @param flagName 指令旗名（用于日志与 Memory.flags 清理）
     * @param spec 旗名解析参数
     * @param flag 指令旗对象（读写 memory，必要时移除）
     * @param teamID 本次派送的队伍 ID（用于日志）
     *
     * @remarks
     * - 每次成功派送后：`lastTime = Game.time`，`spawnCount++`。\n
     * - TEAM_ 不带 `_Nxxx`：一次性指令，派送即移除旗并清理 memory（原口径）。\n
     * - ATK 不带 `N`（或 N0）：无限派兵。\n
     * - 达到上限：移除旗并清理 `Memory.flags[flagName]`。
     */
    private static updateSpawnCounter(flagName: string, spec: TeamSpawnSpec, flag: Flag, teamID: string): void {
        const flagMemory = flag.memory;

        // 孵化计数
        flagMemory['lastTime'] = Game.time;
        flagMemory['spawnCount'] = (flagMemory['spawnCount'] || 0) + 1;
        log('TeamModule', `${flagName} 已派送小队 ${teamID} 到 ${spec.targetRoom ?? flag.pos.roomName}, 配置:${spec.config},`);

        const maxCount = spec.maxCount;
        if (spec.kind === 'ATK' && (!maxCount || maxCount <= 0)) return;

        if (maxCount === undefined) {
            this.removeFlagAndMemory(flagName, flag, true);
            return;
        }

        if (flagMemory['spawnCount'] >= maxCount) {
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
     * 这里依赖 `Memory.RosmarinBot.TeamData` 作为“已占用 ID 集合”。
     */
    private static genTeamID(): string {
        const gen = (): string => {
            const id = (Game.time * 36 * 36 + Math.floor(Math.random() * 36 * 36))
                .toString(36).slice(-4).toUpperCase();
            if (getTeamData(id)) return gen();
            return id;
        };
        return gen();
    }
}
