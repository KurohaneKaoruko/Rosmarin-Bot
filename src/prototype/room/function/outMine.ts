import { OUTMINE_CONFIG, EXTERNAL_ROAD_CONFIG } from '@/constant/config';
import { RoadBuilder, RoadVisual } from '@/modules/feature/externalRoad';

/** 外矿采集模块 */
export default class OutMine extends Room {
    outMine() {
        if (this.memory.defend) return;
        if (Memory['warmode']) return;

        RoadVisual.run()
        this.EnergyMine();
        this.CenterMine();
    }

    EnergyMine() { // 能量矿
        if (Game.time % 20 != 0) return;
        const Mem = Memory['OutMineData'][this.name]?.['energy'];
        if (!Mem || !Mem.length) return;
        // 孵化任务数统计
        this.getSpawnMissionNum();
        for (const roomName of Mem) {
            const targetRoom = Game.rooms[roomName];
            // 如果没有视野, 尝试侦查
            if (!targetRoom) {
                scoutSpawn(this, roomName);    // 侦查
                continue;
            }

            // 没有房间视野不孵化
            if (!targetRoom) continue;


            // 造路
            if (Game.time % EXTERNAL_ROAD_CONFIG.BUILD_INTERVAL == 0 && this.level >= EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL) {
                RoadBuilder.createRoadSites(this, targetRoom)
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

            if (this.level >= 3) outReserverSpawn(this, targetRoom);    // 预定

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
            
            outBuilderSpawn(this, targetRoom);    // 建造
        }
    }

    CenterMine() { // 中央九房
        if (Game.time % 10 != 0) return;
        const Mem = Memory['OutMineData'][this.name]?.['centerRoom'];
        if (!Mem || !Mem.length) return;
        // 孵化任务数统计
        this.getSpawnMissionNum();
        for (const roomName of Mem) {
            const targetRoom = Game.rooms[roomName];
            // 如果没有视野, 尝试侦查
            if (!targetRoom) {
                scoutSpawn(this, roomName);    // 侦查
                continue;
            }
            // 没有房间视野不孵化
            if (!targetRoom) continue;

            // 造路
            if (Game.time % EXTERNAL_ROAD_CONFIG.BUILD_INTERVAL == 0 && this.level >= EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL) {
                RoadBuilder.createRoadSites(this, targetRoom)
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
            outBuilderSpawn(this, targetRoom);    // 建造
        }
    }
}


// 侦查
const scoutSpawn = function (homeRoom: Room, targetRoomName: string) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoomName);
    const scouts = (CreepByTargetRoom['scout'] || []).length;
    const spawnNum = global.SpawnMissionNum[homeRoom.name]['scout'] || 0;
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
    const spawnNum = global.SpawnMissionNum[homeRoom.name]['out-attack'] || 0;
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
    const spawnNum = global.SpawnMissionNum[homeRoom.name]['out-ranged'] || 0;
    if (creepNum + spawnNum >= 1) return false;
    
    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
    homeRoom.SpawnMissionAdd('OR', [], -1, 'out-ranged', memory);
    return true;
}

// 元素矿采集者
const outMineSpawn = function (homeRoom: Room, targetRoom: Room) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerMiners = (CreepByTargetRoom['out-mineral'] || []).length;
    const spawnNum = global.SpawnMissionNum[homeRoom.name]['out-mineral'] || 0;
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
        const spawnNum = global.SpawnMissionNum[homeRoom.name]['out-defend'] || 0;
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
        const spawnNum = global.SpawnMissionNum[homeRoom.name]['out-invader'] || 0;
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
    const out2AttackSpawnNum = global.SpawnMissionNum[homeRoom.name]['out-2attack'] || 0;
    if (out2Attack + out2AttackSpawnNum >= 1) return false;
    const out2Heal = (CreepByTargetRoom['out-2heal'] || []).length;
    const out2HealSpawnNum = global.SpawnMissionNum[homeRoom.name]['out-2heal'] || 0;
    if (out2Heal + out2HealSpawnNum >= 1) return false;

    homeRoom.SpawnMissionAdd('', [], -1, 'out-2attack', { targetRoom: targetRoom.name } as any);
    homeRoom.SpawnMissionAdd('', [], -1, 'out-2heal', { targetRoom: targetRoom.name } as any);
    return true;
}

// 采集
const outHarvesterSpawn = function (homeRoom: Room, targetRoom: Room, sourceNum: number, upbody?: boolean) {
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
    const outerHarvesters = (CreepByTargetRoom['out-harvest'] || []).length;
    const spawnNum = global.SpawnMissionNum[homeRoom.name]['out-harvest'] || 0;
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
    
    const spawnCarryNum = global.SpawnMissionNum[homeRoom.name]['out-carry'] || 0;
    const spawnCarNum = global.SpawnMissionNum[homeRoom.name]['out-car'] || 0;

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
    
    const spawnCarryNum = global.SpawnMissionNum[homeRoom.name]['out-carry'] || 0;
    const spawnCarNum = global.SpawnMissionNum[homeRoom.name]['out-car'] || 0;

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

    const spawnNum = global.SpawnMissionNum[homeRoom.name]['reserver'] || 0;
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
    const spawnNum = global.SpawnMissionNum[homeRoom.name]['out-build'] || 0;

    let num = 1;
    if (constructionSite.length > 10) num = 2;
    if (outerBuilder + spawnNum >= num) return false;
    
    const memory = { homeRoom: homeRoom.name, targetRoom: targetRoom.name } as CreepMemory;
    homeRoom.SpawnMissionAdd('OB', '', -1, 'out-build', memory);
    return true;
}

// 获取到指定房间工作creep数量, 根据role分组
const getCreepByTargetRoom = function (targetRoom: string) {
    if (global.CreepByTargetRoom &&
        global.CreepByTargetRoom.time === Game.time) {
        // 如果当前tick已经统计过，则直接返回
        return global.CreepByTargetRoom[targetRoom] || {};
    } else {
        // 如果当前tick没有统计过，则重新统计
        global.CreepByTargetRoom = { time: Game.time };
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            const role = creep.memory.role;
            const targetRoom = creep.memory.targetRoom;
            if (!role || !targetRoom) continue;
            if (!global.CreepByTargetRoom[targetRoom]) {
                global.CreepByTargetRoom[targetRoom] = {};
            }
            if (!global.CreepByTargetRoom[targetRoom][role]) {
                global.CreepByTargetRoom[targetRoom][role] = [];
            }
            global.CreepByTargetRoom[targetRoom][role].push({
                ticksToLive: creep.ticksToLive,
                spawning: creep.spawning,
                homeRoom: creep.memory.homeRoom,
            });
        }
        return global.CreepByTargetRoom[targetRoom] || {};
    }
}

/**
 * @deprecated 此函数已弃用，请使用 RoadBuilder.createRoadSites
 * 保留此函数仅用于参考，将在未来版本中删除
 */
// const createRoadSite = function (room: Room, targetRoom: Room) {
//     if (!Memory['OutMineData'][room.name]['Road'])
//         Memory['OutMineData'][room.name]['Road'] = {};
//     
//     let outMineRoadMem = Memory['OutMineData'][room.name]['Road'];
//     let roadsMem = outMineRoadMem[targetRoom.name];
//     if (roadsMem && roadsMem.length > 0) {
//         for (let road of roadsMem) {
//             let [r, xy] = road;
//             let [x, y] = decompress(xy);
//             let pos = new RoomPosition(x, y, r);
//             pos.createConstructionSite(STRUCTURE_ROAD);
//         }
//         return;
//     }
// 
//     roadsMem = outMineRoadMem[targetRoom.name] = [];
//     let center = Memory['RoomControlData'][room.name].center || {x: 25, y: 25};
//     let centerPos = new RoomPosition(center.x, center.y, room.name);
//     if (!global.OutMineRoadPathFinderCosts) global.OutMineRoadPathFinderCosts = {};
//     let sources = []
//     if (/^[EW]\d*[456][NS]\d*[456]$/.test(targetRoom.name)) {
//         sources = [...targetRoom.find(FIND_SOURCES), ...targetRoom.find(FIND_MINERALS)]
//     } else {
//         sources = targetRoom.find(FIND_SOURCES)
//     }
//     for (let s of sources) {
//         PathFinder.search(
//             centerPos,
//             { pos: s.pos, range: 1 },
//             {
//                 plainCost: 2,
//                 swampCost: 4,
//                 maxOps: 10000,
//                 roomCallback: function(roomName) {
//                     if (global.OutMineRoadPathFinderCosts[roomName]) {
//                         return global.OutMineRoadPathFinderCosts[roomName];
//                     }
// 
//                     let costs = new PathFinder.CostMatrix();
// 
//                     for (let r1 in Memory['OutMineData']) {
//                         for (let r2 in Memory['OutMineData'][r1]['Road']) {
//                             if (!Memory['OutMineData'][r1]['Road'][r2]) continue;
//                             for (let road of Memory['OutMineData'][r1]['Road'][r2]) {
//                                 let [r, xy] = road;
//                                 if (r !== roomName) continue;
//                                 let [x, y] = decompress(xy);
//                                 costs.set(x, y, 1)
//                             }
//                         }
//                     }
// 
//                     if (Game.rooms[roomName]) {
//                         let roads = Game.rooms[roomName].find(FIND_STRUCTURES, {
//                             filter: (s) => s.structureType === STRUCTURE_ROAD
//                         });
//                         for (let road of roads) {
//                             costs.set(road.pos.x, road.pos.y, 1);
//                         };
//                     }
// 
//                     global.OutMineRoadPathFinderCosts[roomName] = costs;
//                     return costs;
//                 }
//             }
//         ).path.forEach((pos) => {
//             if (pos.roomName === room.name) return;
//             roadsMem.push([pos.roomName, compress(pos.x, pos.y)]);
//             let costs = null;
//             if (global.OutMineRoadPathFinderCosts[pos.roomName]) {
//                 costs = global.OutMineRoadPathFinderCosts[pos.roomName];
//             } else {
//                 costs = new PathFinder.CostMatrix();
//             }
//             costs.set(pos.x, pos.y, 1);
//             global.OutMineRoadPathFinderCosts[pos.roomName] = costs;
//         })
//     }
// }