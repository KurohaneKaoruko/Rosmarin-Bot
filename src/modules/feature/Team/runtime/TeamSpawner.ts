import { log } from "@/utils";
import { compressBodyConfig } from "@/modules/utils/compress";
import { TEAM_CONFIG } from "../config/TeamConfig";

export default class TeamSpawner {
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

        for (const flagName in Game.flags) {
            const flag = Game.flags[flagName];
            if (!flag) continue;

            // Team-xxxx 队伍标记旗
            if (this.handleTeamFlag(flagName, flag)) continue;

            // TEAM_... 孵化指令旗
            // TEAM_配置_孵化房间_N最大孵化数量_T孵化间隔
            if (!flagName.startsWith('TEAM_')) continue;
            this.handleSpawnFlag(flagName, flag);
        }
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
     * - 生成 teamID，计算 boost 需求并检查资源充足。\n
     * - 发送 boost 任务（AssignBoostTask），创建队伍数据并下发孵化任务（SpawnMissionAdd）。\n
     * - 更新孵化计数与清理规则（`_N` 上限不存在则认为一次性指令，移除旗并清理 memory）。
     *
     * @param flagName 旗帜名（包含配置/房间/次数/间隔等参数）
     * @param flag 旗帜对象
     */
    private static handleSpawnFlag(flagName: string, flag: Flag): void {
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

        const teamID = this.genTeamID();

        const RES_MAP = this.calcBoostNeeds(Team_Config);
        if (!this.ensureBoostResources(room, RES_MAP, flagName, flag)) return;

        if (RES_MAP && Object.keys(RES_MAP).length) {
            // 给lab分配boost任务 (传入 Team-teamID)
            for (const m in RES_MAP) {
                room.AssignBoostTask(m as ResourceConstant, RES_MAP[m], `Team-${teamID}`);
            }
        }

        this.createTeam(teamID, Team_Config, room, flag);
        this.spawnTeamCreeps(teamID, Team_Config, room);

        this.updateSpawnCounter(flagName, flag, teamID, config);
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
