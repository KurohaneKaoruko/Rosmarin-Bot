import { OUTMINE_CONFIG, ROAD_CONFIG } from '@/constant/config';
import { compress, decompress } from '@/utils';
import { RoadBuilder, RoadMemory, CostMatrixCache } from '@/modules/utils/outMineRoad';
import { RoadVisual } from '@/modules/utils/outMineRoad';

/** 外矿采集模块 */
export default class OutMine extends Room {
    outMine() {
        if (this.memory.defend) return;
        if (Memory['warmode']) return;

        RoadVisual.run()
        this.EnergyMine();
        this.CenterMine();
        this.LookHighWay();
        this.PowerMine();
        this.DepositMine();
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
            if (Game.time % ROAD_CONFIG.BUILD_INTERVAL == 0 && this.level >= ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL) {
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
            if (Game.flags[`${this.name}/OSCT`]) {
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
            if (Game.time % ROAD_CONFIG.BUILD_INTERVAL == 0 && this.level >= ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL) {
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

    // 观察过道
    LookHighWay() {
        // 能量储备不足时不添加过道采集任务
        if (this[RESOURCE_ENERGY] < 50000) return;
        const outminePower = Memory['RoomControlData'][this.name]['outminePower'];
        const outmineDeposit = Memory['RoomControlData'][this.name]['outmineDeposit'];
        // 没开启自动挖就不找
        if (!outminePower && !outmineDeposit) return;
        const LOOK_INTERVAL = OUTMINE_CONFIG.LOOK_INTERVAL;
        if (Game.time % LOOK_INTERVAL > 1) return;
        // 监控列表
        let lookList = Memory['OutMineData'][this.name]?.['highway'] || [];
        if (lookList.length == 0) return;
        // 观察
        if (Game.time % LOOK_INTERVAL == 0) {
            if (!this.observer) return;
            // 观察编号
            let lookIndex = Math.floor(Game.time / LOOK_INTERVAL) % lookList.length;
            const roomName = lookList[lookIndex];
            // 没有视野才看
            if (!Game.rooms[roomName]) {
                this.observer.observeRoom(roomName);
            }
            return;
        }
        // 处理
        for(const roomName of lookList) {
            if (/^[EW]\d*[1-9][NS]\d*[1-9]$/.test(roomName)) continue;

            const room = Game.rooms[roomName];
            if (!room) continue;    // 没有视野不处理

            if (!this.memory['powerMine']) this.memory['powerMine'] = {};
            if (!this.memory['depositMine']) this.memory['depositMine'] = {};
            
            // power
            if (outminePower && !this.memory['powerMine'][roomName]) {
                let P_num = PowerBankCheck(room);
                if (P_num) {
                    const power = room.find(FIND_STRUCTURES,{
                        filter:(s)=>s.structureType===STRUCTURE_POWER_BANK
                    })[0].power;
                    let data = PowerMineMissionData(this, P_num, power);
                    this.memory['powerMine'][roomName] = data;
                    console.log(`在 ${roomName} 发现 PowerBank (${power} power), 已加入开采队列。`);
                    console.log(`将从 ${this.name} 派出 ${data.creep} 数量的T${data.boostLevel}采集队。Ranged数量:${data.prNum}。`);
                }
            }

            // deposit
            if (outmineDeposit && !this.memory['depositMine'][roomName]) {
                let D_num = DepositCheck(room);
                if (D_num > 0) {
                    this.memory['depositMine'][roomName] = {
                        num: D_num,      // 工作数
                        active: true,      // 任务是否激活
                    };
                    console.log(`在 ${roomName} 发现 Deposit, 已加入开采队列。`);
                    console.log(`将从 ${this.name} 派出总共 ${D_num} 数量的采集队。`);
                }
            }
        }
    }

    PowerMine() {
        const LOOK_INTERVAL = OUTMINE_CONFIG.LOOK_INTERVAL;
        if (Game.time % LOOK_INTERVAL != 1) return;
        const powerMines = this.memory['powerMine'];
        if (!powerMines || Object.keys(powerMines).length == 0) return;

        // 孵化任务数统计
        const SpawnMissionNum = this.getSpawnMissionNum() || {};
        
        for (const targetRoom in powerMines) {
            const room = Game.rooms[targetRoom];
            const powerBank = room?.powerBank?.[0] ?? room?.find(FIND_STRUCTURES, {
                filter: (structure) => structure.structureType === STRUCTURE_POWER_BANK
            })[0];

            if (room && !powerBank) {
                // powerBank消失时才删除任务, 对于已放弃的任务也如此, 避免被再次添加
                delete this.memory['powerMine'][targetRoom];
                console.log(`${targetRoom} 的 PowerBank 已耗尽, 已移出开采队列。`);
                continue;
            }
            
            // 统计以targetRoom为工作目标的所有role情况
            const CreepByTargetRoom = getCreepByTargetRoom(targetRoom);
            const CreepBySpawnMissionNum = SpawnMissionNum;
            let pa = 0, ph = 0;
            let mineData = powerMines[targetRoom];
            let P_num = mineData.creep;
            if (!powerBank || powerBank.hits > 500000) {
                pa = (CreepByTargetRoom['power-attack'] || [])
                    .filter((c: any) => c.spawning || c.ticksToLive > 100).length;
                ph = (CreepByTargetRoom['power-heal'] || [])
                    .filter((c: any) => c.spawning || c.ticksToLive > 100).length;
            } else {
                pa = (CreepByTargetRoom['power-attack'] || []).length;
                ph = (CreepByTargetRoom['power-heal'] || []).length;
                P_num = 1;
            }
            // 孵化计数未达到上限才考虑孵化
            // 孵化上限略比任务需求高, 只有意外情况会导致计数到达上限, 此时将放弃任务
            if (!mineData.count) mineData.count = 0;
            if (mineData.count < mineData.max) {
                let panum = pa + (CreepBySpawnMissionNum['power-attack']||0);
                let phnum = ph + (CreepBySpawnMissionNum['power-heal']||0);
                // 不能超过设定的同时工作队伍数
                for (let i = Math.min(panum, phnum); i < P_num; i++) {
                    if (mineData.boostLevel == 0) {
                        this.SpawnMissionAdd('PA', [], -1, 'power-attack', {
                            homeRoom: this.name, targetRoom: targetRoom, boostLevel: 0
                        } as CreepMemory);
                        this.SpawnMissionAdd('PH', [], -1, 'power-heal', {
                            homeRoom: this.name, targetRoom: targetRoom, boostLevel: 0
                        } as CreepMemory);
                    }
                    else if (mineData.boostLevel == 1) {
                        this.AssignBoostTask('GO', 150);
                        this.AssignBoostTask('UH', 600);
                        this.AssignBoostTask('LO', 750);
                        this.SpawnMissionAdd('PA', [], -1, 'power-attack', {
                            homeRoom: this.name, targetRoom: targetRoom, boostLevel: 1
                        } as CreepMemory);
                        this.SpawnMissionAdd('PH', [], -1, 'power-heal', {
                            homeRoom: this.name, targetRoom: targetRoom, boostLevel: 1
                        } as CreepMemory);
                    } else if (mineData.boostLevel == 2) {
                        this.AssignBoostTask('GHO2', 150);
                        this.AssignBoostTask('UH2O', 600);
                        this.AssignBoostTask('LO', 750);
                        this.SpawnMissionAdd('PA', [], -1, 'power-attack', {
                            homeRoom: this.name, targetRoom: targetRoom, boostLevel: 2
                        } as CreepMemory);
                        this.SpawnMissionAdd('PH', [], -1, 'power-heal', {
                            homeRoom: this.name, targetRoom: targetRoom, boostLevel: 1
                        } as CreepMemory);
                    }
                    // 计数增加
                    mineData.count = mineData.count + 1;
                    // 如果达到上限, 不再派
                    if (mineData.count >= mineData.max) break;
                }
            }
            
            if (!mineData.prCount) mineData.prCount = 0;
            if (mineData.prCount < mineData.prMax && mineData.prNum > 0) {
                let prnum = (CreepByTargetRoom['power-ranged'] || []).length +
                        (CreepBySpawnMissionNum['power-ranged'] || 0);
                // 根据设定的数量孵化ranged
                for (let i = prnum; i < mineData.prNum; i++) {
                    const memory = { homeRoom: this.name, targetRoom: targetRoom } as CreepMemory;
                    this.SpawnMissionAdd('PR', [], -1, 'power-ranged', memory);
                    mineData.prCount = mineData.prCount + 1;
                }
            }

            if (!room) continue;

            // 按照power容量孵化搬运工
            const maxPc = powerBank.power / 1250;
            // 预计搬运工到达时间
            const TICK = Game.map.getRoomLinearDistance(this.name, targetRoom) * 50 + (maxPc/2)*150 + 50;
            let threshold = TICK * Math.max(1800, mineData.creep*600*(mineData.boostLevel+1));
            if (threshold < 600e3) threshold = 600e3;
            if (threshold > 1.5e6) threshold = 1.5e6;
            if (powerBank.hits <= threshold) {
                const pc = (CreepByTargetRoom['power-carry'] || [])
                        .filter((c: any) => c.spawning || c.ticksToLive > 150).length;
                // 有采集队存在才考虑孵化, 因此不会对已经放弃的任务进行孵化
                if (pa < 1 || ph < 1) continue;
                const pcnum = pc + (SpawnMissionNum['power-carry']||0);
                for (let i = pcnum; i < maxPc; i++) {
                    const memory = { homeRoom: this.name, targetRoom: targetRoom } as CreepMemory;
                    this.SpawnMissionAdd('PC', [], -1, 'power-carry',memory);
                }
            }
        }
    }

    DepositMine() {
        const LOOK_INTERVAL = OUTMINE_CONFIG.LOOK_INTERVAL;
        if (Game.time % LOOK_INTERVAL != 1) return;
        const depositMines = this.memory['depositMine'];
        if (!depositMines || Object.keys(depositMines).length == 0) return;

        // 孵化任务数统计
        const SpawnMissionNum = this.getSpawnMissionNum() || {};
        for (const targetRoom in depositMines) {
            const mineData = depositMines[targetRoom] as DepositMineTaskData;
            if (typeof mineData === 'number') continue; // 跳过位置数据
            let D_num = mineData.num;
            if (!D_num || D_num <= 0) {
                delete this.memory['depositMine'][targetRoom];
                console.log(`${targetRoom} 的任务数量异常, 已移出开采队列。`);
                continue;
            }
            let room = Game.rooms[targetRoom];
            if (room && Game.time % (LOOK_INTERVAL * 5) == 1) {
                D_num = DepositCheck(room);
                if (D_num > 0) {
                    mineData.num = D_num;
                } else {
                    delete this.memory['depositMine'][targetRoom];
                    console.log(`${targetRoom} 的 Deposit 已耗尽, 已移出开采队列。`);
                    continue;
                }
            }
            if(!mineData.active) continue;

            // 统计以targetRoom为工作目标的所有role情况
            const CreepByTargetRoom = getCreepByTargetRoom(targetRoom);

            // 防御
            // if (room) {
            //     let hostiles = room.find(FIND_HOSTILE_CREEPS, {
            //         filter: hostile => 
            //             !Memory['whitelist'].includes(hostile.owner.username) &&
            //             (hostile.getActiveBodyparts(ATTACK) > 0 || 
            //             hostile.getActiveBodyparts(RANGED_ATTACK) > 0 ||
            //             hostile.getActiveBodyparts(HEAL) > 0)
            //     }) as any;
            //     if (hostiles.length > 0) {
            //         let dfnum = Math.min(hostiles.length, (room.deposit?.length||0));
            //         // const da = (CreepByTargetRoom['deposit-attack'] || [])
            //         //             .filter((c: any) => c.spawning || c.ticksToLive > 200).length;
            //         // const danum = da + (SpawnMissionNum['deposit-attack']||0)
            //         // if(danum < 1) {
            //         //     this.SpawnMissionAdd('', [], -1, 'deposit-attack', { targetRoom: targetRoom });
            //         //     this.SpawnMissionAdd('', [], -1, 'deposit-heal', { targetRoom: targetRoom });
            //         // }
            //         const dr = (CreepByTargetRoom['deposit-ranged'] || [])
            //                     .filter((c: any) => c.spawning || c.ticksToLive > 200).length;
            //         const drnum = dr + (SpawnMissionNum['deposit-ranged']||0)
            //         if(drnum < dfnum) {
            //             this.SpawnMissionAdd('', [], -1, 'deposit-ranged', { targetRoom: targetRoom });
            //         }
            //     }
            // }
            
            const dh = (CreepByTargetRoom['deposit-harvest'] || [])
                        .filter((c: any) => c.spawning || c.ticksToLive > 200).length;
            const dhnum = dh + (SpawnMissionNum['deposit-harvest']||0)
            if(dhnum < D_num) {
                const memory = { homeRoom: this.name, targetRoom: targetRoom } as any;
                this.SpawnMissionAdd('DH', [], -1, 'deposit-harvest', memory);
            }
            const dt = (CreepByTargetRoom['deposit-transfer'] || [])
                        .filter((c: any) => c.spawning || c.ticksToLive > 150).length;
            const dtnum = dt + (SpawnMissionNum['deposit-transfer']||0)
            if(dtnum < D_num / 2) {
                const memory = { homeRoom: this.name, targetRoom: targetRoom } as any;
                this.SpawnMissionAdd('DT', [], -1, 'deposit-transfer', memory);
            }
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

const PowerBankCheck = function (room: Room) {
    const powerBank = room.find(FIND_STRUCTURES, {
        filter: (s) => (s.hits >= s.hitsMax && s.structureType === STRUCTURE_POWER_BANK)
    })[0] as StructurePowerBank;

    if (!powerBank || powerBank.power < OUTMINE_CONFIG.POWER_MIN_AMOUNT) return 0;
    if (powerBank.hits < powerBank.hitsMax) return 0;

    const pos = powerBank.pos;
    const terrain = new Room.Terrain(room.name);
    let num = 0;
    [
        [pos.x-1, pos.y-1], [pos.x, pos.y-1], [pos.x+1, pos.y-1],
        [pos.x-1, pos.y], [pos.x+1, pos.y],
        [pos.x-1, pos.y+1], [pos.x, pos.y+1], [pos.x+1, pos.y+1],
    ].forEach((p) => {
        if (p[0] <= 1 || p[0] >= 48 || p[1] <= 1 || p[1] >= 48) return;
        if (terrain.get(p[0], p[1]) != TERRAIN_MASK_WALL) num++;
    })

    if (!num) return 0;

    num = Math.min(num, 3);

    if (powerBank.ticksToDecay > (2e6 / (600 * num) + 500)) return num;
    else return 0;
}

const DepositCheck = function (room: Room) {
    const deposits = room.find(FIND_DEPOSITS);

    if (!deposits || deposits.length === 0) return 0;

    let D_num = 0;

    for (const deposit of deposits) {
        if (deposit.lastCooldown >= OUTMINE_CONFIG.DEPOSIT_MAX_COOLDOWN) {
            continue;
        }
        const pos = deposit.pos;
        const terrain = new Room.Terrain(room.name);

        let num = 0;
        [
            [pos.x-1, pos.y-1], [pos.x, pos.y-1], [pos.x+1, pos.y-1],
            [pos.x-1, pos.y], [pos.x+1, pos.y],
            [pos.x-1, pos.y+1], [pos.x, pos.y+1], [pos.x+1, pos.y+1],
        ].forEach((p) => {
            if (terrain.get(p[0], p[1]) != TERRAIN_MASK_WALL) num++;
        })
        if (num == 0) continue;
        if (!room.memory) room.memory = {} as any;
        if (!room.memory['depositMine']) room.memory['depositMine'] = {};
        room.memory['depositMine'][deposit.id] = num;

        D_num += Math.min(num, 3);
    }

    for (const id in (room.memory['depositMine']||{})) {
        if (Game.getObjectById(id)) continue;
        delete room.memory['depositMine'][id];
    }

    return D_num;
}

const PowerMineMissionData = function (room: Room, P_num: number, power: number) {
    const stores = [room.storage, room.terminal, ...room.lab]
    const LO_Amount = stores.reduce((a, b) => a + b.store['LO'], 0);
    const GO_Amount = stores.reduce((a, b) => a + b.store['GO'], 0);
    const UH_Amount = stores.reduce((a, b) => a + b.store['UH'], 0);
    const GHO2_Amount = stores.reduce((a, b) => a + b.store['GHO2'], 0);
    const UH2O_Amount = stores.reduce((a, b) => a + b.store['UH2O'], 0);

    let data = null;
    // 一队T2
    if (power >= 7000 && LO_Amount >= 3000 &&
        GHO2_Amount >= 3000 && UH2O_Amount >= 3000) {
        data = {
            creep: 1,      // creep队伍数
            max: 2,            // 最大孵化数量
            boostLevel: 2,     // 强化等级
            prNum: 0,          // ranged数量
            prMax: 0,     // ranged最大孵化数
        }
    }
    // 一队T1 + 5个ranged
    else if (power >= 7000 && LO_Amount >= 3000 &&
        GO_Amount >= 3000 && UH_Amount >= 3000) {
        data = {
            creep: 1,
            max: 2,
            boostLevel: 1,
            prNum: 5,
            prMax: 8,
        }
    }
    // 两队T1, 只有一个位置时补充4个ranged
    else if (power > 3000 && LO_Amount >= 3000 &&
        GO_Amount >= 3000 && UH_Amount >= 3000) {
        data = {
            creep: Math.min(P_num, 2),
            max: 3,
            boostLevel: 1,
            prNum: P_num == 1 ? 4 : 0,
            prMax: 6,
        }
    }
    // 三队T0, 2个位置以下时补充4个ranged
    else {
        data = {
            creep: P_num,
            max: 6,
            boostLevel: 0,
            prNum: P_num <= 2 ? 4 : 0,
            prMax: 10,
        }
    }

    return data;
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