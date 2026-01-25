const autoDefend = function (creep: Creep) {
    // 使用 findHostileCreeps 方法查找敌对 creep
    const hostileCreeps = creep.findHostileCreeps();
    // 如果没有敌对 creep，也可以考虑是否继续执行或返回
    if (hostileCreeps.length === 0) {
        return;
    }

    const mem = creep.room.memory['defenseRamparts'];
    let targetRampart: StructureRampart | null = null;
    if (mem && mem.tick && mem.tick + 15 >= Game.time && Array.isArray(mem.melee) && mem.melee.length > 0) {
        for (const id of mem.melee) {
            const r = Game.getObjectById(id as Id<StructureRampart>);
            if (!r || !r.my || r.hits < 1e6) continue;
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
            return rampart.hits >= 1e6;
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
        creep.moveTo(targetRampart.pos, { visualizePathStyle: { stroke: '#ff0000' } });
    }

    // 使用 autoAttack 方法自动攻击最近的敌人
    const target = creep.pos.findClosestByRange(hostileCreeps);
    if(target) {
        const result = creep.autoAttack(target);
        if(result == OK) creep.room.CallTowerAttack(target);
    }
}

const flagDefend = function (creep: Creep, flag: Flag) {
    if(!creep.pos.isEqual(flag.pos)) {
        creep.moveTo(flag.pos, { visualizePathStyle: { stroke: '#ff0000' } });
    }

    // 使用 findHostileCreeps 方法查找敌对 creep
    const hostileCreeps = creep.findHostileCreeps();
    const target = creep.pos.findClosestByRange(hostileCreeps);
    
    if(target) {
        // 使用 autoAttack 方法自动攻击
        const result = creep.autoAttack(target);
        if(result == OK) creep.room.CallTowerAttack(target);
    }
    
    if(flag && (creep.ticksToLive < 10 || creep.hits < 200)){
        flag.remove();
    }
}


const defend_attack = {
    run: function (creep: Creep) {
        if (!creep.memory.boosted) {
            const boosts = creep.memory['mustBoost'] ? ['XUH2O', 'XZHO2'] : 
                        ['XUH2O', 'UH2O', 'UH', 'XZHO2', 'ZHO2', 'ZO'];
            creep.memory.boosted = creep.goBoost(boosts, creep.memory['mustBoost']);
            return
        }
        const name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
        const flag = Game.flags[name+'-defend'];
        if (!flag) autoDefend(creep);
        else flagDefend(creep, flag);
    }
}

export default defend_attack
