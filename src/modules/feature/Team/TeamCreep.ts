export default class TeamCreep {
    public static action(creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        
        // boost
        if (!creep.memory.boosted) {
            if (creep.memory['boostmap']) {
                // Team Creep 必须完成 Boost (must: true)，任务配额扣减由 Boost 内部自动处理
                let result = creep.Boost(creep.memory['boostmap'], { must: true });
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
