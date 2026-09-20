import { compress } from '@/shared/compress';
import { getLayoutData } from '@/shared/memory';
import { writeMoveWorkTileCandidates } from '@/shared/moveWork';
import { getRoomTickCacheValue } from '@/shared/roomTickCache';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { runWorkLayer } from '@/framework/ai/adapters';
import { ensureMemoryCache } from '@/prototype/Creep/function/cacheFunction';

const getUpRepairTargetCache = (creep: Creep): Record<string, any> => {
    const cache = ensureMemoryCache(creep.memory) as Record<string, any>;
    return (cache.target && typeof cache.target === 'object' ? cache.target : (cache.target = {})) as Record<string, any>;
};

const getUpRepairTargetId = (creep: Creep): Id<StructureRampart | StructureWall> | undefined => {
    return (ensureMemoryCache(creep.memory).target as Record<string, any> | undefined)?.targetId;
};

export const syncUpRepairMoveWork = (creep: Creep) => {
    const targetId = getUpRepairTargetId(creep);
    if (!targetId) {
        writeMoveWorkTileCandidates(creep, []);
        return;
    }

    const target = Game.getObjectById(targetId);
    writeMoveWorkTileCandidates(creep, target ? [{ pos: target.pos, range: 3 }] : []);
};

const RepairWork = function (creep: Creep) {
    const cache = getUpRepairTargetCache(creep);
    const targetId = getUpRepairTargetId(creep);
    let target = targetId ? Game.getObjectById(targetId) : null;

    if (!target || target.hits == target.hitsMax) {
        const memory = getLayoutData(creep.room.name);
        let wallMem = memory['constructedWall'] || [];
        let rampartMem = memory['rampart'] || [];
        let structRampart = [];
        for (let s of ['spawn', 'tower', 'storage', 'terminal', 'factory', 'lab', 'nuker', 'powerSpawn']) {
            structRampart.push(...(memory[s] || []));
        }
        rampartMem = [...new Set(rampartMem.concat(structRampart))];

        const allRamWalls = getRoomTickCacheValue(creep.room, 'up_repair_all_ram_walls', () =>
            creep.room.getStructures().filter((structure) => {
                if (structure.structureType !== STRUCTURE_RAMPART &&
                    structure.structureType !== STRUCTURE_WALL) return false;
                if (structure.structureType == STRUCTURE_RAMPART &&
                    !rampartMem.includes(compress(structure.pos.x, structure.pos.y))) return false;
                if (structure.structureType == STRUCTURE_WALL &&
                    !wallMem.includes(compress(structure.pos.x, structure.pos.y))) return false;
                return structure.hits < structure.hitsMax;
            }) as (StructureRampart | StructureWall)[]
        );
        
        let inRangeRamWalls = []
        const linkId = creep.memory.linkId;
        const link = linkId ? Game.getObjectById(linkId) : null;
        if (link) {
            inRangeRamWalls = allRamWalls.filter(structure => structure.pos.inRangeTo(link.pos, 4));
        } else {
            inRangeRamWalls = allRamWalls.filter(structure => structure.pos.inRangeTo(creep.pos, 3));
        }

        const minHits = 20e6;
        const maxHits = 300e6;
        let target = null;
        for (let i = 1; i <= maxHits/minHits; i++) {
            let ramwalls = inRangeRamWalls.filter(structure => structure.hits < Math.min(i * minHits, structure.hitsMax));
            if (ramwalls.length > 0) {
                target = ramwalls.reduce((a, b) => a.hits < b.hits ? a : b);
                break;
            }
        }
        
        if (target) cache.targetId = target.id;
    }

    if (target) creep.goRepair(target);

    if(creep.store[RESOURCE_ENERGY] < 50) {
        const link = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
            filter: structure => structure.structureType == STRUCTURE_LINK &&
                structure.store[RESOURCE_ENERGY] > 0
        })[0] as StructureLink;
        if (link) {
            creep.withdraw(link, RESOURCE_ENERGY);
        }
    }

    return;
}

const WithdrawLink = function (creep: Creep) {
    const linkId = creep.memory.linkId;
    let linktarget = linkId ? Game.getObjectById(linkId) : undefined;
    if (!linktarget) {
        const centerPos = creep.room.getCenter();
        const sources = creep.room.source;
        const weakRamparts = getRoomTickCacheValue(creep.room, 'up_repair_weak_ramparts', () =>
            creep.room.getStructures().filter((structure) =>
                structure.structureType == STRUCTURE_RAMPART &&
                structure.hits < (structure.hitsMax - 5e3)
            ) as StructureRampart[]
        );
        const links = creep.room.link.filter(link => 
            link.store[RESOURCE_ENERGY] > 0 &&
            (!link.pos.isNearTo(centerPos)) &&
            (!sources || !link.pos.inRangeTo(sources[0].pos, 2)) &&
            (!sources || !link.pos.inRangeTo(sources[1].pos, 2)) &&
            weakRamparts.some((rampart) => rampart.pos.inRangeTo(link.pos, 5))
        );
        if (links.length > 0) {
            const bindNumByLinkId = getRoomTickCacheValue(creep.room, 'up_repair_link_bind_num', () => {
                const countMap: Record<string, number> = {};
                const boundCreeps = creep.room.find(FIND_MY_CREEPS, {
                    filter: (myCreep) => !!myCreep.memory.linkId
                }) as Creep[];
                for (const myCreep of boundCreeps) {
                    const boundLinkId = myCreep.memory.linkId;
                    if (!boundLinkId) continue;
                    countMap[boundLinkId] = (countMap[boundLinkId] || 0) + 1;
                }
                return countMap;
            });
            let minBind = Infinity;
            for (let link of links) {
                const bindNum = bindNumByLinkId[link.id] || 0;
                if (bindNum == 0) {
                    linktarget = link;
                    break;
                } else if (bindNum < minBind) {
                    linktarget = link;
                    minBind = bindNum;
                }
            }
        }
        if (linktarget) {
            creep.memory.linkId = linktarget.id;
            const bindNumByLinkId = getRoomTickCacheValue(creep.room, 'up_repair_link_bind_num', () => ({} as Record<string, number>));
            bindNumByLinkId[linktarget.id] = (bindNumByLinkId[linktarget.id] || 0) + 1;
        }
    }

    if (linktarget && linktarget.store[RESOURCE_ENERGY] > 0) {
        creep.goWithdraw(linktarget);
        return true;
    }
    
    const links = creep.pos.findInRange(FIND_MY_STRUCTURES, 3, {
        filter: structure => structure.structureType == STRUCTURE_LINK &&
            structure.store[RESOURCE_ENERGY] > 0
    })
    if (links.length > 0) {
        const link = links[0] as StructureLink;
        if (creep.pos.isNearTo(link)) {
            creep.withdraw(link, RESOURCE_ENERGY);
        } else {
            creep.moveTo(link);
        }
        return true;
    }
    

    return false;
}

const onTarget = (creep: Creep): WorkEvent => {
    if(!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if(creep.store.getUsedCapacity() === 0) {
        creep.say('🔄');
        return WORK_EVENTS.TO_SOURCE;
    }
    RepairWork(creep);
    syncUpRepairMoveWork(creep);
    return WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    if(!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if(creep.ticksToLive < 30 && creep.body.some(part => part.boost)) {
        if(creep.unBoost()) creep.suicide();
        return WORK_EVENTS.STAY;
    }
    if(creep.store.getFreeCapacity() === 0) {
        creep.say('🚧');
        return WORK_EVENTS.TO_TARGET;
    }
    WithdrawLink(creep);
    return WORK_EVENTS.STAY;
};

const UpRepairFunction = {
    prepare: (creep) => {
        return creep.ensureBoosted(creep.memory['boostmap']);
    },
    run: (creep) => {
        runWorkLayer(creep, { onSource, onTarget });
    }
};

export default UpRepairFunction;
