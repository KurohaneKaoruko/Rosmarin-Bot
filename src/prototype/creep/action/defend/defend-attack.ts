const autoDefend = function (creep: Creep) {
    // 使用 findHostileCreeps 方法查找敌对 creep
    const hostileCreeps = creep.findHostileCreeps();
    // 如果没有敌对 creep，也可以考虑是否继续执行或返回
    if (hostileCreeps.length === 0) {
        return;
    }

    const mem = creep.room.memory['defenseRamparts'];
    const minHits = (mem && mem.minHits) ? mem.minHits : (creep.room.memory['breached'] ? 1e5 : 1e6);
    let targetRampart: StructureRampart | null = null;
    if (mem && mem.tick && mem.tick + 15 >= Game.time && Array.isArray(mem.melee) && mem.melee.length > 0) {
        for (const id of mem.melee) {
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
            const score = -minDist;
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
        if (creep.pos.isNearTo(target)) {
            const result = creep.attack(target);
            if(result == OK) creep.room.CallTowerAttack(target);
        } else {
            creep.room.CallTowerAttack(target);
        }
    }
}


const defend_attack = {
    run: function (creep: Creep) {
        if (!creep.memory.boosted) {
            const must = !!creep.memory['mustBoost'];
            const boostmap = must ? {
                [ATTACK]: ['XUH2O'],
                [MOVE]: ['XZHO2'],
            } : {
                [ATTACK]: ['XUH2O', 'UH2O', 'UH'],
                [MOVE]: ['XZHO2', 'ZHO2', 'ZO'],
            };
            creep.memory.boosted = creep.goBoost(boostmap as any, { must }) === OK;
            return
        }
        autoDefend(creep);
    }
}

export default defend_attack
