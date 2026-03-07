const Upgrader = {
    prepare: function (creep: Creep) {
        if (creep.room.level == 8) return true;
        return creep.goBoost({ [WORK]: ['XGH2O', 'GH2O', 'GH'] }) === OK;
    },

    target: function (creep: Creep) {
        if (!creep.memory.ready) return false;
        if (!creep.moveHomeRoom()) return;
        if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
        if (creep.store.getUsedCapacity() === 0) {
            creep.say('🔄');
            return true;
        }

        creep.runControllerUpgrade();
        if (creep.store.getUsedCapacity() === 0) {
            creep.say('🔄');
            return true;
        }
        return false;
    },
    
    source: function (creep: Creep) {
        if (!creep.memory.ready) return false;
        if (!creep.moveHomeRoom()) return;
        if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
        if (creep.store.getFreeCapacity() === 0) {
            creep.say('⚡');
            creep.runControllerUpgrade();
            return true;
        }

        const fullAfterTake = creep.withdrawControllerEnergy({
            linkRange: 2,
            containerRange: 3,
            fallbackToTakeEnergy: true,
        });
        if (fullAfterTake) {
            if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
            creep.say('⚡');
            creep.runControllerUpgrade();
            return true;
        }
        return false;
    },
}

export default Upgrader;
