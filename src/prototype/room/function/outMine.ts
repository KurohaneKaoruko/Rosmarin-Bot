import { OUTMINE_CONFIG, EXTERNAL_ROAD_CONFIG } from '@/constant/config';
import { RoadBuilder, RoadVisual } from '@/modules/feature/externalRoad';
import { HighwayMineVisual } from '@/modules/feature/highwayMineVisual';
import { getCreepByTargetRoom } from '@/modules/utils/creepTickIndex';
import { getQoS, shouldRun } from '@/modules/infra/qos';
import { getOutMineData } from '@/modules/utils/memory';

const getSpawnRoleNum = (homeRoom: Room, role: string): number => {
    // 读取指定角色在孵化队列中的数量
    return homeRoom.getSpawnMissionNum()?.[role] || 0;
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
        const interval = qosLevel === 'constrained' ? 40 : 20;
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

            // 外矿加速搬运策略 OutSpeedCarryTactics
            if (Game.flags[`${this.name}/OSCT`] || Game.flags[`ALL/OSCT`]) {
                let num = sourceNum;
                if (this.level <= 4) {
                    num *= 2.5
                } else {
                    num *= 3.5
                }
                outCarry2Spawn(this, targetRoom, num);
            } else {
                outCarrySpawn(this, targetRoom, sourceNum);
            }
            
            if (qosLevel === 'normal') {
                outBuilderSpawn(this, targetRoom);    // 建造
            }
        }
    }

    CenterMine() { // 中央九房
        const qosLevel = getQoS()?.level || 'normal';
        const interval = qosLevel === 'constrained' ? 20 : 10;
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
                filter: (creep) => (
                    (creep.getActiveBodyparts(ATTACK) > 0 ||
                    creep.getActiveBodyparts(RANGED_ATTACK) > 0) &&
                    creep.owner.username !== 'Source Keeper' &&
                    !Memory['whitelist']?.includes(creep.owner.username)
                )
            });

            // 有敌人时暂不孵化
            if (hostiles.length > 0) {
                outDoubleDefendSpawn(this, targetRoom, hostiles);    // 防御
                continue;
            }

            if (!(/^[EW]\d*[5][NS]\d*[5]$/.test(roomName))) {
                outAttackSpawn(this, targetRoom);    // 攻击者
                const SourceKeeper = targetRoom.find(FIND_HOSTILE_CREEPS, {
                    filter: (creep) => (
                        creep.owner.username === 'Source Keeper'
                    )
                });
                const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
                const outerAttackers = (CreepByTargetRoom['out-attack'] || []).length;
                // 有Source Keeper, 且没有攻击者时不孵化
                if (SourceKeeper.length > 0 && outerAttackers < 1) continue;
            }

            
            outHarvesterSpawn(this, targetRoom, 3, true);    // 采集
            const mineral = targetRoom[FIND_MINERALS] || targetRoom.find(FIND_MINERALS)[0];
            if (mineral && mineral.mineralAmount > 0) {
                outMineSpawn(this, targetRoom);
            }    // 采矿
            outCarrySpawn(this, targetRoom, 4);    // 搬运
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
    homeRoom.SpawnMissionAdd('OS', [], -1, 'scout', memory);
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
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerMiners = (CreepByTargetRoom['out-mineral'] || []).length;
    const spawnNum = getSpawnRoleNum(homeRoom, 'out-mineral');
    if (outerMiners + spawnNum >= 1) return false;

    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
    homeRoom.SpawnMissionAdd('OMR', [], -1, 'out-mineral', memory);
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
        homeRoom.SpawnMissionAdd('OH', [[WORK, 16],[CARRY, 6],[MOVE, 8]], -1, 'out-harvest', memory);
    } else {
        homeRoom.SpawnMissionAdd('OH', [], -1, 'out-harvest', memory);
    }
    return true;
}

// 搬运
const outCarrySpawn = function (homeRoom: Room, targetRoom: Room, num: number) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerCarry = (CreepByTargetRoom['out-carry'] || [])
                        .filter((c: any) => c.homeRoom == homeRoom.name).length;
    const outerCar = (CreepByTargetRoom['out-car'] || [])
                        .filter((c: any) => c.homeRoom == homeRoom.name).length;
    
    const spawnCarryNum = getSpawnRoleNum(homeRoom, 'out-carry');
    const spawnCarNum = getSpawnRoleNum(homeRoom, 'out-car');

    if (outerCar + spawnCarNum == 0) {
        const role = 'out-car';
        const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
        homeRoom.SpawnMissionAdd('OC', [], -1, role, memory);
        return true;
    }

    if (outerCarry + spawnCarryNum < num - 1) {
        const role = 'out-carry';
        const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
        homeRoom.SpawnMissionAdd('OC', [], -1, role, memory);
        return true;
    }

    return false;
}

// 搬运
const outCarry2Spawn = function (homeRoom: Room, targetRoom: Room, num: number) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerCarry = (CreepByTargetRoom['out-carry'] || [])
                        .filter((c: any) => c.homeRoom == homeRoom.name).length;
    const outerCar = (CreepByTargetRoom['out-car'] || [])
                        .filter((c: any) => c.homeRoom == homeRoom.name).length;
    
    const spawnCarryNum = getSpawnRoleNum(homeRoom, 'out-carry');
    const spawnCarNum = getSpawnRoleNum(homeRoom, 'out-car');

    if (outerCar + spawnCarNum == 0) {
        const role = 'out-car';
        const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
        homeRoom.SpawnMissionAdd('OC', 'w1c5m3', -1, role, memory);
        return true;
    }

    if (outerCarry + spawnCarryNum < num - 1) {
        const role = 'out-carry';
        const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
        homeRoom.SpawnMissionAdd('OC', 'c6m3', -1, role, memory);
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
    homeRoom.SpawnMissionAdd('', '', -1, 'reserver', memory);
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
    homeRoom.SpawnMissionAdd('OB', '', -1, 'out-build', memory);
    return true;
}
