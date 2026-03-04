import { OUTMINE_CONFIG, EXTERNAL_ROAD_CONFIG } from '@/constant/config';
import { RoadBuilder, RoadMemory, RoadVisual } from '@/modules/feature/externalRoad';
import { HighwayMineVisual } from '@/modules/feature/highwayMineVisual';
import { getCreepByTargetRoom } from '@/modules/utils/creepTickIndex';
import { getQoS, shouldRun } from '@/modules/infra/qos';
import { getOutMineData, getRoomData } from '@/modules/utils/memory';

const OUTMINE_PRIORITY = {
    reserver: 4,
    harvest: 5,
    carry: 6,
    scout: 6,
    build: 7,
    mineral: 7,
} as const;

const DOUBLE_DEFEND_MIN_LEVEL = 7;

// 按房间等级估算单 source 每 tick 产能（对应 out-harvest 动态 body 的 WORK 数）
const OUTMINE_HARVEST_PER_SOURCE = [0, 2, 4, 6, 8, 8, 10, 20, 20] as const;
// 按房间等级估算单搬运爬可用容量（对应 out-carry 动态 body）
const OUTMINE_CARRY_CAPACITY = [0, 100, 150, 200, 400, 1000, 1000, 1300, 1600] as const;
// 小体型搬运模板 c3m3 的等效容量（3 * 50）
const OUTMINE_SMALL_CARRY_CAPACITY = 150;
const OUTMINE_SMALL_CARRY_BODY = 'c3m3';
const OUTMINE_ROAD_CARRY_BODY = 'c4m2';
const OUTMINE_ROAD_BODY_CHECK_INTERVAL = 25;
const OUTMINE_ROAD_BODY_MIN_VISIBLE = 8;
const OUTMINE_ROAD_BODY_MIN_COVERAGE = 0.75;

const getSpawnRoleNum = (homeRoom: Room, role: string): number => {
    // 读取指定角色在孵化队列中的数量
    return homeRoom.getSpawnMissionNum()?.[role] || 0;
}

const getSpawnRoleNumByTarget = (homeRoom: Room, role: string, targetRoomName: string): number => {
    const roomAny = homeRoom as any;
    if (roomAny._spawnRoleTargetCacheTick !== Game.time) {
        const cache: Record<string, number> = {};
        const tasks = homeRoom.getAllMissionFromPool('spawn') || [];
        for (const task of tasks) {
            const memory = (task as any)?.data?.memory;
            if (!memory?.role) continue;
            if (memory.homeRoom && memory.homeRoom !== homeRoom.name) continue;
            const key = `${memory.role}|${memory.targetRoom || ''}`;
            cache[key] = (cache[key] || 0) + 1;
        }
        roomAny._spawnRoleTargetCache = cache;
        roomAny._spawnRoleTargetCacheTick = Game.time;
    }
    const key = `${role}|${targetRoomName}`;
    return (roomAny._spawnRoleTargetCache?.[key] || 0) as number;
}

const calcEnergyOutCarryTarget = (homeRoom: Room, targetRoomName: string, sourceNum: number, allowWorkCarry: boolean): number => {
    const lv = Math.max(1, Math.min(8, homeRoom.level));
    const baseNum = allowWorkCarry
        ? sourceNum
        : Math.max(sourceNum + 1, Math.ceil(sourceNum * 2));

    // 用线性房间距离估算往返时长（含装卸损耗），用于匹配搬运吞吐
    const linearDistance = Game.map.getRoomLinearDistance(homeRoom.name, targetRoomName, true);
    const oneWayTicks = 20 + linearDistance * 25;
    const roundTripTicks = oneWayTicks * 2 + 8;

    const harvestPerSource = OUTMINE_HARVEST_PER_SOURCE[lv];
    const estimatedIncomePerTick = harvestPerSource * sourceNum;
    const carryCapacity = OUTMINE_CARRY_CAPACITY[lv];
    const throughputNeed = Math.ceil((estimatedIncomePerTick * roundTripTicks) / Math.max(50, carryCapacity));
    const buffer = 1;
    const dynamicNum = throughputNeed + buffer;

    const cappedMax = Math.max(6, sourceNum * 7);
    return Math.min(cappedMax, Math.max(baseNum, dynamicNum));
}

const calcAggressiveSmallCarryTarget = (homeRoom: Room, targetRoomName: string, sourceNum: number, allowWorkCarry: boolean): number => {
    const lv = Math.max(1, Math.min(8, homeRoom.level));
    const baseCarryNum = calcEnergyOutCarryTarget(homeRoom, targetRoomName, sourceNum, allowWorkCarry);
    const largeCarryCapacity = OUTMINE_CARRY_CAPACITY[lv];
    const scale = Math.max(1, Math.ceil(largeCarryCapacity / OUTMINE_SMALL_CARRY_CAPACITY));

    // 把“大体型估算”换算到小体型数量，并给最低链路冗余。
    const scaledTarget = Math.ceil(baseCarryNum * scale * 1.6);
    const minBySource = Math.max(8, sourceNum * 8);
    const cap = Math.max(24, sourceNum * 42);
    return Math.min(cap, Math.max(minBySource, scaledTarget));
}

const getRoomMode = (room: Room): string => {
    return (getRoomData(room.name) as any)?.mode || (room.memory as any).mode || 'main';
}

const isAggressiveMode = (mode: string): boolean => {
    return mode === 'high' || mode === 'rush';
}

const getSmallCarryBody = (homeRoom: Room, targetRoomName: string): string => {
    // 不满足修路条件时，不切换为“低 MOVE 高 CARRY”体型。
    if (!RoadBuilder.shouldBuildRoad(homeRoom, targetRoomName)) return OUTMINE_SMALL_CARRY_BODY;

    const roomAny = homeRoom as any;
    if (!roomAny._outMineCarryBodyCache) roomAny._outMineCarryBodyCache = {};
    const cacheKey = targetRoomName;
    const cached = roomAny._outMineCarryBodyCache[cacheKey] as { tick: number; body: string } | undefined;
    if (cached && Game.time - cached.tick < OUTMINE_ROAD_BODY_CHECK_INTERVAL) {
        return cached.body;
    }

    const routePositions = RoadMemory
        .getGroupPositions(homeRoom.name, targetRoomName)
        .filter((pos) => pos.roomName !== homeRoom.name);
    if (routePositions.length === 0) {
        roomAny._outMineCarryBodyCache[cacheKey] = { tick: Game.time, body: OUTMINE_SMALL_CARRY_BODY };
        return OUTMINE_SMALL_CARRY_BODY;
    }

    let visibleCount = 0;
    let roadCount = 0;
    for (const pos of routePositions) {
        const room = Game.rooms[pos.roomName];
        if (!room) continue;
        visibleCount++;
        const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
        if (structures.some((s) => s.structureType === STRUCTURE_ROAD)) roadCount++;
    }

    const minVisible = Math.min(
        routePositions.length,
        Math.max(OUTMINE_ROAD_BODY_MIN_VISIBLE, Math.ceil(routePositions.length * 0.2))
    );
    const coverage = roadCount / Math.max(1, visibleCount);
    const body = visibleCount >= minVisible && coverage >= OUTMINE_ROAD_BODY_MIN_COVERAGE
        ? OUTMINE_ROAD_CARRY_BODY
        : OUTMINE_SMALL_CARRY_BODY;

    roomAny._outMineCarryBodyCache[cacheKey] = { tick: Game.time, body };
    return body;
}

/** 外矿采集模块 */
export default class OutMine extends Room {
    outMine() {
        if (this.memory.defend) return;
        if (Memory['warmode']) return;

        const qosLevel = getQoS()?.level || 'normal';
        if (qosLevel === 'emergency') return;

        if (qosLevel === 'normal' || shouldRun({ every: 5, allowLevels: ['constrained'] })) {
            RoadVisual.run();
            HighwayMineVisual.run();
        }
        this.EnergyMine();
        this.CenterMine();
    }

    EnergyMine() { // 能量矿
        const qosLevel = getQoS()?.level || 'normal';
        const roomMode = getRoomMode(this);
        const interval = qosLevel === 'constrained'
            ? (roomMode === 'rush' ? 10 : roomMode === 'high' ? 20 : 40)
            : (roomMode === 'rush' ? 5 : roomMode === 'high' ? 10 : 20);
        if (Game.time % interval != 0) return;
        const Mem = getOutMineData(this.name)?.['energy'];
        if (!Mem || !Mem.length) return;
        for (const roomName of Mem) {
            const targetRoom = Game.rooms[roomName];
            // 如果没有视野, 尝试侦查
            if (!targetRoom) {
                if (qosLevel === 'normal' || shouldRun({ every: 2, allowLevels: ['constrained'] })) {
                    scoutSpawn(this, roomName);    // 侦查
                }
                continue;
            }

            // 没有房间视野不孵化
            if (!targetRoom) continue;


            // 造路
            if (Game.time % EXTERNAL_ROAD_CONFIG.BUILD_INTERVAL == 0 && this.level >= EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL) {
                if (qosLevel === 'normal' || shouldRun({ every: 2, allowLevels: ['constrained'] })) {
                    RoadBuilder.createRoadSites(this, targetRoom)
                }
            }


            const sourceNum = targetRoom.source?.length || targetRoom.find(FIND_SOURCES).length || 0;
            if (sourceNum == 0) continue;

            const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
                filter: (c) => (
                    (c.owner.username === 'Invader' ||
                    c.owner.username === 'Source Keeper' ||
                    c.getActiveBodyparts(ATTACK) > 0 ||
                    c.getActiveBodyparts(RANGED_ATTACK) > 0) &&
                    !c.isWhiteList()
                )
            });

            if (hostiles.some(c => {
                if (c.owner.username === 'Invader') return false;
                if (c.owner.username === 'Source Keeper') return false;
                return true;
            })) {
                // 二人小队防御
                outDoubleDefendSpawn(this, targetRoom, hostiles)
            } else {
                outDefendSpawn(this, targetRoom, hostiles)
            }

            // 有带攻击组件的敌人时不孵化
            if (hostiles.length > 0) continue;

            const controller = targetRoom.controller;
            const myUserName = this.controller.owner.username;
            if (controller?.owner && controller.owner.username !== myUserName) continue;

            if (this.level >= 3 && (qosLevel === 'normal' || shouldRun({ every: 2, allowLevels: ['constrained'] }))) {
                outReserverSpawn(this, targetRoom);    // 预定
            }

            if (controller.reservation &&
                controller.reservation.username !== myUserName) continue;

            outHarvesterSpawn(this, targetRoom, sourceNum);    // 采集

            // high/rush 模式自动使用激进搬运：更多小体型 + 交接链路
            const allowWorkCarry = this.level >= EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL;
            const carryNum = calcEnergyOutCarryTarget(this, roomName, sourceNum, allowWorkCarry);
            const aggressiveCarry = isAggressiveMode(roomMode);
            if (aggressiveCarry) {
                const baseNum = calcAggressiveSmallCarryTarget(this, roomName, sourceNum, allowWorkCarry);
                const num = roomMode === 'rush'
                    ? Math.min(Math.max(30, sourceNum * 56), Math.ceil(baseNum * 1.35))
                    : baseNum;
                const maxSpawnPerTick = roomMode === 'rush'
                    ? Math.max(3, Math.min(14, sourceNum * 5))
                    : Math.max(2, Math.min(10, sourceNum * 4));
                const smallCarryBody = getSmallCarryBody(this, roomName);
                outCarry2Spawn(this, targetRoom, num, allowWorkCarry, true, true, maxSpawnPerTick, smallCarryBody);
            } else {
                outCarrySpawn(this, targetRoom, carryNum, allowWorkCarry, false);
            }
            
            if (qosLevel === 'normal') {
                outBuilderSpawn(this, targetRoom);    // 建造
            }
        }
    }

    CenterMine() { // 中央九房
        const qosLevel = getQoS()?.level || 'normal';
        const roomMode = getRoomMode(this);
        const interval = qosLevel === 'constrained'
            ? (roomMode === 'rush' ? 6 : roomMode === 'high' ? 10 : 20)
            : (roomMode === 'rush' ? 4 : roomMode === 'high' ? 5 : 10);
        if (Game.time % interval != 0) return;
        const Mem = getOutMineData(this.name)?.['centerRoom'];
        if (!Mem || !Mem.length) return;
        for (const roomName of Mem) {
            const targetRoom = Game.rooms[roomName];
            // 如果没有视野, 尝试侦查
            if (!targetRoom) {
                if (qosLevel === 'normal' || shouldRun({ every: 2, allowLevels: ['constrained'] })) {
                    scoutSpawn(this, roomName);    // 侦查
                }
                continue;
            }
            // 没有房间视野不孵化
            if (!targetRoom) continue;

            // 造路
            if (Game.time % EXTERNAL_ROAD_CONFIG.BUILD_INTERVAL == 0 && this.level >= EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL) {
                if (qosLevel === 'normal' || shouldRun({ every: 2, allowLevels: ['constrained'] })) {
                    RoadBuilder.createRoadSites(this, targetRoom)
                }
            }

            const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
                filter: (creep) => !Memory['whitelist']?.includes(creep.owner.username)
            });
            const dangerousHostiles = hostiles.filter((creep) =>
                creep.owner.username !== 'Source Keeper' &&
                (creep.getActiveBodyparts(ATTACK) > 0 || creep.getActiveBodyparts(RANGED_ATTACK) > 0)
            );

            // 有敌人时暂停孵化
            if (dangerousHostiles.length > 0) {
                outDoubleDefendSpawn(this, targetRoom, dangerousHostiles);    // 防御
                continue;
            }

            if (!(/^[EW]\d*[5][NS]\d*[5]$/.test(roomName))) {
                outAttackSpawn(this, targetRoom);    // 攻击者
                const hasSourceKeeper = hostiles.some((creep) => creep.owner.username === 'Source Keeper');
                const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
                const outerAttackers = (CreepByTargetRoom['out-attack'] || []).length;
                // 有Source Keeper, 且没有攻击者时不孵化
                if (hasSourceKeeper && outerAttackers < 1) continue;
            }

            const centerSourceNum = 3;

            outHarvesterSpawn(this, targetRoom, centerSourceNum, true);    // 采集
            const mineral = targetRoom[FIND_MINERALS] || targetRoom.find(FIND_MINERALS)[0];
            if (mineral && mineral.mineralAmount > 0) {
                outMineSpawn(this, targetRoom);
            }    // 采矿
            const allowWorkCarry = this.level >= EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL;
            const centerCarryNum = calcEnergyOutCarryTarget(this, roomName, centerSourceNum, allowWorkCarry);
            if (isAggressiveMode(roomMode)) {
                // 中央九房链路更长、吞吐更高，按更高等效 source 数做激进估算。
                const effectiveCenterSource = Math.max(4, centerSourceNum + 1);
                const baseNum = calcAggressiveSmallCarryTarget(this, roomName, effectiveCenterSource, allowWorkCarry);
                const num = roomMode === 'rush'
                    ? Math.min(Math.max(36, effectiveCenterSource * 56), Math.ceil(baseNum * 1.4))
                    : baseNum;
                const smallCarryBody = getSmallCarryBody(this, roomName);
                const maxSpawnPerTick = roomMode === 'rush'
                    ? Math.max(4, Math.min(16, effectiveCenterSource * 4))
                    : Math.max(3, Math.min(12, effectiveCenterSource * 3));
                outCarry2Spawn(this, targetRoom, num, allowWorkCarry, true, true, maxSpawnPerTick, smallCarryBody);    // 激进搬运
            } else {
                outCarrySpawn(this, targetRoom, centerCarryNum, allowWorkCarry, false);    // 搬运
            }
            if (qosLevel === 'normal') {
                outBuilderSpawn(this, targetRoom);    // 建造
            }
        }
    }
}


// 侦查
const scoutSpawn = function (homeRoom: Room, targetRoomName: string) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoomName);
    const scouts = (CreepByTargetRoom['scout'] || []).length;
    const spawnNum = getSpawnRoleNum(homeRoom, 'scout');
    if (scouts + spawnNum > 0) return false;

    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoomName } as CreepMemory;
    homeRoom.SpawnMissionAdd('OS', [], OUTMINE_PRIORITY.scout, 'scout', memory);
    return true;
}

// 中九房攻击者
const outAttackSpawn = function (homeRoom: Room, targetRoom: Room) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerAttackers = (CreepByTargetRoom['out-attack']||[]).filter((c: any) => c.ticksToLive > 300 || c.spawning);
    const creepNum = (outerAttackers||[]).length;
    const spawnNum = getSpawnRoleNum(homeRoom, 'out-attack');
    if (creepNum + spawnNum >= 1) return false; 

    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
    homeRoom.SpawnMissionAdd('OA', [], -1, 'out-attack', memory);
    return true;
}

// 中九房防御
const outRangedSpawn = function (homeRoom: Room, targetRoom: Room) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerRanged = (CreepByTargetRoom['out-ranged']||[]).filter((c: any) => c.ticksToLive > 300 || c.spawning);
    const creepNum = (outerRanged||[]).length;
    const spawnNum = getSpawnRoleNum(homeRoom, 'out-ranged');
    if (creepNum + spawnNum >= 1) return false;
    
    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
    homeRoom.SpawnMissionAdd('OR', [], -1, 'out-ranged', memory);
    return true;
}

// 元素矿采集者
const outMineSpawn = function (homeRoom: Room, targetRoom: Room) {
    if (homeRoom.level < 6) return false;
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerMiners = (CreepByTargetRoom['out-mineral'] || []).length;
    const spawnNum = getSpawnRoleNum(homeRoom, 'out-mineral');
    if (outerMiners + spawnNum >= 1) return false;

    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
    homeRoom.SpawnMissionAdd('OMR', [], OUTMINE_PRIORITY.mineral, 'out-mineral', memory);
    return true;
}

// 防御
const outDefendSpawn = function (homeRoom: Room, targetRoom: Room, hostiles: Creep[]) {
    const invaderCore = targetRoom.find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType === STRUCTURE_INVADER_CORE
    });

    if (invaderCore.length === 0 && hostiles.length === 0) return false;

    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerDefenders = (CreepByTargetRoom['out-defend'] || []).length;
    const outerInvaders = (CreepByTargetRoom['out-invader'] || []).length;

    let role: string;
    let memory: any;
    let name: string;

    if(hostiles.length > 0) {
        const spawnNum = getSpawnRoleNum(homeRoom, 'out-defend');
        let maxNum = 1;
        if (homeRoom.level < 4) maxNum = 3;
        else if (homeRoom.level < 6) maxNum = 2;
        if (outerDefenders + spawnNum >= maxNum) return false;
        role = 'out-defend';
        memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name };
        name = 'OD';
        if(!memory) return false;
        homeRoom.SpawnMissionAdd(name, [], -1, role, memory);
        return true;
    }
    if(invaderCore.length > 0) {
        const spawnNum = getSpawnRoleNum(homeRoom, 'out-invader');
        let maxNum = 1;
        if (homeRoom.level < 4) maxNum = 4;
        else if (homeRoom.level < 6) maxNum = 3;
        else if (homeRoom.level == 6) maxNum = 2;
        if (outerInvaders + spawnNum >= maxNum) return false;
        role = 'out-invader';
        memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name };
        name = 'OI';
        if(!memory) return false;
        homeRoom.SpawnMissionAdd(name, [], -1, role, memory);
        return true;
    }
    
    return false;
}

const outDoubleDefendSpawn = function (homeRoom: Room, targetRoom: Room, hostiles: Creep[]) {
    if (hostiles.length == 0) return false;

    if (homeRoom.level < DOUBLE_DEFEND_MIN_LEVEL) {
        homeRoom.deleteSpawnMissionsByRole(['out-2attack', 'out-2heal']);
        return outDefendSpawn(homeRoom, targetRoom, hostiles);
    }

    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const out2Attack = (CreepByTargetRoom['out-2attack'] || []).length || 0;
    const out2AttackSpawnNum = getSpawnRoleNum(homeRoom, 'out-2attack');
    if (out2Attack + out2AttackSpawnNum >= 1) return false;
    const out2Heal = (CreepByTargetRoom['out-2heal'] || []).length;
    const out2HealSpawnNum = getSpawnRoleNum(homeRoom, 'out-2heal');
    if (out2Heal + out2HealSpawnNum >= 1) return false;

    homeRoom.SpawnMissionAdd('', [], -1, 'out-2attack', { targetRoom: targetRoom.name } as any);
    homeRoom.SpawnMissionAdd('', [], -1, 'out-2heal', { targetRoom: targetRoom.name } as any);
    return true;
}

// 采集
const outHarvesterSpawn = function (homeRoom: Room, targetRoom: Room, sourceNum: number, upbody?: boolean) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerHarvesters = (CreepByTargetRoom['out-harvest'] || []).length;
    const spawnNum = getSpawnRoleNum(homeRoom, 'out-harvest');
    if (outerHarvesters + spawnNum >= sourceNum) return false; 

    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
    if (upbody) {
        homeRoom.SpawnMissionAdd('OH', [[WORK, 16],[CARRY, 6],[MOVE, 8]], OUTMINE_PRIORITY.harvest, 'out-harvest', memory);
    } else {
        homeRoom.SpawnMissionAdd('OH', [], OUTMINE_PRIORITY.harvest, 'out-harvest', memory);
    }
    return true;
}

// 搬运
const outCarrySpawn = function (
    homeRoom: Room,
    targetRoom: Room,
    num: number,
    allowWorkCarry = true,
    aggressiveCarry = false
) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerCarry = (CreepByTargetRoom['out-carry'] || [])
                        .filter((c: any) => c.homeRoom == homeRoom.name).length;
    const outerCar = (CreepByTargetRoom['out-car'] || [])
                        .filter((c: any) => c.homeRoom == homeRoom.name).length;
    
    const spawnCarryNum = getSpawnRoleNumByTarget(homeRoom, 'out-carry', targetRoom.name);
    const spawnCarNum = getSpawnRoleNumByTarget(homeRoom, 'out-car', targetRoom.name);

    if (!allowWorkCarry) {
        const totalCarry = outerCarry + spawnCarryNum + outerCar + spawnCarNum;
        if (totalCarry < num) {
            const role = 'out-carry';
            const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name, aggressiveCarry } as CreepMemory;
            homeRoom.SpawnMissionAdd('OC', [], OUTMINE_PRIORITY.carry, role, memory);
            return true;
        }
        return false;
    }

    if (outerCar + spawnCarNum == 0) {
        const role = 'out-car';
        const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name, aggressiveCarry } as CreepMemory;
        homeRoom.SpawnMissionAdd('OC', [], OUTMINE_PRIORITY.carry, role, memory);
        return true;
    }

    if (outerCarry + spawnCarryNum < num - 1) {
        const role = 'out-carry';
        const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name, aggressiveCarry } as CreepMemory;
        homeRoom.SpawnMissionAdd('OC', [], OUTMINE_PRIORITY.carry, role, memory);
        return true;
    }

    return false;
}

// 搬运
const outCarry2Spawn = function (
    homeRoom: Room,
    targetRoom: Room,
    num: number,
    allowWorkCarry = true,
    aggressiveCarry = false,
    preferSmall = false,
    maxSpawnPerTick = 1,
    smallCarryBody = OUTMINE_SMALL_CARRY_BODY
) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerCarry = (CreepByTargetRoom['out-carry'] || [])
                        .filter((c: any) => c.homeRoom == homeRoom.name).length;
    const outerCar = (CreepByTargetRoom['out-car'] || [])
                        .filter((c: any) => c.homeRoom == homeRoom.name).length;
    
    const spawnCarryNum = getSpawnRoleNumByTarget(homeRoom, 'out-carry', targetRoom.name);
    const spawnCarNum = getSpawnRoleNumByTarget(homeRoom, 'out-car', targetRoom.name);

    if (preferSmall) {
        const totalCarry = outerCarry + spawnCarryNum + outerCar + spawnCarNum;
        const needNum = num - totalCarry;
        if (needNum > 0) {
            const role = 'out-carry';
            const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name, aggressiveCarry } as CreepMemory;
            const spawnNum = Math.min(Math.max(1, maxSpawnPerTick), needNum);
            let spawned = 0;
            for (let i = 0; i < spawnNum; i++) {
                const ret = homeRoom.SpawnMissionAdd('OC', smallCarryBody, OUTMINE_PRIORITY.carry, role, memory);
                if (ret !== OK) break;
                spawned++;
            }
            return spawned > 0;
        }
        return false;
    }

    if (!allowWorkCarry) {
        const totalCarry = outerCarry + spawnCarryNum + outerCar + spawnCarNum;
        if (totalCarry < num) {
            const role = 'out-carry';
            const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name, aggressiveCarry } as CreepMemory;
            homeRoom.SpawnMissionAdd('OC', smallCarryBody, OUTMINE_PRIORITY.carry, role, memory);
            return true;
        }
        return false;
    }

    if (outerCar + spawnCarNum == 0) {
        const role = 'out-car';
        const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name, aggressiveCarry } as CreepMemory;
        homeRoom.SpawnMissionAdd('OC', 'w1c4m4', OUTMINE_PRIORITY.carry, role, memory);
        return true;
    }

    if (outerCarry + spawnCarryNum < num - 1) {
        const role = 'out-carry';
        const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name, aggressiveCarry } as CreepMemory;
        homeRoom.SpawnMissionAdd('OC', smallCarryBody, OUTMINE_PRIORITY.carry, role, memory);
        return true;
    }

    return false;
}

// 预定
const outReserverSpawn = function (homeRoom: Room, targetRoom: Room) {
    if (!targetRoom.controller || targetRoom.controller.my) return false;
    if(homeRoom.controller.level < 3) return false;

    if (targetRoom.controller.reservation &&
        targetRoom.controller.reservation.username == homeRoom.controller.owner.username &&
        targetRoom.controller.reservation.ticksToEnd > 1000) return false;

    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerReservers = (CreepByTargetRoom['reserver'] || []).length;

    const spawnNum = getSpawnRoleNum(homeRoom, 'reserver');
    if (outerReservers + spawnNum >= 1) return false;

    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
    homeRoom.SpawnMissionAdd('', '', OUTMINE_PRIORITY.reserver, 'reserver', memory);
    return true;
}

// 建造
const outBuilderSpawn = function (homeRoom: Room, targetRoom: Room) {
    const constructionSite = targetRoom.find(FIND_CONSTRUCTION_SITES, {
        filter: (site) => site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER
    });
    if (constructionSite.length === 0) return false;

    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerBuilder = (CreepByTargetRoom['out-build'] || []).length;
    const spawnNum = getSpawnRoleNum(homeRoom, 'out-build');

    let num = 1;
    if (constructionSite.length > 10) num = 2;
    if (outerBuilder + spawnNum >= num) return false;
    
    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
    homeRoom.SpawnMissionAdd('OB', '', OUTMINE_PRIORITY.build, 'out-build', memory);
    return true;
}
