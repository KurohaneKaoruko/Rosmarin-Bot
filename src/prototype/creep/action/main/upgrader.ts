import { BASE_CONFIG } from '@/constant/config';
import { getRoomData } from '@/modules/utils/memory';

const upgrade = function (creep: Creep) {
    const link = creep.room.link.find(l => l.pos.inRangeTo(creep.room.controller, 2))
    if (link && !creep.pos.inRangeTo(link, 1)) {
        creep.moveTo(link, { 
            visualizePathStyle: { stroke: '#ffffff' },
            range: 1,
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
        creep.goUpgrade();
        const botMem = getRoomData(creep.room.name);
        const customSign = botMem?.sign;
        const controller = creep.room.controller;
        if (controller) {
            const oldSign = controller.sign?.text;
            const shouldOverwrite = !!customSign;
            const desired = shouldOverwrite ? customSign : (!controller.sign ? BASE_CONFIG.DEFAULT_SIGN : undefined);
            if (desired && (shouldOverwrite ? oldSign !== desired : !controller.sign)) {
                if (creep.pos.inRangeTo(controller, 1)) {
                    creep.signController(controller, desired);
                } else {
                    creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } })
                }
            }
        }
        return;
    }
}

const takeEnergy = function (creep: Creep) {
    const links = creep.room.link.filter(l => l.pos.inRangeTo(creep.room.controller, 2)) || [];
    const link = links.find(l => l.store[RESOURCE_ENERGY] > 0);
    const containers = creep.room.container.filter(c => c.pos.inRangeTo(creep.room.controller, 1)) || [];
    const container = containers.find(c => c.store[RESOURCE_ENERGY] > 0);

    if (link) {
        creep.goWithdraw(link, RESOURCE_ENERGY);
    }
    else if (container) {
        creep.goWithdraw(container, RESOURCE_ENERGY);
    }
    else if (links.length == 0 || creep.room.level < 6) {
        creep.TakeEnergy()
    }
}

const Upgrader = {
    prepare: function (creep: Creep) {
        if(creep.room.level == 8) return true;
        return creep.goBoost({ [WORK]: ['XGH2O', 'GH2O', 'GH'] }) === OK;
    },

    target: function (creep: Creep) {   // 升级控制器
        if(!creep.memory.ready) return false;
        if(!creep.moveHomeRoom()) return;
        if (creep.store.getUsedCapacity() === 0) {
            creep.say('🔄');
            takeEnergy(creep);
            if (creep.store.getUsedCapacity() === 0) return true;
            upgrade(creep);
            return creep.store.getUsedCapacity() === 0;
        }
        upgrade(creep);
        if (creep.store.getUsedCapacity() === 0) {
            creep.say('🔄');
            takeEnergy(creep);
            return creep.store.getUsedCapacity() === 0;
        }
        return false;
    },
    
    source: function (creep: Creep) {   // 获取能量
        if(!creep.memory.ready) return false;
        if(!creep.moveHomeRoom()) return;
        if (creep.store.getFreeCapacity() === 0) {
            creep.say('⚡');
            upgrade(creep);
            return true;
        }
        takeEnergy(creep);
        if (creep.store.getFreeCapacity() === 0) {
            creep.say('⚡');
            upgrade(creep);
            return true;
        }
        return false;
    },
}

export default Upgrader;
