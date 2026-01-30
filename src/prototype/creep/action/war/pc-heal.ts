const pc_heal = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }

        creep.memory.dontPullMe = !creep.room.my;
        
        if (!creep.memory.boosted) {
            const boostmap = creep.memory['boostmap'];
            if (boostmap) {
                const must = !!creep.memory['mustBoost'];
                const result = creep.goBoost(boostmap, { must });
                if (result === OK) {
                    creep.memory.boosted = true;
                }
                return;
            }
            creep.memory.boosted = true;
        }

        const targetPcName = creep.memory['targetPcName'] as string | undefined;
        if (!targetPcName) {
            if (creep.room.my) creep.suicide();
            return;
        }

        if (creep.ticksToLive && creep.ticksToLive <= 100 && creep.room.my) {
            creep.unBoost();
            return;
        }

        const pc = Game.powerCreeps[targetPcName];
        if (!pc || !pc.ticksToLive) {
            if (creep.room.my) creep.suicide();
            return;
        }

        const lockedHealerName = (pc.memory as any).healerName as string | undefined;
        if (lockedHealerName && lockedHealerName !== creep.name) {
            const locked = Game.creeps[lockedHealerName];
            if (locked && locked.memory.role === 'pc-heal') {
                if (creep.room.my) creep.suicide();
                return;
            }
        }
        ;(pc.memory as any).healerName = creep.name;

        let healed = false;
        if ((creep.hits < creep.hitsMax) && creep.hits < (pc.hits || 0)) {
            creep.heal(creep);
            healed = true;
        }

        if (creep.room.name !== pc.room.name) {
            if (!healed) {
                creep.heal(pc as any);
            }
            creep.moveTo(pc as any, { range: 1, ignoreCreeps: true, reusePath: 5, maxRooms: 16, plainCost: 1, swampCost: 5 });
            return;
        }

        if (!healed && creep.pos.isNearTo(pc)) {
            creep.heal(pc as any);
            return;
        }

        if (!healed && creep.pos.inRangeTo(pc, 3)) {
            creep.rangedHeal(pc as any);
        }

        if (creep.fatigue > 0) return;
        creep.moveTo(pc as any, { range: 1, maxRooms: 1, ignoreCreeps: true, reusePath: 5, plainCost: 1, swampCost: 5 });
    }
};

export default pc_heal;
