import { log } from "@/utils";
import { compressBodyConfig } from "@/modules/utils/compress";
import { TEAM_CONFIG } from "@/constant/TeamConfig";

export default class TeamSpawner {
    static run(): void {
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
            let spawnInterval = flagName.match(/_T(\d+)/)?.[1] as any;
            if (!spawnInterval) spawnInterval = 1000;
            else spawnInterval = parseInt(spawnInterval);
            const flagMemory = flag.memory;
            if ((Game.time - (flagMemory['lastTime'] || 0) < spawnInterval)) continue;

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

            // 生成小队ID
            let genTeamID = () => {
                let id = (Game.time * 36 * 36 + Math.floor(Math.random() * 36 * 36))
                    .toString(36).slice(-4).toUpperCase();
                if (Memory['TeamData'][id]) return genTeamID();
                return id;
            }
            const teamID = genTeamID();

            if (RES_MAP && Object.keys(RES_MAP).length) {
                if (!Object.keys(RES_MAP).every(res => {
                    if (room[res] > RES_MAP[res]) return true;
                    console.log(`BOOST资源${res}不足.`);
                    return false;
                })) {
                    flag.remove();
                    continue;
                }
                
                // 给lab分配boost任务 (传入 Team-teamID)
                for (const m in RES_MAP) {
                    room.AssignBoostTask(m as ResourceConstant, RES_MAP[m], `Team-${teamID}`);
                }
            }

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
                const { x, y, roomName } = flag.pos;
                Memory.flags[`Team-${teamID}`] = { 'setPosition': `${x}/${y}/${roomName}` }
            }

            // 孵化小队成员
            for (const c of Team_Config) {
                room.SpawnMissionAdd('',
                    compressBodyConfig(c.bodypart), -1, c.role, {
                    teamID, boostmap: { ...c.boostmap }
                } as any);
            }

            // 孵化计数
            flagMemory['lastTime'] = Game.time;
            flagMemory['spawnCount'] = (flagMemory['spawnCount'] || 0) + 1;
            log('TeamModule', `${flagName} 已派送小队 ${teamID} 到 ${flag.pos.roomName}, 配置:${config},`);
            // 孵化数量
            let spawnCount = flagName.match(/_N(\d+)/)?.[1] as any;
            if (!spawnCount) {
                flag.remove();
                delete Memory.flags[flagName];
                continue;
            }

            if (flagMemory['spawnCount'] >= parseInt(spawnCount)) {
                flag.remove();
                log('TeamModule', flagName, '孵化数量已满');
                delete Memory.flags[flagName];
            }
        }
    }
}
