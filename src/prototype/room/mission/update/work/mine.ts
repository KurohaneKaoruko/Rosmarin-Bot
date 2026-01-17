import { OUTMINE_CONFIG } from '@/constant/config';
import { decompress } from '@/utils';

/**
 * 扫描过道
 * @description 替代原 LookHighWay
 */
export const UpdateHighwayScan = (room: Room) => {
    const LOOK_INTERVAL = OUTMINE_CONFIG.LOOK_INTERVAL;
    if (Game.time % LOOK_INTERVAL > 1) return;

    // 能量储备不足时不添加过道采集任务
    if (room[RESOURCE_ENERGY] < 50000) return;
    const outminePower = Memory['RoomControlData'][room.name]['outminePower'];
    const outmineDeposit = Memory['RoomControlData'][room.name]['outmineDeposit'];
    // 没开启自动挖就不找
    if (!outminePower && !outmineDeposit) return;
    
    // 监控列表
    let lookList = Memory['OutMineData'][room.name]?.['highway'] || [];
    if (lookList.length == 0) return;
    
    // 观察
    if (Game.time % LOOK_INTERVAL == 0) {
        if (!room.observer) return;
        // 观察编号
        let lookIndex = Math.floor(Game.time / LOOK_INTERVAL) % lookList.length;
        const roomName = lookList[lookIndex];
        // 没有视野才看
        if (!Game.rooms[roomName]) {
            room.observer.observeRoom(roomName);
        }
        return;
    }
    
    // 处理
    for(const roomName of lookList) {
        if (/^[EW]\d*[1-9][NS]\d*[1-9]$/.test(roomName)) continue;

        const targetRoom = Game.rooms[roomName];
        if (!targetRoom) continue;    // 没有视野不处理

        // power
        if (outminePower) {
            // 检查是否已有该房间的任务
            const existId = room.checkSameMissionInPool('mine', 'power', { targetRoom: roomName });
            if (!existId) {
                let P_num = PowerBankCheck(targetRoom);
                if (P_num) {
                    const power = targetRoom.find(FIND_STRUCTURES,{
                        filter:(s)=>s.structureType===STRUCTURE_POWER_BANK
                    })[0].power;
                    let data = PowerMineMissionData(room, P_num, power) as PowerMineTask;
                    data.targetRoom = roomName;
                    
                    room.addMissionToPool('mine', 'power', 1, data);
                    console.log(`在 ${roomName} 发现 PowerBank (${power} power), 已加入开采队列。`);
                    console.log(`将从 ${room.name} 派出 ${data.creep} 数量的T${data.boostLevel}采集队。Ranged数量:${data.prNum}。`);
                }
            }
        }

        // deposit
        if (outmineDeposit) {
            const existId = room.checkSameMissionInPool('mine', 'deposit', { targetRoom: roomName });
            if (!existId) {
                let D_num = DepositCheck(targetRoom);
                if (D_num > 0) {
                    const data: DepositMineTask = {
                        targetRoom: roomName,
                        num: D_num,
                        active: true
                    };
                    room.addMissionToPool('mine', 'deposit', 1, data);
                    console.log(`在 ${roomName} 发现 Deposit, 已加入开采队列。`);
                    console.log(`将从 ${room.name} 派出总共 ${D_num} 数量的采集队。`);
                }
            }
        }
    }
}

/**
 * 矿场任务更新
 */
export const UpdateMineMission = (room: Room) => {
    const tasks = room.getAllMissionFromPool('mine');
    if (!tasks || tasks.length === 0) return;

    const LOOK_INTERVAL = OUTMINE_CONFIG.LOOK_INTERVAL;
    // 为了分散CPU消耗，不同任务可以错开tick执行，这里简单沿用原逻辑的频率控制，或者每tick执行但内部判断
    if (Game.time % LOOK_INTERVAL != 1) return;

    // 孵化任务数统计
    const SpawnMissionNum = room.getSpawnMissionNum() || {};

    for (const task of tasks) {
        if (task.type === 'power') {
            handlePowerMine(room, task, task.data as PowerMineTask, SpawnMissionNum);
        } else if (task.type === 'deposit') {
            handleDepositMine(room, task, task.data as DepositMineTask, SpawnMissionNum);
        }
    }
}

const handlePowerMine = (room: Room, task: Task, mineData: PowerMineTask, SpawnMissionNum: {[role: string]: number}) => {
    const targetRoom = mineData.targetRoom;
    const targetRoomObj = Game.rooms[targetRoom];
    
    // 检查 PowerBank 状态
    const powerBank = targetRoomObj?.powerBank?.[0] ?? targetRoomObj?.find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType === STRUCTURE_POWER_BANK
    })[0];

    // 如果有视野且没有PowerBank，说明已打完或消失
    if (targetRoomObj && !powerBank) {
        room.deleteMissionFromPool('mine', task.id);
        console.log(`${targetRoom} 的 PowerBank 已耗尽, 已移出开采队列。`);
        return;
    }

    // 统计以targetRoom为工作目标的所有role情况
    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom);
    let pa = 0, ph = 0;
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

    // 孵化采集队
    if (!mineData.count) mineData.count = 0;
    if (mineData.count < mineData.max) {
        let panum = pa + (SpawnMissionNum['power-attack']||0);
        let phnum = ph + (SpawnMissionNum['power-heal']||0);
        let needUpdate = false;
        
        for (let i = Math.min(panum, phnum); i < P_num; i++) {
            const memory = { homeRoom: room.name, targetRoom: targetRoom, boostLevel: mineData.boostLevel } as CreepMemory;
            
            if (mineData.boostLevel == 1) {
                room.AssignBoostTask('GO', 150);
                room.AssignBoostTask('UH', 600);
                room.AssignBoostTask('LO', 750);
            } else if (mineData.boostLevel == 2) {
                room.AssignBoostTask('GHO2', 150);
                room.AssignBoostTask('UH2O', 600);
                room.AssignBoostTask('LO', 750);
            }

            room.SpawnMissionAdd('PA', [], -1, 'power-attack', memory);
            room.SpawnMissionAdd('PH', [], -1, 'power-heal', memory);

            // 计数增加
            mineData.count = mineData.count + 1;
            needUpdate = true;
            
            if (mineData.count >= mineData.max) break;
        }

        if (needUpdate) {
            room.updateMissionPool('mine', task.id, { data: mineData });
        }
    }

    // 孵化 Ranged
    if (!mineData.prCount) mineData.prCount = 0;
    if (mineData.prCount < mineData.prMax && mineData.prNum > 0) {
        let prnum = (CreepByTargetRoom['power-ranged'] || []).length +
                (SpawnMissionNum['power-ranged'] || 0);
        let needUpdate = false;
        
        for (let i = prnum; i < mineData.prNum; i++) {
            const memory = { homeRoom: room.name, targetRoom: targetRoom } as CreepMemory;
            room.SpawnMissionAdd('PR', [], -1, 'power-ranged', memory);
            mineData.prCount = mineData.prCount + 1;
            needUpdate = true;
        }

        if (needUpdate) {
            room.updateMissionPool('mine', task.id, { data: mineData });
        }
    }

    if (!targetRoomObj) return;

    // 孵化搬运工
    if (!powerBank) return; 

    const maxPc = powerBank.power / 1250;
    const TICK = Game.map.getRoomLinearDistance(room.name, targetRoom) * 50 + (maxPc/2)*150 + 50;
    let threshold = TICK * Math.max(1800, mineData.creep*600*(mineData.boostLevel+1));
    if (threshold < 600e3) threshold = 600e3;
    if (threshold > 1.5e6) threshold = 1.5e6;

    if (powerBank.hits <= threshold) {
        const pc = (CreepByTargetRoom['power-carry'] || [])
                .filter((c: any) => c.spawning || c.ticksToLive > 150).length;
        
        if (pa < 1 || ph < 1) return;

        const pcnum = pc + (SpawnMissionNum['power-carry']||0);
        for (let i = pcnum; i < maxPc; i++) {
            const memory = { homeRoom: room.name, targetRoom: targetRoom } as CreepMemory;
            room.SpawnMissionAdd('PC', [], -1, 'power-carry', memory);
        }
    }
}

const handleDepositMine = (room: Room, task: Task, mineData: DepositMineTask, SpawnMissionNum: {[role: string]: number}) => {
    const targetRoom = mineData.targetRoom;
    const LOOK_INTERVAL = OUTMINE_CONFIG.LOOK_INTERVAL;

    let D_num = mineData.num;
    if (!D_num || D_num <= 0) {
        room.deleteMissionFromPool('mine', task.id);
        console.log(`${targetRoom} 的任务数量异常, 已移出开采队列。`);
        return;
    }

    const targetRoomObj = Game.rooms[targetRoom];
    // 定期检查 Deposit 状态
    if (targetRoomObj && Game.time % (LOOK_INTERVAL * 5) == 1) {
        D_num = DepositCheck(targetRoomObj);
        if (D_num > 0) {
            mineData.num = D_num;
            room.updateMissionPool('mine', task.id, { data: mineData });
        } else {
            room.deleteMissionFromPool('mine', task.id);
            console.log(`${targetRoom} 的 Deposit 已耗尽, 已移出开采队列。`);
            return;
        }
    }

    if(!mineData.active) return;

    const CreepByTargetRoom = getCreepByTargetRoom(targetRoom);

    // 孵化采集者
    const dh = (CreepByTargetRoom['deposit-harvest'] || [])
                .filter((c: any) => c.spawning || c.ticksToLive > 200).length;
    const dhnum = dh + (SpawnMissionNum['deposit-harvest']||0)
    if(dhnum < D_num) {
        const memory = { homeRoom: room.name, targetRoom: targetRoom } as any;
        room.SpawnMissionAdd('DH', [], -1, 'deposit-harvest', memory);
    }

    // 孵化搬运者
    const dt = (CreepByTargetRoom['deposit-transfer'] || [])
                .filter((c: any) => c.spawning || c.ticksToLive > 150).length;
    const dtnum = dt + (SpawnMissionNum['deposit-transfer']||0)
    if(dtnum < D_num / 2) {
        const memory = { homeRoom: room.name, targetRoom: targetRoom } as any;
        room.SpawnMissionAdd('DT', [], -1, 'deposit-transfer', memory);
    }
}


// ==================== 辅助函数 ====================

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
    const terrain = new Room.Terrain(room.name);

    for (const deposit of deposits) {
        if (deposit.lastCooldown >= OUTMINE_CONFIG.DEPOSIT_MAX_COOLDOWN) {
            continue;
        }
        const pos = deposit.pos;

        let num = 0;
        [
            [pos.x-1, pos.y-1], [pos.x, pos.y-1], [pos.x+1, pos.y-1],
            [pos.x-1, pos.y], [pos.x+1, pos.y],
            [pos.x-1, pos.y+1], [pos.x, pos.y+1], [pos.x+1, pos.y+1],
        ].forEach((p) => {
            if (p[0] <= 1 || p[0] >= 48 || p[1] <= 1 || p[1] >= 48) return;
            if (terrain.get(p[0], p[1]) != TERRAIN_MASK_WALL) num++;
        })
        if (num == 0) continue;
        
        // 注意：原逻辑在这里写了 room.memory['depositMine']，这里仅用于检测数量，不再副作用写入Memory
        // 但原逻辑中 DepositCheck 会累加多个 deposit 的开采位
        D_num += Math.min(num, 3);
    }

    return D_num;
}

const PowerMineMissionData = function (room: Room, P_num: number, power: number): Partial<PowerMineTask> {
    const stores = [room.storage, room.terminal, ...room.lab];
    let LO_Amount = 0;
    let GO_Amount = 0;
    let UH_Amount = 0;
    let GHO2_Amount = 0;
    let UH2O_Amount = 0;

    for (const store of stores) {
        if (!store) continue;
        LO_Amount += store.store['LO'] || 0;
        GO_Amount += store.store['GO'] || 0;
        UH_Amount += store.store['UH'] || 0;
        GHO2_Amount += store.store['GHO2'] || 0;
        UH2O_Amount += store.store['UH2O'] || 0;
    }

    let data: Partial<PowerMineTask> = {};
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
            const tRoom = creep.memory.targetRoom;
            if (!role || !tRoom) continue;
            if (!global.CreepByTargetRoom[tRoom]) {
                global.CreepByTargetRoom[tRoom] = {};
            }
            if (!global.CreepByTargetRoom[tRoom][role]) {
                global.CreepByTargetRoom[tRoom][role] = [];
            }
            global.CreepByTargetRoom[tRoom][role].push({
                ticksToLive: creep.ticksToLive,
                spawning: creep.spawning,
                homeRoom: creep.memory.homeRoom,
            });
        }
        return global.CreepByTargetRoom[targetRoom] || {};
    }
}
