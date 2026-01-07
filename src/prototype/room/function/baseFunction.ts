import { RoleData, RoleLevelData } from '@/constant/CreepConstant';

/**
 * 一些基础的功能
 */
export default class BaseFunction extends Room {
    // 获取房间能量储备
    AllEnergy() {
        let Energy = 0;
        for(const s of this.mass_stores) {
            Energy += s.store[RESOURCE_ENERGY];
        }
        return Energy;
    }

    // 判断是否在白名单中
    isWhiteList() {
        let whiteList = new Set<string>(Memory['whitelist'] || []);
        return whiteList.has(this.controller?.owner?.username);
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
        if (this['CreepNumChecked'])
            return global.CreepNum[this.name] ||
                  (global.CreepNum[this.name] = {});
        global.CreepNum = {};
        Object.values(Game.creeps).forEach((creep: Creep) => {
            if(!creep || creep.ticksToLive < creep.body.length * 3) return;
            const role = creep.memory.role;
            const home = creep.memory.home || creep.memory.homeRoom || creep.room.name;
            if(!role || !home) return;
            if (!global.CreepNum[home]) global.CreepNum[home] = {};
            global.CreepNum[home][role] = (global.CreepNum[home][role] || 0) + 1;
        })
        this['CreepNumChecked'] = true;
        return global.CreepNum[this.name] || (global.CreepNum[this.name] = {});
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

    // 获取绑定最少的能量源
    closestSource(creep: Creep) {
        // 初始化最少Creep绑定计数
        let minCreepCount = Infinity;
        let leastCrowdedSources = [];

        if(!this.memory.sourcePosCount) this.memory.sourcePosCount = {}
        let terrain = null;
        let creeps = this.find(FIND_MY_CREEPS, {
            filter: c => c.id != creep.id && c.ticksToLive > 100 &&
                    c.memory.role === creep.memory.role
        }) || [];
        // 找到绑定最少的，有位置的采集点
        this.source.forEach((source: Source) => {
            let creepCount = creeps.filter(c => c.memory.targetSourceId === source.id).length;
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
                const minTickToLive = creeps.reduce((min, c) => {
                    if (c.memory.targetSourceId === source.id) {
                        return Math.min(min, c.ticksToLive);
                    } else {
                        return min;
                    }
                }, Infinity);
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
    GetRoleBodys(role: string, upbody?:boolean) {
        let lv = this.level;
        let body: any[];

        if (RoleLevelData[role]) {
            while (lv >= 1) {
                const bodyconfig = RoleLevelData[role][lv];
                if (!bodyconfig) return RoleData[role]?.bodypart || [];
                if (upbody && bodyconfig.upbodypart) {
                    body = bodyconfig.upbodypart;
                } else {
                    body = bodyconfig.bodypart
                }
                if (this.energyCapacityAvailable >=
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
    AssignBoostTaskByBody(bodypart: any[], boostmap: any = {}) {
        if (!this.CheckBoostRes(bodypart, boostmap)) return false;
        for (let bp of bodypart) {
            if (!boostmap[bp[0]]) continue;
            this.AssignBoostTask(boostmap[bp[0]], bp[1] * 30)
        }
        return true;
    }

    /** 给lab分配boost任务 */
    AssignBoostTask(mineral: ResourceConstant, amount: number) {
        const boostmem = Memory['StructControlData'][this.name];
        if (!boostmem['boostRes']) boostmem['boostRes'] = {};
        const stores = [this.storage, this.terminal, ...this.lab]
        if (stores.reduce((pre, cur) => pre + cur.store[mineral], 0) < amount) return false;
        // 如果已有相同任务, 则增加其数量
        const lab = this.lab.find(lab => boostmem['boostRes'][lab.id] && boostmem['boostRes'][lab.id].mineral === mineral);
        if (lab) {
            boostmem['boostRes'][lab.id].amount += amount;
            // console.log(`增加boost任务: ${mineral} ${amount} 到 ${lab.id}`);
            // console.log(`当前boost任务量: ${mineral} - ${boostmem['boostRes'][lab.id].amount}`);
            return true;
        }
        // 找到未被分配boost任务，并且非底物的lab
        const labs = this.lab.filter(lab => !boostmem['boostRes'][lab.id] &&
            !boostmem['boostTypes'][lab.id] && lab.id !== boostmem.labA && lab.id !== boostmem.labB);
        if (labs.length) {
            const lab = labs[0];
            boostmem['boostRes'][lab.id] = {
                mineral: mineral,
                amount: amount
            };
            // console.log(`分配boost任务: ${mineral} ${amount} 到 ${lab.id}`);
            return true;
        } else {
            // 没有就暂时放进队列
            if (!boostmem['boostQueue']) boostmem['boostQueue'] = {};
            boostmem['boostQueue'][mineral] = (boostmem['boostQueue'][mineral] || 0) + amount;
            console.log(`没有可用的lab，暂时将boost任务: ${mineral} ${amount} 放进队列`);
            return false;
        }
    }

    /** 提交lab boost已完成量 */
    SubmitBoostTask(mineral: string, amount: number) {
        const boostmem = Memory['StructControlData'][this.name];
        if  (!boostmem['boostRes']) return ERR_NOT_FOUND;
        const lab = this.lab.find(lab => boostmem['boostRes'][lab.id] &&
            boostmem['boostRes'][lab.id].mineral === mineral);
        if (!lab) return OK;
        
        boostmem['boostRes'][lab.id].amount -= amount;
        if (boostmem['boostRes'][lab.id].amount <= 0) {
            delete boostmem['boostRes'][lab.id];
        }
        return OK;
    }

    /** 删除lab boost任务 */
    RemoveBoostTask(mineral: string) {
        const boostmem = Memory['StructControlData'][this.name];
        if  (!boostmem['boostRes']) return ERR_NOT_FOUND;
        const lab = this.lab.find(lab => boostmem['boostRes'][lab.id] &&
                    boostmem['boostRes'][lab.id].mineral === mineral);
        if (lab) {
            delete boostmem['boostRes'][lab.id];
            console.log(`删除boost任务: ${mineral} ${lab.id}`);
            return OK;
        } else {
            if (boostmem['boostQueue'] && boostmem['boostQueue'][mineral]) {
                delete boostmem['boostQueue'][mineral];
                console.log(`已从队列中删除boost任务: ${mineral}`);
                return OK;
            }
        }
    }

    /** 寻找敌方creep */
    findEnemyCreeps(opts?: any) {
        if (this['EnemyCreeps']) return this['EnemyCreeps']; 
        let whiteList = new Set<string>(Memory['whitelist'] || []);
        let EnemyCreeps = this.find(FIND_HOSTILE_CREEPS, opts).filter((c: any) => !whiteList.has(c.owner.username));
        return this['EnemyCreeps'] = [...EnemyCreeps];
    }

    /** 寻找敌方PowerCreep */
    findEnemyPowerCreeps(opts?: any) {
        if (this['EnemyPowerCreeps']) return this['EnemyPowerCreeps']; 
        let whiteList = new Set<string>(Memory['whitelist'] || []);
        let EnemyPowerCreeps = this.find(FIND_HOSTILE_POWER_CREEPS, opts).filter((c: any) => !whiteList.has(c.owner.username));
        return this['EnemyPowerCreeps'] = [...EnemyPowerCreeps];
    }

    /**
     * 寻找敌方建筑
     */
    findEnemyStructures(opts?: any) {
        if (this['EnemyStructures']) return this['EnemyStructures']; 
        let whiteList = new Set<string>(Memory['whitelist'] || []);
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


