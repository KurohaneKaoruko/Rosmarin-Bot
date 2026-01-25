const autoDefend = function (creep: Creep) {
    const hostileCreeps = creep.findHostileCreeps();
    if (hostileCreeps.length === 0) return;
    
    const mem = creep.room.memory['defenseRamparts'];
    let targetRampart: StructureRampart | null = null;
    if (mem && mem.tick && mem.tick + 15 >= Game.time && Array.isArray(mem.ranged) && mem.ranged.length > 0) {
        for (const id of mem.ranged) {
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
            const score = -Math.abs(minDist - 3) - minDist * 0.05;
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

    const target = creep.pos.findClosestByRange(hostileCreeps);
    if(target) {
        // creep.attack(target)
            // 检查 creep 是否携带 ATTACK 部件
        const hasAttackPart = creep.body.some(part => part.type === ATTACK);
        // 检查 creep 是否携带 RANGED_ATTACK 部件
        const hasRangedAttackPart = creep.body.some(part => part.type === RANGED_ATTACK);
    
        // 根据携带的部件类型进行攻击
        if (hasAttackPart && !hasRangedAttackPart || // 如果有 ATTACK 且没有 RANGED_ATTACK
            (hasAttackPart && hasRangedAttackPart && creep.pos.getRangeTo(target) <= 3)) { // 或者两者都有但距离足够近以进行近战
            const result = creep.attack(target);
            if(result == OK) creep.room.CallTowerAttack(target);
        } else if (hasRangedAttackPart) { // 如果有 RANGED_ATTACK
            if (creep.pos.isNearTo(target)) {
                creep.rangedMassAttack();
                creep.room.CallTowerAttack(target);
            } else if (creep.pos.inRangeTo(target, 3)) {
                creep.rangedAttack(target);
                creep.room.CallTowerAttack(target);
            }
        }
    }
}

const flagDefend = function (creep: Creep, flag: Flag) {
    if(!creep.pos.isEqual(flag.pos)) {
        creep.moveTo(flag.pos, { visualizePathStyle: { stroke: '#ff0000' } });
    }
    const target = creep.pos.findClosestByRange(creep.findHostileCreeps());
    if(target) {
        // creep.attack(target)
            // 检查 creep 是否携带 ATTACK 部件
        const hasAttackPart = creep.body.some(part => part.type === ATTACK);
        // 检查 creep 是否携带 RANGED_ATTACK 部件
        const hasRangedAttackPart = creep.body.some(part => part.type === RANGED_ATTACK);
        // 根据携带的部件类型进行攻击
        if (hasAttackPart && !hasRangedAttackPart || // 如果有 ATTACK 且没有 RANGED_ATTACK
            (hasAttackPart && hasRangedAttackPart && creep.pos.getRangeTo(target) <= 3)) { // 或者两者都有但距离足够近以进行近战
            const result = creep.attack(target);
            if(result == OK) creep.room.CallTowerAttack(target);
        } else if (hasRangedAttackPart) { // 如果有 RANGED_ATTACK
            const result = creep.rangedAttack(target);
            if(result == OK) creep.room.CallTowerAttack(target);
        }
    }
    
    if(flag && (creep.ticksToLive < 10 || creep.hits < 200)){
        flag.remove();
    }
}



const defend_ranged = {
    run: function (creep: Creep) {
        if (!creep.memory.boosted) {
            const boosts = creep.memory['mustBoost'] ? ['XKHO2', 'XZHO2'] :
                            ['XKHO2', 'KHO2', 'KO', 'XZHO2', 'ZHO2', 'ZO'];
            creep.memory.boosted = creep.goBoost(boosts, creep.memory['mustBoost']);
            return
        }
        const name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
        const flag = Game.flags[name+'-defend'];
        if (!flag) autoDefend(creep);
        else flagDefend(creep, flag);
    }
}

export default defend_ranged
