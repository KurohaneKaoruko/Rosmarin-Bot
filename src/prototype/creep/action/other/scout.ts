type ScoutCache = {
    stompSiteId?: Id<ConstructionSite> | null;
};

const getStompSiteWeight = (site: ConstructionSite): number => {
    switch (site.structureType) {
        case STRUCTURE_SPAWN: return 1000;
        case STRUCTURE_TOWER: return 900;
        case STRUCTURE_EXTENSION: return 800;
        case STRUCTURE_STORAGE: return 760;
        case STRUCTURE_TERMINAL: return 740;
        case STRUCTURE_LAB: return 720;
        case STRUCTURE_LINK: return 700;
        case STRUCTURE_FACTORY: return 680;
        case STRUCTURE_POWER_SPAWN: return 660;
        case STRUCTURE_NUKER: return 640;
        case STRUCTURE_OBSERVER: return 620;
        case STRUCTURE_RAMPART: return 420;
        case STRUCTURE_ROAD: return 180;
        default: return 500;
    }
};

const getStompTarget = (creep: Creep): ConstructionSite | null => {
    creep.memory.cacheTarget = creep.memory.cacheTarget || {};
    const cache = creep.memory.cacheTarget as ScoutCache;

    if (cache.stompSiteId) {
        const cached = Game.getObjectById(cache.stompSiteId);
        if (cached && !cached.my && !cached.pos.coverRampart()) return cached;
        cache.stompSiteId = null;
    }

    const sites = creep.room.find(FIND_HOSTILE_CONSTRUCTION_SITES, {
        filter: (site) => !site.pos.coverRampart()
    });
    if (!sites.length) return null;

    let best = sites[0];
    let bestScore = getStompSiteWeight(best) * 100 - creep.pos.getRangeTo(best);
    for (let i = 1; i < sites.length; i++) {
        const site = sites[i];
        const score = getStompSiteWeight(site) * 100 - creep.pos.getRangeTo(site);
        if (score > bestScore) {
            best = site;
            bestScore = score;
        }
    }

    cache.stompSiteId = best.id;
    return best;
};

const runStomp = (creep: Creep): boolean => {
    const shouldStomp = !!(creep.memory.stompSite || creep.memory.stompConstructionSite);
    if (!shouldStomp) return false;

    const target = getStompTarget(creep);
    if (!target) return false;

    if (!creep.pos.isEqualTo(target.pos)) {
        creep.moveTo(target, { range: 0, plainCost: 1, swampCost: 1, maxRooms: 1, reusePath: 3 });
    }
    return true;
};

const Scout = {
    target: function(creep: Creep) {
        if (creep.room.name !== creep.memory.targetRoom) {
            creep.moveToRoom(creep.memory.targetRoom, { plainCost: 1, swampCost: 1 });
            return false;
        }

        if (runStomp(creep)) {
            return false;
        }

        const controller = creep.room.controller;
        if (!controller) return false;
        if (creep.memory['sign'] != undefined && creep.memory['sign'] !== controller.sign?.text) {
            if (creep.pos.isNearTo(controller)) {
                creep.signController(creep.room.controller, creep.memory['sign']);
            } else {
                creep.moveTo(controller);
            }
        } else {
            creep.moveTo(new RoomPosition(25, 25, creep.room.name), { plainCost: 1, swampCost: 1 });
        }
        
        return false;
    },
    source: function() {
        return true;
    }
}

export default Scout;
