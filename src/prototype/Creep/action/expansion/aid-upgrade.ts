import { writeMoveWorkTileCandidates } from '@/shared/moveWork';
import { WORK_EVENTS, WorkEvent } from '@/framework/ai/workMachine';
import { runWorkLayer } from '@/framework/ai/adapters';

const onTarget = (creep: Creep): WorkEvent => {
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

    creep.runControllerUpgrade();
    if (creep.store.getUsedCapacity() === 0) {
        creep.say('🔄');
        return WORK_EVENTS.TO_SOURCE;
    }
    syncAidUpgradeMoveWork(creep);
    return WORK_EVENTS.STAY;
};

const onSource = (creep: Creep): WorkEvent => {
    if (!creep.moveToTargetRoom()) return WORK_EVENTS.STAY;

    creep.withdrawControllerEnergy({
        linkRange: 2,
        containerRange: 2,
        fallbackToTakeEnergy: true,
    });

    if (creep.store.getFreeCapacity() === 0) {
        creep.say('⚡');
        return WORK_EVENTS.TO_TARGET;
    }
    return WORK_EVENTS.STAY;
};

export const syncAidUpgradeMoveWork = (creep: Creep) => {
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

const aid_upgrade = {
    prepare: (creep) => {
        if (creep.memory.boosted) return true;
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
        runWorkLayer(creep, { onSource, onTarget }, { reenter: true });
    }
};

export default aid_upgrade;
