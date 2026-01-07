const upgrade = function (creep: Creep) {
    const link = creep.room.link.find(l => l.pos.inRangeTo(creep.room.controller, 2))
    if (link && !creep.pos.inRangeTo(link, 1)) {
        creep.moveTo(link, { 
            visualizePathStyle: { stroke: '#ffffff' },
            range: 3,
            maxRooms: 1,
         });
    }
    if (!link && !creep.pos.inRangeTo(creep.room.controller, 2)) {
        creep.moveTo(creep.room.controller.pos, {
            visualizePathStyle: { stroke: '#ffffff' },
            range: 2,
            maxRooms: 1,
        });
    }
    if (creep.pos.inRangeTo(creep.room.controller, 3)) {
        creep.upgradeController(creep.room.controller)
        const botMem = Memory['RoomControlData'][creep.room.name];
        const sign = botMem?.sign ?? global.BaseConfig.DEFAULT_SIGN;
        if(creep.room.controller && (creep.room.controller.sign?.text ?? '') != sign) {
            if (creep.pos.inRangeTo(creep.room.controller, 1)) {
                creep.signController(creep.room.controller, sign);
            } else {
                creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } })
            }
        }
        return;
    }
}

const aid_upgrade = {
    prepare: function (creep: Creep) {
        if (creep.memory['boostmap']) {
            let result = creep.Boost(creep.memory['boostmap']);
            if (result === OK) return true;
            else return false;
        }
        return creep.goBoost(['XGH2O', 'GH2O', 'GH']);
    },

    target: function (creep: Creep) {   // 升级控制器
        if(!creep.memory.ready) return false;
        if(!creep.moveHomeRoom()) return;
        upgrade(creep);
        if (creep.store.getUsedCapacity() === 0) {
            creep.say('🔄');
            return true;
        } else { return false; }
    },
    
    source: function (creep: Creep) {   // 获取能量
        if(!creep.memory.ready) return false;
        if(!creep.moveHomeRoom()) return;

        const link = creep.room.link.find(l => l.pos.inRangeTo(creep.room.controller, 2)) || null;
        const container = creep.room.container.find(l => l.pos.inRangeTo(creep.room.controller, 2)) ?? null;

        if (link && link.store[RESOURCE_ENERGY] > 0) {
            creep.goWithdraw(link, RESOURCE_ENERGY);
        }
        else if(container && container.store[RESOURCE_ENERGY] > 0) {
            creep.goWithdraw(container, RESOURCE_ENERGY);
        }
        else if(!link || creep.room.level < 6) { creep.TakeEnergy() }

        if (creep.store.getFreeCapacity() === 0) {
            creep.say('⚡');
            return true;
        } else { return false; }
    },
}

export default aid_upgrade