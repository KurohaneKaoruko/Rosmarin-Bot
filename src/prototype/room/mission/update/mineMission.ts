import { OUTMINE_CONFIG } from '@/constant/config';

const handlePowerMine = (room: Room, task: Task, mineData: PowerMineTask, SpawnMissionNum: {[role: string]: number}) => {
    const targetRoom = mineData.targetRoom;
    const targetRoomObj = Game.rooms[targetRoom];
    
    const powerBank = targetRoomObj?.powerBank?.[0] ?? targetRoomObj?.find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType === STRUCTURE_POWER_BANK
    })[0];

    if (targetRoomObj && !powerBank) {
        room.deleteMissionFromPool('mine', task.id);
        console.log(`${targetRoom} 的 PowerBank 已耗尽, 已移出开采队列。`);
        return;
    }

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

            mineData.count = mineData.count + 1;
            needUpdate = true;
            
            if (mineData.count >= mineData.max) break;
        }

        if (needUpdate) {
            room.updateMissionPool('mine', task.id, { data: mineData });
        }
    }

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

    const dh = (CreepByTargetRoom['deposit-harvest'] || [])
                .filter((c: any) => c.spawning || c.ticksToLive > 200).length;
    const dhnum = dh + (SpawnMissionNum['deposit-harvest']||0)
    if(dhnum < D_num) {
        const memory = { homeRoom: room.name, targetRoom: targetRoom } as any;
        room.SpawnMissionAdd('DH', [], -1, 'deposit-harvest', memory);
    }

    const dt = (CreepByTargetRoom['deposit-transfer'] || [])
                .filter((c: any) => c.spawning || c.ticksToLive > 150).length;
    const dtnum = dt + (SpawnMissionNum['deposit-transfer']||0)
    if(dtnum < D_num / 2) {
        const memory = { homeRoom: room.name, targetRoom: targetRoom } as any;
        room.SpawnMissionAdd('DT', [], -1, 'deposit-transfer', memory);
    }
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
    if (power >= 7000 && LO_Amount >= 3000 &&
        GHO2_Amount >= 3000 && UH2O_Amount >= 3000) {
        data = {
            creep: 1,
            max: 2,
            boostLevel: 2,
            prNum: 0,
            prMax: 0,
        }
    }
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

const getCreepByTargetRoom = function (targetRoom: string) {
    if (global.CreepByTargetRoom &&
        global.CreepByTargetRoom.time === Game.time) {
        return global.CreepByTargetRoom[targetRoom] || {};
    } else {
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

/**
 * 外矿/过道采集任务模块（mine）
 * @description
 * - 过道扫描：使用 Observer 周期性观察 highway 房间，并在发现 PowerBank/Deposit 时写入任务池
 * - 矿场任务更新：根据任务池状态孵化对应 creeps，并在目标耗尽后清理任务
 */
export default class MineMission extends Room {
    /**
     * 扫描过道（highway）并尝试创建 mine 任务
     * @description
     * - 按 OUTMINE_CONFIG.LOOK_INTERVAL 分帧观察
     * - 能量不足/未开启自动挖时跳过
     * - 发现 PowerBank/Deposit 后写入任务池（mine/power, mine/deposit）
     */
    UpdateHighwayScan() {
        const LOOK_INTERVAL = OUTMINE_CONFIG.LOOK_INTERVAL;
        if (Game.time % LOOK_INTERVAL > 1) return;

        if (this[RESOURCE_ENERGY] < 50000) return;
        const outminePower = Memory['RoomControlData'][this.name]['outminePower'];
        const outmineDeposit = Memory['RoomControlData'][this.name]['outmineDeposit'];
        if (!outminePower && !outmineDeposit) return;
        
        let lookList = Memory['OutMineData'][this.name]?.['highway'] || [];
        if (lookList.length == 0) return;
        
        if (Game.time % LOOK_INTERVAL == 0) {
            if (!this.observer) return;
            let lookIndex = Math.floor(Game.time / LOOK_INTERVAL) % lookList.length;
            const roomName = lookList[lookIndex];
            if (!Game.rooms[roomName]) {
                this.observer.observeRoom(roomName);
            }
            return;
        }
        
        for(const roomName of lookList) {
            if (/^[EW]\d*[1-9][NS]\d*[1-9]$/.test(roomName)) continue;

            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) continue;

            if (outminePower) {
                const existId = this.checkSameMissionInPool('mine', 'power', { targetRoom: roomName });
                if (!existId) {
                    let P_num = (PowerBankCheck as any)(targetRoom);
                    if (P_num) {
                        const power = targetRoom.find(FIND_STRUCTURES,{
                            filter:(s)=>s.structureType===STRUCTURE_POWER_BANK
                        })[0].power;
                        let data = (PowerMineMissionData as any)(this, P_num, power) as PowerMineTask;
                        data.targetRoom = roomName;
                        
                        this.addMissionToPool('mine', 'power', 1, data);
                        console.log(`在 ${roomName} 发现 PowerBank (${power} power), 已加入开采队列。`);
                        console.log(`将从 ${this.name} 派出 ${data.creep} 数量的T${data.boostLevel}采集队。Ranged数量:${data.prNum}。`);
                    }
                }
            }

            if (outmineDeposit) {
                const existId = this.checkSameMissionInPool('mine', 'deposit', { targetRoom: roomName });
                if (!existId) {
                    let D_num = (DepositCheck as any)(targetRoom);
                    if (D_num > 0) {
                        const data: DepositMineTask = {
                            targetRoom: roomName,
                            num: D_num,
                            active: true
                        };
                        this.addMissionToPool('mine', 'deposit', 1, data);
                        console.log(`在 ${roomName} 发现 Deposit, 已加入开采队列。`);
                        console.log(`将从 ${this.name} 派出总共 ${D_num} 数量的采集队。`);
                    }
                }
            }
        }
    }

    /**
     * 更新矿场任务（mine）
     * @description
     * - 遍历 mine 任务池
     * - power：按血量/衰减等条件孵化 PA/PH/PR/PC
     * - deposit：孵化 DH/DT
     */
    UpdateMineMission() {
        const tasks = this.getAllMissionFromPool('mine');
        if (!tasks || tasks.length === 0) return;

        const LOOK_INTERVAL = OUTMINE_CONFIG.LOOK_INTERVAL;
        if (Game.time % LOOK_INTERVAL != 1) return;

        const SpawnMissionNum = this.getSpawnMissionNum() || {};

        for (const task of tasks) {
            if (task.type === 'power') {
                (handlePowerMine as any)(this, task, task.data as PowerMineTask, SpawnMissionNum);
            } else if (task.type === 'deposit') {
                (handleDepositMine as any)(this, task, task.data as DepositMineTask, SpawnMissionNum);
            }
        }
    }
}


