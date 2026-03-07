const aid_upgrade = {
    prepare: function (creep: Creep) {
        if (creep.memory['boostmap']) {
            return creep.goBoost(creep.memory['boostmap']) === OK;
        }
        return creep.goBoost({ [WORK]: ['XGH2O', 'GH2O', 'GH'] }) === OK;
    },

    target: function (creep: Creep) {
        if (!creep.memory.ready) return false;
        if (!creep.moveHomeRoom()) return;

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

        creep.withdrawControllerEnergy({
            linkRange: 2,
            containerRange: 2,
            fallbackToTakeEnergy: true,
        });

        if (creep.store.getFreeCapacity() === 0) {
            creep.say('⚡');
            return true;
        }
        return false;
    },
}

export default aid_upgrade
