import Team from "../core/TeamClass";
import TeamCalc from "../infra/TeamCalc";

/**
 * Team 执行调度器（运行时）。
 *
 * @remarks
 * - 本模块是 Team 系统的执行端：驱动 Team creep 的 boost/归队，并驱动 Team 的状态机。\n
 * - 生成端（创建 TeamData、下发孵化）在 TeamSpawner。\n
 * - 数据源：Memory.TeamData[teamID]（队伍状态与成员列表）。
 */
export default class TeamController {
    /**
     * Team 主入口（每 tick 调用）。
     *
     * @remarks
     * 执行顺序：\n
     * 1) 处理 Team creep：boost、归队、异常清理\n
     * 2) 处理 Team：集结/移动/战斗/解散
     */
    static run(): void {
        this.runCreeps();
        this.runTeams();
    }

    /**
     * 驱动 Team creep 行为（boost 与归队）。
     *
     * @remarks
     * - Team creep 判定：role 以 `team` 开头。\n
     * - boost：若 creep.memory.boostmap 存在，则调用 creep.goBoost({ must: true })，直到完成。\n
     * - 归队：首次完成 boost 后，把 creep.id 推入 Memory.TeamData[teamID].creeps。\n
     * - 若 TeamData 已被删除，则 creep 自杀，避免残留占用资源。
     */
    private static runCreeps(): void {
        // 小队成员的行为
        for (const creep of Object.values(Game.creeps)) {
            if (!creep || creep.spawning) continue;
            const role = creep.memory.role;
            if (role.startsWith('team')) {
                // 关闭 notify（只设置一次）
                if (!creep.memory.notified) {
                    creep.notifyWhenAttacked(false);
                    creep.memory.notified = true;
                }

                // boost
                if (!creep.memory.boosted) {
                    if (creep.memory['boostmap']) {
                        // Team Creep 必须完成 Boost (must: true)，任务配额扣减由 Boost 内部自动处理
                        const result = creep.goBoost(creep.memory['boostmap'], { must: true });
                        if (result === OK) {
                            creep.memory.boosted = true;
                            delete creep.memory['boostmap'];
                        }
                    } else creep.memory.boosted = true;
                    continue;
                }

                // 归队
                if (!creep.memory['rejoin']) {
                    const teamID = creep.memory['teamID'];
                    const team = Memory['TeamData'][teamID];
                    if (!team) continue;
                    team.creeps.push(creep.id);
                    creep.memory['rejoin'] = true;
                }
                const teamID = creep.memory['teamID'];
                if (!Memory['TeamData'][teamID]) creep.suicide();
            } else continue;
        }
    }

    /**
     * 驱动队伍状态机（TeamClass.exec）。
     *
     * @remarks
     * - status=ready：等待成员集齐；超时会解散并移除 Team-xxxx 标记旗。\n
     * - 成员齐全：按伤害排序，切换到 attack。\n
     * - 成员全部死亡：解散。\n
     * - 仅剩治疗者：把 healer 重新分配到未满员的队伍，尽量提高存活率。
     */
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
