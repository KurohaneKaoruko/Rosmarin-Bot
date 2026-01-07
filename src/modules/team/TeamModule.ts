import {compressBodyConfig} from "@/utils";
import {TEAM_CONFIG} from "@/constant/TeamConfig";
import Team from "./TeamClass/Team";
import TeamRole from "./TeamRole";
import TeamCalc from "./TeamClass/TeamCalc";

const TeamModule = {
    start: function () {
        // 孵化四人小队
        if (Game.time % 10) return;
        for (const flagName in Game.flags) {
            if (flagName.startsWith('Team-')) {
                let teamID = flagName.match(/Team-(\w+)/)?.[1];
                if (!Memory['TeamData'][teamID]) {
                    Game.flags[flagName].remove();
                } continue;
            }

            // TEAM 四人小队
            // TEAM_配置_孵化房间_N最大孵化数量_T孵化间隔
            if (!flagName.startsWith('TEAM_')) continue;
            let flag = Game.flags[flagName];

            // 孵化间隔
            let spawnInterval = flagName.match(/T(\d+)/)?.[1] as any;
            if (!spawnInterval) spawnInterval = 1000;
            else spawnInterval = parseInt(spawnInterval);
            const flagMemory = flag.memory;
            if ((Game.time - (flagMemory['lastTime']||0) < spawnInterval)) continue;

            // 孵化房间
            const spawnRoom = flagName.match(/([EW][1-9]+[NS][1-9]+)/)?.[1].toUpperCase();
            const room = Game.rooms[spawnRoom];
            if (!room || !room.my) {
                flag.remove();
                continue;
            }

            // 如果有视野, 检查目标房间
            const targetRoom = flag.room;
            if (targetRoom) {
                if (targetRoom.controller?.level < 1) {
                    flagMemory['spawnCount'] = 2e32;
                } else if (targetRoom.controller?.safeMode) {
                    flagMemory['lastTime'] = Game.time + targetRoom.controller.safeMode;
                    continue;
                }
            }
            
            // 配置
            const config = flagName.match(/TEAM_([0-9A-Za-z/]+)/)?.[1];
            if (!config) {
                console.log(`未设置小队配置.`);
                flag.remove();
                continue;
            }
            let Team_Config = TEAM_CONFIG[config];
            if (!Team_Config) {
                console.log(`小队配置 ${config} 不存在.`);
                flag.remove();
                continue;
            }

            const RES_MAP = {};
            for (const c of Team_Config) {
                if (!c || !c.boostmap) continue;
                for (const part of c.bodypart) {
                    let partType = part[0];
                    let partNum = part[1];
                    let boostType = c.boostmap[partType];
                    if (!boostType) continue;
                    if (RES_MAP[boostType]) RES_MAP[boostType] += partNum * 30;
                    else RES_MAP[boostType] = partNum * 30;
                }
            }

            if (RES_MAP && Object.keys(RES_MAP).length) {
                if (!Object.keys(RES_MAP).every(res => {
                    if (room[res] > RES_MAP[res]) return true;
                    console.log(`BOOST资源${res}不足.`);
                    return false;
                })) {
                    flag.remove();
                    continue;
                }
                // 给lab分配boost任务
                for (const m in RES_MAP) {
                    room.AssignBoostTask(m as ResourceConstant, RES_MAP[m]);
                }
                
            }

            // 生成小队ID
            let genTeamID = () => {
                let id = (Game.time*36*36 + Math.floor(Math.random()*36*36))
                        .toString(36).slice(-4).toUpperCase();
                if (Memory['TeamData'][id]) return genTeamID();
                return id;
            }
            
            const teamID = genTeamID();
            // 创建小队
            Memory['TeamData'][teamID] = {
                'name': teamID,
                'status': 'ready',
                'toward': '↑',
                'formation': 'line',
                'creeps': [],
                'num': Team_Config.length,
                'time': Game.time,
                'homeRoom': room.name,
                'targetRoom': flag.pos.roomName,
            };
            try {
                flag.pos.createFlag(`Team-${teamID}`, flag.color, flag.secondaryColor);
            } catch (e) {
                room.createFlag(0, 0, `Team-${teamID}`, flag.color, flag.secondaryColor);
                const {x, y, roomName} = flag.pos;
                Memory.flags[`Team-${teamID}`] = {'setPosition': `${x}/${y}/${roomName}`}
            }

            // 孵化小队成员
            for (const c of Team_Config) {
                room.SpawnMissionAdd('',
                    compressBodyConfig(c.bodypart), -1, c.role, {
                    teamID, boostmap: {...c.boostmap}
                } as any);
            }

            // 孵化计数
            flagMemory['lastTime'] = Game.time;
            flagMemory['spawnCount'] = (flagMemory['spawnCount']||0) + 1;
            console.log(flagName, `已添加一支小队的孵化任务, 配置:${config}, 编号:${teamID}`);
            // 孵化数量
            let spawnCount = flagName.match(/_N(\d+)/)?.[1] as any;
            if (!spawnCount) {
                flag.remove();
                delete Memory.flags[flagName];
                continue;
            }

            if (flagMemory['spawnCount'] >= parseInt(spawnCount)) {
                flag.remove();
                console.log(flagName, '孵化数量已满');
                delete Memory.flags[flagName];
            }
        }
    },

    tick: function () {
        // 小队成员的行为
        for (const creep of Object.values(Game.creeps)) {
            if (!creep || creep.spawning) continue;
            const role = creep.memory.role;
            if (role.startsWith('team')) {
                TeamRole.run(creep);
                const teamID = creep.memory['teamID'];
                if (!Memory['TeamData'][teamID]) creep.suicide();
            } else continue;
        }

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
                // 检查小队是否超时未集结
                if (Game.time - teamData['time'] > 50000) {
                    delete Memory['TeamData'][teamID];
                    console.log(`${teamID}小队因组建超时已解散.`);
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

            // 构造小队对象
            const team = new Team(teamData);

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
    },
}

export default TeamModule