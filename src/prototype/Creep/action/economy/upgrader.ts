import { writeMoveWorkTileCandidates } from '@/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { runWorkLayer } from '@/framework/ai/adapters';

const onTarget = (creep: Creep): WorkEvent => {
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
    syncUpgraderMoveWork(creep);
    return WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    if (!creep.moveHomeRoom()) return WORK_EVENTS.STAY;
    if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
    if (creep.store.getFreeCapacity() === 0) {
        creep.say('⚡');
        creep.runControllerUpgrade();
        return WORK_EVENTS.TO_TARGET;
    }

    const fullAfterTake = creep.acquireEnergy({ pickup: false });
    if (fullAfterTake) {
        if (creep.memory.targetSourceId) delete creep.memory.targetSourceId;
        creep.say('⚡');
        creep.runControllerUpgrade();
        return WORK_EVENTS.TO_TARGET;
    }
    return WORK_EVENTS.STAY;
};

export const syncUpgraderMoveWork = (creep: Creep) => {
    if (
        creep.room.controller?.my &&
        creep.memory.working &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
        writeMoveWorkTileCandidates(creep, [{ pos: creep.room.controller.pos, range: 3 }]);
        return;
    }
    writeMoveWorkTileCandidates(creep, []);
};

const Upgrader = {
    prepare: (creep) => {
        if (creep.memory.boosted) return true;
        if (creep.room.level == 8) {
            creep.memory.boosted = true;
            return true;
        }
        const boostmap = creep.memory['boostmap'] || { [WORK]: ['XGH2O', 'GH2O', 'GH'] };
        if (!boostmap || Object.keys(boostmap).length === 0) {
            creep.memory.boosted = true;
            return true;
        }
        const result = creep.goBoost(boostmap);
        const ok = result === OK;
        if (ok) creep.memory.boosted = true;
        return ok;
    },
    run: (creep) => {
        runWorkLayer(creep, { onSource, onTarget });
    }
};

export default Upgrader;
