import { MISSION_POOLS } from '@/constant/MissionConstant';
import { ROLES } from '@/constant/CreepConstant';
import { RoleData, RoleLevelData } from '@/constant/CreepConstant';
import { inWhitelist } from '@/modules/shared/defenseUtils';
import { getRoomData, getStructData } from '@/modules/shared/memory';
import { getCreepNumByAssignedRoom } from '@/modules/shared/creepTickIndex';

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
            filter: (c: Creep) => c && (c.ticksToLive || 0) > 0 && c.memory.role === role
        }) as Creep[];
        cached[room.name][role] = creeps;
        return creeps;
    };
})();

const LEGACY_SHARED_SOURCE_ROLE_SET = new Set<string>([ROLES.worker, ROLES.upgrader, ROLES.universal, ROLES['aid-upgrade']]);
const STRICT_SOURCE_ROLE_SET = new Set<string>([ROLES.harvester, ROLES['out-harvest']]);
const SOURCE_PRIORITY_MAP = {
    harvester: 0,
    universal: 1,
    worker: 2,
    upgrader: 3,
} as const;

type SourcePriorityRole = keyof typeof SOURCE_PRIORITY_MAP;
type SourceCompetitor = {
    creep: Creep;
    priority: number;
    isAdjacent: boolean;
    isBound: boolean;
    distance: number;
};

const getSourcePriority = (role?: string): number | null => {
    if (!role) return null;
    const priority = SOURCE_PRIORITY_MAP[role as SourcePriorityRole];
    return priority == null ? null : priority;
};

const isPrioritySourceRole = (role?: string): role is SourcePriorityRole => getSourcePriority(role) != null;

const getSourceReservationsByRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Record<string, Set<string>>> = {};
    return (room: Room) => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            cached = {};
        }
        if (!cached[room.name]) cached[room.name] = {};
        return cached[room.name];
    };
})();

const reserveSourceForCreep = (room: Room, sourceId: Id<Source>, creepName: string) => {
    const roomCache = getSourceReservationsByRoom(room);
    const set = roomCache[sourceId] || (roomCache[sourceId] = new Set());
    set.add(creepName);
};

const getReservedSourceCountForCreep = (room: Room, sourceId: Id<Source>, creepName: string) => {
    const roomCache = getSourceReservationsByRoom(room);
    const set = roomCache[sourceId];
    if (!set) return 0;
    if (set.has(creepName)) return Math.max(0, set.size - 1);
    return set.size;
};

const getPrioritySourceCreepsByRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Creep[]> = {};
    return (room: Room) => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            cached = {};
        }
        const hit = cached[room.name];
        if (hit) return hit;
        const creeps = room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) =>
                c &&
                (c.ticksToLive || 0) > 1 &&
                isPrioritySourceRole(c.memory.role)
        }) as Creep[];
        cached[room.name] = creeps;
        return creeps;
    };
})();

const WALKABLE_SOURCE_STRUCTURE_SET = new Set<StructureConstant>([
    STRUCTURE_CONTAINER,
    STRUCTURE_ROAD,
    STRUCTURE_RAMPART,
]);

const isStandableSourcePos = (room: Room, x: number, y: number) => {
    const terrain = room.getTerrain();
    if (x <= 0 || x >= 49 || y <= 0 || y >= 49) return false;
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

    const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
    if (structures.some(structure => {
        if (structure.structureType === STRUCTURE_RAMPART) {
            const rampart = structure as StructureRampart;
            return !rampart.my && !rampart.isPublic;
        }
        return !WALKABLE_SOURCE_STRUCTURE_SET.has(structure.structureType);
    })) return false;

    const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y) as ConstructionSite[];
    if (sites.some(site => !WALKABLE_SOURCE_STRUCTURE_SET.has(site.structureType))) return false;

    return true;
};

const getMyLegacySourceBoundCreepsByRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Creep[]> = {};
    return (room: Room) => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            cached = {};
        }
        const hit = cached[room.name];
        if (hit) return hit;
        const creeps = room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) => c && (c.ticksToLive || 0) > 0 && !!c.memory.targetSourceId
        }) as Creep[];
        cached[room.name] = creeps;
        return creeps;
    };
})();

const getSourceWalkableCount = (room: Room, source: Source) => {
    if (!room.memory.sourcePosCount) room.memory.sourcePosCount = {};
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
    ].filter((p) => isStandableSourcePos(room, p[0], p[1])).length;

    room.memory.sourcePosCount[source.id] = walkable;
    return walkable;
};

const sortSourceCompetitors = (a: SourceCompetitor, b: SourceCompetitor) =>
    a.priority - b.priority ||
    Number(b.isAdjacent) - Number(a.isAdjacent) ||
    Number(b.isBound) - Number(a.isBound) ||
    a.distance - b.distance ||
    a.creep.name.localeCompare(b.creep.name);

const getSourceCompetitors = (room: Room, source: Source, candidate?: Creep) => {
    const competitors: SourceCompetitor[] = [];
    let hasCandidate = false;

    for (const creep of getPrioritySourceCreepsByRoom(room)) {
        const priority = getSourcePriority(creep.memory.role);
        if (priority == null) continue;

        const isBound = creep.memory.targetSourceId === source.id;
        const isAdjacent = creep.pos.inRangeTo(source.pos, 1);
        if (!isBound && !isAdjacent && (!candidate || creep.id !== candidate.id)) continue;

        if (candidate && creep.id === candidate.id) hasCandidate = true;
        competitors.push({
            creep,
            priority,
            isAdjacent,
            isBound,
            distance: creep.pos.getRangeTo(source.pos),
        });
    }

    if (candidate && isPrioritySourceRole(candidate.memory.role) && !hasCandidate) {
        competitors.push({
            creep: candidate,
            priority: getSourcePriority(candidate.memory.role)!,
            isAdjacent: candidate.pos.inRangeTo(source.pos, 1),
            isBound: candidate.memory.targetSourceId === source.id,
            distance: candidate.pos.getRangeTo(source.pos),
        });
    }

    competitors.sort(sortSourceCompetitors);
    return competitors;
};

const getAllowedSourceCandidate = (room: Room, creep: Creep, source: Source) => {
    const slots = getSourceWalkableCount(room, source);
    const competitors = getSourceCompetitors(room, source, creep);
    return {
        competitors,
        allowed: slots > 0 && competitors.slice(0, slots).some(item => item.creep.id === creep.id)
    };
};

/**
 * 一些基础的功能
 */
export default class BaseFunction extends Room {
    // 判断是否在白名单中
    isWhiteList() {
        return inWhitelist(this.controller?.owner?.username);
    }

    getCenter() {
        const center = getRoomData()?.[this.name]?.center;
        if (center) return new RoomPosition(center.x, center.y, this.name);
        return new RoomPosition(25, 25, this.name);
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
        return getCreepNumByAssignedRoom(this.name);
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
        const totalEnergy = avail + storageEnergy + terminalEnergy + containerEnergy + linkEnergy;
        return { cap, avail, storageEnergy, terminalEnergy, containerEnergy, linkEnergy, totalEnergy };
    }

    updateEnergyState(force = false) {
        if (!force && this.memory.energyStateTick && this.memory.energyState) {
            const interval = this.memory.energyState === 'CRITICAL' ? 2 : 5;
            if (Game.time - this.memory.energyStateTick < interval) return this.memory.energyState;
        }
        const { cap, avail, totalEnergy } = this.getEnergyProfile();
        const capRef = Math.max(300, cap);
        const creepNum = this.getCreepNum();
        const logisticNum =
            (creepNum[ROLES.carrier] || 0) +
            (creepNum[ROLES.transporter] || 0) +
            (creepNum[ROLES.manager] || 0) +
            (creepNum[ROLES.universal] || 0);
        const spawnNeedsEnergy = this.CheckSpawnAndTower();
        const energyRatio = capRef > 0 ? (avail / capRef) : 0;
        const hasStoredEnergy = totalEnergy >= capRef;
        const logisticThin = logisticNum <= 1;

        type EnergyState = NonNullable<RoomMemory['energyState']>;
        let state: EnergyState;
        if (avail < Math.min(300, capRef) && totalEnergy < capRef) {
            // spawn/extension 空且**储能也见底**才是真饥荒；
            // 储能还在就只是补能延迟（快递在途），判荒会让外矿停摆、升级归零，越闸越穷
            state = 'CRITICAL';
        } else if (logisticNum === 0 && spawnNeedsEnergy && hasStoredEnergy) {
            state = 'CRITICAL';
        } else if (spawnNeedsEnergy && hasStoredEnergy && logisticThin && energyRatio < 0.35) {
            state = energyRatio < 0.2 ? 'CRITICAL' : 'LOW';
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

    isDefending() {
        if ((this.memory as any).defend) return true;
        const until = (this.memory as any).defendUntil as number | undefined;
        return !!(until && until > Game.time);
    }

    isResourceTransferInSafe() {
        //  判断“是否允许向该房间转入资源”应基于实际攻防态（defend/breached/冷却），而不是用 tower 数量当代理。
        if (!this.my) return false;
        if (!this.storage || !this.terminal) return false;
        if (this.level < 6) return false;
        const owner = this.controller?.owner?.username;
        if (owner && (this.storage.owner.username !== owner || this.terminal.owner.username !== owner)) return false;
        if (this.controller?.safeMode) return true;

        if (this.isDefending()) return false;
        if ((this.memory as any).breached) return false;

        const unsafeUntil = (this.memory as any).resourceUnsafeUntil as number | undefined;
        if (unsafeUntil && unsafeUntil > Game.time) return false;
        return true;
    }

    // 获取绑定最少的能量源
    closestSource(creep: Creep) {
        const role = creep.memory.role;
        const isStrictRole = !!role && STRICT_SOURCE_ROLE_SET.has(role);
        const availableSources = (this.source || []).filter(
            source => source && (isStrictRole ? true : source.energy > 0)
        );
        if (availableSources.length <= 0) return null;

        if (isStrictRole) {
            const currentSource = creep.getBoundSource?.() || null;
            if (currentSource) return currentSource;

            const creeps = role ? getMyCreepsByRoleByRoom(this, role) : [];
            const boundCounts: Record<string, number> = {};
            const minTtlBySource: Record<string, number> = {};
            for (const c of creeps) {
                if (c.id === creep.id) continue;
                const sid = c.memory.targetSourceId;
                if (!sid) continue;
                boundCounts[sid] = (boundCounts[sid] || 0) + 1;
                const ttl = c.ticksToLive || 0;
                minTtlBySource[sid] = minTtlBySource[sid] == null
                    ? ttl
                    : Math.min(minTtlBySource[sid], ttl);
            }

            let best: Source | null = null;
            let bestCount = Infinity;
            let bestMinTtl = Infinity;
            let bestDistance = Infinity;

            for (const source of availableSources) {
                const slots = getSourceWalkableCount(this, source);
                if (slots <= 0) continue;
                const count = (boundCounts[source.id] || 0) +
                    getReservedSourceCountForCreep(this, source.id, creep.name);
                if (count >= slots) continue;
                const minTtl = minTtlBySource[source.id] ?? Infinity;
                const distance = creep.pos.getRangeTo(source.pos);
                if (
                    count < bestCount ||
                    (count === bestCount && minTtl < bestMinTtl) ||
                    (count === bestCount && minTtl === bestMinTtl && distance < bestDistance)
                ) {
                    best = source;
                    bestCount = count;
                    bestMinTtl = minTtl;
                    bestDistance = distance;
                }
            }

            if (best) reserveSourceForCreep(this, best.id, creep.name);
            return best;
        }

        if (isPrioritySourceRole(role)) {
            const currentSource = creep.getBoundSource?.() || null;
            if (currentSource && currentSource.energy > 0 && getAllowedSourceCandidate(this, creep, currentSource).allowed) {
                return currentSource;
            }

            let best: Source | null = null;
            let bestCrowd = Infinity;
            let bestDistance = Infinity;
            for (const source of availableSources) {
                const { competitors, allowed } = getAllowedSourceCandidate(this, creep, source);
                if (!allowed) continue;
                const crowd = competitors.length;
                const distance = creep.pos.getRangeTo(source.pos);
                if (crowd < bestCrowd || (crowd === bestCrowd && distance < bestDistance)) {
                    best = source;
                    bestCrowd = crowd;
                    bestDistance = distance;
                }
            }
            return best;
        }
        // 初始化最少Creep绑定计数
        let minCreepCount = Infinity;
        let leastCrowdedSources = [];

        if(!this.memory.sourcePosCount) this.memory.sourcePosCount = {}
        const useSharedCrowd = !!role && LEGACY_SHARED_SOURCE_ROLE_SET.has(role);
        const creeps = role
            ? (useSharedCrowd ? getMyLegacySourceBoundCreepsByRoom(this) : getMyCreepsByRoleByRoom(this, role)).filter(c => {
                if (c.id === creep.id) return false;
                const otherRole = c.memory.role;
                if (!otherRole) return false;
                if (!useSharedCrowd) return otherRole === role;
                if (!LEGACY_SHARED_SOURCE_ROLE_SET.has(otherRole)) return false;
                if (otherRole !== ROLES.universal && c.memory.working) return false;
                return true;
            })
            : [];
        const boundCounts: Record<string, number> = {};
        const minTtlBySource: Record<string, number> = {};
        for (const c of creeps) {
            const sid = c.memory.targetSourceId;
            if (!sid) continue;
            boundCounts[sid] = (boundCounts[sid] || 0) + 1;
            const ttl = c.ticksToLive || 0;
            minTtlBySource[sid] = minTtlBySource[sid] == null ? ttl : Math.min(minTtlBySource[sid], ttl);
        }
        // 找到绑定最少的，有位置的采集点
        availableSources.forEach((source: Source) => {
            let creepCount = boundCounts[source.id] || 0;
            const maxPosCount = getSourceWalkableCount(this, source);
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
    canUseSourceByPriority(creep: Creep, source: Source) {
        if (!source || source.room.name !== this.name) return false;
        if (!isPrioritySourceRole(creep.memory.role)) return true;
        return getAllowedSourceCandidate(this, creep, source).allowed;
    }

    shouldYieldSourceByPriority(creep: Creep, source: Source) {
        if (!source || source.room.name !== this.name) return false;
        if (!isPrioritySourceRole(creep.memory.role)) return false;
        return !this.canUseSourceByPriority(creep, source);
    }

    GetRoleBodys(role: string, upbody?:boolean, energyBudget?: number, miniBody?: boolean) {
        let lv = this.level;
        let body: any[];
        const budget = energyBudget ?? this.energyCapacityAvailable;

        if (role === ROLES.manager && energyBudget !== undefined) {
            const minConfig = RoleData[role]?.bodypart;
            if (minConfig) {
                const minBody = this.GenerateBodys(minConfig, role);
                const minCost = this.CalculateEnergy(minBody);
                if (budget < minCost) return [];
            }
        }

        if (RoleLevelData[role]) {
            while (lv >= 1) {
                const bodyconfig = RoleLevelData[role][lv];
                if (!bodyconfig) return RoleData[role]?.bodypart || [];
                if (miniBody && bodyconfig.minipart) {
                    body = bodyconfig.minipart;
                } else if (upbody && bodyconfig.upbodypart) {
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
            case ROLES.harvester:
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
        case ROLES['power-attack']:
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            if (move) body_list = AddList(body_list, move - 1, MOVE)
            if (attack) body_list = AddList(body_list, attack, ATTACK)
            if (move) body_list = AddList(body_list, 1, MOVE)
            break;
        case ROLES['power-carry']:
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            while (carry > 0 || move > 0) {
                if (carry) body_list = AddList(body_list, 1, CARRY)
                if (move) body_list = AddList(body_list, 1, MOVE)
                carry--; move--;
            }
            break;
        case ROLES['out-carry']:
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            let carryCount = Math.min(Math.floor(carry/2), move);
            for (let i = 0; i < carryCount; i++) {
                body_list = AddList(body_list, 2, CARRY)
                body_list = AddList(body_list, 1, MOVE)
            }
            if (carry-carryCount*2) body_list = AddList(body_list, carry-carryCount*2, CARRY);
            if (move-carryCount) body_list = AddList(body_list, move-carryCount, MOVE);
            break;
        case ROLES['out-defend']:
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            if (move) body_list = AddList(body_list, move - 2, MOVE)
            if (attack) body_list = AddList(body_list, attack, ATTACK)
            if (range_attack) body_list = AddList(body_list, range_attack, RANGED_ATTACK)
            if (heal) body_list = AddList(body_list, heal - 1, HEAL)
            if (move) body_list = AddList(body_list, 2, MOVE)
            if (heal) body_list = AddList(body_list, 1, HEAL)
            break;
        case ROLES['out-attack']:
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            if (move) body_list = AddList(body_list, move-2, MOVE)
            if (attack) body_list = AddList(body_list, attack, ATTACK)
            if (heal) body_list = AddList(body_list, heal, HEAL)
            if (move) body_list = AddList(body_list, 2, MOVE)
            break;
        case ROLES['out-ranged']:
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
        const normalizeBoostList = (v: string | string[] | undefined): string[] => {
            if (!v) return [];
            if (Array.isArray(v)) return v.filter(Boolean);
            return [v];
        };

        // 支持 boostmap 的 value 为 string 或 string[]：按候选列表顺序，贪心选择可用资源
        const remaining: { [mineral: string]: number } = {};

        for (let bp of bodypart) {
            if (!boostmap[bp[0]]) continue;

            const boostList = normalizeBoostList(boostmap[bp[0]]);
            if (boostList.length <= 0) continue;

            const amount = bp[1] * 30;
            let selected: string | null = null;

            for (const mineral of boostList) {
                const available = remaining[mineral] ?? this[mineral] ?? 0;
                if (available >= amount) {
                    selected = mineral;
                    remaining[mineral] = available - amount;
                    break;
                }
            }

            if (!selected) return false;
        }

        return true;
    }

    /** 根据体型和boost配置分配boot任务 */
    AssignBoostTaskByBody(bodypart: any[], boostmap: any = {}, ownerId?: string) {
        if (!this.CheckBoostRes(bodypart, boostmap)) return false;
        const normalizeBoostList = (v: string | string[] | undefined): string[] => {
            if (!v) return [];
            if (Array.isArray(v)) return v.filter(Boolean);
            return [v];
        };

        // 与 CheckBoostRes 使用同一套选择逻辑，避免检查通过但分配失败
        const remaining: { [mineral: string]: number } = {};

        for (let bp of bodypart) {
            if (!boostmap[bp[0]]) continue;

            const boostList = normalizeBoostList(boostmap[bp[0]]);
            if (boostList.length <= 0) continue;

            const amount = bp[1] * 30;
            let selected: ResourceConstant | null = null;

            for (const mineral of boostList as ResourceConstant[]) {
                const available = remaining[mineral] ?? this[mineral] ?? 0;
                if (available >= amount) {
                    selected = mineral;
                    remaining[mineral] = available - amount;
                    break;
                }
            }

            if (!selected) return false;
            if (!this.AssignBoostTask(selected, amount, ownerId)) return false;
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
        const boostPool = this.getAllMissionFromPool(MISSION_POOLS.boost) as Task[];
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
            this.updateMissionPool(MISSION_POOLS.boost, task.id, { data });
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
            this.addMissionToPool(MISSION_POOLS.boost, 'boost', 0, data);
        }

        return true;
    }

    /** 提交lab boost已完成量 */
    SubmitBoostTask(mineral: ResourceConstant, amount: number, ownerId?: string) {
        if (!amount || amount <= 0) return ERR_INVALID_ARGS;
        const boostPool = this.getAllMissionFromPool(MISSION_POOLS.boost) as Task[];
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
        this.submitMission(MISSION_POOLS.boost, task.id, data, deleteFunc);

        return OK;
    }

    /** 
     * 获取可用于 Boost 的 Lab
     * @description 优先返回存有该资源的 Lab，其次返回空闲 Lab
     */
    getBoostLab(mineral: ResourceConstant): StructureLab | null {
        if (!this.lab || this.lab.length === 0) return null;
        
        const botmem = getStructData()?.[this.name] as any;
        
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
        const boostPool = this.getAllMissionFromPool(MISSION_POOLS.boost) as Task[];
        if (!boostPool) return ERR_NOT_FOUND;
        
        const task = boostPool.find(t => (t.data as BoostTask).mineral === mineral);
        if (task) {
            this.deleteMissionFromPool(MISSION_POOLS.boost, task.id);
            console.log(`删除boost任务: ${mineral}`);
            return OK;
        }
        return ERR_NOT_FOUND;
    }

    /** 寻找敌方creep */
    findEnemyCreeps(opts?: any) {
        const base = (this['EnemyCreeps'] ||
            (this['EnemyCreeps'] = this
                .find(FIND_HOSTILE_CREEPS, { filter: (c: Creep) => !inWhitelist(c.owner.username) }))) as Creep[]
        const filter = opts?.filter
        if (!filter) return base
        return base.filter(filter)
    }

    /** 寻找敌方PowerCreep */
    findEnemyPowerCreeps(opts?: any) {
        const base = (this['EnemyPowerCreeps'] ||
            (this['EnemyPowerCreeps'] = this
                .find(FIND_HOSTILE_POWER_CREEPS, { filter: (c: PowerCreep) => !inWhitelist(c.owner.username) }))) as PowerCreep[]
        const filter = opts?.filter
        if (!filter) return base
        return base.filter(filter)
    }

    /**
     * 寻找敌方建筑
     */
    findEnemyStructures(opts?: any) {
        const base = (this['EnemyStructures'] ||
            (this['EnemyStructures'] = this
                .find(FIND_HOSTILE_STRUCTURES, { filter: (c: AnyOwnedStructure) => !inWhitelist(c.owner.username) }))) as AnyOwnedStructure[]
        const filter = opts?.filter
        if (!filter) return base
        return base.filter(filter)
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

    /**
     * 确保控制器旁有能量缓冲工地（冲级/常驻升级的「围在周边秒取能」配套）。
     * RCL4-7 且控制器 3 格内无 storage/terminal 建筑与同类工地时，
     * 在控制器 2 格内找一个可建位放置 terminal（RCL6+）或 storage 工地。
     * RCL8 不放：升级吞吐已封顶（15e/t）、link 体系接管供能，
     * 且会挤占 layout 正位的 storage/terminal 名额（每类全房只有 1 个）。
     * 建造由 worker 自然完成，本方法只负责放工地（低频调用）。
     */
    ensureControllerBufferSite() {
        if (this.level < 4 || this.level >= 8) return;
        const controller = this.controller;
        if (!controller?.my) return;

        const hasBuffer =
            (this.storage && this.storage.pos.inRangeTo(controller.pos, 3)) ||
            (this.terminal && this.terminal.pos.inRangeTo(controller.pos, 3));
        if (hasBuffer) return;

        const wanted = this.level >= 6 ? STRUCTURE_TERMINAL : STRUCTURE_STORAGE;
        const existingSite = controller.pos.findInRange(FIND_CONSTRUCTION_SITES, 2)
            .find(s => s.structureType === wanted);
        if (existingSite) return;

        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = controller.pos.x + dx;
                const y = controller.pos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                if (this.getTerrain().get(x, y) === TERRAIN_MASK_WALL) continue;
                const pos = new RoomPosition(x, y, this.name);
                const blocked = pos.lookFor(LOOK_STRUCTURES).some(s =>
                    s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART);
                if (blocked) continue;
                if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) continue;
                if (pos.createConstructionSite(wanted) === OK) return;
            }
        }
    }

}

function AddList(list: any[], num: number, type: any) {
    for (let i = 0; i < num; i++) {
        list.push(type)
    }
    return list
}
