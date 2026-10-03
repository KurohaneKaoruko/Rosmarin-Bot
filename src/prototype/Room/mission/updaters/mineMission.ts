import { OUTMINE_CONFIG } from '@/constant/BaseConstant';
import { getOutMineData, getRoomData } from '@/modules/shared/memory';
import { getCreepByTargetRoom } from '@/modules/shared/creepTickIndex';
import { isRoomTickAligned } from '@/modules/shared/roomPhase';

const SURROUNDING_OFFSETS: Array<[number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
];

// 这里只依赖目标房 creep 索引中的轻量字段，不要求完整 Creep 实例。
type IndexedTargetRoomCreep = {
    ticksToLive?: number;
    spawning: boolean;
};

type SpawnMissionCounts = { [role: string]: number };
type PowerMineMissionConfig = Omit<PowerMineTask, 'targetRoom'>;

const countActiveCreeps = (creeps: IndexedTargetRoomCreep[] | undefined, minTicksToLive: number) => {
    return (creeps || []).filter((creep) => creep.spawning || (creep.ticksToLive || 0) > minTicksToLive).length;
};

const countOpenAdjacentTiles = (roomName: string, pos: RoomPosition) => {
    const terrain = new Room.Terrain(roomName);
    let count = 0;
    for (const [dx, dy] of SURROUNDING_OFFSETS) {
        const x = pos.x + dx;
        const y = pos.y + dy;
        if (x <= 1 || x >= 48 || y <= 1 || y >= 48) continue;
        if (terrain.get(x, y) !== TERRAIN_MASK_WALL) count++;
    }
    return count;
};

const getPowerBankInRoom = (room: Room) => {
    return room.powerBank?.[0] ?? room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType === STRUCTURE_POWER_BANK,
    })[0] as StructurePowerBank | undefined;
};

const getSpawnMissionCount = (spawnMissionNum: SpawnMissionCounts, role: string) => {
    return spawnMissionNum[role] || 0;
};

const createMineCreepMemory = (sourceRoom: string, targetRoom: string, extra: Record<string, unknown> = {}) => {
    return { sourceRoom, targetRoom, ...extra } as CreepMemory;
};

const updateMineTaskIfChanged = (room: Room, task: Task, data: MineTask, changed: boolean) => {
    if (!changed) return;
    room.updateMissionPool('mine', task.id, { data });
};

const assignPowerBoostTasks = (room: Room, boostLevel: number, boostOwnerId: string) => {
    if (boostLevel === 1) {
        room.AssignBoostTask('GO', 150, boostOwnerId);
        room.AssignBoostTask('UH', 600, boostOwnerId);
        room.AssignBoostTask('LO', 750, boostOwnerId);
    } else if (boostLevel === 2) {
        room.AssignBoostTask('GHO2', 150, boostOwnerId);
        room.AssignBoostTask('UH2O', 600, boostOwnerId);
        room.AssignBoostTask('LO', 750, boostOwnerId);
    }
};

const getPowerCarryThreshold = (room: Room, targetRoom: string, maxPc: number, mineData: PowerMineTask) => {
    const tick = Game.map.getRoomLinearDistance(room.name, targetRoom) * 50 + (maxPc / 2) * 150 + 50;
    let threshold = tick * Math.max(1800, mineData.creep * 600 * (mineData.boostLevel + 1));
    if (threshold < 600e3) threshold = 600e3;
    if (threshold > 1.5e6) threshold = 1.5e6;
    return threshold;
};

// ==================== Mine Update Helpers ====================

const handlePowerMine = (room: Room, task: Task, mineData: PowerMineTask, spawnMissionNum: SpawnMissionCounts) => {
    const targetRoom = mineData.targetRoom;
    const targetRoomObj = Game.rooms[targetRoom];
    const powerBank = targetRoomObj ? getPowerBankInRoom(targetRoomObj) : undefined;

    if (targetRoomObj && !powerBank) {
        room.deleteMissionFromPool('mine', task.id);
        console.log(`${targetRoom} 的 PowerBank 已耗尽, 已移出开采队列。`);
        return;
    }

    const creepByTargetRoom = getCreepByTargetRoom(targetRoom);
    let pa = 0, ph = 0;
    let powerTeamNum = mineData.creep;

    if (!powerBank || powerBank.hits > 500000) {
        pa = countActiveCreeps(creepByTargetRoom['power-attack'], 100);
        ph = countActiveCreeps(creepByTargetRoom['power-heal'], 100);
    } else {
        pa = (creepByTargetRoom['power-attack'] || []).length;
        ph = (creepByTargetRoom['power-heal'] || []).length;
        powerTeamNum = 1;
    }

    // 第一阶段：维持攻坚队（PA / PH）与可选 ranged 队列。
    if (!mineData.count) mineData.count = 0;
    if (mineData.count < mineData.max) {
        const panum = pa + getSpawnMissionCount(spawnMissionNum, 'power-attack');
        const phnum = ph + getSpawnMissionCount(spawnMissionNum, 'power-heal');
        let needUpdate = false;
        
        for (let i = Math.min(panum, phnum); i < powerTeamNum; i++) {
            const boostOwnerId = `Mine-${room.name}-${targetRoom}-${Game.time}-${mineData.count}`;
            const memory = createMineCreepMemory(room.name, targetRoom, {
                boostLevel: mineData.boostLevel,
                boostOwnerId,
            });

            const paRet = room.SpawnMissionAdd('PA', [], -1, 'power-attack', memory);
            const phRet = room.SpawnMissionAdd('PH', [], -1, 'power-heal', memory);
            if (paRet !== OK || phRet !== OK) break;

            assignPowerBoostTasks(room, mineData.boostLevel, boostOwnerId);

            mineData.count = mineData.count + 1;
            needUpdate = true;
            
            if (mineData.count >= mineData.max) break;
        }

        updateMineTaskIfChanged(room, task, mineData, needUpdate);
    }

    if (!mineData.prCount) mineData.prCount = 0;
    if (mineData.prCount < mineData.prMax && mineData.prNum > 0) {
        const prnum = (creepByTargetRoom['power-ranged'] || []).length +
            getSpawnMissionCount(spawnMissionNum, 'power-ranged');
        let needUpdate = false;
        
        for (let i = prnum; i < mineData.prNum; i++) {
            const memory = createMineCreepMemory(room.name, targetRoom);
            room.SpawnMissionAdd('PR', [], -1, 'power-ranged', memory);
            mineData.prCount = mineData.prCount + 1;
            needUpdate = true;
        }

        updateMineTaskIfChanged(room, task, mineData, needUpdate);
    }

    if (!targetRoomObj) return;
    if (!powerBank) return; 

    // 第二阶段：PowerBank 进入收尾阈值后，开始补充搬运队（PC）。
    const maxPc = powerBank.power / 1250;
    const threshold = getPowerCarryThreshold(room, targetRoom, maxPc, mineData);

    if (powerBank.hits <= threshold) {
        const pc = countActiveCreeps(creepByTargetRoom['power-carry'], 150);
        
        if (pa < 1 || ph < 1) return;

        const pcnum = pc + getSpawnMissionCount(spawnMissionNum, 'power-carry');
        for (let i = pcnum; i < maxPc; i++) {
            const memory = createMineCreepMemory(room.name, targetRoom);
            room.SpawnMissionAdd('PC', [], -1, 'power-carry', memory);
        }
    }
};

const handleDepositMine = (room: Room, task: Task, mineData: DepositMineTask, spawnMissionNum: SpawnMissionCounts) => {
    const targetRoom = mineData.targetRoom;
    const lookInterval = OUTMINE_CONFIG.LOOK_INTERVAL;

    let depositWorkerNum = mineData.num;
    if (!depositWorkerNum || depositWorkerNum <= 0) {
        room.deleteMissionFromPool('mine', task.id);
        console.log(`${targetRoom} 的任务数量异常, 已移出开采队列。`);
        return;
    }

    const targetRoomObj = Game.rooms[targetRoom];
    if (targetRoomObj && isRoomTickAligned(targetRoom, lookInterval * 5, lookInterval * 5 - 1)) {
        depositWorkerNum = getDepositHarvestCount(targetRoomObj);
        if (depositWorkerNum > 0) {
            mineData.num = depositWorkerNum;
            room.updateMissionPool('mine', task.id, { data: mineData });
        } else {
            room.deleteMissionFromPool('mine', task.id);
            console.log(`${targetRoom} 的 Deposit 已耗尽, 已移出开采队列。`);
            return;
        }
    }

    if (!mineData.active) return;

    const creepByTargetRoom = getCreepByTargetRoom(targetRoom);

    const dh = countActiveCreeps(creepByTargetRoom['deposit-harvest'], 200);
    const dhnum = dh + getSpawnMissionCount(spawnMissionNum, 'deposit-harvest');
    if (dhnum < depositWorkerNum) {
        const memory = createMineCreepMemory(room.name, targetRoom);
        room.SpawnMissionAdd('DH', [], -1, 'deposit-harvest', memory);
    }

    const dt = countActiveCreeps(creepByTargetRoom['deposit-transfer'], 150);
    const dtnum = dt + getSpawnMissionCount(spawnMissionNum, 'deposit-transfer');
    if (dtnum < depositWorkerNum / 2) {
        const memory = createMineCreepMemory(room.name, targetRoom);
        room.SpawnMissionAdd('DT', [], -1, 'deposit-transfer', memory);
    }
};

// ==================== Mine Scan Helpers ====================

const getPowerBankHarvestCount = (room: Room) => {
    const powerBank = getPowerBankInRoom(room);

    if (!powerBank || powerBank.power < OUTMINE_CONFIG.POWER_MIN_AMOUNT) return 0;
    if (powerBank.hits < powerBank.hitsMax) return 0;

    let num = countOpenAdjacentTiles(room.name, powerBank.pos);
    if (!num) return 0;

    num = Math.min(num, 3);

    return powerBank.ticksToDecay > (2e6 / (600 * num) + 500) ? num : 0;
};

const getDepositHarvestCount = (room: Room) => {
    const deposits = room.find(FIND_DEPOSITS);

    if (!deposits || deposits.length === 0) return 0;

    let depositWorkerNum = 0;

    for (const deposit of deposits) {
        if (deposit.lastCooldown >= OUTMINE_CONFIG.DEPOSIT_MAX_COOLDOWN) {
            continue;
        }

        let num = countOpenAdjacentTiles(room.name, deposit.pos);
        if (num === 0) continue;
        
        depositWorkerNum += Math.min(num, 3);
    }

    return depositWorkerNum;
};

const getPowerMineMissionData = (room: Room, powerTeamNum: number, power: number): PowerMineMissionConfig => {
    const stores = [room.storage, room.terminal, ...room.lab];
    let loAmount = 0;
    let goAmount = 0;
    let uhAmount = 0;
    let gho2Amount = 0;
    let uh2oAmount = 0;

    for (const store of stores) {
        if (!store) continue;
        loAmount += store.store['LO'] || 0;
        goAmount += store.store['GO'] || 0;
        uhAmount += store.store['UH'] || 0;
        gho2Amount += store.store['GHO2'] || 0;
        uh2oAmount += store.store['UH2O'] || 0;
    }

    if (power >= 7000 && loAmount >= 3000 &&
        gho2Amount >= 3000 && uh2oAmount >= 3000) {
        return {
            creep: 1,
            max: 2,
            boostLevel: 2,
            prNum: 0,
            prMax: 0,
        };
    }

    if (power >= 7000 && loAmount >= 3000 &&
        goAmount >= 3000 && uhAmount >= 3000) {
        return {
            creep: 1,
            max: 2,
            boostLevel: 1,
            prNum: 5,
            prMax: 8,
        };
    }

    if (power > 3000 && loAmount >= 3000 &&
        goAmount >= 3000 && uhAmount >= 3000) {
        return {
            creep: Math.min(powerTeamNum, 2),
            max: 3,
            boostLevel: 1,
            prNum: powerTeamNum === 1 ? 4 : 0,
            prMax: 6,
        };
    }

    return {
        creep: powerTeamNum,
        max: 6,
        boostLevel: 0,
        prNum: powerTeamNum <= 2 ? 4 : 0,
        prMax: 10,
    };
};

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
        const lookInterval = OUTMINE_CONFIG.LOOK_INTERVAL;
        if (!isRoomTickAligned(this.name, lookInterval)) return;

        if (this[RESOURCE_ENERGY] < 50000) return;
        const outminePower = getRoomData()[this.name]['outminePower'];
        const outmineDeposit = getRoomData()[this.name]['outmineDeposit'];
        if (!outminePower && !outmineDeposit) return;

        const lookList = getOutMineData(this.name)?.['highway'] || [];
        if (lookList.length === 0) return;

        // 轮询观察房间
        const lookIndex = Math.floor(Game.time / lookInterval) % lookList.length;
        const roomName = lookList[lookIndex];
        if (!Game.rooms[roomName]) {
            // 使用新的 observeRoom API 并注册回调
            // 回调会在 observe 成功的下一 tick 自动执行
            this.observeRoom(roomName, () => {
                this.handleHighwayRoom(roomName, outminePower, outmineDeposit);
            });
        }
    }

    /**
     * 处理观察到的过道房间
     * @param roomName 房间名
     * @param outminePower 是否开启 power 采集
     * @param outmineDeposit 是否开启 deposit 采集
     */
    private handleHighwayRoom(roomName: string, outminePower: boolean, outmineDeposit: boolean) {
        const targetRoom = Game.rooms[roomName];
        if (!targetRoom) return;

        if (outminePower) {
            const existId = this.checkSameMissionInPool('mine', 'power', { targetRoom: roomName } as any);
            if (!existId) {
                const powerTeamNum = getPowerBankHarvestCount(targetRoom);
                if (powerTeamNum > 0) {
                    const powerBank = getPowerBankInRoom(targetRoom);
                    if (!powerBank) return;
                    const data: PowerMineTask = {
                        ...getPowerMineMissionData(this, powerTeamNum, powerBank.power),
                        targetRoom: roomName,
                    };

                    this.addMissionToPool('mine', 'power', 1, data);
                    console.log(`在 ${roomName} 发现 PowerBank (${powerBank.power} power), 已加入开采队列。`);
                    console.log(`将从 ${this.name} 派出 ${data.creep} 数量的T${data.boostLevel}采集队。Ranged数量:${data.prNum}。`);
                }
            }
        }

        if (outmineDeposit) {
            const existId = this.checkSameMissionInPool('mine', 'deposit', { targetRoom: roomName } as any);
            if (!existId) {
                const depositWorkerNum = getDepositHarvestCount(targetRoom);
                if (depositWorkerNum > 0) {
                    const data: DepositMineTask = {
                        targetRoom: roomName,
                        num: depositWorkerNum,
                        active: true
                    };
                    this.addMissionToPool('mine', 'deposit', 1, data);
                    console.log(`在 ${roomName} 发现 Deposit, 已加入开采队列。`);
                    console.log(`将从 ${this.name} 派出总共 ${depositWorkerNum} 数量的采集队。`);
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

        const lookInterval = OUTMINE_CONFIG.LOOK_INTERVAL;
        if (!isRoomTickAligned(this.name, lookInterval, lookInterval - 1)) return;

        const spawnMissionNum = this.getSpawnMissionNum() || {};

        for (const task of tasks) {
            if (task.type === 'power') {
                handlePowerMine(this, task, task.data as PowerMineTask, spawnMissionNum);
            } else if (task.type === 'deposit') {
                handleDepositMine(this, task, task.data as DepositMineTask, spawnMissionNum);
            }
        }
    }
}
