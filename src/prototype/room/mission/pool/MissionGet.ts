import { compress, decompress } from '@/modules/utils/compress';
import { THRESHOLDS } from '@/constant/Thresholds';
import { getLayoutData, getStructData } from '@/modules/utils/memory';
import { Goods } from '@/constant/ResourceConstant';

/**
 * 任务获取模块
 */
export default class MissionGet extends Room {
    // 获取运输任务
    getTransportMission(creep: Creep) {
        if(!this.checkMissionInPool('transport')) return null;

        const posInfo = compress(creep.pos.x, creep.pos.y);
        const task = this.getMissionFromPool('transport', posInfo);
        if(!task) return null;

        const data = task.data as TransportTask;
        const source = Game.getObjectById(data.source);
        const target = Game.getObjectById(data.target);
        const resourceType = data.resourceType;
        const amount = data.amount;
        
        // 任务无效则删除, 重新获取
        if(!source || !target || !resourceType || !amount ||
            (source as any).store[resourceType] == 0 ||
            (target as any).store.getFreeCapacity(resourceType) == 0) {
            this.deleteMissionFromPool('transport',task.id);
            return this.getTransportMission(creep);
        }

        this.lockMissionInPool('transport', task.id, creep.id);

        return task;
    }
    // 获取建造任务
    getBuildMission(creep: Creep) {
        const posInfo = compress(creep.pos.x, creep.pos.y);
        if(this.checkMissionInPool('build')){
            const task = this.getMissionFromPool('build', posInfo);
            if(!task) return null;

            return task;
        }
        
        return null;
    }
    // 获取维修任务
    getRepairMission(creep: Creep) {
        const posInfo = compress(creep.pos.x, creep.pos.y);
        if(this.checkMissionInPool('repair')){
            const task = this.getMissionFromPool('repair', posInfo);
            if(!task) return null;

            return task;
        }

        return null;
    }

    // 获取刷墙任务
    getWallMission(creep: Creep) {
        if (this[RESOURCE_ENERGY] < THRESHOLDS.ENERGY.WALL_MIN) return null;

        const roomAny = this as any;
        if (roomAny._wallMissionTickCacheTick === Game.time) {
            return roomAny._wallMissionTickCacheTask ?? null;
        }

        const botMem = getStructData(this.name) as any;
        botMem.wallRepair ??= {};

        const cachedPos = botMem.wallRepair.pos;
        const cachedHits = botMem.wallRepair.hits;
        const cachedUntil = botMem.wallRepair.until;
        if (cachedPos != null && cachedHits != null && cachedUntil && Game.time < cachedUntil) {
            const [x, y] = decompress(cachedPos);
            const structs = this.lookForAt(LOOK_STRUCTURES, x, y).filter((s) =>
                s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART
            );
            const s = structs[0] as any;
            if (s && s.hits < cachedHits) {
                const task = { pos: cachedPos, hits: cachedHits };
                roomAny._wallMissionTickCacheTick = Game.time;
                roomAny._wallMissionTickCacheTask = task;
                return task;
            }
        }

        let WALL_HITS_MAX_THRESHOLD: number = THRESHOLDS.REPAIR.RAMPIRT_MAX_THRESHOLD;
        if (botMem['ram_threshold']) {
            WALL_HITS_MAX_THRESHOLD = Math.min(botMem['ram_threshold'], 1);
        }

        const layout = getLayoutData(this.name) as any;
        const wallMem: number[] = layout['constructedWall'] || [];
        let rampartMem: number[] = layout['rampart'] || [];
        const structRampart: number[] = [];
        for (let s of ['spawn', 'tower', 'storage', 'terminal', 'factory', 'lab', 'nuker', 'powerSpawn']) {
            if (layout[s]) {
                structRampart.push(...(layout[s] || []));
            } else {
                if (Array.isArray((this as any)[s])) {
                    const poss = (this as any)[s].map((s) => compress(s.pos.x, s.pos.y));
                    structRampart.push(...poss);
                } else if ((this as any)[s]) {
                    structRampart.push(compress((this as any)[s].pos.x, (this as any)[s].pos.y));
                }
            }
        }
        rampartMem = [...new Set(rampartMem.concat(structRampart))];
        const candidates = wallMem.concat(rampartMem);
        if (!candidates.length) {
            roomAny._wallMissionTickCacheTick = Game.time;
            roomAny._wallMissionTickCacheTask = null;
            return null;
        }

        const roomNukes = this.find(FIND_NUKES) || [];
        const cursor = botMem.wallRepair.cursor || 0;
        const scanLimit = 40;
        let bestPos = null;
        let bestTargetHits = 0;
        let bestScore = Infinity;
        let bestCursor = cursor;

        for (let i = 0; i < Math.min(scanLimit, candidates.length); i++) {
            const idx = (cursor + i) % candidates.length;
            const posInfo = candidates[idx];
            const [x, y] = decompress(posInfo);
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            const structs = this.lookForAt(LOOK_STRUCTURES, x, y).filter((s) =>
                s.hits < s.hitsMax &&
                (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART)
            );
            if (!structs.length) continue;
            const structure = structs[0] as any;

            let targetHits = 0;
            let score = Infinity;
            if (roomNukes.length > 0) {
                const pos = new RoomPosition(x, y, this.name);
                const areaNukeDamage = roomNukes.filter((n) => pos.inRangeTo(n.pos, 2))
                    .reduce((hits, nuke) => pos.isEqualTo(nuke.pos) ? hits + 1e7 : hits + 5e6, 0);
                if (areaNukeDamage > 0 && structure.hits < areaNukeDamage + 1e6) {
                    targetHits = areaNukeDamage + 1e6;
                    score = 0;
                }
            }
            if (score !== 0) {
                const maxHits = Math.floor(structure.hitsMax * WALL_HITS_MAX_THRESHOLD);
                if (structure.hits >= maxHits) continue;
                targetHits = maxHits;
                score = structure.hits / structure.hitsMax;
            }

            if (score < bestScore) {
                bestScore = score;
                bestPos = posInfo;
                bestTargetHits = targetHits;
                bestCursor = idx;
            }
        }

        botMem.wallRepair.cursor = (cursor + scanLimit) % candidates.length;
        if (!bestPos) {
            delete botMem.wallRepair.pos;
            delete botMem.wallRepair.hits;
            botMem.wallRepair.until = Game.time + 10;
            roomAny._wallMissionTickCacheTick = Game.time;
            roomAny._wallMissionTickCacheTask = null;
            return null;
        }

        botMem.wallRepair.pos = bestPos;
        botMem.wallRepair.hits = bestTargetHits;
        botMem.wallRepair.until = Game.time + 20;
        botMem.wallRepair.cursor = (bestCursor + 1) % candidates.length;
        const task = { pos: bestPos, hits: bestTargetHits };
        roomAny._wallMissionTickCacheTick = Game.time;
        roomAny._wallMissionTickCacheTask = task;
        return task;
    }


    // 获取发送任务
    getSendMission() {
        const terminal = this.terminal;
        const checkFunc = (task: Task) => {
            if (task.type != 'send') return false;
            const data = task.data as SendTask;
            const resourceType = data.resourceType;
            // 发送任务会被 TerminalWork 分批执行，这里不要求一次性满足全部 amount，但需要满足一个"最小批量"
            // 否则可能出现任务存在但永远取不到（terminal 资源少于门槛）导致卡住
            const isGoods = Goods.includes(resourceType as any);
            const minBatch = resourceType === RESOURCE_ENERGY ? THRESHOLDS.ENERGY.SEND_BATCH_ENERGY : (isGoods ? 10 : THRESHOLDS.ENERGY.SEND_BATCH_MINERAL);
            return (terminal.store[resourceType] || 0) >= Math.min(data.amount, minBatch);
        }
        const task = this.getMissionFromPoolFirst('terminal', checkFunc);
        if(!task) return null;
        return task;
    }
    // 获取发送任务总共发送量
    getSendMissionTotalAmount() {
        const tasks = this.getAllMissionFromPool('terminal').filter(task => task.type == 'send');
        const sends = {};
        for(const task of tasks) {
            const data = task.data as SendTask;
            const resTotalAmount = (this.terminal?.store[data.resourceType] || 0) + (this.storage?.store[data.resourceType] || 0);
            if(resTotalAmount < Math.min(data.amount, THRESHOLDS.ENERGY.SEND_REQUEST_MIN)) {
                this.deleteMissionFromPool('terminal', task.id);
                continue;
            }
            sends[data.resourceType] = data.amount + (sends[data.resourceType] || 0);
        }
        return sends;
    }
    // 获取孵化任务
    getSpawnMission() {
        const energyAvailable = this.energyAvailable;
        const filter = (task: Task) => {
            const data = task.data as SpawnTask;
            return (energyAvailable||0) >= (data.energy||0);
        }
        const task = this.getMissionFromPool('spawn', null, filter);
        if(!task) return null;
        return task;
    }

    // 获取每种role的孵化任务数量
    getSpawnMissionNum() {
        // 返回当前 tick 的 spawn 任务角色计数
        const roomAny = this as any;
        if (roomAny._spawnMissionNumCacheTick === Game.time) {
            return roomAny._spawnMissionNumCache || {};
        }

        const tasks = this.getAllMissionFromPool('spawn');
        const spawnMissionNum: Record<string, number> = {};
        for (const task of tasks) {
            const role = (task.data as SpawnTask)?.memory?.role;
            if (!role) continue;
            spawnMissionNum[role] = (spawnMissionNum[role] || 0) + 1;
        }

        roomAny._spawnMissionNumCache = spawnMissionNum;
        roomAny._spawnMissionNumCacheTick = Game.time;
        return spawnMissionNum;
    }

    // 获取指定一些role的总孵化数
    getSpawnMissionTotalByRoles(roles: string[]) {
        const tasks = this.getAllMissionFromPool('spawn');
        let num = 0;
        for(const task of tasks) {
            const data = task.data as SpawnTask;
            const role = data.memory.role;
            if(roles.includes(role)) num++;
        }
        return num;
    }
}
