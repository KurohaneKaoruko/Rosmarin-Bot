const autoDefend = function (creep: Creep) {
    const hostileCreeps = creep.findHostileCreeps();
    if (hostileCreeps.length === 0) return;
    
    const mem = creep.room.memory['defenseRamparts'];
    const minHits = (mem && mem.minHits) ? mem.minHits : (creep.room.memory['breached'] ? 1e5 : 1e6);
    let targetRampart: StructureRampart | null = null;
    if (mem && mem.tick && mem.tick + 15 >= Game.time && Array.isArray(mem.ranged) && mem.ranged.length > 0) {
        for (const id of mem.ranged) {
            const r = Game.getObjectById(id as Id<StructureRampart>);
            if (!r || !r.my || r.hits < minHits) continue;
            const lookStructure = creep.room.lookForAt(LOOK_STRUCTURES, r.pos);
            if (lookStructure.length && lookStructure.some(structure =>
                structure.structureType !== STRUCTURE_RAMPART &&
                structure.structureType !== STRUCTURE_ROAD &&
                structure.structureType !== STRUCTURE_CONTAINER)) {
                continue;
            }
            targetRampart = r;
            break;
        }
    }

    if (!targetRampart) {
        const ramparts = creep.room.rampart.filter((rampart) => {
            const lookStructure = creep.room.lookForAt(LOOK_STRUCTURES, rampart.pos);
            if (lookStructure.length && lookStructure.some(structure =>
                structure.structureType !== STRUCTURE_RAMPART &&
                structure.structureType !== STRUCTURE_ROAD &&
                structure.structureType !== STRUCTURE_CONTAINER)) {
                return false;
            }
            return rampart.hits >= minHits;
        });

        let best: StructureRampart | null = null;
        let bestScore = -Infinity;
        for (const r of ramparts) {
            let minDist = Infinity;
            for (const e of hostileCreeps) {
                const d = r.pos.getRangeTo(e.pos);
                if (d < minDist) minDist = d;
            }
            const score = -Math.abs(minDist - 3) - minDist * 0.05;
            if (score > bestScore) {
                bestScore = score;
                best = r;
            }
        }
        targetRampart = best;
    }

    if (targetRampart && !creep.pos.isEqualTo(targetRampart.pos)) {
        creep.moveTo(targetRampart.pos, {
            visualizePathStyle: { stroke: '#ff0000' },
            costCallback: (roomName: string, costMatrix: CostMatrix) => {
                if (roomName !== creep.room.name) return costMatrix;
                const base = creep.room.getDefenseCostMatrix();
                const matrix = base.clone();
                for (const other of creep.room.find(FIND_CREEPS)) {
                    if (other.name === creep.name) continue;
                    matrix.set(other.pos.x, other.pos.y, 255);
                }
                return matrix;
            }
        });
        return;
    }

    const target = creep.pos.findClosestByRange(hostileCreeps);
    if(target) {
        const range = creep.pos.getRangeTo(target);
        if (range <= 1) {
            const nearHostiles = hostileCreeps.filter(h => creep.pos.isNearTo(h)).length;
            if (nearHostiles >= 2) {
                creep.rangedMassAttack();
                creep.room.CallTowerAttack(target);
            } else {
                const result = creep.rangedAttack(target);
                if (result == OK) creep.room.CallTowerAttack(target);
            }
            return;
        }
        if (range <= 3) {
            const result = creep.rangedAttack(target);
            if (result == OK) creep.room.CallTowerAttack(target);
            return;
        }
    }
}



const defend_ranged = {
    run: function (creep: Creep) {
        if (!creep.memory.boosted) {
            const must = !!creep.memory['mustBoost'];
            const boostmap = must ? {
                [RANGED_ATTACK]: ['XKHO2'],
                [MOVE]: ['XZHO2'],
            } : {
                [RANGED_ATTACK]: ['XKHO2', 'KHO2', 'KO'],
                [MOVE]: ['XZHO2', 'ZHO2', 'ZO'],
            };
            creep.memory.boosted = creep.goBoost(boostmap as any, { must }) === OK;
            return
        }
        autoDefend(creep);
    }
}

export default defend_ranged
