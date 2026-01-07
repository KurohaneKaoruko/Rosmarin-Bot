import { RoleData } from "@/constant/CreepConstant";

type BoostMap = { [bodypart: string]: MineralBoostConstant };

type AioConfig = {
    bodypart: [BodyPartConstant, number][];
    boostmap: BoostMap;
};

type DoubleUnitConfig = {
    role: string;
    bodypart: [BodyPartConstant, number][];
    boostmap?: BoostMap;
};

type DoubleConfig = {
    A: DoubleUnitConfig;
    B: DoubleUnitConfig;
    squadType: string;
};

let AIO_CONFIG: { [key: string]: AioConfig } = {
    /** 1tower */
    '1T': {
        bodypart: [[TOUGH, 3], [RANGED_ATTACK, 32], [MOVE, 10], [HEAL, 5]],
        boostmap: { [HEAL]: 'XLHO2', [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' }
    },
    /** 2tower */
    '2T': {
        bodypart: [[TOUGH, 4], [RANGED_ATTACK, 26], [MOVE, 10], [HEAL, 10]],
        boostmap: { [HEAL]: 'XLHO2', [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' }
    },
    /** 3tower */
    '3T': {
        bodypart: [[TOUGH, 6], [RANGED_ATTACK, 22], [MOVE, 10], [HEAL, 12]],
        boostmap: { [HEAL]: 'XLHO2', [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' }
    },
    /** 6tower */
    '6T': {
        bodypart: [[TOUGH, 10], [RANGED_ATTACK, 5], [MOVE, 10], [HEAL, 25]],
        boostmap: { [HEAL]: 'XLHO2', [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' }
    }
}

let DOUBLE_CONFIG: { [key: string]: DoubleConfig } = {
    'TEST': {
        A: {
            role: 'double-attack',
            bodypart: [[ATTACK, 1], [MOVE, 1]],
        },
        B: {
            role: 'double-heal',
            bodypart: [[RANGED_ATTACK, 1], [HEAL, 1], [MOVE, 2]],
        },
        squadType: 'attack'
    },
    '2AT3': {
        A: {
            role: 'double-attack',
            bodypart: [[ATTACK, 8], [TOUGH, 12], [ATTACK, 20], [MOVE, 10]],
            boostmap: {[ATTACK]: 'XUH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2'},
        },
        B: {
            role: 'double-heal',
            bodypart: [[TOUGH, 12], [HEAL, 28], [MOVE, 10]],
            boostmap: {[TOUGH]: 'XGHO2', [HEAL]: 'XLHO2', [MOVE]: 'XZHO2'},
        },
        squadType: 'attack'
    },
    '2DT3': {
        A: {
            role: 'double-dismantle',
            bodypart: [[WORK, 8], [TOUGH, 12], [WORK, 20], [MOVE, 10]],
            boostmap: {[WORK]: 'XZH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2'},
        },
        B: {
            role: 'double-heal',
            bodypart: [[TOUGH, 12], [HEAL, 28], [MOVE, 10]],
            boostmap: {[TOUGH]: 'XGHO2', [HEAL]: 'XLHO2', [MOVE]: 'XZHO2'},
        },
        squadType: 'dismantle'
    },
    '2A': {
        A: {
            role: 'double-attack',
            bodypart: [[ATTACK, 25], [MOVE, 25]],
        },
        B: {
            role: 'double-heal',
            bodypart: [[HEAL, 25], [MOVE, 25]],
        },
        squadType: 'attack'
    },
    '2D': {
        A: {
            role: 'double-dismantle',
            bodypart: [[WORK, 25], [MOVE, 25]],
        },
        B: {
            role: 'double-heal',
            bodypart: [[HEAL, 25], [MOVE, 25]],
        },
        squadType: 'dismantle'
    }
}

const WarModule = {
    tick: function () {
        if (Game.time % 10) return;
        for (const flagName in Game.flags) {

            // AIO 一体机
            // AIO/配置/孵化房间/N-孵化数量/T-孵化间隔
            if (flagName.startsWith('AIO/')) {
                // 孵化间隔
                let spawnInterval = flagName.match(/\/T-(\d+)/)?.[1] as any;
                if (!spawnInterval) spawnInterval = 1000;
                else spawnInterval = parseInt(spawnInterval);

                const flagMemory = Game.flags[flagName].memory;
                if ((Game.time - (flagMemory['lastTime']||0) < spawnInterval)) continue;

                // 孵化房间
                const spawnRoom = flagName.match(/\/([EW][1-9]+[NS][1-9]+)/)?.[1];
                const room = Game.rooms[spawnRoom];
                if (!spawnRoom || !room.my) {
                    Game.flags[flagName].remove();
                    continue;
                }

                // 目标房间
                const targetRoom = Game.flags[flagName].pos.roomName;

                let bodys = [];
                let boostmap: BoostMap = (RoleData['aio'].boostmap || {}) as BoostMap;

                // 配置
                const B = flagName.match(/AIO\/(\w+)/)?.[1];
                if (AIO_CONFIG[B]) {
                    bodys = AIO_CONFIG[B].bodypart || bodys;
                    boostmap = AIO_CONFIG[B].boostmap || boostmap
                }

                let boostResult = null;
                if (bodys.length == 0) {
                    boostResult = room.AssignBoostTaskByBody(RoleData['aio'].bodypart, boostmap);
                } else {
                    boostResult = room.AssignBoostTaskByBody(bodys, boostmap);
                }

                if (!boostResult) {
                    console.log(flagName, '没有足够的boost资源');
                    Game.flags[flagName].remove();
                    continue;
                }

                room.SpawnMissionAdd('', bodys, -1, 'aio', {
                    targetRoom: targetRoom,
                    boostmap: boostmap,
                } as any);

                flagMemory['lastTime'] = Game.time;
                flagMemory['spawnCount'] = (flagMemory['spawnCount']||0) + 1;
                console.log(flagName, '已添加孵化任务.');

                // 孵化数量
                let spawnCount = flagName.match(/\/N-(\d+)/)?.[1] as any;
                if (!spawnCount) spawnCount = 0;
                else spawnCount = parseInt(spawnCount);
                if (flagMemory['spawnCount'] >= spawnCount) {
                    console.log(flagName, '孵化数量已满');
                    Game.flags[flagName].remove();
                }
                continue;
            }


            // 双人小队
            // DOUBLE/配置/孵化房间/N-孵化数量/T-孵化间隔
            if (flagName.startsWith('DOUBLE/')) {
                // 孵化间隔
                let spawnInterval = flagName.match(/\/T-(\d+)/)?.[1] as any;
                if (!spawnInterval) spawnInterval = 1000;
                else spawnInterval = parseInt(spawnInterval);

                const flagMemory = Game.flags[flagName].memory;
                if ((Game.time - (flagMemory['lastTime']||0) < spawnInterval)) continue;

                // 孵化房间
                const spawnRoom = flagName.match(/\/([EW][1-9]+[NS][1-9]+)/)?.[1];
                const room = Game.rooms[spawnRoom];
                if (!spawnRoom || !room.my) {
                    Game.flags[flagName].remove();
                    continue;
                }

                // 目标房间
                const targetRoom = Game.flags[flagName].pos.roomName;
                // 配置
                const config = flagName.match(/DOUBLE\/(\w+)/)?.[1] as any;
                const { A, B, squadType } = DOUBLE_CONFIG[config] || {};
                if (!A || !B) {
                    console.log(flagName, `不支持的二人小队类型${config}`);
                    Game.flags[flagName].remove();
                    continue;
                }

                if (A.boostmap && !room.CheckBoostRes(A.bodypart, A.boostmap)) {
                    console.log(flagName, '没有足够的boost资源');
                    Game.flags[flagName].remove();
                    continue;
                }
                if (B.boostmap && !room.CheckBoostRes(B.bodypart, B.boostmap)) {
                    console.log(flagName, '没有足够的boost资源');
                    Game.flags[flagName].remove();
                    continue;
                }

                room.AssignBoostTaskByBody(A.bodypart, A.boostmap);
                room.AssignBoostTaskByBody(B.bodypart, B.boostmap);
                
                // 添加孵化任务
                room.SpawnMissionAdd('', A.bodypart, -1, A.role, {
                    targetRoom: targetRoom,
                    boostmap: A.boostmap,
                    squad: squadType
                } as any);
                room.SpawnMissionAdd('', B.bodypart, -1, B.role, {
                    targetRoom: targetRoom,
                    boostmap: B.boostmap,
                    squad: squadType
                } as any)


                flagMemory['lastTime'] = Game.time;
                flagMemory['spawnCount'] = (flagMemory['spawnCount']||0) + 1;
                console.log(flagName, `已添加一支二人小队的孵化任务, 配置:${config}`);

                // 孵化数量
                let spawnCount = flagName.match(/\/N-(\d+)/)?.[1] as any;
                if (!spawnCount) spawnCount = 0;
                else spawnCount = parseInt(spawnCount);
                if (spawnCount != 0 && flagMemory['spawnCount'] >= spawnCount) {
                    console.log(flagName, '孵化数量已满');
                    Game.flags[flagName].remove();
                }
            }
        }
    }
}

export {WarModule};