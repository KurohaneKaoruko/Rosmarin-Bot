import { RoleData, RoleLevelData } from '@/constant/CreepConstant';
import { getWhitelistSet } from '@/utils';

const getCreepNumByHomeRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Record<string, number>> = {};
    return () => {
        if (cachedTick === Game.time) return cached;
        cachedTick = Game.time;
        cached = {};
        for (const creep of Object.values(Game.creeps) as Creep[]) {
            if(!creep || creep.ticksToLive < creep.body.length * 3) continue;
            const role = creep.memory.role;
            const home = creep.memory.home || creep.memory.homeRoom || creep.room.name;
            if(!role || !home) continue;
            if (!cached[home]) cached[home] = {};
            cached[home][role] = (cached[home][role] || 0) + 1;
        }
        return cached;
    };
})();

const getMyCreepsByRoleByRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Record<string, Creep[]>> = {};
    return (room: Room, role: string) => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            cached = {};
        }
        if (!cached[room.name]) cached[room.name] = {};
        const hit = cached[room.name][role];
        if (hit) return hit;
        const creeps = room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) => c && c.ticksToLive > 100 && c.memory.role === role
        }) as Creep[];
        cached[room.name][role] = creeps;
        return creeps;
    };
})();

/**
 * 一些基础的功能
 */
export default class BaseFunction extends Room {
    // 判断是否在白名单中
    isWhiteList() {
        return getWhitelistSet().has(this.controller?.owner?.username);
    }

    // 获取房间指定资源储备
    getResAmount(resource: ResourceConstant) {
        if (!RESOURCES_ALL.includes(resource)) return 0;
        let amount = 0;
        if(this.storage) amount += this.storage.store[resource];
        if(this.terminal) amount += this.terminal.store[resource];

        return amount;
    }

    // 获取属于该房间的creep数量
    getCreepNum() {
        const byRoom = getCreepNumByHomeRoom();
        return byRoom[this.name] || (byRoom[this.name] = {});
    }

    // 获取当前房间的有效等级，根据可用能量判断
    getEffectiveRoomLevel() {
        let lv = this.level;
        const availableEnergy = this.energyCapacityAvailable;
        const CS_SE = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION];
        const EEC = EXTENSION_ENERGY_CAPACITY;
        const CS_SS = CONTROLLER_STRUCTURES[STRUCTURE_SPAWN];
        const SEC = SPAWN_ENERGY_CAPACITY;
        
        while (lv > 1 && availableEnergy < CS_SE[lv] * EEC[lv] + SEC * CS_SS[lv]) {
            lv--;
        }
        return lv;
    }

    // 检查spawn和tower是否需要补充能量
    CheckSpawnAndTower(){
        const towers = (this.tower || [])
                .filter(tower => tower && tower.store.getFreeCapacity(RESOURCE_ENERGY) > 100);
        if (this.energyAvailable === this.energyCapacityAvailable && towers.length === 0) {
            return false;
        }
        return true;
    }

    getEnergyProfile() {
        const cap = this.energyCapacityAvailable || 0;
        const avail = this.energyAvailable || 0;
        const storageEnergy = this.storage?.store[RESOURCE_ENERGY] || 0;
        const terminalEnergy = this.terminal?.store[RESOURCE_ENERGY] || 0;
        const containerEnergy = (this.container || []).reduce((sum, c) => sum + (c?.store[RESOURCE_ENERGY] || 0), 0);
        const linkEnergy = (this.link || []).reduce((sum, l) => sum + (l?.store[RESOURCE_ENERGY] || 0), 0);
        const totalEnergy = ((this as any)[RESOURCE_ENERGY] || 0) + linkEnergy;
        return { cap, avail, storageEnergy, terminalEnergy, containerEnergy, linkEnergy, totalEnergy };
    }

    updateEnergyState(force = false) {
        if (!force && this.memory.energyStateTick && this.memory.energyState) {
            const interval = this.memory.energyState === 'CRITICAL' ? 2 : 5;
            if (Game.time - this.memory.energyStateTick < interval) return this.memory.energyState;
        }
        const { cap, avail, containerEnergy, linkEnergy, totalEnergy } = this.getEnergyProfile();
        const capRef = Math.max(300, cap);
        const creepNum = this.getCreepNum();
        const logisticNum =
            (creepNum['carrier'] || 0) +
            (creepNum['transport'] || 0) +
            (creepNum['manager'] || 0) +
            (creepNum['universal'] || 0);

        type EnergyState = NonNullable<RoomMemory['energyState']>;
        let state: EnergyState;
        if (avail < Math.min(300, capRef)) {
            state = 'CRITICAL';
        } else if (logisticNum === 0 && this.CheckSpawnAndTower() && (containerEnergy + linkEnergy) >= capRef) {
            state = 'CRITICAL';
        } else if (totalEnergy < capRef * 5) {
            state = 'LOW';
        } else if (totalEnergy >= capRef * 50) {
            state = 'SURPLUS';
        } else {
            state = 'NORMAL';
        }

        this.memory.energyReserve = Math.floor(capRef * 2);
        this.memory.energyState = state;
        this.memory.energyStateTick = Game.time;
        return state;
    }

    getEnergyState() {
        return this.updateEnergyState(false);
    }

    // 获取绑定最少的能量源
    closestSource(creep: Creep) {
        // 初始化最少Creep绑定计数
        let minCreepCount = Infinity;
        let leastCrowdedSources = [];

        if(!this.memory.sourcePosCount) this.memory.sourcePosCount = {}
        let terrain = null;
        const role = creep.memory.role;
        const creeps = role ? getMyCreepsByRoleByRoom(this, role).filter(c => c.id !== creep.id) : [];
        const boundCounts: Record<string, number> = {};
        const minTtlBySource: Record<string, number> = {};
        for (const c of creeps) {
            const sid = (c.memory as any).targetSourceId;
            if (!sid) continue;
            boundCounts[sid] = (boundCounts[sid] || 0) + 1;
            const ttl = c.ticksToLive || 0;
            minTtlBySource[sid] = minTtlBySource[sid] == null ? ttl : Math.min(minTtlBySource[sid], ttl);
        }
        // 找到绑定最少的，有位置的采集点
        this.source.forEach((source: Source) => {
            let creepCount = boundCounts[source.id] || 0;
            // 该采集点的最大位置
            let maxPosCount: number;
            if (this.memory.sourcePosCount[source.id]) {
                maxPosCount = this.memory.sourcePosCount[source.id];
            } else {
                if (!terrain) terrain = this.getTerrain();
                let pos = source.pos;
                maxPosCount = 
                [[pos.x - 1, pos.y], [pos.x + 1, pos.y], [pos.x, pos.y - 1], [pos.x, pos.y + 1],
                [pos.x - 1, pos.y - 1], [pos.x + 1, pos.y + 1], [pos.x - 1, pos.y + 1], [pos.x + 1, pos.y - 1]]
                .filter((p) => p[0] > 0 && p[0] < 49 && p[1] > 0 && p[1] < 49 &&
                    terrain.get(p[0], p[1]) !== TERRAIN_MASK_WALL
                ).length
                this.memory.sourcePosCount[source.id] = maxPosCount;
            }
            // 绑定满的忽略
            if (creepCount >= maxPosCount) return;
            // 记录绑定数最小的采集点
            if (creepCount < minCreepCount) {
                minCreepCount = creepCount;
                leastCrowdedSources = [source];
            } else if (creepCount === minCreepCount) {
                leastCrowdedSources.push(source);
            }
        });
    
        let targetSource = null;
        if (leastCrowdedSources.length == 1) {
            targetSource = leastCrowdedSources[0];
        } else if (minCreepCount === 0) {
            targetSource = creep.pos.findClosestByRange(leastCrowdedSources);
        } else if (leastCrowdedSources.length > 1) {
            targetSource = leastCrowdedSources.reduce((obj, source) => {
                const minTickToLive = minTtlBySource[source.id] ?? Infinity;
                if (!obj) return { source, minTickToLive };
                if (obj.minTickToLive > minTickToLive) {
                    return { source, minTickToLive }
                }
                return obj;
            }, null).source;
        }
    
        return targetSource;
    }

    /* 动态生成角色体型 */
    GetRoleBodys(role: string, upbody?:boolean, energyBudget?: number) {
        let lv = this.level;
        let body: any[];
        const budget = energyBudget ?? this.energyCapacityAvailable;

        if (RoleLevelData[role]) {
            while (lv >= 1) {
                const bodyconfig = RoleLevelData[role][lv];
                if (!bodyconfig) return RoleData[role]?.bodypart || [];
                if (upbody && bodyconfig.upbodypart) {
                    body = bodyconfig.upbodypart;
                } else {
                    body = bodyconfig.bodypart
                }
                if (budget >=
                    this.CalculateEnergy(this.GenerateBodys(body))) break;
                lv--;
            }
            if (lv === 0) return [];
        } else return RoleData[role]?.bodypart || [];

        if (lv !== 8) return [...body];

        switch (role) {
            case 'harvester':
                if(this.source.some(s => (s.effects||[])
                    .some(e => e.effect == PWR_REGEN_SOURCE))) {
                    body = RoleLevelData[role][lv].upbodypart;
                }
                break;
            default:
                break;
        }
        return [...body];
    }

    /* 生成指定体型 */
    GenerateBodys(bodypart: any[], role='') {
        if (!Array.isArray(bodypart)) return []
        if (!bodypart.length) return []

        let [work, carry, move, attack, range_attack, heal, claim, tough] = [0, 0, 0, 0, 0, 0, 0, 0];
        if (bodypart.every(item => typeof item[0] == 'string' && Number.isFinite(item[1]))) {
            for (let body of bodypart) {
                if(body[0] === WORK) work += body[1];
                if(body[0] === CARRY) carry += body[1];
                if(body[0] === MOVE) move += body[1];
                if(body[0] === ATTACK) attack += body[1];
                if(body[0] === RANGED_ATTACK) range_attack += body[1];
                if(body[0] === HEAL) heal += body[1];
                if(body[0] === CLAIM) claim += body[1];
                if(body[0] === TOUGH) tough += body[1];
            }
        } else return [];

        let body_list = [];
        // 生成优先级，越往前越优先
        
        switch (role) {
        case 'power-attack':
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            if (move) body_list = AddList(body_list, move - 1, MOVE)
            if (attack) body_list = AddList(body_list, attack, ATTACK)
            if (move) body_list = AddList(body_list, 1, MOVE)
            break;
        case 'power-carry':
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            while (carry > 0 || move > 0) {
                if (carry) body_list = AddList(body_list, 1, CARRY)
                if (move) body_list = AddList(body_list, 1, MOVE)
                carry--; move--;
            }
            break;
        case 'out-carry':
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            let carryCount = Math.min(Math.floor(carry/2), move);
            for (let i = 0; i < carryCount; i++) {
                body_list = AddList(body_list, 2, CARRY)
                body_list = AddList(body_list, 1, MOVE)
            }
            if (carry-carryCount*2) body_list = AddList(body_list, carry-carryCount*2, CARRY);
            if (move-carryCount) body_list = AddList(body_list, move-carryCount, MOVE);
            break;
        case 'out-car':
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            if (work) body_list = AddList(body_list, work, WORK);
            let carCount = Math.min(Math.floor(carry/2), move);
            for (let i = 0; i < carCount; i++) {
                body_list = AddList(body_list, 2, CARRY)
                body_list = AddList(body_list, 1, MOVE)
            }
            if (carry-carCount*2>0) body_list = AddList(body_list, carry-carCount*2, CARRY);
            if (move-carCount>0) body_list = AddList(body_list, move-carCount, MOVE);
            break;
        case 'out-defend':
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            if (move) body_list = AddList(body_list, move - 2, MOVE)
            if (attack) body_list = AddList(body_list, attack, ATTACK)
            if (range_attack) body_list = AddList(body_list, range_attack, RANGED_ATTACK)
            if (heal) body_list = AddList(body_list, heal - 1, HEAL)
            if (move) body_list = AddList(body_list, 2, MOVE)
            if (heal) body_list = AddList(body_list, 1, HEAL)
            break;
        case 'out-attack':
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            if (move) body_list = AddList(body_list, move-2, MOVE)
            if (attack) body_list = AddList(body_list, attack, ATTACK)
            if (heal) body_list = AddList(body_list, heal, HEAL)
            if (move) body_list = AddList(body_list, 2, MOVE)
            break;
        case 'out-renged':
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            if (move) body_list = AddList(body_list, move - 2, MOVE)
            if (range_attack) body_list = AddList(body_list, range_attack, RANGED_ATTACK)
            if (heal) body_list = AddList(body_list, heal, HEAL)
            if (move) body_list = AddList(body_list, 2, MOVE)
            break;
        default:
            for (let body of bodypart) {
                if (BODYPARTS_ALL.includes(body[0]))  {
                    body_list = AddList(body_list, body[1], body[0])
                }
            }
            break;
        }
        return body_list
    }

    /* 计算孵化所需能量 */
    CalculateEnergy(bodypartList: any[]) {
        var num = 0
        for (var part of bodypartList) {
        if (part == WORK) num += 100
        if (part == CARRY) num += 50
        if (part == MOVE) num += 50
        if (part == ATTACK) num += 80
        if (part == RANGED_ATTACK) num += 150
        if (part == HEAL) num += 250
        if (part == CLAIM) num += 600
        if (part == TOUGH) num += 10
        }
        return num
    }

    /** 检查资源是否足够BOOST某个体型 */
    CheckBoostRes(bodypart: any[], boostmap: any) {
        if (Object.keys(boostmap).length == 0) return true;
        let boostAmountMap = {};
        for (let bp of bodypart) {
            if (!boostmap[bp[0]]) continue;
            if (!boostAmountMap[boostmap[bp[0]]]) boostAmountMap[boostmap[bp[0]]] = 0;
            boostAmountMap[boostmap[bp[0]]] += bp[1] * 30;
        }
        for (let mineral in boostAmountMap) {
            if (this[mineral] < boostAmountMap[mineral]) {
                return false;
            }
        }
        return true;
    }

    /** 根据体型和boost配置分配boot任务 */
    AssignBoostTaskByBody(bodypart: any[], boostmap: any = {}, ownerId?: string) {
        if (!this.CheckBoostRes(bodypart, boostmap)) return false;
        for (let bp of bodypart) {
            if (!boostmap[bp[0]]) continue;
            this.AssignBoostTask(boostmap[bp[0]], bp[1] * 30, ownerId)
        }
        return true;
    }

    /** 给lab分配boost任务 */
    AssignBoostTask(mineral: ResourceConstant, amount: number, ownerId?: string) {
        const resolvedOwnerId = ownerId || '__public__';
        // 检查房间内资源是否足够
        const stores = [this.storage, this.terminal, ...(this.lab || [])];
        const totalResource = stores.reduce((sum, s) => sum + (s?.store[mineral] || 0), 0);
        if (totalResource < amount) return false;

        // 检查是否已有相同资源的 Boost 任务
        // 注意：BoostTask 的 data 结构 { mineral, totalAmount, owners }
        // checkSameMissionInPool 需要匹配 data 的每个 key。但这里只需要匹配 mineral
        // 所以我们手动查找
        const boostPool = this.getAllMissionFromPool('boost') as Task[];
        let task = boostPool?.find(t => (t.data as BoostTask).mineral === mineral);

        if (task) {
            // 更新现有任务
            const data = task.data as BoostTask;
            data.totalAmount += amount;
            if (resolvedOwnerId) {
                if (!data.owners[resolvedOwnerId]) {
                    data.owners[resolvedOwnerId] = { amount: 0, time: Game.time };
                }
                data.owners[resolvedOwnerId].amount += amount;
                data.owners[resolvedOwnerId].time = Game.time;
            }
            // 提交更新到内存 (虽然引用修改已经生效，但为了规范)
            this.updateMissionPool('boost', task.id, { data });
        } else {
            // 创建新任务
            const data: BoostTask = {
                mineral,
                totalAmount: amount,
                owners: {},
                active: true
            };
            if (resolvedOwnerId) {
                data.owners[resolvedOwnerId] = { amount, time: Game.time };
            }
            this.addMissionToPool('boost', 'boost', 0, data);
        }

        return true;
    }

    /** 提交lab boost已完成量 */
    SubmitBoostTask(mineral: ResourceConstant, amount: number, ownerId?: string) {
        if (!amount || amount <= 0) return ERR_INVALID_ARGS;
        const boostPool = this.getAllMissionFromPool('boost') as Task[];
        if (!boostPool) return ERR_NOT_FOUND;
        
        const task = boostPool.find(t => (t.data as BoostTask).mineral === mineral);
        if (!task) return ERR_NOT_FOUND;

        const data = task.data as BoostTask;

        // 如果指定了 ownerId，则必须在 owners 中存在才扣减
        // 否则不扣减任务配额，避免未注册的 Creep 消耗任务量
        if (ownerId) {
            if (data.owners && data.owners[ownerId]) {
                data.owners[ownerId].amount -= amount;
                if (data.owners[ownerId].amount <= 0) {
                    delete data.owners[ownerId];
                }
                // 只有当确认是有效的 owner 时，才扣减总任务量
                data.totalAmount -= amount;
            } else if (data.owners && data.owners['__public__']) {
                data.owners['__public__'].amount -= amount;
                if (data.owners['__public__'].amount <= 0) {
                    delete data.owners['__public__'];
                }
                data.totalAmount -= amount;
            } else if (!data.owners || Object.keys(data.owners).length === 0) {
                data.totalAmount -= amount;
            } else {
                // 如果 ownerId 不在 owners 列表中，则认为是“未注册”的消耗，不影响任务总数
                // 这样 Team Creep 就不会因为被抢占而无法完成任务
                return ERR_INVALID_TARGET;
            }
        } else {
            // 如果没提供 ownerId，为了安全起见，也不扣减 totalAmount
            // 或者，我们可以允许“匿名”提交扣减 totalAmount？
            // 考虑到任务池主要是为注册者服务的，匿名消耗应该被视为“意外”
            return ERR_INVALID_ARGS;
        }

        if (data.totalAmount < 0) data.totalAmount = 0;
        // 任务完成判断逻辑交给 UpdateBoostMission 或 submitMission 的 deleteFunc
        // 但这里我们手动调用 submitMission 来更新
        const deleteFunc = (d: BoostTask) => d.totalAmount <= 0;
        this.submitMission('boost', task.id, data, deleteFunc);

        return OK;
    }

    /** 
     * 获取可用于 Boost 的 Lab
     * @description 优先返回存有该资源的 Lab，其次返回空闲 Lab
     */
    getBoostLab(mineral: ResourceConstant): StructureLab | null {
        if (!this.lab || this.lab.length === 0) return null;
        
        const botmem = Memory['StructControlData'][this.name];
        
        // 1. 优先找已经有该资源的 Lab
        const readyLab = this.lab.find(l => 
            l.mineralType === mineral && 
            l.store[mineral] >= 30 && 
            l.store[RESOURCE_ENERGY] >= 20
        );
        if (readyLab) return readyLab;

        // 2. 找已经有该资源但可能能量不足或量不足的 Lab (正在准备中)
        const preparingLab = this.lab.find(l => l.mineralType === mineral);
        if (preparingLab) return preparingLab;

        // 3. 找被 boostLabs 预定给该资源的 Lab (即使它是空的，或者正在清理)
        if (botmem && botmem.boostLabs) {
            // task/fixed 都允许命中：这里仅负责“选中哪个 lab”，真正的填充/清理由 BoostMission/Transport 负责
            const reservedLabId = Object.keys(botmem.boostLabs).find(id => botmem.boostLabs[id]?.mineral === mineral);
            if (reservedLabId) {
                const reservedLab = Game.getObjectById(reservedLabId as Id<StructureLab>);
                if (reservedLab) return reservedLab;
            }
        }

        // 4. 找完全空闲且未被占用的 Lab (作为备选，但这通常由 Transport 模块分配)
        // Creep 不应该主动去一个没资源的空 Lab 等待，除非 Transport 已经分配了任务。
        // 所以这里主要返回已经有资源的 Lab。
        // 如果 Transport 还没运到，Creep 应该等待或者去排队。
        // 为了避免 Creep 找不到目标，我们可以返回一个“即将”拥有该资源的 Lab
        // 这需要 Transport 模块标记 Lab 的用途，目前我们简化为：只返回已有资源的 Lab
        return null;
    }

    /** 删除lab boost任务 */
    RemoveBoostTask(mineral: string) {
        const boostPool = this.getAllMissionFromPool('boost') as Task[];
        if (!boostPool) return ERR_NOT_FOUND;
        
        const task = boostPool.find(t => (t.data as BoostTask).mineral === mineral);
        if (task) {
            this.deleteMissionFromPool('boost', task.id);
            console.log(`删除boost任务: ${mineral}`);
            return OK;
        }
        return ERR_NOT_FOUND;
    }

    /** 寻找敌方creep */
    findEnemyCreeps(opts?: any) {
        if (this['EnemyCreeps']) return this['EnemyCreeps']; 
        const whiteList = getWhitelistSet();
        let EnemyCreeps = this.find(FIND_HOSTILE_CREEPS, opts).filter((c: any) => !whiteList.has(c.owner.username));
        return this['EnemyCreeps'] = [...EnemyCreeps];
    }

    /** 寻找敌方PowerCreep */
    findEnemyPowerCreeps(opts?: any) {
        if (this['EnemyPowerCreeps']) return this['EnemyPowerCreeps']; 
        const whiteList = getWhitelistSet();
        let EnemyPowerCreeps = this.find(FIND_HOSTILE_POWER_CREEPS, opts).filter((c: any) => !whiteList.has(c.owner.username));
        return this['EnemyPowerCreeps'] = [...EnemyPowerCreeps];
    }

    /**
     * 寻找敌方建筑
     */
    findEnemyStructures(opts?: any) {
        if (this['EnemyStructures']) return this['EnemyStructures']; 
        const whiteList = getWhitelistSet();
        let EnemyStructures = this.find(FIND_HOSTILE_STRUCTURES, opts).filter((c: any) => !whiteList.has(c.owner.username));
        this['EnemyStructures'] = [...EnemyStructures];
        return [...EnemyStructures];
    }

    /**
     * 获取房间所有者名字
     */
    getOwner() {
        return this.controller?.owner ? this.controller.owner.username : '';
    }

    /**
     * 获取房间内所有建筑
     */
    getStructures() {
        if (this.structures) return this.structures;
        this.structures = this.find(FIND_STRUCTURES);
        return this.structures;
    }

}

function AddList(list: any[], num: number, type: any) {
    for (let i = 0; i < num; i++) {
        list.push(type)
    }
    return list
}
