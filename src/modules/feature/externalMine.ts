import { EXTERNAL_ROAD_CONFIG } from '@/constant/config';
import { RoleData } from '@/constant/CreepConstant';
import { RoadBuilder, RoadVisual } from '@/modules/feature/externalRoad';
import { getCreepSourceRoom } from '@/modules/utils/creepMemory';
import { HighwayMineVisual } from '@/modules/utils/highwayMineVisual';
import { getCreepByTargetRoom } from '@/modules/utils/creepTickIndex';
import { getOutMineData, getRoomData } from '@/modules/utils/memory';

type OutMineTargetListKey = 'energy' | 'centerRoom';
type OutMineRunState = {
    qosLevel: string;
    canRunSecondaryAction: boolean;
};

export type ExternalMineTiming = {
    normalInterval: number;
    constrainedInterval: number;
};

class ExternalMineState {
    static getQosLevel(): string {
        return global.qos.getQoS()?.level || 'normal';
    }

    static getRoomMode(room: Room): string {
        return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
    }

    static getRunState(timing: ExternalMineTiming): OutMineRunState | null {
        const qosLevel = this.getQosLevel();
        if (qosLevel === 'emergency') return null;

        const canRunSecondaryAction =
            qosLevel === 'normal' || global.qos.shouldRun({ every: 2, allowLevels: ['constrained'] });
        const interval = qosLevel === 'constrained' ? timing.constrainedInterval : timing.normalInterval;
        if (Game.time % interval !== 0) return null;

        return { qosLevel, canRunSecondaryAction };
    }

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

    static tryBuildRoad(
        sourceRoom: Room,
        targetRoom: Room,
        minLevel: number,
        canRunSecondaryAction: boolean
    ): void {
        if (!canRunSecondaryAction) return;
        if (sourceRoom.level < minLevel) return;
        if (Game.time % EXTERNAL_ROAD_CONFIG.BUILD_INTERVAL !== 0) return;
        RoadBuilder.createRoadSites(sourceRoom, targetRoom);
    }

    static runVisuals(): void {
        RoadVisual.run();
        HighwayMineVisual.run();
    }
}

class ExternalMineMath {
    private static readonly HARVEST_PER_SOURCE = [0, 2, 4, 6, 8, 8, 10, 20, 20] as const;
    private static readonly CARRY_CAPACITY = [0, 100, 150, 200, 400, 1000, 1000, 1300, 1600] as const;
    private static readonly SOURCE_TARGET_WORK = 5;
    private static readonly MAX_HARVESTERS_PER_SOURCE = 3;
    private static readonly WALKABLE_SOURCE_STRUCTURE_SET = new Set<StructureConstant>([
        STRUCTURE_CONTAINER,
        STRUCTURE_ROAD,
        STRUCTURE_RAMPART,
    ]);

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

    static getOutHarvesterSlotCap(targetRoom: Room): number {
        const sources = (targetRoom.source || targetRoom.find(FIND_SOURCES) || []) as Source[];
        if (sources.length <= 0) return 0;

        let totalSlots = 0;
        for (const source of sources) {
            totalSlots += this.getOutmineSourceStandableCount(targetRoom, source);
        }
        return totalSlots;
    }

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

    static calcOutHarvesterTargetNum(sourceRoom: Room, sourceNum: number, upbody?: boolean, slotCap?: number): number {
        if (sourceNum <= 0) return 0;
        const workParts = this.getOutHarvesterWorkParts(sourceRoom, upbody);
        const perSource = Math.ceil(this.SOURCE_TARGET_WORK / workParts);
        const cappedPerSource = Math.min(this.MAX_HARVESTERS_PER_SOURCE, Math.max(1, perSource));
        const targetNum = sourceNum * cappedPerSource;
        if (typeof slotCap === 'number') return Math.max(0, Math.min(slotCap, targetNum));
        return targetNum;
    }

    static calcEnergyOutCarryTarget(sourceRoom: Room, targetRoomName: string, sourceNum: number, allowWorkCarry: boolean): number {
        const lv = Math.max(1, Math.min(8, sourceRoom.level));
        const baseNum = allowWorkCarry
            ? sourceNum
            : Math.max(sourceNum + 1, Math.ceil(sourceNum * 2));

        const linearDistance = Game.map.getRoomLinearDistance(sourceRoom.name, targetRoomName, true);
        const oneWayTicks = 20 + linearDistance * 25;
        const roundTripTicks = oneWayTicks * 2 + 8;

        const harvestPerSource = this.HARVEST_PER_SOURCE[lv];
        const estimatedIncomePerTick = harvestPerSource * sourceNum;
        const carryCapacity = this.CARRY_CAPACITY[lv];
        const throughputNeed = Math.ceil((estimatedIncomePerTick * roundTripTicks) / Math.max(50, carryCapacity));
        const dynamicNum = throughputNeed + 1;

        const cappedMax = Math.max(6, sourceNum * 7);
        return Math.min(cappedMax, Math.max(baseNum, dynamicNum));
    }
}

class ExternalMineSpawner {
    private static readonly PRIORITY = {
        reserver: RoleData['reserver'].level,
        harvest: RoleData['out-harvest'].level,
        carry: RoleData['out-carry'].level,
        scout: RoleData['scout'].level,
        build: RoleData['out-build'].level,
        mineral: RoleData['out-mineral'].level,
    } as const;

    private static readonly ROLE_PRIORITY_BY_ROLE: Record<string, number> = {
        scout: this.PRIORITY.scout,
        reserver: this.PRIORITY.reserver,
        'out-harvest': this.PRIORITY.harvest,
        'out-car': this.PRIORITY.carry,
        'out-carry': this.PRIORITY.carry,
        'out-build': this.PRIORITY.build,
        'out-mineral': this.PRIORITY.mineral,
    };

    private static readonly DOUBLE_DEFEND_MIN_LEVEL = 7;

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

    private static getQueuedSpawnRoleNumByTargetGlobal(role: string, targetRoomName: string): number {
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
                count++;
            }
        }
        return count;
    }

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

    private static isSameSourceRoom(creepSourceRoom: string | undefined, sourceRoomName: string): boolean {
        if (!creepSourceRoom) return false;
        return creepSourceRoom === sourceRoomName;
    }

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

    private static hasActiveOutHarvester(sourceRoom: Room, targetRoom: Room): boolean {
        return this.hasActiveOutHarvesterByTargetName(sourceRoom, targetRoom.name);
    }

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

    static attack(sourceRoom: Room, targetRoom: Room): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerAttackers = (creepByTargetRoom['out-attack'] || [])
            .filter((c: any) => c.ticksToLive > 300 || c.spawning);
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-attack', targetRoom.name);
        if (outerAttackers.length + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('OA', [], -1, 'out-attack', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

    static ranged(sourceRoom: Room, targetRoom: Room): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerRanged = (creepByTargetRoom['out-ranged'] || [])
            .filter((c: any) => c.ticksToLive > 300 || c.spawning);
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-ranged', targetRoom.name);
        if (outerRanged.length + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('OR', [], -1, 'out-ranged', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

    static mineral(sourceRoom: Room, targetRoom: Room): boolean {
        if (sourceRoom.level < 6) return false;
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerMiners = (creepByTargetRoom['out-mineral'] || []).length;
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-mineral', targetRoom.name);
        if (outerMiners + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('OMR', [], this.PRIORITY.mineral, 'out-mineral', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    }

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

    static harvester(sourceRoom: Room, targetRoom: Room, sourceNum: number, upbody?: boolean): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerHarvesters = (creepByTargetRoom['out-harvest'] || [])
            .filter((c: any) => c.sourceRoom === sourceRoom.name).length;
        const spawnNum = this.getQueuedSpawnRoleNumByTarget(sourceRoom, 'out-harvest', targetRoom.name);
        const slotCap = ExternalMineMath.getOutHarvesterSlotCap(targetRoom);
        if (slotCap > 0) {
            const globalActive = this.getActiveRoleNumByTarget('out-harvest', targetRoom.name);
            const globalQueued = this.getQueuedSpawnRoleNumByTargetGlobal('out-harvest', targetRoom.name);
            if (globalActive + globalQueued >= slotCap) return false;
        }
        const targetNum = ExternalMineMath.calcOutHarvesterTargetNum(sourceRoom, sourceNum, upbody, slotCap);
        if (targetNum <= 0) return false;
        if (outerHarvesters + spawnNum >= targetNum) return false;

        const memory = ExternalMineState.createMemory(sourceRoom.name, targetRoom.name);
        if (upbody) {
            sourceRoom.SpawnMissionAdd('OH', [[WORK, 16], [CARRY, 6], [MOVE, 8]], this.PRIORITY.harvest, 'out-harvest', memory);
        } else {
            sourceRoom.SpawnMissionAdd('OH', [], this.PRIORITY.harvest, 'out-harvest', memory);
        }
        return true;
    }

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

        if (!allowWorkCarry) {
            const totalCarry = outerCarry + spawnCarryNum + outerCar + spawnCarNum;
            if (totalCarry < num) {
                sourceRoom.SpawnMissionAdd('OC', [], this.PRIORITY.carry, 'out-carry', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
                return true;
            }
            return false;
        }

        if (outerCar + spawnCarNum === 0) {
            sourceRoom.SpawnMissionAdd('OC', [], this.PRIORITY.carry, 'out-car', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        if (outerCarry + spawnCarryNum < num - 1) {
            sourceRoom.SpawnMissionAdd('OC', [], this.PRIORITY.carry, 'out-carry', ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        return false;
    }

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

export class ExternalMine {
    static prepareRoom(room: Room): string | null {
        if (room.memory.defend) return null;
        if (Memory['warmode']) return null;

        ExternalMineSpawner.pruneInvalidOutCarrySpawnMissions(room);
        ExternalMineSpawner.normalizeEconomicPriority(room);

        const qosLevel = ExternalMineState.getQosLevel();
        if (qosLevel === 'emergency') return null;
        return qosLevel;
    }

    static runVisuals(): void {
        ExternalMineState.runVisuals();
    }

    static getRoomMode(room: Room): string {
        return ExternalMineState.getRoomMode(room);
    }

    static runEnergy(room: Room, timing: ExternalMineTiming): void {
        const runState = ExternalMineState.getRunState(timing);
        if (!runState) return;

        ExternalMineSpawner.pruneLegacyAggressiveOutCarrySpawnMissions(room);
        const targetRooms = ExternalMineState.getUniqueTargets(room, 'energy');
        if (targetRooms.length <= 0) return;

        for (const roomName of targetRooms) {
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
            const carryNum = ExternalMineMath.calcEnergyOutCarryTarget(room, roomName, sourceNum, allowWorkCarry);
            ExternalMineSpawner.carry(room, targetRoom, carryNum, allowWorkCarry);

            if (runState.qosLevel === 'normal') {
                ExternalMineSpawner.builder(room, targetRoom);
            }
        }
    }

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

            if (!(/^[EW]\d*[5][NS]\d*[5]$/.test(roomName))) {
                ExternalMineSpawner.attack(room, targetRoom);
                const hasSourceKeeper = hostiles.some((creep) => creep.owner.username === 'Source Keeper');
                const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
                const outerAttackers = (creepByTargetRoom['out-attack'] || []).length;
                if (hasSourceKeeper && outerAttackers < 1) continue;
            }

            const centerSourceNum = 3;
            ExternalMineSpawner.harvester(room, targetRoom, centerSourceNum, true);

            const mineral = targetRoom[FIND_MINERALS] || targetRoom.find(FIND_MINERALS)[0];
            if (mineral && mineral.mineralAmount > 0) {
                ExternalMineSpawner.mineral(room, targetRoom);
            }

            const allowWorkCarry = room.level >= EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL;
            const carryNum = ExternalMineMath.calcEnergyOutCarryTarget(room, roomName, centerSourceNum, allowWorkCarry);
            ExternalMineSpawner.carry(room, targetRoom, carryNum, allowWorkCarry);

            if (runState.qosLevel === 'normal') {
                ExternalMineSpawner.builder(room, targetRoom);
            }
        }
    }
}
