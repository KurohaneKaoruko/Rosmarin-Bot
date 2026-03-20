import { EXTERNAL_ROAD_CONFIG } from '@/constant/config';
import { RoleData } from '@/constant/CreepConstant';
import { RoadBuilder, RoadVisual } from '@/modules/feature/externalRoad';
import { getCreepSourceRoom } from '@/modules/utils/creepMemory';
import { HighwayMineVisual } from '@/modules/utils/highwayMineVisual';
import { getCreepByTargetRoom } from '@/modules/utils/creepTickIndex';
import { getOutMineData, getRoomData } from '@/modules/utils/memory';

// 目标房间列表的类型：普通外矿（能量）与中心房（SK/中心区）外矿。
type OutMineTargetListKey = 'energy' | 'centerRoom';

// 单次外矿运行的状态快照，用于控制节奏与副作用（造路/侦查等）。
type OutMineRunState = {
    qosLevel: string;
    canRunSecondaryAction: boolean;
};

// 外矿逻辑的执行间隔设置（不同 QoS 下采用不同的 tick 间隔）。
export type ExternalMineTiming = {
    normalInterval: number;
    constrainedInterval: number;
};

// 外矿运行的状态工具：QoS、房间模式、节流、以及视觉渲染。
class ExternalMineState {
    private static readonly CENTER_ROOM_REGEX = /^[EW]\d*[456][NS]\d*[456]$/;
    private static readonly EXACT_CENTER_ROOM_REGEX = /^[EW]\d*[5][NS]\d*[5]$/;

    // 从全局 QoS 中获取当前级别，缺失时默认 normal。
    static getQosLevel(): string {
        return global.qos.getQoS()?.level || 'normal';
    }

    static isCenterRoom(roomName: string): boolean {
        return this.CENTER_ROOM_REGEX.test(roomName);
    }

    static isExactCenterRoom(roomName: string): boolean {
        return this.EXACT_CENTER_ROOM_REGEX.test(roomName);
    }

    // 兼容多处存储路径读取房间模式（更高优先级的配置优先）。
    static getRoomMode(room: Room): string {
        return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
    }

    // 根据 QoS 与间隔判断本 tick 是否运行，返回运行状态快照。
    // emergency 时直接停机，constrained 时拉长间隔且限制副作用操作频率。
    static getRunState(timing: ExternalMineTiming): OutMineRunState | null {
        const qosLevel = this.getQosLevel();
        if (qosLevel === 'emergency') return null;

        const canRunSecondaryAction =
            qosLevel === 'normal' || global.qos.shouldRun({ every: 2, allowLevels: ['constrained'] });
        const interval = qosLevel === 'constrained' ? timing.constrainedInterval : timing.normalInterval;
        if (Game.time % interval !== 0) return null;

        return { qosLevel, canRunSecondaryAction };
    }

    // 从外矿配置中读取目标房间列表，并去重/过滤非法项。
    static getUniqueTargets(sourceRoom: Room, key: OutMineTargetListKey): string[] {
        const targets = getOutMineData(sourceRoom.name)?.[key];
        if (!Array.isArray(targets) || targets.length <= 0) return [];

        return [...new Set(targets.filter((roomName): roomName is string => (
            typeof roomName === 'string' && !!roomName
        )))];
    }

    static createMemory(sourceRoomName: string, targetRoomName: string): CreepMemory {
        return { sourceRoom: sourceRoomName, targetRoom: targetRoomName } as CreepMemory;
    }

    // 外矿基础设施建造入口。
    // container 只要目标房有视野就优先尝试落地，不再受 secondary action 节流影响；
    // road 仍按 secondary action、等级与 BUILD_INTERVAL 节流，避免把高成本寻路/铺路放大到每 tick。
    static tryBuildRoad(
        sourceRoom: Room,
        targetRoom: Room,
        minLevel: number,
        canRunSecondaryAction: boolean
    ): void {
        RoadBuilder.ensureContainerSites(sourceRoom, targetRoom);
        if (!canRunSecondaryAction) return;
        if (sourceRoom.level < minLevel) return;
        if (Game.time % EXTERNAL_ROAD_CONFIG.BUILD_INTERVAL !== 0) return;
        RoadBuilder.createRoadSites(sourceRoom, targetRoom);
    }

    // 外矿相关的可视化输出。
    static runVisuals(): void {
        RoadVisual.run();
        HighwayMineVisual.run();
    }
}

// 外矿的数学/容量估算集中在此处，避免散落的魔数。
class ExternalMineMath {
    // 每个 RCL 对应的外矿单源工作量估计（单位：能量/tick）。
    private static readonly HARVEST_PER_SOURCE = [0, 2, 4, 6, 8, 8, 10, 20, 20] as const;
    // 每个 RCL 对应的单个运输队列的承载能力估计（单位：能量）。
    private static readonly CARRY_CAPACITY = [0, 100, 150, 200, 400, 1000, 1000, 1300, 1600] as const;
    // 期望单源总 WORK 数量（用于估算采集人数）。
    private static readonly SOURCE_TARGET_WORK = 5;
    // 低等级阶段允许的单源外矿采集者上限（用于过渡补能）。
    private static readonly MAX_HARVESTERS_PER_SOURCE_LOW_LEVEL = 3;
    // 成熟房间（有效等级 >= 4）单源上限：严格 1 个采集者。
    private static readonly MAX_HARVESTERS_PER_SOURCE_STABLE = 1;
    // high/rush 模式下把小体型搬运降一级：out-carry 8C4M -> 6C3M，out-car 1W7C4M -> 1W5C3M。
    private static readonly SMALL_BODY_OUT_CARRY: ((BodyPartConstant | number)[])[] = [[CARRY, 6], [MOVE, 3]];
    private static readonly SMALL_BODY_OUT_CAR: ((BodyPartConstant | number)[])[] = [[WORK, 1], [CARRY, 5], [MOVE, 3]];
    // high/rush 模式下外矿经济单位使用较小体型的能量预算上限（便于多数量）。
    private static readonly SMALL_BODY_ENERGY_CAP_HIGH = 650;
    private static readonly SMALL_BODY_ENERGY_CAP_RUSH = 650;
    // 仅这些外矿运输角色应用“小体型”策略，避免影响采集与战斗单位。
    private static readonly SMALL_BODY_ROLE_SET = new Set<string>(['out-carry', 'out-car']);
    // 允许占位在采集点旁的可通行结构类型。
    private static readonly WALKABLE_SOURCE_STRUCTURE_SET = new Set<StructureConstant>([
        STRUCTURE_CONTAINER,
        STRUCTURE_ROAD,
        STRUCTURE_RAMPART,
    ]);

    private static getModeLimitedEnergyBudget(sourceRoom: Room, role: string, upbody?: boolean): number | null {
        if (upbody) return null;
        if (!this.SMALL_BODY_ROLE_SET.has(role)) return null;
        const mode = ExternalMineState.getRoomMode(sourceRoom);
        if (mode !== 'high' && mode !== 'rush') return null;
        const cap = mode === 'rush' ? this.SMALL_BODY_ENERGY_CAP_RUSH : this.SMALL_BODY_ENERGY_CAP_HIGH;
        const roomCap = sourceRoom.energyCapacityAvailable || 0;
        const budget = Math.min(cap, roomCap > 0 ? roomCap : cap);
        return budget > 0 ? budget : null;
    }

    // 获取 high/rush 模式下的外矿角色体型配置；非高功耗模式返回 null。
    static getModeLimitedBodyConfig(
        sourceRoom: Room,
        role: string,
        upbody?: boolean
    ): ((BodyPartConstant | number)[])[] | null {
        if (!upbody && role === 'out-carry') {
            const mode = ExternalMineState.getRoomMode(sourceRoom);
            if (mode === 'high' || mode === 'rush') {
                return this.SMALL_BODY_OUT_CARRY.map((part) => [...part]);
            }
        }
        if (!upbody && role === 'out-car') {
            const mode = ExternalMineState.getRoomMode(sourceRoom);
            if (mode === 'high' || mode === 'rush') {
                return this.SMALL_BODY_OUT_CAR.map((part) => [...part]);
            }
        }
        const budget = this.getModeLimitedEnergyBudget(sourceRoom, role, upbody);
        if (!budget) return null;
        const body = sourceRoom.GetRoleBodys(role, upbody, budget);
        if (!Array.isArray(body) || body.length === 0) return null;
        return body as ((BodyPartConstant | number)[])[];
    }

    // 判断外矿资源点旁某个坐标是否可站立（不在边界、非墙、结构阻塞）。
    private static isStandableOutmineSourcePos(room: Room, x: number, y: number): boolean {
        const terrain = room.getTerrain();
        if (x <= 0 || x >= 49 || y <= 0 || y >= 49) return false;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

        const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
        if (structures.some(structure => {
            if (structure.structureType === STRUCTURE_RAMPART) {
                const rampart = structure as StructureRampart;
                return !rampart.my && !rampart.isPublic;
            }
            return !this.WALKABLE_SOURCE_STRUCTURE_SET.has(structure.structureType);
        })) return false;

        const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y) as ConstructionSite[];
        if (sites.some(site => !this.WALKABLE_SOURCE_STRUCTURE_SET.has(site.structureType))) return false;

        return true;
    }

    // 计算并缓存某个 Source 周围可站立格数，用于采集者数量上限估计。
    private static getOutmineSourceStandableCount(room: Room, source: Source): number {
        if (!room.memory.sourcePosCount) room.memory.sourcePosCount = {};
        const cached = room.memory.sourcePosCount[source.id];
        if (typeof cached === 'number') return cached;

        const pos = source.pos;
        const walkable = [
            [pos.x - 1, pos.y],
            [pos.x + 1, pos.y],
            [pos.x, pos.y - 1],
            [pos.x, pos.y + 1],
            [pos.x - 1, pos.y - 1],
            [pos.x + 1, pos.y + 1],
            [pos.x - 1, pos.y + 1],
            [pos.x + 1, pos.y - 1]
        ].filter(([px, py]) => this.isStandableOutmineSourcePos(room, px, py)).length;

        room.memory.sourcePosCount[source.id] = walkable;
        return walkable;
    }

    // 获取目标房间内所有资源点的可站立格总数（作为全局采集上限）。
    static getOutHarvesterSlotCap(targetRoom: Room): number {
        const sources = (targetRoom.source || targetRoom.find(FIND_SOURCES) || []) as Source[];
        if (sources.length <= 0) return 0;

        let totalSlots = 0;
        for (const source of sources) {
            totalSlots += this.getOutmineSourceStandableCount(targetRoom, source);
        }
        return totalSlots;
    }

    // 计算外矿采集者的 WORK 数量，支持 upbody（固定高配）或读取配置。
    static getOutHarvesterWorkParts(sourceRoom: Room, upbody?: boolean): number {
        if (upbody) return 16;
        const body = sourceRoom.GetRoleBodys('out-harvest');
        if (!Array.isArray(body) || body.length === 0) return 1;

        let workParts = 0;
        for (const part of body as ((BodyPartConstant | number)[])[]) {
            if (!Array.isArray(part) || part.length < 2) continue;
            if (part[0] !== WORK) continue;
            if (typeof part[1] !== 'number') continue;
            workParts += part[1];
        }
        return Math.max(1, workParts);
    }

    // 根据体型配置估算 out-carry 的单体承载能力。
    static getOutCarryCapacity(sourceRoom: Room): number {
        const modeBody = this.getModeLimitedBodyConfig(sourceRoom, 'out-carry');
        const body = modeBody || sourceRoom.GetRoleBodys('out-carry');
        if (Array.isArray(body) && body.length > 0) {
            let carryParts = 0;
            for (const part of body as ((BodyPartConstant | number)[])[]) {
                if (!Array.isArray(part) || part.length < 2) continue;
                if (part[0] !== CARRY) continue;
                if (typeof part[1] !== 'number') continue;
                carryParts += part[1];
            }
            const capacity = carryParts * 50;
            if (capacity > 0) return capacity;
        }
        const lv = Math.max(1, Math.min(8, sourceRoom.level));
        return this.CARRY_CAPACITY[lv];
    }

    // 根据源数、WORK 能力与站位上限，估算采集者目标数量。
    static calcOutHarvesterTargetNum(sourceRoom: Room, sourceNum: number, upbody?: boolean, slotCap?: number): number {
        if (sourceNum <= 0) return 0;
        const workParts = this.getOutHarvesterWorkParts(sourceRoom, upbody);
        const perSource = Math.ceil(this.SOURCE_TARGET_WORK / workParts);
        const builtLevel = sourceRoom.getEffectiveRoomLevel?.() ?? sourceRoom.level;
        const maxPerSource = (builtLevel >= 4 || upbody)
            ? this.MAX_HARVESTERS_PER_SOURCE_STABLE
            : this.MAX_HARVESTERS_PER_SOURCE_LOW_LEVEL;
        const cappedPerSource = Math.min(maxPerSource, Math.max(1, perSource));
        const targetNum = sourceNum * cappedPerSource;
        if (typeof slotCap === 'number') return Math.max(0, Math.min(slotCap, targetNum));
        return targetNum;
    }

    // 根据距离与吞吐估算运输数量，考虑 RCL 运输能力、往返时间与产量。
    static calcEnergyOutCarryTarget(
        sourceRoom: Room,
        targetRoomName: string,
        sourceNum: number,
        allowWorkCarry: boolean,
        carryCapacityOverride?: number
    ): number {
        const lv = Math.max(1, Math.min(8, sourceRoom.level));
        const baseNum = allowWorkCarry
            ? sourceNum
            : Math.max(sourceNum + 1, Math.ceil(sourceNum * 2));

        const linearDistance = Game.map.getRoomLinearDistance(sourceRoom.name, targetRoomName, true);
        const oneWayTicks = 20 + linearDistance * 25;
        const roundTripTicks = oneWayTicks * 2 + 8;

        const harvestPerSource = this.HARVEST_PER_SOURCE[lv];
        const estimatedIncomePerTick = harvestPerSource * sourceNum;
        const carryCapacity = (carryCapacityOverride && carryCapacityOverride > 0)
            ? carryCapacityOverride
            : this.CARRY_CAPACITY[lv];
        const throughputNeed = Math.ceil((estimatedIncomePerTick * roundTripTicks) / Math.max(50, carryCapacity));
        const dynamicNum = throughputNeed + 1;

        const cappedMax = Math.max(6, sourceNum * 7);
        return Math.min(cappedMax, Math.max(baseNum, dynamicNum));
    }
}

// 外矿相关的刷怪决策与刷怪队列维护。
class ExternalMineSpawner {
    // 各角色任务优先级，统一从角色配置读取。
    private static readonly PRIORITY = {
        reserver: RoleData['reserver'].level,
        harvest: RoleData['out-harvest'].level,
        carry: RoleData['out-carry'].level,
        scout: RoleData['scout'].level,
        build: RoleData['out-build'].level,
        mineral: RoleData['out-mineral'].level,
    } as const;

    // 用于统一修正 spawn 任务优先级的映射（兼容别名）。
    private static readonly ROLE_PRIORITY_BY_ROLE: Record<string, number> = {
        scout: this.PRIORITY.scout,
        reserver: this.PRIORITY.reserver,
        'out-harvest': this.PRIORITY.harvest,
        'out-car': this.PRIORITY.carry,
        'out-carry': this.PRIORITY.carry,
        'out-build': this.PRIORITY.build,
        'out-mineral': this.PRIORITY.mineral,
    };

    // 触发“双人防御”模式的最低 RCL。
    private static readonly DOUBLE_DEFEND_MIN_LEVEL = 7;

    // 统计某房间针对某目标房间的排队刷怪数量（仅本房间任务池）。
    private static getQueuedSpawnRoleNumByTarget(sourceRoom: Room, role: string, targetRoomName: string): number {
        const tasks = sourceRoom.getAllMissionFromPool('spawn') || [];
        let count = 0;
        for (const task of tasks) {
            const memory = (task as any)?.data?.memory;
            if (!memory?.role) continue;
            if (memory.role !== role) continue;
            if ((memory.targetRoom || '') !== targetRoomName) continue;
            const taskSourceRoom = getCreepSourceRoom(memory);
            if (taskSourceRoom && taskSourceRoom !== sourceRoom.name) continue;
            count++;
        }
        return count;
    }

    // 统计全局所有房间针对某目标房间的排队刷怪数量（可选按 sourceRoom 过滤）。
    private static getQueuedSpawnRoleNumByTargetGlobal(role: string, targetRoomName: string, sourceRoomName?: string): number {
        let count = 0;
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName] as Room | undefined;
            if (!room || typeof (room as any).getAllMissionFromPool !== 'function') continue;
            const tasks = room.getAllMissionFromPool('spawn') || [];
            for (const task of tasks) {
                const memory = (task as any)?.data?.memory;
                if (!memory?.role) continue;
                if (memory.role !== role) continue;
                if ((memory.targetRoom || '') !== targetRoomName) continue;
                if (sourceRoomName) {
                    const taskSourceRoom = getCreepSourceRoom(memory);
                    if (taskSourceRoom && taskSourceRoom !== sourceRoomName) continue;
                }
                count++;
            }
        }
        return count;
    }

    // 统计全局某角色在目标房间的存活数量。
    private static getActiveRoleNumByTarget(role: string, targetRoomName: string): number {
        let count = 0;
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            if (!creep || creep.memory?.role !== role) continue;
            if (creep.memory?.targetRoom !== targetRoomName) continue;
            count++;
        }
        return count;
    }

    // 统计某房间自身任务池里某角色排队数量（不关心 targetRoom）。
    private static getQueuedSpawnRoleNumBySource(sourceRoom: Room, role: string): number {
        const tasks = sourceRoom.getAllMissionFromPool('spawn') || [];
        let count = 0;
        for (const task of tasks) {
            const memory = (task as any)?.data?.memory;
            if (!memory?.role) continue;
            if (memory.role !== role) continue;
            if (getCreepSourceRoom(memory) !== sourceRoom.name) continue;
            count++;
        }
        return count;
    }

    // 判断 creep 记录的 sourceRoom 是否与期望源房一致。
    private static isSameSourceRoom(creepSourceRoom: string | undefined, sourceRoomName: string): boolean {
        if (!creepSourceRoom) return false;
        return creepSourceRoom === sourceRoomName;
    }

    // 目标房中是否已有“来自本源房”的外矿采集者（用于运输前置）。
    private static hasActiveOutHarvesterByTargetName(sourceRoom: Room, targetRoomName: string): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoomName);
        const activeHarvesters = (creepByTargetRoom['out-harvest'] || [])
            .filter((c: any) =>
                c &&
                this.isSameSourceRoom(c.sourceRoom, sourceRoom.name) &&
                !c.spawning &&
                (c.ticksToLive == null || c.ticksToLive > 0)
            ).length;
        return activeHarvesters > 0;
    }

    // 清理指定目标房的 out-carry/out-car 刷怪任务，返回移除数量。
    private static clearTargetOutCarrySpawnMissions(sourceRoom: Room, targetRoomName: string): number {
        const tasks = sourceRoom.getAllMissionFromPool('spawn') || [];
        let removed = 0;
        for (const task of tasks) {
            const data = (task as any)?.data;
            const memory = data?.memory;
            const role = memory?.role;
            if (role !== 'out-carry' && role !== 'out-car') continue;
            if (memory?.targetRoom !== targetRoomName) continue;
            const taskSourceRoom = getCreepSourceRoom(memory);
            if (taskSourceRoom && taskSourceRoom !== sourceRoom.name) continue;
            sourceRoom.deleteMissionFromPool('spawn', (task as any).id);
            removed++;
        }
        return removed;
    }

    // 目标房是否已有采集者（本源房视角）。
    private static hasActiveOutHarvester(sourceRoom: Room, targetRoom: Room): boolean {
        return this.hasActiveOutHarvesterByTargetName(sourceRoom, targetRoom.name);
    }

    // 清理：当目标房没有采集者时，移除其 carry 任务，避免浪费刷怪。
    static pruneInvalidOutCarrySpawnMissions(sourceRoom: Room): number {
        const tasks = sourceRoom.getAllMissionFromPool('spawn') || [];
        const invalidTargets = new Set<string>();
        for (const task of tasks) {
            const memory = (task as any)?.data?.memory;
            const role = memory?.role;
            if (role !== 'out-carry' && role !== 'out-car') continue;
            const targetRoom = memory?.targetRoom;
            if (!targetRoom) continue;
            const taskSourceRoom = getCreepSourceRoom(memory);
            if (taskSourceRoom && taskSourceRoom !== sourceRoom.name) continue;
            if (!this.hasActiveOutHarvesterByTargetName(sourceRoom, targetRoom)) {
                invalidTargets.add(targetRoom);
            }
        }

        let removed = 0;
        for (const targetRoom of invalidTargets) {
            removed += this.clearTargetOutCarrySpawnMissions(sourceRoom, targetRoom);
        }
        return removed;
    }

    // 清理历史遗留的 aggressiveCarry 任务（可能导致经济异常）。
    static pruneLegacyAggressiveOutCarrySpawnMissions(sourceRoom: Room): number {
        const tasks = sourceRoom.getAllMissionFromPool('spawn') || [];
        const removeIds: string[] = [];

        for (const task of tasks) {
            const id = (task as any)?.id;
            const memory = (task as any)?.data?.memory as CreepMemory | undefined;
            const role = memory?.role;
            if (!id || !memory || !role) continue;
            if (role !== 'out-carry' && role !== 'out-car') continue;
            if (!memory.aggressiveCarry) continue;

            const taskSourceRoom = getCreepSourceRoom(memory);
            if (taskSourceRoom && taskSourceRoom !== sourceRoom.name) continue;
            removeIds.push(id);
        }

        for (const id of removeIds) {
            sourceRoom.deleteMissionFromPool('spawn', id);
        }

        return removeIds.length;
    }

    // 统一修正外矿相关任务的优先级，避免因历史任务导致优先级偏低。
    static normalizeEconomicPriority(room: Room): void {
        const tasks = room.getAllMissionFromPool('spawn') || [];
        for (const task of tasks) {
            const role = (task as any)?.data?.memory?.role;
            if (!role) continue;
            const targetLevel = this.ROLE_PRIORITY_BY_ROLE[role];
            if (targetLevel == null) continue;
            if ((task as any).level < targetLevel) {
                (task as any).level = targetLevel;
            }
        }
    }

    // 侦查：全局与本房均只允许 1 个 scout，以避免重复探路。
    static scout(sourceRoom: Room, targetRoomName: string): boolean {
        const globalActive = this.getActiveRoleNumByTarget('scout', targetRoomName);
        const globalQueued = this.getQueuedSpawnRoleNumByTargetGlobal('scout', targetRoomName);
        if (globalActive + globalQueued > 0) return false;

        const activeSourceScouts = Object.values(Game.creeps).filter((creep) =>
            creep &&
            creep.memory?.role === 'scout' &&
            getCreepSourceRoom(creep.memory) === sourceRoom.name
        ).length;
        const queuedSourceScouts = this.getQueuedSpawnRoleNumBySource(sourceRoom, 'scout');
        if (activeSourceScouts + queuedSourceScouts > 0) return false;

        const creepByTargetRoom = getCreepByTargetRoom(targetRoomName);
        const scouts = (creepByTargetRoom['scout'] || [])
            .filter((c: any) => this.isSameSourceRoom(c?.sourceRoom, sourceRoom.name)).length;
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'scout', targetRoomName);
        if (scouts + spawnNum > 0) return false;

        sourceRoom.SpawnMissionAdd('OS', [], this.PRIORITY.scout, 'scout', ExternalMineState.createMemory(sourceRoom.name, targetRoomName));
        return true;
    }

    // 常规外矿攻击者（单目标房最多 1 个）。
    static attack(sourceRoom: Room, targetRoom: Room): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerAttackers = (creepByTargetRoom['out-attack'] || [])
            .filter((c: any) => c.ticksToLive > 300 || c.spawning);
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-attack', targetRoom.name);
        if (outerAttackers.length + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('OA', [], -1, 'out-attack', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

    // 远程攻击者（单目标房最多 1 个）。
    static ranged(sourceRoom: Room, targetRoom: Room): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerRanged = (creepByTargetRoom['out-ranged'] || [])
            .filter((c: any) => c.ticksToLive > 300 || c.spawning);
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-ranged', targetRoom.name);
        if (outerRanged.length + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('OR', [], -1, 'out-ranged', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

    // 外矿矿物采集（需要 RCL6+ 且单房仅 1 个）。
    static mineral(sourceRoom: Room, targetRoom: Room): boolean {
        if (sourceRoom.level < 6) return false;
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerMiners = (creepByTargetRoom['out-mineral'] || []).length;
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-mineral', targetRoom.name);
        if (outerMiners + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('OMR', [], this.PRIORITY.mineral, 'out-mineral', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

    // 常规防守：根据敌人种类/数量派遣 out-defend 或 out-invader。
    static defend(sourceRoom: Room, targetRoom: Room, hostiles: Creep[]): boolean {
        const invaderCore = targetRoom.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType === STRUCTURE_INVADER_CORE
        });

        if (invaderCore.length === 0 && hostiles.length === 0) return false;

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerDefenders = (creepByTargetRoom['out-defend'] || []).length;
        const outerInvaders = (creepByTargetRoom['out-invader'] || []).length;

        if (hostiles.length > 0) {
            const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-defend', targetRoom.name);
            let maxNum = 1;
            if (sourceRoom.level < 4) maxNum = 3;
            else if (sourceRoom.level < 6) maxNum = 2;
            if (outerDefenders + spawnNum >= maxNum) return false;
            sourceRoom.SpawnMissionAdd('OD', [], -1, 'out-defend', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        if (invaderCore.length > 0) {
            const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-invader', targetRoom.name);
            let maxNum = 1;
            if (sourceRoom.level < 4) maxNum = 4;
            else if (sourceRoom.level < 6) maxNum = 3;
            else if (sourceRoom.level === 6) maxNum = 2;
            if (outerInvaders + spawnNum >= maxNum) return false;
            sourceRoom.SpawnMissionAdd('OI', [], -1, 'out-invader', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        return false;
    }

    // 高等级的“双人防守”编队（out-2attack + out-2heal）。
    static doubleDefend(sourceRoom: Room, targetRoom: Room, hostiles: Creep[]): boolean {
        if (hostiles.length === 0) return false;

        if (sourceRoom.level < this.DOUBLE_DEFEND_MIN_LEVEL) {
            sourceRoom.deleteSpawnMissionsByRole(['out-2attack', 'out-2heal']);
            return this.defend(sourceRoom, targetRoom, hostiles);
        }

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const out2Attack = (creepByTargetRoom['out-2attack'] || []).length || 0;
        const out2AttackSpawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-2attack', targetRoom.name);
        if (out2Attack + out2AttackSpawnNum >= 1) return false;
        const out2Heal = (creepByTargetRoom['out-2heal'] || []).length;
        const out2HealSpawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-2heal', targetRoom.name);
        if (out2Heal + out2HealSpawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('', [], -1, 'out-2attack', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        sourceRoom.SpawnMissionAdd('', [], -1, 'out-2heal', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

    // 外矿采集者：根据源数、站位上限与 body 配置决定目标数量。
    static harvester(sourceRoom: Room, targetRoom: Room, sourceNum: number, upbody?: boolean): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerHarvesters = (creepByTargetRoom['out-harvest'] || [])
            .filter((c: any) => c.sourceRoom === sourceRoom.name).length;
        // 孵化队列要按“全局+同 sourceRoom”统计，避免跨房代孵时重复排队。
        const queuedBySource = this.getQueuedSpawnRoleNumByTargetGlobal('out-harvest', targetRoom.name, sourceRoom.name);
        const slotCap = ExternalMineMath.getOutHarvesterSlotCap(targetRoom);
        if (slotCap > 0) {
            const globalActive = this.getActiveRoleNumByTarget('out-harvest', targetRoom.name);
            const globalQueued = this.getQueuedSpawnRoleNumByTargetGlobal('out-harvest', targetRoom.name);
            if (globalActive + globalQueued >= slotCap) return false;
        }
        const targetNum = ExternalMineMath.calcOutHarvesterTargetNum(sourceRoom, sourceNum, upbody, slotCap);
        if (targetNum <= 0) return false;
        if (outerHarvesters + queuedBySource >= targetNum) return false;

        const memory = ExternalMineState.createMemory(sourceRoom.name, targetRoom.name);
        if (upbody) {
            sourceRoom.SpawnMissionAdd('OH', [[WORK, 16], [CARRY, 6], [MOVE, 8]], this.PRIORITY.harvest, 'out-harvest', memory);
        } else {
            sourceRoom.SpawnMissionAdd('OH', [], this.PRIORITY.harvest, 'out-harvest', memory);
        }
        return true;
    }

    // 外矿运输者：依赖采集者存在；allowWorkCarry 时允许先出 work+carry 的过渡车。
    static carry(sourceRoom: Room, targetRoom: Room, num: number, allowWorkCarry = true): boolean {
        if (!this.hasActiveOutHarvester(sourceRoom, targetRoom)) {
            this.clearTargetOutCarrySpawnMissions(sourceRoom, targetRoom.name);
            return false;
        }

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerCarry = (creepByTargetRoom['out-carry'] || [])
            .filter((c: any) => c.sourceRoom === sourceRoom.name).length;
        const outerCar = (creepByTargetRoom['out-car'] || [])
            .filter((c: any) => c.sourceRoom === sourceRoom.name).length;

        const spawnCarryNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-carry', targetRoom.name);
        const spawnCarNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-car', targetRoom.name);
        const modeCarryBody = ExternalMineMath.getModeLimitedBodyConfig(sourceRoom, 'out-carry');
        const modeCarBody = ExternalMineMath.getModeLimitedBodyConfig(sourceRoom, 'out-car');

        if (!allowWorkCarry) {
            const totalCarry = outerCarry + spawnCarryNum + outerCar + spawnCarNum;
            if (totalCarry < num) {
                sourceRoom.SpawnMissionAdd('OC', modeCarryBody || [], this.PRIORITY.carry, 'out-carry', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
                return true;
            }
            return false;
        }

        if (outerCar + spawnCarNum === 0) {
            sourceRoom.SpawnMissionAdd('OC', modeCarBody || [], this.PRIORITY.carry, 'out-car', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        if (outerCarry + spawnCarryNum < num - 1) {
            sourceRoom.SpawnMissionAdd('OC', modeCarryBody || [], this.PRIORITY.carry, 'out-carry', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        return false;
    }

    // 外矿预定：仅在目标未被占领、且自家预定不足时派遣。
    static reserver(sourceRoom: Room, targetRoom: Room): boolean {
        if (!targetRoom.controller || targetRoom.controller.my) return false;
        if (sourceRoom.controller.level < 3) return false;

        if (targetRoom.controller.reservation &&
            targetRoom.controller.reservation.username === sourceRoom.controller.owner.username &&
            targetRoom.controller.reservation.ticksToEnd > 1000) return false;

        const outerReservers = this.getActiveRoleNumByTarget('reserver', targetRoom.name);
        const spawnNum = this.getQueuedSpawnRoleNumByTargetGlobal('reserver', targetRoom.name);
        if (outerReservers + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('', '', this.PRIORITY.reserver, 'reserver', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

    // 外矿建造者：仅为道路/容器施工存在时派遣。
    static builder(sourceRoom: Room, targetRoom: Room): boolean {
        const constructionSite = targetRoom.find(FIND_CONSTRUCTION_SITES, {
            filter: (site) => site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER
        });
        if (constructionSite.length === 0) return false;

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerBuilder = (creepByTargetRoom['out-build'] || []).length;
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-build', targetRoom.name);

        let num = 1;
        if (constructionSite.length > 10) num = 2;
        if (outerBuilder + spawnNum >= num) return false;

        sourceRoom.SpawnMissionAdd('OB', '', this.PRIORITY.build, 'out-build', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }
}

// 外矿入口类：调度能量外矿与中心房外矿的整体流程。
export class ExternalMine {
    // 每个 tick 的准备阶段：防守与战争态短路、清理无效任务、修正优先级。
    static prepareRoom(room: Room): string | null {
        if (room.memory.defend) return null;
        if (Memory['warmode']) return null;

        ExternalMineSpawner.pruneInvalidOutCarrySpawnMissions(room);
        ExternalMineSpawner.normalizeEconomicPriority(room);

        const qosLevel = ExternalMineState.getQosLevel();
        if (qosLevel === 'emergency') return null;
        return qosLevel;
    }

    // 外矿相关可视化。
    static runVisuals(): void {
        ExternalMineState.runVisuals();
    }

    // 对外暴露房间模式读取接口（兼容旧调用）。
    static getRoomMode(room: Room): string {
        return ExternalMineState.getRoomMode(room);
    }

    // 常规外矿：能量采集、运输、防守、预定与建造。
    static runEnergy(room: Room, timing: ExternalMineTiming): void {
        const runState = ExternalMineState.getRunState(timing);
        if (!runState) return;

        ExternalMineSpawner.pruneLegacyAggressiveOutCarrySpawnMissions(room);
        const targetRooms = ExternalMineState.getUniqueTargets(room, 'energy');
        if (targetRooms.length <= 0) return;

        for (const roomName of targetRooms) {
            if (!ExternalMineState.isCenterRoom(roomName)) continue;
            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) {
                if (runState.canRunSecondaryAction) {
                    ExternalMineSpawner.scout(room, roomName);
                }
                continue;
            }

            ExternalMineState.tryBuildRoad(room, targetRoom, EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL, runState.canRunSecondaryAction);

            const sourceNum = targetRoom.source?.length || targetRoom.find(FIND_SOURCES).length || 0;
            if (sourceNum === 0) continue;

            const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
                filter: (c) => (
                    (c.owner.username === 'Invader' ||
                    c.owner.username === 'Source Keeper' ||
                    c.getActiveBodyparts(ATTACK) > 0 ||
                    c.getActiveBodyparts(RANGED_ATTACK) > 0) &&
                    !c.isWhiteList()
                )
            });

            const hasPlayerThreat = hostiles.some(c => {
                if (c.owner.username === 'Invader') return false;
                if (c.owner.username === 'Source Keeper') return false;
                return true;
            });

            if (hasPlayerThreat) {
                ExternalMineSpawner.doubleDefend(room, targetRoom, hostiles);
            } else {
                ExternalMineSpawner.defend(room, targetRoom, hostiles);
            }

            if (hostiles.length > 0) continue;

            const controller = targetRoom.controller;
            const myUserName = room.controller.owner.username;
            if (controller?.owner && controller.owner.username !== myUserName) continue;

            if (room.level >= 3 && runState.canRunSecondaryAction) {
                ExternalMineSpawner.reserver(room, targetRoom);
            }

            if (controller.reservation &&
                controller.reservation.username !== myUserName) continue;

            ExternalMineSpawner.harvester(room, targetRoom, sourceNum);

            const allowWorkCarry = room.level >= EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL;
            const carryCapacity = ExternalMineMath.getOutCarryCapacity(room);
            const carryNum = ExternalMineMath.calcEnergyOutCarryTarget(room, roomName, sourceNum, allowWorkCarry, carryCapacity);
            ExternalMineSpawner.carry(room, targetRoom, carryNum, allowWorkCarry);

            if (runState.qosLevel === 'normal') {
                ExternalMineSpawner.builder(room, targetRoom);
            }
        }
    }

    // 中心房外矿：包含 SK/中心房的高强度采集与矿物采集逻辑。
    static runCenter(room: Room, timing: ExternalMineTiming): void {
        const runState = ExternalMineState.getRunState(timing);
        if (!runState) return;

        ExternalMineSpawner.pruneLegacyAggressiveOutCarrySpawnMissions(room);
        const targetRooms = ExternalMineState.getUniqueTargets(room, 'centerRoom');
        if (targetRooms.length <= 0) return;

        for (const roomName of targetRooms) {
            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) {
                if (runState.canRunSecondaryAction) {
                    ExternalMineSpawner.scout(room, roomName);
                }
                continue;
            }

            ExternalMineState.tryBuildRoad(room, targetRoom, EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL, runState.canRunSecondaryAction);

            const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
                filter: (creep) => !Memory['whitelist']?.includes(creep.owner.username)
            });
            const dangerousHostiles = hostiles.filter((creep) =>
                creep.owner.username !== 'Source Keeper' &&
                (creep.getActiveBodyparts(ATTACK) > 0 || creep.getActiveBodyparts(RANGED_ATTACK) > 0)
            );

            if (dangerousHostiles.length > 0) {
                ExternalMineSpawner.doubleDefend(room, targetRoom, dangerousHostiles);
                continue;
            }

            if (!ExternalMineState.isExactCenterRoom(roomName)) {
                ExternalMineSpawner.attack(room, targetRoom);
                const hasSourceKeeper = hostiles.some((creep) => creep.owner.username === 'Source Keeper');
                const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
                const outerAttackers = (creepByTargetRoom['out-attack'] || []).length;
                if (hasSourceKeeper && outerAttackers < 1) continue;
            }

            const sourceNum = targetRoom.source?.length || targetRoom.find(FIND_SOURCES).length || 0;
            if (sourceNum <= 0) continue;
            ExternalMineSpawner.harvester(room, targetRoom, sourceNum, true);

            const mineral = targetRoom[FIND_MINERALS] || targetRoom.find(FIND_MINERALS)[0];
            if (mineral && mineral.mineralAmount > 0) {
                ExternalMineSpawner.mineral(room, targetRoom);
            }

            const allowWorkCarry = room.level >= EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL;
            const carryCapacity = ExternalMineMath.getOutCarryCapacity(room);
            const carryNum = ExternalMineMath.calcEnergyOutCarryTarget(room, roomName, sourceNum, allowWorkCarry, carryCapacity);
            ExternalMineSpawner.carry(room, targetRoom, carryNum, allowWorkCarry);

            if (runState.qosLevel === 'normal') {
                ExternalMineSpawner.builder(room, targetRoom);
            }
        }
    }
}
