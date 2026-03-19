import { runWorkLayer } from '@/framework/ai/adapters';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';

const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.memory.ready) return WORK_EVENTS.STAY;
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
    if (creep.store.getUsedCapacity() === 0) {
        creep.say('🔄');
        return WORK_EVENTS.TO_SOURCE;
    }

    creep.runControllerUpgrade();
    if (creep.store.getUsedCapacity() === 0) {
        creep.say('🔄');
        return WORK_EVENTS.TO_SOURCE;
    }
    return WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    if (!creep.memory.ready) return WORK_EVENTS.STAY;
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
    if (creep.store.getFreeCapacity() === 0) {
        creep.say('⚡');
        creep.runControllerUpgrade();
        return WORK_EVENTS.TO_TARGET;
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
        return WORK_EVENTS.TO_TARGET;
    }
    return WORK_EVENTS.STAY;
};

const Upgrader = {
    prepare: function (creep: Creep) {
        if (creep.room.level == 8) return true;
        return creep.goBoost({ [WORK]: ['XGH2O', 'GH2O', 'GH'] }) === OK;
    },

    run: function (creep: Creep) {
        runWorkLayer(creep, {
            onSource: ({ creep }) => onSource(creep),
            onTarget: ({ creep }) => onTarget(creep),
        });
    },
};

export default Upgrader;
