import Team from "./TeamClass";
import TeamCreep from "./TeamCreep";
import TeamCalc from "./TeamCalc";

export default class TeamController {
    // 全局缓存，用于在 tick 之间复用 Team 实例
    private static teamCache: Record<string, Team> = {};

    static run(): void {
        this.runCreeps();
        this.runTeams();
    }

    private static runCreeps(): void {
        // 小队成员的行为
        for (const creep of Object.values(Game.creeps)) {
            if (!creep || creep.spawning) continue;
            const role = creep.memory.role;
            if (role.startsWith('team')) {
                TeamCreep.action(creep);
                const teamID = creep.memory['teamID'];
                if (!Memory['TeamData'][teamID]) creep.suicide();
            } else continue;
        }
    }

    private static runTeams(): void {
        // 独立的治疗者
        let soloHealers = [];
        // 未满的队伍
        let noFullTeams = [];

        // 小队管理
        if (!Memory['TeamData']) Memory['TeamData'] = {};
        if (Object.keys(Memory['TeamData']).length === 0) return;

        for (const teamID in Memory['TeamData']) {
            let cpu = Game.cpu.getUsed();

            const teamData = Memory['TeamData'][teamID] as TeamMemory;
            if (teamData.name !== teamID) teamData.name = teamID;

            // 检查小队成员是否齐全
            if (teamData.status === 'ready') {
                // 清理无效 Creep ID
                teamData.creeps = teamData.creeps.filter(id => Game.getObjectById(id));

                // 检查小队是否超时未集结
                // 1. 长期超时 (50000 tick)
                // 2. 空队超时 (5000 tick): 如果 creep 死光了还没组建好，说明失败
                if (Game.time - teamData['time'] > 50000 || 
                   (teamData.creeps.length === 0 && Game.time - teamData['time'] > 5000)) {
                    delete Memory['TeamData'][teamID];
                    console.log(`${teamID}小队因组建超时或失败已解散.`);
                    Game.flags[`Team-${teamID}`]?.remove();
                    continue;
                }
                // 如果成员未齐, 将现有成员移到房间边缘避免堵路
                if (teamData.creeps.length < teamData.num) {
                    const teamFlag = Game.flags[`Team-${teamID}`]
                    if (teamFlag) teamData.creeps.forEach(creepID => {
                        const creep = Game.getObjectById(creepID) as Creep;
                        if (!creep) return;
                        if (creep.room.name == teamData.homeRoom &&
                            !creep.pos.isNearEdge(4) &&
                            !creep.pos.inRangeTo(teamFlag, 3)
                        ) {
                            creep.moveTo(teamFlag, { range: 3 });
                        }
                    });
                    continue;
                }
                // 成员集齐则排序, 结束准备状态
                let creeps = teamData.creeps.map(Game.getObjectById).filter(Boolean) as Creep[];
                creeps.sort((a, b) => TeamCalc.calcCreepDamage(b) - TeamCalc.calcCreepDamage(a));
                teamData.creeps = creeps.map(creep => creep.id);
                teamData.status = 'attack';
                continue;
            }

            let team = new Team(teamData);

            // 检查小队是否全部死亡
            if (!team.creeps || team.creeps.length === 0) {
                delete Memory['TeamData'][teamID];
                delete TeamController.teamCache[teamID];
                console.log(`${teamID}小队因成员全部死亡已解散.`);
                Game.flags[`Team-${teamID}`]?.remove();
                continue;
            }

            // 小队行动
            team.exec();

            // 将剩余的heal分配到其他不满员的队伍中
            if (team.creeps.every(creep => creep.memory.role === 'team-heal')) {
                // 如果一个队伍只剩heal, 标记为独立治疗者
                soloHealers.push(...team.creeps);
            } else if (team.creeps.length < teamData.num) {
                // 记录未满的队伍
                noFullTeams.push([teamID, teamData]);
            }

            if (Game.flags['Team-showCPU'])
                console.log(`${teamID}小队行动消耗: ${Game.cpu.getUsed() - cpu}`);
        }

        // 分配独立治疗者到未满的队伍中
        for (const [teamID, teamData] of noFullTeams) {
            if (soloHealers.length === 0) break;
            let healer = soloHealers.pop();
            // 把creep从原来的队伍中去除
            let creepTeamData = Memory['TeamData'][healer.memory['teamID']]
            let index = creepTeamData.creeps.indexOf(healer.id);
            creepTeamData.creeps.splice(index, 1);
            // 把creep加入新的队伍
            teamData.creeps.push(healer.id);
            healer.memory['teamID'] = teamID;
        }
    }
}
