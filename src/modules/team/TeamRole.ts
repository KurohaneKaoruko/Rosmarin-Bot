const team_role = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        
        // boost
        if (!creep.memory.boosted) {
            if (creep.memory['boostmap']) {
                let result = creep.Boost(creep.memory['boostmap']);
                if (result === OK) {
                    creep.memory.boosted = true;
                    delete creep.memory['boostmap'];
                }
            } else creep.memory.boosted = true;
            return;
        }

        
        // 归队
        if (!creep.memory['rejoin']) {
            const teamID = creep.memory['teamID'];
            const team = Memory['TeamData'][teamID];
            if(!team) return;
            team.creeps.push(creep.id);
            creep.memory['rejoin'] = true;
        }
        
    }
}

export default team_role;