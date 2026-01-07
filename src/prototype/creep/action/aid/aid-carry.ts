function withdraw(creep: Creep) {
    if(!creep.memory['resource']) creep.memory['resource'] = RESOURCE_ENERGY;

    // 使用新的原型方法收集掉落资源（范围5格，无最小数量限制）
    if (creep.collectDroppedResource(creep.memory['resource'], 0, 5)) {
        return;
    }

    // 使用新的原型方法从墓碑收集资源
    if (creep.collectFromTombstone(creep.memory['resource'])) {
        return;
    }

    // 使用新的原型方法移动到资源房间
    if (!creep.moveToSourceRoom()) {
        return;
    }

    const res = creep.memory['resource'];

    const target = [creep.room.storage, creep.room.terminal].filter((i) => {
        return i && i.store[res] > 0 && (creep.room.my || 
            i.pos.lookFor(LOOK_STRUCTURES).every((i) => i.structureType !== STRUCTURE_RAMPART));
    })[0];

    if (target) creep.goWithdraw(target, res);

    return;
}

function transfer(creep: Creep) {
    // 使用新的原型方法移动到目标房间
    if (!creep.moveToTargetRoom()) {
        return;
    }

    const res = creep.memory['resource'] || RESOURCE_ENERGY;

    
    let targets = [creep.room.storage, creep.room.terminal].filter((i) => i && i.store.getFreeCapacity(res) > 0) as any;
    let target = creep.pos.findClosestByRange(targets) as any;
    if (!target) {
        targets = [...creep.room.container].filter((i) => i && i.store.getFreeCapacity(res) > 0);
        target = creep.pos.findClosestByRange(targets);
    }

    if (target) {
        creep.goTransfer(target, Object.keys(creep.store)[0] as ResourceConstant);
    } else {
        creep.drop(res);
    }
    
}



const AidCarryFunction = {
    prepare: function (creep: Creep) {
        if (creep.memory['boostmap']) {
            let result = creep.Boost(creep.memory['boostmap']);
            if (result === OK) return true;
            else return false;
        } else {
            let result = creep.goBoost(['XKH2O', 'KH2O', 'KH']);
            return result;
        }
        
    },

    source: function (creep: Creep) {
        if(!creep.memory.ready) return false;
        if (creep.store.getFreeCapacity() === 0) {
            transfer(creep);
            return true;
        } else withdraw(creep);
        return false;
    },
    target: function (creep: Creep) {
        if(!creep.memory.ready) return false;
        if (creep.store.getUsedCapacity() === 0) {
            withdraw(creep);
            return true;
        } else transfer(creep);
        return false;
    }
};

export default AidCarryFunction;